/* ====================================================================
   PRACTICE — the step-by-step view. The one projection here that is not
   a picture of the score: it is a picture of ONE MOMENT of it, plus the
   move to the next one, and nothing else. No falling notes, no playhead
   sweeping the page. What you see is what your hands should be doing.

   Four bands, bottom-up:

   - the KEYBOARD, borrowed whole from PianoRoll with `fall` off. Every
     key it lights comes from `keyStyles`, so the colours answer "what
     does this step ask of this key" rather than "is a note sounding at
     t" — which is the one question a time-based view cannot ask. No key
     ever carries two roles.

     Roles that differ in KIND differ in kind, not in shade. The hue says
     which VERB the key is under and the treatment says where you are in
     it:

       gold  = STRIKE.  Owed is a steady glowing fill; a key you have just
               struck correctly flares and falls away in the same gold. One
               verb, one colour, and "did I get it" carried by MOTION
               rather than a second hue — a correct note used to turn a
               dull green, which read as demotion at the exact moment the
               learner got it right. The flare is also the only way that
               moment is visible at all: a step completes on the press that
               satisfies it, so a frame later the key already belongs to
               the next step (see PracticeSnapshot.hit).
       green = HOLD.    Filled while you are holding it, a hollow OUTLINE
               when you should be and are not.
       red   = WRONG.   One meaning only, because a colour that means both
               "you erred" and "you are mid-phrase" means neither.
       grey  = a finger still resting from the note you just played.

     Now vs next is a fill vs a bar, never two fills. Every time one of
     these was expressed as another shade of a neighbour, the keyboard
     stopped being readable.
   - the ARROW BAND, a strip immediately above the keys. One arc per
     Move, hued by the hand that makes it, rising higher for a bigger
     leap so a jump reads as a jump. A note struck twice in a row gets a
     downward tick over its own key instead of a degenerate flat arc.
     Every arc describes the transition the learner is IN — tail on a key
     a finger is holding, head on a key this step asks for — so an arrow
     never starts somewhere nobody is touching. Opt-in (`showArrows`):
     the band is a second thing to read at exactly the moment you are
     hunting for a key, so it is off unless the learner asks for it, and
     when it is off the band's height is given back to the readout.
   - the READOUT: where you are, what to play, what comes next.
   - the PAGE, along the top: the bars being worked on, as sheet music
     (staff-bars.ts, engraved by engrave.ts), with the neighbouring bars
     torn off at the margins for context and the current step's notes lit
     in the same gold as the keys. A key held that the step never asked
     for is written in red in the step's column (strays.ts), so the page
     shows how far off the hand was as well as the keyboard does.
     It shows the isolated range when there is one and otherwise the bar
     the cursor is in, so it turns its own pages. The rest of the piece
     lies either side of them, and the page PANS along it — the
     snapshot's `pan`, set by a native scroller main.ts lays over the page
     the way it does over the whole score, which brings the page back to
     rest when the learner plays on with the bars in hand out of sight.
     A click on a bar here
     isolates it — `barAt` is the hit-test, and it reads the same layout
     `markup` drew, the way `keyboardRegion` does for the keys. On a
     viewport too short to hold it with the readout and keys, it stands
     down (`sheetBandH` says when) rather than crushing the rest.

   ...and, when the lesson has one, a fifth band down the right-hand
   side: the HARMONY BAR. Keys and arrows say WHAT to press; the bar says
   what it MEANS — the Nashville numeral against the home key, the chord's
   name, the coloration it is wearing, its pitch classes, and the whole
   progression listed so you can see where in the loop you are. It is
   deliberately quiet: small type, one accent, no glow. The keyboard is
   the instrument and the bar is the label on it.

   It appears only when `snapshot.chart` does — a lesson from a MIDI file
   carries no analysis and gets no bar, and the layout is then exactly what
   it always was. That is also why `keyboardRegion` takes the frame:
   the keyboard gives up the column the bar occupies, so the hit-test has
   to know whether the column is there. See view.ts, note 3.

   THE WHOLE SCORE is the other way to lay the view out, on a toggle
   (`wholeScore`): the header, the keyboard and the arrows stay, and the
   page and readout between them give way to the whole piece on sheets of
   paper (staff-score.ts), the current step still lit in gold and a click
   on a bar still isolating it. The keys light and play exactly as they
   do in the step layout — one `keyLayer` draws them for both — so the
   learner reads from the sheets and plays on the keys below them.
   `scoreShown` is the one predicate `markup`, `barAt` and `scroller` ask,
   and `sheetsH` the one height they all lay the sheets out in.

   The sheets scroll. The scroll position is the frame's `sheetScroll`,
   set by a native scroller main.ts lays over the region `scroller` names;
   the view only draws at that offset, so it stays a pure function. The
   page above the keys pans the same way, across instead of down, at the
   snapshot's `pan`: `scroller` names whichever of the two is showing, and
   on which axis (view.ts, note 5).

   Like Nashville, this is a pure function of a snapshot. It imports
   PracticeState's TYPE and never the singleton, so it can be rendered
   off-screen, twice, or from a fabricated moment in a test.
   ==================================================================== */
import { PianoRoll, KEYB, type KeyStyle } from "./piano-roll";
import { StaffBars } from "./staff-bars";
import { StaffScore } from "./staff-score";
import { RangeMarks } from "./range-marks";
import { Core } from "../core";
import { describeBars } from "../sections";
import { glowFilter, glowAttr, text } from "./defs";
import { isWhite, pitchLabel, PITCH_NAMES } from "../pitch";
import {
  QUALITY_COLOR, SCALE_DISPLAY_NAMES, DIRECTION_SYMBOL, type Key,
} from "../harmony/perfecto";
import {
  changeColor, changeColorLabel, changeName, changeOf, changePitchClasses,
  changeQuality, homeNumeral, type Change,
} from "../harmony/progression";
import type { BarRange, Hand, Note, Pitch, Score } from "../types";
import type { PracticeSnapshot } from "../practice-state";
import type { View, ViewModule, Region, LiveSnapshot, Frame, Scroller } from "../view";

const GLOW_ID = "practiceGlow";

