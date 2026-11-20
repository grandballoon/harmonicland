// Repro for FAILS_track_loop_terminates (proofs/Harmonicland/MidiParse.lean).
// Claim under test: MidiIn.parse returns or throws for every byte string.
import { MidiIn } from "/Users/lukesovernconley/Code/harmonicland/src/inputs/midi";
import { guarded, isChild, smf, hex } from "./_parsers_env";

// One track. Its first event is a text meta event (FF 01) whose length is the five-byte
// variable-length quantity 8F FF FF FF 78, which the 32-bit reader decodes as -8; then
// one ordinary note. This is hangFile in the Lean model, byte for byte.
const file = smf(480, [0x00, 0xff, 0x01, 0x8f, 0xff, 0xff, 0xff, 0x78, 0x00, 0x90, 60, 100, 0x60, 0x80, 60, 0]);
if (!isChild()) console.log("input :", new Uint8Array(file).length, "bytes:", hex(file));
guarded(import.meta.url, "MidiIn.parse", () => {
  const s = MidiIn.parse(file);
  return { notes: s.notes.length, duration: s.duration };
});
if (!isChild()) console.log("claim : parse returns a Score or throws");
