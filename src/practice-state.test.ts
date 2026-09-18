import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// PracticeState reaches the world only through LiveKeys, and LiveKeys
// reaches it only through the two sinks. Stub those and the whole feature
// runs headless — no AudioContext, no rAF, no DOM.
vi.mock("./outputs/audio", () => ({
  AudioOut: { liveOn: () => {}, liveOff: () => {} },
}));
vi.mock("./outputs/midi-out", () => ({
  MidiOut: { liveOn: () => {}, liveOff: () => {} },
}));

import { Core } from "./core";
import { LiveKeys, type Voice } from "./live-keys";
import { PracticeState } from "./practice-state";
import { realize, changeOf, homeNumeral } from "./harmony/progression";
import { progressionById } from "./harmony/repertoire";
import type { Hand, RawNote, Score } from "./types";

const n = (pitch: number, onset: number, duration = 0.5, hand?: Hand): RawNote =>
  ({ pitch, onset, duration, ...(hand && { hand }) });
const scoreOf = (...raw: RawNote[]): Score => Core.makeScore(raw);

// the learner's fingers. Keyed by pitch, so the tests read like playing.
const fingers = new Map<number, Voice>();
const down = (...ps: number[]): void => {
  for (const p of ps) fingers.set(p, LiveKeys.press(p));
};
const up = (...ps: number[]): void => {
  for (const p of ps) {
    const v = fingers.get(p);
    if (v) { LiveKeys.release(v); fingers.delete(p); }
  }
};

let sought: number[] = [];
const seek = (t: number): void => { sought.push(t); };

const start = (score: Score): void => {
  sought = [];
  PracticeState.begin(score, seek);
};

const at = () => PracticeState.snapshot().index;
const set = (s: ReadonlySet<number>) => [...s].sort((a, b) => a - b);

beforeEach(() => {
  PracticeState.end();
  PracticeState.setHand("both");
  PracticeState.setShowOther(true);
  PracticeState.setPlayOther(false); // most tests grade the learner alone
  LiveKeys.releaseAll();
  fingers.clear();
});

