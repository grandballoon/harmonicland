import { describe, it, expect } from "vitest";
import { describeFrame, mirrorSelection } from "./live-perfecto";
import { decode, encodeChord, type ChordFrame } from "./chordwire";
import { PerfState } from "./perf-state";

const dDorianII: Omit<ChordFrame, "kind"> = {
  key: { root: 2, scale: "dorian" },
  degree: 2,
  joystickMode: "extended",
  joystickDirection: "upRight",
  inversion: "first",
  octave: 5,
  voiceLeading: true,
  voicing: { notes: [64, 67, 71, 74, 78] },
};

describe("live-perfecto describeFrame", () => {
  it("names the chord with degree numeral and note count", () => {
    // D dorian degree ii → chord root E; extended/upRight → dom9
    expect(describeFrame({ kind: "chord", ...dDorianII })).toBe("E dom9 · ii · 5 notes");
  });

  it("singularizes one-note voicings (arpeggio ticks)", () => {
    const f = decode(encodeChord({ ...dDorianII, voicing: { notes: [62] } }));
    expect(f && describeFrame(f)).toBe("E dom9 · ii · 1 note");
  });

  it("describes release", () => {
    expect(describeFrame({ kind: "release" })).toBe("released");
  });
});

describe("live-perfecto mirrorSelection", () => {
  it("mirrors the frame's selection into PerfState without sounding it", () => {
    mirrorSelection({ kind: "chord", ...dDorianII });
    const s = PerfState.snapshot();
    expect(s.key).toEqual({ root: 2, scale: "dorian" });
    expect(s.degree).toBe(2);
    expect(s.joystickMode).toBe("extended");
    expect(s.joystickDirection).toBe("upRight");
    expect(s.inversion).toBe("first");
    expect(s.octave).toBe(5);
    expect(s.voiceLeading).toBe(true);
    expect(s.sounding).toEqual([]); // setters only — the note plane owns sound
    expect(PerfState.isSounding()).toBe(false);
  });
});
