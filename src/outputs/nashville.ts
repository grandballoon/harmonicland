/* ====================================================================
   NASHVILLE — the generative view. Same View signature as the staves and
   the Tonnetz, but like the Tonnetz it ignores `score`/`t`: it draws the
   live SELECTION from PerfState.snapshot() (key / degree / coloration, plus
   the `sounding` notes it has pressed). So the view toggle stays a single
   reference swap, and because triggering a chord also lights LiveKeys,
   switching to the Tonnetz shows the very same chord as a shape on the
   lattice — one model, two projections.

   Three regions, top to bottom:
   - the DEGREE ROW (I–vii°), each colored by its computed quality using the
     SAME convention as the Tonnetz (major = warm --note-lit, minor = cool
     --note, dim = --playhead tension); the held degree glows.
   - the COLORATION WHEEL: the current mode's 9 joystick zones laid out
     radially like the stick itself, the chosen direction lit.
   - the NOW-PLAYING readout: roman numeral, chord name, and the actual
     pitch-class spelling of the sounding (or previewed) voicing.

   Keeps the design language deliberately: dark field, one warm accent, the
   glow filter reused from the Tonnetz. No new colors invented.
   ==================================================================== */
import {
  degreeQuality,
  chordName,
  colorationDescriptor,
  PITCH_NAMES,
  degreeNumeral,
  DIRECTION_SYMBOL,
  ZONE_LABEL,
  SCALE_DISPLAY_NAMES,
  QUALITY_COLOR,
  type Degree,
  type JoystickDirection,
} from "../harmony/perfecto";
import { glowFilter, glowAttr, text } from "./defs";
import type { View, ViewModule } from "../view";
import type { PerfSnapshot } from "../perf-state";

const DEGREES: Degree[] = [1, 2, 3, 4, 5, 6, 7];
const MODES = ["default", "extended", "chromatic"] as const;

// the 8 compass directions as unit vectors (screen y-down); center is origin.
const DIR_VEC: Record<JoystickDirection, [number, number]> = {
  center: [0, 0],
  up: [0, -1], upRight: [0.707, -0.707], right: [1, 0], downRight: [0.707, 0.707],
  down: [0, 1], downLeft: [-0.707, 0.707], left: [-1, 0], upLeft: [-0.707, -0.707],
};

// quality -> token: perfecto's one map, not a local copy. The practice
// view's harmony bar colours its numerals from the same table.
const QCOLOR = QUALITY_COLOR;

const GLOW_ID = "nashvilleGlow";

const cell = (
  cx: number, cy: number, w: number, h: number,
  fill: string, stroke: string, lit: boolean,
): string =>
  `<rect x="${cx - w / 2}" y="${cy - h / 2}" width="${w}" height="${h}" rx="8" ` +
  `fill="${fill}" stroke="${stroke}" stroke-width="${lit ? 2 : 1}"` +
  `${glowAttr(GLOW_ID, lit)}/>`;

export const render: View = (svg, { live }) => {
  const W = svg.clientWidth;
  const H = svg.clientHeight;
  if (!W || !H) return;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.innerHTML = markup(W, H, live.perf);
};

