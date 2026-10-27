import { describe, it, expect } from "vitest";
import { Alignment } from "./alignment";
import { Core } from "./core";
import { StepModel } from "./steps";

/* Four 4/4 bars of two seconds each, a note on every beat, a pedal over
   bar 2, and a last note held to the end. */
const BAR = 2;
const score = Core.makeScore(
  Array.from({ length: 16 }, (_, i) => ({ pitch: 60 + (i % 5), onset: i * 0.5, duration: 0.5 })),
  [0, 2, 4, 6, 8],
  [{ start: 2, end: 4 }],
);

describe("clean", () => {
  it("puts anchors in barline order", () => {
    expect(Alignment.clean([{ bar: 2, at: 9 }, { bar: 0, at: 1 }], 4)).toEqual([{ bar: 0, at: 1 }, { bar: 2, at: 9 }]);
  });

  it("drops a barline that does not exist, and a time that is not one", () => {
    const junk = [{ bar: -1, at: 1 }, { bar: 5, at: 9 }, { bar: 1.5, at: 2 }, { bar: 1, at: NaN }, { bar: 2, at: -1 }];
    expect(Alignment.clean(junk, 4)).toEqual([]);
  });

  it("keeps the barline that closes the piece", () => {
    expect(Alignment.clean([{ bar: 4, at: 12 }], 4)).toEqual([{ bar: 4, at: 12 }]);
  });

  it("drops a barline heard no later than the one before it", () => {
    expect(Alignment.clean([{ bar: 0, at: 5 }, { bar: 1, at: 5 }, { bar: 2, at: 3 }, { bar: 3, at: 8 }], 4))
      .toEqual([{ bar: 0, at: 5 }, { bar: 3, at: 8 }]);
  });
});

describe("set", () => {
  const placed = [{ bar: 0, at: 1 }, { bar: 1, at: 3 }, { bar: 2, at: 5 }];

  it("replaces the anchor on the same barline", () => {
    expect(Alignment.set(placed, { bar: 1, at: 3.4 })).toEqual([{ bar: 0, at: 1 }, { bar: 1, at: 3.4 }, { bar: 2, at: 5 }]);
  });

  it("adds a barline between two others", () => {
    expect(Alignment.set([placed[0], placed[2]], placed[1])).toEqual(placed);
  });

  it("drops the anchors a new one contradicts", () => {
    // bar 1 now heard after where bar 2 was said to be
    expect(Alignment.set(placed, { bar: 1, at: 6 })).toEqual([{ bar: 0, at: 1 }, { bar: 1, at: 6 }]);
    // and bar 2 heard before where bar 1 was
    expect(Alignment.set(placed, { bar: 2, at: 2 })).toEqual([{ bar: 0, at: 1 }, { bar: 2, at: 2 }]);
  });
});

describe("barlines", () => {
  it("are the score's own when nothing is anchored", () => {
    expect(Alignment.barlines(score, [])).toEqual([0, 2, 4, 6, 8]);
  });

  it("with one anchor, keep the score's tempo from where it says", () => {
    expect(Alignment.barlines(score, [{ bar: 1, at: 10 }])).toEqual([8, 10, 12, 14, 16]);
  });

  it("share the time between two anchors as the score does", () => {
    // bars 1 and 2 take nine seconds between them, where the score gave four
    expect(Alignment.barlines(score, [{ bar: 1, at: 3 }, { bar: 3, at: 12 }])[2]).toBeCloseTo(7.5);
  });

  it("keep an uneven score's proportions between anchors", () => {
    // a one-second bar then a three-second one, anchored only at the ends
    const uneven = Core.makeScore([{ pitch: 60, onset: 0, duration: 4 }], [0, 1, 4]);
    expect(Alignment.barlines(uneven, [{ bar: 0, at: 0 }, { bar: 2, at: 8 }])).toEqual([0, 2, 8]);
  });

  it("carry on at the nearest anchored pace outside the anchors", () => {
    // twice as slow between barlines 1 and 2, so twice as slow all through
    expect(Alignment.barlines(score, [{ bar: 1, at: 5 }, { bar: 2, at: 9 }])).toEqual([1, 5, 9, 13, 17]);
  });

  it("can put the opening before the recording starts", () => {
    expect(Alignment.barlines(score, [{ bar: 2, at: 1 }])[0]).toBe(-3);
  });
});

describe("retime", () => {
  const anchors = [{ bar: 0, at: 10 }, { bar: 1, at: 11 }, { bar: 2, at: 15 }, { bar: 4, at: 19 }];
  const { score: timed, lead } = Alignment.retime(score, anchors);

  it("is the score itself when nothing is anchored", () => {
    expect(Alignment.retime(score, [])).toEqual({ score, lead: 0 });
    expect(Alignment.retime(score, []).score).toBe(score);
  });

  it("begins the score at 0 and says where the recording has that", () => {
    expect(lead).toBe(10);
    expect(timed.bars[0].start).toBe(0);
    expect(timed.notes[0].onset).toBe(0);
  });

  it("puts every barline where it was heard, less the lead", () => {
    expect(timed.bars.map((b) => b.start)).toEqual([0, 1, 5, 7]);
    expect(timed.bars.map((b) => b.end)).toEqual([1, 5, 7, 9]);
    expect(timed.duration).toBe(9);
  });

  it("spreads a bar's notes evenly over the bar as heard", () => {
    // bar 2 was two seconds and is four: its beats are a second apart
    expect(timed.notes.slice(4, 8).map((n) => n.onset)).toEqual([1, 2, 3, 4]);
    expect(timed.notes[4].duration).toBe(1);
  });

  it("keeps each note's identity, pitch and order", () => {
    expect(timed.notes.map((n) => [n.id, n.pitch])).toEqual(score.notes.map((n) => [n.id, n.pitch]));
    for (let i = 1; i < timed.notes.length; i++)
      expect(timed.notes[i].onset).toBeGreaterThanOrEqual(timed.notes[i - 1].onset);
  });

  it("keeps the meter, so a beat is still an even share of its bar", () => {
    expect(timed.bars.map((b) => [b.beats, b.unit])).toEqual(score.bars.map((b) => [b.beats, b.unit]));
    // the third beat of bar 2 is still where its third note is
    expect(Core.timeOfBeat(timed.bars[1], 2)).toBe(timed.notes[6].onset);
  });

  it("moves the pedal with the bar it is in", () => {
    expect(timed.pedal).toEqual([{ start: 1, end: 5 }]);
  });

  it("leaves the same steps to walk, at their new times", () => {
    const before = StepModel.makeSteps(score, "both").steps;
    const after = StepModel.makeSteps(timed, "both").steps;
    expect(after.length).toBe(before.length);
  });

  it("does not touch the score it was given", () => {
    expect(score.bars[1].start).toBe(BAR);
    expect(score.notes[4].onset).toBe(2);
  });
});

describe("parse", () => {
  it("reads anchors back and drops what is not one", () => {
    expect(Alignment.parse([{ bar: 1, at: 2 }, null, { bar: "1", at: 2 }, 7])).toEqual([{ bar: 1, at: 2 }]);
    expect(Alignment.parse("nonsense")).toEqual([]);
  });
});
