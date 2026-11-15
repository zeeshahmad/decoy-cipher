/**
 * Password -> keystream, plus framing. Uses WebCrypto (browser and Node >= 20).
 *
 * NOTE: this is a toy. A keyed keystream XOR with a 16-bit check is enough to
 * make the hidden bits look random and to detect wrong passwords, but it is not
 * vetted cryptography. Don't hide real secrets with it.
 */

const enc = new TextEncoder();
const dec = new TextDecoder("utf-8", { fatal: true });
const subtle = globalThis.crypto.subtle;

export const MAX_MESSAGE_BYTES = 1000;
export const HEADER_BYTES = 4; // 2 length + 2 check
const ITERATIONS = 150_000;

export interface Keys {
  master: CryptoKey; // HMAC key
}

export async function deriveKeys(password: string, theme: string): Promise<Keys> {
  const pw = await subtle.importKey("raw", enc.encode(password.normalize("NFKC")), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", iterations: ITERATIONS, salt: enc.encode("decoy-cipher/v1|" + theme) },
    pw,
    256,
  );
  const master = await subtle.importKey("raw", bits, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return { master };
}

async function hmac(key: CryptoKey, data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await subtle.sign("HMAC", key, data as BufferSource));
}

async function keystream(keys: Keys, n: number): Promise<Uint8Array> {
  const out = new Uint8Array(Math.ceil(n / 32) * 32 || 32);
  for (let i = 0; i * 32 < n; i++) {
    const ctr = new Uint8Array(5);
    ctr[0] = 0x4b; // 'K'
    new DataView(ctr.buffer).setUint32(1, i);
    out.set(await hmac(keys.master, ctr), i * 32);
  }
  return out.subarray(0, n);
}

async function check(keys: Keys, len: number, payload: Uint8Array): Promise<Uint8Array> {
  const data = new Uint8Array(3 + payload.length);
  data[0] = 0x43; // 'C'
  data[1] = len >> 8;
  data[2] = len & 255;
  data.set(payload, 3);
  return (await hmac(keys.master, data)).subarray(0, 2);
}

/** message -> bits (0/1 array), ready to be hidden in text. */
export async function seal(message: string, keys: Keys): Promise<number[]> {
  const payload = enc.encode(message);
  if (payload.length > MAX_MESSAGE_BYTES) throw new Error(`Message too long (max ${MAX_MESSAGE_BYTES} bytes).`);
  const frame = new Uint8Array(HEADER_BYTES + payload.length);
  frame[0] = payload.length >> 8;
  frame[1] = payload.length & 255;
  frame.set(await check(keys, payload.length, payload), 2);
  frame.set(payload, HEADER_BYTES);
  const ks = await keystream(keys, frame.length);
  const bits: number[] = [];
  for (let i = 0; i < frame.length; i++) {
    const b = frame[i] ^ ks[i];
    for (let j = 7; j >= 0; j--) bits.push((b >> j) & 1);
  }
  return bits;
}

/** How many bits the receiver needs before it knows the total length. */
export const HEADER_BITS = HEADER_BYTES * 8;

function bitsToBytes(bits: ArrayLike<number>, nBytes: number): Uint8Array {
  const out = new Uint8Array(nBytes);
  for (let i = 0; i < nBytes; i++) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | bits[i * 8 + j];
    out[i] = v;
  }
  return out;
}

/** Total bits (header + payload) implied by the first HEADER_BITS bits. */
export async function totalBitsNeeded(bits: ArrayLike<number>, keys: Keys): Promise<number | null> {
  if (bits.length < 16) return null;
  const ks = await keystream(keys, 2);
  const h = bitsToBytes(bits, 2);
  const len = ((h[0] ^ ks[0]) << 8) | (h[1] ^ ks[1]);
  if (len > MAX_MESSAGE_BYTES) return null;
  return (HEADER_BYTES + len) * 8;
}

/** bits -> message, or null if the password/theme is wrong (or text was altered). */
export async function open(bits: ArrayLike<number>, keys: Keys): Promise<string | null> {
  const total = await totalBitsNeeded(bits, keys);
  if (total === null || bits.length < total) return null;
  const frame = bitsToBytes(bits, total / 8);
  const ks = await keystream(keys, frame.length);
  for (let i = 0; i < frame.length; i++) frame[i] ^= ks[i];
  const len = (frame[0] << 8) | frame[1];
  const payload = frame.subarray(HEADER_BYTES);
  const want = await check(keys, len, payload);
  if (want[0] !== frame[2] || want[1] !== frame[3]) return null;
  try {
    return dec.decode(payload);
  } catch {
    return null;
  }
}
