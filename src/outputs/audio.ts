/* ====================================================================
   AUDIO_OUT — the built-in piano: an Output (types.ts) on WebAudio. It is
   handed strikes already placed in wall time by the scheduler and only
   decides how they sound; it knows nothing of scores, clocks or loops.

   The instrument is a SAMPLED PIANO: the Salamander Grand (Alexander
   Holm, CC BY), four velocity layers of 30 recordings spaced a minor
   third apart from A0 to C8, bundled as static assets built by
   tools/samples/salamander.ts — no dependency, no third-party host. A
   note plays the nearest sample pitch-shifted by playbackRate (at most one
   semitone, inaudible as artifact). Everything it sounds goes through a
   small room and a limiter (room.ts).

   VOICES are one registry, the score's and the user's hands' alike, since
   they are strings of one instrument:
   - a note-off is a DAMPER falling: a fade whose time depends on the
     string — long in the bass, short in the treble (releaseTime) — and
     above E6 there is no damper at all, as on a real piano: the note
     rings on until it dies away by itself;
   - striking a key that is still sounding cuts the earlier sound in 30ms,
     as the hammer does to its own string;
   - at most MAX_VOICES sound at once; past that, the most-decayed voice
     already released is taken for the new one (or failing that the
     oldest), faded in 10ms so the theft is not heard as a click.

   VELOCITY. A note sounds the layer recorded nearest its velocity, so a
   soft note has a soft note's timbre, not a loud one turned down. Its
   gain does two things. It keeps loudness continuous where the layer
   changes: the layers' measured levels (salamander.json) are interpolated
   to the level this velocity "should" have, and the chosen recording is
   corrected to it. And it applies the velocity curve the source's own SFZ
   mapping uses (73% veltrack), which is what takes the range from the
   ~10 dB between the recordings to a piano's ~30.

   LOADING. Samples decode lazily on ensure() (the first user gesture),
   the middle layer (v8) first across the whole keyboard: ready() settles
   when it is in, and playback waits for it (main.ts). The other layers
   stream in behind; until one is ready its notes use the nearest layer
   that is. Only a pitch whose every fetch failed falls back to a triangle
   oscillator, so sound is never silently broken.

   TWO CLOCKS. Strikes arrive in performance.now() milliseconds; WebAudio
   schedules in AudioContext seconds. The two tick at the same rate but
   from different origins, so the offset between them is sampled on every
   strike and the LARGEST recent sample is trusted: currentTime advances in
   render-quantum steps, so every sample reads it a little behind, and the
   least-behind is the truest.

   SAMPLE ONSETS. MP3 encoding pads the front of every file with silence
   of its own length (20–50ms, different per file), which would smear a
   chord across its samples. Each buffer's leading silence is measured at
   decode and skipped at every start.
   ==================================================================== */
import levels from "./salamander.json";
import { makeRoom } from "./room";
import type { Output, Pitch, Strike } from "../types";

interface Voice {
  src: OscillatorNode | AudioBufferSourceNode;
  gain: GainNode;
  pitch: number;
  /** Audio time it starts sounding. */
  start: number;
  /** Audio time its sound starts to die: a damper, a fade. Infinity while
   *  the key is held or the string has no damper. */
  releaseAt: number;
  /** Audio time the source stops: its recording's end, or a fade's. */
  stop: number;
  /** On the score path, which flush() silences; else a live key's. */
  score: boolean;
}

interface Sample {
  buf: AudioBuffer;
  /** Seconds of leading silence to skip. */
  trim: number;
}

let ctx: AudioContext | null = null;
let room: AudioNode | null = null; // where every voice goes (room.ts)
const voices = new Set<Voice>(); // every voice not yet ended, sounding or still to sound
const live = new Map<Pitch, Voice>(); // user-played keys, while held

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

/** Where the sound starts, in seconds: the first frame of any channel above
 *  -60 dBFS, backed off 2ms so the attack's own rise is kept. */
export function leadingSilence(channels: readonly Float32Array[], sampleRate: number): number {
  const THRESHOLD = 0.001; // -60 dBFS
  let first = Infinity;
  for (const ch of channels) {
    for (let i = 0; i < Math.min(ch.length, first); i++) {
      if (Math.abs(ch[i]) > THRESHOLD) {
        first = i;
        break;
      }
    }
  }
  if (!Number.isFinite(first)) return 0;
  return Math.max(0, first / sampleRate - 0.002);
}

