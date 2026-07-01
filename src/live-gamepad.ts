/* ====================================================================
   LIVE_GAMEPAD — a game controller becomes an input surface. The poll
   engine is the same as before (the Gamepad API has no events, so we diff
   last frame's held buttons against this frame's inside rAF), but WHAT a
   button or stick means is now a swappable GamepadMapping:

     - keysMapping (default): face/d-pad buttons -> a C-major-ish run of
       pitches, straight into LiveKeys. The original behavior.
     - perfectoMapping (gamepad-perfecto.ts): buttons -> Nashville degrees,
       left stick -> chord coloration, driving PerfState. The hiChord shape.

   main.ts swaps the mapping with the view (Nashville -> perfecto, else
   keys), the same "swap a reference" move the view toggle already is. The
   engine stays ignorant of both; it just hands each mapping a per-frame
   GamepadFrame (button down/up transitions + the held set + raw axes).
   Axes used to be ignored — the perfecto mapping needs them for the stick.
   ==================================================================== */
import { LiveKeys } from "./live-keys";

interface GamepadButtonEvent {
  kind: "down" | "up";
  index: number; // button index within Gamepad.buttons
}

/** What the engine hands a mapping each frame: the button transitions (the
 *  stand-in for MIDI's discrete note-on/off), the currently-held set, and
 *  the raw analog axes for sticks/triggers. */
export interface GamepadFrame {
  downs: number[];
  ups: number[];
  held: ReadonlySet<number>;
  axes: readonly number[];
}

/** A controller "meaning" — pluggable so the same poll engine drives the
 *  chromatic keyboard or the Perfecto instrument. reset() is the panic /
 *  stuck-state guard, called on disable and when switching mappings. */
export interface GamepadMapping {
  onFrame(f: GamepadFrame): void;
  reset(): void;
}

// Standard-mapping button index -> MIDI pitch. Indices follow the W3C
// "standard" gamepad layout (A/B/X/Y, bumpers, d-pad, …); a controller
// reporting a non-standard mapping will land on whatever indices it
// exposes, which is fine — unmapped buttons simply produce no note.
const PITCH_MAP: Record<number, number> = {
  0: 60, // A  -> C4
  1: 62, // B  -> D4
  2: 64, // X  -> E4
  3: 65, // Y  -> F4
  4: 67, // LB -> G4
  5: 69, // RB -> A4
  12: 71, // d-pad up    -> B4
  13: 72, // d-pad down  -> C5
  14: 74, // d-pad left  -> D5
  15: 76, // d-pad right -> E5
};

// the default mapping: buttons straight to LiveKeys, the original behavior.
export const keysMapping: GamepadMapping = {
  onFrame(f) {
    for (const i of f.downs) {
      const p = PITCH_MAP[i];
      if (p !== undefined) LiveKeys.press(p);
    }
    for (const i of f.ups) {
      const p = PITCH_MAP[i];
      if (p !== undefined) LiveKeys.release(p);
    }
  },
  reset() {
    LiveKeys.releaseAll();
  },
};

// pure: which button indices are pressed in this snapshot. A button's
// .pressed flag covers analog triggers too (it trips past a threshold).
export function pressedButtons(pad: Gamepad): Set<number> {
  const out = new Set<number>();
  pad.buttons.forEach((btn, i) => {
    if (btn.pressed) out.add(i);
  });
  return out;
}

// pure: last frame's held set vs this frame's -> the transitions. This
// is the standin for MIDI's discrete note-on/off messages.
export function diff(prev: Set<number>, curr: Set<number>): GamepadButtonEvent[] {
  const events: GamepadButtonEvent[] = [];
  for (const i of curr) if (!prev.has(i)) events.push({ kind: "down", index: i });
  for (const i of prev) if (!curr.has(i)) events.push({ kind: "up", index: i });
  return events;
}

let mapping: GamepadMapping = keysMapping;
let raf = 0;
const held = new Map<number, Set<number>>(); // gamepad index -> pressed buttons

// swap the controller's meaning. Resets the outgoing mapping so no note or
// chord is left stuck across the switch.
function setMapping(next: GamepadMapping): void {
  if (next === mapping) return;
  mapping.reset();
  mapping = next;
}

function step(): void {
  // getGamepads() returns a fresh, sparse snapshot each call (nulls for
  // empty slots / disconnected pads) — never cache the array.
  const pads = navigator.getGamepads();
  const live = new Set<number>();
  for (const pad of pads) {
    if (!pad) continue;
    live.add(pad.index);
    const prev = held.get(pad.index) ?? new Set<number>();
    const curr = pressedButtons(pad);
    const events = diff(prev, curr);
    mapping.onFrame({
      downs: events.filter((e) => e.kind === "down").map((e) => e.index),
      ups: events.filter((e) => e.kind === "up").map((e) => e.index),
      held: curr,
      axes: pad.axes,
    });
    held.set(pad.index, curr);
  }
  // drop state for pads that vanished mid-frame so a reconnect starts clean
  for (const idx of [...held.keys()]) if (!live.has(idx)) held.delete(idx);
  raf = requestAnimationFrame(step);
}

// enable() needs no permission prompt, but the Gamepad API hides pads
// until the user presses a button (a privacy gate), so the first frames
// may simply see nothing — that's expected, not an error.
function enable(): void {
  if (!navigator.getGamepads) {
    throw new Error("The Gamepad API is not supported in this browser.");
  }
  if (raf) return; // already polling — idempotent like attachAll()
  raf = requestAnimationFrame(step);
}

function disable(): void {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  held.clear();
  mapping.reset(); // panic / stuck-note guard, same as live-midi
}

export const LiveGamepad = { enable, disable, setMapping };
