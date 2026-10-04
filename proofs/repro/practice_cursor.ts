/* PracticeCursor.lean: every FAILS_ theorem and the two noted behaviours,
   run against the real PracticeState + LiveKeys. */
import { sorted } from "./_env";
import { Core } from "/Users/lukesovernconley/Code/harmonicland/src/core";
import { LiveKeys, type Voice } from "/Users/lukesovernconley/Code/harmonicland/src/live-keys";
import { PracticeState } from "/Users/lukesovernconley/Code/harmonicland/src/practice-state";
import type { Hand, RawNote } from "/Users/lukesovernconley/Code/harmonicland/src/types";

const n = (pitch: number, onset: number, duration = 0.5, hand?: Hand): RawNote =>
  ({ pitch, onset, duration, ...(hand && { hand }) });
const fingers = new Map<number, Voice>();
const down = (...ps: number[]): void => { for (const p of ps) fingers.set(p, LiveKeys.press(p)); };
const up = (...ps: number[]): void => {
  for (const p of ps) { const v = fingers.get(p); if (v) { LiveKeys.release(v); fingers.delete(p); } }
};
const seek = (): void => {};
const fresh = (): void => {
  PracticeState.end(); LiveKeys.releaseAll(); fingers.clear();
  PracticeState.setHand("both"); PracticeState.setPlayOther(false);
};
const show = (label: string): void => {
  const s = PracticeState.snapshot();
  console.log(`  ${label}: index=${s.index}/${s.total} span=[${s.span.first},${s.span.last}) current=${s.current ? "t=" + s.current.at + " attack=" + JSON.stringify(s.current.attack.map((x) => x.pitch)) : "null"}` +
    ` pending=${JSON.stringify(sorted(s.pending))} dropped=${JSON.stringify(sorted(s.dropped))} wrong=${JSON.stringify(sorted(s.wrong))} stale=${JSON.stringify(sorted(s.stale))}` +
    ` learnerFingers=${JSON.stringify(sorted(fingers.keys()))} held=${JSON.stringify(sorted(LiveKeys.held()))}`);
};

console.log("== A. FAILS_pending_struck_and_let_go / FAILS_advance_all_down ==");
console.log("score: upper C4+E4 at 0, upper D4 at 1; lower C4 at 0 (2s). hand=upper, playOther=on.");
fresh();
PracticeState.setHand("upper"); PracticeState.setPlayOther(true);
PracticeState.begin(Core.makeScore([n(60, 0, 1, "upper"), n(64, 0, 1, "upper"), n(62, 1, 1, "upper"), n(60, 0, 2, "lower")]), seek);
show("begin            ");
down(60); show("learner presses 60");
up(60);   show("learner LIFTS 60  ");
console.log("  claim (practice-state.ts:111-112): pending = attacks 'not struck since the step began, or struck and since let go' -> 60 should be pending again");
down(64); show("learner presses 64");
console.log("  claim (practice-state.ts:16-18): completes only when every attacked pitch is 'down at that moment' -> should still be on step 0; learner holds only 64");

console.log("\n== B. FAILS_dropped_let_go ==");
console.log("score: upper C4 at 0 (2s, sustained), upper E4 at 1; lower C4 at 1 (1s). hand=upper, playOther=on.");
fresh();
PracticeState.setHand("upper"); PracticeState.setPlayOther(true);
PracticeState.begin(Core.makeScore([n(60, 0, 2, "upper"), n(64, 1, 1, "upper"), n(60, 1, 1, "lower"), n(67, 2, 1, "upper")]), seek);
down(60); show("learner presses 60 (step 0 done)");
up(60);   show("learner LIFTS the sustained 60  ");
console.log("  claim (practice-state.ts:114): dropped = 'Sustains the learner has let go of' -> should be [60]");
down(64); show("learner presses 64             ");
console.log("  claim (practice-state.ts:16-18, test 'blocks on a sustain the learner let go of'): should still be on step 1");

console.log("\n== C. FAILS_wrong_hidden_by_auto ==");
console.log("score: upper E4 at 0; lower C3 at 0. hand=upper, playOther=on. Learner holds C3 (48), a key the upper hand was never asked for.");
fresh();
PracticeState.setHand("upper"); PracticeState.setPlayOther(true);
PracticeState.begin(Core.makeScore([n(64, 0, 1, "upper"), n(48, 0, 1, "lower")]), seek);
down(48); show("learner presses 48, playOther on ");
PracticeState.setPlayOther(false); show("same fingers, playOther off      ");
console.log("  claim (practice-state.ts:116-118): wrong = 'Held, no part of this step, and not a leftover' -> [48] in both rows");

console.log("\n== D. FAILS_setHand_lands_at_or_after ==");
console.log("score, 2 bars of 2s: lower C3 at 0, upper C4 at 1 (bar 0); lower D3 at 2 (bar 1). hand=both, range = bar 0.");
fresh();
PracticeState.begin(Core.makeScore([n(48, 0, 0.5, "lower"), n(60, 1, 0.5, "upper"), n(50, 2, 0.5, "lower")], [0, 2, 4]), seek);
PracticeState.setRange({ from: 0, to: 0 });
down(48); up(48);
show("after playing step 0 (now on the upper C4 at t=1)");
PracticeState.setHand("lower");
show("after setHand('lower')                           ");
console.log("  claim (practice-state.ts:399-401): 'land on the first step at or after the one you were on' -> a step with t >= 1; the lower hand's is t=2 (index 1)");

console.log("\n== E. FAILS_index_total_iff_finished ==");
console.log("score, 2 bars of 1s: upper C4 at 0 (bar 0); lower C3 at 1 (bar 1). hand=upper. Isolate bar 1, which holds nothing for the upper hand.");
fresh();
PracticeState.setHand("upper");
PracticeState.begin(Core.makeScore([n(60, 0, 0.4, "upper"), n(48, 1, 0.4, "lower")], [0, 1, 2]), seek);
show("begin (nothing played)");
PracticeState.setRange({ from: 1, to: 1 });
show("after setRange(bar 1) ");
console.log("  claim (practice-state.ts:101-102): index 'equals `total` exactly when the score is finished' -> nothing has been played, index should not equal total");

console.log("\n== F. setRange_null_restarts_finished_piece (noted, not a FAILS) ==");
fresh();
PracticeState.begin(Core.makeScore([n(60, 0), n(62, 1)]), seek);
down(60); up(60); down(62); up(62);
show("piece finished        ");
PracticeState.setRange(null);
show("after setRange(null)  ");

console.log("\n== G. model_matches_repro_G: stepping back from the first step, a range, its loop (claims that HOLD) ==");
fresh();
PracticeState.begin(Core.makeScore(Array.from({ length: 8 }, (_, i) => n(60 + i, i * 0.5, 0.4)), [0, 1, 2, 3, 4]), seek);
PracticeState.step(-1); show("step(-1) at step 0     ");
PracticeState.setRange({ from: 1, to: 1 }); show("setRange(bar 1)        ");
PracticeState.step(-1); show("step(-1) at range first");
down(62); up(62); down(63); up(63); show("played both steps      ");
PracticeState.isolate(3, true); console.log("  isolate(3, extend) -> range", JSON.stringify(PracticeState.snapshot().range));
PracticeState.isolate(0, true); console.log("  isolate(0, extend) -> range", JSON.stringify(PracticeState.snapshot().range));
PracticeState.isolate(2, true); console.log("  isolate(2, extend) -> range", JSON.stringify(PracticeState.snapshot().range), "(inside: unchanged)");
PracticeState.end(); LiveKeys.releaseAll();