// ---- velocity -> layer and gain (pure, exported for tests) -----------
interface Layer {
  readonly layer: number;
  /** The velocity this layer was recorded to stand for. */
  readonly velocity: number;
}
/** The layers, softest first. */
export const LAYERS: readonly Layer[] = [...levels.layers].sort((a, b) => a.velocity - b.velocity);
const PEAK_DB = levels.peakDb as Record<string, Record<string, number>>;

/** Overall level: mezzo-forte about where the one-layer piano played it. */
const HEADROOM = 0.7;
/** The SFZ's amp_veltrack 73%: gain = (velocity / 127) ^ (2 * 0.73). */
const VELTRACK = 1.46;

/** The level, in dB, a note at `velocity` has on the sample `name`:
 *  the layers' measured peaks, interpolated between the velocities they
 *  stand for, and held flat beyond the softest and loudest. */
export function levelDb(velocity: number, name: string): number {
  const at = (l: Layer): number => PEAK_DB[l.layer][name];
  if (velocity <= LAYERS[0].velocity) return at(LAYERS[0]);
  for (let i = 1; i < LAYERS.length; i++) {
    const lo = LAYERS[i - 1];
    const hi = LAYERS[i];
    if (velocity <= hi.velocity) {
      const f = (velocity - lo.velocity) / (hi.velocity - lo.velocity);
      return at(lo) + f * (at(hi) - at(lo));
    }
  }
  return at(LAYERS[LAYERS.length - 1]);
}

/** Which of the `ready` layers sounds `velocity` on sample `name` — the
 *  one recorded nearest it — and the gain that gives it its level. Null
 *  when no layer of this sample is ready. */
export function voicing(velocity: number, name: string, ready: (layer: number) => boolean): { layer: number; gain: number } | null {
  let best: Layer | null = null;
  for (const l of LAYERS)
    if (ready(l.layer) && (!best || Math.abs(l.velocity - velocity) < Math.abs(best.velocity - velocity))) best = l;
  if (!best) return null;
  const correction = Math.pow(10, (levelDb(velocity, name) - PEAK_DB[best.layer][name]) / 20);
  return { layer: best.layer, gain: HEADROOM * correction * Math.pow(velocity / 127, VELTRACK) };
}

// ---- lazy sample loading -------------------------------------------
/** The layer that must be in before playback starts: the middle of the
 *  range, then the rest outward from it. */
const LOAD_ORDER = [8, 12, 4, 16];
const SAMPLE_COUNT = (SAMPLE_HI - SAMPLE_LO) / 3 + 1;
const samples = new Map<string, Sample>(); // "layer:samplePitch" -> decoded audio
const key = (layer: number, samplePitch: number): string => `${layer}:${samplePitch}`;
let loadStarted = false;
let firstSettled = 0; // pitches of the first layer decoded or failed
const progressSubs = new Set<(done: number, total: number) => void>();
let markReady: () => void = () => {};
const readyPromise = new Promise<void>((resolve) => (markReady = resolve));

function loadSample(c: AudioContext, layer: number, p: number): Promise<void> {
  // relative to the page URL, so it works in dev, from disk, and on
  // any deploy subpath (vite base "./")
  return fetch(`samples/salamander/v${layer}/${sampleName(p)}.mp3`)
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.arrayBuffer();
    })
    .then((b) => c.decodeAudioData(b))
    .then((buf) => {
      const channels = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
      samples.set(key(layer, p), { buf, trim: leadingSilence(channels, buf.sampleRate) });
    })
    .catch(() => {}); // the nearest layer that did load stands in
}

async function loadSamples(c: AudioContext): Promise<void> {
  if (loadStarted) return;
  loadStarted = true;
  const pitches = Array.from({ length: SAMPLE_COUNT }, (_, i) => SAMPLE_LO + 3 * i);
  const [first, ...rest] = LOAD_ORDER;
  await Promise.all(pitches.map((p) => loadSample(c, first, p).then(() => {
    firstSettled++;
    for (const fn of [...progressSubs]) fn(firstSettled, SAMPLE_COUNT);
  })));
  markReady();
  for (const layer of rest) await Promise.all(pitches.map((p) => loadSample(c, layer, p)));
}

