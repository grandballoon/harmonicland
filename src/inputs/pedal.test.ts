import { describe, it, expect } from "vitest";
import { Core } from "../core";
import { pedalRanges } from "./pedal";

describe("pedalRanges", () => {
  it("pairs downs with ups, in time order whatever order they were met", () => {
    expect(pedalRanges([
      { at: 3, down: true }, { at: 4, down: false },
      { at: 0, down: true }, { at: 1, down: false },
    ])).toEqual([{ start: 0, end: 1 }, { start: 3, end: 4 }]);
  });

  it("keeps a change — up and down at one instant — as two ranges that touch", () => {
    expect(pedalRanges([
      { at: 0, down: true }, { at: 2, down: false }, { at: 2, down: true }, { at: 4, down: false },
    ])).toEqual([{ start: 0, end: 2 }, { start: 2, end: 4 }]);
  });

  it("ignores a down while down and an up while up", () => {
    expect(pedalRanges([
      { at: 0, down: false }, { at: 1, down: true }, { at: 2, down: true }, { at: 3, down: false }, { at: 5, down: false },
    ])).toEqual([{ start: 1, end: 3 }]);
  });

  it("holds a pedal never lifted to the end of the piece", () => {
    const score = Core.makeScore([{ pitch: 60, onset: 0, duration: 4 }], [], pedalRanges([{ at: 1, down: true }]));
    expect(score.pedal).toEqual([{ start: 1, end: 4 }]);
  });
});

describe("Score.pedal", () => {
  const score = (pedal: { start: number; end: number }[]) => Core.makeScore([{ pitch: 60, onset: 0, duration: 10 }], [], pedal);

  it("is empty when the source says nothing", () => {
    expect(Core.makeScore([{ pitch: 60, onset: 0, duration: 1 }]).pedal).toEqual([]);
  });

  it("is sorted, clamped to the piece, with the empty dropped", () => {
    expect(score([{ start: 8, end: Infinity }, { start: -1, end: 2 }, { start: 5, end: 5 }]).pedal)
      .toEqual([{ start: 0, end: 2 }, { start: 8, end: 10 }]);
  });

  it("lasts until the pedal lets the last notes go", () => {
    const s = score([{ start: 9, end: 12 }]);
    expect(s.duration).toBe(12);
    expect(s.pedal).toEqual([{ start: 9, end: 12 }]);
    expect(s.bars[s.bars.length - 1].end).toBeGreaterThanOrEqual(12);
    // a pedal pressed only after the last note sustains nothing
    expect(score([{ start: 10, end: 14 }]).duration).toBe(10);
  });

  it("joins ranges that overlap, but not ranges that touch", () => {
    expect(score([{ start: 0, end: 3 }, { start: 2, end: 4 }, { start: 4, end: 6 }]).pedal)
      .toEqual([{ start: 0, end: 4 }, { start: 4, end: 6 }]);
  });
});
