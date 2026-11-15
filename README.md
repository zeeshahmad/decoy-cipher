<h1><img src="public/icon.svg" width="40" height="40" alt="" align="absmiddle"> Decoy Cipher</h1>

Hide a secret message inside a **readable story**. Type a message and a password, pick a theme (pirate's log, weather report, cooking blog…), and out comes ordinary-looking prose. Give the recipient the text, the theme and the password, and they can pull the original message back out.

Everything runs in your browser. Nothing is uploaded.

## How it works

1. Your message is turned into bytes, prefixed with a length and a 2-byte check, and XORed with a keystream derived from `password + theme` (PBKDF2 + HMAC-SHA256). The result is indistinguishable from random bits.
2. A small open-source language model ([SmolLM2-135M](https://huggingface.co/HuggingFaceTB/SmolLM2-135M)) is given the theme's opening line and asked, word by word, what comes next.
3. At each word, the model's probabilities carve up a number line. The secret bits decide *which slice* we land in, via **arithmetic coding run in reverse**. A likely word costs few bits; an unlikely word carries many. So the text stays fluent, and every word choice (noun or verb, long or short sentence, comma or full stop) is quietly carrying information.
4. To decrypt, the receiver runs the same model over the text, sees which slice each word fell in, recovers the bits, un-XORs them with the keystream, and verifies the check bytes. A wrong password or theme simply fails.

Turn on **show me how** to see which words carried the most bits.

## Why the model must be predictable

Decryption only works if the receiver's model produces *exactly* the same probabilities. So:

- The model runs on the **WASM backend, single-threaded** (IEEE-754 floats are bit-identical across machines; WebGPU and native kernels are not).
- Probabilities are quantized to integers, and `exp` is a custom implementation (`src/core/detmath.ts`), because `Math.exp` can differ by a bit between browsers.
- The model is pinned to an exact revision. The app shows an engine id (`smollm2-135m-int8-wasm/1`) in shared links so a mismatch gives a clear warning.
- Only tokens that survive copy-paste and re-tokenization are allowed (printable ASCII, no newlines).

## Run it

```bash
npm install
npm run dev     # http://localhost:5173
npm test        # fast tests with a fake model
REAL=1 npm test # also downloads the ~136 MB model and round-trips for real (Node, native CPU)
```

## Caveats

- **This is a toy, not vetted cryptography.** Don't hide anything that matters.
- Statistically, text from a language model with unusually "flat" word choices could be detected by an expert.
- Edit the story and the message is gone. Changing even one word breaks decoding after that point.
- Messages are limited to ~500 characters; a longer secret means a longer story (and a slower CPU).
- Rarely, a message hits a tokenization edge case and encoding asks you to tweak a character.

## License

MIT. Model weights are under their own (Apache-2.0) license.
