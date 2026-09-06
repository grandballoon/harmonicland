import { vi, describe, it, expect, beforeEach } from "vitest";

// vi.hoisted creates the shared set before any mock factories run.
const held = vi.hoisted(() => new Set<number>());

vi.mock("./live-keys", () => ({
  LiveKeys: {
    press:      (p: number) => { held.add(p); },
    release:    (p: number) => { held.delete(p); },
    releaseAll: () => { held.clear(); },
    held:       () => held,
  },
}));

import { TonnetzState } from "./tonnetz-state";
import { MIN_OCTAVE, MAX_OCTAVE, DEFAULT_OCTAVE } from "./perf-state";

beforeEach(() => {
  TonnetzState.release();
  TonnetzState.home();
  TonnetzState.nudgeOctave(DEFAULT_OCTAVE - TonnetzState.snapshot().octave); // back to home register
  held.clear();
});

describe("TonnetzState.trigger", () => {
  it("presses [60,64,67] for the default cursor (C major, octave 4)", () => {
    TonnetzState.trigger();
    expect([...held].sort((a, b) => a - b)).toEqual([60, 64, 67]);
  });

  it("is idempotent — re-triggering with no change presses/releases nothing new", () => {
    TonnetzState.trigger();
    const snapshot = new Set(held);
    TonnetzState.trigger();
    expect(new Set(held)).toEqual(snapshot);
  });
});

describe("TonnetzState.apply", () => {
  it("leaves common tones held when applying P while sounding", () => {
    TonnetzState.trigger();             // C major: [60,64,67]
    TonnetzState.apply("P");            // → C minor: [60,63,67]
    expect(held.has(60)).toBe(true);    // root C  — common tone
    expect(held.has(67)).toBe(true);    // fifth G — common tone
    expect(held.has(64)).toBe(false);   // E released
    expect(held.has(63)).toBe(true);    // Eb newly pressed
  });

  it("does not start sounding when not currently held", () => {
    TonnetzState.apply("P");
    expect(held.size).toBe(0);
  });
});

describe("TonnetzState.release", () => {
  it("lifts exactly the sounding notes and leaves held empty", () => {
    TonnetzState.trigger();
    TonnetzState.release();
    expect(held.size).toBe(0);
    expect(TonnetzState.isSounding()).toBe(false);
  });
});

describe("TonnetzState.nudgeOctave", () => {
  // the playable register is the instrument's, shared with PerfState, so a
  // held nudge can't walk either view out to an unplayable octave
  it("clamps to the bottom of the playable register", () => {
    TonnetzState.nudgeOctave(-100);
    expect(TonnetzState.snapshot().octave).toBe(MIN_OCTAVE);
  });

  it("clamps to the top of the playable register", () => {
    TonnetzState.nudgeOctave(100);
    expect(TonnetzState.snapshot().octave).toBe(MAX_OCTAVE);
  });

  it("re-sounds with the new octave if a chord is held", () => {
    TonnetzState.trigger();        // C major oct 4: [60,64,67]
    TonnetzState.nudgeOctave(1);   // → oct 5: [72,76,79]
    expect([...held].sort((a, b) => a - b)).toEqual([72, 76, 79]);
  });
});
