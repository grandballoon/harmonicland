// FAILS_order_whatever_order_saved (proofs/Harmonicland/Sections.lean).
// Claim (sections.test.ts:8): "keeps the list in score order, whatever order they were saved in".
// inOrder's comparator (sections.ts:67-69) ties {from:1,to:2} with {from:1,fromBeat:0,to:2}:
// `fromBeat ?? 0` makes the heads equal, and the last term is Infinity - Infinity = NaN,
// which Array.prototype.sort reads as 0. Unique ids, yet no order between them.
import { add } from "/Users/lukesovernconley/Code/harmonicland/src/sections";

const A = { from: 1, to: 2 };
const B = { from: 1, to: 2, fromBeat: 0 };
const cmp = (a: typeof B | typeof A, b: typeof B | typeof A) =>
  a.from - b.from || ((a as typeof B).fromBeat ?? 0) - ((b as typeof B).fromBeat ?? 0)
  || a.to - b.to || (Infinity) - (Infinity);
console.log("comparator(A, B) as written at sections.ts:68-69 =", cmp(A, B));
const ab = add(add([], A), B).map((s) => s.id);
const ba = add(add([], B), A).map((s) => s.id);
console.log("A then B:", JSON.stringify(ab));
console.log("B then A:", JSON.stringify(ba));
console.log("  claim : the same list either way");
console.log("  actual:", JSON.stringify(ab) === JSON.stringify(ba) ? "same" : "DIFFERENT");