/** Height of the arrow strip above the keys. Fixed: the arrows are a
 *  legibility budget, not a proportion of the window. */
const ARROW_H = 84;

/** The strike colour, in both of its states. Named once because the pulse
 *  overlay has to find the keys wearing it. */
const STRIKE = "var(--note-lit)";

/** The pulse envelope over one acknowledgment: `age` runs 0 at the press to
 *  1 when it is spent (PracticeState owns the duration; the view only owns
 *  the shape). A fast rise and a long fall, so it reads as a STRIKE — a
 *  symmetric swell reads as something arriving, which is the opposite of
 *  what just happened.
 *
 *  It is a function of the snapshot's own clock rather than a CSS keyframe
 *  or an <animate> because this view rebuilds its markup every frame: an
 *  animation attached to the elements would be re-created, and therefore
 *  restarted, sixty times a second and never move off its first frame. */
const RISE = 0.12;
export const pulseEnv = (age: number): number => {
  const a = Math.max(0, Math.min(1, age));
  return a <= RISE ? a / RISE : (1 - a) / (1 - RISE);
};

/** The score this view hands the keyboard — none. See `markup`. */
const EMPTY: Score = Core.makeScore([]);

/** Keys-only band. Never taller than the keyboard wants, and it yields on
 *  a short viewport the same way every other stacked view does. */
export const rollBandH = (H: number): number => Math.min(KEYB, Math.round(H * 0.4));

/** Where the page begins: under the header line and its rule at y=48. */
export const SHEET_TOP = 60;
/** The page at its tallest, and the least it can be drawn at: a grand
 *  staff with two ledger lines each way is ~200px, and a page shorter than
 *  that would be a staff with its edges cut off. */
const SHEET_MAX = 230;
const SHEET_MIN = 176;
/** The readout needs this much between the page and the arrows/keys to
 *  say NOW, THEN and "put back" without overlapping any of them. */
const READOUT_MIN = 150;

/** How tall the page is for a viewport — 0 when there is no room for it
 *  beside everything the view cannot do without. One owner: `markup` lays
 *  out against it and `barAt` hit-tests against it, the same arrangement
 *  `chartBandW` has with the keyboard. */
export const sheetBandH = (H: number, arrows: boolean): number => {
  const avail = H - SHEET_TOP - rollBandH(H) - (arrows ? ARROW_H : 0) - READOUT_MIN;
  return avail < SHEET_MIN ? 0 : Math.min(SHEET_MAX, avail);
};

/** How tall the whole score's sheets are: everything between the header
 *  and the arrows over the keys. One owner, like `sheetBandH`: `markup`
 *  draws in it, and `barAt` and `scroller` measure against it. */
export const sheetsH = (H: number, arrows: boolean): number =>
  Math.max(0, H - SHEET_TOP - rollBandH(H) - (arrows ? ARROW_H : 0));

/** Is the view showing the whole score? Asked for, and a lesson to show. */
const scoreShown = (s: PracticeSnapshot): boolean =>
  s.wholeScore && s.active && s.score !== null && s.total > 0;

/** The bar the cursor stands in, or where the lesson ended — what the
 *  whole score scrolls to follow. */
const cursorBar = (s: PracticeSnapshot): number =>
  s.current ? Core.barAt(s.score!, s.current.at).index : s.focus.to;

const handHue = (h: Hand | undefined): string =>
  h === "lower" ? "var(--hand-l)" : h === "upper" ? "var(--hand-r)" : "var(--note)";

/** The hand NOT being practised, when exactly one is. Derived rather than
 *  carried, so it cannot disagree with the filter it is the complement of.
 *  Answers in the DIM tokens: the other hand is background, and a keyboard
 *  where everything is bright says nothing about what to do next. */
const otherDimHue = (hand: PracticeSnapshot["hand"]): string =>
  hand === "upper" ? "var(--hand-l-dim)"
  : hand === "lower" ? "var(--hand-r-dim)"
  : "var(--note-dim)";

/** The attacks this step asked for that you have already played — exactly
 *  the complement of `pending` within `current.attack`. Steady gold: you
 *  have this one, the chord is not finished. */
export const struck = (s: PracticeSnapshot): Pitch[] =>
  (s.current?.attack ?? []).map((n) => n.pitch).filter((p) => !s.pending.has(p));

/** Keys wearing a live acknowledgment, with how far through it they are.
 *  Named once and used twice — the gold fill and the pulse over it — so the
 *  light can never land on a key the roles did not colour.
 *
 *  A pitch that has since been given back drops out: `pending` again means
 *  you released a note the step still wants, and `dropped` means you let go
 *  of one you were holding. Neither is a moment to keep congratulating. */
export const hits = (s: PracticeSnapshot): [Pitch, number][] =>
  [...s.hit].filter(([p]) => !s.pending.has(p) && !s.dropped.has(p));

/* --------------------------------------------------------------------
   KEY ROLES. Built lowest precedence first, so a later write wins and the
   order below IS the precedence — one list to read instead of a nest of
   conditionals. A key is only ever the loudest thing it is.
   -------------------------------------------------------------------- */
