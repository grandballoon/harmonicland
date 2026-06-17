/* ====================================================================
   LIVE_GAMEPAD — a game controller becomes an input surface, the same
   way LIVE_MIDI turns a hardware keyboard into one. Both feed the one
   seam, LiveKeys.press/release; nothing else is touched and the
   immutable score is left alone.

   The difference is shape: Web MIDI pushes events (onmidimessage), the
   Gamepad API does not — there is no "button pressed" event, you poll
   navigator.getGamepads() each frame. So the pure core here is a state
   DIFF: last frame's held buttons vs this frame's, emitting the down/up
   transitions that MIDI would have handed us as discrete messages. We
   poll inside requestAnimationFrame to stay on the render clock.

   Buttons map to pitches through PITCH_MAP (face/d-pad of a standard
   controller -> a C-major-ish run); analog sticks/triggers are ignored
   for now — like CC and pitch-bend are ignored in live-midi.ts.
   ==================================================================== */
import { LiveKeys } from "./live-keys";

interface GamepadButtonEvent {
  kind: "down" | "up";
  index: number; // button index within Gamepad.buttons
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

let raf = 0;
const held = new Map<number, Set<number>>(); // gamepad index -> pressed buttons

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
    for (const ev of diff(prev, curr)) {
      const pitch = PITCH_MAP[ev.index];
      if (pitch === undefined) continue; // unmapped button -> no note
      if (ev.kind === "down") LiveKeys.press(pitch);
      else LiveKeys.release(pitch);
    }
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
  LiveKeys.releaseAll(); // panic / stuck-note guard, same as live-midi
}

export const LiveGamepad = { enable, disable };
