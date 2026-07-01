/* ====================================================================
   TONNETZ_STATE — live cursor state for the lattice instrument.
   Lattice-native twin of PerfState: owns a cursor (current triad) and
   drives MIDI notes through LiveKeys, so audio, MIDI-out, and the
   Tonnetz glow all come for free — nothing here reaches across to them.

   Same diff-reconcile pattern as PerfState.trigger: common tones stay
   pressed (no re-attack) when the cursor moves while sounding, and only
   changed notes are released/pressed.
   ==================================================================== */
import { LiveKeys } from "./live-keys";
import {
  voiceTriad, transform, translate,
  type Cursor, type Transform, type LatticeStep,
} from "./harmony/tonnetz-lattice";

export interface TonnetzSnapshot {
  cursor: Cursor;
  octave: number;
  sounding: number[];
}

let cursor: Cursor = { col: 0, row: 0, orient: "up" }; // default: C major
let octave = 4;
let sounding: number[] = [];

// Reconcile LiveKeys to the current cursor voicing: release the notes we no
// longer want, press the ones we now do, leave common tones held.
function trigger(): number[] {
  const next = voiceTriad(cursor, octave);
  const nextSet = new Set(next);
  const prevSet = new Set(sounding);
  for (const p of sounding) if (!nextSet.has(p)) LiveKeys.release(p);
  for (const p of next)    if (!prevSet.has(p)) LiveKeys.press(p);
  sounding = next;
  return next;
}

function release(): void {
  for (const p of sounding) LiveKeys.release(p);
  sounding = [];
}

const isSounding = (): boolean => sounding.length > 0;

const resoundIfHeld = (): void => { if (isSounding()) trigger(); };

function apply(t: Transform): void {
  cursor = transform(cursor, t);
  resoundIfHeld();
}

function step(s: LatticeStep): void {
  cursor = translate(cursor, s);
  resoundIfHeld();
}

function nudgeOctave(delta: number): void {
  octave = Math.max(0, Math.min(8, octave + delta));
  resoundIfHeld();
}

function home(): void {
  cursor = { col: 0, row: 0, orient: "up" };
  resoundIfHeld();
}

const snapshot = (): TonnetzSnapshot => ({
  cursor: { ...cursor },
  octave,
  sounding: [...sounding],
});

export const TonnetzState = {
  trigger,
  release,
  isSounding,
  apply,
  step,
  nudgeOctave,
  home,
  snapshot,
};
