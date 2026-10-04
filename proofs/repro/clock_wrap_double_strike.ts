// FAILS_ahead_struck_once, FAILS_ahead_struck_at_all (proofs/Harmonicland/Clock.lean)
// Claim, src/scheduler.ts:18-19: "THE WINDOWS are contiguous and half-open in wall
// time, so every note is struck exactly once per pass without any bookkeeping".
// A window boundary half a microsecond before a loop wrap: the next window is taken
// to open ON the wrap (clock.ts:119-122), so its stretch is half a microsecond out of
// step with the windows either side.
let ms = 0;
(globalThis as any).requestAnimationFrame = () => 0;
(globalThis as any).cancelAnimationFrame = () => {};
performance.now = () => ms;
const { makeClock } = await import("/Users/lukesovernconley/Code/harmonicland/src/clock");
const { makeScore } = await import("/Users/lukesovernconley/Code/harmonicland/src/core");
const { perform } = await import("/Users/lukesovernconley/Code/harmonicland/src/perform");
const { makeScheduler } = await import("/Users/lukesovernconley/Code/harmonicland/src/scheduler");

// --- the clock alone ---------------------------------------------------
{
  const clock = makeClock(() => 10);
  clock.setLoop({ start: 0, end: 1 });
  clock.play();
  const A = clock.ahead(900, 999.9995);
  const B = clock.ahead(999.9995, 1100);
  const C = clock.ahead(1100, 1200);
  console.log("window A [900, 999.9995)  ->", JSON.stringify(A));
  console.log("window B [999.9995, 1100) ->", JSON.stringify(B));
  console.log("window C [1100, 1200)     ->", JSON.stringify(C));
  const covers = (ss: readonly any[], o: number) => ss.some((s) => s.start <= o && o < s.end);
  console.log("score time 0.1000002 covered by B:", covers(B, 0.1000002), " by C:", covers(C, 0.1000002), "(claim: exactly one)");
  console.log("score time 0.9999997 covered by A:", covers(A, 0.9999997), " by B:", covers(B, 0.9999997), "(claim: exactly one)");
}

// --- the scheduler on that clock ----------------------------------------
{
  ms = 0;
  const strikes: any[] = [];
  const output = {
    strike: (s: any) => void strikes.push(s), advance: () => {}, pedal: () => {}, flush: () => {},
    latency: () => 0, liveOn: () => {}, liveOff: () => {}, detach: () => {},
  };
  let tick: (() => void) | null = null;
  const ticker = { start: (fn: () => void) => void (tick = fn), stop: () => void (tick = null) };
  const score = makeScore([
    { pitch: 60, onset: 0.1000002, duration: 0.5 }, // in the sliver B and C both cover
    { pitch: 72, onset: 0.9999997, duration: 0.0000002 + 1 }, // in the sliver neither A nor B covers
  ]);
  const clock = makeClock(() => score.duration);
  const scheduler = makeScheduler(clock, output as any, ticker, () => ms);
  scheduler.setPerformance(perform(score));
  clock.setLoop({ start: 0, end: 1 });
  clock.play(); // reset(): first window [0, 100)
  // ticks land so that one window boundary falls at 999.9995ms (wall 899.9995 + 100 look-ahead)
  for (const wall of [100, 200, 300, 400, 500, 600, 700, 800, 899.9995, 1000, 1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800]) {
    ms = wall;
    tick?.();
  }
  const by = (p: number) => strikes.filter((s) => s.pitch === p).map((s) => s.at);
  console.log("\nscheduler, wall 0..1900ms (lap 1 is score [0,1) at wall 0..1000, lap 2 at 1000..2000)");
  console.log("pitch 60 (onset 0.1000002) struck at wall:", JSON.stringify(by(60)), "(claim: once per pass -> 2 strikes, ~100 and ~1100)");
  console.log("pitch 72 (onset 0.9999997) struck at wall:", JSON.stringify(by(72)), "(claim: once per pass -> 1 strike so far, ~999.9997)");
}
