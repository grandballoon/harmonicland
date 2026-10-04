// Repro for FAILS_meter_map_is_in_time_order (proofs/Harmonicland/XmlLily.lean).
// Claim (src/inputs/lily.ts:86-88 "The meter map: from each of these instants, bars are
// barSec long"; :18).
import { LilyIn } from "/Users/lukesovernconley/Code/harmonicland/src/inputs/lily";

const src = "<< \\relative c'' { \\key g \\major \\time 3/4 c4 c c \\time 2/4 c c } \\\\ \\relative c { \\key g \\major c2. c2 } >>";
const s = LilyIn.parse(src);
const bars = s.bars.map((b) => [b.start, b.end, `${b.beats}/${b.unit}`]);
console.log("input :", src);
console.log("actual: bars", JSON.stringify(bars));
console.log('claim : one 3/4 bar then one 2/4 bar: [[0,1.5,"3/4"],[1.5,2.5,"2/4"]]');
console.log(JSON.stringify(bars) === '[[0,1.5,"3/4"],[1.5,2.5,"2/4"]]' ? "CLAIM HOLDS" : "CLAIM FAILS");
