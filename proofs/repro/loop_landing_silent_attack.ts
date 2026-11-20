// FAILS_landing_all_sounding (proofs/Harmonicland/Loop.lean)
// Claim, src/loop.ts:13-18: "A STEP LANDS ON ITS LAST ATTACK ... Parked on the last,
// every attack is sounding".
// A 10ms note and a second note 20ms after it began are one step (within GROUP_SEC),
// and the first has ended before the second begins.
let ms = 0;
(globalThis as any).requestAnimationFrame = () => 0;
(globalThis as any).cancelAnimationFrame = () => {};
performance.now = () => ms;
const { makeClock } = await import("/Users/lukesovernconley/Code/harmonicland/src/clock");
const { makeScore } = await import("/Users/lukesovernconley/Code/harmonicland/src/core");
const { makeSteps } = await import("/Users/lukesovernconley/Code/harmonicland/src/steps");
const { landing, stepFrom } = await import("/Users/lukesovernconley/Code/harmonicland/src/loop");
const { perform } = await import("/Users/lukesovernconley/Code/harmonicland/src/perform");
const { makeScheduler } = await import("/Users/lukesovernconley/Code/harmonicland/src/scheduler");

const score = makeScore([{ pitch: 60, onset: 0, duration: 0.01 }, { pitch: 64, onset: 0.02, duration: 1 }]);
const steps = makeSteps(score, "both").steps;
console.log("steps:", JSON.stringify(steps.map((s) => ({ at: s.at, attack: s.attack.map((n) => n.pitch), landing: landing(s) }))));

const strikes: any[] = [];
const output = {
  strike: (s: any) => void strikes.push(s), advance: () => {}, pedal: () => {}, flush: () => {},
  latency: () => 0, liveOn: () => {}, liveOff: () => {}, detach: () => {},
};
const ticker = { start: () => {}, stop: () => {} };
const clock = makeClock(() => score.duration);
const scheduler = makeScheduler(clock, output as any, ticker, () => ms);
scheduler.setPerformance(perform(score));

// main.ts stepPlayhead(1) from before the piece: stepFrom, pause, seek, audition
const at = stepFrom(steps, -1, 1, null)!;
clock.pause();
clock.seek(at);
scheduler.audition(at);
console.log("arrow key lands at", at, "and auditions pitches", JSON.stringify(strikes.map((s) => s.pitch)));
console.log("claim: every attack of the step is sounding -> [60,64]");
