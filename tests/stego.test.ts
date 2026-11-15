import { describe, expect, it } from "vitest";
import { BitsToSymbols, SymbolsToBits, TOTAL } from "../src/core/arith";
import { deriveKeys, open, seal } from "../src/core/crypto";
import { detExp } from "../src/core/detmath";
import { FakeLM } from "../src/core/lm";
import { decode, encode } from "../src/core/stego";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

function randomDist(r: () => number, n: number) {
  const freqs = Array.from({ length: n }, () => 1 + Math.floor(r() ** 3 * 4000));
  const sum = freqs.reduce((a, b) => a + b, 0);
  const scaled = freqs.map((f) => Math.max(1, Math.floor((f / sum) * (TOTAL - n))));
  scaled[0] += TOTAL - scaled.reduce((a, b) => a + b, 0);
  return { freqs: scaled };
}

describe("detExp", () => {
  it("is close to Math.exp", () => {
    for (const x of [0, -0.1, -1, -3.3, -10, -40]) expect(detExp(x) / Math.exp(x)).toBeCloseTo(1, 10);
  });
});

describe("arithmetic coder", () => {
  it("round-trips random bits through random distributions", () => {
    const r = rng(1);
    for (let trial = 0; trial < 200; trial++) {
      const bits = Array.from({ length: 40 + Math.floor(r() * 400) }, () => (r() < 0.5 ? 0 : 1));
      const enc = new BitsToSymbols(bits);
      const dec = new SymbolsToBits();
      let guard = 0;
      while (enc.determined < bits.length && guard++ < 5000) {
        const dist = randomDist(r, 2 + Math.floor(r() * 60));
        dec.consume(dist, enc.choose(dist));
      }
      expect(dec.bits().slice(0, bits.length)).toEqual(bits);
    }
  });
});

describe("crypto framing", () => {
  it("opens with the right password, rejects the wrong one", async () => {
    const good = await deriveKeys("hunter2", "pirate");
    const bad = await deriveKeys("hunter3", "pirate");
    const bits = await seal("meet me at dawn ☀️", good);
    expect(await open(bits, good)).toBe("meet me at dawn ☀️");
    expect(await open(bits, bad)).toBeNull();
  });
});

describe("stego round trip (fake LM)", () => {
  const lm = new FakeLM();
  const prompt = "The ship sailed";
  const messages = ["", "hi", "Attack at dawn!", "emoji 🎉 and ünïcödé", "x".repeat(200)];

  for (const m of messages) {
    it(`round-trips ${JSON.stringify(m.slice(0, 20))}`, async () => {
      const keys = await deriveKeys("correct horse", "t");
      const enc = await encode(lm, prompt, m, keys);
      expect(enc.full.startsWith(prompt)).toBe(true);
      expect(await decode(lm, prompt, enc.text, keys)).toEqual({ ok: true, message: m });
      expect(await decode(lm, prompt, enc.full, keys)).toEqual({ ok: true, message: m });
      // wrong password must not decrypt
      const wrong = await decode(lm, prompt, enc.text, await deriveKeys("battery staple", "t"));
      expect(wrong.ok).toBe(false);
    });
  }

  it("tolerates surrounding whitespace added by copy/paste", async () => {
    const keys = await deriveKeys("pw", "t");
    const enc = await encode(lm, prompt, "paste me", keys);
    expect(await decode(lm, prompt, `\n  ${enc.full}  \n`, keys)).toEqual({ ok: true, message: "paste me" });
    // the joining space got eaten
    expect(await decode(lm, prompt, enc.text.trimStart(), keys)).toEqual({ ok: true, message: "paste me" });
  });

  it("random messages and passwords", async () => {
    const r = rng(7);
    for (let i = 0; i < 25; i++) {
      const msg = Array.from({ length: Math.floor(r() * 60) }, () => String.fromCharCode(32 + Math.floor(r() * 95))).join("");
      const keys = await deriveKeys("pw" + i, "t");
      const enc = await encode(lm, prompt, msg, keys);
      expect(await decode(lm, prompt, enc.text, keys)).toEqual({ ok: true, message: msg });
    }
  });
});
