/* Guitar geometry: the neck as data, and the one-to-many map that makes a
   guitar a different problem from a keyboard.

   The module is small enough to test totally, so most of these sweep the
   whole neck rather than sampling it — the same standard piano-geometry
   is held to. */
import { describe, it, expect } from "vitest";
import {
  capo, describePosition, DROP_D, FRETS, ordinal, pitchAt, positionsFor, STANDARD, stringNumber,
} from "./guitar-geometry";

const pitches = (pitch: number, tuning = STANDARD) =>
  positionsFor(pitch, tuning).map((p) => `${p.string}:${p.fret}`);

describe("positionsFor", () => {
  it("gives the bottom E exactly one place, and a mid-range pitch several", () => {
    // E2 is the lowest note on the instrument: no string can reach below it.
    expect(pitches(40)).toEqual(["0:0"]);
    // E4 is the open first string, and three more strings reach it: the
    // lowest two would need a 24th and a 19th fret, and this neck has 15.
    expect(pitches(64)).toEqual(["2:14", "3:9", "4:5", "5:0"]);
  });

  it("every position it returns really sounds the pitch asked for", () => {
    for (let pitch = 0; pitch <= 127; pitch++)
      for (const pos of positionsFor(pitch))
        expect(pitchAt(STANDARD, pos.string, pos.fret)).toBe(pitch);
  });

  it("covers exactly the neck, and nothing off it", () => {
    // E2 up to the 15th fret of the top string, with no gaps in between —
    // and a piano's bass, which is most of the reason states go unplayable.
    for (let pitch = 40; pitch <= 64 + FRETS; pitch++)
      expect(positionsFor(pitch).length).toBeGreaterThan(0);
    expect(positionsFor(39)).toEqual([]);
    expect(positionsFor(28)).toEqual([]); // the prelude's lowest note
    expect(positionsFor(64 + FRETS + 1)).toEqual([]);
  });

  it("returns positions lowest string first", () => {
    const ss = positionsFor(64).map((p) => p.string);
    expect(ss).toEqual([...ss].sort((a, b) => a - b));
  });
});

describe("tuning is the only input", () => {
  it("drop D reaches a whole tone lower, and only on the string that changed", () => {
    expect(pitches(38, DROP_D)).toEqual(["0:0"]);
    expect(pitches(38)).toEqual([]); // standard cannot play it at all
    // The low E is now stopped rather than open; every other string is
    // untouched, so its positions are exactly the standard ones.
    expect(pitches(40, DROP_D)).toEqual(["0:2"]);
    expect(pitches(59, DROP_D).slice(1)).toEqual(pitches(59).slice(1));
  });

  it("a capo shifts every position by its own fret", () => {
    const capo2 = capo(STANDARD, 2);
    // A player counts frets from the capo, which is exactly what falls out:
    // a pitch sits where the pitch two semitones lower sat before.
    for (let pitch = 42; pitch <= 79; pitch++)
      expect(positionsFor(pitch, capo2)).toEqual(positionsFor(pitch - 2));
    expect(positionsFor(40, capo2)).toEqual([]); // the capo took the open E away
  });
});

describe("naming", () => {
  it("numbers strings the way a player does, high string first", () => {
    expect(stringNumber(STANDARD, 0)).toBe(6);
    expect(stringNumber(STANDARD, 5)).toBe(1);
  });

  it("says open rather than the 0th fret", () => {
    expect(describePosition(STANDARD, { string: 0, fret: 0 })).toBe("the 6th string, open");
    expect(describePosition(STANDARD, { string: 4, fret: 3 })).toBe("the 2nd string, 3rd fret");
  });

  it("ordinals every fret on the neck", () => {
    expect([1, 2, 3, 5, 12].map(ordinal)).toEqual(["1st", "2nd", "3rd", "5th", "12th"]);
    for (let f = 1; f <= FRETS; f++) expect(ordinal(f)).toMatch(/^\d+(st|nd|rd|th)$/);
  });
});
