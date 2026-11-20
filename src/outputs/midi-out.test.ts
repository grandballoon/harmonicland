import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { control, encode, MidiOut, resumedVelocity } from "./midi-out";

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

  it("encodes a control change on channel 1", () => {
    expect(control(64, 127)).toEqual([0xb0, 64, 127]);
  });

  it("round-trips with live-midi decode (out -> in)", async () => {
    const { decode } = await import("../live-midi");
    expect(decode(new Uint8Array(encode("on", 67)))).toEqual({ kind: "on", pitch: 67, vel: 100 });
    expect(decode(new Uint8Array(encode("off", 67)))).toEqual({ kind: "off", pitch: 67, vel: 0 });
  });
});

describe("resumedVelocity", () => {
  it("strikes a note dropped into softer the further in it is, down to a floor", () => {
    expect(resumedVelocity(80, 0)).toBe(80);
    expect(resumedVelocity(80, 1)).toBeLessThan(80);
    expect(resumedVelocity(80, 1)).toBeGreaterThan(resumedVelocity(80, 2));
    expect(resumedVelocity(80, 60)).toBe(28); // 0.35 of 80
    expect(resumedVelocity(1, 60)).toBe(1); // never 0, which would be a note-off
  });
});

/* A fake Web MIDI output that records what it was handed and when. */
type Msg = [number[], number | undefined];
let ms = 0;
let n = 0;
const fakePort = () => {
  const sent: Msg[] = [];
  const port = { id: `p${++n}`, name: "Synth", state: "connected", send: (b: number[], t?: number) => { sent.push([[...b], t]); } };
  return { port: port as unknown as MIDIOutput, sent };
};

beforeEach(() => {
  ms = 1000;
  vi.spyOn(performance, "now").mockImplementation(() => ms);
});
afterEach(() => vi.restoreAllMocks());

describe("a MIDI port's Output", () => {
  it("is one per port: choosing a port again is the same Output", () => {
    const { port } = fakePort();
    expect(MidiOut.output(port)).toBe(MidiOut.output(port));
  });

  it("sends a strike's note-on stamped with its wall time", () => {
    const { port, sent } = fakePort();
    MidiOut.output(port).strike({ pitch: 60, velocity: 70, at: 1050, off: 1400 });
    expect(sent).toEqual([[encode("on", 60, 70), 1050]]);
  });

  it("holds the note-off back until the scheduler's window reaches it", () => {
    const { port, sent } = fakePort();
    const out = MidiOut.output(port);
    out.strike({ pitch: 60, velocity: 70, at: 1050, off: 3000 });
    out.advance(1100);
    expect(sent).toHaveLength(1); // only the note-on: a seek could still come
    out.advance(3000);
    expect(sent[1]).toEqual([encode("off", 60), 3000]);
    out.advance(3100);
    expect(sent).toHaveLength(2); // sent once
  });

  it("flush ends sounding notes now, and notes still to come at their own time", () => {
    const { port, sent } = fakePort();
    const out = MidiOut.output(port);
    out.strike({ pitch: 60, velocity: 70, at: 900, off: 5000 }); // sounding
    out.strike({ pitch: 64, velocity: 70, at: 1080, off: 5000 }); // on its way
    sent.length = 0;
    out.flush();
    expect(sent).toEqual([
      [encode("off", 60), 1000],
      [encode("off", 64), 1080], // on and off on one stamp: as short as it gets
      [control(64, 0), undefined], // and the pedal lifted
    ]);
    out.advance(9999);
    expect(sent).toHaveLength(3); // nothing left to end
  });

  it("flush ends a held strike (a parked step) that has no off of its own", () => {
    const { port, sent } = fakePort();
    const out = MidiOut.output(port);
    out.strike({ pitch: 60, velocity: 70, at: 1000 });
    sent.length = 0;
    out.flush();
    expect(sent).toEqual([[encode("off", 60), 1000], [control(64, 0), undefined]]);
  });

  it("strikes a note dropped into softer, since it cannot start partway", () => {
    const { port, sent } = fakePort();
    MidiOut.output(port).strike({ pitch: 60, velocity: 80, at: 1000, off: 2000, offset: 1.5 });
    expect(sent[0]).toEqual([encode("on", 60, resumedVelocity(80, 1.5)), 1000]);
  });

  it("sounds live keys at once, once each", () => {
    const { port, sent } = fakePort();
    const out = MidiOut.output(port);
    out.liveOn(62, 90);
    out.liveOn(62, 90);
    out.liveOff(62);
    out.liveOff(62);
    expect(sent).toEqual([[encode("on", 62, 90), undefined], [encode("off", 62), undefined]]);
  });

  it("a live key survives a flush: the score path and the hands are separate", () => {
    const { port, sent } = fakePort();
    const out = MidiOut.output(port);
    out.liveOn(62, 90);
    sent.length = 0;
    out.flush();
    expect(sent.filter(([b]) => b[0] === 0x80)).toEqual([]); // no note-off for the held key
  });

  it("detach lets go of everything, then sends the synth a panic", () => {
    const { port, sent } = fakePort();
    const out = MidiOut.output(port);
    out.strike({ pitch: 60, velocity: 70, at: 900, off: 5000 });
    out.liveOn(62, 90);
    sent.length = 0;
    out.detach();
    expect(sent).toEqual([
      [encode("off", 60), 1000],
      [control(64, 0), undefined],
      [encode("off", 62), undefined],
      [control(123, 0), undefined],
    ]);
  });

  it("sends the pedal as it changes, stamped", () => {
    const { port, sent } = fakePort();
    const out = MidiOut.output(port);
    out.pedal(true, 1200);
    out.pedal(false, 1800);
    expect(sent).toEqual([[control(64, 127), 1200], [control(64, 0), 1800]]);
  });

  it("never lengthens a note for the pedal: that is the synth's to do", () => {
    const { port, sent } = fakePort();
    const out = MidiOut.output(port);
    out.strike({ pitch: 60, velocity: 70, at: 1000, off: 1500, damp: 4000 });
    out.advance(1600);
    expect(sent[1]).toEqual([encode("off", 60), 1500]);
  });
});
