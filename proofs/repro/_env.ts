/* Shared by the repro scripts: a recording Output put in front of LiveKeys.
   Sound starts on the built-in piano, whose liveOn() needs an AudioContext;
   Sound.use(recorder) swaps it for this before anything is pressed
   (AudioOut.detach() is a no-op while it has no context). */
import { Sound } from "/Users/lukesovernconley/Code/harmonicland/src/outputs/sound";
import type { Output } from "/Users/lukesovernconley/Code/harmonicland/src/types";

export const log: string[] = [];
export const recorder = (name: string): Output => ({
  strike: (s) => void log.push(`${name} strike ${s.pitch}`),
  advance: () => {},
  pedal: () => {},
  flush: () => void log.push(`${name} flush`),
  latency: () => 0,
  liveOn: (p) => void log.push(`${name} on ${p}`),
  liveOff: (p) => void log.push(`${name} off ${p}`),
  detach: () => void log.push(`${name} detach`),
});
export const rec = recorder("out");
Sound.use(rec);
export const sorted = (s: Iterable<number>): number[] => [...s].sort((a, b) => a - b);
