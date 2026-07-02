/* ====================================================================
   GAMEPAD_PERFECTO — the controller "meaning" that makes the gamepad a
   Perfecto instrument, the hiChord shape. A GamepadMapping for the
   live-gamepad engine: it never polls or touches the DOM, it just reacts to
   the per-frame GamepadFrame and drives PerfState (which in turn drives
   LiveKeys -> audio / MIDI-out / Tonnetz glow). The Nashville view reads the
   same PerfState, so what you play here is what that view draws.

   Two ways to play a chord, live at once (see "Keep both"):
     - Nashville number system (the headline scheme):
         · a TRIGGER (config.rootTrigger)  -> the root chord, degree I
         · a STICK    (config.chordStick)  -> degrees ii..vii° by direction,
           clockwise skipping straight up/down:  ↗ii →iii ↘IV ↙V ←vi ↖vii°
         · a STICK    (config.colorStick)  -> the coloration direction
     - the classic button layout, still fully live in parallel:
         · A B X Y            -> degrees  I  ii iii IV
         · d-pad ↑ → ↓        -> degrees  V  vi vii°

   Shared shaping controls:
     · d-pad ←        cycle inversion
     · LB / RB        coloration mode  prev / next
     · L3 / R3        octave down / up   (moved off the triggers, since a
                      trigger now plays the root chord)
     · the OTHER trigger (the non-root one)  toggle voice-leading

   WHICH trigger and WHICH stick is a plain data choice — the PerfectoConfig
   layer, mirroring gamepad-tonnetz's swappable Bindings. setConfig() swaps
   left/right assignments without touching a line of handler code.

   Held-chord model: every chord source (each degree button, the root
   trigger, the chord stick) is tracked by its own key in a most-recent-wins
   stack, so two sources holding the SAME degree number don't clobber each
   other's release. Coloration / mode / inversion / octave changes re-sound
   only while a chord is held — move a stick on a held chord and it morphs
   underneath.
   ==================================================================== */
import { PerfState } from "./perf-state";
import { AudioOut } from "./outputs/audio";
import type { GamepadMapping, GamepadFrame } from "./live-gamepad";
import type { Degree, JoystickDirection } from "./harmony/perfecto";

// ---------- Config: which physical control means what ----------
export interface PerfectoConfig {
  rootTrigger: "left" | "right"; // trigger that plays the root chord (I)
  chordStick: "left" | "right"; // stick that selects degrees ii..vii°
  colorStick: "left" | "right"; // stick that sets the coloration direction
}

// Defaults keep the historical left-stick = coloration feel, put the root on
// the dominant-hand trigger, and select numbered chords with the right stick.
// chordStick and colorStick are meant to differ; if set equal, the chord
// stick wins that stick and coloration falls back to center (see onFrame).
export const DEFAULT_CONFIG: PerfectoConfig = {
  rootTrigger: "right",
  chordStick: "right",
  colorStick: "left",
};

let config: PerfectoConfig = DEFAULT_CONFIG;
export function setConfig(next: PerfectoConfig): void {
  reset(); // drop any held chord before the controls change meaning
  config = next;
}

// ---------- Standard-mapping button / axis indices ----------
const LT = 6, RT = 7; // analog triggers (their .pressed trips past a threshold)
const L3 = 10, R3 = 11; // stick-click buttons (unused by the classic layout)
const triggerBtn = (side: "left" | "right"): number => (side === "left" ? LT : RT);
// a stick's [x, y] axis pair in the standard mapping.
const stickAxes = (side: "left" | "right"): [number, number] => (side === "left" ? [0, 1] : [2, 3]);

// button index -> Nashville degree (the classic parallel layout, kept)
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
// tests — the only non-trivial geometry in this mapping.
export function stickDirection(x: number, y: number, deadzone = 0.5): JoystickDirection {
  if (Math.hypot(x, y) < deadzone) return "center";
  const deg = (Math.atan2(y, x) * 180) / Math.PI; // -180..180, 0 = east
  const idx = ((Math.round(deg / 45) % 8) + 8) % 8;
  return SECTORS[idx];
}

// the chord stick's six live directions -> Nashville degrees ii..vii°,
// clockwise from up-right, skipping straight up and straight down (and, of
// course, center). Those three "dead" directions return null: no chord.
const STICK_DEGREE: Partial<Record<JoystickDirection, Degree>> = {
  upRight: 2, right: 3, downRight: 4, downLeft: 5, left: 6, upLeft: 7,
};

// pure: chord-stick vector -> the degree it selects, or null in a dead
// direction (up / down / center). Exported for tests.
export function chordStickDegree(x: number, y: number): Degree | null {
  return STICK_DEGREE[stickDirection(x, y)] ?? null;
}