// the whole view as a markup string — a pure function of the selection, so
// it can be rendered off-screen and snapshot-tested. It used to read
// PerfState.snapshot() itself, which is exactly what made that impossible.
export const markup = (W: number, H: number, s: PerfSnapshot): string => {
  if (!W || !H) return "";
  const sounding = s.sounding.length > 0;

  let out = `<defs>${glowFilter(GLOW_ID)}</defs>`;

  // --- header: key + mode strip ------------------------------------
  out += text(24, 30, `${PITCH_NAMES[s.key.root]} ${SCALE_DISPLAY_NAMES[s.key.scale]}`,
    { size: 15, weight: 700, anchor: "start" });
  const modeStrip = MODES.map((m) =>
    m === s.joystickMode ? m : `<tspan fill="var(--ink-dim)">${m}</tspan>`).join(
    '<tspan fill="var(--grid-oct)"> · </tspan>');
  out += `<text x="${W - 24}" y="30" text-anchor="end" font-size="12" ` +
    `font-weight="600" fill="var(--note-lit)">${modeStrip}</text>`;

  // --- degree row --------------------------------------------------
  const rowY = 78;
  const pad = 24;
  const slot = (W - pad * 2) / DEGREES.length;
  const dw = Math.min(slot - 10, 96);
  for (let i = 0; i < DEGREES.length; i++) {
    const d = DEGREES[i];
    const cx = pad + slot * (i + 0.5);
    const q = degreeQuality(s.key, d);
    const color = QCOLOR[q];
    const lit = d === s.degree;
    out += cell(cx, rowY, dw, 46, lit ? color : "var(--panel)", color, lit && sounding);
    out += text(cx, rowY + 5, degreeNumeral(s.key, d),
      { size: 18, weight: 700, fill: lit ? "#0b1020" : color });
  }

  // --- coloration wheel --------------------------------------------
  const cx = W / 2;
  const cy = rowY + 60 + (H - rowY - 60 - 70) / 2; // between degree row and readout
  const R = Math.max(60, Math.min(W * 0.3, (H - rowY - 60 - 90) * 0.42, 200));
  const zoneTable = ZONE_LABEL[s.joystickMode];

  // faint spokes from the hub so the wheel reads as a stick
  for (const dir of Object.keys(DIR_VEC) as JoystickDirection[]) {
    if (dir === "center") continue;
    const [vx, vy] = DIR_VEC[dir];
    out += `<line x1="${cx}" y1="${cy}" x2="${cx + vx * R}" y2="${cy + vy * R}" ` +
      `stroke="var(--grid)" stroke-width="1"/>`;
  }
  for (const dir of Object.keys(DIR_VEC) as JoystickDirection[]) {
    const [vx, vy] = DIR_VEC[dir];
    const zx = cx + vx * R;
    const zy = cy + vy * R;
    const lit = dir === s.joystickDirection;
    const w = dir === "center" ? 70 : 90;
    out += cell(zx, zy, w, 48, lit ? "var(--note-lit)" : "var(--panel)",
      lit ? "var(--note-lit)" : "var(--grid-oct)", lit && sounding);
    const ink = lit ? "#0b1020" : "var(--ink)";
    const inkDim = lit ? "#0b1020" : "var(--ink-dim)";
    out += text(zx, zy - 10, DIRECTION_SYMBOL[dir], { size: 13, weight: 700, fill: ink });
    out += text(zx, zy + 4, colorationDescriptor(s.joystickMode, dir),
      { size: 10, weight: 700, fill: ink });
    out += text(zx, zy + 17, zoneTable[dir], { size: 9, weight: 500, fill: inkDim });
  }

  // --- now-playing readout -----------------------------------------
  const name = chordName(s.key, s.degree, s.joystickMode, s.joystickDirection);
  const descriptor = colorationDescriptor(s.joystickMode, s.joystickDirection);
  // actual sounding notes, or the snapshot's root-position preview so the
  // readout is informative when silent. Both come off the snapshot: the view
  // asks PerfState no questions it has not already answered.
  const notes = sounding ? s.sounding : s.preview;
  const spelling = notes.map((p) => PITCH_NAMES[((p % 12) + 12) % 12]).join("  ");
  const ry = H - 40;
  out += text(24, ry, degreeNumeral(s.key, s.degree),
    { size: 26, weight: 800, anchor: "start", fill: QCOLOR[degreeQuality(s.key, s.degree)] });
  out += text(64, ry, name,
    { size: 22, weight: 700, anchor: "start", fill: sounding ? "var(--note-lit)" : "var(--ink-dim)" });
  // descriptor sits just below the chord name, dimmed when the direction is center/plain
  if (s.joystickDirection !== "center") {
    out += text(64, ry + 18, descriptor,
      { size: 11, weight: 600, anchor: "start", fill: sounding ? "var(--note-lit)" : "var(--ink-dim)" });
  }
  out += text(W - 24, ry, spelling,
    { size: 16, weight: 600, anchor: "end", fill: sounding ? "var(--ink)" : "var(--ink-dim)" });
  out += text(W - 24, ry - 22, `${s.inversion} · oct ${s.octave}${s.voiceLeading ? " · voice-led" : ""}`,
    { size: 11, weight: 500, anchor: "end", fill: "var(--ink-dim)" });

  return out;
};

// the Nashville view is a chord instrument driven by keys and the gamepad,
// not by pointing at a keyboard.
export const Nashville: ViewModule & { markup: typeof markup } = {
  render,
  keyboardRegion: () => null,
  markup,
};
