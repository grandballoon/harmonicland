// Repro for FAILS_pairs_LIFO (proofs/Harmonicland/MidiParse.lean).
// Claim (src/inputs/midi.ts:193): "stack note-ons of same key; pair LIFO on next off".
import { MidiIn } from "/Users/lukesovernconley/Code/harmonicland/src/inputs/midi";
import { smf } from "./_parsers_env";

// C4 struck at tick 0 (velocity 100) and again at tick 480 (velocity 50) before it is
// released; note-offs at ticks 960 and 1440. 480 ticks a quarter, 120 bpm: 0.5 s each.
const s = MidiIn.parse(smf(480, [
  0x00, 0x90, 60, 100, 0x83, 0x60, 0x90, 60, 50, 0x83, 0x60, 0x80, 60, 0, 0x83, 0x60, 0x80, 60, 0, 0x00, 0xff, 0x2f, 0x00,
]));
const got = s.notes.map((n) => ({ onset: n.onset, end: n.onset + n.duration, velocity: n.velocity }));
console.log("input : on(v100)@0s, on(v50)@0.5s, off@1s, off@1.5s, all pitch 60 on one track");
console.log("actual:", JSON.stringify(got));
console.log("claim : LIFO - the first note-off (1 s) closes the SECOND note-on: [0.5,1] v50 and [0,1.5] v100");
const lifo = got.some((n) => n.onset === 0.5 && n.end === 1);
console.log(lifo ? "CLAIM HOLDS" : "CLAIM FAILS (the first note-off closed the FIRST note-on: FIFO)");
