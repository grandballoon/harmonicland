/* ====================================================================
   PERF_STATE — the live selection for the generative (Perfecto) mode, and
   its counterpart to LiveKeys. LiveKeys owns "which raw pitches are held";
   this owns "which Key / Degree / coloration is selected" and turns a
   trigger into a chord by running computeVoicing and pressing the result
   THROUGH LiveKeys. So audio (AudioOut.liveOn), MIDI-out (the live path),
   and the Tonnetz glow all come for free — nothing here reaches across to
   them, exactly as live-midi.ts / live-gamepad.ts only touch LiveKeys.

   Two pieces of state, kept apart on purpose:
   - `sounding` — the LiveKeys VOICES we are holding, so a re-trigger DIFFS
     (common tones stay down, no re-attack) and release() lifts precisely
     what we put down. These are handles, not a mirror: every read goes
     through liveVoices(), which drops any handle LiveKeys has since
     invalidated (a releaseAll on a view change, say). So there is no second
     copy of "what is sounding" to fall out of sync with the first.
   - `previousVoicing` — the last chord computed, fed back in for
     voice-leading. It outlives release() so the NEXT chord still leads from
     it, the way a player's hand stays near where it just was.

   The immutable Score is never touched; recording a performance into it is
   the deferred mutable-model step, same boundary LiveKeys draws.
   ==================================================================== */
import { LiveKeys, type Voice } from "./live-keys";
import {
  computeVoicing,
  type Key,
  type Degree,
  type JoystickMode,
  type JoystickDirection,
  type Inversion,
  type Voicing,
  type ComputeVoicingArgs,
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
  /** The chord this selection WOULD sound, root position, no voice-leading.
   *  Computed here rather than by a view, so "what does this selection mean"
   *  stays one module's question and the Nashville renderer needs no harmony
   *  import at all — which is also what lets it be a pure function of this
   *  snapshot. */
  preview: number[];
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

let sounding: Voice[] = []; // the voices we're holding in LiveKeys right now
let previousVoicing: Voicing | null = null; // for voice-leading continuity

// our voices that LiveKeys still considers live. Anything released out from
// under us (a releaseAll on a view change) drops out here, so every question
// below is answered against the one copy of the truth rather than a mirror.
const liveVoices = (): Voice[] => sounding.filter(LiveKeys.isLive);

// The conversion to computeVoicing's arguments, written out field by field
// rather than spread. A spread typechecks against a structurally-overlapping
// record and TypeScript skips excess-property checks on it, so `sounding`
// used to ride silently into the call and a new field on either type would
// have been fed garbage with no error. Naming every field makes any such
// divergence a compile error, in exactly one place.
const toVoicingArgs = (previous: Voicing | null): ComputeVoicingArgs => ({
  key: sel.key,
  degree: sel.degree,
  joystickMode: sel.joystickMode,
  joystickDirection: sel.joystickDirection,
  inversion: sel.inversion,
  octave: sel.octave,
  voiceLeading: sel.voiceLeading,
  previousVoicing: previous,
});

/** The chord the current selection would sound if triggered now: root
 *  position, no voice-leading, so it is a property of the SELECTION and not
 *  of whatever was played before it. The readout shows this while silent. */
const preview = (): number[] =>
  computeVoicing({ ...toVoicingArgs(null), voiceLeading: false }).notes;

// compute the current selection and reconcile LiveKeys to it: release the
// notes we no longer want, press the ones we now do, leave common tones be.
// Idempotent — calling trigger() with no change presses/releases nothing.
function trigger(): Voicing {
  const v = computeVoicing(toVoicingArgs(previousVoicing));
  const next = new Set(v.notes);
  const kept: Voice[] = [];
  for (const held of liveVoices()) {
    if (next.has(held.pitch)) kept.push(held);
    else LiveKeys.release(held);
  }
  const keptPitches = new Set(kept.map((held) => held.pitch));
  for (const p of v.notes) if (!keptPitches.has(p)) kept.push(LiveKeys.press(p));
  sounding = kept;
  previousVoicing = v; // lead the next chord from this one
  return v;
}

// lift the current chord but keep previousVoicing, so the next trigger still
// voice-leads from where the hand just was.
function release(): void {
  for (const held of sounding) LiveKeys.release(held);
  sounding = [];
}

// whether a chord is sounding right now — lets callers re-trigger on a
// coloration change only while a chord is held (hiChord's live joystick).
const isSounding = (): boolean => liveVoices().length > 0;

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

const snapshot = (): PerfSnapshot => ({
  ...sel,
  sounding: liveVoices().map((held) => held.pitch),
  preview: preview(),
});

export const PerfState = {
  trigger,
  release,
  preview,
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
