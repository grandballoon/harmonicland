/* ====================================================================
   CLOCK — the only moving part. Wrapped behind the `Clock` interface so the
   implementation can be swapped (Tone.Transport, audio clock, etc.) without
   anyone noticing. Scrubbing IS seek(). There is exactly one timer in this
   whole program — and now that onFrame hands back an unsubscribe, anything
   else that needs a per-frame tick can share this one instead of starting a
   rival loop, which is what live-gamepad.ts used to do. (The scheduler's
   tick is not a rival: it only asks this clock what time it will be.)

   THE LOOP lives here too, and inside now() rather than in tick(): a wrap
   applied per frame would let every reader between frames — and the frame
   that noticed the overshoot — see a time past the loop's end. now() folds
   elapsed time back into [start, end) arithmetically, so the wrap is exact
   to the sample and there is no instant at which the loop is not honoured.

   One rule decides whether a play span loops: it must have STARTED before
   the loop's end. play() always starts inside the loop, so a loop plays
   round and round; but seeking past the end while playing is a deliberate
   escape, and folding it straight back would make the scrub bar a liar.

   LOOKING AHEAD. Sound is scheduled ~100ms early (scheduler.ts), so the
   clock also answers "what will the next stretch of wall time play?" —
   ahead() — by the same folding, in UNFOLDED time: score time as if there
   were no loop, which runs on linearly from the span's start. Lap -1 is
   the run-in before the loop's end is first reached; lap k >= 0 plays
   [start, end) again from unfolded `end + k * length`.
   ==================================================================== */
import type { Clock, Stretch, TimeRange } from "./types";

/** Seconds: a point closer than this to a lap's start IS its start. Window
 *  edges are computed from wall time, so a boundary is never hit exactly;
 *  without a tolerance a wrap could be claimed by both windows around it. */
const EPS = 1e-6;

export function makeClock(getDuration: () => number): Clock {
  let playing = false;
  let base = 0; // seconds accumulated before current play span
  let startedAt = 0; // performance.now() when current span began
  let range: TimeRange | null = null; // the playback loop, clamped
  const subs = new Set<(t: number) => void>(); // frame subscribers
  const changeSubs = new Set<() => void>(); // transport subscribers

  const outside = (t: number, r: TimeRange): boolean => t < r.start || t >= r.end;
  const changed = (): void => {
    for (const fn of [...changeSubs]) fn();
  };

  /** Score time on this span as if there were no loop. */
  const unfolded = (ms: number): number => base + (ms - startedAt) / 1000;
  /** Does this span go round the loop? (See the one rule above.) */
  const looping = (): boolean => range !== null && base < range.end;
  function fold(u: number): number {
    if (!range || !looping() || u < range.end) return u;
    return range.start + ((u - range.start) % (range.end - range.start));
  }

  function now(): number {
    if (!playing) return base;
    return fold(unfolded(performance.now()));
  }
  function heard(lag: number): number {
    if (!playing) return base;
    return fold(Math.max(base, unfolded(performance.now() - lag * 1000)));
  }
  function play(): void {
    if (playing) return;
    if (range && outside(base, range)) base = range.start; // enter the loop
    else if (base >= getDuration()) base = 0; // restart from top if at end
    playing = true;
    startedAt = performance.now();
    changed();
  }
  function pause(): void {
    if (!playing) return;
    base = now();
    playing = false;
    changed();
  }
  function seek(t: number): void {
    base = Math.max(0, Math.min(t, getDuration()));
    startedAt = performance.now();
    changed();
  }
  function isPlaying(): boolean {
    return playing;
  }
  function setLoop(r: TimeRange | null): void {
    const start = r ? Math.max(0, r.start) : 0;
    const end = r ? Math.min(r.end, getDuration()) : 0;
    const next = r && end > start ? { start, end } : null;
    // the same loop again is no change — and must not be one, since every
    // change makes the scheduler drop and re-strike what is sounding
    if (next?.start === range?.start && next?.end === range?.end) return;
    // re-anchor first, so a wrap the OLD loop already took is kept as the
    // new base rather than recomputed against a loop that no longer exists.
    base = now();
    startedAt = performance.now();
    range = next;
    if (playing && range && outside(base, range)) base = range.start;
    changed();
  }
  function loop(): TimeRange | null {
    return range;
  }

  function ahead(fromMs: number, toMs: number): readonly Stretch[] {
    if (!playing || toMs <= fromMs) return [];
    const u0 = unfolded(Math.max(fromMs, startedAt));
    const u1 = unfolded(toMs);
    const wall = (u: number): number => startedAt + (u - base) * 1000;
    if (!range || !looping()) {
      const d = getDuration();
      const end = Math.min(u1, d);
      return u0 < end ? [{ start: u0, end, at: wall(u0), until: d, jump: false }] : [];
    }
    const { start: a, end: b } = range;
    const len = b - a;
    const out: Stretch[] = [];
    let lap = u0 < b - EPS ? -1 : Math.floor((u0 - b + EPS) / len);
    let u = u0;
    // a window that opens on a lap's start opens on the wrap itself
    let jump = lap >= 0 && u0 - (b + lap * len) < EPS;
    for (;;) {
      const next = b + (lap + 1) * len; // unfolded time of the next wrap
      const stop = Math.min(u1, next);
      const start = lap < 0 ? u : jump ? a : a + (u - (b + lap * len));
      // a sliver too thin to hold anything is left to the next window,
      // which sees the same point as its own opening, wrap and all
      if (stop - u >= EPS) out.push({ start, end: start + (stop - u), at: wall(u), until: b, jump });
      if (stop < next) break;
      u = next;
      lap++;
      jump = true;
      if (u >= u1) break;
    }
    return out;
  }

  function onFrame(fn: (t: number) => void): () => void {
    subs.add(fn);
    return () => subs.delete(fn);
  }
  function onChange(fn: () => void): () => void {
    changeSubs.add(fn);
    return () => changeSubs.delete(fn);
  }

  // single rAF loop drives every subscriber off now(). Iterating a copy so a
  // subscriber may unsubscribe (or subscribe) from inside its own callback.
  let raf = 0;
  function tick(): void {
    const t = now();
    if (playing && t >= getDuration()) pause();
    for (const fn of [...subs]) fn(now());
    raf = requestAnimationFrame(tick);
  }
  raf = requestAnimationFrame(tick);

  function stop(): void {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    subs.clear();
    changeSubs.clear();
  }

  return { now, heard, play, pause, seek, isPlaying, onFrame, onChange, stop, setLoop, loop, ahead };
}