export function keyStyles(s: PracticeSnapshot): Map<Pitch, KeyStyle> {
  const out = new Map<Pitch, KeyStyle>();
  const put = (ps: Iterable<Pitch>, style: KeyStyle): void => {
    for (const p of ps) out.set(p, style);
  };
  const cur = s.current;

  // 1. the hand you are not playing. `other` is the FACT (which keys it is
  //    sounding); `showOther` is the presentation. Both branches must write
  //    a style, because when it is auto-played those keys are genuinely
  //    held — leaving them to the default would light them the same green
  //    as a key the learner pressed, which is the one thing "hidden" must
  //    not do.
  //    It wears the DIM hand token, not the bright one: it is context, and
  //    context that competes with the call to action is noise.
  for (const p of s.other)
    out.set(p, s.showOther
      ? { fill: otherDimHue(s.hand) }
      : { fill: isWhite(p) ? "var(--key-white)" : "var(--key-black)" });

  // Where you are going is deliberately NOT a key colour. It used to be the
  // hand hue, which made "press this now" and "press this next" two fills of
  // equal weight on the same keyboard — the reader had no way to tell which
  // was which. The next step is marked instead by a bar under its keys (see
  // `targetBar`): a different KIND of mark, not a different shade, so
  // nothing about a filled key ever means "later".

  if (cur) {
    // 3. what you are already HOLDING correctly — a sustain carried in from
    //    an earlier step. Green, because the verb is hold, not strike, and
    //    no glow: keeping a finger down is not a call to action.
    put(cur.sustain.map((n) => n.pitch), { fill: "var(--key-press)" });
    // 4. what you have just STRUCK correctly. Gold — the same gold the step
    //    asked in — and left un-glowed here because `pulseMark` puts the
    //    breathing light on top. Getting a note right must not read as the
    //    key cooling off, which is exactly what turning it green did.
    put(struck(s), { fill: STRIKE });
    // 5. what you still owe: the same verb, not yet done. A steady glow, so
    //    still vs breathing is the whole difference between owed and got.
    put(s.pending, { fill: STRIKE, glow: true });
    // 6. a note you were supposed to keep down and let go of. Blocking —
    //    and deliberately NOT another red fill. Red already means "a key
    //    this step never asked for", which is the harmless mistake; two
    //    reds for the blocking case and the harmless one is how a reader
    //    ends up seeing "red notes" as one thing. The key goes back to its
    //    own colour here and `dropMark` draws a HOLLOW green outline over
    //    it — the ghost of the green fill that ought to be there. Held and
    //    should-be-held then differ the way filled differs from empty.
    for (const p of s.dropped)
      out.set(p, { fill: isWhite(p) ? "var(--key-white)" : "var(--key-black)" });
  }

  // 7. a finger still resting on the key you just correctly played. Neutral
  //    grey, no glow: it is down (so it cannot be left at the key's own
  //    colour, which would be a lie about what is sounding) but it is not a
  //    mistake, so it must not wear the mistake colour. It recedes.
  put(s.stale, { fill: "var(--ink-dim)" });

  // 8. keys you are holding that this step never asked for.
  put(s.wrong, { fill: "var(--wrong)", glow: true });

  // 9. and over everything settled: a key struck CORRECTLY a moment ago.
  //    Last because it is the most RECENT fact and the only temporary one —
  //    when it expires the key drops back to whatever it now is, green if
  //    the step wants it held on, grey if it wants it lifted.
  //
  //    Without this the reward was invisible. A step completes on the press
  //    that satisfies it, so one frame later the key already belongs to the
  //    NEXT step: it had turned green (or grey) before anyone could see it
  //    do anything else, which is exactly the "correct note goes dull"
  //    this rule exists to answer.
  for (const [p] of hits(s)) out.set(p, { fill: STRIKE });
  return out;
}

/* --------------------------------------------------------------------
   ARROWS
   -------------------------------------------------------------------- */
/* An arc between two keys is symmetric, and a symmetric arc reads exactly
   as well backwards. Direction therefore cannot live in the curve — it has
   to live in the ENDS, and the two ends have to be different shapes:

     ●  a dot, sitting on the key your finger is on now
     ▼  a head, landing on the key it is going to

   The head is also large enough to see: the first version's was 10×9px with
   a tail that started LOWER than the head's own base, so the origin looked
   more anchored to its key than the destination did. */
const HEAD_W = 7; // half-width
const HEAD_H = 13;

const arrowhead = (x: number, y: number, fill: string): string =>
  `<path d="M${x - HEAD_W},${y - HEAD_H} L${x + HEAD_W},${y - HEAD_H} L${x},${y} Z" fill="${fill}"/>`;

const originDot = (x: number, y: number, fill: string): string =>
  `<circle cx="${x}" cy="${y}" r="3.5" fill="${fill}"/>`;

/** One move as an arc from a key held now to a key this step asks for,
 *  drawn in the strip above the keyboard. `y0` is the top of the keyboard. */
function arrow(x1: number, x2: number, y0: number, hue: string): string {
  const tipY = y0 - 1; // the head touches the key it means
  const dotY = y0 - 6;
  // a repeat has nowhere to arc to; say "strike this again" instead of
  // drawing a zero-width curve that reads as a smudge. No origin dot: the
  // two ends are the same key, and two marks on one key would be the very
  // ambiguity the shapes exist to remove.
  if (Math.abs(x1 - x2) < 1.5)
    return (
      `<line x1="${x2}" y1="${tipY - HEAD_H - 24}" x2="${x2}" y2="${tipY - HEAD_H - 2}" ` +
      `stroke="${hue}" stroke-width="3" stroke-linecap="round"/>` +
      arrowhead(x2, tipY, hue)
    );
  // bigger leaps arc higher, capped inside the band.
  const rise = Math.min(ARROW_H - 16, 30 + Math.abs(x2 - x1) * 0.3);
  return (
    `<path d="M${x1},${dotY - 4} C${x1},${y0 - rise} ${x2},${y0 - rise} ${x2},${tipY - HEAD_H}" ` +
    `fill="none" stroke="${hue}" stroke-width="2.5" stroke-linecap="round" opacity="0.85"/>` +
    originDot(x1, dotY, hue) +
    arrowhead(x2, tipY, hue)
  );
}

/** A key you should still be holding and are not: a HOLLOW outline where
 *  the held-green fill ought to be. Drawn over the key at its own colour,
 *  so "holding it" and "should be holding it" differ as filled differs from
 *  empty — categorically, not by shade. It glows, because unlike a wrong
 *  note this one actually blocks the step. */
const dropMark = (
  x: number, w: number, top: number, h: number,
): string =>
  `<rect x="${x + 2}" y="${top + 2}" width="${Math.max(2, w - 4)}" height="${Math.max(2, h - 4)}" ` +
  `rx="3" fill="none" stroke="var(--key-press)" stroke-width="3"${glowAttr(GLOW_ID)}/>`;

/** A key you have just struck correctly: a pale gold light that flares over
 *  its fill and falls away. The acknowledgment has to arrive as MOTION,
 *  because the alternative — a second colour — is what put a correct note
 *  into the same green as a finger merely resting on a sustain, and made
 *  the one moment of success in this view the moment the key went dull. */
