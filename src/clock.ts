/* ====================================================================
   CLOCK — the only moving part. Wrapped behind the `Clock` interface so the
   implementation can be swapped (Tone.Transport, audio clock, etc.) without
   anyone noticing. Scrubbing IS seek(). There is exactly one timer in this
   whole program — and now that onFrame hands back an unsubscribe, anything
   else that needs a per-frame tick can share this one instead of starting a
   rival loop, which is what live-gamepad.ts used to do.
   ==================================================================== */
import type { Clock } from "./types";

export function makeClock(getDuration: () => number): Clock {
  let playing = false;
  let base = 0; // seconds accumulated before current play span
  let startedAt = 0; // performance.now() when current span began
  const subs = new Set<(t: number) => void>(); // frame subscribers

  function now(): number {
    if (!playing) return base;
    return base + (performance.now() - startedAt) / 1000;
  }
  function play(): void {
    if (playing) return;
    if (now() >= getDuration()) base = 0; // restart from top if at end
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

  return { now, play, pause, seek, isPlaying, onFrame, stop };
}
