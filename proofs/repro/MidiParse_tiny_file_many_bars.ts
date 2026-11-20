// Repro for tiny_file_many_bars (proofs/Harmonicland/MidiParse.lean): no stated claim
// fails, but a 39-byte file asks the bar loop of midi.ts:163 for 2^28 bar events.
import { MidiIn } from "/Users/lukesovernconley/Code/harmonicland/src/inputs/midi";
import { guarded, isChild, smf, hex } from "./_parsers_env";

// A time signature of 1 over 2^30 (denominator byte 0x1e), then one quarter note.
const file = smf(480, [0x00, 0xff, 0x58, 0x04, 0x01, 0x1e, 0x18, 0x08, 0x00, 0x90, 60, 100, 0x83, 0x60, 0x80, 60, 0]);
if (!isChild()) console.log("input :", new Uint8Array(file).length, "bytes:", hex(file));
guarded(import.meta.url, "MidiIn.parse", () => {
  const s = MidiIn.parse(file);
  return { notes: s.notes.length, bars: s.bars.length };
}, 20000);
if (!isChild()) console.log("expect: a one-note score, promptly");
