// FAILS_stepFrom_in_loop (proofs/Harmonicland/Loop.lean)
// Claim, src/loop.ts:53-55: "Within a loop only the loop's steps are candidates and
// the ends wrap"; decision 2 (loop.ts:26): "the steps it confines are whole steps".
// A chord captured from a performance, spread 10ms either side of a barline, begins
// inside bar 1 but lands (decision 1: on its LAST attack) in bar 2.
import { makeScore, barTime } from "/Users/lukesovernconley/Code/harmonicland/src/core";
import { makeSteps } from "/Users/lukesovernconley/Code/harmonicland/src/steps";
import { stepFrom, landing } from "/Users/lukesovernconley/Code/harmonicland/src/loop";

const score = makeScore(
  [{ pitch: 60, onset: 0.99, duration: 1 }, { pitch: 64, onset: 1.01, duration: 1 }],
  [0, 1, 2, 3],
);
const steps = makeSteps(score, "both").steps;
const loop = barTime(score, { from: 0, to: 0 });
console.log("steps (at, landing)   =", JSON.stringify(steps.map((s) => [s.at, landing(s)])));
console.log("loop = bar 1          =", JSON.stringify(loop));
const at = stepFrom(steps, 0, 1, loop);
console.log("stepFrom(t=0, forward) =", at);
console.log("inside the loop        =", at !== null && at >= loop.start && at < loop.end, "(the playhead is parked past loop.end)");
const loop2 = barTime(score, { from: 1, to: 1 });
console.log("loop = bar 2           =", JSON.stringify(loop2), "-> stepFrom:", stepFrom(steps, loop2.start, 1, loop2), "(bar 2's own downbeat chord is not a step of bar 2)");
