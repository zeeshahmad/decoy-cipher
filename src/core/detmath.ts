/**
 * Deterministic math. `Math.exp` is allowed to differ in the last bit between
 * JS engines (V8 / SpiderMonkey / JSC), which could shift an arithmetic-coding
 * boundary and break decryption on someone else's browser. Everything here uses
 * only + - * / and Math.round/floor, which IEEE-754 guarantees are identical
 * everywhere.
 */
const LN2 = 0.6931471805599453;

export function detExp(x: number): number {
  if (x < -700) return 0;
  const k = Math.round(x / LN2);
  const r = x - k * LN2; // |r| <= ~0.35
  // Taylor series, fixed number of terms
  let term = 1;
  let sum = 1;
  for (let n = 1; n <= 14; n++) {
    term = (term * r) / n;
    sum += term;
  }
  let scale = 1;
  const steps = Math.abs(k);
  const base = k < 0 ? 0.5 : 2;
  for (let i = 0; i < steps; i++) scale *= base;
  return sum * scale;
}
