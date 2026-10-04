// Repro for FAILS_voices_keep_time_together (proofs/Harmonicland/XmlLily.lean).
// Claim (src/inputs/lily.ts:188 "each braced voice starts at t0"; dynamics.ts:6-12): the
// voices of << >> keep time together.
import { LilyIn } from "/Users/lukesovernconley/Code/harmonicland/src/inputs/lily";

const src = "<< \\relative c'' { c4 \\tempo 4 = 60 c4 } \\\\ \\relative c { c4 c4 } >>";
const s = LilyIn.parse(src);
const of = (pitch: number) => s.notes.filter((n) => n.pitch === pitch).map((n) => [n.onset, n.duration]);
console.log("input :", src);
console.log("actual: upper voice [onset, duration]", JSON.stringify(of(72)), " lower voice", JSON.stringify(of(48)));
console.log("claim : the second quarter of each voice is struck at the same second (0.5), and the lower voice's first quarter lasts 0.5 s like the upper's");
console.log(of(72)[1][0] === of(48)[1][0] ? "CLAIM HOLDS" : "CLAIM FAILS");
