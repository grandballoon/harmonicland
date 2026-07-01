/* ====================================================================
   COMBO — two projections at once. The Tonnetz (pitch-class lattice)
   stacked above the Piano roll (the keyboard in its usual place at the
   bottom). It is itself a View — same (svg, score, t) signature — so the
   toggle stays a single reference swap, and it owns no drawing logic of
   its own: it asks each renderer for markup() at an exact size and drops
   the two into one svg as clipped <g> layers. A single coordinate system
   (no nested <svg>) means clipping is honest and pointer hit-testing maps
   cleanly — the roll just lives translated into the bottom band.
   ==================================================================== */
import { Tonnetz } from "./tonnetz";
import { PianoRoll, type Region } from "./piano-roll";
import type { View } from "../types";

// The piano roll keeps a fixed-height band at the bottom (its keyboard is
// ~96px plus some falling-note room); the Tonnetz takes ALL the height above
// it and tiles to fill, per its own logic. Fixed — so resizing the window
// grows the Tonnetz, never the roll — but capped on short viewports.
const ROLL_H = 120;

const layout = (W: number, H: number) => {
  const rollH = Math.min(ROLL_H, Math.round(H * 0.5));
  return { W, H, topH: H - rollH, rollH };
};

const GLOW = `<filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
    <feGaussianBlur stdDeviation="3" result="b"/>
    <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>`;

export const render: View = (svg, score, t) => {
  const W = svg.clientWidth;
  const H = svg.clientHeight;
  if (!W || !H) return;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const { topH, rollH } = layout(W, H);

  // one shared glow filter, plus a clip per band so neither layer's glow or
  // lattice spills across the seam.
  const defs =
    `<defs>${GLOW}` +
    `<clipPath id="comboTop"><rect x="0" y="0" width="${W}" height="${topH}"/></clipPath>` +
    `<clipPath id="comboRoll"><rect x="0" y="0" width="${W}" height="${rollH}"/></clipPath>` +
    `</defs>`;

  const top = `<g clip-path="url(#comboTop)">${Tonnetz.markup(W, topH, score, t)}</g>`;
  // the roll draws in its own 0..rollH space, then we translate it down; the
  // clip (no transform of its own) rides the same translated coordinates.
  const roll =
    `<g transform="translate(0,${topH})"><g clip-path="url(#comboRoll)">` +
    `${PianoRoll.markup(W, rollH, score, t)}</g></g>`;

  svg.innerHTML = defs + top + roll;
};

// where the roll's keyboard sits within the svg, for pointer hit-testing.
export const rollRegion = (svg: SVGSVGElement): Region => {
  const { W, topH, rollH } = layout(svg.clientWidth, svg.clientHeight);
  return { x: 0, y: topH, w: W, h: rollH };
};

export const Combo = { render, rollRegion };
