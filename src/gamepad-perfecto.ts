/* ====================================================================
   GAMEPAD_PERFECTO — the controller "meaning" that makes the gamepad a
   Perfecto instrument, the hiChord shape. A GamepadMapping for the
   live-gamepad engine: it never polls or touches the DOM, it just reacts to
   the per-frame GamepadFrame and drives PerfState (which in turn drives
   LiveKeys -> audio / MIDI-out / Tonnetz glow). The Nashville view reads the
   same PerfState, so what you play here is what that view draws.

   BUTTONS ARE DATA. Every button is dispatched through one table:
   Bindings (button index -> ActionId) over CATALOG (ActionId -> what it
   does, and what to call it). No handler switches on a button index, so
   re-binding is a table swap — setBindings() — and a newly added action
   becomes bindable, drawable, and listable the moment it joins CATALOG.
   The legend (outputs/gamepad-legend.ts) and the remap panel
   (ui/gamepad-remap.ts) both read that same table rather than restating it.

   Two ways to play a chord, live at once (see "Keep both"):
     - Nashville number system (the headline scheme):
         · a BUTTON bound to degree.1  -> the root chord, degree I
           (RT by default, and A alongside it)
         · a STICK   (config.chordStick) -> degrees ii..vii° by direction,
           clockwise skipping straight up/down:  ↗ii →iii ↘IV ↙V ←vi ↖vii°
         · a STICK   (config.colorStick) -> the coloration, one of the 8 ring
           zones (Base at the bottom); the hub selects nothing
     - the classic button layout, still fully live in parallel:
         · A B X Y            -> degrees  I  ii iii IV
         · d-pad ↑ → ↓        -> degrees  V  vi vii°

   Default shaping controls (all re-bindable):
     · d-pad ←        cycle inversion
     · LB / RB        octave down / up
     · L3 / R3        coloration mode  prev / next
     · LT             toggle voice-leading

   WHY OCTAVE IS ON THE SHOULDERS AND MODE IS ON THE STICK CLICKS. Octave is
   the one selection that ACCUMULATES: nothing returns it, so every stray nudge
   is kept and the instrument transposes away for good. L3/R3 are the clicks of
   the two sticks a player shoves to the rim on every chord, so they are the
   easiest buttons on the pad to hit by accident — which is exactly why the
   cumulative control cannot live there. Mode can: it wraps through three
   values, it is drawn lit in the header strip, and three presses undo it. So
   the rule is the general one — accumulating controls go on buttons you can
   only press on purpose, wrapping ones can take the accident-prone seats.

   The STICKS are not buttons and stay a separate, small data choice — the
   PerfectoConfig layer: which stick picks degrees, which one colors them.

   Held-chord model: every chord source (each button bound to a degree, the
   chord stick) is tracked by its own key in a most-recent-wins stack, so two
   sources holding the SAME degree number don't clobber each other's release.
   Coloration / mode / inversion / octave changes re-sound only while a chord
   is held — move a stick on a held chord and it morphs underneath.

   SUSTAIN is that same held-chord model with a latched release edge: press
   once to put the chord in the stack, press again to take it out. Nothing
   else about it differs from the hold, which is the point — the drone it
   leaves ringing keeps morphing under the coloration stick, and it frees
   the thumb that was pinning the trigger. Only ONE chord is ever latched:
   pressing another sustain button moves the drone instead of stacking a
   second one, so the button that started a drone is the button that stops
   it. Unbound by default: every seat on the pad is already spoken for, so
   this one is picked in the remap panel.
   ==================================================================== */
import { PerfState } from "./perf-state";
import { AudioOut } from "./outputs/audio";
import type { GamepadMapping, GamepadFrame } from "./live-gamepad";
import { DEGREE_NUMERAL, type Degree, type JoystickDirection } from "./harmony/perfecto";

// ---------- Config: what the two analog sticks mean ----------
export interface PerfectoConfig {
  chordStick: "left" | "right"; // stick that selects degrees ii..vii°
  colorStick: "left" | "right"; // stick that sets the coloration direction
}

// Defaults keep the historical left-stick = coloration feel and select
// numbered chords with the right stick. chordStick and colorStick are meant
// to differ; if set equal, the chord stick wins that stick and the coloration
// simply stops moving (see onFrame).
export const DEFAULT_CONFIG: PerfectoConfig = {
  chordStick: "right",
  colorStick: "left",
};

