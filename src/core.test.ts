import { describe, it, expect } from "vitest";
import { Core } from "./core";

describe("defaultSpelling", () => {
  it("spells naturals with no accidental", () => {
    expect(Core.defaultSpelling(60)).toEqual({ letter: "C", acc: "" }); // middle C
    expect(Core.defaultSpelling(69)).toEqual({ letter: "A", acc: "" }); // A4
  });
  it("spells black keys as sharps (the MIDI default)", () => {
    expect(Core.defaultSpelling(61)).toEqual({ letter: "C", acc: "#" });
    expect(Core.defaultSpelling(70)).toEqual({ letter: "A", acc: "#" });
  });
  it("is octave-invariant and handles negative pitches", () => {
    expect(Core.defaultSpelling(0)).toEqual({ letter: "C", acc: "" });
    expect(Core.defaultSpelling(-11)).toEqual({ letter: "C", acc: "#" }); // ((-11)%12+12)%12 = 1
  });
});

describe("makeScore", () => {
  it("sorts notes by onset", () => {
    const s = Core.makeScore([
      { pitch: 60, onset: 2, duration: 1 },
      { pitch: 62, onset: 0, duration: 1 },
      { pitch: 64, onset: 1, duration: 1 },
    ]);
    expect(s.notes.map((n) => n.onset)).toEqual([0, 1, 2]);
    expect(s.notes.map((n) => n.pitch)).toEqual([62, 64, 60]);
  });

  it("fills a default spelling only when none is given", () => {
    const s = Core.makeScore([
      { pitch: 61, onset: 0, duration: 1 }, // no spelling -> default sharp
      { pitch: 61, onset: 1, duration: 1, spelling: { letter: "D", acc: "b" } },
    ]);
    expect(s.notes[0].spelling).toEqual({ letter: "C", acc: "#" });
    expect(s.notes[1].spelling).toEqual({ letter: "D", acc: "b" }); // preserved
  });

  it("derives duration from the last note's end (onset + duration)", () => {
    const s = Core.makeScore([
      { pitch: 60, onset: 0, duration: 1 },
      { pitch: 62, onset: 0.5, duration: 3 }, // ends at 3.5 — the max
      { pitch: 64, onset: 2, duration: 0.5 },
    ]);
    expect(s.duration).toBe(3.5);
  });

  it("an empty score has zero duration and no notes", () => {
    const s = Core.makeScore([]);
    expect(s.notes).toHaveLength(0);
    expect(s.duration).toBe(0);
  });
});

describe("activeAt", () => {
  const score = Core.makeScore([
    { pitch: 60, onset: 0, duration: 1 },
    { pitch: 64, onset: 0.5, duration: 1 },
  ]);

  it("includes a note at its onset but excludes it at its end (half-open)", () => {
    expect(Core.activeAt(score, 0).map((n) => n.pitch)).toEqual([60]); // onset inclusive
    expect(Core.activeAt(score, 1).map((n) => n.pitch)).toEqual([64]); // 60 ended (exclusive); 64 ends at 1.5
    expect(Core.activeAt(score, 0.75).map((n) => n.pitch)).toEqual([60, 64]); // overlap
  });

  it("returns the same note objects the score holds (identity for audio voices)", () => {
    const [n] = Core.activeAt(score, 0);
    expect(n).toBe(score.notes[0]);
  });
});

/* Identity used to be OBJECT identity: activeAt returned score.notes members
   because it .filter()s, and the audio voice map, the MIDI-out edge detector
   and the piano roll all keyed on that. A defensive copy anywhere in the
   chain would have re-attacked every note every frame with nothing failing.
   It is now a property of the value. */
