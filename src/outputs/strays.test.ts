import { describe, it, expect } from "vitest";
import { Core } from "../core";
import { engraveBar } from "./engrave";
import { makeSteps } from "../steps";
import { ledgerPositions, strayGlyph, straysAt } from "./strays";
import type { Barline, RawNote } from "../types";

/* The model of a wrong note on the page: how it is spelled, which staff
   it is measured on, and whether it has to step aside. Where a page puts
   it is staff-bars.test.ts's and verovio.test.ts's. */

/** One bar of 4/4 in D major: D4 and C3 together, then F♯4. */
const bars: Barline[] = [{ at: 0, fifths: 2 }, 2];
const score = Core.makeScore([
  { pitch: 62, onset: 0, duration: 0.5, hand: "upper" },
  { pitch: 48, onset: 0, duration: 0.5, hand: "lower" },
  { pitch: 66, onset: 0.5, duration: 0.5, hand: "upper" },
] as RawNote[], bars);
const eb = engraveBar(score.notes, score.bars[0]);
const [first] = makeSteps(score, "both").steps;

describe("straysAt", () => {
  it("spells a stray in the bar's key and prints what the key does not say", () => {
    const [f] = straysAt(eb, 0, [65], first.attack); // F4 in D major
    expect(f.pos).toBe(3);
    expect(f.acc).toBe("n");
    const [fs] = straysAt(eb, 0, [66], first.attack);
    expect(fs.acc).toBe("");
  });

  it("measures a stray against the step's note nearest it, on that note's staff", () => {
    const [low, high] = straysAt(eb, 0, [50, 64], first.attack);
    expect(low.ref.pitch).toBe(48);
    expect(low.staff).toBe("bass");
    expect(high.ref.pitch).toBe(62);
    expect(high.staff).toBe("treble");
  });

  it("steps aside only when it would overprint one of the step's heads", () => {
    expect(straysAt(eb, 0, [64], first.attack)[0].crowded).toBe(true); // E4 beside D4
    expect(straysAt(eb, 0, [65], first.attack)[0].crowded).toBe(false); // F4, a third away
  });

  it("is nothing when the step strikes nothing to measure by", () => {
    expect(straysAt(eb, 0, [65], [])).toEqual([]);
  });
});

describe("ledgerPositions", () => {
  it("rules above and below each staff standing alone", () => {
    expect(ledgerPositions(14, "treble")).toEqual([12, 14]);
    expect(ledgerPositions(-1, "treble")).toEqual([0]); // B3 under the treble staff
    expect(ledgerPositions(0, "bass")).toEqual([0]); // middle C over the bass staff
    expect(ledgerPositions(-13, "bass")).toEqual([-12]);
    expect(ledgerPositions(6, "treble")).toEqual([]);
  });
});

describe("strayGlyph", () => {
  it("is a red head, with its accidental when it prints one", () => {
    expect(strayGlyph(10, 20, "", "")).toContain('fill="var(--wrong)"');
    expect(strayGlyph(10, 20, "", "")).not.toContain("<text");
    expect(strayGlyph(10, 20, "n", "")).toContain("♮");
  });
});
