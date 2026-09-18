/* ====================================================================
   STAFF_PIANO — the grand staff with the piano under it, in two flavors.
   Like Combo it owns no drawing logic: it stacks two renderers' markup()
   as clipped <g> layers in one svg (one coordinate system, no nested
   <svg>), so the view toggle stays a single reference swap.

   The staff is the PAGE — staff-bars.ts, the same engraved sheet music
   practice mode draws — not the scrolling noteheads of staff-std.ts. It
   opens to the bar the playhead is in, with the rest of the piece torn
   off at the margins, and turns as the music moves on. Its "now" is the
   step sounding at t (steps.ts `stepSounding`): those notes light gold
   and a rule marks their column, exactly as the practice cursor lights
   its step, so the two views read one page one way.

   - keysView: page above, a keyboard-height band below. The keys light
     in time with the page (both answer "what sounds at t") but nothing
     falls — the notation view with the physical keys as a read-out.
   - rollView: page above, the full falling-notes roll below — a note
     lights on the page exactly as its bar reaches the keyboard's strike
     line.

   Both bands are the pointer-playable keyboard; the keyboardRegion of
   each locates it for main.ts's hit-testing, computed from the same
   layout the renderers use so the two can never drift.

   It defines the glow filter both layers use and passes them its id, so
   "a #glow must exist in this document" is a parameter rather than prose.
   ==================================================================== */
import { StaffBars } from "./staff-bars";
import { PianoRoll, KEYB } from "./piano-roll";
import { glowFilter } from "./defs";
import { Core } from "../core";
import { makeSteps, stepSounding, type Step } from "../steps";
import type { Score } from "../types";
import type { View, ViewModule, Region } from "../view";

// band heights (pure, exported for tests). Keys: exactly the keyboard.
// Roll: enough fall room to read approaching notes, capped so the staff
// keeps the lion's share; both yield to very short viewports.
export const keysBandH = (H: number): number => Math.min(KEYB, Math.round(H * 0.5));
export const rollBandH = (H: number): number =>
  Math.min(Math.max(KEYB + 40, Math.round(H * 0.4)), 280, Math.round(H * 0.5));

// This view owns the filter, so it owns the id — and could give the two
// bands different radii, which one hardcoded document-global id forbade.
const GLOW_ID = "spGlow";

// the "color hands" toggle — a view-local setting owned here (like the
// gamepad state singletons), read fresh each frame so flipping it takes
// effect immediately. It hues the keyboard and the falling notes by
// note.hand; the page wears its own hand tokens, as it does in practice.
let hands = false;
export const setHands = (on: boolean): void => {
  hands = on;
};

// the score cut into steps, all hands: watching a score is not practising
// one hand of it. A cache per score, never a source of truth.
const stepsOf = new WeakMap<Score, readonly Step[]>();
const stepsFor = (score: Score): readonly Step[] => {
  let s = stepsOf.get(score);
  if (!s) stepsOf.set(score, (s = makeSteps(score, "both").steps));
  return s;
};

/** The page at `t`, in a W×H region (origin at 0,0; no <defs>): open to
 *  the bar the playhead is in, lit where the score sounds. Exported so a
 *  test can draw it from a fabricated moment. */
export function page(W: number, H: number, score: Score, t: number, glowId: string): string {
  if (score.bars.length === 0) return "";
  const here = Core.barAt(score, t).index;
  return StaffBars.markup(W, H, score, {
    glowId,
    focus: { from: here, to: here },
    range: null,
    current: stepSounding(stepsFor(score), t),
    hand: "both",
    showOther: true,
  });
}

// one stacking routine, parameterized by the band's height and whether
// the falling-note field draws — the only difference between the flavors.
const stacked =
  (bandH: (H: number) => number, fall: boolean): View =>
  (svg, { score, t, live }) => {
    const W = svg.clientWidth;
    const H = svg.clientHeight;
    if (!W || !H) return;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const band = bandH(H);
    const topH = H - band;

    const defs =
      `<defs>${glowFilter(GLOW_ID)}` +
      `<clipPath id="spTop"><rect x="0" y="0" width="${W}" height="${topH}"/></clipPath>` +
      `<clipPath id="spBand"><rect x="0" y="0" width="${W}" height="${band}"/></clipPath>` +
      `</defs>`;
    const staff = `<g clip-path="url(#spTop)">${page(W, topH, score, t, GLOW_ID)}</g>`;
    const piano =
      `<g transform="translate(0,${topH})"><g clip-path="url(#spBand)">` +
      `${PianoRoll.markup(W, band, score, t, { glowId: GLOW_ID, held: live.held, fall, hands })}</g></g>`;
    svg.innerHTML = defs + staff + piano;
  };

// where the playable keyboard sits within the svg, for pointer hit-testing.
const region = (svg: SVGSVGElement, bandH: (H: number) => number): Region => {
  const W = svg.clientWidth;
  const H = svg.clientHeight;
  const band = bandH(H);
  return { x: 0, y: H - band, w: W, h: band };
};

// Each flavor is a ViewModule carrying its OWN region function, so the two
// can never be told apart by closure identity — the trap in the old dispatch,
// where `renderKeys` and `renderRoll` were distinguishable only because
// stacked(...) happened to be called twice.
export const keysView: ViewModule = {
  render: stacked(keysBandH, false),
  keyboardRegion: (svg) => region(svg, keysBandH),
};
export const rollView: ViewModule = {
  render: stacked(rollBandH, true),
  keyboardRegion: (svg) => region(svg, rollBandH),
};

export const StaffPiano = { keysView, rollView, setHands, page };