// ---------- Held-chord model ----------
// A source is anything that can hold a chord: "btn<i>" for a degree button,
// "trig" for the root trigger, "stick" for the chord stick. The stack is
// most-recent-last; the top source's degree is what sounds. Keying by source
// (not by degree value) means two sources on the same degree stay independent.
interface HeldChord { src: string; degree: Degree; }
const held: HeldChord[] = [];

const resoundIfHeld = (): void => { if (PerfState.isSounding()) PerfState.trigger(); };

function soundTop(): void {
  if (held.length === 0) { PerfState.release(); return; }
  PerfState.setDegree(held[held.length - 1].degree);
  PerfState.trigger();
}

function activate(src: string, degree: Degree): void {
  const at = held.findIndex((h) => h.src === src);
  if (at >= 0) held.splice(at, 1); // re-press -> move to top
  held.push({ src, degree });
  soundTop();
}

function deactivate(src: string): void {
  const at = held.findIndex((h) => h.src === src);
  if (at < 0) return;
  held.splice(at, 1);
  soundTop();
}

// the chord stick slid to a new sector: update its degree in place and, if
// it's the sounding source, re-trigger — otherwise just remember it.
function retargetStick(degree: Degree): void {
  const entry = held.find((h) => h.src === "stick");
  if (!entry) return;
  entry.degree = degree;
  if (held[held.length - 1] === entry) { PerfState.setDegree(degree); PerfState.trigger(); }
}

// ---------- Per-frame reactions ----------
let lastColorDir: JoystickDirection = "center";
let lastStickDegree: Degree | null = null;

function handleColorStick(f: GamepadFrame): void {
  const [ax, ay] = stickAxes(config.colorStick);
  const dir = stickDirection(f.axes[ax] ?? 0, f.axes[ay] ?? 0);
  if (dir === lastColorDir) return;
  lastColorDir = dir;
  PerfState.setDirection(dir);
  resoundIfHeld();
}

function handleChordStick(f: GamepadFrame): void {
  const [ax, ay] = stickAxes(config.chordStick);
  const rawDir = stickDirection(f.axes[ax] ?? 0, f.axes[ay] ?? 0);
  const isCenter = rawDir === "center";
  const degree = STICK_DEGREE[rawDir] ?? null;

  // ↑ and ↓ are dead directions with no degree assigned, but when you rotate
  // clockwise the stick passes ↓ between ↘ (IV) and ↙ (V). Treating them as
  // a release causes a momentary gap. The fix: only release on center (the
  // analog deadzone); dead directions simply hold the previous selection.
  if (isCenter) {
    if (lastStickDegree !== null) deactivate("stick");
    lastStickDegree = null;
    return;
  }
  if (degree === null) return; // ↑ or ↓ pass-through — hold previous
  if (degree === lastStickDegree) return;
  if (lastStickDegree === null) { AudioOut.ensure(); activate("stick", degree); }
  else retargetStick(degree);
  lastStickDegree = degree;
}

function handleDown(i: number): void {
  const root = triggerBtn(config.rootTrigger);
  const aux = triggerBtn(config.rootTrigger === "left" ? "right" : "left");
  if (i in DEGREE_BTN) {
    AudioOut.ensure(); // a button press is a user gesture — unlock audio
    activate(`btn${i}`, DEGREE_BTN[i]);
    return;
  }
  if (i === root) { AudioOut.ensure(); activate("trig", 1); return; }
  switch (i) {
    case aux: PerfState.setVoiceLeading(!PerfState.snapshot().voiceLeading); resoundIfHeld(); break;
    case 4: PerfState.cycleMode(-1); resoundIfHeld(); break;      // LB
    case 5: PerfState.cycleMode(1); resoundIfHeld(); break;       // RB
    case 14: PerfState.cycleInversion(); resoundIfHeld(); break;  // d-pad ←
    case L3: nudgeOctave(-1); break;                              // L3 (stick click)
    case R3: nudgeOctave(1); break;                               // R3 (stick click)
  }
}

function handleUp(i: number): void {
  if (i in DEGREE_BTN) { deactivate(`btn${i}`); return; }
  if (i === triggerBtn(config.rootTrigger)) deactivate("trig");
}

function nudgeOctave(delta: number): void {
  PerfState.setOctave(PerfState.snapshot().octave + delta);
  resoundIfHeld();
}

function onFrame(f: GamepadFrame): void {
  // sticks first so a chord pressed this same frame already carries the
  // chosen color. When one stick is assigned to both roles (a misconfig),
  // the chord stick wins and coloration stays at center.
  if (config.colorStick !== config.chordStick) handleColorStick(f);
  handleChordStick(f);
  for (const i of f.downs) handleDown(i);
  for (const i of f.ups) handleUp(i);
}

function reset(): void {
  PerfState.release();
  held.length = 0;
  lastColorDir = "center";
  lastStickDegree = null;
}

export const perfectoMapping: GamepadMapping = { onFrame, reset };
