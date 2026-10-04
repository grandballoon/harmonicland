// FAILS_makeBars_single_post_keeps_meter (proofs/Harmonicland/Core.lean)
// Claim, src/core.ts:21-24: barlines are fence posts "each optionally carrying the
// meter and key that take effect there".
import { makeScore } from "/Users/lukesovernconley/Code/harmonicland/src/core";

const notes = [{ pitch: 60, onset: 0, duration: 10 }];
const one = makeScore(notes, [{ at: 0, beats: 3, unit: 4, fifths: -3 }]);
console.log("one post, 3/4 in E-flat   ->", JSON.stringify(one.bars));
console.log("claimed: beats 3, unit 4, fifths -3; got:", one.bars[0].beats, one.bars[0].unit, one.bars[0].fifths);
const two = makeScore(notes, [{ at: 0, beats: 3, unit: 4, fifths: -3 }, 5]);
console.log("two posts, same meter      ->", JSON.stringify(two.bars[0]));
