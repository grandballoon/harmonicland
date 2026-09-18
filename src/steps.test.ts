import { describe, it, expect } from "vitest";
import { Core } from "./core";
import { GROUP_SEC, makeSteps, movesBetween, otherHand, spanOf, stepAt, stepSounding } from "./steps";
import type { Hand, RawNote, Score } from "./types";

/* steps.ts re-cuts a score along an axis nothing else in this program uses.
   Everything below is a property of that cut and of nothing else — no DOM,
   no clock, no live state — which is the whole reason it is a separate
   module from the cursor that walks it. */

const n = (pitch: number, onset: number, duration = 0.5, hand?: Hand): RawNote =>
  ({ pitch, onset, duration, ...(hand && { hand }) });

const scoreOf = (...raw: RawNote[]): Score => Core.makeScore(raw);

const pitches = (ns: readonly { pitch: number }[]): number[] =>
  ns.map((x) => x.pitch).sort((a, b) => a - b);

describe("onset grouping", () => {
  it("groups notes struck within the tolerance into one step", () => {
    const { steps } = makeSteps(scoreOf(n(60, 0), n(64, 0.01), n(67, 0.02)), "both");
    expect(steps).toHaveLength(1);
    expect(pitches(steps[0].attack)).toEqual([60, 64, 67]);
  });

  it("anchors the window on the group's FIRST onset, not the previous note", () => {
    // Each gap is exactly the tolerance, so chaining off the previous note
    // would swallow all three into one chord. Anchoring on the first does
    // not — which is what stops a dense run collapsing a bar at a time.
    const { steps } = makeSteps(
      scoreOf(n(60, 0), n(64, GROUP_SEC), n(67, GROUP_SEC * 2)),
      "both",
    );
    expect(steps.map((s) => pitches(s.attack))).toEqual([[60, 64], [67]]);
  });

  it("carries the group's first onset as the step's time", () => {
    const { steps } = makeSteps(scoreOf(n(60, 1.0), n(64, 1.02)), "both");
    expect(steps[0].at).toBe(1.0);
  });

  it("numbers steps by position, densely", () => {
    const { steps } = makeSteps(scoreOf(n(60, 0), n(62, 1), n(64, 2)), "both");
    expect(steps.map((s) => s.index)).toEqual([0, 1, 2]);
  });
});

describe("attack / sustain / release", () => {
  // the canonical shape: a left-hand whole note under four right-hand
  // eighths — the case a step model that only knows onsets gets wrong.
  const held = scoreOf(
    n(48, 0, 2.0, "lower"),
    n(60, 0, 0.5, "upper"),
    n(62, 0.5, 0.5, "upper"),
    n(64, 1.0, 0.5, "upper"),
    n(65, 1.5, 0.5, "upper"),
  );

  it("puts a note that begins here in attack, and one still ringing in sustain", () => {
    const { steps } = makeSteps(held, "both");
    expect(pitches(steps[0].attack)).toEqual([48, 60]);
    expect(steps[0].sustain).toEqual([]);
    expect(pitches(steps[1].attack)).toEqual([62]);
    expect(pitches(steps[1].sustain)).toEqual([48]); // the LH note, still down
  });

  it("keeps a sustained note in every step it spans, not just the next one", () => {
    const { steps } = makeSteps(held, "both");
    for (const s of steps.slice(1)) expect(pitches(s.sustain)).toContain(48);
  });

  it("lists what the previous step sounded and this one does not, as release", () => {
    const { steps } = makeSteps(held, "both");
    expect(pitches(steps[1].release)).toEqual([60]); // the eighth just played
    expect(steps[0].release).toEqual([]); // nothing precedes the first step
  });

  it("does not sustain a note that ends exactly on the step's onset", () => {
    // half-open intervals, matching Core.activeAt — a note ending at 0.5 is
    // not sounding at 0.5, or every release would be off by one step.
    const { steps } = makeSteps(scoreOf(n(60, 0, 0.5), n(62, 0.5, 0.5)), "both");
    expect(steps[1].sustain).toEqual([]);
  });
});

