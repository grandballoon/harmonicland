/* ====================================================================
   TRANSCRIBER — streaming audio in, note events out. It strings the
   three pure pieces together around a model it is handed:

     push(audio) → StreamWindow → infer(window) → per settled frame:
                   NoiseGate(level) + NoteTracker(onsets, frames) → events

   The model is a parameter (`Infer`), not an import, so this runs the
   same against Basic Pitch in the worker, against Basic Pitch on the CPU
   in an offline check, and against a scripted fake in the unit tests. A
   later, causal piano model is a different `Infer` and nothing else.

   SELF-PACING. Inference runs whenever at least `minHopFrames` new frames
   could be settled and the previous run has finished; audio arriving
   meanwhile just accumulates. A fast GPU therefore runs often with little
   lag, and a slow machine runs back-to-back with more lag, but neither
   ever builds a backlog: each run settles everything that has arrived.
   ==================================================================== */
import { DEFAULT_GATE, NoiseGate, type GateOptions } from "./gate";
import { DEFAULT_TRACKER, NoteTracker, type NoteEvent, type TrackerOptions } from "./note-tracker";
import { FRAME_HOP, SAMPLE_RATE, StreamWindow, WINDOW_FRAMES, frameLevelDb } from "./window";

/** One window's activations: [WINDOW_FRAMES][88], values 0–1. */
export interface Activations {
  readonly onsets: ArrayLike<ArrayLike<number>>;
  readonly frames: ArrayLike<ArrayLike<number>>;
}

/** The model: one window of 22.05 kHz mono audio to its activations. */
export type Infer = (window: Float32Array) => Promise<Activations>;

export interface TranscriberOptions {
  /** Frames short of the window's edge a run settles to (≈11.6 ms each). */
  lookahead: number;
  /** Fewest newly settleable frames worth a model run. */
  minHopFrames: number;
  tracker: TrackerOptions;
  gate: GateOptions;
}

export const DEFAULT_TRANSCRIBER: TranscriberOptions = {
  lookahead: 8,
  minHopFrames: 4,
  tracker: DEFAULT_TRACKER,
  gate: DEFAULT_GATE,
};

/** How the last run went, for the level meter and the latency readout. */
export interface Stats {
  /** Milliseconds the model took. */
  inferMs: number;
  /** Milliseconds between a settled frame's audio arriving and its events. */
  lagMs: number;
  /** Level of the newest settled frame, and the gate's floor, in dBFS. */
  levelDb: number;
  floorDb: number;
  gateOpen: boolean;
}

export interface TranscriberSinks {
  onEvents(events: NoteEvent[]): void;
  onStats?(stats: Stats): void;
  /** The model failed (a lost GPU context, say). Reported once; the
   *  transcriber then ignores further audio. */
  onError?(err: unknown): void;
}

export class Transcriber {
  private readonly window = new StreamWindow();
  private readonly gate: NoiseGate;
  private readonly tracker: NoteTracker;
  private committed = -1; // last absolute frame handed to the tracker
  private busy = false;
  private failed = false;
  private idle: Promise<void> = Promise.resolve();

  constructor(
    private readonly infer: Infer,
    private opts: TranscriberOptions,
    private readonly sinks: TranscriberSinks,
  ) {
    this.gate = new NoiseGate(opts.gate);
    this.tracker = new NoteTracker(opts.tracker);
  }

  /** Change the latency dial or the thresholds without losing held notes. */
  setOptions(opts: Pick<TranscriberOptions, "lookahead" | "tracker">): void {
    this.opts = { ...this.opts, ...opts };
    this.tracker.setOptions(opts.tracker);
  }

  push(chunk: Float32Array): void {
    if (this.failed) return;
    this.window.push(chunk);
    if (!this.busy) this.idle = this.pump();
  }

  /** Resolves once every run the pushed audio called for has finished. */
  settled(): Promise<void> {
    return this.idle;
  }

  private ready(): boolean {
    return this.window.settledThrough(this.opts.lookahead) - this.committed >= this.opts.minHopFrames;
  }

  private async pump(): Promise<void> {
    this.busy = true;
    try {
      while (this.ready()) await this.step();
    } catch (err) {
      this.failed = true;
      this.sinks.onError?.(err);
    } finally {
      this.busy = false;
    }
  }

  private async step(): Promise<void> {
    const { samples, startFrame } = this.window.snapshot();
    const began = performance.now();
    const act = await this.infer(samples);
    const inferMs = performance.now() - began;

    // settle up to `lookahead` short of the edge of THIS window, which
    // may be older than the audio that arrived while the model ran
    const through = startFrame + WINDOW_FRAMES - 1 - this.opts.lookahead;
    const events: NoteEvent[] = [];
    let levelDb = -Infinity;
    let gateOpen = false;
    // a machine too slow to keep up skips frames rather than queueing them
    for (let abs = Math.max(this.committed + 1, startFrame, 0); abs <= through; abs++) {
      const f = abs - startFrame;
      levelDb = frameLevelDb(samples, f);
      gateOpen = this.gate.frame(levelDb);
      events.push(...this.tracker.frame(act.onsets[f], act.frames[f], gateOpen));
    }
    this.committed = Math.max(this.committed, through);

    if (events.length) this.sinks.onEvents(events);
    this.sinks.onStats?.({
      inferMs,
      lagMs: ((this.window.samplesIn - through * FRAME_HOP) / SAMPLE_RATE) * 1000,
      levelDb,
      floorDb: this.gate.floorDb,
      gateOpen,
    });
  }
}
