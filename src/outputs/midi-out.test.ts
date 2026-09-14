import { describe, it, expect, beforeEach } from "vitest";
import { encode, MidiOut } from "./midi-out";

describe("midi-out encode", () => {
  it("encodes note-on with the default velocity on channel 1", () => {
    expect(encode("on", 60)).toEqual([0x90, 60, 100]);
  });

  it("encodes note-off with release velocity 0", () => {
    expect(encode("off", 64)).toEqual([0x80, 64, 0]);
  });

  it("honours an explicit note-on velocity", () => {
    expect(encode("on", 72, 40)).toEqual([0x90, 72, 40]);
  });

  it("forces velocity 0 on note-off even when one is passed", () => {
    expect(encode("off", 50, 90)).toEqual([0x80, 50, 0]);
  });

  it("round-trips with live-midi decode (out -> in)", async () => {
    const { decode } = await import("../live-midi");
    expect(decode(new Uint8Array(encode("on", 67)))).toEqual({ kind: "on", pitch: 67, vel: 100 });
    expect(decode(new Uint8Array(encode("off", 67)))).toEqual({ kind: "off", pitch: 67, vel: 0 });
  });
});

/* A fake Web MIDI output that just records the bytes it was handed, plus the
   requestMIDIAccess navigator hook MidiOut opens for itself. */
const sent: number[][] = [];
const fakePort = { state: "connected", send: (b: number[]) => { sent.push([...b]); } };

beforeEach(() => {
  sent.length = 0;
  MidiOut.disable();
  (navigator as unknown as { requestMIDIAccess: () => Promise<unknown> }).requestMIDIAccess =
    async () => ({ outputs: new Map([["out-1", fakePort]]), onstatechange: null });
});

describe("MidiOut live path vs port lifetime", () => {
  // livePitches means "pitches the user is holding", so it is maintained with
  // no port open; enable() is what makes the port catch up to it.
  it("flushes the notes already held when a port opens", async () => {
    MidiOut.liveOn(60);            // key pressed BEFORE MIDI out was enabled
    expect(sent).toEqual([]);      // nowhere to send it yet
    await MidiOut.enable();
    expect(sent).toEqual([encode("on", 60)]);
  });

  it("emits exactly one note-off on release, never an orphan", async () => {
    MidiOut.liveOn(60);
    await MidiOut.enable();
    sent.length = 0;
    MidiOut.liveOff(60);
    expect(sent).toEqual([encode("off", 60)]);
    MidiOut.liveOff(60);           // already up — the guard holds
    expect(sent).toEqual([encode("off", 60)]);
  });

  it("does not re-flush a pitch released before the port opened", async () => {
    MidiOut.liveOn(60);
    MidiOut.liveOff(60);
    await MidiOut.enable();
    expect(sent).toEqual([]);
  });

  it("silences the live hold on disable while the port still exists", async () => {
    await MidiOut.enable();
    MidiOut.liveOn(64);
    sent.length = 0;
    MidiOut.disable();
    expect(sent).toEqual([encode("off", 64)]);
  });
});
