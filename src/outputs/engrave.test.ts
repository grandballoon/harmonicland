import { describe, it, expect } from "vitest";
import { Core } from "../core";
import { engraveBar, keyAccidental, printedAt, snap, spellIn, staffOf, valuesFor, type Value } from "./engrave";
import type { Barline, Hand, RawNote, Score } from "../types";

/* engrave.ts turns seconds back into notation. Everything here is a fact
   about that derivation and nothing else — no pixels, no DOM — which is
   the reason it is a module apart from the page that draws it. */

const n = (pitch: number, onset: number, duration: number, hand?: Hand): RawNote =>
  ({ pitch, onset, duration, ...(hand && { hand }) });

/** Bars of 4/4 at 120bpm: a quarter is half a second, a bar two. */
const bars44: Barline[] = [0, 2, 4, 6, 8];
const scoreOf = (raw: RawNote[], barlines: Barline[] = bars44): Score => Core.makeScore(raw, barlines);

/** A value as a short name: "4" a quarter, "8." a dotted eighth, "8t" a
 *  triplet eighth. */
const vk = (v: Value): string => `${v.base}${v.dots ? "." : ""}${v.triplet ? "t" : ""}`;

describe("values", () => {
  const names = (len: number) => valuesFor(len).map(vk);

  it("names the straight values", () => {
    expect(names(4)).toEqual(["1"]);
    expect(names(2)).toEqual(["2"]);
    expect(names(1)).toEqual(["4"]);
    expect(names(0.5)).toEqual(["8"]);
    expect(names(0.25)).toEqual(["16"]);
    expect(names(0.125)).toEqual(["32"]);
  });

  it("dots a value and a half", () => {
    expect(names(3)).toEqual(["2."]);
    expect(names(1.5)).toEqual(["4."]);
    expect(names(0.75)).toEqual(["8."]);
  });

  it("ties what one value cannot say, largest first", () => {
    expect(names(1.25)).toEqual(["4", "16"]);
    expect(names(2.5)).toEqual(["2", "8"]);
    expect(names(3.5)).toEqual(["2.", "8"]);
  });

  it("writes a triplet length in triplet values", () => {
    expect(names(1 / 3)).toEqual(["8t"]);
    expect(names(2 / 3)).toEqual(["4t"]);
  });

  it("snaps to the nearer of the straight and triplet grids", () => {
    expect(snap(0.94)).toBe(1); // a played quarter, a little short
    expect(snap(0.26)).toBe(0.25);
    expect(snap(0.17)).toBeCloseTo(1 / 6, 9);
    expect(snap(0.34)).toBeCloseTo(1 / 3, 9);
  });
});

describe("heads", () => {
  it("gives each note its value, in order", () => {
    const s = scoreOf([n(60, 0, 0.5), n(62, 0.5, 0.25), n(64, 0.75, 0.25), n(65, 1, 1)]);
    const eb = engraveBar(s.notes, s.bars[0]);
    expect(eb.chords.map((c) => vk(c.value))).toEqual(["4", "8", "8", "2"]);
    expect(eb.chords.map((c) => c.q)).toEqual([0, 1, 1.5, 2]);
  });

  it("puts a note on its hand's staff, or by pitch when it has none", () => {
    expect(staffOf(scoreOf([n(48, 0, 1, "upper")]).notes[0])).toBe("treble");
    expect(staffOf(scoreOf([n(72, 0, 1, "lower")]).notes[0])).toBe("bass");
    expect(staffOf(scoreOf([n(60, 0, 1)]).notes[0])).toBe("treble");
    expect(staffOf(scoreOf([n(59, 0, 1)]).notes[0])).toBe("bass");
  });

  it("strikes a chord as one stem and sorts its heads upward", () => {
    const s = scoreOf([n(67, 0, 1), n(60, 0, 1), n(64, 0, 1)]);
    const eb = engraveBar(s.notes, s.bars[0]);
    expect(eb.chords).toHaveLength(1);
    expect(eb.chords[0].heads.map((h) => h.note.pitch)).toEqual([60, 64, 67]);
  });

  it("stems two values at one instant apart, as two chords", () => {
    const s = scoreOf([n(60, 0, 2), n(67, 0, 0.5)]);
    const eb = engraveBar(s.notes, s.bars[0]);
    expect(eb.chords.map((c) => vk(c.value)).sort()).toEqual(["1", "4"]);
  });

  it("splits a note across the barline and ties the halves", () => {
    // an eighth's worth before the line, an eighth's worth after
    const s = scoreOf([n(60, 1.75, 0.5)]);
    const a = engraveBar(s.notes, s.bars[0]).chords[0];
    const b = engraveBar(s.notes, s.bars[1]).chords[0];
    expect([a.q, vk(a.value), a.heads[0].tiedTo, a.heads[0].tiedFrom]).toEqual([3.5, "8", true, false]);
    expect([b.q, vk(b.value), b.heads[0].tiedTo, b.heads[0].tiedFrom]).toEqual([0, "8", false, true]);
  });

  it("ties the values of a length no single value says", () => {
    const s = scoreOf([n(60, 0, 0.625)]); // a quarter and a sixteenth
    const heads = engraveBar(s.notes, s.bars[0]).chords.map((c) => c.heads[0]);
    expect(heads.map((h) => [h.q, vk(h.value), h.tiedTo])).toEqual([[0, "4", true], [1, "16", false]]);
  });

  it("keeps a note that ends a hair past the line in its own bar", () => {
    const s = scoreOf([n(60, 1.5, 0.51)]);
    expect(engraveBar(s.notes, s.bars[0]).chords[0].heads[0].tiedTo).toBe(false);
    expect(engraveBar(s.notes, s.bars[1]).chords).toHaveLength(0);
  });

  it("writes a note too short to quantize as a thirty-second, not nothing", () => {
    const s = scoreOf([n(60, 0, 0.02)]);
    expect(engraveBar(s.notes, s.bars[0]).chords.map((c) => vk(c.value))).toEqual(["32"]);
  });
});

