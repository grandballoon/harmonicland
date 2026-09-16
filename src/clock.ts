/* ====================================================================
   CLOCK — the only moving part. Wrapped behind the `Clock` interface so the
   implementation can be swapped (Tone.Transport, audio clock, etc.) without
   anyone noticing. Scrubbing IS seek(). There is exactly one timer in this
   whole program — and now that onFrame hands back an unsubscribe, anything
   else that needs a per-frame tick can share this one instead of starting a
   rival loop, which is what live-gamepad.ts used to do.

   THE LOOP lives here too, and inside now() rather than in tick(): a wrap
   applied per frame would let every reader between frames — and the frame
   that noticed the overshoot — see a time past the loop's end. now() folds
   elapsed time back into [start, end) arithmetically, so the wrap is exact
   to the sample and there is no instant at which the loop is not honoured.

   One rule decides whether a play span loops: it must have STARTED before
   the loop's end. play() always starts inside the loop, so a loop plays
   round and round; but seeking past the end while playing is a deliberate
   escape, and folding it straight back would make the scrub bar a liar.
   ==================================================================== */
import type { Clock, TimeRange } from "./types";

export function makeClock(getDuration: () => number): Clock {
  let playing = false;
  let base = 0; // seconds accumulated before current play span
  let startedAt = 0; // performance.now() when current span began
  let range: TimeRange | null = null; // the playback loop, clamped
  const subs = new Set<(t: number) => void>(); // frame subscribers

  const outside = (t: number, r: TimeRange): boolean => t < r.start || t >= r.end;

  function now(): number {
    if (!playing) return base;
    const t = base + (performance.now() - startedAt) / 1000;
    if (!range || base >= range.end || t < range.end) return t;
    return range.start + ((t - range.start) % (range.end - range.start));
  }
  function play(): void {
    if (playing) return;
    if (range && outside(base, range)) base = range.start; // enter the loop
    else if (base >= getDuration()) base = 0; // restart from top if at end
    playing = true;
    startedAt = performance.now();
  }
  function pause(): void {
    if (!playing) return;
    base = now();
    playing = false;
  }
  function seek(t: number): void {
    base = Math.max(0, Math.min(t, getDuration()));
    startedAt = performance.now();
  }
  function isPlaying(): boolean {
    return playing;
  }
  function setLoop(r: TimeRange | null): void {
    // re-anchor first, so a wrap the OLD loop already took is kept as the
    // new base rather than recomputed against a loop that no longer exists.
    base = now();
    startedAt = performance.now();
    const start = r ? Math.max(0, r.start) : 0;
    const end = r ? Math.min(r.end, getDuration()) : 0;
    range = r && end > start ? { start, end } : null;
    if (playing && range && outside(base, range)) base = range.start;
  }
  function loop(): TimeRange | null {
    return range;
  }
  function onFrame(fn: (t: number) => void): () => void {
    subs.add(fn);
    return () => subs.delete(fn);
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
  }

  return { now, play, pause, seek, isPlaying, onFrame, stop, setLoop, loop };
}
