import { describe, it, expect } from "vitest";
import { FULL_SPAN, LOW, HIGH, spanOf, whitesIn } from "./pitch";

describe("a span of the keyboard", () => {
  it("is all 88 keys, 52 of them white, by default", () => {
    expect(FULL_SPAN).toEqual({ lo: LOW, hi: HIGH });
    expect(whitesIn(FULL_SPAN)).toHaveLength(52);
  });

  it("ends on white keys, rounding a black end outward", () => {
    expect(spanOf(60, 64)).toEqual({ lo: 60, hi: 64 }); // C4–E4
    expect(spanOf(61, 66)).toEqual({ lo: 60, hi: 67 }); // C♯4–F♯4 → C4–G4
  });

  it("pads by white keys beyond the notes, a black end's own white counting as one", () => {
    // E4–G4, three whites more each way: B3 C4 D4 | A4 B4 C5
    expect(spanOf(64, 67, 3)).toEqual({ lo: 59, hi: 72 });
    // C♯4–F♯4: C4 B3 A3 | G4 A4 B4
    expect(spanOf(61, 66, 3)).toEqual({ lo: 57, hi: 71 });
  });

  it("stops padding at the ends of the keyboard", () => {
    expect(spanOf(22, 108, 3)).toEqual({ lo: 21, hi: 108 });
  });
});
