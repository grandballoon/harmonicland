import { vi, describe, it, expect, beforeEach } from "vitest";

// A miniature stand-in for the real LiveKeys, refcounted the same way, so
// these tests exercise the voice-handle contract rather than a set of ints.
// vi.hoisted builds it before any mock factory runs.
const keys = vi.hoisted(() => {
  interface Voice { readonly pitch: number }
  const voices = new Map<number, Set<Voice>>();
  const press = (pitch: number): Voice => {
    const v = { pitch };
    let set = voices.get(pitch);
    if (!set) voices.set(pitch, (set = new Set<Voice>()));
    set.add(v);
    return v;
  };
  const release = (v: Voice): void => {
    const set = voices.get(v.pitch);
    if (set?.delete(v) && set.size === 0) voices.delete(v.pitch);
  };
  return {
    press,
    release,
    isLive: (v: Voice) => voices.get(v.pitch)?.has(v) ?? false,
    releaseAll: () => { voices.clear(); },
    held: () => new Set(voices.keys()),
    clear: () => { voices.clear(); },
  };
});
const held = { // read-only view, so the assertions below read unchanged
  get size() { return keys.held().size; },
  has: (p: number) => keys.held().has(p),
  [Symbol.iterator]: () => keys.held()[Symbol.iterator](),
};

vi.mock("./live-keys", () => ({ LiveKeys: keys }));

import { TonnetzState } from "./tonnetz-state";

beforeEach(() => {
  TonnetzState.release();
  TonnetzState.home();
  TonnetzState.nudgeOctave(4 - TonnetzState.snapshot().octave); // reset octave to 4
  keys.clear();
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
  it("clamps to minimum 0", () => {
    TonnetzState.nudgeOctave(-100);
    expect(TonnetzState.snapshot().octave).toBe(0);
  });

  it("clamps to maximum 8", () => {
    TonnetzState.nudgeOctave(100);
    expect(TonnetzState.snapshot().octave).toBe(8);
  });

  it("re-sounds with the new octave if a chord is held", () => {
    TonnetzState.trigger();        // C major oct 4: [60,64,67]
    TonnetzState.nudgeOctave(1);   // → oct 5: [72,76,79]
    expect([...held].sort((a, b) => a - b)).toEqual([72, 76, 79]);
  });
});

describe("TonnetzState vs a releaseAll from elsewhere", () => {
  it("re-presses the whole triad after LiveKeys.releaseAll invalidated its voices", () => {
    TonnetzState.trigger();
    keys.releaseAll();                     // e.g. a view change, which knows
    expect(TonnetzState.isSounding()).toBe(false); // nothing of our mirror
    TonnetzState.trigger();
    expect([...held].sort((a, b) => a - b)).toEqual([60, 64, 67]);
  });
});
