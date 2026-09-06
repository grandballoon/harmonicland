/* ====================================================================
   NASHVILLE — the generative view. Same View signature as the staves and
   the Tonnetz, but like the Tonnetz it ignores `score`/`t`: it draws the
   live SELECTION from PerfState.snapshot() (key / degree / coloration, plus
   the `sounding` notes it has pressed). So the view toggle stays a single
   reference swap, and because triggering a chord also lights LiveKeys,
   switching to the Tonnetz shows the very same chord as a shape on the
   lattice — one model, two projections.

   Four regions:
   - the DEGREE ROW (I–vii°), each colored by its computed quality using the
     SAME convention as the Tonnetz (major = warm --note-lit, minor = cool
     --note, dim = --playhead tension); the held degree glows.
   - the CONTROLLER LEGEND (left of the wheel, whenever there's room): a
     schematic Xbox 360 pad labelled straight from the gamepad mapping, so
     you can see which button plays which number. See gamepad-legend.ts.
   - the COLORATION WHEEL: the current mode's 8 joystick zones laid out
     radially like the stick itself, the chosen direction lit. Base is one of
     them, at the bottom; the hub is drawn empty because the stick selects
     nothing there — it is the free crossing between colors.
   - the NOW-PLAYING readout: roman numeral, chord name, and the actual
     pitch-class spelling of the sounding (or previewed) voicing.

   Keeps the design language deliberately: dark field, one warm accent, the
   glow filter reused from the Tonnetz. No new colors invented.
   ==================================================================== */
import { PerfState, DEFAULT_OCTAVE } from "../perf-state";
import { text, GLOW_DEFS, GLOW_ATTR, QUALITY_COLOR as QCOLOR, ON_LIT } from "./svg";
import { GamepadLegend } from "./gamepad-legend";
import {
  computeVoicing,
  degreeQuality,
  chordName,
  colorationDescriptor,
  isPlainDirection,
  PITCH_NAMES,
  DEGREE_NUMERAL,
  DIRECTION_SYMBOL,
  DIRECTION_VECTOR,
  ZONE_LABEL,
  SCALE_DISPLAY_NAMES,
  type Degree,
  type JoystickDirection,
} from "../harmony/perfecto";
import type { View } from "../types";

const DEGREES: Degree[] = [1, 2, 3, 4, 5, 6, 7];
const MODES = ["default", "extended", "chromatic"] as const;

const cell = (
  cx: number, cy: number, w: number, h: number,
  fill: string, stroke: string, lit: boolean,
): string =>
  `<rect x="${cx - w / 2}" y="${cy - h / 2}" width="${w}" height="${h}" rx="8" ` +
  `fill="${fill}" stroke="${stroke}" stroke-width="${lit ? 2 : 1}"` +
  `${lit ? GLOW_ATTR : ""}/>`;

// the full-screen view measures the svg itself; the stacked view asks for
// markup() at an exact W×H so it can place this panel above the piano roll in
// one svg. No <defs> here — the caller supplies the shared glow filter.
export const render: View = (svg) => {
  const W = svg.clientWidth;
  const H = svg.clientHeight;
  if (!W || !H) return;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.innerHTML = GLOW_DEFS + markup(W, H);
};