const pulseMark = (
  x: number, w: number, top: number, h: number, age: number,
): string => {
  const a = pulseEnv(age).toFixed(3);
  return `<rect x="${x + 1.5}" y="${top + 1.5}" width="${Math.max(2, w - 3)}" ` +
    `height="${Math.max(2, h - 3)}" rx="3" fill="var(--note-hit)" ` +
    `opacity="${a}"${glowAttr(GLOW_ID)}/>`;
};

/** The bar under a key the NEXT step will ask for — the whole of this view's
 *  look-ahead, since the arrows describe the move being played now and never
 *  reach that far. Drawn at the key's own bottom edge, where nothing occludes
 *  it: a white key's top half disappears under its black neighbours. */
const targetBar = (x: number, w: number, bottomY: number, hue: string): string =>
  `<rect x="${x + 2}" y="${bottomY - 10}" width="${Math.max(2, w - 4)}" height="5" rx="2.5" fill="${hue}"/>`;

/* --------------------------------------------------------------------
   THE HARMONY BAR — the right-hand column, present only when the lesson
   brought an analysis with it.

   Everything in it is derived from the Chart by progression.ts's own
   naming functions, so the words here and the words the Nashville view
   uses for the same chord are the same words. It reads no harmony rule
   of its own; a view that recomputed "is this minor" would eventually
   disagree with the thing that generated the notes.
   -------------------------------------------------------------------- */

/** Column width. Fixed, like ARROW_H: it holds a column of text, and text
 *  does not want to be a proportion of the window. */
const BAND_W = 216;

/** Below this the column would take more of the keyboard than it is worth,
 *  so the bar stands down and the view is exactly what it was without it. */
const BAND_MIN_W = 760;

/** How wide the harmony bar is for a given view width — 0 when there is no
 *  chart to put in it or no room for it. The one owner of that question:
 *  `markup` lays out against it and `keyboardRegion` hit-tests against it,
 *  and the two disagreeing is a keyboard whose keys are not where the
 *  pointer thinks they are. */
export const chartBandW = (W: number, hasChart: boolean): number =>
  hasChart && W >= BAND_MIN_W ? BAND_W : 0;

const PAD = 14;
const ROW_H = 23;
/** Height reserved at the bottom of the bar for the current chord's detail.
 *  The list gets whatever is left. */
const FOOT_H = 130;

/** Monospace, so a character budget IS a width budget. ~0.6em per glyph. */
const fit = (str: string, px: number, size: number): string => {
  const n = Math.max(1, Math.floor(px / (size * 0.6)));
  return str.length <= n ? str : `${str.slice(0, n - 1)}…`;
};

const keyName = (k: Key): string =>
  `${PITCH_NAMES[k.root]} ${SCALE_DISPLAY_NAMES[k.scale]}`;

const rule = (x1: number, x2: number, y: number, stroke = "var(--grid)"): string =>
  `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${stroke}" stroke-width="1"/>`;

/** One row of the progression list: numeral on the left in its quality's
 *  colour, chord name on the right. NOW is said by a filled panel and a
 *  left accent — a kind of mark, not a shade of the hue that already means
 *  something else, which is the same rule the keyboard follows. */
function chartRow(
  x: number, w: number, top: number, home: Key, c: Change, now: boolean,
): string {
  const q = changeQuality(c);
  let out = "";
  if (now) {
    out += `<rect x="${x - 6}" y="${top}" width="${w + 12}" height="${ROW_H - 3}" rx="4" ` +
      `fill="var(--panel)"/>`;
    out += `<rect x="${x - 6}" y="${top}" width="3" height="${ROW_H - 3}" rx="1.5" ` +
      `fill="var(--note-lit)"/>`;
  }
  const base = top + ROW_H - 9;
  out += text(x, base, fit(homeNumeral(home, c), 62, 12),
    { size: 12, weight: 700, anchor: "start", fill: QUALITY_COLOR[q] });
  out += text(x + w, base, fit(changeName(c), w - 68, 9),
    { size: 9, weight: 500, anchor: "end", fill: now ? "var(--ink)" : "var(--ink-dim)" });
  return out;
}

/** The whole column. `x0` is its left edge; it owns everything from there
 *  to `W`, top to bottom. */
