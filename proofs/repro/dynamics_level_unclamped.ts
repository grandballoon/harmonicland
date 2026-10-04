// FAILS_velocityAt_range_without_checked_levels, FAILS_accent_lifts_without_checked_levels
// (proofs/Harmonicland/Dynamics.lean). Hypothesis the code does not enforce: level() is
// handed a MIDI velocity (1..127). Its one caller (src/inputs/musicxml.ts:125) passes
// fromPercent(...), which is; level() itself checks nothing.
import { makeDynamics, fromPercent } from "/Users/lukesovernconley/Code/harmonicland/src/inputs/dynamics";

const d = makeDynamics();
d.level(200, 0);
console.log("input: level(200, 0); velocityAt(0)");
console.log("  claim : a velocity, 1..127");
console.log("  actual:", d.velocityAt(0));
d.mark("sfz", 0);
console.log('then mark("sfz", 0); velocityAt(0)');
console.log("  claim : the accent lifts the note above the level in force (200)");
console.log("  actual:", d.velocityAt(0));
console.log("\noutside the model (NaN): fromPercent(NaN) =", fromPercent(NaN), " — callers guard with Number.isFinite (musicxml.ts:125, 179-183)");
