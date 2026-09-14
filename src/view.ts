/* ====================================================================
   VIEW — the output contract, expressed once. Pure declarations, zero
   runtime, and the counterpart to types.ts: where types.ts is the MODEL
   contract (what a score is), this is the PROJECTION contract (what it
   takes to draw one, and what a drawable thing must be able to answer).

   Why it is not in types.ts: a Frame carries the live performance state,
   whose shape is spelled in the harmony vocabulary (Key, Degree, Cursor,
   …). Pulling all of that into types.ts to preserve its "imports nothing"
   property would trade one honest boundary for a bigger muddle, so the two
   contracts live apart and types.ts stays exactly what its header claims.
   Every import here is type-only, so nothing of this survives compilation.

   The two things this fixes:

   1. A View used to be typed `(svg, score, t) => void` and described as a
      pure function of that, but five of the eight read module-level mutable
      globals — LiveKeys, PerfState, TonnetzState — so the real signature
      was `svg -> score -> t -> LiveState -> unit` with LiveState passed
      invisibly. You could not snapshot-test a view, render two scores side
      by side, or render off-screen. Frame makes that parameter a value:
      main.ts assembles ONE LiveSnapshot per frame and hands the same one to
      every consumer, which also removes the hazard of two views observing
      different live state within a single frame.

   2. Pointer input used to be dispatched by comparing `view` for reference
      identity against specific module exports, plus a companion region
      function neither the type nor the compiler knew about — so a ninth
      view silently had no keyboard, and wrapping any view in a decorator
      silently broke hit-testing. ViewModule makes keyboardRegion a REQUIRED
      member: a new view cannot compile without answering the question.

   3. keyboardRegion takes the FRAME'S live state, not just the svg. A
      view's layout may legitimately depend on it — practice mode gives up
      a column to the harmony bar when, and only when, the lesson has a
      chart to put in it — and a region function that could not see that
      would hand back a keyboard wider than the one it drew. Silently: a
      hit-test disagreeing with the pixels by 200px produces no error, just
      wrong notes near the edge. Most views ignore the parameter, which is
      a statement that their geometry is a function of size alone.
   ==================================================================== */
import type { Score, Pitch } from "./types";
import type { PerfSnapshot } from "./perf-state";
import type { TonnetzSnapshot } from "./tonnetz-state";
import type { PracticeSnapshot } from "./practice-state";

/** Everything live about this instant that is not the score or the clock,
 *  read once per frame so every view sees the same instant. */
export interface LiveSnapshot {
  /** Pitches sounding from any live surface — keyboard, MIDI, gamepad, chord. */
  held: ReadonlySet<Pitch>;
  perf: PerfSnapshot;
  tonnetz: TonnetzSnapshot;
  /** Where the learner is in a step-by-step lesson. Inert (`active:
   *  false`) unless practice mode is running, the same way `perf` is inert
   *  unless a chord is being played. */
  practice: PracticeSnapshot;
}

/** The one moment a view draws. */
export interface Frame {
  score: Score;
  t: number;
  live: LiveSnapshot;
}

/** A rectangle in an svg's local pixel space. */
export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** An output projection. Genuinely a function of its arguments now. */
export type View = (svg: SVGSVGElement, f: Frame) => void;

/** A view plus the facts about it that main.ts needs and the render
 *  function cannot carry. Stated once, here, instead of restated in a
 *  dispatch chain kept in sync by hand. */
export interface ViewModule {
  render: View;
  /** Where a pointer-playable keyboard sits in this view, or null if it has
   *  none. Required, not optional-with-a-default: the point is that a new
   *  view must answer the question rather than be forgotten. Views with no
   *  keyboard write `() => null`, which is a declaration, not an omission.
   *
   *  `live` is the SAME snapshot the frame was rendered from, so the
   *  region can never describe a layout other than the one on screen. */
  keyboardRegion(svg: SVGSVGElement, live: LiveSnapshot): Region | null;
}