export function harmonyBar(x0: number, W: number, H: number, s: PracticeSnapshot): string {
  const chart = s.chart;
  if (!chart) return "";
  const x = x0 + PAD;
  const right = W - PAD;
  const w = right - x;

  // the seam. A hairline, not a panel: the bar is an annotation on the
  // view, and a filled sidebar would read as a second, competing surface.
  let out = `<line x1="${x0}" y1="0" x2="${x0}" y2="${H}" stroke="var(--line-acc)" stroke-width="1"/>`;

  out += text(x, 30, fit(chart.name, w, 12), { size: 12, weight: 700, anchor: "start" });
  out += text(x, 46, fit(keyName(chart.home), w, 10),
    { size: 10, weight: 500, anchor: "start", fill: "var(--ink-dim)" });
  out += rule(x, right, 58);

  // --- the progression, listed ------------------------------------
  // A window, not the whole list: a twelve-bar blues does not fit beside a
  // keyboard on a laptop, and a list that scrolls off the bottom is worse
  // than one that admits it is showing you a part.
  const listTop = 80;
  const footTop = H - FOOT_H;
  const n = chart.changes.length;
  // How many rows fit between the header and the footer. On a viewport too
  // short for even one, the list goes away entirely rather than being drawn
  // through the footer: the current chord is the part you cannot do without.
  const rows = Math.floor((footTop - 10 - listTop) / ROW_H);
  const here = s.change?.index ?? 0;
  const first = Math.max(0, Math.min(here - Math.floor(rows / 2), n - rows));
  const last = Math.min(n, first + Math.max(0, rows));

  for (let i = first; i < last; i++)
    out += chartRow(x, w, listTop + (i - first) * ROW_H, chart.home, chart.changes[i],
      s.change !== null && i === here);

  // honest ellipses when the window is not the whole thing
  if (rows > 0 && first > 0)
    out += text(x + w / 2, listTop - 8, "⋯", { size: 11, fill: "var(--grid-oct)" });
  if (rows > 0 && last < n)
    out += text(x + w / 2, listTop + rows * ROW_H + 8, "⋯", { size: 11, fill: "var(--grid-oct)" });

  // --- the current chord, in detail -------------------------------
  out += rule(x, right, footTop);
  if (!s.change) {
    return out + text(x, footTop + 30, "—", { size: 14, weight: 700, anchor: "start", fill: "var(--ink-dim)" });
  }
  const c = changeOf(chart, s.change);
  const hue = QUALITY_COLOR[changeQuality(c)];

  // One fact per line. Two long strings sharing a line is how a 216px
  // column starts truncating exactly the names that needed the room —
  // "♭VImaj7" and "dom7♯5♯9" are both real, and both belong here whole.
  out += text(x, footTop + 20, "CHORD", { size: 9, weight: 700, anchor: "start", fill: "var(--ink-dim)" });
  out += text(right, footTop + 20, `${s.change.index + 1} / ${n}`,
    { size: 9, weight: 500, anchor: "end", fill: "var(--ink-dim)" });

  out += text(x, footTop + 48, fit(homeNumeral(chart.home, c), w, 22),
    { size: 22, weight: 800, anchor: "start", fill: hue });
  out += text(x, footTop + 68, fit(changeName(c), w, 12),
    { size: 12, weight: 700, anchor: "start", fill: "var(--ink)" });

  // The coloration said twice, because it has two useful readings and they
  // are not the same reading. The MOOD is what the player thinks in; the
  // joystick cell beside it is where this colour lives on the stick, so a
  // chord met here can be found again in the Nashville view or under a
  // thumb. The glyph is what keeps the cell from being mistaken for a
  // chord symbol — the chord's own symbol is the line above.
  out += text(x, footTop + 88, fit(changeColor(c), w * 0.55, 10),
    { size: 10, weight: 700, anchor: "start", fill: "var(--note-lit)" });
  out += text(right, footTop + 88,
    fit(`${DIRECTION_SYMBOL[c.direction]} ${changeColorLabel(c)}`, w * 0.45, 9),
    { size: 9, weight: 500, anchor: "end", fill: "var(--ink-dim)" });

  // the key it is HEARD IN — the same as home for a diatonic chord, and
  // the whole story for a borrowed one, a secondary dominant, or a
  // modulation. Always shown, so "same as home" is a fact you can read
  // rather than an absence you have to infer. The inversion joins it when
  // there is one, since both answer "what is under your hand" rather than
  // "which chord is it".
  const inv = c.inversion && c.inversion !== "root" ? ` · ${c.inversion} inv` : "";
  out += text(x, footTop + 106, fit(`in ${keyName(c.key)}${inv}`, w, 9),
    { size: 9, weight: 500, anchor: "start", fill: "var(--ink-dim)" });

  // double-spaced, the way the Nashville readout spells a chord's notes —
  // one program, one way of writing the same thing down.
  out += text(x, footTop + 124,
    fit(changePitchClasses(c).map((pc) => PITCH_NAMES[pc]).join("  "), w, 11),
    { size: 11, weight: 600, anchor: "start", fill: "var(--ink)" });

  return out;
}

/* --------------------------------------------------------------------
   THE VIEW
   -------------------------------------------------------------------- */
const names = (ns: readonly Note[]): string =>
  [...new Set(ns.map((n) => n.pitch))].sort((a, b) => a - b).map(pitchLabel).join("  ");

/** The whole view as markup — a pure function of the snapshot and the size,
 *  so it can be rendered off-screen and snapshot-tested. `held` is the only
 *  thing it needs from the rest of the frame: keys the learner is touching
 *  that the step has no opinion about still light as live presses.
 *
 *  Still deterministic with the pulse in it: the snapshot carries the AGE
 *  of each acknowledgment, so this function reads no clock of its own and
 *  a fabricated moment mid-pulse is as renderable as any other. */
export const markup = (
  W: number, H: number, s: PracticeSnapshot, held: ReadonlySet<Pitch>, sheetScroll = 0,
  marks: readonly BarRange[] = [],
): string => {
  if (!W || !H) return "";

  // the harmony bar takes a column off the right, and EVERYTHING else is
  // laid out in what is left. One subtraction, at the top, rather than a
  // width argument threaded through five call sites that could each forget.
  const barW = chartBandW(W, s.chart !== null);
  const mainW = W - barW;

  // the whole piece as sheet music between the header and the keys, with
  // the harmony bar beside it when there is one — no page, no readout.
  // The sheets scroll under the header, so they are clipped to their band.
  if (scoreShown(s)) {
    const h = sheetsH(H, s.showArrows);
    return `<defs>${glowFilter(GLOW_ID)}<clipPath id="${GLOW_ID}-sheets">` +
      `<rect x="0" y="0" width="${mainW}" height="${h}"/></clipPath></defs>` +
      header(mainW, s) +
      `<g transform="translate(0,${SHEET_TOP})"><g clip-path="url(#${GLOW_ID}-sheets)">` +
      StaffScore.markup(mainW, h, sheetScroll, s.score!, {
        glowId: GLOW_ID, range: s.range, current: s.current, hand: s.hand, showOther: s.showOther,
        wrong: s.wrong, marks,
      }) + `</g></g>` +
      keyLayer(mainW, H, s, held) +
      harmonyBar(mainW, W, H, s);
  }

  // the page, when there is a lesson to open it to and room to open it.
  // Drawn in its own 0..sheetH space and moved down, like the keyboard.
  const sheetH = s.active && s.score && s.total > 0 ? sheetBandH(H, s.showArrows) : 0;
  const sheet = sheetH > 0
    ? `<g transform="translate(0,${SHEET_TOP})">` +
      StaffBars.markup(mainW, sheetH, s.score!, {
        glowId: GLOW_ID, focus: s.focus, range: s.range, current: s.current,
        hand: s.hand, showOther: s.showOther, pan: s.pan, wrong: s.wrong, marks,
      }) + `</g>`
    : "";

  return `<defs>${glowFilter(GLOW_ID)}</defs>` + sheet +
    readout(mainW, sheetH > 0 ? SHEET_TOP + sheetH : 0, H - rollBandH(H), s, s.showArrows ? ARROW_H : 0) +
    keyLayer(mainW, H, s, held) +
    harmonyBar(mainW, W, H, s);
};