describe("note identity", () => {
  const s = Core.makeScore([
    { pitch: 64, onset: 1, duration: 1 },
    { pitch: 60, onset: 0, duration: 2 },
    { pitch: 67, onset: 0, duration: 2 },
  ]);

  it("gives every note a distinct id", () => {
    expect(new Set(s.notes.map((n) => n.id)).size).toBe(s.notes.length);
  });

  it("numbers ids from the post-sort index, so they follow onset order", () => {
    expect(s.notes.map((n) => n.id)).toEqual([0, 1, 2]);
    expect(s.notes.map((n) => n.onset)).toEqual([0, 0, 1]);
  });

  it("carries the id through activeAt, so consumers can diff frames on it", () => {
    const at0 = Core.activeAt(s, 0).map((n) => n.id);
    const at1 = Core.activeAt(s, 1.5).map((n) => n.id);
    expect(at0.sort()).toEqual([0, 1]);           // the two onset-0 notes
    expect(at1.sort()).toEqual([0, 1, 2]);        // ...still held, plus E4
    // the same note across two frames is the same id — the whole point
    expect(at1).toEqual(expect.arrayContaining(at0));
  });

  it("survives a defensive copy of the notes activeAt hands back", () => {
    const copied = Core.activeAt(s, 0).map((n) => ({ ...n }));
    expect(copied.map((n) => n.id)).toEqual(Core.activeAt(s, 0).map((n) => n.id));
  });
});

