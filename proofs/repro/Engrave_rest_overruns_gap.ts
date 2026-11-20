// Repro for FAILS_rests_fill_the_gap (proofs/Harmonicland/Engrave.lean).
// Claim (src/outputs/engrave.ts:28 "The gaps in a staff are filled"): the rests in a gap
// add up to the gap.
import { Core } from "/Users/lukesovernconley/Code/harmonicland/src/core";
import { engraveBar, quartersOf } from "/Users/lukesovernconley/Code/harmonicland/src/outputs/engrave";

const vk = (x: { base: number; dots: number; triplet: boolean }) => `${x.base}${x.dots ? "." : ""}${x.triplet ? "t" : ""}`;
// 4/4 at 120. A triplet sixteenth at the barline, [0, 1/6) quarters, then a note from
// q = 5/8 to q = 1: the gap between them is [1/6, 5/8), 11/24 of a quarter.
const s = Core.makeScore([
  { pitch: 60, onset: 0, duration: 1 / 12 },
  { pitch: 64, onset: 5 / 16, duration: 3 / 16 },
], [0, 2]);
const eb = engraveBar(s.notes, s.bars[0]);
const heads = eb.chords.map((c) => [c.q, vk(c.value)]);
const rests = eb.rests.filter((r) => r.staff === "treble");
const first = rests[0];
console.log("input : notes at q in [0, 1/6) and [5/8, 1) of a 4/4 bar; the gap is [1/6, 5/8) = 11/24 quarter");
console.log("actual: chords", JSON.stringify(heads), "rests", JSON.stringify(rests.map((r) => [r.q, vk(r.value)])));
console.log("        the first rest begins at", first.q, "lasts", quartersOf(first.value), "and so ends at", first.q + quartersOf(first.value), "- the next head is at 0.625");
const total = eb.chords.reduce((t, c) => t + quartersOf(c.value), 0) + rests.reduce((t, r) => t + quartersOf(r.value), 0);
console.log("        heads + rests on the treble staff add up to", total, "quarters in a bar of", eb.quarters);
console.log("claim : the rest in the gap lasts 11/24 =", 11 / 24, "and the staff adds up to 4");
console.log(Math.abs(quartersOf(first.value) - 11 / 24) < 1e-6 ? "CLAIM HOLDS" : "CLAIM FAILS");
