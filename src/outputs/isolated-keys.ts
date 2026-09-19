/* ====================================================================
   ISOLATED_KEYS — the keyboard alone, enlarged to the keys one run of bars
   plays. Entered from a saved section (sections-panel.ts), it is the one
   thing on the stage: no staff, no falling notes, no readout. What is left
   is the instrument, as big as the window lets it be, so a passage can be
   learned as a shape under the hands.

   The keys drawn are the keys the SELECTION plays — every note sounding
   in it, a note held into it from before included — and PAD white keys
   more either side, greyed out: there to show where the passage sits on
   the instrument, not part of it. A greyed key still lights when it is
   pressed or sounds, since hiding either would be a lie about the sound.

   It is otherwise an ordinary clock-driven view. The keys light from
   `activeAt(score, t)` as the piano roll's do, so Play, the loop, the
   scrub bar and ← → stepping all work unchanged — this view draws a
   moment and does not know which of them produced it.

   What it does know is which hand is being learned: practice mode's
   choice, read from the frame's practice snapshot, which carries it
   whether or not a lesson is running. Otherwise a run in one hand would
   be lost among the other hand's chords, all in the same gold. So the
   chosen hand lights gold and the other wears its dim hand colour — or
   stays dark, when "show other" is off — the same roles practice gives
   them. Hands together, each hand lights in its own colour, so the two
   parts stay apart. The keyboard is
   PianoRoll's own, handed a span (pitch.ts, KeySpan), so its geometry
   and its hit-test are the same code as everywhere else.
   ==================================================================== */
import { Core } from "../core";
import { PianoRoll, type KeyStyle } from "./piano-roll";
import { glowFilter } from "./defs";
import { FULL_SPAN, isWhite, spanOf, type KeySpan } from "../pitch";
import { inHand, type HandFilter } from "../steps";
import type { BarRange, Hand, Pitch, Score } from "../types";
import type { View, ViewModule, KeyboardRegion, Frame } from "../view";

const GLOW_ID = "isolatedGlow";

/** Greyed white keys either side of the ones the bars play. */
export const PAD = 3;

/** Clear space kept round the keyboard, so it never touches the window. */
const GUTTER = 24;

/** The keys a run of bars plays, and the stretch of keyboard shown for them. */
export interface Focus {
  /** The lowest and highest pitch sounding in the bars. */
  lo: Pitch;
  hi: Pitch;
  /** ...and the keys drawn: those, and PAD white keys more either side. */
  shown: KeySpan;
}

/** What the bars of `range` (null: the whole piece) play, or null when
 *  nothing sounds in them. */
export function focusOf(score: Score, range: BarRange | null): Focus | null {
  const { start, end } = Core.barTime(score, range);
  let lo = Infinity;
  let hi = -Infinity;
  for (const n of score.notes) {
    const sounds = n.onset < start ? n.onset + n.duration > start : n.onset < end;
    if (!sounds) continue;
    lo = Math.min(lo, n.pitch);
    hi = Math.max(hi, n.pitch);
  }
  return lo > hi ? null : { lo, hi, shown: spanOf(lo, hi, PAD) };
}

/** The keys shown for a frame: the selection's, or all 88 when it plays
 *  nothing — a keyboard with no keys on it is not a keyboard. */
const shownOf = (f: Focus | null): KeySpan => f?.shown ?? FULL_SPAN;

/** Where the keyboard sits on a W×H stage: across the whole width inside
 *  the gutters, as tall as PianoRoll stands keys that wide — or, when the
 *  stage is too short for that, narrowed until they fit, keeping their
 *  shape. Centred both ways. Null when the stage has no room at all. */
export function placement(W: number, H: number, span: KeySpan): KeyboardRegion | null {
  const availW = W - 2 * GUTTER;
  const availH = H - 2 * GUTTER;
  if (availW <= 0 || availH <= 0) return null;
  const tall = PianoRoll.geometry(availW, Infinity, span).keyH;
  const scale = Math.min(1, availH / tall);
  const w = availW * scale;
  const h = tall * scale;
  return { x: (W - w) / 2, y: (H - h) / 2, w, h, span };
}

