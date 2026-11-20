// FAILS_makeBars_positive (proofs/Harmonicland/Core.lean)
// Claim, src/core.ts:82: "a zero-length bar would be a bar nothing can ever be in" —
// makeBars drops duplicate posts so that no bar is empty.
import { makeScore, barAt } from "/Users/lukesovernconley/Code/harmonicland/src/core";

const score = makeScore([]);
console.log("makeScore([]).bars      =", JSON.stringify(score.bars));
const b = score.bars[0];
console.log("bar 0 is empty          =", b.start === b.end, "(claim: no bar is zero-length)");
console.log("barAt(score, 0)         =", JSON.stringify(barAt(score, 0)));
console.log("0 is inside that bar    =", 0 >= b.start && 0 < b.end, "(half-open: nothing is)");