/* ------------------------------------------------------------------ */
describe("the advance rule", () => {
  // C-E-G, then D-F-A: two chords, so "all down at once" has something to
  // be true of.
  const twoChords = scoreOf(
    n(60, 0), n(64, 0), n(67, 0),
    n(62, 1), n(65, 1), n(69, 1),
  );

  it("lets the learner build a chord up one finger at a time", () => {
    start(twoChords);
    down(60); expect(at()).toBe(0);
    down(64); expect(at()).toBe(0);
    down(67); expect(at()).toBe(1); // completes on the last one
  });

  it("does not advance while a note struck earlier has been let go", () => {
    start(twoChords);
    down(60);
    up(60);       // ...changed my mind
    down(64, 67); // all three struck, but only two are down
    expect(at()).toBe(0);
    down(60);     // now they are
    expect(at()).toBe(1);
  });

  it("requires a FRESH strike, so a chord held through does not play itself twice", () => {
    const twice = scoreOf(n(60, 0), n(64, 0), n(60, 1), n(64, 1));
    start(twice);
    down(60, 64);
    expect(at()).toBe(1);
    // still holding exactly the right notes — and that is not playing them
    expect(at()).toBe(1);
    up(60, 64);
    down(60, 64);
    expect(at()).toBe(2);
  });

  it("does NOT call the key you just correctly played a wrong note", () => {
    // The bug this replaces: a step completes on the press, the cursor
    // advances, and the key still under your finger becomes "a key this
    // step never asked for" — so every correct note flashed red until you
    // lifted. Playing a note right is not a mistake.
    const melody = scoreOf(n(60, 0, 0.5), n(62, 0.5, 0.5), n(64, 1.0, 0.5));
    start(melody);
    down(60); // correct, and the finger stays down
    const s = PracticeState.snapshot();
    expect(s.index).toBe(1);
    expect(set(s.wrong)).toEqual([]); // NOT a mistake
    expect(set(s.stale)).toEqual([60]); // just a finger yet to lift
  });

  it("gives that grace exactly one step, then calls it wrong", () => {
    // One step is long enough to lift a finger. A key still down after a
    // whole further step is honestly a note you are playing that the music
    // does not contain.
    const melody = scoreOf(n(60, 0, 0.5), n(62, 0.5, 0.5), n(64, 1.0, 0.5));
    start(melody);
    down(60);
    expect(set(PracticeState.snapshot().stale)).toEqual([60]);
    down(62); // advance again, still never lifting the 60
    expect(set(PracticeState.snapshot().stale)).toEqual([62]);
    expect(set(PracticeState.snapshot().wrong)).toEqual([60]);
  });

  it("keeps a stale finger out of wrong even when the note returns", () => {
    // C D C — the returning C is the NEXT step's target, so it also wears
    // the next-step bar. Red plus that bar on one key was the report.
    const there = scoreOf(n(60, 0, 0.5), n(62, 0.5, 0.5), n(60, 1.0, 0.5));
    start(there);
    down(60);
    const s = PracticeState.snapshot();
    expect(set(s.wrong)).toEqual([]);
    expect(s.next?.attack.map((x) => x.pitch)).toEqual([60]); // same key, next
  });

  it("reports extra notes but never lets them block", () => {
    start(twoChords);
    down(61); // a neighbouring key caught by a clumsy thumb
    expect(set(PracticeState.snapshot().wrong)).toEqual([61]);
    down(60, 64, 67);
    expect(at()).toBe(1); // the mistake did not dead-end the lesson
  });

  it("blocks on a sustain the learner let go of, and says which", () => {
    // LH whole note under two RH notes: the second RH note must be played
    // with the LH note still down.
    const score = scoreOf(n(48, 0, 2), n(60, 0, 0.5), n(62, 0.5, 0.5));
    start(score);
    down(48, 60);
    expect(at()).toBe(1);
    up(48); // let the bass go
    down(62);
    expect(at()).toBe(1);
    expect(set(PracticeState.snapshot().dropped)).toEqual([48]);
    down(48); // put it back
    expect(at()).toBe(2);
  });

  it("finishes the piece rather than running off the end", () => {
    start(twoChords);
    down(60, 64, 67);
    up(60, 64, 67);
    down(62, 65, 69);
    const s = PracticeState.snapshot();
    expect(s.index).toBe(s.total);
    expect(s.current).toBeNull();
    expect(s.next).toBeNull();
    down(60); // nothing left to complete
    expect(at()).toBe(2);
  });
});

