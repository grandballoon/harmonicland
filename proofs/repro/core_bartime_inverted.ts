// FAILS_barTime_ordered (proofs/Harmonicland/Core.lean)
// Claim, src/core.ts:196: barTime is "The seconds a run of bars covers".
// Trims are kept apart in beats (BEAT_EPS) but snapped to attacks in seconds
// (onAttack), and only a trimmed edge is snapped.
import { makeScore, barTime, normalizeRange } from "/Users/lukesovernconley/Code/harmonicland/src/core";
import { makeSteps, spanOf } from "/Users/lukesovernconley/Code/harmonicland/src/steps";

const score = makeScore([{ pitch: 60, onset: 0.9999999, duration: 1 }], [0, 1, 2]);
const range = { from: 1, to: 1, toBeat: 2e-6 };
console.log("bars                 =", JSON.stringify(score.bars.map((b) => [b.start, b.end])));
console.log("normalizeRange       =", JSON.stringify(normalizeRange(score, range)), "(the trim survives: it is > BEAT_EPS)");
const t = barTime(score, range);
console.log("barTime              =", JSON.stringify(t));
console.log("end < start          =", t.end < t.start, "(claim: a stretch of the piece, start < end)");
const steps = makeSteps(score, "both").steps;
console.log("steps.spanOf(barTime) =", JSON.stringify(spanOf(steps, t)), "(Span doc: last - first is how many)");
