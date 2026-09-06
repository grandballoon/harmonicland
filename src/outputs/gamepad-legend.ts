/* ====================================================================
   GAMEPAD_LEGEND — the controller map, DRAWN. A schematic Xbox 360 pad
   (standard Gamepad-API layout: left stick upper-left, d-pad lower-left,
   face diamond upper-right, right stick lower-centre) with each control
   carrying the chord it plays, so "which button is vii°?" is answered by
   looking at the picture instead of reading a table.

   Two rules keep it honest:
   - It never restates the bindings. Every cap label and caption comes from
     gamepad-perfecto's controlMap(), so re-binding a button (or swapping
     which stick picks degrees) redraws the legend for free. This file owns
     WHERE a control is drawn; the mapping owns WHAT it says.
   - HIGHLIGHT MEANS "this control selects the chord you're on" — not
     "this button is down". PerfState knows the degree, not which of the
     several controls that produce it you actually pressed, so every
     control mapped to the current degree lights, and the glow (reserved
     for sounding, as everywhere else in this view) says it's audible.
     The coloration stick is the one control drawn as a POSITION: its knob
     sits on the ring zone currently selected. That is where your thumb is
     while you hold a color — and where you last pushed it once the stick
     springs back, since the empty hub selects nothing.

   Pure markup in design space (BOX), scaled into whatever rect the caller
   gives it. Uses the host view's shared #glow filter — see svg.ts.
   ==================================================================== */
import { text, QUALITY_COLOR, GLOW_ATTR, ON_LIT } from "./svg";
import { BUTTON, controlMap, type ControlBinding } from "../gamepad-perfecto";
import {
  degreeQuality,
  DEGREE_NUMERAL,
  DIRECTION_VECTOR,
  type Degree,
  type JoystickDirection,
  type Key,
} from "../harmony/perfecto";

export interface LegendState {
  key: Key; // colors the numerals by degree quality, like the degree row
  degree: Degree; // the selected chord — every control that plays it lights
  direction: JoystickDirection; // live coloration-stick position
  sounding: boolean; // a chord is actually down (adds the glow)
}

// ---------- Design space ----------
// One fixed coordinate system for the drawing; render() scales it to fit.
// Below MIN_SCALE the sub-labels stop being readable, so the caller is told
// there's no room (fits()) and drops the legend rather than shrinking it.
export const BOX = { w: 460, h: 300 } as const;
const MIN_SCALE = 0.74;
const MAX_SCALE = 1.45; // past this it stops reading as an inset legend

const BODY = { x: 100, y: 66, w: 260, h: 126, r: 48 };
const GRIP = { w: 66, h: 112, y: 150, r: 31, tilt: 16 };
const LT_RECT = { x: 134, y: 16, w: 44, h: 22 };
const RT_RECT = { x: 282, y: 16, w: 44, h: 22 };
const LB_RECT = { x: 124, y: 44, w: 64, h: 18 };
const RB_RECT = { x: 272, y: 44, w: 64, h: 18 };
const LSTICK = { cx: 142, cy: 102 };
const RSTICK = { cx: 264, cy: 160 };
const STICK = { outer: 23, knob: 13, ring: 33, ticks: 30, throw: 8 };
const DPAD = { cx: 176, cy: 162, arm: 28, thick: 21 };
const FACE = { cx: 314, cy: 108, spread: 26, r: 15 };
// where each face button sits in the diamond, and the letter on its cap
const FACE_BUTTONS: ReadonlyArray<{ label: string; index: number; ux: number; uy: number }> = [
  { label: "Y", index: BUTTON.Y, ux: 0, uy: -1 },
  { label: "X", index: BUTTON.X, ux: -1, uy: 0 },
  { label: "B", index: BUTTON.B, ux: 1, uy: 0 },
  { label: "A", index: BUTTON.A, ux: 0, uy: 1 },
];
// the d-pad, arm by arm: the unit direction and which button index it is
const DPAD_ARMS: ReadonlyArray<{ index: number; ux: number; uy: number }> = [
  { index: BUTTON.dpadUp, ux: 0, uy: -1 },
  { index: BUTTON.dpadRight, ux: 1, uy: 0 },
  { index: BUTTON.dpadDown, ux: 0, uy: 1 },
  { index: BUTTON.dpadLeft, ux: -1, uy: 0 },
];

// ---------- Small drawing helpers ----------
interface Skin { fill: string; stroke: string; glow: string; ink: string }

// every control shares one two-state skin: resting, or lit (+ glow while
// the chord is actually sounding).
const skin = (lit: boolean, sounding: boolean): Skin => ({
  fill: lit ? "var(--note-lit)" : "var(--bg)",
  stroke: lit ? "var(--note-lit)" : "var(--grid-oct)",
  glow: lit && sounding ? GLOW_ATTR : "",
  ink: lit ? ON_LIT : "var(--ink)",
});

const shell = { fill: "var(--panel)", stroke: "var(--grid-oct)", glow: "", ink: "var(--ink)" };

