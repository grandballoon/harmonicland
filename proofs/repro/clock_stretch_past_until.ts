// FAILS_ahead_end_le_until (proofs/Harmonicland/Clock.lean)
// Claim, src/types.ts:215-218: a Stretch is score time "[start, end)" that "runs
// linearly from `start` until `until` — the loop's end, or the piece's".
// A window opening half a microsecond before a wrap, and reaching past the next one
// (the loop is shorter than the look-ahead), returns a stretch ending past `until`.
let ms = 0;
(globalThis as any).requestAnimationFrame = () => 0;
(globalThis as any).cancelAnimationFrame = () => {};
performance.now = () => ms;
const { makeClock } = await import("/Users/lukesovernconley/Code/harmonicland/src/clock");

const clock = makeClock(() => 10);
clock.setLoop({ start: 0, end: 0.05 }); // a 50ms loop: one short note
clock.play(); // base 0, startedAt 0
const stretches = clock.ahead(99.9995, 199.9995); // a 100ms window, as the scheduler's first after a reset
console.log("loop =", JSON.stringify(clock.loop()));
for (const s of stretches)
  console.log(JSON.stringify(s), s.end > s.until ? `<-- end is ${s.end - s.until}s PAST until` : "");
