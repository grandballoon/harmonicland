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

   3. keyboardRegion takes the FRAME, not just the svg. A view's layout
      may legitimately depend on it — practice mode gives up a column to
      the harmony bar when, and only when, the lesson has a chart to put in
      it, and the isolated keyboard is as wide as the keys the selected
      bars of the score play — and a region function that could not see
      that would hand back a keyboard other than the one it drew.
      Silently: a hit-test disagreeing with the pixels by 200px produces no
      error, just wrong notes near the edge. Most views ignore the
      parameter, which is a statement that their geometry is a function of
      size alone.

   4. A view driven by the clock may name a TAPE: part of itself that a
      native scroller is laid over, standing for the playhead. Scrolling it
      moves the playhead, so the notes, the keys, the sound and the scrub
      bar keep one "now" between them. The view answers where the scroller
      stands for the frame it drew and where a scroller moved elsewhere
      puts the playhead; main.ts owns the DOM in between. Required, like
      keyboardRegion, and `() => null` where there is none. Practice mode
      scrolls without moving anything but the page (the learner, not the
      clock, is its transport), so it names a scroller instead (note 5).

   5. A view may also name a SCROLLER: part of itself a native scroller is
      laid over that moves only what the reader sees — the whole score's
      sheets, practice's strip of bars. The scroll position is live state
      like any other (`sheetScroll`, practice's `pan`) and reaches the
      view through the frame. The view answers what it is following — the
      learner's step, the playhead's bar — and where to scroll to bring it
      back into sight when it moves out of it, and which bar a point on it
      is over — so a click on the music can pick a bar, whatever picking
      means where it is clicked. Required, like `tape`, and a view names
      one or the other for a frame, never both.

   6. A keyboard need not be all 88 keys. The region a view hands back
      for its keyboard says which stretch of keys it holds (`span`), so a
      pointer on an enlarged octave is heard as the key drawn under it and
      not as the key that would be there on the whole keyboard.
   ==================================================================== */
import type { BarRange, Score, Pitch } from "./types";
import type { KeySpan } from "./pitch";
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
  /** Where the page has been panned away from resting on the playhead's
   *  bar, or null at rest. See `PagePan`. */
  pagePan: PagePan | null;
  /** How far down the whole score's sheets the reader has scrolled, in
   *  pixels — whichever view is showing them. See note 5. */
  sheetScroll: number;
  /** The one bar selection every view shares, or null for the whole piece.
   *  What the clock loops and a lesson is confined to; a view may also
   *  draw to it, as the isolated keyboard draws only the keys it plays. */
  selection: BarRange | null;
}

/** A page panned by its tape. At rest the page is fitted to the bar the
 *  playhead is in, and turns as the playhead moves on; panned, it stays
 *  fitted to the bar it was panned from — a page that refitted itself to
 *  every bar the playhead crossed would change its scale under the
 *  reader's finger — until the playhead leaves the window. */
export interface PagePan {
  /** The bar the page is fitted to. */
  bar: number;
  /** Pixels along the strip from resting on it, positive toward the end. */
  pan: number;
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

/** Where a playable keyboard sits, and which of its keys — note 6. */
export interface KeyboardRegion extends Region {
  /** The keys drawn edge to edge across the region; absent for all 88. */
  span?: KeySpan;
}

/** A native scroller over part of a view, standing for the playhead. See
 *  note 4. Positions are the scroller's own: scrollTop or scrollLeft. */
export interface Tape {
  /** The region of the svg the scroller covers. */
  region: Region;
  axis: "x" | "y";
  /** Everything that scrolls, along the axis, in pixels. */
  length: number;
  /** Where the scroller stands for the frame drawn. */
  pos: number;
  /** The page pan the frame was drawn at — which drops one the playhead
   *  has left behind, so main.ts keeps this rather than what it had. */
  pagePan: PagePan | null;
  /** The scroller was moved to `pos`: where the playhead goes, and the
   *  page pan that keeps the music where the reader put it. */
  seek(pos: number): { t: number; pagePan: PagePan | null };
}

/** A native scroller over part of a view, moving only what the reader
 *  sees. See note 5. Positions are the scroller's own; the view's offset
 *  is the position less `origin`. */
export interface Scroller {
  /** The region of the svg the scrolling music fills. */
  region: Region;
  /** Down the whole score's sheets (offset in `sheetScroll`), or across
   *  practice's strip (offset in its `pan`). */
  axis: "x" | "y";
  /** Everything that scrolls, along the axis, in pixels. */
  length: number;
  /** The position at which the view's offset is 0. */
  origin: number;
  /** What the scroller follows, or null for nothing: when it changes and
   *  is out of `sight`, the scroller goes `home`. Only when it CHANGES, so
   *  a reader who scrolls away to look ahead is left there. */
  follow: number | null;
  /** The positions at which what is followed is in sight, or null when
   *  there is nothing to follow. */
  sight: [number, number] | null;
  /** Where to scroll to bring what is followed back into sight. */
  home: number;
  /** Which bar a point in `region` is over, `x` and `y` measured from the
   *  region's top-left, at the offset the frame was drawn at — or null off
   *  every bar. */
  barAt(x: number, y: number): number | null;
  /** Which grip of the isolated range (outputs/range-marks.ts) a point is
   *  on, measured as `barAt` measures — or null when it is on none, or
   *  the view draws no range. */
  gripAt(x: number, y: number): "start" | "end" | null;
  /** The score time of the nearest place a range's end can sit to a
   *  point, measured as `barAt` measures — or null off the music. Where a
   *  grip dragged there would go, before loop.ts snaps it to a step. */
  timeAt(x: number, y: number): number | null;
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
   *  `f` is the SAME frame that was rendered, so the region can never
   *  describe a layout other than the one on screen. */
  keyboardRegion(svg: SVGSVGElement, f: Frame): KeyboardRegion | null;
  /** The part of this view a scroll moves the playhead through, or null
   *  if it has none — see note 4. Answered from the same frame that was
   *  rendered, so the scroller always lies over what is on screen. */
  tape(svg: SVGSVGElement, f: Frame): Tape | null;
  /** The part of this view a scroll moves only the reader's eye across,
   *  or null if it has none — see note 5. Null whenever `tape` is not. */
  scroller(svg: SVGSVGElement, f: Frame): Scroller | null;
}
