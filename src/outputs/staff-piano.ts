/* ====================================================================
   STAFF_PIANO — the grand staff with the piano under it, in two flavors.
   Like Combo it owns no drawing logic: it stacks two renderers' markup()
   as clipped <g> layers in one svg (one coordinate system, no nested
   <svg>), so the view toggle stays a single reference swap.

   - renderKeys: staff above, a keyboard-height band below. The keys
     light in time with the staff's playhead (same activeAt query) but
     nothing falls — the notation view with the physical keys as a
     read-out.
   - renderRoll: staff above, the full falling-notes roll below — both
     projections of the same moment: a note crosses the staff playhead
     exactly as its bar reaches the keyboard's strike line.

   Both bands are the pointer-playable keyboard; keysRegion/rollRegion
   locate it for main.ts's hit-testing, computed from the same layout
   the renderers use so the two can never drift.
   ==================================================================== */
import { StaffStd } from "./staff-std";
import { PianoRoll, KEYB, type Region } from "./piano-roll";
import type { View } from "../types";

// band heights (pure, exported for tests). Keys: exactly the keyboard.
// Roll: enough fall room to read approaching notes, capped so the staff
// keeps the lion's share; both yield to very short viewports.
export const keysBandH = (H: number): number => Math.min(KEYB, Math.round(H * 0.5));
export const rollBandH = (H: number): number =>
  Math.min(Math.max(KEYB + 40, Math.round(H * 0.4)), 280, Math.round(H * 0.5));

const GLOW = `<filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
    <feGaussianBlur stdDeviation="3" result="b"/>
    <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>`;

// the "color hands" toggle — a view-local setting owned here (like the
// gamepad state singletons), read fresh each frame so flipping it takes
// effect immediately. Colors by note.staff; scores without staff data
// (e.g. LilyPond) render unchanged with the toggle on.
let hands = false;
export const setHands = (on: boolean): void => {
  hands = on;
};

// one stacking routine, parameterized by the band's height and whether
// the falling-note field draws — the only difference between the flavors.
const stacked =
  (bandH: (H: number) => number, fall: boolean): View =>
  (svg, score, t) => {
    const W = svg.clientWidth;
    const H = svg.clientHeight;
    if (!W || !H) return;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const band = bandH(H);
    const topH = H - band;

    const defs =
      `<defs>${GLOW}` +
      `<clipPath id="spTop"><rect x="0" y="0" width="${W}" height="${topH}"/></clipPath>` +
      `<clipPath id="spBand"><rect x="0" y="0" width="${W}" height="${band}"/></clipPath>` +
      `</defs>`;
    const staff = `<g clip-path="url(#spTop)">${StaffStd.markup(W, topH, score, t, hands)}</g>`;
    const piano =
      `<g transform="translate(0,${topH})"><g clip-path="url(#spBand)">` +
      `${PianoRoll.markup(W, band, score, t, fall, hands)}</g></g>`;
    svg.innerHTML = defs + staff + piano;
  };

export const renderKeys: View = stacked(keysBandH, false);
export const renderRoll: View = stacked(rollBandH, true);

// where the playable keyboard sits within the svg, for pointer hit-testing.
const region = (svg: SVGSVGElement, bandH: (H: number) => number): Region => {
  const W = svg.clientWidth;
  const H = svg.clientHeight;
  const band = bandH(H);
  return { x: 0, y: H - band, w: W, h: band };
};
export const keysRegion = (svg: SVGSVGElement): Region => region(svg, keysBandH);
export const rollRegion = (svg: SVGSVGElement): Region => region(svg, rollBandH);

export const StaffPiano = { renderKeys, renderRoll, keysRegion, rollRegion, setHands };