describe("rests", () => {
  const rests = (s: Score, bar = 0, staff = "treble") =>
    engraveBar(s.notes, s.bars[bar]).rests.filter((r) => r.staff === staff).map((r) => [r.q, vk(r.value)]);

  it("fills the gaps between notes", () => {
    const s = scoreOf([n(60, 0, 0.5), n(62, 1.5, 0.5)]);
    expect(rests(s)).toEqual([[1, "4"], [2, "4"]]);
  });

  it("splits a rest at the beat rather than writing one across it", () => {
    const s = scoreOf([n(60, 0, 0.25), n(62, 0.75, 1.25)]);
    expect(rests(s)).toEqual([[0.5, "8"], [1, "8"]]);
  });

  it("rests to the end of the bar", () => {
    const s = scoreOf([n(60, 0, 1)]);
    expect(rests(s)).toEqual([[2, "4"], [3, "4"]]);
  });

  it("gives a staff with nothing in the bar one whole rest", () => {
    const s = scoreOf([n(60, 0, 2, "upper")]);
    const eb = engraveBar(s.notes, s.bars[0]);
    expect(eb.rests).toEqual([{ staff: "bass", q: 0, value: { base: 1, dots: 0, triplet: false }, whole: true }]);
  });

  it("feels the beat as a dotted quarter in 6/8", () => {
    // 6/8 at 120: a bar is three quarters, 1.5s
    const s = scoreOf([n(60, 0, 0.25)], [{ at: 0, beats: 6, unit: 8 }, 1.5, 3]);
    expect(rests(s)).toEqual([[0.5, "4"], [1.5, "4."]]);
  });
});

describe("beams", () => {
  const beams = (s: Score) => engraveBar(s.notes, s.bars[0]).beams.map((g) => g.map((c) => c.q));

  it("beams the eighths of each beat together", () => {
    const s = scoreOf([n(60, 0, 0.25), n(62, 0.25, 0.25), n(64, 0.5, 0.25), n(65, 0.75, 0.25)]);
    expect(beams(s)).toEqual([[0, 0.5], [1, 1.5]]);
  });

  it("beams sixteenths under the same beam as their eighth", () => {
    const s = scoreOf([n(60, 0, 0.25), n(62, 0.25, 0.125), n(64, 0.375, 0.125)]);
    expect(beams(s)).toEqual([[0, 0.5, 0.75]]);
  });

  it("does not beam across a gap", () => {
    const s = scoreOf([n(60, 0, 0.25), n(62, 0.375, 0.125)]); // eighth, sixteenth rest, sixteenth
    expect(beams(s)).toEqual([]);
  });

  it("beams three eighths to the dotted-quarter beat in 6/8", () => {
    const s = scoreOf(
      [n(60, 0, 0.25), n(62, 0.25, 0.25), n(64, 0.5, 0.25), n(65, 0.75, 0.25), n(67, 1, 0.25), n(69, 1.25, 0.25)],
      [{ at: 0, beats: 6, unit: 8 }, 1.5, 3],
    );
    expect(beams(s)).toEqual([[0, 0.5, 1], [1.5, 2, 2.5]]);
  });

  it("leaves quarters and longer unbeamed, and never beams across them", () => {
    const s = scoreOf([n(60, 0, 0.25), n(62, 0.25, 0.5), n(64, 0.75, 0.25)]);
    expect(beams(s)).toEqual([]);
  });

  it("beams each staff on its own", () => {
    const s = scoreOf([n(72, 0, 0.25, "upper"), n(48, 0.25, 0.25, "lower")]);
    expect(beams(s)).toEqual([]);
  });
});