/* ------------------------------------------------------------------ */
describe("what the snapshot says while a step is in progress", () => {
  const chord = scoreOf(n(60, 0), n(64, 0), n(67, 0), n(72, 1));

  it("counts an attack as pending until it is both struck and held", () => {
    start(chord);
    expect(set(PracticeState.snapshot().pending)).toEqual([60, 64, 67]);
    down(60);
    expect(set(PracticeState.snapshot().pending)).toEqual([64, 67]);
    up(60);
    expect(set(PracticeState.snapshot().pending)).toEqual([60, 64, 67]);
  });

  it("offers exactly one step of look-ahead", () => {
    start(chord);
    const s = PracticeState.snapshot();
    expect(s.current?.index).toBe(0);
    expect(s.next?.index).toBe(1);
  });

  it("draws no arrows on the first step, where nothing is down to move", () => {
    start(chord);
    expect(PracticeState.snapshot().moves).toEqual([]);
  });

  it("points its arrows at the step being played, not the one after it", () => {
    // an arrow starts under a finger. Having played C-E-G the cursor is on
    // C5, the hand is on C-E-G, and the one arrow runs G -> C5 — NOT the
    // transition after the one the learner is in the middle of.
    start(chord);
    down(60, 64, 67);
    const s = PracticeState.snapshot();
    expect(s.current?.index).toBe(1);
    expect(s.moves.map((m) => [m.from, m.to])).toEqual([[67, 72]]);
  });

  it("has no look-ahead on the last step", () => {
    start(chord);
    down(60, 64, 67);
    expect(PracticeState.snapshot().next).toBeNull();
  });

  it("drops its arrows once the piece is finished", () => {
    start(chord);
    down(60, 64, 67);
    up(60, 64, 67);
    down(72);
    const s = PracticeState.snapshot();
    expect(s.current).toBeNull();
    expect(s.moves).toEqual([]);
  });

  it("is inert before begin and after end", () => {
    const s = PracticeState.snapshot();
    expect(s.active).toBe(false);
    expect(s.current).toBeNull();
    expect(s.total).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* The acknowledgment of a correct note. It has to be recorded HERE and
   survive the cursor moving, because a step completes on the press that
   satisfies it: one frame later the key belongs to the next step and no
   downstream reader can still tell that anything went right. */
describe("a correct strike is remembered for a moment", () => {
  const melody = scoreOf(n(60, 0, 2), n(64, 1));
  const clock = () => vi.spyOn(performance, "now");

  afterEach(() => vi.restoreAllMocks());

  it("records the press that was owed, and only that one", () => {
    start(melody);
    down(60);
    expect([...PracticeState.snapshot().hit.keys()]).toEqual([60]);
  });

  it("survives the cursor advancing off the step it satisfied", () => {
    // this is the whole point: `down(60)` completes step 0, so by the time
    // anyone looks, 60 is the NEXT step's sustain. It must still read as
    // "just played correctly" rather than as "keep holding".
    start(melody);
    down(60);
    const s = PracticeState.snapshot();
    expect(s.current?.index).toBe(1);
    expect(set(new Set(s.current!.sustain.map((x) => x.pitch)))).toEqual([60]);
    expect(s.hit.has(60)).toBe(true);
  });

  it("does not acknowledge a note nothing asked for", () => {
    start(melody);
    down(61);
    expect(PracticeState.snapshot().hit.size).toBe(0);
    expect(set(PracticeState.snapshot().wrong)).toEqual([61]);
  });

  it("ages from 0 at the press to spent, then disappears", () => {
    const t = clock();
    t.mockReturnValue(1000);
    start(melody);
    down(60);
    expect(PracticeState.snapshot().hit.get(60)).toBe(0);
    t.mockReturnValue(1310);
    expect(PracticeState.snapshot().hit.get(60)).toBeCloseTo(0.5, 1);
    t.mockReturnValue(1000 + 620);
    expect(PracticeState.snapshot().hit.has(60)).toBe(false);
  });

  it("re-acknowledges the same key when it is struck again", () => {
    const t = clock();
    t.mockReturnValue(0);
    start(scoreOf(n(60, 0), n(60, 1)));
    down(60);
    t.mockReturnValue(500);
    up(60);
    down(60);
    expect(PracticeState.snapshot().hit.get(60)).toBe(0);
  });

  it("forgets everything when the lesson ends", () => {
    start(melody);
    down(60);
    PracticeState.end();
    expect(PracticeState.snapshot().hit.size).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
describe("the clock follows the cursor", () => {
  it("seeks to each step's own onset as it is reached", () => {
    start(scoreOf(n(60, 0), n(62, 1.5)));
    expect(sought).toEqual([0]);
    down(60);
    expect(sought).toEqual([0, 1.5]);
  });

  it("parks at the end of the score when the piece is finished", () => {
    const score = scoreOf(n(60, 0, 0.5));
    start(score);
    down(60);
    expect(sought[sought.length - 1]).toBe(score.duration);
  });

  it("lands a scrub on the step at or after the time given", () => {
    start(scoreOf(n(60, 0), n(62, 1), n(64, 2)));
    PracticeState.seekToTime(1.4);
    expect(at()).toBe(2);
    expect(sought[sought.length - 1]).toBe(2);
  });
});

/* ------------------------------------------------------------------ */
describe("the whole-score toggle", () => {
  it("is off until asked for, and outlives the lesson it was set in", () => {
    start(scoreOf(n(60, 0), n(62, 1)));
    expect(PracticeState.snapshot().wholeScore).toBe(false);
    PracticeState.setWholeScore(true);
    start(scoreOf(n(64, 0), n(65, 1)));
    expect(PracticeState.snapshot().wholeScore).toBe(true);
    PracticeState.setWholeScore(false);
  });

  it("changes nothing about where the cursor is", () => {
    start(scoreOf(n(60, 0), n(62, 1)));
    PracticeState.step(1);
    const before = PracticeState.snapshot();
    PracticeState.setWholeScore(true);
    const after = PracticeState.snapshot();
    expect(after.index).toBe(before.index);
    expect(after.current).toBe(before.current);
    PracticeState.setWholeScore(false);
  });
});

/* ------------------------------------------------------------------ */
describe("the arrow toggle", () => {
  it("is off until asked for, and outlives the lesson it was set in", () => {
    start(scoreOf(n(60, 0), n(62, 1)));
    expect(PracticeState.snapshot().showArrows).toBe(false);
    PracticeState.setShowArrows(true);
    expect(PracticeState.snapshot().showArrows).toBe(true);
    // a preference, not lesson state: a new score must not silently
    // switch it back — the same rule the other-hand toggles follow.
    start(scoreOf(n(64, 0), n(65, 1)));
    expect(PracticeState.snapshot().showArrows).toBe(true);
    PracticeState.setShowArrows(false);
  });

  it("leaves the moves themselves alone — hiding them is the view's job", () => {
    start(scoreOf(n(60, 0), n(62, 1)));
    down(60);
    const moves = PracticeState.snapshot().moves;
    expect(moves.length).toBeGreaterThan(0);
    PracticeState.setShowArrows(true);
    expect(PracticeState.snapshot().moves).toEqual(moves);
    PracticeState.setShowArrows(false);
  });
});

describe("the other hand", () => {
  const duet = scoreOf(
    n(48, 0, 2, "lower"),
    n(60, 0, 1, "upper"),
    n(62, 1, 1, "upper"),
  );

  it("is reported as a fact whether or not the view will show it", () => {
    PracticeState.setHand("upper");
    start(duet);
    expect(set(PracticeState.snapshot().other)).toEqual([48]);
    PracticeState.setShowOther(false);
    // still the truth — hiding it is the view's decision, and it needs to
    // know which keys to suppress precisely because they may be sounding.
    expect(set(PracticeState.snapshot().other)).toEqual([48]);
  });

  it("sounds through LiveKeys when auto-play is on, so every sink gets it", () => {
    PracticeState.setHand("upper");
    PracticeState.setPlayOther(true);
    start(duet);
    expect(LiveKeys.held().has(48)).toBe(true);
    PracticeState.setPlayOther(false);
    expect(LiveKeys.held().has(48)).toBe(false);
  });

  it("does not grade its own accompaniment as the learner playing", () => {
    // 48 is auto-pressed, so it is neither a wrong note nor a fresh strike.
    PracticeState.setHand("upper");
    PracticeState.setPlayOther(true);
    start(duet);
    expect(PracticeState.snapshot().wrong.size).toBe(0);
    expect(at()).toBe(0); // our own press did not advance anything
    down(60);
    expect(at()).toBe(1);
  });

  it("keeps a common tone down across a step rather than re-attacking it", () => {
    // the LH note spans both steps; the diff-reconcile must leave its voice
    // alone, exactly as PerfState.trigger does for a held chord tone.
    PracticeState.setHand("upper");
    PracticeState.setPlayOther(true);
    start(duet);
    const before = LiveKeys.held().has(48);
    down(60);
    expect(before && LiveKeys.held().has(48)).toBe(true);
  });

  it("puts back everything it is holding when the lesson ends", () => {
    PracticeState.setHand("upper");
    PracticeState.setPlayOther(true);
    start(duet);
    expect(LiveKeys.held().has(48)).toBe(true);
    PracticeState.end();
    expect(LiveKeys.held().has(48)).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
describe("switching hands mid-lesson", () => {
  const duet = scoreOf(
    n(48, 0, 1, "lower"), n(60, 0, 1, "upper"),
    n(50, 1, 1, "lower"), n(62, 1, 1, "upper"),
    n(52, 2, 1, "lower"), n(64, 2, 1, "upper"),
  );

  it("re-cuts the score and keeps your place", () => {
    start(duet);
    down(48, 60);
    up(48, 60);
    down(50, 62); // now on step 2, at t = 2
    expect(at()).toBe(2);
    PracticeState.setHand("upper");
    const s = PracticeState.snapshot();
    expect(s.hand).toBe("upper");
    expect(s.current?.at).toBe(2); // same moment, one hand's worth of it
    expect(s.current?.attack.map((x) => x.pitch)).toEqual([64]);
  });

  it("stops listening once the lesson ends", () => {
    start(duet);
    PracticeState.end();
    down(48, 60);
    expect(PracticeState.snapshot().active).toBe(false);
    expect(at()).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* A lesson may arrive with an ANALYSIS as well as notes — see
   harmony/progression.ts. The cursor carries it and reports where in it
   the learner is; it never consults it to decide anything, which is why
   a lesson without one behaves exactly as it always did. */
describe("a lesson that knows what its notes mean", () => {
  const iiVI = realize(progressionById("ii-V-I")!, { cycles: 2 });
  const score = Core.makeScore(iiVI.notes);

  const startWithChart = (): void => {
    sought = [];
    PracticeState.begin(score, seek, iiVI.chart);
  };

  it("reports no analysis for a score that came without one", () => {
    start(scoreOf(n(60, 0), n(62, 1)));
    const s = PracticeState.snapshot();
    expect(s.chart).toBeNull();
    expect(s.change).toBeNull();
    expect(s.nextChange).toBeNull();
  });

  it("names the chord the cursor is standing on", () => {
    startWithChart();
    const s = PracticeState.snapshot();
    expect(homeNumeral(s.chart!.home, changeOf(s.chart!, s.change!))).toBe("ii");
    expect(homeNumeral(s.chart!.home, changeOf(s.chart!, s.nextChange!))).toBe("V");
  });

  it("moves through the analysis as the learner plays", () => {
    startWithChart();
    // the ii chord: its bass root and its voicing, all struck together
    const step = PracticeState.snapshot().current!;
    down(...step.attack.map((x) => x.pitch));
    expect(PracticeState.snapshot().change!.index).toBe(1); // ...now on the V
  });

  it("loops back to the first change on the second pass, not off the end", () => {
    startWithChart();
    PracticeState.seekToTime(iiVI.chart.entries[3].at);
    expect(PracticeState.snapshot().change!.index).toBe(0);
  });

  it("has no current change once the piece is finished", () => {
    startWithChart();
    PracticeState.seekToTime(score.duration + 1);
    const s = PracticeState.snapshot();
    expect(s.current).toBeNull();
    expect(s.change).toBeNull();
    expect(s.chart).not.toBeNull(); // ...but the lesson still HAS an analysis
  });

  it("keeps the analysis across a hand change, which restarts the lesson", () => {
    // setHand re-cuts the score by calling begin again. The chart lives in
    // the session precisely so that path cannot silently drop it.
    startWithChart();
    PracticeState.setHand("lower");
    expect(PracticeState.snapshot().chart).not.toBeNull();
    PracticeState.setHand("both");
  });

  it("agrees with the step it is standing on about what time it is", () => {
    startWithChart();
    for (let i = 0; i < 4; i++) {
      const s = PracticeState.snapshot();
      const cur = s.current;
      if (!cur) break;
      expect(s.change!.at).toBeLessThanOrEqual(cur.at);
      expect(s.change!.until).toBeGreaterThan(cur.at);
      down(...cur.attack.map((x) => x.pitch));
      up(...cur.attack.map((x) => x.pitch));
    }
  });
});

/* ------------------------------------------------------------------ */
describe("isolating bars", () => {
  // eight notes, one every half second, in four bars of a second each —
  // so every bar holds exactly two steps and the arithmetic is readable.
  const eight = Core.makeScore(
    Array.from({ length: 8 }, (_, i) => n(60 + i, i * 0.5, 0.4)),
    [0, 1, 2, 3, 4],
  );
  const play = (...ps: number[]): void => {
    for (const p of ps) { down(p); up(p); }
  };
  const range = () => PracticeState.snapshot().range;

  it("starts every lesson on the whole piece", () => {
    start(eight);
    const s = PracticeState.snapshot();
    expect(s.range).toBeNull();
    expect(s.span).toEqual({ first: 0, last: 8 });
    expect(s.score).toBe(eight);
  });

  it("confines the cursor to the steps in the range, and seeks there", () => {
    start(eight);
    PracticeState.setRange({ from: 1, to: 1 });
    const s = PracticeState.snapshot();
    expect(s.range).toEqual({ from: 1, to: 1 });
    expect(s.span).toEqual({ first: 2, last: 4 });
    expect(s.index).toBe(2);
    expect(s.current?.attack[0].pitch).toBe(62);
    expect(sought[sought.length - 1]).toBe(1.0);
  });

  it("keeps your place when it is inside the new range", () => {
    start(eight);
    play(60, 61, 62); // now on step 3, in bar 1
    PracticeState.setRange({ from: 1, to: 2 });
    expect(at()).toBe(3);
  });

  it("loops: finishing the last step of the range lands on its first", () => {
    start(eight);
    PracticeState.setRange({ from: 1, to: 1 });
    play(62);
    expect(at()).toBe(3);
    play(63);
    expect(at()).toBe(2); // round again, not "done"
    expect(PracticeState.snapshot().current).not.toBeNull();
  });

  it("draws the wrap's arrows from the range's last step, where the fingers are", () => {
    start(eight);
    PracticeState.setRange({ from: 1, to: 1 });
    play(62, 63);
    const { moves } = PracticeState.snapshot();
    expect(moves).toEqual([{ from: 63, to: 62 }]);
  });

  it("draws no arrows on entering a range — nothing is down yet", () => {
    start(eight);
    play(60, 61, 62); // the fingers were on step 2's key...
    PracticeState.setRange({ from: 3, to: 3 }); // ...but that is not where the range starts
    expect(PracticeState.snapshot().moves).toEqual([]);
  });

  it("offers the range's first step as what comes next at its end", () => {
    start(eight);
    PracticeState.setRange({ from: 1, to: 1 });
    play(62);
    const s = PracticeState.snapshot();
    expect(s.index).toBe(3);
    expect(s.next?.attack[0].pitch).toBe(62);
  });

  it("still finishes the whole piece when nothing is isolated", () => {
    start(eight);
    play(60, 61, 62, 63, 64, 65, 66, 67);
    const s = PracticeState.snapshot();
    expect(s.index).toBe(8);
    expect(s.current).toBeNull();
    expect(s.next).toBeNull();
  });

  it("clamps a range to the bars that exist and orders its ends", () => {
    start(eight);
    PracticeState.setRange({ from: 3, to: 1 });
    expect(range()).toEqual({ from: 1, to: 3 });
    PracticeState.setRange({ from: 9, to: 12 });
    expect(range()).toEqual({ from: 3, to: 3 });
  });

  it("frees the lesson with null", () => {
    start(eight);
    PracticeState.setRange({ from: 2, to: 2 });
    PracticeState.setRange(null);
    const s = PracticeState.snapshot();
    expect(s.range).toBeNull();
    expect(s.span).toEqual({ first: 0, last: 8 });
    expect(s.index).toBe(4); // your place, kept
  });

  it("isolate selects one bar, and extends the range with `extend`", () => {
    start(eight);
    PracticeState.isolate(2);
    expect(range()).toEqual({ from: 2, to: 2 });
    PracticeState.isolate(0, true);
    expect(range()).toEqual({ from: 0, to: 2 });
    PracticeState.isolate(3, true);
    expect(range()).toEqual({ from: 0, to: 3 });
    PracticeState.isolate(1);
    expect(range()).toEqual({ from: 1, to: 1 });
  });

  it("extends from nothing as a plain select", () => {
    start(eight);
    PracticeState.isolate(2, true);
    expect(range()).toEqual({ from: 2, to: 2 });
  });

  it("survives a hand change, which re-cuts the score", () => {
    start(eight);
    PracticeState.setRange({ from: 1, to: 1 });
    PracticeState.setHand("upper");
    const s = PracticeState.snapshot();
    expect(s.range).toEqual({ from: 1, to: 1 });
    expect(s.span).toEqual({ first: 2, last: 4 });
    expect(s.index).toBe(2);
  });

  it("lands a scrub from outside the range on the range's first step", () => {
    start(eight);
    PracticeState.setRange({ from: 1, to: 1 });
    PracticeState.seekToTime(3.2);
    expect(at()).toBe(2);
    PracticeState.seekToTime(0);
    expect(at()).toBe(2);
    PracticeState.seekToTime(1.5);
    expect(at()).toBe(3); // inside: the step at that time
  });

  it("reports nothing to play for a range with no steps in it", () => {
    // notes in bars 0 and 3 only; bar 1 is silence
    const sparse = scoreOf(n(60, 0), n(62, 3));
    start(Core.makeScore(sparse.notes.map((x) => ({ ...x })), [0, 1, 2, 3, 4]));
    PracticeState.setRange({ from: 1, to: 1 });
    const s = PracticeState.snapshot();
    expect(s.span).toEqual({ first: 1, last: 1 });
    expect(s.current).toBeNull();
    expect(s.next).toBeNull();
    expect(sought[sought.length - 1]).toBe(1); // parked at the bar, not the end
  });
});

describe("stepping by hand", () => {
  const eight = Core.makeScore(
    Array.from({ length: 8 }, (_, i) => n(60 + i, i * 0.5, 0.4)),
    [0, 1, 2, 3, 4],
  );

  it("moves the cursor forward and back without a key being played", () => {
    start(eight);
    PracticeState.step(1);
    expect(at()).toBe(1);
    PracticeState.step(1);
    expect(at()).toBe(2);
    PracticeState.step(-1);
    expect(at()).toBe(1);
    expect(sought[sought.length - 1]).toBe(0.5);
  });

  it("stops at the first step going back", () => {
    start(eight);
    PracticeState.step(-1);
    expect(at()).toBe(0);
  });

  it("finishes the piece going forward past its end, and can step back from there", () => {
    start(eight);
    for (let i = 0; i < 8; i++) PracticeState.step(1);
    expect(at()).toBe(8);
    expect(PracticeState.snapshot().current).toBeNull();
    PracticeState.step(1);
    expect(at()).toBe(8);
    PracticeState.step(-1);
    expect(at()).toBe(7);
    expect(PracticeState.snapshot().current?.attack[0].pitch).toBe(67);
  });

  it("wraps within an isolated range instead of finishing", () => {
    start(eight);
    PracticeState.setRange({ from: 1, to: 1 });
    PracticeState.step(1);
    expect(at()).toBe(3);
    PracticeState.step(1);
    expect(at()).toBe(2);
    PracticeState.step(-1);
    expect(at()).toBe(2); // the range's first: no further back
  });

  it("forgets partial progress on the step it leaves", () => {
    // stepping back to a chord and then striking its last note must not
    // complete it on the strength of a press made before you left.
    const chord = scoreOf(n(60, 0), n(64, 0), n(67, 1));
    start(chord);
    down(60);
    PracticeState.step(1);
    PracticeState.step(-1);
    down(64);
    expect(at()).toBe(0); // 60 is held, but was not struck SINCE re-entering
  });
});

describe("what the page should show", () => {
  const eight = Core.makeScore(
    Array.from({ length: 8 }, (_, i) => n(60 + i, i * 0.5, 0.4)),
    [0, 1, 2, 3, 4],
  );
  const focus = () => PracticeState.snapshot().focus;

  it("follows the cursor bar by bar when nothing is isolated", () => {
    start(eight);
    expect(focus()).toEqual({ from: 0, to: 0 });
    PracticeState.step(1);
    expect(focus()).toEqual({ from: 0, to: 0 }); // still bar 0
    PracticeState.step(1);
    expect(focus()).toEqual({ from: 1, to: 1 });
  });

  it("shows the last bar once the piece is finished", () => {
    start(eight);
    for (let i = 0; i < 8; i++) PracticeState.step(1);
    expect(focus()).toEqual({ from: 3, to: 3 });
  });

  it("is the isolated range while there is one", () => {
    start(eight);
    PracticeState.setRange({ from: 1, to: 2 });
    PracticeState.step(1);
    PracticeState.step(1); // into bar 2
    expect(focus()).toEqual({ from: 1, to: 2 });
  });

  it("is inert, like everything else, with no lesson", () => {
    PracticeState.end();
    const s = PracticeState.snapshot();
    expect(s.score).toBeNull();
    expect(s.range).toBeNull();
    expect(s.focus).toEqual({ from: 0, to: 0 });
    expect(s.span).toEqual({ first: 0, last: 0 });
  });
});
