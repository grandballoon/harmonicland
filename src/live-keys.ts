/* ====================================================================
   LIVE_KEYS — the one bit of state that is neither the score nor the
   clock: which keys are physically sounding right now. It owns the live
   voices and drives AudioOut / MidiOut on the first press and the last
   release of a pitch; PianoRoll reads held() to light those keys. The
   immutable score is never touched — recording a performance INTO the
   score is the later, mutable-model step, deliberately not done here.

   OWNERSHIP IS A VALUE. press() hands back an opaque `Voice` handle and
   release() takes one, so "these pitches are mine" is expressible in the
   interface rather than mirrored privately by each caller. Two consequences
   the old set-of-ints could not have:

   - Refcounting. A pointer-pressed C4 and a chord's C4 are two voices on
     one pitch; the key stops sounding only when the last one lifts.
   - No desync. releaseAll() from anywhere invalidates every outstanding
     handle, so an owner that asks isLive() gets the truth instead of
     believing a stale private mirror. Owners derive their state from the
     handles they hold; they never keep a second copy of it.

   This is also the seam live MIDI input plugs into: a Web MIDI note-on/off
   maps to press(pitch) / release(voice) with nothing else touched.

   ATTACKS ARE OBSERVABLE. onPress publishes every press as it happens.
   held() answers "what is down"; it cannot answer "was this struck
   again", because a chord played twice and a chord held through are the
   same set. Practice mode's advance rule turns on exactly that
   difference, and polling held() per frame would miss a release and
   re-press inside one 16ms frame.

   SILENT VOICES. A voice pressed with { silent: true } is held, glows,
   and is published to onPress like any other, but never reaches the
   sinks. It is for surfaces that listen to an instrument that already
   makes its own sound — the microphone: sounding the sample back would
   double the piano, and through the speakers it would feed back into
   the mic that heard it. The sinks follow the AUDIBLE voices only, so a
   pointer press on a key the mic is already holding still sounds.

   There is deliberately no onRelease. Nothing needs one: a release only
   ever makes a set smaller, so every question about it is already
   answered by reading held() at the moment you care. An unused symmetric
   half would be surface to keep working for no caller.
   ==================================================================== */
import { AudioOut } from "./outputs/audio";
import { MidiOut } from "./outputs/midi-out";
import type { Pitch } from "./types";

/** A single live press. Opaque: identity IS the handle, and the only thing
 *  a holder may read is which pitch it sounds. Two presses of the same pitch
 *  are two distinct voices. */
export interface Voice {
  readonly pitch: Pitch;
}

const voices = new Map<Pitch, Set<Voice>>(); // pitch -> the voices holding it
const silent = new WeakSet<Voice>(); // voices that hold a key without sounding it

export interface PressOptions {
  /** Hold and glow, but leave the sinks alone (see SILENT VOICES above). */
  silent?: boolean;
}

// does any voice other than `except` sound this pitch?
function audibleOn(pitch: Pitch, except: Voice): boolean {
  for (const v of voices.get(pitch) ?? []) if (v !== except && !silent.has(v)) return true;
  return false;
}

/** Press subscribers. Same shape as clock.onFrame: add, and hand back the
 *  removal. Notified per VOICE, not per pitch — the refcounted sinks above
 *  are the per-pitch view of the same events, and handing over the Voice is
 *  what lets a subscriber that also PRESSES notes tell its own apart. */
export type PressListener = (v: Voice) => void;
const pressSubs = new Set<PressListener>();

export function onPress(fn: PressListener): () => void {
  pressSubs.add(fn);
  return () => pressSubs.delete(fn);
}

function press(pitch: Pitch, { silent: quiet = false }: PressOptions = {}): Voice {
  const v: Voice = { pitch };
  if (quiet) silent.add(v);
  else if (!audibleOn(pitch, v)) {
    AudioOut.liveOn(pitch);
    MidiOut.liveOn(pitch); // no-op until a MIDI-out port is enabled
  }
  let set = voices.get(pitch);
  if (!set) voices.set(pitch, (set = new Set<Voice>()));
  set.add(v);
  // after the map and the sinks agree, so a listener that reads held()
  // synchronously sees this press already in it. Iterating a copy so a
  // listener may unsubscribe from inside its own callback.
  for (const fn of [...pressSubs]) fn(v);
  return v;
}

// idempotent: releasing a dead handle (one already lifted, or invalidated by
// releaseAll) does nothing, which is what lets owners release defensively.
function release(v: Voice): void {
  const set = voices.get(v.pitch);
  if (!set?.delete(v)) return;
  if (set.size === 0) voices.delete(v.pitch);
  if (!silent.has(v) && !audibleOn(v.pitch, v)) {
    AudioOut.liveOff(v.pitch);
    MidiOut.liveOff(v.pitch);
  }
}

/** Is this handle still sounding? The query that replaces a private mirror. */
const isLive = (v: Voice): boolean => voices.get(v.pitch)?.has(v) ?? false;

function releaseAll(): void {
  for (const set of [...voices.values()]) for (const v of [...set]) release(v);
}

const held = (): ReadonlySet<Pitch> => new Set(voices.keys());

export const LiveKeys = { press, release, releaseAll, isLive, held, onPress };
