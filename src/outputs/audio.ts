/* ====================================================================
   AUDIO_OUT — score -> t -> sound. WebAudio. Edge-triggered: it tracks
   which notes were sounding last frame and starts/stops voices on the
   transitions. Reads the same activeAt() query as the staff. Knows
   nothing about rendering.

   The instrument is a SAMPLED PIANO: the Salamander Grand (Alexander
   Holm, CC BY), 30 recordings spaced a minor third apart from A0 to C8,
   bundled as static assets — no dependency, no third-party host. A note
   plays the nearest sample pitch-shifted by playbackRate (at most one
   semitone, inaudible as artifact); note-off is a short damper fade
   rather than a hard stop. Samples decode lazily on ensure() (the first
   user gesture); until a note's sample is ready — or if its fetch fails
   — that note falls back to the old triangle oscillator, so sound is
   never silently broken. A master compressor tames big chords.
   ==================================================================== */
import { Core } from "../core";
import type { Score, Note } from "../types";

interface Voice {
  src: OscillatorNode | AudioBufferSourceNode;
  gain: GainNode;
}

let ctx: AudioContext | null = null;
let master: DynamicsCompressorNode | null = null;
let muted = false; // silenced while an external synth (MIDI out) is driving sound
const voices = new Map<Note, Voice>(); // score note(object) -> voice
const live = new Map<number, Voice>(); // pitch -> voice  (user-played keys)

function freq(pitch: number): number {
  return 440 * Math.pow(2, (pitch - 69) / 12);
}

// ---- the sample map (pure, exported for tests) ---------------------
// Samples sit every 3 semitones, A0(21) .. C8(108): A, C, D#, F# of
// each octave. Any playable pitch is within one semitone of a sample.
const SAMPLE_LO = 21; // A0
const SAMPLE_HI = 108; // C8

export const samplePitchFor = (pitch: number): number =>
  Math.min(SAMPLE_HI, Math.max(SAMPLE_LO, SAMPLE_LO + 3 * Math.round((pitch - SAMPLE_LO) / 3)));

// file basename for a sample pitch, e.g. 21 -> "A0", 27 -> "Ds1"
const SAMPLE_LETTER: Record<number, string> = { 0: "C", 3: "Ds", 6: "Fs", 9: "A" };
export const sampleName = (samplePitch: number): string =>
  SAMPLE_LETTER[samplePitch % 12] + (Math.floor(samplePitch / 12) - 1);

// ---- lazy sample loading -------------------------------------------
const buffers = new Map<number, AudioBuffer>(); // sample pitch -> decoded audio
let loadStarted = false;

function loadSamples(c: AudioContext): void {
  if (loadStarted) return;
  loadStarted = true;
  for (let p = SAMPLE_LO; p <= SAMPLE_HI; p += 3) {
    // relative to the page URL, so it works in dev, from disk, and on
    // any deploy subpath (vite base "./")
    void fetch(`samples/salamander/${sampleName(p)}.mp3`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.arrayBuffer();
      })
      .then((b) => c.decodeAudioData(b))
      .then((buf) => void buffers.set(p, buf))
      .catch(() => {}); // this range keeps the oscillator fallback
  }
}

export function ensure(): void {
  if (!ctx) {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new Ctor();
    master = ctx.createDynamicsCompressor();
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
  loadSamples(ctx);
}

// one voice = the nearest piano sample, rate-shifted to pitch; or, while
// that sample isn't decoded yet, a triangle osc behind a short attack ramp.
function spawn(pitch: number): Voice {
  const c = ctx!;
  const gain = c.createGain();
  gain.connect(master!);
  const sp = samplePitchFor(pitch);
  const buf = buffers.get(sp);
  if (buf) {
    const src = c.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = Math.pow(2, (pitch - sp) / 12);
    gain.gain.value = 0.5;
    src.connect(gain);
    src.start();
    return { src, gain };
  }
  const osc = c.createOscillator();
  osc.type = "triangle";
  osc.frequency.value = freq(pitch);
  gain.gain.setValueAtTime(0, c.currentTime);
  gain.gain.linearRampToValueAtTime(0.18, c.currentTime + 0.01);
  osc.connect(gain);
  osc.start();
  return { src: osc, gain };
}
// note-off = damper: fade fast but not instantly, then free the source.
function kill(v: Voice): void {
  const c = ctx!;
  v.gain.gain.cancelScheduledValues(c.currentTime);
  v.gain.gain.setTargetAtTime(0, c.currentTime, 0.06);
  v.src.stop(c.currentTime + 0.5);
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
function liveSilence(): void {
  for (const p of [...live.keys()]) liveOff(p);
}

// Hand sound off to (or back from) a hardware synth. While muted, both the
// score and live paths go quiet so the app's own WebAudio voices don't
// double the external synth driven by MIDI out. Cuts any sounding voices
// immediately; new ones are suppressed at the top of at()/liveOn().
export function setMuted(on: boolean): void {
  muted = on;
  if (on) {
    silence();
    liveSilence();
  }
}

// called every frame with current active set; diff against playing voices
export function at(score: Score, t: number, playing: boolean): void {
  if (!ctx || muted) return;
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
  if (muted) return;
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

export const AudioOut = { ensure, at, silence, setMuted, liveOn, liveOff };