let config: PerfectoConfig = DEFAULT_CONFIG;
export function setConfig(next: PerfectoConfig): void {
  reset(); // drop any held chord before the controls change meaning
  config = next;
}

// ---------- Standard-mapping button / axis indices ----------
// Named with the Xbox labels the player reads on the controller, so the
// tables below (and the on-screen legend) talk about B, LB, d-pad ← rather
// than 1, 4, 14.
export const BUTTON = {
  A: 0, B: 1, X: 2, Y: 3,
  LB: 4, RB: 5,
  LT: 6, RT: 7, // analog triggers (their .pressed trips past a threshold)
  L3: 10, R3: 11, // stick-click buttons
  dpadUp: 12, dpadDown: 13, dpadLeft: 14, dpadRight: 15,
} as const;

// a stick's [x, y] axis pair in the standard mapping.
const stickAxes = (side: "left" | "right"): [number, number] => (side === "left" ? [0, 1] : [2, 3]);

// The buttons a player can bind, in the order the remap panel lists them.
// This is the physical vocabulary; CATALOG is the functional one.
export const CONTROLS: ReadonlyArray<{ index: number; label: string }> = [
  { index: BUTTON.A, label: "A" },
  { index: BUTTON.B, label: "B" },
  { index: BUTTON.X, label: "X" },
  { index: BUTTON.Y, label: "Y" },
  { index: BUTTON.LB, label: "LB" },
  { index: BUTTON.RB, label: "RB" },
  { index: BUTTON.LT, label: "LT" },
  { index: BUTTON.RT, label: "RT" },
  { index: BUTTON.dpadUp, label: "d-pad ↑" },
  { index: BUTTON.dpadRight, label: "d-pad →" },
  { index: BUTTON.dpadDown, label: "d-pad ↓" },
  { index: BUTTON.dpadLeft, label: "d-pad ←" },
  { index: BUTTON.L3, label: "L3 (click)" },
  { index: BUTTON.R3, label: "R3 (click)" },
];

// ---------- Stick geometry ----------
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
// A source is anything that can hold a chord: "btn<i>" for a button bound to
// a degree, "stick" for the chord stick. The stack is most-recent-last; the
// top source's degree is what sounds. Keying by source (not by degree value)
// means two sources on the same degree stay independent.
interface HeldChord { src: string; degree: Degree; }
const held: HeldChord[] = [];

// Which source, if any, is LATCHED — held with no thumb on it (see sustain).
// At most one: a latch is the instrument sitting on a chord, and it can only
// sit on one. Two latches at once would each need their own "off" press, and
// the second one pressed would toggle between the two drones instead of
// stopping the sound — a state the player can hear but not see or escape.
let latchedSrc: string | null = null;

// take the latch out of the stack WITHOUT re-sounding: every caller sounds
// immediately afterwards, and an intermediate trigger would re-attack notes.
function unlatch(): void {
  if (latchedSrc === null) return;
  const at = held.findIndex((h) => h.src === latchedSrc);
  if (at >= 0) held.splice(at, 1);
  latchedSrc = null;
}

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

// ---------- The action vocabulary ----------
// Everything a button can be made to do. Adding a member here (plus its
// CATALOG entry) makes it bindable, drawable, and listable everywhere —
// nothing else enumerates actions.
export type ActionId =
  | "degree.1" | "degree.2" | "degree.3" | "degree.4"
  | "degree.5" | "degree.6" | "degree.7"
  | "sustain.1" | "sustain.2" | "sustain.3" | "sustain.4"
  | "sustain.5" | "sustain.6" | "sustain.7"
  | "mode.prev" | "mode.next"
  | "inversion.cycle"
  | "octave.down" | "octave.up" | "octave.home"
  | "voiceLeading.toggle";

interface CatalogEntry {
  kind: "momentary" | "hold"; // hold actions care about the release edge too
  // The same action said at three lengths, because it is read in three
  // places: on the button cap in the legend, in the caption beside the pad,
  // and in the remap panel's menu.
  label: string;
  caption: string;
  name: string;
  degree: Degree | null; // set when the action plays a chord degree
  down(src: string): void;
  up?(src: string): void;
}

const degreeAction = (d: Degree): CatalogEntry => ({
  kind: "hold",
  label: DEGREE_NUMERAL[d],
  caption: `hold: chord ${DEGREE_NUMERAL[d]}`,
  name: `Chord ${DEGREE_NUMERAL[d]} (hold)`,
  degree: d,
  down: (src) => activate(src, d),
  up: (src) => deactivate(src),
});

