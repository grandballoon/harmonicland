import { vi, describe, it, expect, beforeEach } from "vitest";

// Real LiveKeys semantics with the audio/MIDI sinks stubbed out — the point
// of these tests is precisely the LiveKeys<->PerfState handshake, so mocking
// LiveKeys itself would mock away the thing under test.
vi.mock("./outputs/audio", () => ({ AudioOut: { liveOn: () => {}, liveOff: () => {} } }));
vi.mock("./outputs/midi-out", () => ({ MidiOut: { liveOn: () => {}, liveOff: () => {} } }));

import { LiveKeys } from "./live-keys";
import { PerfState } from "./perf-state";

beforeEach(() => {
  PerfState.release();
  LiveKeys.releaseAll();
  PerfState.setKey({ root: 0, scale: "major" });
  PerfState.setDegree(1);
  PerfState.setDirection("center");
  PerfState.setInversion("root");
  PerfState.setOctave(4);
  PerfState.setVoiceLeading(false);
  PerfState.setMode("default");
});

describe("PerfState.trigger", () => {
  it("presses a triad and reports it as sounding", () => {
    const v = PerfState.trigger();
    expect(v.notes).toHaveLength(3);
    expect(LiveKeys.held()).toEqual(new Set(v.notes));
    expect(PerfState.isSounding()).toBe(true);
  });

  it("is idempotent — re-triggering unchanged holds the same three keys", () => {
    PerfState.trigger();
    const before = LiveKeys.held();
    PerfState.trigger();
    expect(LiveKeys.held()).toEqual(before);
  });

  it("leaves common tones down when the degree changes", () => {
    PerfState.trigger();               // I  = C E G
    PerfState.setDegree(6);
    PerfState.trigger();               // vi = A C E — C and E are common
    expect(LiveKeys.held().size).toBe(3);
  });
});

describe("PerfState after a releaseAll from elsewhere", () => {
  // The confirmed silent-note bug: a view change calls LiveKeys.releaseAll(),
  // which knows nothing of PerfState's chord. With a private mirror, the next
  // trigger() diffed against stale pitches and re-pressed nothing.
  it("reports not-sounding once its voices are invalidated", () => {
    PerfState.trigger();
    LiveKeys.releaseAll();
    expect(PerfState.isSounding()).toBe(false);
    expect(PerfState.snapshot().sounding).toEqual([]);
  });

  it("re-presses the WHOLE chord on the next trigger, not the diff", () => {
    PerfState.trigger();
    LiveKeys.releaseAll();
    PerfState.trigger();
    expect(LiveKeys.held().size).toBe(3);
  });
});

describe("PerfState.release", () => {
  it("lifts exactly its own chord and leaves another surface's note alone", () => {
    const pointer = LiveKeys.press(60); // a finger holding C4 independently
    PerfState.trigger();                // the I chord also contains C4
    PerfState.release();
    expect(PerfState.isSounding()).toBe(false);
    expect(LiveKeys.held()).toEqual(new Set([60])); // the finger keeps its note
    LiveKeys.release(pointer);
    expect(LiveKeys.held().size).toBe(0);
  });
});

describe("PerfState.preview", () => {
  // The Nashville readout used to compute this itself by spreading a snapshot
  // into computeVoicing's args — which typechecked only by structural
  // accident. It is PerfState's question, so PerfState answers it.
  it("is the chord the selection would sound, without triggering anything", () => {
    const shown = PerfState.snapshot().preview;
    expect(shown).toHaveLength(3);
    expect(LiveKeys.held().size).toBe(0); // previewing sounds nothing
    expect(PerfState.trigger().notes).toEqual(shown);
  });

  it("tracks the selection while silent", () => {
    const one = PerfState.snapshot().preview;
    PerfState.setDegree(5);
    expect(PerfState.snapshot().preview).not.toEqual(one);
  });

  it("ignores voice-leading, so it describes the selection and not the past", () => {
    PerfState.setVoiceLeading(true);
    PerfState.setDegree(1);
    PerfState.trigger();      // establishes a previousVoicing to lead from
    PerfState.setDegree(4);
    PerfState.setVoiceLeading(false);
    const plain = PerfState.snapshot().preview;
    PerfState.setVoiceLeading(true);
    expect(PerfState.snapshot().preview).toEqual(plain);
  });
});