/** Settles once the first layer is in: every pitch decoded, or failed. */
const ready = (): Promise<void> => readyPromise;
/** Has it? */
const isReady = (): boolean => firstSettled === SAMPLE_COUNT;
/** Follow the first layer's loading, as pitches settled of the total. */
function onProgress(fn: (done: number, total: number) => void): () => void {
  progressSubs.add(fn);
  return () => progressSubs.delete(fn);
}

export function ensure(): void {
  if (!ctx) {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new Ctor({ latencyHint: "interactive" });
    room = makeRoom(ctx);
    // a suspended context's clock stands still, so offsets sampled across
    // a suspension describe no clock at all
    ctx.addEventListener("statechange", () => void (skews.length = 0));
  }
  if (ctx.state === "suspended") void ctx.resume();
  void loadSamples(ctx);
}

// ---- wall time -> audio time ----------------------------------------
const skews: number[] = []; // recent currentTime - performance.now(), seconds
const SKEW_SAMPLES = 32;

function audioTimeOf(ms: number): number {
  const c = ctx!;
  const skew = c.currentTime - performance.now() / 1000;
  // only a running clock is worth remembering; a suspended one stands still
  if (c.state === "running") {
    skews.push(skew);
    if (skews.length > SKEW_SAMPLES) skews.shift();
  }
  return ms / 1000 + (skews.length > 0 ? Math.max(...skews) : skew);
}

// ---- the strings (pure, exported for tests) -------------------------
/** Pitches above this (E6) have no damper. */
export const HIGHEST_DAMPED = 88;
/** How many voices may sound at once. */
export const MAX_VOICES = 96;
/** Fade time constants, seconds: a re-struck string, a stolen voice, a stop. */
const RESTRIKE_TC = 0.008; // ~30ms to silence
const STEAL_TC = 0.0025; // ~10ms
const STOP_TC = 0.05;

/** The damper's fade time constant for a pitch: 0.25s at A0 falling to
 *  0.05s at C6 on a log scale — a heavy bass string rings on under its
 *  damper; a short treble one stops at once — and 0.05s above. */
export function releaseTime(pitch: number): number {
  const lo = 21;
  const hi = 84;
  const f = (Math.min(hi, Math.max(lo, pitch)) - lo) / (hi - lo);
  return 0.25 * Math.pow(0.05 / 0.25, f);
}

/** Which voice gives way when `when` needs one more than MAX_VOICES:
 *  of those already sounding then, the one released longest ago (the most
 *  decayed), or failing any released, the oldest. Null if none sounds yet. */
export function victim<V extends { start: number; releaseAt: number }>(sounding: Iterable<V>, when: number): V | null {
  let best: V | null = null;
  const rank = (v: V): [number, number] => [v.releaseAt <= when ? v.releaseAt : Infinity, v.start];
  for (const v of sounding) {
    if (v.start > when) continue;
    if (!best) best = v;
    else {
      const [r, s0] = rank(v);
      const [br, bs] = rank(best);
      if (r < br || (r === br && s0 < bs)) best = v;
    }
  }
  return best;
}

// ---- voices ----------------------------------------------------------
// one voice = the nearest piano sample in the layer nearest `velocity`,
// rate-shifted to pitch, started `offset` seconds in; or, where no layer of
// that sample could be loaded, a triangle osc behind a short attack ramp.
function spawn(pitch: number, velocity: number, when: number, offset: number, score: boolean): Voice {
  const c = ctx!;
  makeRoomFor(pitch, when);
  const gain = c.createGain();
  gain.connect(room!);
  const sp = samplePitchFor(pitch);
  const vc = voicing(velocity, sampleName(sp), (layer) => samples.has(key(layer, sp)));
  let voice: Voice;
  if (vc) {
    const sample = samples.get(key(vc.layer, sp))!;
    const src = c.createBufferSource();
    src.buffer = sample.buf;
    const rate = Math.pow(2, (pitch - sp) / 12);
    src.playbackRate.value = rate;
    gain.gain.value = vc.gain;
    src.connect(gain);
    const from = sample.trim + offset * rate;
    src.start(when, from);
    const end = when + Math.max(0, sample.buf.duration - from) / rate;
    voice = { src, gain, pitch, start: when, releaseAt: Infinity, stop: end, score };
  } else {
    const osc = c.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = freq(pitch);
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(0.18 * Math.pow(velocity / 127, VELTRACK) * 2, when + 0.01);
    osc.connect(gain);
    osc.start(when);
    voice = { src: osc, gain, pitch, start: when, releaseAt: Infinity, stop: Infinity, score };
  }
  voices.add(voice);
  voice.src.onended = () => void voices.delete(voice);
  return voice;
}

