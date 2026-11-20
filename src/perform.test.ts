import { describe, it, expect } from "vitest";
import { Core } from "./core";
import { DEFAULT_VELOCITY, firstAtOrAfter, isFlat, perform } from "./perform";
import type { RawNote } from "./types";

const score = (notes: RawNote[], barlines: number[] = []) => Core.makeScore(notes, barlines);

describe("perform", () => {
  it("plays every note of a plain score, in order, at the default velocity when not shaping", () => {
    const p = perform(score([
      { pitch: 64, onset: 1, duration: 1 },
      { pitch: 60, onset: 0, duration: 1 },
    ]), { shape: false });
    expect(p.notes.map((n) => [n.pitch, n.onset, n.end, n.velocity])).toEqual([
      [60, 0, 1, DEFAULT_VELOCITY],
      [64, 1, 2, DEFAULT_VELOCITY],
    ]);
  });

  it("cuts a note where its key is struck again", () => {
    const p = perform(score([
      { pitch: 60, onset: 0, duration: 2 }, // legato into its own repeat
      { pitch: 60, onset: 1, duration: 1 },
      { pitch: 64, onset: 0.5, duration: 3 }, // another key: untouched
    ]));
    expect(p.notes.map((n) => [n.pitch, n.onset, n.end])).toEqual([
      [60, 0, 1],
      [64, 0.5, 3.5],
      [60, 1, 2],
    ]);
  });

  it("strikes a unison once, held for the longer of its two notes", () => {
    const p = perform(score([
      { pitch: 60, onset: 0, duration: 1 },
      { pitch: 60, onset: 0, duration: 3 },
    ]));
    expect(p.notes.map((n) => [n.pitch, n.onset, n.end])).toEqual([[60, 0, 3]]);
  });

  it("finds the first note at or after a time", () => {
    const p = perform(score([0, 1, 1, 2].map((onset, i) => ({ pitch: 60 + i, onset, duration: 0.5 }))));
    expect(firstAtOrAfter(p, 0)).toBe(0);
    expect(firstAtOrAfter(p, 0.5)).toBe(1);
    expect(firstAtOrAfter(p, 1)).toBe(1);
    expect(firstAtOrAfter(p, 1.5)).toBe(3);
    expect(firstAtOrAfter(p, 9)).toBe(4);
  });

  it("strikes a unison at the louder of its two velocities", () => {
    const p = perform(score([
      { pitch: 60, onset: 0, duration: 3, velocity: 40 },
      { pitch: 60, onset: 0, duration: 1, velocity: 90 },
      { pitch: 64, onset: 0, duration: 1, velocity: 50 },
    ]));
    expect(p.notes.find((n) => n.pitch === 60)).toMatchObject({ end: 3, velocity: 90 });
  });
});

