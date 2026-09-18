/* ====================================================================
   PRACTICE_STATE — the live cursor for practice mode, and the third of
   this program's live-state singletons. Same shape as PerfState and
   TonnetzState: mutable selection owned here, setters that do not draw,
   one snapshot() that is the ONLY way the state reaches a view.

   What it owns that they do not is a POSITION IN A SCORE that time does
   not move. The clock still exists and every sink still runs off it; the
   cursor just seeks it, so switching to any other view mid-lesson shows
   the same instant rather than a dead playhead at zero. The clock arrives
   as a callback (`begin`), not an import — it is already a value, and
   taking it as one keeps this module testable without a rAF loop.

   THE ADVANCE RULE, which is the whole feature:

     a step completes when every pitch it ATTACKS has been freshly struck
     since the step began, all of them are down at that moment, and every
     pitch it SUSTAINS is still down.

   "Freshly struck" is why LiveKeys publishes edges. It buys two things a
   held-set test cannot have: a chord played twice in a row is not
   satisfied by holding it once, and the learner may build a chord up one
   finger at a time — press C, then E, then G — and complete it on the G,
   which is exactly how a beginner meets a new shape. Wrong notes are
   reported but never block; a lesson that dead-ends on a resting finger
   is a worse teacher than one that says "that too".

   The other hand is pressed THROUGH LiveKeys, so audio, MIDI-out, and
   every other view's lit keys come for free — the same reason PerfState
   does. Its voices are held as handles and reconciled by diffing, so
   common tones between steps never re-attack.

   THE CHART is the second thing a lesson may carry: what its notes MEAN.
   A score from a file has none and says so with `null` — we do not invent
   an analysis nobody gave us — while a score realized from a Progression
   brings one along (see harmony/progression.ts). It rides beside the
   score rather than inside it because a Note has no room for harmony and
   should not grow one: the same C-E-G is Imaj-in-C and Vmaj-in-F, and
   which it is depends on the piece, not on the pitches.

   It is looked up BY SCORE TIME, using the `at` a Step already carries.
   That is the whole coupling — no parallel index to keep aligned with the
   cursor, and a scrub that lands on a step lands on its chord too.

   THE RANGE is the third: which BARS the lesson is confined to. A learner
   breaks a piece down by isolating a bar, or a run of them, and drilling
   that alone; the cursor then walks only the steps that begin inside
   those bars (a Span, cut by steps.spanOf from the score's own bars) and
   LOOPS — finishing the last step of the range lands on its first, because
   a passage isolated to be repeated should repeat. The whole piece, with
   no range, still ends: `index === total` is "done", as it always was.
   Where the cursor may go is the range's decision; where it IS remains the
   cursor's, and the two meet only in `enter`.
   ==================================================================== */
import { LiveKeys, type Voice } from "./live-keys";
import { barAt, clampRange } from "./core";
import { entryAfter, entryAt, type Chart, type ChartEntry } from "./harmony/progression";
import {
  makeSteps, movesBetween, otherHand, soundingIn, spanOf, stepAt,
  type HandFilter, type Move, type Span, type Step, type Steps,
} from "./steps";
import type { BarRange, Note, Pitch, Score } from "./types";

