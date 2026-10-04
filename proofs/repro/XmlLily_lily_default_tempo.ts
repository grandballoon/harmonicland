// Repro for FAILS_barlines_at_the_tempo_in_force (proofs/Harmonicland/XmlLily.lean).
// Claim (src/inputs/lily.ts:18): "Barlines are laid down from \\time and \\partial at the
// tempo in force".
import { LilyIn } from "/Users/lukesovernconley/Code/harmonicland/src/inputs/lily";

const src = "\\relative c' { c4 c c c \\tempo 4 = 60 c c c c }";
const s = LilyIn.parse(src);
const bars = s.bars.map((b) => [b.start, b.end]);
console.log("input :", src);
console.log("actual: onsets", JSON.stringify(s.notes.map((n) => n.onset)), " bars", JSON.stringify(bars));
console.log("claim : four quarters at 120 are one 2 s bar, four at 60 one 4 s bar: bars [[0,2],[2,6]]");
console.log(JSON.stringify(bars) === "[[0,2],[2,6]]" ? "CLAIM HOLDS" : "CLAIM FAILS");
