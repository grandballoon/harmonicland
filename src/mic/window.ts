/* ====================================================================
   STREAM_WINDOW — the sliding view of microphone audio the model reads.

   Basic Pitch is shaped for whole recordings: its graph takes a fixed
   window of WINDOW_SAMPLES (just under 2 s at 22.05 kHz) and returns
   WINDOW_FRAMES frames of 88 pitch activations, one frame per FRAME_HOP
   samples. It is fully convolutional with no recurrence, so it streams
   by re-running on the most recent window and keeping only the frames it
   is now sure of. This module owns that geometry and nothing else: a
   ring of recent samples, a window snapshot aligned to the frame grid,
   and which absolute frames a snapshot settles.

   ALIGNMENT. Frame f of a window starting at sample S describes the audio
   at sample S + f·FRAME_HOP. Windows always start on a multiple of
   FRAME_HOP, so frame f of one run and frame f−k of a later run are the
   same absolute frame, and each absolute frame is committed exactly once.
   Before two seconds have arrived the window starts before sample 0 and
   is padded with silence, which is what the offline path does too.

   LOOKAHEAD. The frames near a window's right edge have not heard the
   audio after them yet (the convolutions see about 15 frames either
   side), so a run settles its frames only up to `lookahead` frames short
   of the edge. That is the latency/accuracy dial: every frame of
   lookahead costs FRAME_HOP / SAMPLE_RATE ≈ 11.6 ms.
   ==================================================================== */

export const SAMPLE_RATE = 22050;
export const FRAME_HOP = 256;
export const WINDOW_SAMPLES = SAMPLE_RATE * 2 - FRAME_HOP; // 43844
export const WINDOW_FRAMES = 172;
/** The model's 88 pitch rows are the piano's keys, A0 upward. */
export const LOWEST_PITCH = 21;
export const N_PITCHES = 88;

/** Seconds of audio one frame spans. */
export const FRAME_SECONDS = FRAME_HOP / SAMPLE_RATE;

// A power of two comfortably above one window, so audio that arrives
// while the model is busy (up to ~1 s of it) never overwrites a sample a
// snapshot still needs.
const CAPACITY = 1 << 16;

export interface Snapshot {
  /** Exactly WINDOW_SAMPLES of audio, silence-padded before sample 0. */
  readonly samples: Float32Array;
  /** Absolute frame index of the window's frame 0 (negative while padded). */
  readonly startFrame: number;
}

export class StreamWindow {
  private readonly ring = new Float32Array(CAPACITY);
  private written = 0; // total samples ever pushed

  push(chunk: Float32Array): void {
    for (let i = 0; i < chunk.length; i++) {
      this.ring[(this.written + i) & (CAPACITY - 1)] = chunk[i];
    }
    this.written += chunk.length;
  }

  /** Total samples received. */
  get samplesIn(): number {
    return this.written;
  }

  /** The newest frame-aligned window that lies wholly inside what has arrived. */
  snapshot(): Snapshot {
    const start = Math.floor((this.written - WINDOW_SAMPLES) / FRAME_HOP) * FRAME_HOP;
    const samples = new Float32Array(WINDOW_SAMPLES);
    for (let i = Math.max(0, -start); i < WINDOW_SAMPLES; i++) {
      samples[i] = this.ring[(start + i) & (CAPACITY - 1)];
    }
    return { samples, startFrame: start / FRAME_HOP };
  }

  /** The last absolute frame a snapshot taken now could settle. */
  settledThrough(lookahead: number): number {
    const startFrame = Math.floor((this.written - WINDOW_SAMPLES) / FRAME_HOP);
    return startFrame + WINDOW_FRAMES - 1 - lookahead;
  }

  reset(): void {
    this.ring.fill(0);
    this.written = 0;
  }
}

/** Root-mean-square level, in dBFS, of the samples around frame f of a snapshot. */
export function frameLevelDb(samples: Float32Array, f: number): number {
  const centre = f * FRAME_HOP;
  const from = Math.max(0, centre - FRAME_HOP);
  const to = Math.min(samples.length, centre + FRAME_HOP);
  let sum = 0;
  for (let i = from; i < to; i++) sum += samples[i] * samples[i];
  const rms = to > from ? Math.sqrt(sum / (to - from)) : 0;
  return rms > 0 ? 20 * Math.log10(rms) : -Infinity;
}