/** The keyboard along the bottom and everything that points at it: the
 *  next step's bars, the dropped outlines, the pulses and the arrows.
 *  Shared by both layouts, so the keys the learner plays on look and
 *  behave the same whichever is above them. */
function keyLayer(mainW: number, H: number, s: PracticeSnapshot, held: ReadonlySet<Pitch>): string {
  const band = rollBandH(H);
  const rollTop = H - band;

  // the keyboard, drawn by its owner in its own 0..band space, then moved
  // down — the same stacking idiom combo.ts and staff-piano.ts use. It is
  // handed an EMPTY score on purpose: every key this view lights comes from
  // `keyStyles`, so letting it also answer "is a note sounding at t" would
  // be a second, disagreeing opinion about the same pixels.
  const keys =
    `<g transform="translate(0,${rollTop})">` +
    PianoRoll.markup(mainW, band, EMPTY, 0, {
      glowId: GLOW_ID, held, fall: false, keyStyles: keyStyles(s),
    }) +
    `</g>`;

  // arrow endpoints must land on the lanes the keys were actually drawn
  // in, so they come from the keyboard's own geometry, not a second copy.
  const { lane, keyH, blackH, strikeY } = PianoRoll.geometry(mainW, band);
  const cx = (p: Pitch): number => {
    const { x, w } = lane(p);
    return x + w / 2;
  };

  // a key's own extent within the svg — white keys run the full height,
  // black ones stop short. Both marks below need it, so it is one function.
  const keyBox = (p: Pitch) => {
    const { x, w } = lane(p);
    const top = rollTop + strikeY;
    return { x, w, top, h: isWhite(p) ? keyH : blackH };
  };

  // the next step's keys, marked at their own bottom edge — a white key's
  // top is under its black neighbours, so a mark up there would vanish.
  let bars = "";
  for (const n of s.next?.attack ?? []) {
    const { x, w, top, h } = keyBox(n.pitch);
    bars += targetBar(x, w, top + h, handHue(n.hand));
  }

  // ...and the ones you have let go of, outlined where the fill should be.
  let drops = "";
  for (const p of s.dropped) {
    const { x, w, top, h } = keyBox(p);
    drops += dropMark(x, w, top, h);
  }

  // the light on what you just got right, over the gold `keyStyles` gave
  // those same keys — one list, so the fill and the flare cannot disagree.
  let pulses = "";
  for (const [p, age] of hits(s)) {
    const { x, w, top, h } = keyBox(p);
    pulses += pulseMark(x, w, top, h, age);
  }

  // the band is reserved only when something is drawn in it: with the
  // arrows off, an empty 84px strip above the keys is not a neutral
  // absence, it is a hole the readout should be centred in instead.
  let arrows = "";
  if (s.showArrows)
    for (const m of s.moves) arrows += arrow(cx(m.from), cx(m.to), rollTop, handHue(m.hand));

  // keys FIRST, then everything that points at them. The arrows used to be
  // emitted before the keyboard, which left them one layout change away from
  // being painted over by the very keys they refer to.
  return keys + drops + pulses + bars + arrows;
}

/** The header's left-hand words: where in the piece, or in the isolated
 *  bars, the cursor is. Bar numbers are said from 1, the way a musician
 *  counts them; steps within a range are counted within it, because "step
 *  41 of 200" is no help to someone drilling bar 6. */
export function whereLabel(s: PracticeSnapshot): string {
  const { first, last } = s.span;
  const within = last - first;
  if (s.range === null)
    return s.current === null ? `done · ${s.total} steps` : `step ${s.index + 1} / ${s.total}`;
  const bars = describeBars(s.range);
  if (within === 0) return `${bars} · nothing to play`;
  return `${bars} · step ${s.index - first + 1} / ${within}`;
}

/** The line across the top: where you are, which hand, and a hairline
 *  rule of progress under both. Shared by both layouts. */
function header(W: number, s: PracticeSnapshot): string {
  const HAND_LABEL = { both: "hands together", upper: "right hand", lower: "left hand" };
  const done = s.current === null;
  let out = text(24, 34, whereLabel(s), {
    size: 13, weight: 700, anchor: "start", fill: done && s.range === null ? "var(--key-press)" : "var(--ink)",
  });
  // the label wears the colour of the hand you are PLAYING, which is the
  // colour its keys are about to light in — not otherHue's complement.
  out += text(W - 24, 34, HAND_LABEL[s.hand], {
    size: 13, weight: 600, anchor: "end",
    fill: handHue(s.hand === "both" ? undefined : s.hand),
  });

  // a hairline progress rule under the header — progress through the
  // isolated bars when there are some, else through the piece. With the
  // page below, this is not the only hint of the whole; it is the one that
  // says how far through THIS you are.
  const barY = 48;
  const { first, last } = s.span;
  const frac = last > first ? (s.index - first) / (last - first) : 0;
  out += `<line x1="24" y1="${barY}" x2="${W - 24}" y2="${barY}" stroke="var(--grid)" stroke-width="2"/>`;
  if (frac > 0)
    out += `<line x1="24" y1="${barY}" x2="${24 + (W - 48) * frac}" y2="${barY}" stroke="var(--note-lit)" stroke-width="2"/>`;
  return out;
}

/** Everything between the page and the arrow band: where you are, and in
 *  words what the colours are already saying. `top` is where the page
 *  ends (0 when there is none) and `bandH` is the strip the arrows
 *  reserve — zero when they are switched off — so the words centre in
 *  whatever gap is actually free rather than sitting high above an empty
 *  band. Words because a chord you cannot yet find on the keyboard is a
 *  chord you need told to you. */
