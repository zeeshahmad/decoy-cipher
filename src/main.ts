import { deriveKeys } from "./core/crypto";
import type { LM } from "./core/lm";
import { ENGINE_ID, loadTransformersLM } from "./core/lm-transformers";
import { decode, encode, type Encoded } from "./core/stego";
import { THEMES, themeById } from "./core/themes";

type Mode = "enc" | "dec";

let lmPromise: Promise<LM> | null = null;
const panels: Panel[] = [];

/** One column: its own theme, password, input, progress and result. */
class Panel {
  root: HTMLElement;
  theme: HTMLSelectElement;
  pw: HTMLInputElement;
  input: HTMLTextAreaElement;
  go: HTMLButtonElement;
  statusEl: HTMLElement;
  bar: HTMLProgressElement;
  result: HTMLElement;
  output: HTMLElement;
  how: HTMLInputElement | null;
  howHint: HTMLElement | null;
  last: Encoded | null = null;

  constructor(public mode: Mode) {
    const q = <T extends Element>(s: string) => this.root.querySelector(s) as T;
    this.root = document.getElementById(mode)!;
    this.theme = q("select.theme");
    this.pw = q("input.password");
    this.input = q("textarea.input");
    this.go = q("button.go");
    this.statusEl = q(".status");
    this.bar = q("progress.bar");
    this.result = q(".result");
    this.output = q(".output");
    this.how = this.root.querySelector("input.how");
    this.howHint = this.root.querySelector(".how-hint");

    for (const t of THEMES) this.theme.add(new Option(`${t.emoji} ${t.name}`, t.id));
    this.go.onclick = () => this.run();
    q<HTMLButtonElement>("button.copy").onclick = async () => {
      await navigator.clipboard.writeText(this.output.textContent ?? "");
      this.say("Copied.");
    };
    const link = this.root.querySelector<HTMLButtonElement>("button.link");
    if (link) link.onclick = () => this.copyLink();
    if (this.how) this.how.onchange = () => this.last && this.render(this.last.full);
  }

  say(msg: string, err = false) {
    this.statusEl.textContent = msg;
    this.statusEl.classList.toggle("err", err);
  }

  private busy(b: boolean) {
    for (const p of panels) p.go.disabled = b;
    this.bar.hidden = !b;
    if (b) this.bar.value = 0;
  }

  private show(text: string, enc?: Encoded) {
    this.result.hidden = false;
    this.last = enc ?? null;
    this.render(text);
  }

  private render(text: string) {
    const out = this.output;
    out.textContent = "";
    const heat = !!this.last && !!this.how?.checked;
    if (this.howHint) this.howHint.hidden = !heat;
    if (!heat || !this.last) {
      out.textContent = text;
      return;
    }
    const last = this.last;
    const lead = document.createElement("span");
    lead.className = "t";
    lead.style.opacity = "0.55";
    lead.title = "theme opening (not secret)";
    lead.textContent = text.slice(0, text.length - last.text.length);
    out.append(lead);
    const max = Math.max(1, ...last.bitsPerToken);
    last.tokenTexts.forEach((t, i) => {
      const s = document.createElement("span");
      s.className = "t";
      s.textContent = t;
      const b = last.bitsPerToken[i];
      s.title = `${b} bit${b === 1 ? "" : "s"}`;
      s.style.background = `rgba(var(--heat), ${(b / max) * 0.55})`;
      out.append(s);
    });
  }

  private async copyLink() {
    // The fragment never leaves the browser. It carries theme + engine tag + text, not the password.
    const u = new URL(location.href);
    u.hash = new URLSearchParams({ t: this.theme.value, e: ENGINE_ID, x: this.last?.full ?? this.output.textContent ?? "" }).toString();
    await navigator.clipboard.writeText(u.toString());
    this.say("Link copied (the recipient still needs the password).");
  }

  private async run() {
    if (!this.pw.value || !this.input.value.trim()) return this.say("Enter a password and some text first.", true);
    this.result.hidden = true;
    this.busy(true);
    try {
      const theme = themeById(this.theme.value);
      this.say("Loading model (first time is a download)…");
      const lm = await getLM(this);
      this.say("Deriving key…");
      const keys = await deriveKeys(this.pw.value, theme.id);
      const onProgress = (d: number, t: number) => {
        this.bar.value = d / t;
        this.say(`${this.mode === "enc" ? "Writing" : "Reading"}… ${Math.round((d / t) * 100)}%`);
      };
      if (this.mode === "enc") {
        const enc = await encode(lm, theme.prompt, this.input.value, keys, { onProgress });
        this.show(enc.full, enc);
        this.say(`${enc.tokens.length} tokens, ${new TextEncoder().encode(this.input.value).length} secret bytes.`);
      } else {
        const res = await decode(lm, theme.prompt, this.input.value, keys, { onProgress });
        if (res.ok) {
          this.show(res.message);
          this.say("Revealed.");
        } else {
          this.say(
            res.reason === "wrong-text"
              ? "This text doesn't look like it was written with this theme (or by this model version)."
              : "No message found. Wrong password, wrong theme, or the text was edited.",
            true,
          );
        }
      }
    } catch (e) {
      this.say(String((e as Error).message ?? e), true);
    } finally {
      this.busy(false);
      this.bar.hidden = true;
    }
  }
}

function getLM(who: Panel): Promise<LM> {
  lmPromise ??= loadTransformersLM((p) => {
    if (p.status === "progress" && p.total) {
      who.bar.hidden = false;
      who.bar.value = (p.loaded ?? 0) / p.total;
      who.say(`Downloading language model… ${Math.round(((p.loaded ?? 0) / p.total) * 100)}%`);
    }
  }).catch((e) => {
    lmPromise = null;
    throw e;
  });
  return lmPromise;
}

const enc = new Panel("enc");
const dec = new Panel("dec");
panels.push(enc, dec);

// Open a shared link: pre-fill the reveal column.
const h = new URLSearchParams(location.hash.slice(1));
if (h.get("x")) {
  if (h.get("t")) dec.theme.value = h.get("t")!;
  dec.input.value = h.get("x")!;
  if (h.get("e") && h.get("e") !== ENGINE_ID) dec.say(`Warning: made with engine ${h.get("e")}, this app runs ${ENGINE_ID}.`, true);
  dec.root.scrollIntoView();
}
