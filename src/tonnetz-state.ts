/* ====================================================================
   TONNETZ_STATE — live cursor state for the lattice instrument.
   Lattice-native twin of PerfState: owns a cursor (current triad) and
   drives MIDI notes through LiveKeys, so audio, MIDI-out, and the
   Tonnetz glow all come for free — nothing here reaches across to them.

   Same diff-reconcile pattern as PerfState.trigger: common tones stay
   pressed (no re-attack) when the cursor moves while sounding, and only
   changed notes are released/pressed. `sounding` holds LiveKeys voice
   handles, not a private copy of the pitches, so a releaseAll from anywhere
   is observed here rather than silently disagreed with.
   ==================================================================== */
import { LiveKeys, type Voice } from "./live-keys";
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
let sounding: Voice[] = [];

// our voices LiveKeys still considers live — see perf-state.ts for why this
// is a query rather than a mirror.
const liveVoices = (): Voice[] => sounding.filter(LiveKeys.isLive);

// Reconcile LiveKeys to the current cursor voicing: release the notes we no
// longer want, press the ones we now do, leave common tones held.
function trigger(): number[] {
  const next = voiceTriad(cursor, octave);
  const nextSet = new Set(next);
  const kept: Voice[] = [];
  for (const held of liveVoices()) {
    if (nextSet.has(held.pitch)) kept.push(held);
    else LiveKeys.release(held);
  }
  const keptPitches = new Set(kept.map((held) => held.pitch));
  for (const p of next) if (!keptPitches.has(p)) kept.push(LiveKeys.press(p));
  sounding = kept;
  return next;
}

function release(): void {
  for (const held of sounding) LiveKeys.release(held);
  sounding = [];
}

const isSounding = (): boolean => liveVoices().length > 0;

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
  sounding: liveVoices().map((held) => held.pitch),
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
