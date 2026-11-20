// Repro for FAILS_valuesFor_always_right (proofs/Harmonicland/Engrave.lean).
// Claim (src/outputs/engrave.ts:22-26): the values a length is written as are "always right".
import { valuesFor, quartersOf } from "/Users/lukesovernconley/Code/harmonicland/src/outputs/engrave";

const len = 1 / 3 - 1 / 8; // 5/24 of a quarter: from a thirty-second to a triplet eighth
const vals = valuesFor(len);
const total = vals.reduce((s, x) => s + quartersOf(x), 0);
console.log("input : valuesFor(1/3 - 1/8) =", len);
console.log("actual:", JSON.stringify(vals), "which add up to", total);
console.log("claim : values adding up to", len);
console.log(Math.abs(total - len) < 1e-6 ? "CLAIM HOLDS" : "CLAIM FAILS");