const rect = (
  x: number, y: number, w: number, h: number, r: number, s: Skin, transform = "",
): string =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${s.fill}" ` +
  `stroke="${s.stroke}" stroke-width="1"${transform ? ` transform="${transform}"` : ""}${s.glow}/>`;

const circle = (cx: number, cy: number, r: number, s: Skin): string =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${s.fill}" stroke="${s.stroke}" ` +
  `stroke-width="1"${s.glow}/>`;

// a caption block beside a control: bold physical name, dim meaning(s).
const caption = (
  x: number, y: number, anchor: "start" | "end", name: string, lines: string[],
): string => {
  let out = text(x, y, name, { size: 10.5, weight: 700, anchor, fill: "var(--ink)" });
  lines.forEach((l, i) =>
    out += text(x, y + 12 * (i + 1), l, { size: 9.5, weight: 500, anchor, fill: "var(--ink-dim)" }));
  return out;
};

// ---------- The drawing ----------
export const fits = (w: number, h: number): boolean =>
  Math.min(w / BOX.w, h / BOX.h) >= MIN_SCALE;

export function render(x: number, y: number, w: number, h: number, st: LegendState): string {
  const cm = controlMap();
  const numeralColor = (d: Degree): string => QUALITY_COLOR[degreeQuality(st.key, d)];
  // what a button does right now — undefined when nothing is bound to it
  const bound = (i: number): ControlBinding | undefined => cm.buttons[i];
  // HIGHLIGHT MEANS "this control selects the chord you're on": true for any
  // button bound to a degree action naming the current degree.
  const lit = (i: number): boolean => bound(i)?.degree === st.degree;
  // a cap label's color: dark on a lit control, else the degree's quality
  // color for a chord, else dim for a shaping action
  const capInk = (i: number): string =>
    lit(i) ? ON_LIT
      : bound(i)?.degree != null ? numeralColor(bound(i)!.degree!)
      : "var(--ink-dim)";
  // captions read the binding too, so an unbound control says so plainly
  const capLines = (i: number): string[] => [bound(i)?.caption ?? "unbound"];

  let g = "";

  // --- shell: grips, body, bumpers, triggers ------------------------
  const gripY = GRIP.y;
  g += rect(BODY.x + 8, gripY, GRIP.w, GRIP.h, GRIP.r, shell,
    `rotate(${GRIP.tilt} ${BODY.x + 41} 170)`);
  g += rect(BODY.x + BODY.w - GRIP.w - 8, gripY, GRIP.w, GRIP.h, GRIP.r, shell,
    `rotate(${-GRIP.tilt} ${BODY.x + BODY.w - 41} 170)`);
  g += rect(BODY.x, BODY.y, BODY.w, BODY.h, BODY.r, shell);

  // triggers and bumpers are all four just buttons now: each lights when the
  // chord it is bound to is the one selected.
  const shoulder = (
    r: { x: number; y: number; w: number; h: number }, i: number, name: string, dy: number,
  ): string => {
    const s = skin(lit(i), st.sounding);
    return rect(r.x, r.y, r.w, r.h, 9, s) +
      text(r.x + r.w / 2, r.y + dy, name, { size: 10, weight: 700, fill: s.ink });
  };
  g += shoulder(LB_RECT, BUTTON.LB, "LB", 13);
  g += shoulder(RB_RECT, BUTTON.RB, "RB", 13);
  g += shoulder(LT_RECT, BUTTON.LT, "LT", 15);
  g += shoulder(RT_RECT, BUTTON.RT, "RT", 15);

  // guide ring — no function, but the pad doesn't read as a 360 without it
  g += `<circle cx="230" cy="92" r="9" fill="none" stroke="var(--grid)" stroke-width="1.5"/>`;

  // --- d-pad --------------------------------------------------------
  const a = DPAD.arm;
  const t = DPAD.thick / 2;
  g += `<path d="M${DPAD.cx - t},${DPAD.cy - a} H${DPAD.cx + t} V${DPAD.cy - t} ` +
    `H${DPAD.cx + a} V${DPAD.cy + t} H${DPAD.cx + t} V${DPAD.cy + a} H${DPAD.cx - t} ` +
    `V${DPAD.cy + t} H${DPAD.cx - a} V${DPAD.cy - t} H${DPAD.cx - t} Z" ` +
    `fill="var(--bg)" stroke="var(--grid-oct)" stroke-width="1"/>`;
  for (const arm of DPAD_ARMS) {
    const on = lit(arm.index);
    if (on) {
      // light just the arm, leaving the hub — the plus outline stays whole
      const ax = DPAD.cx + arm.ux * (a + t) / 2;
      const ay = DPAD.cy + arm.uy * (a + t) / 2;
      const aw = arm.ux === 0 ? DPAD.thick : a - t;
      const ah = arm.uy === 0 ? DPAD.thick : a - t;
      g += rect(ax - aw / 2, ay - ah / 2, aw, ah, 3, skin(true, st.sounding));
    }
    // the arm's meaning, printed inside it — whatever it is bound to
    const label = bound(arm.index)?.label ?? "";
    if (!label) continue;
    // inset a touch further on the horizontal arms: the labels there are set
    // across the arm's short axis, and the type is monospace (wide)
    const lx = DPAD.cx + arm.ux * (a - 8.5);
    const ly = DPAD.cy + arm.uy * (a - 7) + (arm.uy === 0 ? 3.5 : arm.uy > 0 ? 0 : 4);
    g += text(lx, ly, label, {
      size: label.length > 2 ? 8 : 9.5,
      weight: 700,
      fill: capInk(arm.index),
    });
  }

  // --- face diamond -------------------------------------------------
  for (const b of FACE_BUTTONS) {
    const on = lit(b.index);
    const s = skin(on, st.sounding);
    const bx = FACE.cx + b.ux * FACE.spread;
    const by = FACE.cy + b.uy * FACE.spread;
    const label = bound(b.index)?.label ?? "";
    g += circle(bx, by, FACE.r, s);
    g += text(bx, by - 3, b.label,
      { size: 8.5, weight: 700, fill: on ? ON_LIT : "var(--ink-dim)" });
    if (label) {
      g += text(bx, by + 10, label,
        { size: label.length > 2 ? 8.5 : 11, weight: 800, fill: capInk(b.index) });
    }
  }

  // --- the two sticks ------------------------------------------------
  const stick = (side: "left" | "right"): string => {
    const c = side === "left" ? LSTICK : RSTICK;
    const isChord = cm.chordStick === side;
    const isColor = cm.colorStick === side;
    // only the coloration stick is drawn from live physical state
    const [vx, vy] = isColor ? DIRECTION_VECTOR[st.direction] : [0, 0];
    const tilted = isColor && st.direction !== "center";
    let o = circle(c.cx, c.cy, STICK.outer, skin(false, false));
    if (isColor) {
      for (const dir of Object.keys(DIRECTION_VECTOR) as JoystickDirection[]) {
        if (dir === "center") continue;
        const [tx, ty] = DIRECTION_VECTOR[dir];
        o += `<circle cx="${(c.cx + tx * STICK.ticks).toFixed(1)}" ` +
          `cy="${(c.cy + ty * STICK.ticks).toFixed(1)}" r="1.5" fill="var(--grid-oct)"/>`;
      }
    }
    o += circle(
      +(c.cx + vx * STICK.throw).toFixed(1),
      +(c.cy + vy * STICK.throw).toFixed(1),
      STICK.knob,
      skin(tilted, st.sounding),
    );
    if (!isChord) return o;
    // the chord stick's six live directions, printed where you push
    for (const [dir, d] of Object.entries(cm.stickDegrees) as [JoystickDirection, Degree][]) {
      const [rx, ry] = DIRECTION_VECTOR[dir];
      const on = d === st.degree;
      o += text(
        +(c.cx + rx * STICK.ring).toFixed(1),
        +(c.cy + ry * STICK.ring + 3.5).toFixed(1),
        DEGREE_NUMERAL[d],
        { size: 9.5, weight: 800, fill: on ? "var(--note-lit)" : numeralColor(d) },
      );
    }
    return o;
  };
  g += stick("left") + stick("right");

  // --- captions ------------------------------------------------------
  const stickLines = (side: "left" | "right"): string[] => {
    const lines: string[] = [];
    if (cm.chordStick === side) lines.push("chords ii–vii°");
    if (cm.colorStick === side) lines.push("coloration");
    // the stick is also a button: its click carries whatever is bound to it.
    // The cap label, not the caption — this line sits in the narrow outer
    // column, and a long one would run off the design box.
    lines.push("click: " + (bound(side === "left" ? BUTTON.L3 : BUTTON.R3)?.label ?? "—"));
    return lines;
  };
  g += caption(LT_RECT.x - 8, 26, "end", "LT", capLines(BUTTON.LT));
  g += caption(RT_RECT.x + RT_RECT.w + 8, 26, "start", "RT", capLines(BUTTON.RT));
  g += caption(LB_RECT.x - 8, 58, "end", "LB", capLines(BUTTON.LB));
  g += caption(RB_RECT.x + RB_RECT.w + 8, 58, "start", "RB", capLines(BUTTON.RB));
  g += caption(92, 96, "end", "L stick", stickLines("left"));
  g += caption(368, 150, "start", "R stick", stickLines("right"));
  g += text(0, 10, "Xbox 360 · chord map",
    { size: 10, weight: 600, anchor: "start", fill: "var(--ink-dim)" });

  // --- fit the design box into the caller's rect ----------------------
  const s = Math.min(w / BOX.w, h / BOX.h, MAX_SCALE);
  const tx = x + (w - BOX.w * s) / 2;
  const ty = y + (h - BOX.h * s) / 2;
  return `<g transform="translate(${tx.toFixed(1)},${ty.toFixed(1)}) scale(${s.toFixed(3)})">${g}</g>`;
}

export const GamepadLegend = { render, fits, BOX };