export interface PracticeSnapshot {
  /** Is a lesson running? False before begin() and after end(), and the
   *  one flag the view needs to draw its empty state. */
  active: boolean;
  hand: HandFilter;
  showOther: boolean;
  playOther: boolean;
  /** Draw the movement arrows? A presentation choice, like `showOther`:
   *  `moves` below is always the fact, and a view that is told not to draw
   *  them simply does not. Off by default — the arrow band is a second
   *  thing to read at the moment you are trying to find a key, and a
   *  learner who wants it can say so. */
  showArrows: boolean;
  /** Show the whole score as sheet music instead of the bars being worked
   *  on above a keyboard? Presentation only, like `showArrows`: the cursor,
   *  the grading and the range are the same either way. */
  wholeScore: boolean;
  /** How far down the whole score is scrolled, in pixels. The scroller that
   *  owns it lives in the DOM (main.ts); it is copied here so the view that
   *  draws the sheets at this offset stays a function of its snapshot. */
  scroll: number;
  /** How far along the piece the page is panned, in pixels from where it
   *  rests on the bars being worked on — positive toward the end. Copied
   *  from its scroller in the DOM the way `scroll` is. */
  pan: number;
  /** The score the lesson is on — null when inactive. Carried here rather
   *  than read off the frame so the steps below and the sheet a view draws
   *  can never be cut from two different scores. */
  score: Score | null;
  /** The bars the lesson is confined to, or null for the whole piece. */
  range: BarRange | null;
  /** The bars a sheet should show: the range when there is one, else the
   *  bar the cursor stands in — so the page turns as the learner plays. */
  focus: BarRange;
  /** The steps the cursor may visit. The whole score when there is no
   *  range; `index` is always within it (or at `last`, finished). */
  span: Span;
  /** 0-based, absolute in the score's steps; equals `total` exactly when
   *  the score is finished. */
  index: number;
  total: number;
  /** The step to play now — null when finished or inactive. */
  current: Step | null;
  /** The one step of look-ahead. Null at the end. */
  next: Step | null;
  /** Arrows from what is down now to what is struck next, already paired. */
  moves: readonly Move[];
  /** Attacks not yet satisfied: not struck since the step began, or struck
   *  and since let go. What the view lights as "press these". */
  pending: ReadonlySet<Pitch>;
  /** Sustains the learner has let go of — the only blocking mistake. */
  dropped: ReadonlySet<Pitch>;
  /** Held, no part of this step, and not a leftover from the step you just
   *  played. A genuine wrong note. Reported, never blocking. */
  wrong: ReadonlySet<Pitch>;
  /** Held, and the current step expects it LIFTED — a finger still resting
   *  on a key you correctly played a moment ago.
   *
   *  This exists because without it every correct press flashed red: the
   *  step completes on the press, the cursor advances, and the key still
   *  under your finger is instantly "a key this step never asked for".
   *  Playing a note right is not a mistake, so it does not get the mistake
   *  colour. Grace lasts exactly one step — `Step.release` only names the
   *  step you just left — after which a key you never lifted has had a
   *  whole step to be lifted and is honestly wrong. */
  stale: ReadonlySet<Pitch>;
  /** Pitches struck CORRECTLY a moment ago, each mapped to how far through
   *  its acknowledgment it is: 0 at the instant of the press, 1 when the
   *  pulse is spent. Expired ones are simply absent, so a view can draw
   *  every entry it is given.
   *
   *  It lives in the state rather than the view because the view could not
   *  compute it: a step completes ON the press that satisfies it, so the
   *  cursor has already moved by the next frame and the key the learner
   *  just got right is, by then, the NEXT step's sustain (green) or a
   *  finger to lift (grey). "You just played this correctly" is a fact
   *  about an instant that has passed, and only the thing that graded the
   *  press was ever there to see it.
   *
   *  It is also the one part of a snapshot that changes with nothing but
   *  time — which is precisely why it cannot be re-derived downstream. */
  hit: ReadonlyMap<Pitch, number>;
  /** The lesson's harmonic analysis, or null for a score that came with
   *  none. The view's harmony bar exists only when this does. */
  chart: Chart | null;
  /** Where the cursor is in that analysis, and what comes after it. Both
   *  null without a chart, and `change` is null once the piece is done. */
  change: ChartEntry | null;
  nextChange: ChartEntry | null;
  /** The non-practised hand's pitches at this step. Always the fact,
   *  never gated by `showOther` — hiding it is the VIEW's decision, and
   *  when it is being auto-played those keys are genuinely down, so a
   *  view that hid it also has to actively suppress the live-press
   *  colour. It can only do that if it is told. */
  other: ReadonlySet<Pitch>;
}

/** User preferences. They outlive a lesson — changing score or hand must
 *  not silently turn the other-hand toggles back off. */
const cfg = {
  hand: "both" as HandFilter,
  showOther: true,
  playOther: true,
  showArrows: false,
  wholeScore: false,
};

/** Not a preference and not lesson state: where the reader has scrolled
 *  to. Outlives a lesson for the same reason the toggles do — changing
 *  hands must not throw the reader back to the first sheet. */
let scroll = 0;
let pan = 0;

interface Session {
  score: Score;
  /** What the score MEANS, when the lesson came with an analysis. Held in
   *  the session rather than passed per call so `setHand`, which restarts
   *  the lesson to re-cut it, cannot silently drop it. */
  chart: Chart | null;
  steps: Steps;
  /** The notes NOT being practised, kept once rather than refiltered per
   *  frame; `hand` changes rebuild the whole session anyway. */
  rest: readonly Note[];
  /** The isolated bars and the steps inside them. `span` is derived from
   *  `range` once, here, rather than per frame — and re-derived by
   *  `setHand`, which re-cuts the steps it indexes. */
  range: BarRange | null;
  span: Span;
  index: number;
  seek: (t: number) => void;
}

