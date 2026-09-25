import { describe, expect, it } from "vitest";
import { Fraction, gcd, lcm } from "./fraction.ts";

describe("Fraction", () => {
  it("keeps lowest terms with a positive denominator, so equal values have equal fields", () => {
    expect(new Fraction(2, 4)).toMatchObject({ n: 1, d: 2 });
    expect(new Fraction(3, -6)).toMatchObject({ n: -1, d: 2 });
    expect(new Fraction(0, 5).eq(Fraction.ZERO)).toBe(true);
  });

  it("parses what dump.ly writes", () => {
    expect(Fraction.parse("3/8").toString()).toBe("3/8");
    expect(Fraction.parse("-1/16").toString()).toBe("-1/16");
    expect(Fraction.parse("2").toString()).toBe("2");
    expect(() => Fraction.parse("0.375")).toThrow(/rational/);
  });

  it("does exact arithmetic — a triplet eighth is 1/12, and three make a quarter", () => {
    const t = new Fraction(1, 12);
    expect(t.add(t).add(t).eq(new Fraction(1, 4))).toBe(true);
    expect(new Fraction(3, 4).sub(new Fraction(1, 6)).toString()).toBe("7/12");
    expect(new Fraction(2, 3).mul(new Fraction(3, 8)).toString()).toBe("1/4");
    expect(new Fraction(1, 4).div(new Fraction(1, 12)).toString()).toBe("3");
  });

  it("compares", () => {
    const a = new Fraction(1, 3);
    const b = new Fraction(1, 2);
    expect(a.lt(b) && b.gt(a) && a.le(a) && a.ge(a)).toBe(true);
    expect(Fraction.min(a, b)).toBe(a);
    expect(Fraction.max(a, b)).toBe(b);
  });

  it("rejects a zero denominator and non-integers", () => {
    expect(() => new Fraction(1, 0)).toThrow();
    expect(() => new Fraction(0.5, 1)).toThrow();
  });

  it("gcd and lcm", () => {
    expect(gcd(12, 18)).toBe(6);
    expect(lcm(4, 6)).toBe(12);
  });
});
