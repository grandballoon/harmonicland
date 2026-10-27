import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// the echoes are pressed through the real LiveKeys; record what reaches
// the output, so "it sounds" is asserted at the wire
const sink = vi.hoisted(() => ({ on: [] as number[], off: [] as number[] }));
vi.mock("./outputs/sound", () => ({
  Sound: {
    liveOn: (p: number) => { sink.on.push(p); },
    liveOff: (p: number) => { sink.off.push(p); },
  },
}));

import { LiveKeys } from "./live-keys";
import { makeEchoes, GAP_MS, HOLD_MS, type Echoes } from "./echoes";

const M3_UP = { semitones: 4, dir: "up" } as const;
const M6_DOWN = { semitones: 8, dir: "down" } as const;

let echoes: Echoes;
let accepting: boolean;
const pitches = () => [...LiveKeys.held()].sort((a, b) => a - b);

beforeEach(() => {
  vi.useFakeTimers();
  LiveKeys.releaseAll();
  sink.on.length = 0;
  sink.off.length = 0;
  accepting = true;
  echoes = makeEchoes({ keys: LiveKeys, accept: () => accepting });
});

afterEach(() => {
  echoes.detach();
  vi.useRealTimers();
});

describe("echoes together", () => {
  beforeEach(() => echoes.set({ relations: [M3_UP, M6_DOWN], timing: "together" }));

  it("sounds the relatives with the key, and names them", () => {
    LiveKeys.press(60);
    expect(pitches()).toEqual([52, 60, 64]);
    expect(sink.on).toEqual([60, 52, 64]);
    expect(echoes.marks()).toEqual([
      { pitch: 52, name: "m6", dir: "down" },
      { pitch: 64, name: "M3", dir: "up" },
    ]);
  });

  it("lifts them with the key once they have sounded long enough", () => {
    const v = LiveKeys.press(60);
    vi.advanceTimersByTime(HOLD_MS + 100);
    expect(pitches()).toEqual([52, 60, 64]); // held: they wait for the key
    LiveKeys.release(v);
    expect(pitches()).toEqual([]);
    expect(echoes.marks()).toEqual([]);
  });

  it("holds them HOLD_MS after a quick tap", () => {
    const v = LiveKeys.press(60);
    LiveKeys.release(v);
    expect(pitches()).toEqual([52, 64]);
    vi.advanceTimersByTime(HOLD_MS);
    expect(pitches()).toEqual([]);
  });

  it("follows the voice that raised them, not the pitch", () => {
    const first = LiveKeys.press(60);
    const second = LiveKeys.press(60);
    vi.advanceTimersByTime(HOLD_MS);
    LiveKeys.release(first);
    // the second finger's echoes still sound, on the same keys
    expect(pitches()).toEqual([52, 60, 64]);
    expect(echoes.marks()).toHaveLength(2);
    LiveKeys.release(second);
    expect(pitches()).toEqual([]);
  });

  it("does not echo its own echoes", () => {
    LiveKeys.press(60);
    expect(echoes.marks()).toHaveLength(2);
  });

  it("leaves a finger on an echoed key sounding when the echo lifts", () => {
    const v = LiveKeys.press(60);
    const finger = LiveKeys.press(64); // raises echoes of its own
    vi.advanceTimersByTime(HOLD_MS);
    LiveKeys.release(v);
    expect(LiveKeys.held().has(64)).toBe(true);
    expect(sink.off).not.toContain(64);
    LiveKeys.release(finger);
  });
});

describe("echoes after", () => {
  beforeEach(() => echoes.set({ relations: [M3_UP, M6_DOWN], timing: "after" }));

  it("follows the key one at a time, lowest first", () => {
    LiveKeys.press(60);
    expect(pitches()).toEqual([60]);
    vi.advanceTimersByTime(GAP_MS);
    expect(pitches()).toEqual([52, 60]);
    vi.advanceTimersByTime(GAP_MS);
    expect(pitches()).toEqual([52, 60, 64]);
  });

  it("still plays every echo after a quick tap, each for HOLD_MS", () => {
    const v = LiveKeys.press(60);
    LiveKeys.release(v);
    vi.advanceTimersByTime(GAP_MS);
    expect(pitches()).toEqual([52]);
    vi.advanceTimersByTime(GAP_MS);
    expect(pitches()).toEqual([64]);
    vi.advanceTimersByTime(HOLD_MS);
    expect(pitches()).toEqual([]);
  });

  it("forgets echoes still to come when cleared", () => {
    LiveKeys.press(60);
    echoes.clear();
    vi.advanceTimersByTime(3 * GAP_MS);
    expect(pitches()).toEqual([60]);
  });
});

describe("what raises echoes", () => {
  beforeEach(() => echoes.set({ relations: [M3_UP], timing: "together" }));

  it("ignores a silent voice: the mic's instrument sounds itself", () => {
    LiveKeys.press(60, { silent: true });
    expect(pitches()).toEqual([60]);
    expect(sink.on).toEqual([]);
  });

  it("ignores a press it is told not to accept", () => {
    accepting = false;
    LiveKeys.press(60);
    expect(pitches()).toEqual([60]);
  });

  it("raises nothing with no relations chosen", () => {
    echoes.set({ relations: [], timing: "together" });
    LiveKeys.press(60);
    expect(pitches()).toEqual([60]);
  });

  it("is lifted with everything else by releaseAll", () => {
    LiveKeys.press(60);
    LiveKeys.releaseAll();
    vi.advanceTimersByTime(HOLD_MS);
    expect(pitches()).toEqual([]);
    expect(echoes.marks()).toEqual([]);
  });
});
