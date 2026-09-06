/* ====================================================================
   CLOCK — the only moving part. Wrapped behind the `Clock` interface so the
   implementation can be swapped (Tone.Transport, audio clock, etc.) without
   anyone noticing. Scrubbing IS seek(), and playback speed IS rate — score
   seconds per wall second. There is exactly one timer in this whole program.
   ==================================================================== */
import type { Clock } from "./types";

const MIN_RATE = 0.05;
const MAX_RATE = 4;

export function makeClock(getDuration: () => number): Clock {
  let playing = false;
  let base = 0; // seconds accumulated before current play span
  let startedAt = 0; // performance.now() when current span began
  let rate = 1; // score seconds per wall second
  const subs: ((t: number) => void)[] = []; // frame subscribers

  function now(): number {
    if (!playing) return base;
    return base + ((performance.now() - startedAt) / 1000) * rate;
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
  function getRate(): number {
    return rate;
  }
  // banking the elapsed span at the OLD rate before switching is the whole
  // trick: without it, changing speed mid-play would retroactively rescale
  // everything played so far and the playhead would jump.
  function setRate(r: number): void {
    const next = Math.max(MIN_RATE, Math.min(MAX_RATE, r));
    if (next === rate) return;
    base = now();
    startedAt = performance.now();
    rate = next;
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

  return { now, play, pause, seek, isPlaying, rate: getRate, setRate, onFrame };
}
