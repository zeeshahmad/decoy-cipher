/**
 * Integer arithmetic coder used "backwards" for steganography.
 *
 * Normal arithmetic coding turns symbols into bits. Here we turn *bits into
 * symbols*: the (random-looking) ciphertext bits pick which token the language
 * model emits. The reverse direction recovers the bits from the tokens.
 *
 * Classic Witten-Neal-Cleary 32-bit coder, using plain Numbers (all
 * intermediate products stay below 2^53, so no BigInt and no bit-ops sign traps).
 */

export const TOTAL = 1 << 16; // total frequency of every distribution
const BITS = 32;
const FULL = 2 ** BITS;
const HALF = FULL / 2;
const QUARTER = FULL / 4;

export interface Dist {
  /** frequencies, each >= 1, summing to exactly TOTAL */
  freqs: number[];
}

class Core {
  low = 0;
  high = FULL - 1;
  /** bits that are now fixed for every number inside the interval */
  out: number[] = [];
  private pending = 0;

  protected emit(bit: number) {
    this.out.push(bit);
    for (; this.pending > 0; this.pending--) this.out.push(1 - bit);
  }

  /** Narrow to the symbol's sub-interval and renormalise. */
  protected narrow(cumLow: number, cumHigh: number, onShift: () => void) {
    const range = this.high - this.low + 1;
    this.high = this.low + Math.floor((range * cumHigh) / TOTAL) - 1;
    this.low = this.low + Math.floor((range * cumLow) / TOTAL);
    for (;;) {
      if (this.high < HALF) {
        this.emit(0);
      } else if (this.low >= HALF) {
        this.emit(1);
        this.low -= HALF;
        this.high -= HALF;
        this.shiftHalf();
      } else if (this.low >= QUARTER && this.high < 3 * QUARTER) {
        this.pending++;
        this.low -= QUARTER;
        this.high -= QUARTER;
        this.shiftQuarter();
      } else break;
      this.low *= 2;
      this.high = this.high * 2 + 1;
      onShift();
    }
  }
  protected shiftHalf() {}
  protected shiftQuarter() {}
}

function cumulative(freqs: number[]): number[] {
  const cum = new Array<number>(freqs.length + 1);
  cum[0] = 0;
  for (let i = 0; i < freqs.length; i++) cum[i + 1] = cum[i] + freqs[i];
  return cum;
}

/** bits -> symbol choices. */
export class BitsToSymbols extends Core {
  private code = 0;
  private pos = 0;
  // After the real bits run out we pad with pseudo-random bits. Zero padding is
  // a trap: a code value sitting exactly on a midpoint never resolves its bits.
  private pad = 0x9e3779b9;
  constructor(private bits: ArrayLike<number>) {
    super();
    for (let i = 0; i < BITS; i++) this.code = this.code * 2 + this.nextBit();
  }
  private nextBit() {
    if (this.pos < this.bits.length) return this.bits[this.pos++];
    this.pos++;
    this.pad ^= this.pad << 13;
    this.pad ^= this.pad >>> 17;
    this.pad ^= this.pad << 5;
    return (this.pad >>> 0) & 1;
  }
  protected shiftHalf() {
    this.code -= HALF;
  }
  protected shiftQuarter() {
    this.code -= QUARTER;
  }
  /** Number of leading bits that are already fully determined. */
  get determined() {
    return this.out.length;
  }
  /** Choose the symbol whose slot contains the secret number, and advance. */
  choose(dist: Dist): number {
    const cum = cumulative(dist.freqs);
    const range = this.high - this.low + 1;
    const value = Math.floor(((this.code - this.low + 1) * TOTAL - 1) / range);
    let i = 0;
    while (i < dist.freqs.length - 1 && cum[i + 1] <= value) i++;
    this.narrow(cum[i], cum[i + 1], () => {
      this.code = this.code * 2 + this.nextBit();
    });
    return i;
  }
}

/** symbol choices -> bits (the receiver's side). */
export class SymbolsToBits extends Core {
  get determined() {
    return this.out.length;
  }
  consume(dist: Dist, symbol: number) {
    const cum = cumulative(dist.freqs);
    this.narrow(cum[symbol], cum[symbol + 1], () => {});
  }
  bits(): number[] {
    return this.out;
  }
}
