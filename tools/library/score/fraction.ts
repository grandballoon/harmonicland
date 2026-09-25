/* ====================================================================
   FRACTION — exact rational time.

   Score time is kept as exact fractions of a whole note, the way
   LilyPond keeps it, so a triplet eighth is 1/12 and never 0.0833….
   Floating point would make "does this note start on the barline?"
   a tolerance question; with fractions it is an equality.
   Values are immutable and always in lowest terms with a positive
   denominator, so equal fractions have equal fields.
   ==================================================================== */

export class Fraction {
  readonly n: number;
  readonly d: number;

  constructor(n: number, d = 1) {
    if (!Number.isInteger(n) || !Number.isInteger(d) || d === 0) {
      throw new Error(`bad fraction ${n}/${d}`);
    }
    const g = gcd(Math.abs(n), Math.abs(d)) || 1;
    const sign = d < 0 ? -1 : 1;
    this.n = (sign * n) / g;
    this.d = (sign * d) / g;
  }

  /** Parses "3/8", "-1/16", or "2" — the forms dump.ly writes. */
  static parse(s: string): Fraction {
    const m = /^(-?\d+)(?:\/(\d+))?$/.exec(s.trim());
    if (!m) throw new Error(`not a rational: ${JSON.stringify(s)}`);
    return new Fraction(Number(m[1]), m[2] ? Number(m[2]) : 1);
  }

  static readonly ZERO = new Fraction(0);

  add(o: Fraction): Fraction {
    return new Fraction(this.n * o.d + o.n * this.d, this.d * o.d);
  }
  sub(o: Fraction): Fraction {
    return new Fraction(this.n * o.d - o.n * this.d, this.d * o.d);
  }
  mul(o: Fraction): Fraction {
    return new Fraction(this.n * o.n, this.d * o.d);
  }
  div(o: Fraction): Fraction {
    return new Fraction(this.n * o.d, this.d * o.n);
  }
  cmp(o: Fraction): number {
    return this.n * o.d - o.n * this.d;
  }
  eq(o: Fraction): boolean {
    return this.n === o.n && this.d === o.d;
  }
  lt(o: Fraction): boolean {
    return this.cmp(o) < 0;
  }
  le(o: Fraction): boolean {
    return this.cmp(o) <= 0;
  }
  gt(o: Fraction): boolean {
    return this.cmp(o) > 0;
  }
  ge(o: Fraction): boolean {
    return this.cmp(o) >= 0;
  }
  isZero(): boolean {
    return this.n === 0;
  }
  toNumber(): number {
    return this.n / this.d;
  }
  toString(): string {
    return this.d === 1 ? `${this.n}` : `${this.n}/${this.d}`;
  }

  static min(a: Fraction, b: Fraction): Fraction {
    return a.le(b) ? a : b;
  }
  static max(a: Fraction, b: Fraction): Fraction {
    return a.ge(b) ? a : b;
  }
}

export function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

export function lcm(a: number, b: number): number {
  return (a / gcd(a, b)) * b;
}
