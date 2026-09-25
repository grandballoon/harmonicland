/* ====================================================================
   NOISE_GATE — is anybody playing? Basic Pitch normalises each window's
   spectrogram to its own range, so a window of pure room noise is
   stretched until the noise looks like notes. The gate answers per frame
   whether the input stands clear of the room, so silence stays silent.

   It adapts rather than using a fixed level, because microphones differ
   by tens of decibels: a laptop mic beside its own fan and a condenser
   through an audio interface have nothing in common but "quieter than
   the piano". The gate follows the NOISE FLOOR: it drops to any quieter
   frame at once and creeps up slowly, so held chords cannot drag it up
   to meet them. A frame is open when it stands `marginDb` above the
   floor. Hysteresis and a short hold keep a decaying note from
   chattering the gate at its threshold.
   ==================================================================== */
import { FRAME_SECONDS } from "./window";

export interface GateOptions {
  /** How far above the noise floor a frame must be to open the gate. */
  marginDb: number;
  /** How much quieter than the opening level it must fall to close. */
  hysteresisDb: number;
  /** How fast the floor may rise, in dB per second of audio. */
  riseDbPerSecond: number;
  /** Frames the gate stays open after the level falls below the close level. */
  holdFrames: number;
}

export const DEFAULT_GATE: GateOptions = {
  marginDb: 6,
  hysteresisDb: 3,
  riseDbPerSecond: 0.5,
  holdFrames: 8,
};

// Digital silence (a muted interface) is -Infinity dB; clamp so the
// floor stays a number and the first real noise lifts it normally.
const FLOOR_MIN_DB = -100;

export class NoiseGate {
  private floor: number | null = null; // dBFS; null until the first frame
  private open = false;
  private hold = 0;

  constructor(private readonly opts: GateOptions = DEFAULT_GATE) {}

  /** Feed one frame's level; returns whether that frame is open. */
  frame(levelDb: number): boolean {
    const level = Math.max(FLOOR_MIN_DB, levelDb);
    const { marginDb, hysteresisDb, riseDbPerSecond, holdFrames } = this.opts;
    if (this.floor === null || level < this.floor) this.floor = level;
    else this.floor = Math.min(level, this.floor + riseDbPerSecond * FRAME_SECONDS);

    const opensAt = this.floor + marginDb;
    if (level >= opensAt) {
      this.open = true;
      this.hold = holdFrames;
    } else if (this.open && level < opensAt - hysteresisDb) {
      if (this.hold > 0) this.hold--;
      else this.open = false;
    }
    return this.open;
  }

  /** The current noise-floor estimate, in dBFS (for the level meter). */
  get floorDb(): number {
    return this.floor ?? FLOOR_MIN_DB;
  }

  reset(): void {
    this.floor = null;
    this.open = false;
    this.hold = 0;
  }
}
