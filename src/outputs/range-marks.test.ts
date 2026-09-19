import { describe, it, expect } from "vitest";
import { RangeMarks, type MarkBar } from "./range-marks";
import { StaffScore } from "./staff-score";
import { Core } from "../core";
import type { Bar, RawNote } from "../types";

/* The isolated range's panel and grips, and the two hit-tests a drag asks.
   Two bars of 4/4, a second each, placed 100 units wide with a struck
   column on every beat at 10, 35, 60, 85 — enough to see every rule. */

const bar = (index: number): Bar => ({ index, start: index, end: index + 1, beats: 4, unit: 4, fifths: 0 });
const line: MarkBar[] = [0, 1].map((i) => ({
  bar: bar(i), x0: i * 100, x1: i * 100 + 100,
  stops: [0, 1, 2, 3].map((q) => ({ q, x: i * 100 + 10 + 25 * q })),
}));

describe("the panel", () => {
  it("spans whole bars from barline to barline", () => {
    expect(RangeMarks.spanOnLine(line, { from: 0, to: 1 })).toEqual({ xa: 0, xb: 200, start: true, end: true });
  });

  it("ends a trim midway between the last column out and the first in, clear of the heads", () => {
    // from beat 3 of bar 1 (column at 60) up to beat 2 of bar 2 (column at 135)
    expect(RangeMarks.spanOnLine(line, { from: 0, fromBeat: 2, to: 1, toBeat: 1 }))
      .toEqual({ xa: 47.5, xb: 122.5, start: true, end: true });
  });

  it("puts a grip only where the range really begins and ends", () => {
    const first = RangeMarks.spanOnLine(line.slice(0, 1), { from: 0, to: 1 });
    expect(first).toMatchObject({ start: true, end: false });
    expect(RangeMarks.gripsMarkup(line.slice(0, 1), { from: 0, to: 1 }, 0, 100).match(/<rect/g)).toHaveLength(1);
    expect(RangeMarks.gripsMarkup(line, { from: 0, to: 1 }, 0, 100).match(/<rect/g)).toHaveLength(2);
  });
});

describe("taking hold of a grip", () => {
  it("finds the grip within reach, and nothing between them", () => {
    const r = { from: 0, fromBeat: 2, to: 1, toBeat: 1 };
    expect(RangeMarks.gripAt(line, r, 50)).toBe("start");
    expect(RangeMarks.gripAt(line, r, 120)).toBe("end");
    expect(RangeMarks.gripAt(line, r, 85)).toBeNull();
  });
});

describe("dragging a grip", () => {
  it("answers with the time of the nearest place an end can sit", () => {
    expect(RangeMarks.timeAt(line, 48)).toBe(0.5); // the gap before beat 3
    expect(RangeMarks.timeAt(line, 3)).toBe(0); // the opening barline
    expect(RangeMarks.timeAt(line, 199)).toBe(2); // the closing one
    expect(RangeMarks.timeAt(line, 123)).toBe(1.25);
  });

  it("is null on a line with no bars", () => {
    expect(RangeMarks.timeAt([], 10)).toBeNull();
  });
});

describe("on the whole score's sheets", () => {
  // two bars of four quarter notes each, a second a bar
  const notes: RawNote[] = Array.from({ length: 8 }, (_, i) => ({ pitch: 60 + i, onset: i / 4, duration: 0.25 }));
  const score = Core.makeScore(notes, [0, 1, 2]);
  const W = 1000;
  const L = StaffScore.layout(W, score, "both", true);
  const sys = L.sheets[0].systems[0];
  const k = L.k;
  const toX = (sx: number) => L.x + sx * k;
  const y = L.sheets[0].top + (sys.y + sys.h / 2) * k;

  it("hit-tests the grips it draws, and drags to beats", () => {
    const r = { from: 0, fromBeat: 1, to: 1 };
    const span = RangeMarks.spanOnLine(sys.bars, r)!;
    expect(StaffScore.gripAt(W, score, "both", true, r, toX(span.xa), y)).toBe("start");
    expect(StaffScore.gripAt(W, score, "both", true, r, toX(span.xb), y)).toBe("end");
    expect(StaffScore.timeAt(W, score, "both", true, toX(span.xa), y)).toBeCloseTo(0.25);
  });
});
