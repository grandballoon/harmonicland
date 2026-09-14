import { vi, describe, it, expect, beforeEach } from "vitest";

// The sinks are the only thing LiveKeys reaches out to; record the calls so
// the refcount contract ("sound on the first press, silence on the last
// release") is asserted at the wire and not just via held().
const sink = vi.hoisted(() => ({ on: [] as number[], off: [] as number[] }));
vi.mock("./outputs/audio", () => ({
  AudioOut: {
    liveOn: (p: number) => { sink.on.push(p); },
    liveOff: (p: number) => { sink.off.push(p); },
  },
}));
vi.mock("./outputs/midi-out", () => ({
  MidiOut: { liveOn: () => {}, liveOff: () => {} },
}));

import { LiveKeys, type Voice } from "./live-keys";

beforeEach(() => {
  LiveKeys.releaseAll();
  sink.on.length = 0;
  sink.off.length = 0;
});

describe("LiveKeys refcounting", () => {
  it("sounds a pitch once however many voices hold it", () => {
    LiveKeys.press(60);
    LiveKeys.press(60);
    expect(sink.on).toEqual([60]);
    expect(LiveKeys.held()).toEqual(new Set([60]));
  });

  it("keeps the pitch sounding until the LAST voice lifts", () => {
    const pointer = LiveKeys.press(60); // a finger on the drawn keyboard
    const chord = LiveKeys.press(60);   // ...and a chord holding the same C4
    LiveKeys.release(pointer);
    expect(LiveKeys.held().has(60)).toBe(true); // the chord still owns it
    expect(sink.off).toEqual([]);
    LiveKeys.release(chord);
    expect(LiveKeys.held().has(60)).toBe(false);
    expect(sink.off).toEqual([60]);
  });

  it("ignores a double release of the same voice", () => {
    const v = LiveKeys.press(60);
    LiveKeys.release(v);
    LiveKeys.release(v);
    expect(sink.off).toEqual([60]);
  });
});

describe("LiveKeys.isLive", () => {
  it("is true while held and false once released", () => {
    const v = LiveKeys.press(64);
    expect(LiveKeys.isLive(v)).toBe(true);
    LiveKeys.release(v);
    expect(LiveKeys.isLive(v)).toBe(false);
  });

  it("reports false for a voice releaseAll took out from under its owner", () => {
    const v = LiveKeys.press(67);
    LiveKeys.releaseAll();
    expect(LiveKeys.isLive(v)).toBe(false);
  });

  it("distinguishes two voices on the same pitch", () => {
    const a = LiveKeys.press(72);
    const b = LiveKeys.press(72);
    LiveKeys.release(a);
    expect(LiveKeys.isLive(a)).toBe(false);
    expect(LiveKeys.isLive(b)).toBe(true);
  });
});

/* The attack seam. held() cannot answer "was this struck again", because a
   chord played twice and a chord held through are the same set — which is
   the single fact practice mode's advance rule turns on. */
describe("LiveKeys.onPress", () => {
  it("reports every press, including a second voice on a sounding pitch", () => {
    const seen: number[] = [];
    const off = LiveKeys.onPress((v) => seen.push(v.pitch));
    LiveKeys.press(60);
    LiveKeys.press(60); // the refcounted sinks stay quiet; the seam does not
    expect(seen).toEqual([60, 60]);
    expect(sink.on).toEqual([60]);
    off();
  });

  it("hands over the Voice, so a subscriber can recognise its own presses", () => {
    let got: Voice | null = null;
    const off = LiveKeys.onPress((v) => { got = v; });
    const mine = LiveKeys.press(64);
    expect(got).toBe(mine);
    off();
  });

  it("sees the press already in held(), not a moment before it", () => {
    let heldThen = false;
    const off = LiveKeys.onPress((v) => { heldThen = LiveKeys.held().has(v.pitch); });
    LiveKeys.press(67);
    expect(heldThen).toBe(true);
    off();
  });

  it("stops on unsubscribe", () => {
    const seen: number[] = [];
    const off = LiveKeys.onPress((v) => seen.push(v.pitch));
    LiveKeys.press(60);
    off();
    LiveKeys.press(62);
    expect(seen).toEqual([60]);
  });

  it("lets a listener unsubscribe from inside its own callback", () => {
    const seen: number[] = [];
    const off = LiveKeys.onPress((v) => { seen.push(v.pitch); off(); });
    LiveKeys.press(60);
    LiveKeys.press(62);
    expect(seen).toEqual([60]);
  });
});
