/* ====================================================================
   AUDIO_OUT — score -> t -> sound. WebAudio. Edge-triggered: it tracks
   which notes were sounding last frame and starts/stops voices on the
   transitions. Reads the same activeAt() query as the staff. Knows
   nothing about rendering.
   ==================================================================== */
import { Core } from "../core";
import type { Score, Note } from "../types";

interface Voice {
  osc: OscillatorNode;
  gain: GainNode;
}

let ctx: AudioContext | null = null;
const voices = new Map<Note, Voice>(); // score note(object) -> voice
const live = new Map<number, Voice>(); // pitch -> voice  (user-played keys)

function freq(pitch: number): number {
  return 440 * Math.pow(2, (pitch - 69) / 12);
}

export function ensure(): void {
  if (!ctx) {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new Ctor();
  }
  if (ctx.state === "suspended") void ctx.resume();
}

// one voice = a triangle osc behind a short attack ramp. Pitch in, handle out.
function spawn(pitch: number): Voice {
  const c = ctx!;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = "triangle";
  osc.frequency.value = freq(pitch);
  gain.gain.setValueAtTime(0, c.currentTime);
  gain.gain.linearRampToValueAtTime(0.18, c.currentTime + 0.01);
  osc.connect(gain).connect(c.destination);
  osc.start();
  return { osc, gain };
}
function kill(v: Voice): void {
  const c = ctx!;
  v.gain.gain.cancelScheduledValues(c.currentTime);
  v.gain.gain.setTargetAtTime(0, c.currentTime, 0.03);
  v.osc.stop(c.currentTime + 0.12);
}
function startVoice(n: Note): void {
  voices.set(n, spawn(n.pitch));
}
function stopVoice(n: Note): void {
  const v = voices.get(n);
  if (!v) return;
  kill(v);
  voices.delete(n);
}
export function silence(): void {
  for (const n of [...voices.keys()]) stopVoice(n);
}

// called every frame with current active set; diff against playing voices
export function at(score: Score, t: number, playing: boolean): void {
  if (!ctx) return;
  if (!playing) {
    silence();
    return;
  }
  const active = new Set(Core.activeAt(score, t));
  for (const n of active) if (!voices.has(n)) startVoice(n);
  for (const n of [...voices.keys()]) if (!active.has(n)) stopVoice(n);
}

// live key path — independent of the score and the clock. One sustained
// voice per held pitch, started/stopped by user input rather than activeAt.
// This is the "playable keyboard" seam: sound without touching the model.
export function liveOn(pitch: number): void {
  ensure();
  if (live.has(pitch)) return;
  live.set(pitch, spawn(pitch));
}
export function liveOff(pitch: number): void {
  const v = live.get(pitch);
  if (!v) return;
  kill(v);
  live.delete(pitch);
}

export const AudioOut = { ensure, at, silence, liveOn, liveOff };