describe("bars", () => {
  const one = (dur: number) => [{ pitch: 60, onset: 0, duration: dur }];
  const bars = (s: { bars: readonly { start: number; end: number }[] }) =>
    s.bars.map((b) => [b.start, b.end]);

  it("makes one bar of the whole piece when no barlines are given", () => {
    // so a consumer never has to ask "does this score have bars" first
    const s = Core.makeScore(one(3));
    expect(s.bars).toEqual([{ index: 0, start: 0, end: 3, beats: 4, unit: 4, fifths: 0 }]);
    expect(Core.makeScore([]).bars).toEqual([{ index: 0, start: 0, end: 0, beats: 4, unit: 4, fifths: 0 }]);
  });

  it("cuts fence posts into half-open bars, numbered densely", () => {
    const s = Core.makeScore(one(4), [0, 1, 2, 3, 4]);
    expect(bars(s)).toEqual([[0, 1], [1, 2], [2, 3], [3, 4]]);
    expect(s.bars.map((b) => b.index)).toEqual([0, 1, 2, 3]);
  });

  it("prepends a pickup bar when the first post is after 0", () => {
    expect(bars(Core.makeScore(one(2.5), [0.5, 1.5, 2.5]))).toEqual([[0, 0.5], [0.5, 1.5], [1.5, 2.5]]);
  });

  it("continues the last bar's length until the piece is covered", () => {
    // a note hanging past the final barline must still be IN a bar
    expect(bars(Core.makeScore(one(2.5), [0, 1]))).toEqual([[0, 1], [1, 2], [2, 3]]);
  });

  it("drops duplicate and unordered posts rather than making empty bars", () => {
    expect(bars(Core.makeScore(one(2), [1, 0, 1, 2]))).toEqual([[0, 1], [1, 2]]);
  });

  it("barAt names the bar containing a time, clamped at both ends", () => {
    const s = Core.makeScore(one(3), [0, 1, 2, 3]);
    expect(Core.barAt(s, 0).index).toBe(0);
    expect(Core.barAt(s, 0.99).index).toBe(0);
    expect(Core.barAt(s, 1).index).toBe(1); // half-open: the boundary is the NEXT bar
    expect(Core.barAt(s, 2.5).index).toBe(2);
    expect(Core.barAt(s, 99).index).toBe(2);
    expect(Core.barAt(s, -1).index).toBe(0);
  });

  it("clampRange orders a backwards range and pulls it inside the bars that exist", () => {
    expect(Core.clampRange({ from: 3, to: 1 }, 5)).toEqual({ from: 1, to: 3 });
    expect(Core.clampRange({ from: -2, to: 40 }, 5)).toEqual({ from: 0, to: 4 });
  });

  it("barTime spans a run of bars in seconds, and null is the whole piece", () => {
    const s = Core.makeScore(one(3), [0, 1, 2, 3]);
    expect(Core.barTime(s, { from: 1, to: 1 })).toEqual({ start: 1, end: 2 });
    expect(Core.barTime(s, { from: 0, to: 2 })).toEqual({ start: 0, end: 3 });
    expect(Core.barTime(s, { from: 2, to: 9 })).toEqual({ start: 2, end: 3 });
    expect(Core.barTime(s, null)).toEqual({ start: 0, end: 3 });
  });

  it("barTime honours trims, in beats of their own bars", () => {
    // three one-second bars of 4/4: a beat is a quarter second
    const s = Core.makeScore(one(3), [0, 1, 2, 3]);
    expect(Core.barTime(s, { from: 0, fromBeat: 2, to: 2, toBeat: 1 })).toEqual({ start: 0.5, end: 2.25 });
  });

  it("barTime puts a trim that is a hair off an attack exactly on it", () => {
    // a bar of three beats, trimmed to its second: 1/3 of a second is not exact
    const s = Core.makeScore([{ pitch: 60, onset: 1 / 3, duration: 0.1 }], [{ at: 0, beats: 3, unit: 4 }, 1]);
    const beat = Core.beatOfTime(s.bars[0], 1 / 3);
    expect(Core.barTime(s, { from: 0, fromBeat: beat, to: 0 }).start).toBe(s.notes[0].onset);
  });

  it("normalizeRange keeps a trim strictly inside its bar, with one spelling", () => {
    const s = Core.makeScore(one(3), [0, 1, 2, 3]);
    const norm = (r: Parameters<typeof Core.normalizeRange>[1]) => Core.normalizeRange(s, r);
    expect(norm({ from: 0, fromBeat: 0, to: 2, toBeat: 4 })).toEqual({ from: 0, to: 2 });
    expect(norm({ from: 0, fromBeat: 4, to: 2 })).toEqual({ from: 1, to: 2 }); // the next bar, whole
    expect(norm({ from: 0, to: 2, toBeat: 0 })).toEqual({ from: 0, to: 1 }); // the bar before, whole
    expect(norm({ from: 1, fromBeat: 3, to: 1, toBeat: 1 })).toEqual({ from: 1, fromBeat: 3, to: 1 });
    expect(norm({ from: 1, fromBeat: 1, to: 9, toBeat: 2 })).toEqual({ from: 1, fromBeat: 1, to: 2 });
  });

  it("sameRange compares trims too", () => {
    expect(Core.sameRange({ from: 1, to: 2 }, { from: 1, to: 2 })).toBe(true);
    expect(Core.sameRange({ from: 1, to: 2 }, { from: 1, fromBeat: 1, to: 2 })).toBe(false);
    expect(Core.sameRange(null, null)).toBe(true);
    expect(Core.sameRange(null, { from: 0, to: 0 })).toBe(false);
  });
});

describe("meter and key on the barline", () => {
  const one = [{ pitch: 60, onset: 0, duration: 4 }];
  const sig = (s: { bars: readonly { beats: number; unit: number; fifths: number }[] }) =>
    s.bars.map((b) => [b.beats, b.unit, b.fifths]);

  it("assumes common time and no sharps or flats", () => {
    expect(sig(Core.makeScore(one, [0, 2, 4]))).toEqual([[4, 4, 0], [4, 4, 0]]);
  });

  it("carries a stated meter and key forward until changed", () => {
    const s = Core.makeScore(one, [{ at: 0, beats: 3, unit: 4, fifths: -2 }, 1.5, { at: 3, beats: 6, unit: 8 }, 4.5]);
    expect(sig(s)).toEqual([[3, 4, -2], [3, 4, -2], [6, 8, -2]]);
  });

  it("gives a prepended pickup and appended bars the neighbouring signature", () => {
    const s = Core.makeScore(one, [{ at: 1, beats: 2, unit: 4, fifths: 1 }, 2]);
    expect(sig(s)).toEqual([[2, 4, 1], [2, 4, 1], [2, 4, 1], [2, 4, 1]]);
    expect(s.bars.map((b) => b.start)).toEqual([0, 1, 2, 3]);
  });
});
