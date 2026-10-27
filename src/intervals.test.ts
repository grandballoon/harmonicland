import { describe, it, expect } from "vitest";
import { INTERVALS, describe as describeRel, isRelation, label, relativesOf, relationKey } from "./intervals";

describe("relativesOf", () => {
  it("lands each relation on its key, lowest first", () => {
    const got = relativesOf(60, [
      { semitones: 4, dir: "up" },
      { semitones: 8, dir: "down" },
    ]);
    expect(got).toEqual([
      { pitch: 52, name: "m6", dir: "down" },
      { pitch: 64, name: "M3", dir: "up" },
    ]);
  });

  it("leaves out a relation that falls off the 88 keys", () => {
    expect(relativesOf(22, [{ semitones: 3, dir: "down" }, { semitones: 3, dir: "up" }]))
      .toEqual([{ pitch: 25, name: "m3", dir: "up" }]);
    expect(relativesOf(106, [{ semitones: 5, dir: "up" }])).toEqual([]);
  });

  it("raises nothing with no relations chosen", () => {
    expect(relativesOf(60, [])).toEqual([]);
  });
});

describe("the interval catalogue", () => {
  it("names every simple interval once, a semitone to an octave", () => {
    expect(INTERVALS.map((i) => i.semitones)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(new Set(INTERVALS.map((i) => i.name)).size).toBe(12);
  });

  it("labels and describes a relation", () => {
    expect(label({ semitones: 7, dir: "down" })).toBe("P5↓");
    expect(describeRel({ semitones: 6, dir: "up" })).toBe("tritone up");
  });

  it("keys a relation by value", () => {
    expect(relationKey({ semitones: 4, dir: "up" })).toBe(relationKey({ semitones: 4, dir: "up" }));
    expect(relationKey({ semitones: 4, dir: "up" })).not.toBe(relationKey({ semitones: 4, dir: "down" }));
  });

  it("recognises only relations it names", () => {
    expect(isRelation({ semitones: 4, dir: "up" })).toBe(true);
    expect(isRelation({ semitones: 13, dir: "up" })).toBe(false);
    expect(isRelation({ semitones: 4, dir: "sideways" })).toBe(false);
    expect(isRelation(null)).toBe(false);
  });
});
