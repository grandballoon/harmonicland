/* ====================================================================
   COMBO — two projections at once: some upper panel stacked above the
   Piano roll (the keyboard in its usual place at the bottom). `stack()`
   is the whole module: give it a top panel's markup function and it
   returns a `View` — same (svg, score, t) signature — so the toggle stays
   a single reference swap. It owns no drawing logic of its own: it asks
   each renderer for markup() at an exact size and drops the two into one
   svg as clipped <g> layers. A single coordinate system (no nested <svg>)
   means clipping is honest and pointer hit-testing maps cleanly — the roll
   just lives translated into the bottom band.

   Two instances today: the Tonnetz lattice above the roll, and the
   Nashville chord-coloration panel above the roll. Neither top panel
   learned anything about the other layer.
   ==================================================================== */
import { Tonnetz } from "./tonnetz";
import { Nashville } from "./nashville";
import { PianoRoll, type Region } from "./piano-roll";
import { GLOW_DEFS } from "./svg";
import type { Score, View } from "../types";

// The piano roll keeps a fixed-height band at the bottom (its keyboard is
// ~96px plus some falling-note room); the top panel takes ALL the height above
// it and tiles to fill, per its own logic. Fixed — so resizing the window
// grows the top panel, never the roll — but capped on short viewports.
const ROLL_H = 120;

const layout = (W: number, H: number) => {
  const rollH = Math.min(ROLL_H, Math.round(H * 0.5));
  return { W, H, topH: H - rollH, rollH };
};

/** The upper half of a stack: markup for a W×H region with its origin at
 *  (0,0), no <defs> — exactly what `Tonnetz.markup` and `Nashville.markup`
 *  already produce for their own full-screen views. */
type TopMarkup = (W: number, H: number, score: Score, t: number) => string;

const stack = (top: TopMarkup): { render: View; rollRegion: (svg: SVGSVGElement) => Region } => {
  const render: View = (svg, score, t) => {
    const W = svg.clientWidth;
    const H = svg.clientHeight;
    if (!W || !H) return;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const { topH, rollH } = layout(W, H);

    // one shared glow filter, plus a clip per band so neither layer's glow or
    // lattice spills across the seam.
    const defs =
      GLOW_DEFS +
      `<defs>` +
      `<clipPath id="comboTop"><rect x="0" y="0" width="${W}" height="${topH}"/></clipPath>` +
      `<clipPath id="comboRoll"><rect x="0" y="0" width="${W}" height="${rollH}"/></clipPath>` +
      `</defs>`;

    const upper = `<g clip-path="url(#comboTop)">${top(W, topH, score, t)}</g>`;
    // the roll draws in its own 0..rollH space, then we translate it down; the
    // clip (no transform of its own) rides the same translated coordinates.
    const roll =
      `<g transform="translate(0,${topH})"><g clip-path="url(#comboRoll)">` +
      `${PianoRoll.markup(W, rollH, score, t)}</g></g>`;

    svg.innerHTML = defs + upper + roll;
  };

  // where the roll's keyboard sits within the svg, for pointer hit-testing.
  const rollRegion = (svg: SVGSVGElement): Region => {
    const { W, topH, rollH } = layout(svg.clientWidth, svg.clientHeight);
    return { x: 0, y: topH, w: W, h: rollH };
  };

  return { render, rollRegion };
};

/** Tonnetz lattice above the falling-notes keyboard. */
export const Combo = stack(Tonnetz.markup);

/** Nashville chord coloration above the falling-notes keyboard: the chord
 *  you select and the keys it sounds, in one frame. */
export const NashvilleRoll = stack((W, H) => Nashville.markup(W, H));
