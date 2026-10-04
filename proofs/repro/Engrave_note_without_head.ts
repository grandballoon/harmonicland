// Repro for FAILS_every_note_in_the_bar_has_a_head (proofs/Harmonicland/Engrave.lean).
// Claim (src/outputs/engrave.test.ts:107 "writes a note too short to quantize as a
// thirty-second, not nothing"; engrave.ts:248 "too short to say: a thirty-second").
import { Core } from "/Users/lukesovernconley/Code/harmonicland/src/core";
import { engraveBar, valuesFor } from "/Users/lukesovernconley/Code/harmonicland/src/outputs/engrave";

const vk = (x: { base: number; dots: number; triplet: boolean }) => `${x.base}${x.dots ? "." : ""}${x.triplet ? "t" : ""}`;
// One 4/4 bar at 120 (2 s). A note from q = 1/6 (a triplet sixteenth) to q = 1/4:
// onset 1/12 s, 1/24 s long (about 42 ms).
const s = Core.makeScore([{ pitch: 60, onset: 1 / 12, duration: 1 / 24 }], [0, 2]);
const eb = engraveBar(s.notes, s.bars[0]);
console.log("input : one note, pitch 60, onset 1/12 s, duration 1/24 s, in the bar [0, 2) of 4/4");
console.log("        valuesFor(1/4 - 1/6) =", JSON.stringify(valuesFor(1 / 4 - 1 / 6)));
console.log("actual: chords =", JSON.stringify(eb.chords.map((c) => [c.q, vk(c.value)])),
  " treble rests =", JSON.stringify(eb.rests.filter((r) => r.staff === "treble").map((r) => [r.q, r.whole ? "whole" : vk(r.value)])));
console.log("claim : one chord, the note's head (at least a thirty-second)");
console.log(eb.chords.length >= 1 ? "CLAIM HOLDS" : "CLAIM FAILS");

// The same on WRITTEN music: six triplet thirty-seconds on the first beat (a sextuplet of
// 32nds), each 1/12 of a quarter = 1/24 s at 120.
const six = Core.makeScore([0, 1, 2, 3, 4, 5].map((k) => ({ pitch: 60 + k, onset: k / 24, duration: 1 / 24 })), [0, 2]);
const eb6 = engraveBar(six.notes, six.bars[0]);
const drawn = eb6.chords.flatMap((c) => c.heads.map((h) => [h.note.pitch, h.q, vk(h.value)]));
console.log("input : six notes, pitches 60..65, onsets k/24 s, each 1/24 s (triplet thirty-seconds on beat 1)");
console.log("actual: heads [pitch, q, value] =", JSON.stringify(drawn));
console.log("claim : six heads, one per note");
console.log(drawn.length === 6 ? "CLAIM HOLDS" : `CLAIM FAILS (${6 - drawn.length} of 6 notes have no head)`);
