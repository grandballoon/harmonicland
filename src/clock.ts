/* ====================================================================
   CLOCK — the only moving part. Wrapped behind the `Clock` interface so the
   implementation can be swapped (Tone.Transport, audio clock, etc.) without
   anyone noticing. Scrubbing IS seek(). There is exactly one timer in this
   whole program.
   ==================================================================== */
import type { Clock } from "./types";

export function makeClock(getDuration: () => number): Clock {
  let playing = false;
  let base = 0; // seconds accumulated before current play span
  let startedAt = 0; // performance.now() when current span began
  const subs: ((t: number) => void)[] = []; // frame subscribers

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
  function onFrame(fn: (t: number) => void): void {
    subs.push(fn);
  }

  // single rAF loop drives every subscriber off now()
  function tick(): void {
    const t = now();
    if (playing && t >= getDuration()) pause();
    for (const fn of subs) fn(now());
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  return { now, play, pause, seek, isPlaying, onFrame };
}