/** How long a correct strike stays acknowledged, in ms. Long enough to see
 *  at a glance, short enough that a run of quick notes reads as a run of
 *  separate pulses rather than one smear. */
const HIT_MS = 620;

/** Wall clock, named so tests can pin it. Deliberately NOT the transport:
 *  in practice mode the learner IS the transport, so score time stands
 *  still between presses and a decay driven off it would never move. */
const nowMs = (): number => performance.now();

let session: Session | null = null;
let fresh = new Set<Pitch>(); // struck since this step began
/** pitch -> nowMs() of the press that was graded correct. Bounded by the
 *  keyboard (one entry per pitch, overwritten), so it never grows. */
const hits = new Map<Pitch, number>();
let auto: Voice[] = []; // the other hand's voices, ours to release
let cachedMoves: readonly Move[] = [];
let unsubscribe: (() => void)[] = [];

/** True while we are pressing or releasing the other hand ourselves.
 *  LiveKeys notifies synchronously from inside press(), before we have the
 *  handle to compare against, so the guard — not handle identity — is what
 *  keeps the cursor from grading its own accompaniment. */
let reconciling = false;

/** The step at `i` if the cursor is allowed there — inside the span — else
 *  null. Every "which step is this" question goes through here, so a step
 *  outside an isolated range can never be current, next, or an arrow's
 *  origin by accident. */
const step = (i: number): Step | null => {
  if (!session) return null;
  const { first, last } = session.span;
  return i >= first && i < last ? session.steps.steps[i] : null;
};
const liveAuto = (): Voice[] => auto.filter(LiveKeys.isLive);

/** The whole score as a span: every step, and `total` as its end. */
const wholeSpan = (steps: Steps): Span => ({ first: 0, last: steps.steps.length });

// ---------------------------------------------------------------------
// the other hand: sounding pitches at a step, and the diff-reconcile that
// presses them. Identical in shape to PerfState.trigger — release what we
// no longer want, press what we now do, leave common tones alone.
// ---------------------------------------------------------------------
const otherAt = (s: Step | null): Set<Pitch> => {
  if (!session || !s) return new Set();
  return new Set(
    session.rest
      .filter((n) => n.onset <= s.at && n.onset + n.duration > s.at)
      .map((n) => n.pitch),
  );
};

function reconcileOther(want: ReadonlySet<Pitch>): void {
  reconciling = true;
  try {
    const kept: Voice[] = [];
    for (const v of liveAuto()) {
      if (want.has(v.pitch)) kept.push(v);
      else LiveKeys.release(v);
    }
    const down = new Set(kept.map((v) => v.pitch));
    for (const p of want) if (!down.has(p)) kept.push(LiveKeys.press(p));
    auto = kept;
  } finally {
    reconciling = false;
  }
}

// ---------------------------------------------------------------------
// moving the cursor
// ---------------------------------------------------------------------
function enter(i: number): void {
  if (!session) return;
  const { first, last } = session.span;
  // where the cursor is coming FROM, for the arrows below. Ordinarily the
  // step before; on a wrap, the range's last step — that is where the
  // fingers actually are.
  let from = i - 1;
  if (i < first) i = first;
  if (i >= last) {
    // past the end of an isolated range the cursor comes round to the
    // start; past the end of the whole piece it stops, finished.
    if (session.range !== null && last > first) {
      from = last - 1;
      i = first;
    } else {
      i = last;
    }
  }
  session.index = i;
  fresh = new Set();

  // arrows run from the keys the learner's fingers are ON to the keys this
  // step asks for — the transition being played RIGHT NOW, not the one
  // after it. The cursor advances the instant a step is satisfied, so the
  // keys still down are the PREVIOUS step's sounding set; pairing forwards
  // from the current step instead drew every arrow one step ahead of the
  // hand, starting on a key nobody was touching. The first step gets none
  // — of the piece, or of a range just entered — because nothing is down
  // yet, so there is no honest place for an arrow to start. (`step` says
  // null for anything outside the span, which is what makes that true for
  // a range as well as for step 0.)
  const prev = step(from);
  const cur = step(session.index);
  cachedMoves = prev && cur ? movesBetween(prev, cur) : [];

  // the clock follows the cursor: past the last step we park at the end so
  // the other views show a finished piece rather than jumping to the top.
  // A range with no steps in it parks at the range's own start instead.
  session.seek(
    cur ? cur.at
    : session.range ? session.score.bars[session.range.from].start
    : session.score.duration,
  );
  reconcileOther(cfg.playOther ? otherAt(cur) : new Set());
}

