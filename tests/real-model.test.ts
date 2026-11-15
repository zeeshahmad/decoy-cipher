import { describe, expect, it } from "vitest";
import { deriveKeys } from "../src/core/crypto";
import { loadTransformersLM } from "../src/core/lm-transformers";
import { decode, encode } from "../src/core/stego";
import { themeById } from "../src/core/themes";

// Downloads a ~136MB model, so it only runs on request: REAL=1 npm test
describe.skipIf(!process.env.REAL)("real model", () => {
  it("encrypts to readable text and decrypts it again", async () => {
    const lm = await loadTransformersLM();
    const theme = themeById("pirate");
    const keys = await deriveKeys("open sesame", theme.id);
    const msg = "Meet me at the old lighthouse at midnight.";
    const t0 = Date.now();
    const enc = await encode(lm, theme.prompt, msg, keys);
    console.log(`ENCODED in ${Date.now() - t0}ms (${enc.tokens.length} tokens):\n${theme.prompt} ${enc.text}`);
    const res = await decode(lm, theme.prompt, enc.text, keys);
    expect(res).toEqual({ ok: true, message: msg });
    const bad = await decode(lm, theme.prompt, enc.text, await deriveKeys("nope", theme.id));
    expect(bad.ok).toBe(false);
  }, 600_000);
});
