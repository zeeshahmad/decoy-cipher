import { BitsToSymbols, SymbolsToBits, TOTAL, type Dist } from "./arith";
import { detExp } from "./detmath";
import { open, seal, totalBitsNeeded, type Keys } from "./crypto";
import type { LM } from "./lm";

export interface StegoOptions {
  /** candidates considered per step */
  topK?: number;
  /** <1 = more fluent, fewer bits per token */
  temperature?: number;
  maxTokens?: number;
  onProgress?: (done: number, total: number) => void;
}

const DEFAULTS = { topK: 48, temperature: 0.85, maxTokens: 2500 };
const WINDOW = 10;
const PRINTABLE = /^[\x20-\x7e]+$/;

export interface Encoded {
  /** the whole story to share: the theme's opening line followed by the generated words */
  full: string;
  /** just the generated continuation (may start with a space) */
  text: string;
  tokens: number[];
  /** how many secret bits each token carried (for the "show me how" view) */
  bitsPerToken: number[];
  tokenTexts: string[];
}

/** Can this token be emitted next without breaking retokenisation / copy-paste? */
function acceptable(lm: LM, generated: number[], cand: number): boolean {
  const t = lm.decode([cand]);
  if (!t || !PRINTABLE.test(t) || t.includes("  ")) return false;
  const win = generated.slice(-WINDOW);
  win.push(cand);
  const again = lm.tokenize(lm.decode(win));
  return again.length === win.length && again.every((v, i) => v === win[i]);
}

/** Identical on both sides: logits + generated-so-far -> (candidate ids, integer distribution). */
function buildDist(lm: LM, logits: Float32Array, generated: number[], topK: number, temp: number) {
  // Top (3*topK) raw candidates by logit, ties broken by smaller id. Small insertion buffer: O(V).
  const cap = topK * 3;
  const ids: number[] = [];
  const vals: number[] = [];
  for (let i = 0; i < logits.length; i++) {
    const v = logits[i];
    if (ids.length === cap && v <= vals[cap - 1]) continue;
    let j = ids.length < cap ? ids.length : cap - 1;
    while (j > 0 && vals[j - 1] < v) {
      ids[j] = ids[j - 1];
      vals[j] = vals[j - 1];
      j--;
    }
    ids[j] = i;
    vals[j] = v;
  }
  const keep: number[] = [];
  const keepVals: number[] = [];
  for (let k = 0; k < ids.length && keep.length < topK; k++) {
    if (acceptable(lm, generated, ids[k])) {
      keep.push(ids[k]);
      keepVals.push(vals[k]);
    }
  }
  if (keep.length === 0) throw new Error("No usable token candidates (unexpected).");
  const top = keepVals[0];
  const w = keepVals.map((v) => detExp((v - top) / temp));
  const sum = w.reduce((a, b) => a + b, 0);
  const budget = TOTAL - keep.length;
  const freqs = w.map((x) => 1 + Math.floor((x / sum) * budget));
  freqs[0] += TOTAL - freqs.reduce((a, b) => a + b, 0);
  const dist: Dist = { freqs };
  return { ids: keep, dist };
}

export async function encode(
  lm: LM,
  prompt: string,
  message: string,
  keys: Keys,
  opts: StegoOptions = {},
): Promise<Encoded> {
  const o = { ...DEFAULTS, ...opts };
  const bits = await seal(message, keys);
  const session = lm.session();
  let logits = await session.prefill(lm.tokenize(prompt));
  const coder = new BitsToSymbols(bits);
  const generated: number[] = [];
  const per: number[] = [];

  while (coder.determined < bits.length) {
    if (generated.length >= o.maxTokens) throw new Error("Message needs too many words; try a shorter one.");
    const { ids, dist } = buildDist(lm, logits, generated, o.topK, o.temperature);
    const before = coder.determined;
    const id = ids[coder.choose(dist)];
    generated.push(id);
    per.push(Math.min(coder.determined, bits.length) - Math.min(before, bits.length));
    o.onProgress?.(Math.min(coder.determined, bits.length), bits.length);
    logits = await session.step(id);
  }

  // Tail: finish the sentence greedily (the receiver just ignores these).
  const endsSentence = (id: number) => /[.!?]["')\]]*$/.test(lm.decode([id]));
  for (let n = 0; n < 60 && !endsSentence(generated[generated.length - 1]); n++) {
    const { ids } = buildDist(lm, logits, generated, o.topK, o.temperature);
    generated.push(ids[0]);
    per.push(0);
    logits = await session.step(ids[0]);
  }

  const text = lm.decode(generated);
  const again = lm.tokenize(text);
  if (text !== text.trimEnd() || again.length !== generated.length || again.some((v, i) => v !== generated[i])) {
    throw new Error("Tokenisation drifted for this message; change a character or the password and retry.");
  }
  return { full: prompt + text, text, tokens: generated, bitsPerToken: per, tokenTexts: generated.map((t) => lm.decode([t])) };
}

export type DecodeFailure = "wrong-text" | "wrong-password";

export type DecodeResult = { ok: true; message: string } | { ok: false; reason: DecodeFailure };

/**
 * Accepts the full story (with the theme's opening line) or just the continuation.
 * Copy-paste can eat the single space that joins the two, so we also try with one added.
 */
export async function decode(lm: LM, prompt: string, text: string, keys: Keys, opts: StegoOptions = {}): Promise<DecodeResult> {
  let body = text.trimEnd();
  if (body.trimStart().startsWith(prompt)) body = body.trimStart().slice(prompt.length);
  const variants = body.startsWith(" ") ? [body] : [body, " " + body];
  let res = await decodeOnce(lm, prompt, variants[0], keys, opts);
  for (let i = 1; !res.ok && res.reason === "wrong-text" && i < variants.length; i++) {
    res = await decodeOnce(lm, prompt, variants[i], keys, opts);
  }
  return res;
}

async function decodeOnce(lm: LM, prompt: string, text: string, keys: Keys, opts: StegoOptions): Promise<DecodeResult> {
  const o = { ...DEFAULTS, ...opts };
  const tokens = lm.tokenize(text);
  const session = lm.session();
  let logits = await session.prefill(lm.tokenize(prompt));
  const coder = new SymbolsToBits();
  const generated: number[] = [];
  let total: number | null = null;

  for (let i = 0; i < tokens.length; i++) {
    const { ids, dist } = buildDist(lm, logits, generated, o.topK, o.temperature);
    const sym = ids.indexOf(tokens[i]);
    if (sym < 0) return { ok: false, reason: "wrong-text" }; // not something this model/theme would write
    coder.consume(dist, sym);
    generated.push(tokens[i]);
    o.onProgress?.(i + 1, tokens.length);
    if (total === null) total = await totalBitsNeeded(coder.bits(), keys);
    if (total !== null && coder.determined >= total) break;
    if (i < tokens.length - 1) logits = await session.step(tokens[i]);
  }

  const message = await open(coder.bits(), keys);
  return message === null ? { ok: false, reason: "wrong-password" } : { ok: true, message };
}
