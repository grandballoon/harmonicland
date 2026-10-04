/* ====================================================================
   PERFECTO_KEYS — which computer-keyboard key means what when the keyboard
   plays the Perfecto chord instrument, and the words that say so.

   Pure data, one owner. main.ts's keydown handler reads the bindings to
   ACT on a key; the Nashville view reads the legend to DESCRIBE them. Both
   come from the tables below, so the written description cannot drift from
   what a key actually does — rebind a key here and the legend follows.

   The degree keys are the digits 1–7 themselves (the key IS the Nashville
   number), so they need no table.
   ==================================================================== */
import type { JoystickDirection } from "./harmony/perfecto";

// the coloration direction, laid out on the keyboard as it is on the wheel
export const DIR_KEYS: Record<string, JoystickDirection> = {
  q: "upLeft", w: "up", e: "upRight",
  a: "left", s: "center", d: "right",
  z: "downLeft", x: "down", c: "downRight",
};

// the single-shot shaping keys
export const SHAPE_KEYS = {
  mode: "m",
  inversion: "i",
  voiceLeading: "v",
  octaveDown: "-",
  octaveUp: "=",
} as const;

// ---------- The legend ----------
/** One printed line: the key caps (may be empty on a continuation line) and
 *  what they do. Lines are broken by hand — the view sets them as they are. */
export interface LegendLine { keys: string; says: string; }
export interface LegendBlock { title: string; lines: LegendLine[]; }

const cap = (k: string): string => k.toUpperCase();
const dirKey = (dir: JoystickDirection): string =>
  cap(Object.keys(DIR_KEYS).find((k) => DIR_KEYS[k] === dir) ?? "");
const dirRow = (...dirs: JoystickDirection[]): string => dirs.map(dirKey).join(" ");

/** Two blocks, one for each side of the coloration wheel: the keys that
 *  PLAY a chord, and the keys that SHAPE it. */
export const KEY_LEGEND: [LegendBlock, LegendBlock] = [
  {
    title: "KEYBOARD · PLAY",
    lines: [
      { keys: "1 – 7", says: "hold to play a chord," },
      { keys: "", says: "I to vii°" },
      { keys: dirRow("upLeft", "up", "upRight"), says: "tilt the coloration," },
      { keys: dirRow("left", "center", "right"), says: "laid out like the" },
      { keys: dirRow("downLeft", "down", "downRight"), says: `wheel; ${dirKey("center")} is plain` },
    ],
  },
  {
    title: "KEYBOARD · SHAPE",
    lines: [
      { keys: cap(SHAPE_KEYS.mode), says: "next coloration mode" },
      { keys: cap(SHAPE_KEYS.inversion), says: "next inversion" },
      { keys: cap(SHAPE_KEYS.voiceLeading), says: "voice-leading on / off" },
      { keys: `${SHAPE_KEYS.octaveDown}  ${SHAPE_KEYS.octaveUp}`, says: "octave down / up" },
      { keys: "", says: "Each re-sounds a chord" },
      { keys: "", says: "that is being held." },
    ],
  },
];
