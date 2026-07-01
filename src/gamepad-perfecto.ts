/* ====================================================================
   GAMEPAD_PERFECTO — the controller "meaning" that makes the gamepad a
   Perfecto instrument, the hiChord shape. A GamepadMapping for the
   live-gamepad engine: it never polls or touches the DOM, it just reacts to
   the per-frame GamepadFrame and drives PerfState (which in turn drives
   LiveKeys -> audio / MIDI-out / Tonnetz glow). Mirrors the temporary
   keyboard harness in main.ts, so the two input surfaces stay in lockstep.

   Layout (W3C standard mapping):
     A B X Y           -> degrees  I  ii iii IV
     d-pad ↑ → ↓       -> degrees  V  vi vii°
     d-pad ←           -> cycle inversion
     LB / RB           -> coloration mode  prev / next
     LT / RT           -> octave  down / up
     left stick        -> coloration direction (the joystick itself)

   A held degree button sustains its chord; the most-recently-pressed wins
   when several are down (a stack), exactly like the keyboard harness. Stick
   / mode / octave / inversion changes re-sound only while a chord is held —
   move the stick on a held chord and the coloration morphs underneath it.
   ==================================================================== */
import { PerfState } from "./perf-state";
import { AudioOut } from "./outputs/audio";
import type { GamepadMapping, GamepadFrame } from "./live-gamepad";
import type { Degree, JoystickDirection } from "./harmony/perfecto";

// button index -> Nashville degree (standard mapping)
const DEGREE_BTN: Record<number, Degree> = {
  0: 1, 1: 2, 2: 3, 3: 4, // A B X Y -> I ii iii IV
  12: 5, 15: 6, 13: 7, //   d-pad ↑ → ↓ -> V vi vii°
};

// the 8 compass directions in clockwise order from due-east, for sector
// lookup. atan2(y, x) is in SCREEN coords (y points down), so +90° is
// "down" — which is why this list runs right, down-right, down, …
const SECTORS: JoystickDirection[] = [
  "right", "downRight", "down", "downLeft", "left", "upLeft", "up", "upRight",
];

// pure: an analog-stick vector -> one of the 9 joystick zones. Inside the
// deadzone it's center; otherwise the nearest 45° sector. Exported for
// tests — the only non-trivial bit of this mapping.
export function stickDirection(x: number, y: number, deadzone = 0.5): JoystickDirection {
  if (Math.hypot(x, y) < deadzone) return "center";
  const deg = (Math.atan2(y, x) * 180) / Math.PI; // -180..180, 0 = east
  const idx = ((Math.round(deg / 45) % 8) + 8) % 8;
  return SECTORS[idx];
}

const heldDegrees: Degree[] = []; // stack of held degree buttons, latest last
let lastDir: JoystickDirection = "center";

const resoundIfHeld = (): void => { if (PerfState.isSounding()) PerfState.trigger(); };

function handleDown(i: number): void {
  if (i in DEGREE_BTN) {
    const d = DEGREE_BTN[i];
    AudioOut.ensure(); // a button press is a user gesture — unlock audio
    if (!heldDegrees.includes(d)) heldDegrees.push(d);
    PerfState.setDegree(d);
    PerfState.trigger();
    return;
  }
  switch (i) {
    case 4: PerfState.cycleMode(-1); resoundIfHeld(); break;       // LB
    case 5: PerfState.cycleMode(1); resoundIfHeld(); break;        // RB
    case 6: nudgeOctave(-1); break;                                // LT
    case 7: nudgeOctave(1); break;                                 // RT
    case 14: PerfState.cycleInversion(); resoundIfHeld(); break;   // d-pad ←
  }
}

function handleUp(i: number): void {
  if (!(i in DEGREE_BTN)) return;
  const d = DEGREE_BTN[i];
  const at = heldDegrees.indexOf(d);
  if (at >= 0) heldDegrees.splice(at, 1);
  if (heldDegrees.length === 0) PerfState.release();
  else {
    PerfState.setDegree(heldDegrees[heldDegrees.length - 1]);
    PerfState.trigger();
  }
}

function nudgeOctave(delta: number): void {
  PerfState.setOctave(PerfState.snapshot().octave + delta);
  resoundIfHeld();
}

function onFrame(f: GamepadFrame): void {
  // left stick is the coloration joystick — update before buttons so a
  // chord pressed this same frame already carries the chosen color.
  const dir = stickDirection(f.axes[0] ?? 0, f.axes[1] ?? 0);
  if (dir !== lastDir) {
    lastDir = dir;
    PerfState.setDirection(dir);
    resoundIfHeld();
  }
  for (const i of f.downs) handleDown(i);
  for (const i of f.ups) handleUp(i);
}

function reset(): void {
  PerfState.release();
  heldDegrees.length = 0;
  lastDir = "center";
}

export const perfectoMapping: GamepadMapping = { onFrame, reset };
