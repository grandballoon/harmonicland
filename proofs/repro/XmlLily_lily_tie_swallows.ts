// Repro for FAILS_tie_joins_only_the_next_note (proofs/Harmonicland/XmlLily.lean).
// Claim (src/inputs/lily.ts:10 "ties ~"): a tie joins a note to the note of its pitch that
// follows it.
import { LilyIn } from "/Users/lukesovernconley/Code/harmonicland/src/inputs/lily";

const src = "\\relative c' { <c e>4~ <c g'>4 d4 e4 }";
const s = LilyIn.parse(src);
const got = s.notes.map((n) => [n.pitch, n.onset, n.duration]);
console.log("input :", src);
console.log("actual: [pitch, onset, duration]", JSON.stringify(got));
console.log("claim : five notes - the first E (64) a quarter (0.5 s), and the last E a note of its own at 1.5 s");
console.log(s.notes.length === 5 ? "CLAIM HOLDS" : "CLAIM FAILS");
