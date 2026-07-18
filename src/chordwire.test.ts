import { describe, it, expect } from "vitest";
import {
  decode,
  encodeChord,
  encodeRelease,
  SCALE_ORDER,
  MODE_ORDER,
  DIRECTION_ORDER,
  INVERSION_ORDER,
  type ChordFrame,
} from "./chordwire";
import { SCALE_INTERVALS, type ScaleType } from "./harmony/perfecto";

const cMajI: Omit<ChordFrame, "kind"> = {
  key: { root: 0, scale: "major" },
  degree: 1,
  joystickMode: "default",
  joystickDirection: "right",
  inversion: "root",
  octave: 4,
  voiceLeading: false,
  voicing: { notes: [60, 64, 67, 71] },
};

describe("chordwire golden frames — must match Perfecto's ChordWireTests byte for byte", () => {
  it("encodes C major, I, default/right (maj7), octave 4", () => {
    expect(encodeChord(cMajI)).toEqual([
      0xf0, 0x7d, 0x50, 0x46, 0x01, // header: SysEx, non-commercial, 'P', 'F', v1
      0x01, // type: chord
      0, 0, 1, 0, 3, 0, 4, 0, // C, major, I, default, right, root, octave 4, no VL
      0, 0, // no bass note
      4, 60, 64, 67, 71, // Cmaj7 voicing
      0xf7,
    ]);
  });

  it("encodes release", () => {
    expect(encodeRelease()).toEqual([0xf0, 0x7d, 0x50, 0x46, 0x01, 0x02, 0xf7]);
  });
});

describe("chordwire round-trips", () => {
  it("round-trips the golden chord", () => {
    expect(decode(encodeChord(cMajI))).toEqual({ kind: "chord", ...cMajI });
  });

  it("round-trips release", () => {
    expect(decode(encodeRelease())).toEqual({ kind: "release" });
  });

  it("round-trips every scale, mode, direction, and inversion", () => {
    for (const scale of SCALE_ORDER)
      for (const joystickMode of MODE_ORDER)
        for (const joystickDirection of DIRECTION_ORDER)
          for (const inversion of INVERSION_ORDER) {
            const f: Omit<ChordFrame, "kind"> = {
              key: { root: 6, scale },
              degree: 5,
              joystickMode,
              joystickDirection,
              inversion,
              octave: 3,
              voiceLeading: true,
              voicing: { notes: [54, 58, 61], bassNote: 42 },
            };
            expect(decode(encodeChord(f))).toEqual({ kind: "chord", ...f });
          }
  });
});

describe("chordwire 7-bit safety", () => {
  it("clamps out-of-range notes below the SysEx status range", () => {
    const bytes = encodeChord({ ...cMajI, voicing: { notes: [-3, 200] } });
    expect(bytes.slice(1, -1).every((b) => b < 0x80)).toBe(true);
  });
});

describe("chordwire rejection of foreign/malformed input", () => {
  const good = encodeChord(cMajI);

  it("rejects non-ChordLink data", () => {
    expect(decode([])).toBeNull();
    expect(decode([0x90, 60, 100])).toBeNull(); // channel voice, not SysEx
    expect(decode([0xf0, 0x7d, 0xf7])).toBeNull(); // too short
    expect(decode([0xf0, 0x43, 0x50, 0x46, 0x01, 0x02, 0xf7])).toBeNull(); // foreign mfr
    expect(decode([0xf0, 0x7d, 0x50, 0x46, 0x02, 0x02, 0xf7])).toBeNull(); // future version
  });

  it("rejects truncated and inconsistent frames", () => {
    expect(decode(good.slice(0, -1))).toBeNull(); // missing F7
    expect(decode([...good.slice(0, -2), 0xf7])).toBeNull(); // note count mismatch
    const badDegree = [...good];
    badDegree[8] = 9;
    expect(decode(badDegree)).toBeNull(); // degree out of range
  });
});

describe("chordwire tables stay in sync with the harmony model", () => {
  it("SCALE_ORDER covers exactly the scales SCALE_INTERVALS knows", () => {
    const known = Object.keys(SCALE_INTERVALS) as ScaleType[];
    expect([...SCALE_ORDER].sort()).toEqual([...known].sort());
    expect(new Set(SCALE_ORDER).size).toBe(SCALE_ORDER.length);
  });

  it("mode/direction/inversion tables are complete", () => {
    expect(MODE_ORDER).toHaveLength(3);
    expect(DIRECTION_ORDER).toHaveLength(9);
    expect(INVERSION_ORDER).toHaveLength(3);
  });
});
