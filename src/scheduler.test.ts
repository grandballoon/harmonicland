import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { makeClock } from "./clock";
import { Core } from "./core";
import { perform } from "./perform";
import { makeScheduler, LOOKAHEAD_MS, TICK_MS, type Ticker } from "./scheduler";
import type { Output, Strike } from "./types";

/* The real clock on a hand-cranked wall clock, a ticker turned by hand,
   and an Output that only records — so every strike is checked at the wire:
   which pitch, stamped when, off when, dropped into how far. */
let ms = 0;
let strikes: Strike[] = [];
let flushes = 0;
let advanced = 0;
let pedals: [boolean, number][] = [];
const output: Output = {
  strike: (s) => void strikes.push(s),
  advance: (until) => void (advanced = until),
  pedal: (down, at) => void pedals.push([down, at]),
  flush: () => void flushes++,
  latency: () => 0,
  liveOn: () => {},
  liveOff: () => {},
  detach: () => {},
};
let tick: (() => void) | null = null;
const ticker: Ticker = { start: (fn) => void (tick = fn), stop: () => void (tick = null) };

/** [pitch, at, off, offset], rounded clear of float dust. */
const r = (x: number | undefined) => (x === undefined ? x : Math.round(x * 1e6) / 1e6);
const rows = (ss: Strike[]) => ss.map((s) => [s.pitch, r(s.at), r(s.off), r(s.offset)]);

/** Advance wall time, ticking every TICK_MS as the worker would. */
function run(toMs: number): void {
  while (ms + TICK_MS <= toMs) {
    ms += TICK_MS;
    tick?.();
  }
  ms = toMs;
}

const notes = [
  { pitch: 60, onset: 0, duration: 1 },
  { pitch: 64, onset: 0.5, duration: 1 },
  { pitch: 67, onset: 1, duration: 1 },
  { pitch: 72, onset: 1.5, duration: 2 },
];
const setup = (pedal: { start: number; end: number }[] = []) => {
  const score = Core.makeScore(notes, [], pedal);
  const clock = makeClock(() => score.duration);
  const scheduler = makeScheduler(clock, output, ticker, () => ms);
  scheduler.setPerformance(perform(score));
  return { clock, scheduler };
};

beforeEach(() => {
  ms = 0;
  strikes = [];
  flushes = 0;
  advanced = 0;
  pedals = [];
  tick = null;
  vi.spyOn(performance, "now").mockImplementation(() => ms);
});
afterEach(() => vi.restoreAllMocks());

