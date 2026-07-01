/* ====================================================================
   PERF_STATE — the live selection for the generative (Perfecto) mode, and
   its counterpart to LiveKeys. LiveKeys owns "which raw pitches are held";
   this owns "which Key / Degree / coloration is selected" and turns a
   trigger into a chord by running computeVoicing and pressing the result
   THROUGH LiveKeys. So audio (AudioOut.liveOn), MIDI-out (the live path),
   and the Tonnetz glow all come for free — nothing here reaches across to
   them, exactly as live-midi.ts / live-gamepad.ts only touch LiveKeys.

   Two pieces of state, kept apart on purpose:
   - `sounding` — the exact MIDI notes currently pressed into LiveKeys, so a
     re-trigger DIFFS (common tones stay down, no re-attack) and release()
     lifts precisely what we put down.
   - `previousVoicing` — the last chord computed, fed back in for
     voice-leading. It outlives release() so the NEXT chord still leads from
     it, the way a player's hand stays near where it just was.

   The immutable Score is never touched; recording a performance into it is
   the deferred mutable-model step, same boundary LiveKeys draws.
   ==================================================================== */
import { LiveKeys } from "./live-keys";
import {
  computeVoicing,
  type Key,
  type Degree,
  type JoystickMode,
  type JoystickDirection,
  type Inversion,
  type Voicing,
} from "./harmony/perfecto";

export interface PerfSnapshot {
  key: Key;
  degree: Degree;
  joystickMode: JoystickMode;
  joystickDirection: JoystickDirection;
  inversion: Inversion;
  octave: number;
  voiceLeading: boolean;
  sounding: number[]; // MIDI notes currently pressed (empty when silent)
}

const MODES: JoystickMode[] = ["default", "extended", "chromatic"];
const INVERSIONS: Inversion[] = ["root", "first", "second"];

const sel = {
  key: { root: 0, scale: "major" } as Key, // C major
  degree: 1 as Degree,
  joystickMode: "default" as JoystickMode,
  joystickDirection: "center" as JoystickDirection,
  inversion: "root" as Inversion,
  octave: 4,
  voiceLeading: false,
};

let sounding: number[] = []; // what we've pressed into LiveKeys right now
let previousVoicing: Voicing | null = null; // for voice-leading continuity

// compute the current selection and reconcile LiveKeys to it: release the
// notes we no longer want, press the ones we now do, leave common tones be.
// Idempotent — calling trigger() with no change presses/releases nothing.
function trigger(): Voicing {
  const v = computeVoicing({ ...sel, previousVoicing });
  const next = new Set(v.notes);
  const prev = new Set(sounding);
  for (const p of sounding) if (!next.has(p)) LiveKeys.release(p);
  for (const p of v.notes) if (!prev.has(p)) LiveKeys.press(p);
  sounding = v.notes;
  previousVoicing = v; // lead the next chord from this one
  return v;
}

// lift the current chord but keep previousVoicing, so the next trigger still
// voice-leads from where the hand just was.
function release(): void {
  for (const p of sounding) LiveKeys.release(p);
  sounding = [];
}

// whether a chord is sounding right now — lets callers re-trigger on a
// coloration change only while a chord is held (hiChord's live joystick).
const isSounding = (): boolean => sounding.length > 0;

// setters return void and DON'T auto-trigger; the input layer decides when a
// change should re-sound (e.g. moving the stick while a chord is held).
function setDegree(d: Degree): void { sel.degree = d; }
function setDirection(dir: JoystickDirection): void { sel.joystickDirection = dir; }
function setKey(key: Key): void { sel.key = key; }
function setInversion(inv: Inversion): void { sel.inversion = inv; }
function setOctave(oct: number): void { sel.octave = Math.max(0, Math.min(8, oct)); }
function setVoiceLeading(on: boolean): void { sel.voiceLeading = on; }
function setMode(m: JoystickMode): void { sel.joystickMode = m; }

function cycleMode(dir = 1): void {
  const i = MODES.indexOf(sel.joystickMode);
  setMode(MODES[(i + dir + MODES.length) % MODES.length]);
}
function cycleInversion(dir = 1): void {
  const i = INVERSIONS.indexOf(sel.inversion);
  setInversion(INVERSIONS[(i + dir + INVERSIONS.length) % INVERSIONS.length]);
}

const snapshot = (): PerfSnapshot => ({ ...sel, sounding: [...sounding] });

export const PerfState = {
  trigger,
  release,
  isSounding,
  snapshot,
  setDegree,
  setDirection,
  setKey,
  setInversion,
  setOctave,
  setVoiceLeading,
  setMode,
  cycleMode,
  cycleInversion,
};
