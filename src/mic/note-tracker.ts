/* ====================================================================
   NOTE_TRACKER — per-frame pitch activations become note-on / note-off.

   Basic Pitch gives two activations per key per frame: ONSET (a hammer
   just struck here) and FRAME (this pitch is sounding). The tracker is a
   small state machine per key, with hysteresis at every edge so a real
   piano's decay does not flicker the keyboard:

   - A key goes down when its onset activation RISES THROUGH the onset
     threshold and, within `confirmFrames`, its frame activation reaches
     the confirm threshold. Needing an onset (not merely a sounding frame)
     keeps sympathetic resonance from lighting keys nobody struck; needing
     the confirmation keeps OVERTONES out. Measured on the bundled piano
     samples, a struck key scores onset ≥ 0.85 and frame ≥ 0.6, while the
     octave and twelfth above it reach onset 0.8 but frame under 0.4: the
     onset head hears the overtone's attack, the frame head knows better.
   - It comes up once its frame activation has stayed below the frame
     threshold for `releaseFrames` frames in a row (the debounce), and
     never before it has been down for `minHoldFrames`.
   - A fresh onset on a key that is already down is a RE-STRIKE: it is
     reported as off-then-on, because practice mode advances on attacks
     and a repeated chord must count as played again.
   - A closed noise gate is treated as silence for every key.

   Pure: no audio, no model, no clock. Frames in, events out.
   ==================================================================== */
import { LOWEST_PITCH, N_PITCHES } from "./window";

export interface TrackerOptions {
  /** Onset activation a strike must rise through. */
  onsetThreshold: number;
  /** Frame activation that confirms a strike as a real note... */
  confirmThreshold: number;
  /** ...within this many frames of the onset. */
  confirmFrames: number;
  /** Frame activation below which a held note counts as fading. */
  frameThreshold: number;
  minHoldFrames: number;
  releaseFrames: number;
}

export const DEFAULT_TRACKER: TrackerOptions = {
  onsetThreshold: 0.5,
  confirmThreshold: 0.5,
  confirmFrames: 3,
  frameThreshold: 0.3,
  minHoldFrames: 4,
  releaseFrames: 4,
};

export interface NoteEvent {
  kind: "on" | "off";
  pitch: number; // MIDI note number
}

export class NoteTracker {
  private readonly down = new Uint8Array(N_PITCHES);
  private readonly age = new Uint16Array(N_PITCHES); // frames since last on
  private readonly quiet = new Uint16Array(N_PITCHES); // consecutive frames below threshold
  private readonly lastOnset = new Float32Array(N_PITCHES);
  private readonly pending = new Uint8Array(N_PITCHES); // frames left to confirm a strike

  constructor(private opts: TrackerOptions = DEFAULT_TRACKER) {}

  setOptions(opts: TrackerOptions): void {
    this.opts = opts;
  }

  /** Advance one frame. `open` is the noise gate's verdict for it. */
  frame(onsets: ArrayLike<number>, frames: ArrayLike<number>, open: boolean): NoteEvent[] {
    const { onsetThreshold, confirmThreshold, confirmFrames, frameThreshold, minHoldFrames, releaseFrames } = this.opts;
    const out: NoteEvent[] = [];
    for (let i = 0; i < N_PITCHES; i++) {
      const onset = open ? onsets[i] : 0;
      if (onset >= onsetThreshold && this.lastOnset[i] < onsetThreshold) this.pending[i] = confirmFrames;
      this.lastOnset[i] = onset;
      const frame = open ? frames[i] : 0;
      const struck = this.pending[i] > 0 && frame >= confirmThreshold;
      if (struck) this.pending[i] = 0;
      else if (this.pending[i] > 0) this.pending[i]--;
      const pitch = LOWEST_PITCH + i;

      if (!this.down[i]) {
        if (struck) this.start(i, pitch, out);
        continue;
      }
      if (this.age[i] < 0xffff) this.age[i]++;
      const held = this.age[i] >= minHoldFrames;
      if (struck && held) {
        out.push({ kind: "off", pitch });
        this.start(i, pitch, out);
        continue;
      }
      const sounding = frame >= frameThreshold;
      this.quiet[i] = sounding ? 0 : this.quiet[i] + 1;
      if (held && this.quiet[i] >= releaseFrames) {
        this.down[i] = 0;
        out.push({ kind: "off", pitch });
      }
    }
    return out;
  }

  /** Lift every key that is down (the input is stopping). */
  releaseAll(): NoteEvent[] {
    const out: NoteEvent[] = [];
    for (let i = 0; i < N_PITCHES; i++) {
      if (this.down[i]) out.push({ kind: "off", pitch: LOWEST_PITCH + i });
    }
    this.down.fill(0);
    this.lastOnset.fill(0);
    this.pending.fill(0);
    return out;
  }

  private start(i: number, pitch: number, out: NoteEvent[]): void {
    this.down[i] = 1;
    this.age[i] = 0;
    this.quiet[i] = 0;
    out.push({ kind: "on", pitch });
  }
}
