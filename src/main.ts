import { deriveKeys } from "./core/crypto";
import type { LM } from "./core/lm";
import { ENGINE_ID, loadTransformersLM } from "./core/lm-transformers";
import { decode, encode, type Encoded } from "./core/stego";
import { THEMES, themeById } from "./core/themes";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const themeSel = $<HTMLSelectElement>("theme");
const pw = $<HTMLInputElement>("password");
const input = $<HTMLTextAreaElement>("input");
const go = $<HTMLButtonElement>("go");
const status = $("status");
const bar = $<HTMLProgressElement>("bar");
const result = $("result");
const output = $("output");
const how = $<HTMLInputElement>("how");

let mode: "enc" | "dec" = "enc";
let last: Encoded | null = null;
let lmPromise: Promise<LM> | null = null;

for (const t of THEMES) themeSel.add(new Option(`${t.emoji} ${t.name}`, t.id));

function say(msg: string, err = false) {
  status.textContent = msg;
  status.classList.toggle("err", err);
}

function setMode(m: "enc" | "dec") {
  mode = m;
  $("tab-enc").setAttribute("aria-selected", String(m === "enc"));
  $("tab-dec").setAttribute("aria-selected", String(m === "dec"));
  $("in-label").firstChild!.textContent = m === "enc" ? "Secret message" : "Text to reveal";
  input.placeholder = m === "enc" ? "Meet me at the old lighthouse at midnight." : "Paste the story here…";
  input.maxLength = m === "enc" ? 500 : 20000;
  input.rows = m === "enc" ? 4 : 8;
  go.textContent = m === "enc" ? "Hide it" : "Reveal it";
  result.hidden = true;
  say("");
}
$("tab-enc").onclick = () => setMode("enc");
$("tab-dec").onclick = () => setMode("dec");

function getLM(): Promise<LM> {
  lmPromise ??= loadTransformersLM((p) => {
    if (p.status === "progress" && p.total) {
      bar.hidden = false;
      bar.value = (p.loaded ?? 0) / p.total;
      say(`Downloading language model… ${Math.round(((p.loaded ?? 0) / p.total) * 100)}%`);
    } else if (p.status === "ready") say("Model ready.");
  }).catch((e) => {
    lmPromise = null;
    throw e;
  });
  return lmPromise;
}

function showOutput(text: string, enc?: Encoded) {
  result.hidden = false;
  $("result-title").textContent =
    mode === "enc" ? `Your decoy text (theme: ${themeById(themeSel.value).name})` : "Revealed message";
  last = enc ?? null;
  $("how-wrap").hidden = $("how-hint").hidden = !enc || !how.checked;
  $("how-wrap").hidden = !enc;
  render(text);
}

function render(text: string) {
  output.textContent = "";
  if (!last || !how.checked) {
    output.textContent = text;
    $("how-hint").hidden = true;
    return;
  }
  $("how-hint").hidden = false;
  const max = Math.max(1, ...last.bitsPerToken);
  const lead = document.createElement("span");
  lead.className = "t";
  lead.style.opacity = "0.55";
  lead.title = "theme opening (not secret)";
  lead.textContent = text.slice(0, text.length - last.text.length);
  output.append(lead);
  last.tokenTexts.forEach((t, i) => {
    const s = document.createElement("span");
    s.className = "t";
    s.textContent = t;
    const b = last!.bitsPerToken[i];
    s.title = `${b} bit${b === 1 ? "" : "s"}`;
    s.style.background = `rgba(var(--heat), ${(b / max) * 0.55})`;
    output.append(s);
  });
}
how.onchange = () => last && render(last.full);

go.onclick = async () => {
  if (!pw.value || !input.value.trim()) return say("Enter a password and some text first.", true);
  go.disabled = true;
  result.hidden = true;
  bar.hidden = false;
  bar.value = 0;
  try {
    const theme = themeById(themeSel.value);
    say("Loading model (first time is a download)…");
    const lm = await getLM();
    say("Deriving key…");
    const keys = await deriveKeys(pw.value, theme.id);
    const onProgress = (d: number, t: number) => {
      bar.value = d / t;
      say(`${mode === "enc" ? "Writing" : "Reading"}… ${Math.round((d / t) * 100)}%`);
    };
    if (mode === "enc") {
      const enc = await encode(lm, theme.prompt, input.value, keys, { onProgress });
      showOutput(enc.full, enc);
      say(`${enc.tokens.length} tokens, ${new TextEncoder().encode(input.value).length} secret bytes.`);
    } else {
      const res = await decode(lm, theme.prompt, input.value, keys, { onProgress });
      if (res.ok) {
        showOutput(res.message);
        say("Revealed.");
      } else {
        say(
          res.reason === "wrong-text"
            ? "This text doesn't look like it was written with this theme (or by this model version)."
            : "No message found. Wrong password, wrong theme, or the text was edited.",
          true,
        );
      }
    }
  } catch (e) {
    say(String((e as Error).message ?? e), true);
  } finally {
    go.disabled = false;
    bar.hidden = true;
  }
};

$("copy").onclick = async () => {
  await navigator.clipboard.writeText(output.textContent ?? "");
  say("Copied.");
};
$("link").onclick = async () => {
  // The fragment never leaves the browser. It carries theme + engine tag + text, not the password.
  const u = new URL(location.href);
  u.hash = new URLSearchParams({ m: "dec", t: themeSel.value, e: ENGINE_ID, x: last?.full ?? output.textContent ?? "" }).toString();
  await navigator.clipboard.writeText(u.toString());
  say("Link copied (the recipient still needs the password).");
};

// Open a shared link: pre-fill the decrypt tab.
const h = new URLSearchParams(location.hash.slice(1));
if (h.get("m") === "dec") {
  setMode("dec");
  if (h.get("t")) themeSel.value = h.get("t")!;
  input.value = h.get("x") ?? "";
  if (h.get("e") && h.get("e") !== ENGINE_ID) say(`Warning: made with engine ${h.get("e")}, this app runs ${ENGINE_ID}.`, true);
}
