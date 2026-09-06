import { describe, it, expect, afterEach, vi } from "vitest";
import { LiveKeys } from "./live-keys";

// LiveKeys drives both sinks on every edge; these tests are about which
// pitches it lets through, so both sinks are stubbed and only counted.
const audio = { on: [] as number[], off: [] as number[] };
const midi = { on: [] as number[], off: [] as number[] };

vi.mock("./outputs/audio", () => ({
  AudioOut: {
    ensure: () => {}, at: () => {}, silence: () => {}, setMuted: () => {},
    liveOn: (p: number) => { audioSink().on.push(p); },
    liveOff: (p: number) => { audioSink().off.push(p); },
  },
}));
vi.mock("./outputs/midi-out", () => ({
  MidiOut: {
    enable: () => {}, disable: () => {}, at: () => {}, silence: () => {},
    liveOn: (p: number) => { midiSink().on.push(p); },
    liveOff: (p: number) => { midiSink().off.push(p); },
  },
}));
// the mock factories are hoisted above the consts, so reach them lazily
const audioSink = () => audio;
const midiSink = () => midi;

afterEach(() => {
  LiveKeys.releaseAll();
  audio.on.length = audio.off.length = midi.on.length = midi.off.length = 0;
});

describe("LiveKeys — the held-pitch gate", () => {
  it("presses a pitch once and drives both sinks", () => {
    LiveKeys.press(60);
    LiveKeys.press(60); // idempotent: no double attack
    expect([...LiveKeys.held()]).toEqual([60]);
    expect(audio.on).toEqual([60]);
    expect(midi.on).toEqual([60]);
    LiveKeys.release(60);
    expect(LiveKeys.held().size).toBe(0);
    expect(midi.off).toEqual([60]);
  });

  // A voicing can compute past the 7-bit MIDI range (high register + a wide
  // coloration + a voice-leading octave shift stack up). MidiOut.send would
  // throw on the out-of-range byte and take the rest of the chord with it, so
  // the unsayable note is dropped here and the playable ones still sound.
  it("drops pitches outside the 0..127 MIDI range instead of sending them", () => {
    LiveKeys.press(128);
    LiveKeys.press(-1);
    LiveKeys.press(60.5);
    expect(LiveKeys.held().size).toBe(0);
    expect(midi.on).toEqual([]);

    LiveKeys.press(127); // the edges themselves are legal
    LiveKeys.press(0);
    expect([...LiveKeys.held()].sort((a, b) => a - b)).toEqual([0, 127]);
  });

  it("releaseAll lifts everything it is holding", () => {
    LiveKeys.press(60);
    LiveKeys.press(64);
    LiveKeys.releaseAll();
    expect(LiveKeys.held().size).toBe(0);
    expect(midi.off.sort((a, b) => a - b)).toEqual([60, 64]);
  });
});