describe("accidentals", () => {
  const sharp = (pitch: number, onset: number, duration = 0.5): RawNote =>
    ({ pitch, onset, duration, spelling: { letter: "C", acc: "#" } });
  const natural = (pitch: number, onset: number, letter: "C" | "F" = "C", duration = 0.5): RawNote =>
    ({ pitch, onset, duration, spelling: { letter, acc: "" } });
  const printed = (s: Score, bar = 0) =>
    engraveBar(s.notes, s.bars[bar]).chords.map((c) => c.heads[0].acc);
  const inKey = (fifths: number): Barline[] => [{ at: 0, fifths }, 2, 4];

  it("prints an accidental the key does not imply", () => {
    expect(printed(scoreOf([sharp(61, 0)]))).toEqual(["#"]);
  });

  it("prints nothing the key signature already says", () => {
    expect(printed(scoreOf([sharp(61, 0)], inKey(2)))).toEqual([""]); // D major has C♯
  });

  it("prints a natural against the key", () => {
    expect(printed(scoreOf([natural(60, 0)], inKey(2)))).toEqual(["n"]);
  });

  it("states an accidental once a bar, and cancels it when the note returns", () => {
    expect(printed(scoreOf([sharp(61, 0), sharp(61, 0.5), natural(60, 1)]))).toEqual(["#", "", "n"]);
  });

  it("starts each bar afresh", () => {
    const s = scoreOf([sharp(61, 0), sharp(61, 2)]);
    expect(printed(s, 0)).toEqual(["#"]);
    expect(printed(s, 1)).toEqual(["#"]);
  });

  it("keys the rule by octave, as the convention has it", () => {
    expect(printed(scoreOf([sharp(61, 0), sharp(73, 0.5)]))).toEqual(["#", "#"]);
  });

  it("never restates an accidental on a tied-over head", () => {
    const s = scoreOf([sharp(61, 1.5, 1)]);
    expect(printed(s, 0)).toEqual(["#"]);
    expect(printed(s, 1)).toEqual([""]);
  });

  it("reads the key signature round the circle", () => {
    expect(["F", "C", "G", "D"].map((l) => keyAccidental(2, l as "F"))).toEqual(["#", "#", "", ""]);
    expect(["B", "E", "A", "D"].map((l) => keyAccidental(-3, l as "B"))).toEqual(["b", "b", "b", ""]);
    expect(keyAccidental(0, "F")).toBe("");
  });
});

describe("columns", () => {
  it("lists every instant something begins on either staff, once, in order", () => {
    const s = scoreOf([n(72, 0, 0.5, "upper"), n(48, 0, 0.5, "lower"), n(50, 0.5, 0.25, "lower"), n(74, 1, 0.5, "upper")]);
    const eb = engraveBar(s.notes, s.bars[0]);
    // treble: a quarter, a quarter rest, a quarter, a quarter rest;
    // bass: a quarter, an eighth, an eighth rest, two quarter rests
    expect(eb.columns.map((c) => c.q)).toEqual([0, 1, 1.5, 2, 3]);
    expect(eb.columns.map((c) => c.t)).toEqual([0, 0.5, 0.75, 1, 1.5]);
  });

  it("flags a column that needs room for an accidental", () => {
    const s = scoreOf([{ pitch: 61, onset: 0.5, duration: 0.5, spelling: { letter: "C", acc: "#" } }]);
    const eb = engraveBar(s.notes, s.bars[0]);
    expect(eb.columns.find((c) => c.q === 1)?.accidentals).toBe(true);
    expect(eb.columns.find((c) => c.q === 0)?.accidentals).toBe(false);
  });
});

describe("a pitch the score never spelled", () => {
  it("is spelled as the key signature says when it says so", () => {
    expect(spellIn(66, 2)).toEqual({ letter: "F", acc: "#", octave: 4 }); // D major
    expect(spellIn(70, -1)).toEqual({ letter: "B", acc: "b", octave: 4 }); // F major
    expect(spellIn(63, -3)).toEqual({ letter: "E", acc: "b", octave: 4 }); // E♭ major
  });

  it("is spelled by the key's side of the circle otherwise", () => {
    expect(spellIn(61, 0)).toEqual({ letter: "C", acc: "#", octave: 4 });
    expect(spellIn(61, -1)).toEqual({ letter: "D", acc: "b", octave: 4 });
    expect(spellIn(65, 2)).toEqual({ letter: "F", acc: "", octave: 4 }); // F natural in D
  });

  it("prints what the key and the bar so far do not already say", () => {
    const bar: Barline[] = [{ at: 0, fifths: 2 }, 2];
    const s = Core.makeScore([{ pitch: 65, onset: 1, duration: 0.5 }], bar);
    const eb = engraveBar(s.notes, s.bars[0]);
    const f = spellIn(65, 2);
    expect(printedAt(eb, 0, f)).toBe("n"); // before the F natural: the key's F♯ holds
    expect(printedAt(eb, 2, f)).toBe(""); // after it, the natural does
    expect(printedAt(eb, 2, spellIn(66, 2))).toBe("#"); // and an F♯ now has to say so
  });
});
