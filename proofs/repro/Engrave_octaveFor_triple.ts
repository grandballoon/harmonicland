// Repro for FAILS_octaveFor_triple (proofs/Harmonicland/Engrave.lean).
// Claim (src/pitch.ts:54): octaveFor gives the octave the LETTER is written in.
import { octaveFor } from "/Users/lukesovernconley/Code/harmonicland/src/pitch";
import { posOf } from "/Users/lukesovernconley/Code/harmonicland/src/outputs/staff-std";

// A with a triple sharp, written in octave 4: the pitch musicxml.ts:164 computes.
const letterSemi = 9, writtenOctave = 4, alter = 3;
const pitch = 12 * (writtenOctave + 1) + letterSemi + alter;
const sp = { letter: "A", acc: "#" } as const; // alter > 0 collapses to "#" (musicxml.ts:167)
const got = octaveFor(pitch, sp);
console.log("input : letter A, written octave 4, alter +3 -> pitch", pitch, "spelling", JSON.stringify(sp));
console.log("actual: octaveFor =", got, " posOf =", posOf({ ...sp, octave: got }));
console.log("claim : octaveFor = 4 (the written octave), posOf = 5 (the A above middle C)");
console.log(got === writtenOctave ? "CLAIM HOLDS" : "CLAIM FAILS");
