/* ====================================================================
   NOTE_GATE — the sequence waits for you.

   Turn it on and the piece stops advancing by itself: the only thing that
   moves it forward is playing the chord in front of you. That makes the
   Hands view a practice loop rather than a display, and it is the last
   piece of the reframing — with time gone, "when does the next chord
   arrive" had no answer left except *when you play this one*.

   A tiny state machine, kept in its own module for the same reason
   `perf-state.ts` is: the views read it and main.ts drives it, and
   neither of them should own it. Everything here is pitch sets and strike
   counts — no score, no clock, no DOM — so the rule below is testable on
   its own, which matters because the rule is subtle.

   ADVANCE WHEN EVERY KEY IS DOWN AND EVERY STRUCK KEY IS FRESHLY STRUCK.
   The target has two halves and they ask different things: `hold` is the
   whole sonority, including notes still ringing that the fingers are
   merely resting on, and `strike` is what the score actually starts here.

   DEMANDING THE WHOLE STRIKE SET IS WHAT ACCOUNTS FOR EVERY NOTE. A note
   is struck at exactly one onset, so a gate at every onset that demands
   that onset's strike set demands each note exactly once — 598 of 598 in
   the Chopin prelude, across its 189 strikes. Asking for a single fresh
   key instead (the obvious version) lets a three-note chord through on one
   finger, and the other two are never played at all.

   `hold` alone runs away. Two chords in a row can be satisfied by the
   same keys — when the next sonority is a SUBSET of this one, a voice
   dropping out leaves its keys already down the instant you arrive — so a
   bare "are all the target notes held?" fires again immediately, and
   again, until the piece is over.

   Freshness cannot be read from the held SET, which is why this takes
   strike counts instead. A release and the next press can both land
   between two frames, and `PerfState.trigger()` does exactly that: it
   releases and re-presses a whole chord in one synchronous call. A reader
   polling the held set sees nothing happen and waits forever. Counting
   strikes per pitch survives any sampling rate.

   Counting them PER PITCH, rather than one counter for the keyboard, is
   what makes a wrong note harmless: a brushed neighbour is not one of the
   chord's own keys, so it cannot pass the gate on the chord's behalf.
   Extra keys do not block either — a wrong note is a mistake you can see,
   since the Hands view rings every key you are holding, not a reason to
   refuse the right ones.
   ==================================================================== */
import type { Pitch } from "./types";

/** What the player's hands are doing. `LiveKeys` is the only producer. */
export interface Keys {
  held: ReadonlySet<Pitch>;
  strikes: ReadonlyMap<Pitch, number>;
}

/** What one strike of the score asks for. `outputs/hands.ts` produces it;
 *  `strike` is always a subset of `hold`. */
export interface Target {
  index: number;
  hold: readonly Pitch[];
  strike: readonly Pitch[];
}

let enabled = false;
/** The strike the gate is watching; a new one is a new thing to wait for. */
let at = -1;
/** Strike counts for the current target's struck keys, as they stood when
 *  the gate last had its say. A key whose count has risen since is freshly
 *  played. */
let marked = new Map<Pitch, number>();
/** What the last `check` was still waiting for, so the view can say. */
let missing = 0;
let pending = 0;

export const isEnabled = (): boolean => enabled;

export function setEnabled(on: boolean): void {
  enabled = on;
  reset();
}

/** Forget where we were. Called whenever the thing being practised changes
 *  underneath the gate — a new score, a different hand. */
export function reset(): void {
  at = -1;
  marked = new Map();
  missing = 0;
  pending = 0;
}

/** What the gate is still waiting for, as of the last `check`: keys not yet
 *  down, and keys down but not yet played. Pure read — the view calls it
 *  every frame, right after main.ts has asked `check` exactly once.
 *
 *  Both numbers exist because "nothing is missing but it still will not
 *  advance" is otherwise an unreadable state: you are holding all four
 *  keys and the gate is waiting for you to strike two of them again. */
export const status = (): { missing: number; pending: number } => ({ missing, pending });

const struck = (keys: Keys, p: Pitch): number => keys.strikes.get(p) ?? 0;

/** Every pitch of the target is down. An empty target is never satisfied:
 *  there is nothing to play, so there is nothing to wait for either, and
 *  saying "yes" would advance the sequence on silence. */
export function satisfied(hold: readonly Pitch[], held: ReadonlySet<Pitch>): boolean {
  return hold.length > 0 && hold.every((p) => held.has(p));
}

/** How many of the target's keys are down, for a readout. Pure. */
export function progress(hold: readonly Pitch[], held: ReadonlySet<Pitch>): number {
  return hold.reduce((n, p) => n + (held.has(p) ? 1 : 0), 0);
}

/** Should the sequence advance now?
 *
 *  MUTATES, and must be asked exactly once per frame by exactly one
 *  caller — it is the edge detector, and a second reader would consume the
 *  edge. Anything that only wants to *display* the gate's state should call
 *  `status`, `progress` or `satisfied`. */
export function check(target: Target, keys: Keys): boolean {
  if (!enabled) return false;
  const { hold, strike } = target;
  // Arriving somewhere new marks the counts as they stand, so a chord
  // already under your fingers has to be played rather than counted.
  if (target.index !== at) {
    at = target.index;
    marked = new Map(strike.map((p) => [p, struck(keys, p)]));
  }
  missing = hold.length - progress(hold, keys.held);
  pending = strike.filter((p) => struck(keys, p) <= (marked.get(p) ?? 0)).length;
  if (!satisfied(hold, keys.held) || pending > 0) return false;
  marked = new Map(strike.map((p) => [p, struck(keys, p)]));
  return true;
}

export const NoteGate = { isEnabled, setEnabled, reset, status, satisfied, progress, check };
