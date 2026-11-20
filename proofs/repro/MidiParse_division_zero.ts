// Repro for FAILS_times_are_finite (proofs/Harmonicland/MidiParse.lean).
// Claim: every time parse produces is a finite number of seconds.
import { MidiIn } from "/Users/lukesovernconley/Code/harmonicland/src/inputs/midi";
import { smf } from "./_parsers_env";

// A header whose division (ticks per quarter) is 0; one note, on at tick 0, off at 96.
const s = MidiIn.parse(smf(0, [0x00, 0x90, 60, 100, 0x60, 0x80, 60, 0, 0x00, 0xff, 0x2f, 0x00]));
const n = s.notes[0];
console.log("input : division = 0, one note-on at tick 0 and its note-off at tick 96");
console.log("actual: onset =", n.onset, " duration =", n.duration, " score.duration =", s.duration,
  " bars =", JSON.stringify(s.bars.map((b) => [b.start, String(b.end)])));
console.log("claim : finite onset, duration and score duration (or a thrown error)");
console.log(Number.isFinite(n.onset) && Number.isFinite(s.duration) ? "CLAIM HOLDS" : "CLAIM FAILS");