// The latched twin of degreeAction: the same chord, entering and leaving the
// same held stack under the same source key, but its release edge is a second
// press rather than the button coming up. So a sustained chord behaves exactly
// like a held one — the color stick still morphs it, another chord still
// stacks on top of it, and reset() still lifts it — while the thumb goes free.
//
// Pressing a DIFFERENT sustain button moves the drone rather than adding one
// (see latchedSrc): the only latch there is is the one you just pressed, so
// the button that started a drone is always the button that stops it.
const sustainAction = (d: Degree): CatalogEntry => ({
  kind: "momentary", // the button-up edge does nothing; the NEXT down releases
  label: `${DEGREE_NUMERAL[d]}∞`,
  caption: `sustain: chord ${DEGREE_NUMERAL[d]}`,
  name: `Chord ${DEGREE_NUMERAL[d]} (sustain on/off)`,
  degree: d,
  down: (src) => {
    const wasThisOne = latchedSrc === src;
    unlatch();
    if (wasThisOne) { soundTop(); return; } // that press was the "off"
    latchedSrc = src;
    activate(src, d);
  },
});

const shaping = (
  id: { label: string; caption: string; name: string }, effect: () => void,
): CatalogEntry => ({
  kind: "momentary",
  ...id,
  degree: null,
  down: () => { effect(); resoundIfHeld(); },
});

// The one place each action's effect — and its name — lives.
const CATALOG: Record<ActionId, CatalogEntry> = {
  "degree.1": degreeAction(1),
  "degree.2": degreeAction(2),
  "degree.3": degreeAction(3),
  "degree.4": degreeAction(4),
  "degree.5": degreeAction(5),
  "degree.6": degreeAction(6),
  "degree.7": degreeAction(7),
  "sustain.1": sustainAction(1),
  "sustain.2": sustainAction(2),
  "sustain.3": sustainAction(3),
  "sustain.4": sustainAction(4),
  "sustain.5": sustainAction(5),
  "sustain.6": sustainAction(6),
  "sustain.7": sustainAction(7),
  "mode.prev": shaping(
    { label: "md◀", caption: "◀ mode", name: "Coloration mode ◀ previous" },
    () => PerfState.cycleMode(-1)),
  "mode.next": shaping(
    { label: "md▶", caption: "mode ▶", name: "Coloration mode ▶ next" },
    () => PerfState.cycleMode(1)),
  "inversion.cycle": shaping(
    { label: "inv", caption: "cycle inversion", name: "Cycle inversion" },
    () => PerfState.cycleInversion()),
  "octave.down": shaping(
    { label: "oct−", caption: "octave −", name: "Octave down" },
    () => PerfState.setOctave(PerfState.snapshot().octave - 1)),
  "octave.up": shaping(
    { label: "oct+", caption: "octave +", name: "Octave up" },
    () => PerfState.setOctave(PerfState.snapshot().octave + 1)),
  // the way home: octave is the only cumulative selection, so it is also the
  // only one that needs an absolute move back. Unbound by default (the pad has
  // no seat to spare) but bindable from the remap panel like anything else.
  "octave.home": shaping(
    { label: "oct0", caption: "octave home", name: "Octave back to home" },
    () => PerfState.resetOctave()),
  "voiceLeading.toggle": shaping(
    { label: "VL", caption: "voice-leading", name: "Toggle voice-leading" },
    () => PerfState.setVoiceLeading(!PerfState.snapshot().voiceLeading)),
};

// the catalog as a menu, in binding-panel order: chords first, then shape.
export const ACTION_CHOICES: ReadonlyArray<{ id: ActionId; name: string }> =
  (Object.keys(CATALOG) as ActionId[]).map((id) => ({ id, name: CATALOG[id].name }));

// pure: is this an action the catalog knows? The gate persisted or
// user-supplied bindings have to pass.
export const isActionId = (v: unknown): v is ActionId =>
  typeof v === "string" && Object.prototype.hasOwnProperty.call(CATALOG, v);

// ---------- Bindings: button index -> action ----------
export type Bindings = Readonly<Record<number, ActionId>>;

