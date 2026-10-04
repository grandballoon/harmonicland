// Repro for FAILS_readVarLen_nonneg (proofs/Harmonicland/MidiParse.lean).
// Claim: a variable-length quantity is a non-negative count (of ticks, or of bytes).
import { MidiIn } from "/Users/lukesovernconley/Code/harmonicland/src/inputs/midi";
import { smf } from "./_parsers_env";

// The first delta-time is 8F FF FF FF 78: five bytes, -8 once it has overflowed 32 bits.
// readVarLen is private, so its value is read off the note it places: -8 ticks at 480
// ticks a quarter and 120 bpm is -8/480 * 0.5 s.
const file = smf(480, [0x8f, 0xff, 0xff, 0xff, 0x78, 0x90, 60, 100, 0x83, 0x60, 0x80, 60, 0, 0x00, 0xff, 0x2f, 0x00]);
const s = MidiIn.parse(file);
console.log("input : one note-on after the delta-time 8f ff ff ff 78, note-off 480 ticks later");
console.log("actual: onset =", s.notes[0].onset, "s  (= ", s.notes[0].onset * 960, "ticks )  duration =", s.notes[0].duration);
console.log("claim : onset >= 0 (types.ts:54 'seconds from start'); a delta-time is never negative");
console.log(s.notes[0].onset >= 0 ? "CLAIM HOLDS" : "CLAIM FAILS");
