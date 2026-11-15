/**
 * The language-model contract the steganography engine needs. Keeping it this
 * small lets us swap in a fake model for tests and a real one in the browser.
 *
 * IMPORTANT for determinism: encoder and decoder must drive the model through
 * the SAME call pattern (prefill(prompt) then step(token) one token at a time),
 * because different matrix shapes can change floating-point summation order.
 */
export interface LMSession {
  /** Feed the prompt; returns next-token logits. */
  prefill(ids: number[]): Promise<Float32Array>;
  /** Feed one token; returns next-token logits. */
  step(id: number): Promise<Float32Array>;
}

export interface LM {
  /** Identifies model + revision + runtime. Both sides must match. */
  id: string;
  tokenize(text: string): number[];
  decode(ids: number[]): string;
  session(): LMSession;
}

/** A tiny deterministic stand-in "model" for tests: hashed bigram logits. */
const WORDS = (
  "the a an old new quiet loud small great red blue green dark bright cold warm " +
  "ship sea wind storm captain crew map gold island harbor night morning rain sun moon star " +
  "sailed found lost saw heard kept left took gave told asked said knew felt held " +
  "and but so then while when where because until over under near far across beyond " +
  "we they he she it you i was were is are had has will would could never always often " +
  "of to in on at by with from into through along toward again still just only almost"
).split(" ");

const PUNCT = [".", ",", "!", "?"];
const VOCAB: string[] = [...WORDS.map((w) => " " + w), ...WORDS.map((w) => w[0].toUpperCase() + w.slice(1)), ...PUNCT];

function hash(a: number, b: number, c: number): number {
  let h = (a * 2654435761) ^ (b * 40503) ^ (c * 2246822519);
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

export class FakeLM implements LM {
  id = "fake-lm/1";
  tokenize(text: string): number[] {
    const out: number[] = [];
    const re = / ?[A-Za-z]+|[.,!?]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const t = m[0];
      let id = VOCAB.indexOf(t);
      if (id < 0 && t[0] === " ") id = VOCAB.indexOf(" " + t.slice(1).toLowerCase());
      if (id < 0) id = VOCAB.indexOf(t[0].toUpperCase() + t.slice(1).toLowerCase());
      out.push(id < 0 ? 0 : id);
    }
    return out;
  }
  decode(ids: number[]): string {
    return ids.map((i) => VOCAB[i] ?? "").join("");
  }
  session(): LMSession {
    const hist: number[] = [];
    const logits = () => {
      const a = hist[hist.length - 1] ?? 0;
      const b = hist[hist.length - 2] ?? 0;
      const out = new Float32Array(VOCAB.length);
      for (let i = 0; i < out.length; i++) out[i] = (hash(a, b, i) % 4000) / 400; // 0..10
      return out;
    };
    return {
      prefill: async (ids) => (hist.push(...ids), logits()),
      step: async (id) => (hist.push(id), logits()),
    };
  }
}
