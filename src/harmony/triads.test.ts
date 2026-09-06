/* Triads: identifying a sonority, and naming the single move between two of
   them. `triadName` and `neoTransform` are exercised through their long-
   standing home in outputs/tonnetz.test.ts; what is new here is recognising a
   triad in the first place and reading a P/L/R off a pair of them. */
import { describe, it, expect } from "vitest";
import { neoRelation, triadClasses, triadOf, type Triad } from "./triads";

const C: Triad = { root: 0, quality: "maj" };
const Cm: Triad = { root: 0, quality: "min" };
const Am: Triad = { root: 9, quality: "min" };
const Em: Triad = { root: 4, quality: "min" };

describe("triadOf", () => {
  it("recognises major and minor in any inversion, octave or doubling", () => {
    expect(triadOf([60, 64, 67])).toEqual(C);
    expect(triadOf([64, 67, 72])).toEqual(C); // first inversion
    expect(triadOf([48, 60, 64, 67, 79])).toEqual(C); // doubled root and fifth
    expect(triadOf([57, 60, 64])).toEqual(Am);
    expect(triadOf([60, 63, 67])).toEqual(Cm);
  });

  it("refuses anything that is not a consonant triad", () => {
    expect(triadOf([60, 63, 66])).toBeNull(); // diminished
    expect(triadOf([60, 64, 68])).toBeNull(); // augmented
    expect(triadOf([60, 64, 67, 70])).toBeNull(); // seventh — four classes
    expect(triadOf([60, 67])).toBeNull(); // two classes
    expect(triadOf([60, 72])).toBeNull(); // one class
    expect(triadOf([])).toBeNull();
  });

  it("gives the classes back in role order", () => {
    expect(triadClasses(C)).toEqual([0, 4, 7]);
    expect(triadClasses(Am)).toEqual([9, 0, 4]);
  });
});

describe("neoRelation", () => {
  it("names each of the three transforms by the tones they keep", () => {
    expect(neoRelation(C, Cm)).toMatchObject({ transform: "P", kept: ["root", "fifth"] });
    expect(neoRelation(C, Am)).toMatchObject({ transform: "R", kept: ["root", "third"] });
    expect(neoRelation(C, Em)).toMatchObject({ transform: "L", kept: ["third", "fifth"] });
  });

  it("reports the voice that moves, and where it lands", () => {
    expect(neoRelation(C, Am)).toMatchObject({ from: 7, to: 9 }); // G rises to A
    expect(neoRelation(C, Cm)).toMatchObject({ from: 4, to: 3 }); // E falls to E-flat
  });

  it("is an involution: every transform undoes itself", () => {
    for (const [a, b] of [[C, Cm], [C, Am], [C, Em]] as const) {
      const there = neoRelation(a, b)!;
      const back = neoRelation(b, a)!;
      expect(back.transform).toBe(there.transform);
      expect(back.from).toBe(there.to);
      expect(back.to).toBe(there.from);
    }
  });

  it("is null when no single move connects the two triads", () => {
    expect(neoRelation(C, { root: 7, quality: "maj" })).toBeNull(); // same quality
    expect(neoRelation(C, C)).toBeNull();
    expect(neoRelation(C, { root: 2, quality: "min" })).toBeNull(); // no common tone
    expect(neoRelation(C, { root: 5, quality: "min" })).toBeNull(); // only one common tone
  });

  it("finds exactly three neighbours for every triad, and no more", () => {
    // The claim the implementation rests on: two common tones plus a quality
    // flip identifies P, L and R uniquely, so a relation is never guessed.
    for (let root = 0; root < 12; root++)
      for (const quality of ["maj", "min"] as const) {
        const from = { root, quality };
        const found = new Set<string>();
        for (let r = 0; r < 12; r++) {
          const rel = neoRelation(from, { root: r, quality: quality === "maj" ? "min" : "maj" });
          if (rel) found.add(rel.transform);
        }
        expect([...found].sort()).toEqual(["L", "P", "R"]);
      }
  });
});
