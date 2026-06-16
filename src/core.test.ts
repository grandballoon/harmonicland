import { describe, it, expect } from "vitest";
import { Core } from "./core";

describe("defaultSpelling", () => {
  it("spells naturals with no accidental", () => {
    expect(Core.defaultSpelling(60)).toEqual({ letter: "C", acc: "" }); // middle C
    expect(Core.defaultSpelling(69)).toEqual({ letter: "A", acc: "" }); // A4
  });
  it("spells black keys as sharps (the MIDI default)", () => {
    expect(Core.defaultSpelling(61)).toEqual({ letter: "C", acc: "#" });
    expect(Core.defaultSpelling(70)).toEqual({ letter: "A", acc: "#" });
  });
  it("is octave-invariant and handles negative pitches", () => {
    expect(Core.defaultSpelling(0)).toEqual({ letter: "C", acc: "" });
    expect(Core.defaultSpelling(-11)).toEqual({ letter: "C", acc: "#" }); // ((-11)%12+12)%12 = 1
  });
});

describe("makeScore", () => {
  it("sorts notes by onset", () => {
    const s = Core.makeScore([
      { pitch: 60, onset: 2, duration: 1 },
      { pitch: 62, onset: 0, duration: 1 },
      { pitch: 64, onset: 1, duration: 1 },
    ]);
    expect(s.notes.map((n) => n.onset)).toEqual([0, 1, 2]);
    expect(s.notes.map((n) => n.pitch)).toEqual([62, 64, 60]);
  });

  it("fills a default spelling only when none is given", () => {
    const s = Core.makeScore([
      { pitch: 61, onset: 0, duration: 1 }, // no spelling -> default sharp
      { pitch: 61, onset: 1, duration: 1, spelling: { letter: "D", acc: "b" } },
    ]);
    expect(s.notes[0].spelling).toEqual({ letter: "C", acc: "#" });
    expect(s.notes[1].spelling).toEqual({ letter: "D", acc: "b" }); // preserved
  });

  it("derives duration from the last note's end (onset + duration)", () => {
    const s = Core.makeScore([
      { pitch: 60, onset: 0, duration: 1 },
      { pitch: 62, onset: 0.5, duration: 3 }, // ends at 3.5 — the max
      { pitch: 64, onset: 2, duration: 0.5 },
    ]);
    expect(s.duration).toBe(3.5);
  });

  it("an empty score has zero duration and no notes", () => {
    const s = Core.makeScore([]);
    expect(s.notes).toHaveLength(0);
    expect(s.duration).toBe(0);
  });
});

describe("activeAt", () => {
  const score = Core.makeScore([
    { pitch: 60, onset: 0, duration: 1 },
    { pitch: 64, onset: 0.5, duration: 1 },
  ]);

  it("includes a note at its onset but excludes it at its end (half-open)", () => {
    expect(Core.activeAt(score, 0).map((n) => n.pitch)).toEqual([60]); // onset inclusive
    expect(Core.activeAt(score, 1).map((n) => n.pitch)).toEqual([64]); // 60 ended (exclusive); 64 ends at 1.5
    expect(Core.activeAt(score, 0.75).map((n) => n.pitch)).toEqual([60, 64]); // overlap
  });

  it("returns the same note objects the score holds (identity for audio voices)", () => {
    const [n] = Core.activeAt(score, 0);
    expect(n).toBe(score.notes[0]);
  });
});