/** Before a string sounds at `when`: cut what it is still sounding, and
 *  free a voice if every one is taken. */
function makeRoomFor(pitch: number, when: number): void {
  let sounding = 0;
  for (const v of voices) {
    if (v.stop <= when) continue;
    if (v.pitch === pitch && v.start < when) fade(v, when, RESTRIKE_TC);
    else sounding++;
  }
  if (sounding < MAX_VOICES) return;
  const v = victim([...voices].filter((x) => x.stop > when && !(x.pitch === pitch && x.start < when)), when);
  if (v) fade(v, when, STEAL_TC);
}

/** The damper falls at `when` — if the string has one. An oscillator
 *  standing in for a sample never dies away by itself, so it always does. */
function damp(v: Voice, when: number): void {
  if (v.pitch > HIGHEST_DAMPED && v.stop !== Infinity) return;
  const tc = releaseTime(v.pitch);
  v.gain.gain.setTargetAtTime(0, when, tc);
  v.releaseAt = Math.min(v.releaseAt, when);
  stopAt(v, when + 8 * tc);
}

/** Silence a voice from `when`, over time constant `tc`, from whatever
 *  level it has reached by then — overriding its own release if later. */
function fade(v: Voice, when: number, tc: number): void {
  const c = ctx!;
  if (v.start > when) return stopAt(v, Math.max(c.currentTime, when)); // never heard
  const g = v.gain.gain;
  if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(when);
  else {
    g.cancelScheduledValues(when);
    g.setValueAtTime(g.value, when);
  }
  g.setTargetAtTime(0, when, tc);
  v.releaseAt = Math.min(v.releaseAt, when);
  stopAt(v, when + 8 * tc);
}

/** Now: the transport stopped, or the output was let go of. */
const kill = (v: Voice): void => fade(v, ctx!.currentTime, STOP_TC);

// stop() twice is legal by the spec but threw in older Safari
function stopAt(v: Voice, when: number): void {
  if (when >= v.stop) return;
  v.stop = when;
  try {
    v.src.stop(when);
  } catch {
    // already stopped: nothing left to free
  }
}

// ---- the Output ------------------------------------------------------
function strike(s: Strike): void {
  if (!ctx) return; // not unlocked yet: nothing can sound
  const when = Math.max(ctx.currentTime, audioTimeOf(s.at));
  const v = spawn(s.pitch, s.velocity, when, s.offset ?? 0, true);
  // the piano sustains its own notes: the damper falls where the pedal
  // lets it (Strike.damp), else at the key-up
  const up = s.damp ?? s.off;
  if (up !== undefined) damp(v, Math.max(when, audioTimeOf(up)));
}

function flush(): void {
  if (!ctx) return;
  for (const v of voices) if (v.score) kill(v);
}

function latency(): number {
  if (!ctx) return 0;
  return (ctx.outputLatency || 0) + (ctx.baseLatency || 0);
}

// live key path — independent of the score and the clock. One voice per
// held pitch, started/stopped by user input rather than the scheduler.
// This is the "playable keyboard" seam: sound without touching the model.
function liveOn(pitch: number, velocity: number): void {
  ensure();
  if (live.has(pitch)) return;
  live.set(pitch, spawn(pitch, velocity, ctx!.currentTime, 0, false));
}
function liveOff(pitch: number): void {
  const v = live.get(pitch);
  if (!v) return;
  live.delete(pitch);
  damp(v, ctx!.currentTime);
}

function detach(): void {
  if (!ctx) return;
  for (const v of voices) kill(v);
  live.clear();
}

// WebAudio can cancel anything it has been handed, so it takes each note
// whole, note-off and all, and has nothing to hold back for advance()
const advance = (): void => {};
// every strike carries its damper time: the pedal itself changes nothing here
const pedal = (): void => {};

export const AudioOut: Output & {
  ensure(): void;
  ready(): Promise<void>;
  isReady(): boolean;
  onProgress(fn: (done: number, total: number) => void): () => void;
} = { ensure, ready, isReady, onProgress, strike, advance, pedal, flush, latency, liveOn, liveOff, detach };
