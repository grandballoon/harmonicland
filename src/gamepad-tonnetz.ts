/* ====================================================================
   GAMEPAD_TONNETZ — the controller meaning for the Tonnetz lattice view.
   A GamepadMapping that drives TonnetzState, mirroring gamepad-perfecto.ts.

   Structured as data over a stable action vocabulary rather than a switch
   on button index: CATALOG maps each ActionId to its handler, and Bindings
   maps button indices to ActionIds. This means Task 6 (customizable
   bindings) only needs to swap the Bindings table — no handler code changes.

   Sustain-to-sound: hold RT to ring the current cursor triad, then walk
   the lattice while it sustains. The cursor moves silently when the
   sustain button is not held.
   ==================================================================== */
import { TonnetzState } from "./tonnetz-state";
import { AudioOut } from "./outputs/audio";
import type { GamepadMapping, GamepadFrame } from "./live-gamepad";

export type ActionId =
  | "transform.P" | "transform.L" | "transform.R"
  | "step.fifthUp" | "step.fifthDown"
  | "step.majThirdUp" | "step.majThirdDown"
  | "step.minThirdUp" | "step.minThirdDown"
  | "octave.up" | "octave.down"
  | "home" | "sustain";

interface CatalogEntry {
  kind: "momentary" | "hold";
  down(): void;
  up?(): void;
}

// The one place each action's effect lives. sustain is the only hold action
// (both edges matter); every other action fires on down and ignores up.
const CATALOG: Record<ActionId, CatalogEntry> = {
  "transform.P": { kind: "momentary", down: () => TonnetzState.apply("P") },
  "transform.L": { kind: "momentary", down: () => TonnetzState.apply("L") },
  "transform.R": { kind: "momentary", down: () => TonnetzState.apply("R") },
  "step.fifthUp":      { kind: "momentary", down: () => TonnetzState.step("fifthUp") },
  "step.fifthDown":    { kind: "momentary", down: () => TonnetzState.step("fifthDown") },
  "step.majThirdUp":   { kind: "momentary", down: () => TonnetzState.step("majThirdUp") },
  "step.majThirdDown": { kind: "momentary", down: () => TonnetzState.step("majThirdDown") },
  "step.minThirdUp":   { kind: "momentary", down: () => TonnetzState.step("minThirdUp") },
  "step.minThirdDown": { kind: "momentary", down: () => TonnetzState.step("minThirdDown") },
  "octave.up":   { kind: "momentary", down: () => TonnetzState.nudgeOctave(1) },
  "octave.down": { kind: "momentary", down: () => TonnetzState.nudgeOctave(-1) },
  "home":    { kind: "momentary", down: () => TonnetzState.home() },
  "sustain": {
    kind: "hold",
    down: () => { AudioOut.ensure(); TonnetzState.trigger(); },
    up:   () => TonnetzState.release(),
  },
};

export type Bindings = Record<number, ActionId>;

export const DEFAULT_BINDINGS: Bindings = {
  7:  "sustain",           // RT
  0:  "transform.P",      // A
  1:  "transform.R",      // B
  2:  "transform.L",      // X
  3:  "home",             // Y
  12: "step.majThirdUp",   // d-pad up
  13: "step.majThirdDown", // d-pad down
  15: "step.fifthUp",     // d-pad right
  14: "step.fifthDown",   // d-pad left
  4:  "octave.down",      // LB
  5:  "octave.up",        // RB
};

let activeBindings: Bindings = DEFAULT_BINDINGS;

export function setBindings(b: Bindings): void {
  activeBindings = b;
}

function onFrame(f: GamepadFrame): void {
  for (const i of f.downs) {
    const action = activeBindings[i];
    if (action) CATALOG[action].down();
  }
  for (const i of f.ups) {
    const action = activeBindings[i];
    if (action) {
      const entry = CATALOG[action];
      if (entry.kind === "hold") entry.up?.();
    }
  }
}

function reset(): void {
  TonnetzState.release();
}

export const tonnetzMapping: GamepadMapping = { onFrame, reset };