export const markup = (W: number, H: number): string => {
  if (!W || !H) return "";

  const s = PerfState.snapshot();
  const sounding = s.sounding.length > 0;

  let out = "";

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
    out += text(cx, rowY + 5, DEGREE_NUMERAL[d],
      { size: 18, weight: 700, fill: lit ? ON_LIT : color });
  }

  // --- body: controller legend (left) + coloration wheel ------------
  // The band between the degree row and the readout. The legend takes a
  // left column only when it can be drawn at a readable size; otherwise the
  // wheel keeps the whole band, exactly as before.
  const bodyY = rowY + 60;
  const bodyH = H - 70 - bodyY;
  const legendW = Math.min(W * 0.46, 640) - 24;
  const showLegend = GamepadLegend.fits(legendW, bodyH);
  if (showLegend) {
    out += GamepadLegend.render(12, bodyY, legendW, bodyH, {
      key: s.key,
      degree: s.degree,
      direction: s.joystickDirection,
      sounding,
    });
  }

  const wheelX = showLegend ? legendW + 24 : 0;
  const wheelW = W - wheelX;
  const cx = wheelX + wheelW / 2;
  const cy = bodyY + bodyH / 2;
  const R = Math.max(60, Math.min(wheelW * 0.3, (bodyH - 20) * 0.42, 200));
  const zoneTable = ZONE_LABEL[s.joystickMode];

  // faint spokes from the hub so the wheel reads as a stick
  for (const dir of Object.keys(DIRECTION_VECTOR) as JoystickDirection[]) {
    if (dir === "center") continue;
    const [vx, vy] = DIRECTION_VECTOR[dir];
    out += `<line x1="${cx}" y1="${cy}" x2="${cx + vx * R}" y2="${cy + vy * R}" ` +
      `stroke="var(--grid)" stroke-width="1"/>`;
  }
  // the hub is EMPTY — Base sits at the bottom of the ring instead, so the
  // stick can cross the middle from any color to any other without landing on
  // anything. Drawn as a bare well where the spokes meet.
  out += `<circle cx="${cx}" cy="${cy}" r="16" fill="var(--bg)" ` +
    `stroke="var(--grid)" stroke-width="1"/>`;

  for (const dir of Object.keys(DIRECTION_VECTOR) as JoystickDirection[]) {
    if (dir === "center") continue;
    const [vx, vy] = DIRECTION_VECTOR[dir];
    const zx = cx + vx * R;
    const zy = cy + vy * R;
    const lit = dir === s.joystickDirection;
    out += cell(zx, zy, 90, 48, lit ? "var(--note-lit)" : "var(--panel)",
      lit ? "var(--note-lit)" : "var(--grid-oct)", lit && sounding);
    const ink = lit ? ON_LIT : "var(--ink)";
    const inkDim = lit ? ON_LIT : "var(--ink-dim)";
    out += text(zx, zy - 10, DIRECTION_SYMBOL[dir], { size: 13, weight: 700, fill: ink });
    out += text(zx, zy + 4, colorationDescriptor(s.joystickMode, dir),
      { size: 10, weight: 700, fill: ink });
    out += text(zx, zy + 17, zoneTable[dir], { size: 9, weight: 500, fill: inkDim });
  }

  // --- now-playing readout -----------------------------------------
  const name = chordName(s.key, s.degree, s.joystickMode, s.joystickDirection);
  const descriptor = colorationDescriptor(s.joystickMode, s.joystickDirection);
  // actual sounding notes, or a root-position preview so it's informative when silent
  const notes = sounding
    ? s.sounding
    : computeVoicing({ ...s, voiceLeading: false, previousVoicing: null }).notes;
  const spelling = notes.map((p) => PITCH_NAMES[((p % 12) + 12) % 12]).join("  ");
  const ry = H - 40;
  out += text(24, ry, DEGREE_NUMERAL[s.degree],
    { size: 26, weight: 800, anchor: "start", fill: QCOLOR[degreeQuality(s.key, s.degree)] });
  out += text(64, ry, name,
    { size: 22, weight: 700, anchor: "start", fill: sounding ? "var(--note-lit)" : "var(--ink-dim)" });
  // descriptor sits just below the chord name; the plain directions (Base and
  // the neutral hub) have no color to name, so nothing is printed there
  if (!isPlainDirection(s.joystickDirection)) {
    out += text(64, ry + 18, descriptor,
      { size: 11, weight: 600, anchor: "start", fill: sounding ? "var(--note-lit)" : "var(--ink-dim)" });
  }
  out += text(W - 24, ry, spelling,
    { size: 16, weight: 600, anchor: "end", fill: sounding ? "var(--ink)" : "var(--ink-dim)" });
  // Shaping line. The octave is the only selection that accumulates, and a
  // transposed instrument sounds like a bug rather than a setting — so once it
  // leaves home it stops whispering in dim grey and says so in the accent.
  const transposed = s.octave !== DEFAULT_OCTAVE;
  out += text(W - 24, ry - 22, `${s.inversion} · oct ${s.octave}${s.voiceLeading ? " · voice-led" : ""}`,
    { size: 11, weight: transposed ? 700 : 500, anchor: "end",
      fill: transposed ? "var(--note-lit)" : "var(--ink-dim)" });

  return out;
};

export const Nashville = { render, markup };
