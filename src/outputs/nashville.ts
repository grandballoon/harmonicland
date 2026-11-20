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
     --minor, dim = --playhead tension); the held degree glows.
   - the COLORATION WHEEL: the current mode's 9 joystick zones laid out
     radially like the stick itself, the chosen direction lit. A pointer
     on the wheel turns it too (`dial`): the zone nearest it is the one
     chosen.
   - the NOW-PLAYING readout: roman numeral, chord name, and the actual
     pitch-class spelling of the sounding (or previewed) voicing.

   Beside the wheel, when the stage is wide enough to spare the room, sits
   the KEYBOARD LEGEND: what each computer-keyboard key does, printed from
   perfecto-keys.ts — the same tables the key handler acts on.

   Keeps the design language deliberately: one warm accent on the field
   (dark or paper, per the stage's tokens), the glow filter reused from the
   Tonnetz. No new colors invented.
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
import type { Dial, View, ViewModule } from "../view";
import type { PerfSnapshot } from "../perf-state";
import { KEY_LEGEND, type LegendBlock } from "../perfecto-keys";

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

const PAD = 24;
const ROW_Y = 78; // the degree row's centre line
// a wheel zone's cell; the hub's is narrower
const ZONE_W = 90;
const HUB_W = 70;
const ZONE_H = 48;

// the outer zones clockwise from `right`, an eighth of a turn apiece
// (screen y-down) — the order a pointer's angle about the hub counts them in
const RING: JoystickDirection[] =
  ["right", "downRight", "down", "downLeft", "left", "upLeft", "up", "upRight"];

/** Where the wheel sits on a W×H stage: its hub, and the radius its outer
 *  zones are centred at. The one answer `markup` draws and `dial` hit-tests. */
const wheel = (W: number, H: number): { cx: number; cy: number; R: number } => ({
  cx: W / 2,
  cy: ROW_Y + 60 + (H - ROW_Y - 60 - 70) / 2, // between degree row and readout
  R: Math.max(60, Math.min(W * 0.3, (H - ROW_Y - 60 - 90) * 0.42, 200)),
});

/** The wheel as a pointer finds it. The zone nearest a point: the hub's
 *  within half the radius, past that whichever outer zone the point's
 *  angle falls to. */
const dialAt = (W: number, H: number): Dial | null => {
  if (!W || !H) return null;
  const { cx, cy, R } = wheel(W, H);
  return {
    // out to the far edge of the left and right zones' cells
    holds: (x, y) => Math.hypot(x - cx, y - cy) <= R + ZONE_W / 2,
    directionAt: (x, y) => {
      const dx = x - cx;
      const dy = y - cy;
      if (Math.hypot(dx, dy) < R / 2) return "center";
      return RING[(Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8];
    },
  };
};

const cell = (
  cx: number, cy: number, w: number, h: number,
  fill: string, stroke: string, lit: boolean,
): string =>
  `<rect x="${cx - w / 2}" y="${cy - h / 2}" width="${w}" height="${h}" rx="8" ` +
  `fill="${fill}" stroke="${stroke}" stroke-width="${lit ? 2 : 1}"` +
  `${glowAttr(GLOW_ID, lit)}/>`;

// the legend's box: a key-cap column, then the hand-broken description
const LEGEND_W = 190;
const LEGEND_KEYS_W = 52;
const LEGEND_LINE = 16;
const LEGEND_GAP = 16; // clear air between the wheel's cells and the legend

// one legend block, its top-left at (x, cy - half its height) so it centres
// on the wheel's hub
const legend = (x: number, cy: number, block: LegendBlock): string => {
  const top = cy - (block.lines.length * LEGEND_LINE) / 2;
  let out = text(x, top, block.title,
    { size: 10, weight: 700, anchor: "start", fill: "var(--ink-dim)" });
  block.lines.forEach(({ keys, says }, i) => {
    const y = top + (i + 1) * LEGEND_LINE + 4;
    if (keys) out += text(x, y, keys, { size: 11, weight: 700, anchor: "start" });
    out += text(x + LEGEND_KEYS_W, y, says,
      { size: 11, weight: 500, anchor: "start", fill: "var(--ink-dim)" });
  });
  return out;
};

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
  const rowY = ROW_Y;
  const pad = PAD;
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
  const { cx, cy, R } = wheel(W, H);
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
    const w = dir === "center" ? HUB_W : ZONE_W;
    out += cell(zx, zy, w, ZONE_H, lit ? "var(--note-lit)" : "var(--panel)",
      lit ? "var(--note-lit)" : "var(--grid-oct)", lit && sounding);
    const ink = lit ? "#0b1020" : "var(--ink)";
    const inkDim = lit ? "#0b1020" : "var(--ink-dim)";
    out += text(zx, zy - 10, DIRECTION_SYMBOL[dir], { size: 13, weight: 700, fill: ink });
    out += text(zx, zy + 4, colorationDescriptor(s.joystickMode, dir),
      { size: 10, weight: 700, fill: ink });
    out += text(zx, zy + 17, zoneTable[dir], { size: 9, weight: 500, fill: inkDim });
  }

  // --- keyboard legend ---------------------------------------------
  // one block in the free field on each side of the wheel; a stage too
  // narrow to hold them clear of the wheel's cells goes without.
  const wheelEdge = R + ZONE_W / 2 + LEGEND_GAP; // hub -> past the left/right cells
  if (cx - wheelEdge - pad >= LEGEND_W) {
    out += legend(pad, cy, KEY_LEGEND[0]);
    out += legend(cx + wheelEdge, cy, KEY_LEGEND[1]);
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
// not by pointing at a keyboard — but its wheel a pointer can turn.
export const Nashville: ViewModule & { markup: typeof markup; dialAt: typeof dialAt } = {
  render,
  keyboardRegion: () => null,
  tape: () => null,
  scroller: () => null,
  dial: (svg) => dialAt(svg.clientWidth, svg.clientHeight),
  markup,
  dialAt,
};