/** The step after the current one, within the span. At the end of an
 *  isolated range it is the range's first step — the loop's honest answer
 *  to "then what" — and at the end of the whole piece there is none. */
function nextOf(): Step | null {
  if (!session || step(session.index) === null) return null;
  const { first, last } = session.span;
  const i = session.index + 1;
  if (i < last) return step(i);
  return session.range !== null ? step(first) : null;
}

/** Attacks the learner still owes: never struck this step, or struck and
 *  since released. Recomputed rather than tracked, so a release is handled
 *  by the same expression that handles a press. */
function pendingOf(cur: Step, held: ReadonlySet<Pitch>): Set<Pitch> {
  const out = new Set<Pitch>();
  for (const n of cur.attack) if (!fresh.has(n.pitch) || !held.has(n.pitch)) out.add(n.pitch);
  return out;
}

const droppedOf = (cur: Step, held: ReadonlySet<Pitch>): Set<Pitch> =>
  new Set(cur.sustain.map((n) => n.pitch).filter((p) => !held.has(p)));

/** Re-test the current step and advance if it is done. Called on every
 *  press, which is what makes "all down at once" mean at the instant of
 *  the last press rather than at some sampled frame. Only a press can ever
 *  complete a step — a release only makes the pending set larger — which
 *  is why LiveKeys publishes attacks and nothing else. */
function check(): void {
  const cur = session && step(session.index);
  if (!cur) return;
  const held = LiveKeys.held();
  if (pendingOf(cur, held).size > 0) return;
  if (droppedOf(cur, held).size > 0) return;
  enter(session!.index + 1);
}

// ---------------------------------------------------------------------
// lifecycle
// ---------------------------------------------------------------------

/** Start a lesson on `score`. `seek` is how the cursor moves the clock —
 *  passed in so this module never imports the clock singleton. `chart` is
 *  the score's harmonic analysis when it has one; a file-loaded score
 *  passes nothing and the harmony bar stays away. Calling begin again (a
 *  new file, a hand change) restarts cleanly. */
function begin(score: Score, seek: (t: number) => void, chart: Chart | null = null): void {
  end();
  const steps = makeSteps(score, cfg.hand);
  session = {
    score, chart, steps, rest: otherHand(score, cfg.hand),
    range: null, span: wholeSpan(steps), index: 0, seek,
  };
  unsubscribe = [
    LiveKeys.onPress((v) => {
      if (reconciling || !session) return;
      // graded BEFORE `fresh` and `check()` run, because both destroy the
      // evidence: `fresh` is what makes the pitch stop being pending, and
      // `check()` may move the cursor to a step that never wanted it.
      const cur = step(session.index);
      if (cur && pendingOf(cur, LiveKeys.held()).has(v.pitch)) hits.set(v.pitch, nowMs());
      fresh.add(v.pitch);
      check();
    }),
  ];
  enter(0);
}

/** Stop, and put back everything we are holding. */
function end(): void {
  for (const off of unsubscribe) off();
  unsubscribe = [];
  reconcileOther(new Set());
  auto = [];
  fresh = new Set();
  hits.clear();
  cachedMoves = [];
  session = null;
}

/** Switch hands mid-lesson without losing your place: re-cut the score,
 *  keep the isolated bars, then land on the first step at or after the
 *  one you were on. */
function setHand(hand: HandFilter): void {
  cfg.hand = hand;
  if (!session) return;
  const at = step(session.index)?.at ?? session.score.duration;
  const { score, seek, chart, range } = session;
  begin(score, seek, chart);
  if (range) setRange(range);
  enter(stepAt(session!.steps.steps, at));
}

/** Confine the lesson to `range`, or free it with null. The cursor keeps
 *  its place when that place is inside the new range, and otherwise goes
 *  to the range's first step — isolating the bar you are in must not throw
 *  you out of it. */
function setRange(range: BarRange | null): void {
  if (!session) return;
  session.range = range && clampRange(range, session.score.bars.length);
  session.span = session.range
    ? spanOf(session.steps.steps, session.score.bars, session.range)
    : wholeSpan(session.steps);
  const { first, last } = session.span;
  if (session.index < first || session.index >= last) enter(first);
}

