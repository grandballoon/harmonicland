import { describe, it, expect } from "vitest";
import {
  computeVoicing,
  degreeQuality,
  chordName,
  type Key,
  type Degree,
  type ComputeVoicingArgs,
} from "./perfecto";

const C_MAJOR: Key = { root: 0, scale: "major" };

// a sensible default arg set; tests override the field under examination
const args = (over: Partial<ComputeVoicingArgs>): ComputeVoicingArgs => ({
  key: C_MAJOR,
  degree: 1,
  joystickMode: "default",
  joystickDirection: "center",
  inversion: "root",
  octave: 4,
  voiceLeading: false,
  previousVoicing: null,
  ...over,
});

const pcSet = (notes: number[]) => new Set(notes.map((n) => ((n % 12) + 12) % 12));

describe("computeVoicing — quality is detected from the diatonic 3rd/5th", () => {
  it("I in C major is a major triad (C E G) at octave 4", () => {
    expect(computeVoicing(args({ degree: 1 })).notes).toEqual([60, 64, 67]);
  });
  it("ii is minor (D F A) — 3rd is 3 semitones", () => {
    expect(computeVoicing(args({ degree: 2 })).notes).toEqual([62, 65, 69]);
  });
  it("vii° is diminished (B D F) — minor 3rd AND diminished 5th", () => {
    expect(computeVoicing(args({ degree: 7 })).notes).toEqual([71, 74, 77]);
  });
});

describe("degreeQuality — the shared major/minor/dim rule", () => {
  it("matches the classic major-scale pattern I–vii°", () => {
    const q = ([1, 2, 3, 4, 5, 6, 7] as Degree[]).map((d) => degreeQuality(C_MAJOR, d));
    expect(q).toEqual(["maj", "min", "min", "maj", "maj", "min", "dim"]);
  });
  it("differs by scale — natural minor starts minor", () => {
    const Am: Key = { root: 9, scale: "naturalMinor" };
    expect(degreeQuality(Am, 1)).toBe("min");
    expect(degreeQuality(Am, 2)).toBe("dim"); // ii° in natural minor
  });
});

describe("computeVoicing — short-scale wrapping is load-bearing", () => {
  const pent: Key = { root: 0, scale: "majorPentatonic" }; // [0,2,4,7,9], n=5

  it("stacks thirds past the end of a 5-note scale without crashing", () => {
    // degree 4 (degIdx 3): 3rd/5th steps run off the array and octave-wrap
    const notes = computeVoicing(args({ key: pent, degree: 4 })).notes;
    expect(notes).toEqual([67, 71, 74]); // root G4 (=60+7), major-detected
  });

  it("wraps the chord ROOT itself into the next octave for high degrees", () => {
    // degree 6 (degIdx 5): scale[5%5] + floor(5/5)*12 = 0 + 12 → root C5
    const notes = computeVoicing(args({ key: pent, degree: 6 })).notes;
    expect(notes[0]).toBe(72); // 60 + 12
  });
});

describe("computeVoicing — joystick coloration selects the interval list", () => {
  it("default 'up' flips quality: I (major) gets the minor-shaped list [0,3,7]", () => {
    expect(computeVoicing(args({ degree: 1, joystickDirection: "up" })).notes)
      .toEqual([60, 63, 67]);
  });

  it("default 'upRight' adds a dom7 on a major degree", () => {
    expect(computeVoicing(args({ degree: 1, joystickDirection: "upRight" })).notes)
      .toEqual([60, 64, 67, 70]);
  });

  it("a quality-forcing cell uses the same intervals regardless of degree", () => {
    // chromatic 'up' (minMaj7) collapses major/minor/dim all to [0,3,7,11]
    const onI = computeVoicing(args({ degree: 1, joystickMode: "chromatic", joystickDirection: "up" }));
    const onII = computeVoicing(args({ degree: 2, joystickMode: "chromatic", joystickDirection: "up" }));
    const rel = (notes: number[]) => notes.map((n) => n - notes[0]);
    expect(rel(onI.notes)).toEqual([0, 3, 7, 11]);
    expect(rel(onII.notes)).toEqual([0, 3, 7, 11]);
  });
});

describe("computeVoicing — inversions raise the lowest voice(s) an octave", () => {
  it("first inversion raises the lowest note", () => {
    expect(computeVoicing(args({ degree: 1, inversion: "first" })).notes)
      .toEqual([64, 67, 72]);
  });
  it("second inversion raises the lowest two", () => {
    expect(computeVoicing(args({ degree: 1, inversion: "second" })).notes)
      .toEqual([67, 72, 76]);
  });
});

describe("computeVoicing — voice-leading keeps chord content, minimizes motion", () => {
  it("preserves the pitch-class set while landing nearer the previous voicing", () => {
    const prev = { notes: [76, 79, 84] }; // a high C-ish triad
    const plain = computeVoicing(args({ degree: 1 })).notes;
    const led = computeVoicing(args({ degree: 1, voiceLeading: true, previousVoicing: prev })).notes;
    // still a C-major triad (same classes), just revoiced
    expect(pcSet(led)).toEqual(pcSet(plain));
    // and closer to prev than the root-position default would be
    const cost = (c: number[]) =>
      c.reduce((s, n) => s + Math.min(...prev.notes.map((r) => Math.abs(n - r))), 0);
    expect(cost(led)).toBeLessThanOrEqual(cost(plain));
  });
});

describe("chordName", () => {
  it("names center chords by degree convention", () => {
    expect(chordName(C_MAJOR, 1, "default", "center")).toBe("C maj");
    expect(chordName(C_MAJOR, 2, "default", "center")).toBe("D min");
    expect(chordName(C_MAJOR, 7, "default", "center")).toBe("B dim");
  });
  it("appends the joystick quality label off-center", () => {
    expect(chordName(C_MAJOR, 1, "default", "right")).toBe("C maj7");
    expect(chordName(C_MAJOR, 5, "extended", "upRight")).toBe("G dom9");
  });
});