function readout(W: number, top: number, bottom: number, s: PracticeSnapshot, bandH: number): string {
  // centred in the free space, but never riding up over the header rule
  // at y=48.
  const mid = Math.max(84, top + Math.max(0, bottom - bandH - top) / 2 + 8);

  // no lesson, or a lesson with nothing in it — the same thing to a reader,
  // and "Piece complete" for a score that was never loaded is a lie.
  if (!s.active || s.total === 0) {
    return text(W / 2, mid, "Load a score to practise.", { size: 16, fill: "var(--ink-dim)" });
  }

  const done = s.current === null;
  let out = header(W, s);

  // a range with no steps in it — a bar of rests, or of the other hand
  // only — is not "complete"; it is nothing to do, and says so.
  if (done && s.range !== null)
    return out + text(W / 2, mid, "Nothing to play in these bars for this hand.", { size: 16, fill: "var(--ink-dim)" });
  if (done) return out + text(W / 2, mid, "Piece complete.", { size: 22, weight: 700, fill: "var(--key-press)" });

  // NOW and THEN as two labelled rows with a ↓ between them, rather than a
  // headline plus an afterthought. The question this view exists to answer
  // is "which notes, at what time", so the two times are given the same
  // shape and told apart by weight and colour — and the THEN row wears the
  // hand hue its keys are barred in, so the words and the keyboard match.
  const cur = s.current!;
  const owed = cur.attack.filter((n) => s.pending.has(n.pitch));

  // gold whether the notes are owed or already struck — on the keyboard both
  // states are gold now, and the words must not call the same thing by a
  // second colour. Done-ness is said by the keys pulsing, not by the label
  // changing hue.
  out += text(W / 2, mid - 26, "NOW", { size: 10, weight: 700, fill: STRIKE });
  out += text(W / 2, mid + 6, names(owed.length ? owed : cur.attack),
    { size: 30, weight: 800, fill: STRIKE });
  if (cur.sustain.length)
    out += text(W / 2, mid + 28, `keep holding  ${names(cur.sustain)}`,
      { size: 12, fill: "var(--ink-dim)" });

  if (s.next) {
    const y = mid + (cur.sustain.length ? 54 : 46);
    const hue = handHue(s.next.attack[0]?.hand);
    out += text(W / 2, y - 12, "↓", { size: 14, fill: "var(--ink-dim)" });
    out += text(W / 2, y + 6, "THEN", { size: 10, weight: 700, fill: "var(--ink-dim)" });
    out += text(W / 2, y + 30, names(s.next.attack), { size: 19, weight: 600, fill: hue });
  }

  // green, matching the outline it is talking about — the words and the
  // keyboard should never name the same thing in two colours. Urgency is
  // carried by the glowing outline and by the step refusing to advance,
  // not by borrowing the red that now means only "wrong note".
  if (s.dropped.size)
    out += text(W / 2, mid - 46,
      `put back  ${[...s.dropped].sort((a, b) => a - b).map(pitchLabel).join("  ")}`,
      { size: 12, weight: 700, fill: "var(--key-press)" });

  return out;
}

export const render: View = (svg, { live }) => {
  const W = svg.clientWidth;
  const H = svg.clientHeight;
  if (!W || !H) return;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.innerHTML = markup(W, H, live.practice, live.held, live.sheetScroll, live.marks);
};

// the keys are pointer-playable here like anywhere else — you can practise
// by clicking, which is also what makes the advance rule testable by hand.
// It stops where the harmony bar starts, from the same `chartBandW` the
// drawing does: a region wider than the keys it describes would silently
// sound the wrong note near the right-hand edge. Both layouts draw the same
// keys in the same place, so the region does not ask which is showing.
const keyboardRegion = (svg: SVGSVGElement, { live }: Frame): Region | null => {
  const W = svg.clientWidth;
  const H = svg.clientHeight;
  const band = rollBandH(H);
  return { x: 0, y: H - band, w: W - chartBandW(W, live.practice.chart !== null), h: band };
};

/** Which bar of the page a client-space point is over, or null when it is
 *  not on the page — the page's counterpart to PianoRoll.pitchAt. Reads
 *  the page's place and size from the same `sheetBandH` and `chartBandW`
 *  the drawing used, so the bar under the pointer is the bar drawn there;
 *  on the whole score, from the same region `markup` handed StaffScore.
 *  The svg's viewBox tracks its pixel size 1:1, so client offset is user
 *  units. */
function barAt(svg: SVGSVGElement, clientX: number, clientY: number, live: LiveSnapshot): number | null {
  const r = svg.getBoundingClientRect();
  return barIn(svg.clientWidth, svg.clientHeight, live, clientX - r.left, clientY - r.top - SHEET_TOP);
}

/** `barAt` in the view's own terms: `x` across it, `y` down from the top
 *  of the music (SHEET_TOP) — the scroller's region, for both layouts. */
function barIn(W: number, H: number, live: LiveSnapshot, x: number, y: number): number | null {
  const s = live.practice;
  if (!s.active || !s.score || s.total === 0) return null;
  const mainW = W - chartBandW(W, s.chart !== null);
  if (scoreShown(s))
    return x >= mainW || y < 0 || y > sheetsH(H, s.showArrows) ? null
      : StaffScore.barAt(mainW, s.score, s.hand, s.showOther, x, y + live.sheetScroll);
  const sheetH = sheetBandH(H, s.showArrows);
  if (sheetH === 0 || y < 0 || y > sheetH) return null;
  return StaffBars.barAt(mainW, s.score, s.focus, x, s.hand, s.showOther, s.pan);
}

/** The range's grip under a point, in `barIn`'s terms: on the whole
 *  score's sheets or the single-line page, whichever is showing. */
function gripIn(W: number, H: number, live: LiveSnapshot, x: number, y: number): "start" | "end" | null {
  const s = live.practice;
  if (!s.active || !s.score || !s.range) return null;
  const mainW = W - chartBandW(W, s.chart !== null);
  if (x >= mainW || y < 0) return null;
  if (scoreShown(s))
    return y > sheetsH(H, s.showArrows) ? null
      : StaffScore.gripAt(mainW, s.score, s.hand, s.showOther, s.range, x, y + live.sheetScroll);
  if (y > sheetBandH(H, s.showArrows)) return null;
  return RangeMarks.gripAt(StaffBars.stripMarks(mainW, s.score, s.focus, s.hand, s.showOther, s.pan), s.range, x);
}