describe("perform: velocity", () => {
  it("plays a score with dynamics as written, unmarked notes at the default", () => {
    const p = perform(score([
      { pitch: 60, onset: 0, duration: 1 },
      { pitch: 62, onset: 1, duration: 1, velocity: 33 },
      { pitch: 64, onset: 2, duration: 1, velocity: 112 },
    ]));
    expect(p.notes.map((n) => n.velocity)).toEqual([DEFAULT_VELOCITY, 33, 112]);
  });

  it("calls a score flat when nearly all its notes share one velocity, and keeps the rare accent", () => {
    const notes: RawNote[] = Array.from({ length: 40 }, (_, i) => ({ pitch: 60, onset: i * 0.5, duration: 0.5, velocity: 90 }));
    notes[5] = { ...notes[5], velocity: 110 };
    const s = score(notes, [0, 2]);
    expect(isFlat(s)).toBe(true);
    const p = perform(s);
    expect(p.notes[5].velocity).toBe(110);
    expect(p.notes[0].velocity).toBe(80); // shaped: a downbeat
    notes[6] = { ...notes[6], velocity: 30 };
    notes[7] = { ...notes[7], velocity: 50 }; // three in forty is dynamics
    expect(isFlat(score(notes, [0, 2]))).toBe(false);
  });

  it("calls a score flat when its velocities are all absent, or all the same", () => {
    expect(isFlat(score([{ pitch: 60, onset: 0, duration: 1 }, { pitch: 62, onset: 1, duration: 1 }]))).toBe(true);
    expect(isFlat(score([{ pitch: 60, onset: 0, duration: 1, velocity: 100 }, { pitch: 62, onset: 1, duration: 1, velocity: 100 }]))).toBe(true);
    expect(isFlat(score([{ pitch: 60, onset: 0, duration: 1, velocity: 100 }, { pitch: 62, onset: 1, duration: 1, velocity: 90 }]))).toBe(false);
  });

  it("shapes a flat score: downbeats lifted, the middle of an even bar a little, the lower hand under", () => {
    // 4/4 bars of 2s: beats at 0, 0.5, 1, 1.5
    const notes: RawNote[] = [0, 0.5, 1, 1.5, 2].map((onset, i) => ({ pitch: 60 + i, onset, duration: 0.5, hand: "upper" }));
    notes.push({ pitch: 36, onset: 0, duration: 2, hand: "lower" });
    const p = perform(score(notes, [0, 2, 4]));
    const at = (pitch: number) => p.notes.find((n) => n.pitch === pitch)!.velocity;
    expect([60, 61, 62, 63, 64].map(at)).toEqual([80, 72, 76, 72, 80]);
    expect(at(36)).toBe(74); // a downbeat, in the lower hand
  });

  it("gives an odd meter no secondary beat", () => {
    // 3/4 bars of 1.5s
    const bars = [{ at: 0, beats: 3, unit: 4 }, 1.5];
    const p = perform(Core.makeScore([0, 0.5, 1].map((onset, i) => ({ pitch: 60 + i, onset, duration: 0.5 })), bars));
    expect(p.notes.map((n) => n.velocity)).toEqual([80, 72, 72]);
  });

  it("never shapes a score that has dynamics of its own", () => {
    const p = perform(score([
      { pitch: 60, onset: 0, duration: 1, velocity: 40 },
      { pitch: 62, onset: 1, duration: 1, velocity: 50 },
    ], [0, 2]));
    expect(p.notes.map((n) => n.velocity)).toEqual([40, 50]);
  });

  it("plays a flat score at its own one velocity when shaping is off", () => {
    const p = perform(score([
      { pitch: 60, onset: 0, duration: 1, velocity: 100 },
      { pitch: 62, onset: 1, duration: 1, velocity: 100 },
    ]), { shape: false });
    expect(p.notes.map((n) => n.velocity)).toEqual([100, 100]);
  });
});

describe("perform: the pedal's damper times", () => {
  const withPedal = (notes: RawNote[], pedal: { start: number; end: number }[]) =>
    perform(Core.makeScore(notes, [], pedal), { shape: false });
  const damp = (p: ReturnType<typeof perform>, pitch: number) => p.notes.find((n) => n.pitch === pitch)!.damp;

  it("is the key-up with no pedal", () => {
    expect(damp(withPedal([{ pitch: 60, onset: 0, duration: 1 }], []), 60)).toBe(1);
  });

  it("carries a note let go of under the pedal to where the pedal lifts", () => {
    const p = withPedal([{ pitch: 60, onset: 0, duration: 1 }, { pitch: 64, onset: 2, duration: 2 }], [{ start: 0, end: 3 }]);
    expect(damp(p, 60)).toBe(3);
    expect(damp(p, 64)).toBe(4); // still held when the pedal lifts
  });

  it("clears the old harmony at a pedal change: a note let go of as it goes down is not caught", () => {
    const p = withPedal(
      [{ pitch: 60, onset: 0, duration: 2 }, { pitch: 67, onset: 2, duration: 1 }],
      [{ start: 0, end: 2 }, { start: 2, end: 4 }],
    );
    expect(damp(p, 60)).toBe(2);
    expect(damp(p, 67)).toBe(4);
  });

  it("never sustains past the key's next strike", () => {
    const p = withPedal([{ pitch: 60, onset: 0, duration: 0.5 }, { pitch: 60, onset: 1, duration: 0.5 }], [{ start: 0, end: 3 }]);
    expect(p.notes.map((n) => n.damp)).toEqual([1, 3]);
  });

  it("hands the pedal on to the scheduler", () => {
    expect(withPedal([{ pitch: 60, onset: 0, duration: 4 }], [{ start: 1, end: 2 }]).pedal).toEqual([{ start: 1, end: 2 }]);
  });
});

