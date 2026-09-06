/* Piano geometry: the keyboard's own facts. Small enough to test totally, so
   the sweeps below are exhaustive rather than sampled — every one of the 88
   keys is named, named uniquely, and named near something the hand can feel. */
import { describe, it, expect } from "vitest";
import {
  LOWEST,
  HIGHEST,
  isBlack,
  octaveOf,
  blackGroup,
  landmarkFor,
  describeKey,
  whiteSteps,
} from "./piano-geometry";

const board = Array.from({ length: HIGHEST - LOWEST + 1 }, (_, i) => LOWEST + i);

/** The five black keys of an octave, as pitch classes: C#, D#, F#, G#, A#. */
const BLACK_CLASSES = [1, 3, 6, 8, 10];

describe("isBlack", () => {
  it("matches the pattern across the octave above middle C", () => {
    expect([60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71].map(isBlack)).toEqual([
      false, true, false, true, false, false, true, false, true, false, true, false,
    ]);
  });

  it("repeats that pattern in every octave of the board", () => {
    for (const p of board) expect(isBlack(p)).toBe(BLACK_CLASSES.includes(p % 12));
  });
});

describe("octaveOf", () => {
  it("puts middle C in octave 4 and turns over at every C", () => {
    expect(octaveOf(60)).toBe(4);
    expect(octaveOf(71)).toBe(4);
    expect(octaveOf(72)).toBe(5);
    expect(octaveOf(59)).toBe(3);
    expect(octaveOf(21)).toBe(0);
  });
});

describe("blackGroup", () => {
  it("puts C#/D# in the group of two and F#/G#/A# in the group of three", () => {
    expect(blackGroup(61)).toEqual({ size: 2, index: 0 });
    expect(blackGroup(63)).toEqual({ size: 2, index: 1 });
    expect(blackGroup(66)).toEqual({ size: 3, index: 0 });
    expect(blackGroup(68)).toEqual({ size: 3, index: 1 });
    expect(blackGroup(70)).toEqual({ size: 3, index: 2 });
  });

  it("is null for white keys and non-null for black ones, everywhere", () => {
    for (const p of board) expect(blackGroup(p) === null).toBe(!isBlack(p));
  });

  it("groups the same way in every octave", () => {
    for (const p of board) expect(blackGroup(p)).toEqual(blackGroup(p % 12));
  });
});

describe("describeKey", () => {
  it("names middle C and the Cs around it as landmarks in their own right", () => {
    expect(describeKey(60)).toBe("middle C");
    expect(describeKey(72)).toBe("the C an octave above middle C");
    expect(describeKey(48)).toBe("the C an octave below middle C");
    expect(describeKey(84)).toBe("the C two octaves above middle C");
  });

  it("names 61 as the first black key right of middle C", () => {
    expect(describeKey(61)).toBe("the first black key of the group of two above middle C");
  });

  it("names a white key by the group it sits beside", () => {
    expect(describeKey(65)).toBe("the white key just left of the group of three above middle C");
    expect(describeKey(64)).toBe("the white key just right of the group of two above middle C");
    expect(describeKey(62)).toBe(
      "the white key between the two black keys of the group of two above middle C",
    );
  });

  it("falls back to an absolute name only where the group runs off the board", () => {
    // A0, A#0 and B0 lean on a group of three whose lower two keys do not
    // exist; the hand would feel one stray black key, not a group.
    expect(describeKey(21)).toBe("A four octaves below middle C");
    expect(describeKey(22)).toBe("B-flat four octaves below middle C");
    expect(describeKey(23)).toBe("B four octaves below middle C");
    // Every landmark-relative name points at a landmark and so begins with
    // "the"; only "middle C" and the absolute fallbacks do not.
    const isAbsolute = (p: number) =>
      !describeKey(p).startsWith("the ") && describeKey(p) !== "middle C";
    expect(board.filter(isAbsolute)).toEqual([21, 22, 23]);
  });

  it("describes every key on the board, and never twice the same way", () => {
    const names = board.map(describeKey);
    for (const name of names) expect(name.length).toBeGreaterThan(0);
    expect(new Set(names).size).toBe(board.length);
  });
});

describe("landmarkFor", () => {
  it("returns the key itself when the key is a landmark", () => {
    for (const p of [60, 61, 63, 66, 70, 72]) {
      expect(landmarkFor(p)).toMatchObject({ pitch: p, offset: 0 });
    }
  });

  it("never sends the hand more than two semitones from something feelable", () => {
    for (const p of board) {
      const l = landmarkFor(p);
      expect(Math.abs(l.offset)).toBeLessThanOrEqual(2);
      expect(l.pitch + l.offset).toBe(p);
      expect(l.pitch).toBeGreaterThanOrEqual(LOWEST);
      expect(l.pitch).toBeLessThanOrEqual(HIGHEST);
      expect(l.name).toBe(describeKey(l.pitch));
    }
  });

  it("breaks a tie towards the C, then towards the lower key", () => {
    expect(landmarkFor(71).pitch).toBe(72); // B4: C5 and A#4 are both a semitone away
    expect(landmarkFor(68).pitch).toBe(66); // G#4: both group-of-three edges are two away
  });
});

describe("whiteSteps", () => {
  it("counts white keys and is signed", () => {
    expect(whiteSteps(60, 67)).toBe(4);
    expect(whiteSteps(67, 60)).toBe(-4);
    expect(whiteSteps(60, 60)).toBe(0);
    expect(whiteSteps(60, 72)).toBe(7);
  });

  it("puts a black key on the same ruler as the white key below it", () => {
    expect(whiteSteps(60, 61)).toBe(0); // C to C# is no slide at all
    expect(whiteSteps(61, 62)).toBe(1);
  });
});