/** The marked section under a point, in `barIn`'s terms. */
function markIn(W: number, H: number, live: LiveSnapshot, x: number, y: number): BarRange | null {
  const s = live.practice;
  if (!s.active || !s.score || live.marks.length === 0) return null;
  const mainW = W - chartBandW(W, s.chart !== null);
  if (x >= mainW || y < 0) return null;
  if (scoreShown(s))
    return y > sheetsH(H, s.showArrows) ? null
      : StaffScore.markAt(mainW, s.score, s.hand, s.showOther, live.marks, x, y + live.sheetScroll);
  const sheetH = sheetBandH(H, s.showArrows);
  if (y > sheetH) return null;
  const marks = StaffBars.stripMarks(mainW, s.score, s.focus, s.hand, s.showOther, s.pan);
  return RangeMarks.markAt(marks, live.marks, x, y, ...StaffBars.panelBand(sheetH));
}

/** Where a grip dragged to a point would go, in `barIn`'s terms. */
function timeIn(W: number, live: LiveSnapshot, x: number, y: number): number | null {
  const s = live.practice;
  if (!s.active || !s.score) return null;
  const mainW = W - chartBandW(W, s.chart !== null);
  if (scoreShown(s)) return StaffScore.timeAt(mainW, s.score, s.hand, s.showOther, x, y + live.sheetScroll);
  return RangeMarks.timeAt(StaffBars.stripMarks(mainW, s.score, s.focus, s.hand, s.showOther, s.pan), x);
}

/** Where the range's panel shows, in `barIn`'s terms: its first stretch
 *  on the sheets that is in sight, cut to the part in sight — or null
 *  when none of it is. */
function rangeIn(W: number, H: number, live: LiveSnapshot): Region | null {
  const s = live.practice;
  if (!s.active || !s.score || !s.range) return null;
  const mainW = W - chartBandW(W, s.chart !== null);
  const whole = scoreShown(s);
  const h = whole ? sheetsH(H, s.showArrows) : sheetBandH(H, s.showArrows);
  const boxes = whole
    ? StaffScore.rangeBoxes(mainW, s.score, s.hand, s.showOther, s.range)
      .map((b) => ({ ...b, y: b.y - live.sheetScroll }))
    : stripBoxes(mainW, h, s);
  for (const b of boxes) {
    const x0 = Math.max(0, b.x);
    const x1 = Math.min(mainW, b.x + b.w);
    const y0 = Math.max(0, b.y);
    const y1 = Math.min(h, b.y + b.h);
    if (x1 > x0 && y1 > y0) return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  return null;
}

/** The range's panel on the single-line page, `sheetH` tall. */
function stripBoxes(W: number, sheetH: number, s: PracticeSnapshot): Region[] {
  if (sheetH === 0 || !s.score || !s.range) return [];
  const span = RangeMarks.spanOnLine(StaffBars.stripMarks(W, s.score, s.focus, s.hand, s.showOther, s.pan), s.range);
  if (!span) return [];
  const [y, h] = StaffBars.panelBand(sheetH);
  return [{ x: span.xa, y, w: span.xb - span.xa, h }];
}

/** Where the music scrolls: the whole score down its sheets, or the page
 *  across the piece. Null when neither is showing, and there is nothing
 *  to scroll. */
function scroller(svg: SVGSVGElement, { live }: Frame): Scroller | null {
  const s = live.practice;
  if (!s.active || !s.score || s.total === 0) return null;
  const W = svg.clientWidth;
  const H = svg.clientHeight;
  const w = W - chartBandW(W, s.chart !== null);
  if (scoreShown(s)) {
    const h = sheetsH(H, s.showArrows);
    return {
      region: { x: 0, y: SHEET_TOP, w, h },
      axis: "y",
      length: StaffScore.contentHeight(w, s.score, s.hand, s.showOther),
      origin: 0,
      follow: s.index,
      ...StaffScore.sightOf(w, h, s.score, s.hand, s.showOther, cursorBar(s)),
      barAt: (x, y) => barIn(W, H, live, x, y),
      gripAt: (x, y) => gripIn(W, H, live, x, y),
      markAt: (x, y) => markIn(W, H, live, x, y),
      timeAt: (x, y) => timeIn(W, live, x, y),
      rangeBox: () => rangeIn(W, H, live),
    };
  }
  const sheetH = sheetBandH(H, s.showArrows);
  if (sheetH === 0) return null;
  const span = StaffBars.panSpan(w, s.score, s.focus, s.hand, s.showOther);
  // whole pixels, so the rest lands on a position a scroller can hold
  // exactly rather than one it rounds a fraction off
  const origin = Math.max(0, -Math.floor(span.range[0]));
  const [a, b] = span.focus;
  return {
    region: { x: 0, y: SHEET_TOP, w, h: sheetH },
    axis: "x",
    length: w + origin + Math.ceil(span.range[1]),
    origin,
    follow: s.index,
    sight: [origin + a, origin + b],
    home: origin,
    barAt: (x, y) => barIn(W, H, live, x, y),
    gripAt: (x, y) => gripIn(W, H, live, x, y),
    markAt: (x, y) => markIn(W, H, live, x, y),
    timeAt: (x, y) => timeIn(W, live, x, y),
    rangeBox: () => rangeIn(W, H, live),
  };
}

export const Practice: ViewModule & {
  markup: typeof markup;
  keyStyles: typeof keyStyles;
  struck: typeof struck;
  hits: typeof hits;
  pulseEnv: typeof pulseEnv;
  chartBandW: typeof chartBandW;
  sheetBandH: typeof sheetBandH;
  sheetsH: typeof sheetsH;
  whereLabel: typeof whereLabel;
  barAt: typeof barAt;
  scroller: typeof scroller;
} = {
  render, keyboardRegion, tape: () => null, markup, keyStyles, struck, hits, pulseEnv, chartBandW,
  sheetBandH, sheetsH, whereLabel, barAt, scroller,
};
