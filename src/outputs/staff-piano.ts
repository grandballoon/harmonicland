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

   The page is also the TAPE (view.ts, note 4): a native scroller lies
   over it, and panning the page moves the playhead with it, the music
   sliding under a playhead that stays where it was on screen. So the
   falling notes, the lit keys and the sound travel through the score in
   step with the page. Panned, the page keeps the scale of the bar it was
   panned from rather than refitting to every bar the playhead crosses
   (`PagePan`); it comes back to rest on the playhead's bar once the
   playhead leaves its window — played on past it, or sent elsewhere by
   the scrub bar or the arrows.

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
import type { View, ViewModule, Region, Frame, PagePan, Tape } from "../view";

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

/** Where the page stands at `t`: held where its tape left it while the
 *  playhead is still in its window, else null — at rest on the playhead's
 *  bar. Pure, so the page drawn and the tape laid over it agree. */
export function standAt(W: number, score: Score, t: number, held: PagePan | null): PagePan | null {
  if (!held || held.bar >= score.bars.length) return null;
  const { xOf, view } = StaffBars.timeline(W, score, { from: held.bar, to: held.bar }, "both", true);
  const x = xOf(t) - held.pan;
  return x >= view[0] - 0.5 && x <= view[1] + 0.5 ? held : null;
}

/** The page at `t`, in a W×H region (origin at 0,0; no <defs>): open to
 *  the bar the playhead is in, or panned where its tape holds it, lit
 *  where the score sounds. Exported so a test can draw it from a
 *  fabricated moment. */
export function page(
  W: number, H: number, score: Score, t: number, glowId: string, held: PagePan | null = null,
): string {
  if (score.bars.length === 0) return "";
  const at = standAt(W, score, t, held);
  const bar = at ? at.bar : Core.barAt(score, t).index;
  return StaffBars.markup(W, H, score, {
    glowId,
    focus: { from: bar, to: bar },
    range: null,
    current: stepSounding(stepsFor(score), t),
    hand: "both",
    showOther: true,
    pan: at?.pan ?? 0,
  });
}

/** The page as a tape over a W-wide region: its scroller runs along the
 *  strip, and a pan of it moves the playhead by the time that slid under
 *  where the playhead was drawn. */
export function pageTape(W: number, H: number, score: Score, t: number, held: PagePan | null): Tape | null {
  if (!W || !H || score.bars.length === 0 || score.duration <= 0) return null;
  const at = standAt(W, score, t, held);
  const bar = at ? at.bar : Core.barAt(score, t).index;
  const pan = at?.pan ?? 0;
  const focus = { from: bar, to: bar };
  const { range } = StaffBars.panSpan(W, score, focus, "both", true);
  const { xOf, timeAt } = StaffBars.timeline(W, score, focus, "both", true);
  // whole pixels, so the rest lands on a position a scroller can hold
  const origin = Math.max(0, -Math.floor(range[0]));
  return {
    region: { x: 0, y: 0, w: W, h: H },
    axis: "x",
    length: W + origin + Math.ceil(range[1]),
    pos: origin + pan,
    pagePan: at,
    seek: (pos) => {
      const next = Math.max(range[0], Math.min(range[1], pos - origin));
      const to = timeAt(xOf(t) + next - pan);
      return { t: Math.max(0, Math.min(score.duration, to)), pagePan: { bar, pan: next } };
    },
  };
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
    const staff = `<g clip-path="url(#spTop)">${page(W, topH, score, t, GLOW_ID, live.pagePan)}</g>`;
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

// the tape is the page, above the band, in both flavors
const tape = (bandH: (H: number) => number) =>
  (svg: SVGSVGElement, { score, t, live }: Frame): Tape | null => {
    const H = svg.clientHeight;
    return pageTape(svg.clientWidth, H - bandH(H), score, t, live.pagePan);
  };

// Each flavor is a ViewModule carrying its OWN region function, so the two
// can never be told apart by closure identity — the trap in the old dispatch,
// where `renderKeys` and `renderRoll` were distinguishable only because
// stacked(...) happened to be called twice.
export const keysView: ViewModule = {
  render: stacked(keysBandH, false),
  keyboardRegion: (svg) => region(svg, keysBandH),
  tape: tape(keysBandH),
};
export const rollView: ViewModule = {
  render: stacked(rollBandH, true),
  keyboardRegion: (svg) => region(svg, rollBandH),
  tape: tape(rollBandH),
};

export const StaffPiano = { keysView, rollView, setHands, page, pageTape, standAt };