export const DEFAULT_BINDINGS: Bindings = {
  [BUTTON.A]: "degree.1", [BUTTON.B]: "degree.2",
  [BUTTON.X]: "degree.3", [BUTTON.Y]: "degree.4",
  [BUTTON.dpadUp]: "degree.5", [BUTTON.dpadRight]: "degree.6",
  [BUTTON.dpadDown]: "degree.7",
  [BUTTON.RT]: "degree.1", // the root chord under the dominant-hand trigger
  [BUTTON.LT]: "voiceLeading.toggle",
  [BUTTON.dpadLeft]: "inversion.cycle",
  // octave on the shoulders, mode on the stick clicks — see the header note:
  // the control that accumulates must not sit under a stick you shove to play.
  [BUTTON.LB]: "octave.down", [BUTTON.RB]: "octave.up",
  [BUTTON.L3]: "mode.prev", [BUTTON.R3]: "mode.next",
};

let bindings: Bindings = DEFAULT_BINDINGS;

// Swap the whole table. Resets first: a button that was holding a chord is
// about to mean something else, and nothing may be left sounding.
export function setBindings(next: Bindings): void {
  reset();
  bindings = { ...next };
}

export const getBindings = (): Bindings => bindings;

// ---------- Per-frame reactions ----------
let lastStickDegree: Degree | null = null;

// The coloration ring is all 8 compass zones, Base at the bottom; the HUB is
// empty. Center is a pass-through, not a selection: sweeping across the middle
// (or letting the stick spring back) HOLDS the current color, so you can go
// from any color to any other in one motion without Base cutting in between.
// The selection lives in PerfState rather than a local cache, so the keyboard
// harness and ChordLink can move it without desyncing this handler.
function handleColorStick(f: GamepadFrame): void {
  const [ax, ay] = stickAxes(config.colorStick);
  const dir = stickDirection(f.axes[ax] ?? 0, f.axes[ay] ?? 0);
  if (dir === "center" || dir === PerfState.snapshot().joystickDirection) return;
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

// one dispatch path for every button: look it up, run the bound action.
function handleDown(i: number): void {
  const action = bindings[i];
  if (!action) return;
  AudioOut.ensure(); // a bound press is a user gesture — unlock audio
  CATALOG[action].down(`btn${i}`);
}

function handleUp(i: number): void {
  const action = bindings[i];
  if (!action) return;
  const entry = CATALOG[action];
  if (entry.kind === "hold") entry.up?.(`btn${i}`);
}

function onFrame(f: GamepadFrame): void {
  // sticks first so a chord pressed this same frame already carries the
  // chosen color. When one stick is assigned to both roles (a misconfig),
  // the chord stick wins and the coloration stays where it last was.
  if (config.colorStick !== config.chordStick) handleColorStick(f);
  handleChordStick(f);
  for (const i of f.downs) handleDown(i);
  for (const i of f.ups) handleUp(i);
}

function reset(): void {
  PerfState.release();
  held.length = 0;
  latchedSrc = null;
  lastStickDegree = null;
}

export const perfectoMapping: GamepadMapping = { onFrame, reset };

// ---------- The mapping, as data a view can draw ----------
// The on-screen controller legend must never drift from what the tables
// above actually do, so it doesn't get to restate the bindings: it asks for
// them. Plain data out, one way — nothing here reads a view.
export interface ControlBinding {
  action: ActionId;
  label: string; // on the button cap
  caption: string; // beside the pad
  name: string; // in a menu
  degree: Degree | null; // the chord it plays, if it plays one
}

export interface ControlMap {
  chordStick: "left" | "right"; // selects degrees by direction
  colorStick: "left" | "right" | null; // sets coloration (null if misconfigured onto the chord stick)
  buttons: Readonly<Record<number, ControlBinding>>; // BUTTON index -> what it does (bound ones only)
  stickDegrees: Readonly<Partial<Record<JoystickDirection, Degree>>>; // chord-stick direction -> degree
}

export function controlMap(): ControlMap {
  const buttons: Record<number, ControlBinding> = {};
  for (const [key, action] of Object.entries(bindings)) {
    const e = CATALOG[action];
    buttons[Number(key)] =
      { action, label: e.label, caption: e.caption, name: e.name, degree: e.degree };
  }
  return {
    chordStick: config.chordStick,
    colorStick: config.colorStick === config.chordStick ? null : config.colorStick,
    buttons,
    stickDegrees: STICK_DEGREE,
  };
}