describe("Scheduler", () => {
  it("strikes nothing while the clock stands still", () => {
    setup();
    run(1000);
    expect(strikes).toEqual([]);
    expect(tick).toBeNull();
  });

  it("strikes each note once, stamped at its exact wall time, ahead of it", () => {
    const { clock } = setup();
    clock.play();
    expect(strikes.map((s) => s.pitch)).toEqual([60]); // due at once: struck on play
    run(3000);
    expect(rows(strikes)).toEqual([
      [60, 0, 1000, undefined],
      [64, 500, 1500, undefined],
      [67, 1000, 2000, undefined],
      [72, 1500, 3500, undefined],
    ]);
  });

  it("hands every note over before it is due, by the lookahead", () => {
    const { clock } = setup();
    clock.play();
    run(1500 - LOOKAHEAD_MS + TICK_MS);
    expect(strikes.map((s) => s.pitch)).toContain(72); // due at 1500
  });

  it("tells the output how far it has handed strikes over", () => {
    const { clock } = setup();
    clock.play();
    run(1000);
    expect(advanced).toBe(1000 + LOOKAHEAD_MS);
  });

  it("drops into the notes sounding where a seek lands, mid-note", () => {
    const { clock } = setup();
    clock.seek(1.25);
    clock.play();
    expect(rows(strikes)).toEqual([
      [64, 0, 250, 0.75],
      [67, 0, 750, 0.25],
    ]);
  });

  it("skips a note dropped into with almost nothing left", () => {
    const { clock } = setup();
    clock.seek(1.47); // 64 ends at 1.5: 30ms left
    clock.play();
    expect(strikes.map((s) => s.pitch)).not.toContain(64);
    expect(strikes.map((s) => s.pitch)).toContain(67);
  });

  it("flushes on every transport change, and stops striking on pause", () => {
    const { clock } = setup();
    clock.play();
    const before = flushes;
    run(400);
    clock.pause();
    expect(flushes).toBe(before + 1);
    const n = strikes.length;
    run(3000);
    expect(strikes).toHaveLength(n);
  });

  it("goes round a loop: stops notes at its end, drops into held ones at its start", () => {
    const { clock } = setup();
    clock.setLoop({ start: 1, end: 2 });
    clock.seek(1);
    clock.play();
    run(1100); // one lap and a bit
    const second = strikes.filter((s) => s.at >= 1000);
    // the lap starts with the note held across the loop's start (64, from
    // 0.5), dropped into — then 67 struck afresh at the top
    expect(rows(second)).toEqual([
      [64, 1000, 1500, 0.5],
      [67, 1000, 2000, undefined],
    ]);
    // 72 (1.5–3.5) stops where the loop does, not where the score does
    expect(r(strikes.find((s) => s.pitch === 72)!.off)).toBe(1000);
  });

  it("drops into notes it missed while its ticks were held up", () => {
    const { clock } = setup();
    clock.play();
    run(100);
    strikes = [];
    ms = 1200; // a stalled tab: no tick for over a second
    tick!();
    expect(rows(strikes)).toEqual([
      [64, 1200, 1500, 0.7],
      [67, 1200, 2000, 0.2],
    ]);
  });

  it("strikes a note only a little overdue late, rather than clipping its attack", () => {
    const { clock } = setup();
    clock.play();
    run(400);
    strikes = [];
    ms = 530; // 64 was due at 500: 30ms ago
    tick!();
    expect(rows(strikes)).toEqual([[64, 500, 1500, undefined]]);
  });

  it("auditions a parked playhead: its notes, held until the next change", () => {
    const { clock, scheduler } = setup();
    clock.seek(1);
    scheduler.audition(1);
    expect(strikes.map((s) => [s.pitch, s.off])).toEqual([
      [64, undefined],
      [67, undefined],
    ]);
    const before = flushes;
    clock.seek(2);
    expect(flushes).toBe(before + 1);
  });

  it("stops listening to the clock once disposed", () => {
    const { clock, scheduler } = setup();
    scheduler.dispose();
    clock.play();
    expect(strikes).toEqual([]);
  });

  it("hands a strike its damper time when the pedal holds it past its key-up", () => {
    const { clock } = setup([{ start: 0, end: 1.8 }]);
    clock.play();
    run(3000);
    const s60 = strikes.find((s) => s.pitch === 60)!;
    expect([r(s60.off), r(s60.damp)]).toEqual([1000, 1800]);
    // 72 is still held when the pedal lifts: no damper time of its own
    expect(strikes.find((s) => s.pitch === 72)!.damp).toBeUndefined();
  });

  it("sends the pedal's changes as they come, stamped", () => {
    const { clock } = setup([{ start: 0.5, end: 1.2 }]);
    clock.play();
    run(3000);
    expect(pedals.map(([d, at]) => [d, r(at)])).toEqual([
      [false, 0], // playing from the top jumps there: lifted, then set as it stands
      [true, 500],
      [false, 1200],
    ]);
  });

  it("sends a change's up before its down", () => {
    const { clock } = setup([{ start: 0.2, end: 0.5 }, { start: 0.5, end: 1 }]);
    clock.play();
    run(700);
    expect(pedals.map(([d, at]) => [d, r(at)])).toEqual([[false, 0], [true, 200], [false, 500], [true, 500]]);
  });

  it("drops into a note the pedal is still sustaining, and sets the pedal down", () => {
    const { clock } = setup([{ start: 0, end: 1.8 }]);
    clock.seek(1.2); // 60 (0–1) was let go of, but rings under the pedal
    clock.play();
    const s60 = strikes.find((s) => s.pitch === 60)!;
    expect(rows([s60])).toEqual([[60, 0, 0, 1.2]]);
    expect(r(s60.damp)).toBe(600);
    expect(pedals).toEqual([[false, 0], [true, 0]]);
  });
});

