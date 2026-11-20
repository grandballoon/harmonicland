// Repro for FAILS_key_unpacks (proofs/Harmonicland/MidiParse.lean).
// Claim (src/inputs/midi.ts:178-179, 207): the key track<<7|pitch keeps track and pitch apart.
import { MidiIn } from "/Users/lukesovernconley/Code/harmonicland/src/inputs/midi";
import { smf } from "./_parsers_env";

// A note-on whose pitch byte is 200 (not a legal data byte), a note-off for pitch 72 on
// the same track, then a second note-on for 200 that is never closed.
const s = MidiIn.parse(smf(480, [0x00, 0x90, 200, 100, 0x60, 0x80, 72, 0, 0x00, 0x90, 200, 90, 0x00, 0xff, 0x2f, 0x00]));
console.log("input : on(pitch byte 200), off(pitch 72), on(pitch byte 200) left open - one track");
console.log("actual:", JSON.stringify(s.notes.map((n) => ({ pitch: n.pitch, onset: n.onset, duration: n.duration, stream: n.stream }))));
console.log("claim : the note-off for 72 closes nothing (no 72 is open), and the open notes keep the pitch they were struck with");
console.log(s.notes.every((n) => n.pitch !== 72) ? "CLAIM HOLDS" : "CLAIM FAILS");