/** How the hands are told apart: which is being learned, and whether the
 *  other is shown at all. Practice mode's settings (PracticeSnapshot). */
export interface Hands {
  hand: HandFilter;
  showOther: boolean;
}

/** A sounding key's colour for the hand playing it. Hands together, each
 *  hand its own hue; a note with no hand (a LilyPond score) is the gold
 *  every other keyboard lights in. */
const handHue = (h: Hand | undefined): string =>
  h === "upper" ? "var(--hand-r)" : h === "lower" ? "var(--hand-l)" : "var(--note-lit)";
const otherDim = (h: Hand | undefined): string =>
  h === "upper" ? "var(--hand-r-dim)" : h === "lower" ? "var(--hand-l-dim)" : "var(--note-dim)";

/** Every key this view colours itself, by role, lowest precedence first so
 *  a later write wins: the greyed pad, then the other hand, then the hand
 *  being learned. A key held live is left to PianoRoll, which lights it
 *  green — what you are pressing outranks what the score is doing. */
export function keyStyles(
  score: Score, t: number, held: ReadonlySet<Pitch>, f: Focus | null, { hand, showOther }: Hands,
): Map<Pitch, KeyStyle> {
  const out = new Map<Pitch, KeyStyle>();
  const pad = (p: Pitch): boolean => f !== null && (p < f.lo || p > f.hi);
  // a key at rest: its own colour, or greyed on the pad
  const rest = (p: Pitch): KeyStyle => ({
    fill: `var(--key-${pad(p) ? "mute-" : ""}${isWhite(p) ? "white" : "black"})`,
  });
  if (f) for (let p = f.shown.lo; p <= f.shown.hi; p++) if (pad(p)) out.set(p, rest(p));
  const sounding = Core.activeAt(score, t);
  for (const n of sounding)
    if (!inHand(n, hand)) out.set(n.pitch, showOther ? { fill: otherDim(n.hand) } : rest(n.pitch));
  for (const n of sounding)
    if (inHand(n, hand)) out.set(n.pitch, { fill: hand === "both" ? handHue(n.hand) : "var(--note-lit)", glow: true });
  for (const p of held) out.delete(p);
  return out;
}

/** The view as markup — a pure function of the stage's size and the frame. */
export function markup(W: number, H: number, { score, t, live }: Frame): string {
  const focus = focusOf(score, live.selection);
  const r = placement(W, H, shownOf(focus));
  if (!r) return "";
  return `<defs>${glowFilter(GLOW_ID)}</defs>` +
    `<g transform="translate(${r.x},${r.y})">` +
    PianoRoll.markup(r.w, r.h, score, t, {
      glowId: GLOW_ID, held: live.held, fall: false, span: r.span,
      keyStyles: keyStyles(score, t, live.held, focus, live.practice),
    }) +
    `</g>`;
}

export const render: View = (svg, f) => {
  const W = svg.clientWidth;
  const H = svg.clientHeight;
  if (!W || !H) return;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.innerHTML = markup(W, H, f);
};

/** The keys are played by pointing at them, as on every other keyboard;
 *  the region carries the span, so the hit-test reads the keys drawn. */
const keyboardRegion = (svg: SVGSVGElement, { score, live }: Frame): KeyboardRegion | null =>
  placement(svg.clientWidth, svg.clientHeight, shownOf(focusOf(score, live.selection)));

export const IsolatedKeys: ViewModule & {
  markup: typeof markup;
  keyStyles: typeof keyStyles;
  focusOf: typeof focusOf;
  placement: typeof placement;
} = { render, keyboardRegion, tape: () => null, scroller: () => null, markup, keyStyles, focusOf, placement };