describe("hand filtering", () => {
  const both = scoreOf(
    n(48, 0, 1, "lower"), n(60, 0, 1, "upper"),
    n(50, 1, 1, "lower"), n(62, 1, 1, "upper"),
  );

  it("cuts steps from only the practised hand", () => {
    expect(makeSteps(both, "upper").steps.map((s) => pitches(s.attack)))
      .toEqual([[60], [62]]);
    expect(makeSteps(both, "lower").steps.map((s) => pitches(s.attack)))
      .toEqual([[48], [50]]);
  });

  it("takes everything when hands are together", () => {
    expect(makeSteps(both, "both").steps.map((s) => pitches(s.attack)))
      .toEqual([[48, 60], [50, 62]]);
  });

  it("carries the filter in the value", () => {
    expect(makeSteps(both, "lower").hand).toBe("lower");
  });

  it("gives the other hand exactly the complement", () => {
    expect(pitches(otherHand(both, "upper"))).toEqual([48, 50]);
    expect(otherHand(both, "both")).toEqual([]);
  });

  it("treats a note with NO hand as belonging to every filter", () => {
    // LilyPond emits no `hand`. The honest reading of "practise the right
    // hand" on a score with no hands is "practise all of it" — the same
    // standard the hands COLORING toggle already sets.
    const lily = scoreOf(n(60, 0), n(62, 1));
    for (const h of ["both", "upper", "lower"] as const)
      expect(makeSteps(lily, h).steps.map((s) => pitches(s.attack))).toEqual([[60], [62]]);
    expect(otherHand(lily, "upper")).toEqual([]);
  });
});

describe("move pairing", () => {
  const stepsOf = (score: Score, hand: "both" | "upper" | "lower" = "both") =>
    makeSteps(score, hand).steps;
  const arrows = (score: Score) => {
    const s = stepsOf(score);
    return movesBetween(s[0], s[1]).map((m) => [m.from, m.to]);
  };

  it("pairs neighbouring voices in order", () => {
    expect(arrows(scoreOf(n(60, 0), n(64, 0), n(62, 1), n(65, 1))))
      .toEqual([[60, 62], [64, 65]]);
  });

  it("never crosses — the cheap matching is also the followable one", () => {
    // crossing (60->70, 72->62) costs 20; the non-crossing pairing costs 4.
    expect(arrows(scoreOf(n(60, 0), n(72, 0), n(62, 1), n(70, 1))))
      .toEqual([[60, 62], [72, 70]]);
  });

  it("leaves an unpartnered attack without an arrow rather than inventing one", () => {
    const moves = arrows(scoreOf(n(60, 0), n(62, 1), n(67, 1)));
    expect(moves).toEqual([[60, 62]]); // 67 is highlighted, but nothing moves to it
  });

  it("counts a sustained note as a key that can move from", () => {
    // the LH note is sounding but was not struck in step 0; a finger is on
    // it, so it is a legitimate arrow source.
    const s = stepsOf(scoreOf(n(48, 0, 2), n(60, 0, 0.5), n(50, 0.5, 0.5)));
    expect(movesBetween(s[0], s[1]).map((m) => [m.from, m.to])).toEqual([[48, 50]]);
  });

  it("matches each hand separately, so no arrow crosses the hands", () => {
    const score = scoreOf(
      n(48, 0, 1, "lower"), n(72, 0, 1, "upper"),
      n(50, 1, 1, "lower"), n(74, 1, 1, "upper"),
    );
    const s = stepsOf(score);
    expect(movesBetween(s[0], s[1]).map((m) => [m.from, m.to, m.hand]))
      .toEqual([[48, 50, "lower"], [72, 74, "upper"]]);
  });

  it("is deterministic — the same pair of steps gives the same arrows", () => {
    const score = scoreOf(n(60, 0), n(64, 0), n(67, 0), n(59, 1), n(62, 1), n(67, 1));
    const s = stepsOf(score);
    expect(movesBetween(s[0], s[1])).toEqual(movesBetween(s[0], s[1]));
  });

  it("draws one arrow per KEY, not per voice, when a pitch is doubled", () => {
    const score = scoreOf(n(60, 0, 1, "upper"), n(60, 0, 1, "upper"), n(62, 1, 1, "upper"));
    const s = stepsOf(score);
    expect(movesBetween(s[0], s[1])).toHaveLength(1);
  });
});

