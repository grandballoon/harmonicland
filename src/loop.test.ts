import { describe, it, expect } from "vitest";
import { Core } from "./core";
import { makeSteps } from "./steps";
import { landing, snapBar, stepFrom, withBar } from "./loop";
import type { RawNote } from "./types";

/* loop.ts decides where a loop's edges may sit and where an arrow key
   lands. Four steps a second apart, in a 4-second piece, is enough to see
   every rule — plus a spread chord for the landing rule. */

const n = (pitch: number, onset: number, duration = 0.5): RawNote => ({ pitch, onset, duration });
const piece = Core.makeScore([n(60, 0), n(62, 1), n(64, 2), n(65, 3, 1)]);
const { steps } = makeSteps(piece, "both");

describe("stepping without a loop", () => {
  it("walks forward and back one step at a time", () => {
    expect(stepFrom(steps, 0, 1, null)).toBe(1);
    expect(stepFrom(steps, 1, 1, null)).toBe(2);
    expect(stepFrom(steps, 2, -1, null)).toBe(1);
  });

  it("stops at the ends of the piece rather than wrapping", () => {
    expect(stepFrom(steps, 3, 1, null)).toBeNull();
    expect(stepFrom(steps, 0, -1, null)).toBeNull();
  });

  it("goes back to the step you are in when paused between two", () => {
    expect(stepFrom(steps, 1.4, -1, null)).toBe(1);
    expect(stepFrom(steps, 1.4, 1, null)).toBe(2);
  });

  it("has nowhere to go in an empty score", () => {
    expect(stepFrom([], 0, 1, null)).toBeNull();
  });
});

describe("stepping inside a loop", () => {
  const loop = { start: 1, end: 3 }; // steps at 1 and 2

  it("wraps from the last step to the first, and back again", () => {
    expect(stepFrom(steps, 2, 1, loop)).toBe(1);
    expect(stepFrom(steps, 1, -1, loop)).toBe(2);
  });

  it("does not treat the step AT the exclusive end as inside", () => {
    expect(stepFrom(steps, 1, 1, loop)).toBe(2);
    expect(stepFrom(steps, 2, 1, loop)).not.toBe(3);
  });

  it("enters the loop from outside it: forward at its first step, back at its last", () => {
    expect(stepFrom(steps, 0, 1, loop)).toBe(1);
    expect(stepFrom(steps, 3.5, 1, loop)).toBe(1);
    expect(stepFrom(steps, 3.5, -1, loop)).toBe(2);
    expect(stepFrom(steps, 0, -1, loop)).toBe(2);
  });

  it("goes nowhere when the loop holds no steps", () => {
    expect(stepFrom(steps, 0, 1, { start: 1.2, end: 1.8 })).toBeNull();
  });
});

describe("landing on a spread chord", () => {
  // a performance capture: one chord, its notes 10ms apart
  const spread = makeSteps(Core.makeScore([n(60, 1), n(64, 1.01), n(67, 1.02), n(72, 2)]), "both").steps;

  it("parks on the chord's last attack, so every note of it is sounding", () => {
    expect(landing(spread[0])).toBe(1.02);
    const t = stepFrom(spread, 0, 1, null)!;
    expect(Core.activeAt(Core.makeScore([n(60, 1), n(64, 1.01), n(67, 1.02)]), t)).toHaveLength(3);
  });

  it("steps back off a landed chord rather than onto itself", () => {
    expect(stepFrom(spread, 2, -1, null)).toBe(1.02);
    expect(stepFrom(spread, 1.02, -1, null)).toBeNull();
  });
});

describe("marking bars with [ and ]", () => {
  const BARS = 8;

  it("an edge set with no selection yet makes one against the other end of the piece", () => {
    expect(withBar(null, "start", 2, BARS)).toEqual({ from: 2, to: 7 });
    expect(withBar(null, "end", 2, BARS)).toEqual({ from: 0, to: 2 });
  });

  it("both edges on one bar select that bar alone", () => {
    expect(withBar({ from: 2, to: 5 }, "end", 2, BARS)).toEqual({ from: 2, to: 2 });
    expect(withBar({ from: 2, to: 5 }, "start", 5, BARS)).toEqual({ from: 5, to: 5 });
  });

  it("an edge marked past the other pushes the other back to its end of the piece", () => {
    expect(withBar({ from: 1, to: 2 }, "start", 4, BARS)).toEqual({ from: 4, to: 7 });
    expect(withBar({ from: 3, to: 5 }, "end", 1, BARS)).toEqual({ from: 0, to: 1 });
  });

  it("an edge that stays on its own side leaves the other alone", () => {
    expect(withBar({ from: 1, to: 5 }, "start", 3, BARS)).toEqual({ from: 3, to: 5 });
    expect(withBar({ from: 1, to: 5 }, "end", 3, BARS)).toEqual({ from: 1, to: 3 });
  });
});

describe("snapping a dragged edge to a barline", () => {
  // four one-second bars
  const bars = Core.makeScore([n(60, 0, 4)], [0, 1, 2, 3, 4]).bars;

  it("snaps a start to the nearest bar's start, and an end to the nearest bar's end", () => {
    expect(snapBar(bars, 1.3, "start", null)).toBe(1);
    expect(snapBar(bars, 1.7, "start", null)).toBe(2);
    expect(snapBar(bars, 1.3, "end", null)).toBe(0); // bar 0 ends at 1
    expect(snapBar(bars, 3.9, "end", null)).toBe(3);
  });

  it("never lets the loop shrink below one bar or cross the other edge", () => {
    expect(snapBar(bars, 3.9, "start", { from: 0, to: 1 })).toBe(1);
    expect(snapBar(bars, 0, "end", { from: 2, to: 3 })).toBe(2);
  });
});