/** Isolate one bar, or — with `extend` — grow the current range to reach
 *  it. The shape a click on a bar has: plain click selects, shift-click
 *  extends. A click with nothing isolated yet extends from nothing, which
 *  is the same as selecting. */
function isolate(bar: number, extend = false): void {
  if (!session) return;
  const r = session.range;
  setRange(extend && r ? { from: Math.min(r.from, bar), to: Math.max(r.to, bar) } : { from: bar, to: bar });
}

/** Move the cursor by hand — back to see a transition again, forward to
 *  skip one. Bounded by the span like every other move: stepping back
 *  from the first step stays put, and stepping past the last wraps for a
 *  range and finishes for the whole piece. */
function stepBy(delta: number): void {
  if (session) enter(session.index + delta);
}

function setShowOther(on: boolean): void {
  cfg.showOther = on;
}

function setShowArrows(on: boolean): void {
  cfg.showArrows = on;
}

function setWholeScore(on: boolean): void {
  cfg.wholeScore = on;
}

function setScroll(y: number): void {
  scroll = Math.max(0, y);
}

/** Negative is toward the start of the piece: the rest is mid-strip. */
function setPan(x: number): void {
  pan = x;
}

function setPlayOther(on: boolean): void {
  cfg.playOther = on;
  if (session) reconcileOther(on ? otherAt(step(session.index)) : new Set());
}

/** Scrub: land on the step at or after `t`. The one place score time gets
 *  to move the cursor rather than the other way round. */
function seekToTime(t: number): void {
  if (session) enter(stepAt(session.steps.steps, t));
}

const reset = (): void => enter(session?.span.first ?? 0);

const snapshot = (): PracticeSnapshot => {
  const cur = session && step(session.index);
  // the bar the sheet should open to: the isolated bars, or the one the
  // cursor is standing in. A finished piece shows its last bar, and an
  // empty range shows itself.
  const here = session && barAt(session.score, cur ? cur.at : session.score.duration).index;
  const focus: BarRange = session
    ? session.range ?? { from: here!, to: here! }
    : { from: 0, to: 0 };
  const held = LiveKeys.held();
  const autoPitches = new Set(liveAuto().map((v) => v.pitch));
  const mine = new Set<Pitch>(cur ? soundingIn(cur).map((n) => n.pitch) : []);
  // keys this step wants lifted — the previous step's, still under a finger
  const leaving = new Set<Pitch>(cur ? cur.release.map((n) => n.pitch) : []);
  // our own accompaniment is not the learner playing at all
  const learner = [...held].filter((p) => !mine.has(p) && !autoPitches.has(p));
  // ages, not timestamps: a view that had to subtract a clock reading of
  // its own could disagree with this one about when "now" is.
  const t = nowMs();
  const hit = new Map<Pitch, number>();
  for (const [p, when] of hits) {
    const age = (t - when) / HIT_MS;
    if (age >= 0 && age < 1) hit.set(p, age);
  }
  return {
    active: session !== null,
    hand: cfg.hand,
    showOther: cfg.showOther,
    playOther: cfg.playOther,
    showArrows: cfg.showArrows,
    wholeScore: cfg.wholeScore,
    scroll,
    pan,
    score: session?.score ?? null,
    range: session?.range ?? null,
    focus,
    span: session?.span ?? { first: 0, last: 0 },
    index: session?.index ?? 0,
    total: session?.steps.steps.length ?? 0,
    current: cur,
    next: nextOf(),
    moves: cachedMoves,
    pending: cur ? pendingOf(cur, held) : new Set(),
    dropped: cur ? droppedOf(cur, held) : new Set(),
    wrong: new Set(learner.filter((p) => !leaving.has(p))),
    stale: new Set(learner.filter((p) => leaving.has(p))),
    hit,
    chart: session?.chart ?? null,
    // by score time, off the Step's own `at` — the cursor and the analysis
    // agree because neither keeps a position the other has to be told about.
    change: session?.chart && cur ? entryAt(session.chart, cur.at) : null,
    nextChange: session?.chart && cur ? entryAfter(session.chart, cur.at) : null,
    other: session ? otherAt(cur) : new Set(),
  };
};

export const PracticeState = {
  begin,
  end,
  setHand,
  setShowOther,
  setPlayOther,
  setShowArrows,
  setWholeScore,
  setScroll,
  setPan,
  setRange,
  isolate,
  step: stepBy,
  seekToTime,
  reset,
  snapshot,
};