describe("stepAt", () => {
  const { steps } = makeSteps(scoreOf(n(60, 0), n(62, 1), n(64, 2)), "both");

  it("lands on the step at or after a time", () => {
    expect(stepAt(steps, 0)).toBe(0);
    expect(stepAt(steps, 0.5)).toBe(1);
    expect(stepAt(steps, 1)).toBe(1);
  });

  it("returns the finished index past the last step", () => {
    expect(stepAt(steps, 99)).toBe(steps.length);
  });
});

describe("stepSounding", () => {
  // a C held for two beats under a D then, after a rest, an E
  const { steps } = makeSteps(scoreOf(n(48, 0, 2), n(62, 0), n(64, 1, 0.5)), "both");

  it("is the last step begun at or before t, cut to what sounds at t", () => {
    expect(pitches(stepSounding(steps, 0)!.attack)).toEqual([48, 62]);
    // the D has stopped; the C still sounds, still struck in this step
    expect(pitches(stepSounding(steps, 0.7)!.attack)).toEqual([48]);
    const e = stepSounding(steps, 1.2)!;
    expect(e.index).toBe(1);
    expect(pitches(e.attack)).toEqual([64]);
    expect(pitches(e.sustain)).toEqual([48]);
  });

  it("is null before the first step, in silence, and past the end", () => {
    const { steps: gap } = makeSteps(scoreOf(n(60, 1), n(62, 3)), "both");
    expect(stepSounding(gap, 0.5)).toBeNull();
    expect(stepSounding(gap, 2)).toBeNull();
    expect(stepSounding(gap, 99)).toBeNull();
    expect(stepSounding([], 0)).toBeNull();
  });
});

describe("an empty score", () => {
  it("cuts into no steps at all", () => {
    expect(makeSteps(Core.makeScore([]), "both").steps).toEqual([]);
  });
});

describe("spanOf", () => {
  // eight steps, one every half second, in four bars of a second each
  const score = Core.makeScore(
    Array.from({ length: 8 }, (_, i) => n(60 + i, i * 0.5, 0.4)),
    [0, 1, 2, 3, 4],
  );
  const { steps } = makeSteps(score, "both");

  it("names the steps beginning inside the bars, last exclusive", () => {
    expect(spanOf(steps, score.bars, { from: 0, to: 0 })).toEqual({ first: 0, last: 2 });
    expect(spanOf(steps, score.bars, { from: 1, to: 1 })).toEqual({ first: 2, last: 4 });
    expect(spanOf(steps, score.bars, { from: 1, to: 3 })).toEqual({ first: 2, last: 8 });
  });

  it("lands on the same step a scrub to the bar's start would", () => {
    const { first } = spanOf(steps, score.bars, { from: 2, to: 2 });
    expect(first).toBe(stepAt(steps, score.bars[2].start));
  });

  it("is empty, first === last, for a bar with nothing in it", () => {
    // a note in bar 0 and one in bar 3; bars 1 and 2 are silent
    const sparse = Core.makeScore([n(60, 0), n(62, 3)], [0, 1, 2, 3, 4]);
    const cut = makeSteps(sparse, "both").steps;
    expect(spanOf(cut, sparse.bars, { from: 1, to: 1 })).toEqual({ first: 1, last: 1 });
    expect(spanOf(cut, sparse.bars, { from: 1, to: 2 })).toEqual({ first: 1, last: 1 });
  });

  it("clamps bar indices to the bars that exist", () => {
    expect(spanOf(steps, score.bars, { from: 3, to: 9 })).toEqual({ first: 6, last: 8 });
    expect(spanOf(steps, score.bars, { from: -2, to: 0 })).toEqual({ first: 0, last: 2 });
  });
});
