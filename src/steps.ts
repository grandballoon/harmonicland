/* ====================================================================
   STEPS — the score re-cut along a different axis. Every other module in
   this program projects score × TIME; this one projects score × STEP, and
   that is the whole reason practice mode needs a model of its own rather
   than another renderer.

   A Step is one simultaneity: the notes that BEGIN together, plus the ones
   still sounding underneath them. Time survives only as `at`, which the
   cursor seeks the clock to so the rest of the program stays coherent.

   Pure, and a leaf: it names types and imports no runtime at all — no DOM,
   no live state, no core, no outputs. layering.test.ts keeps that true.

   Three decisions live here, each stated because it is a decision and not
   a mechanic:

   1. GROUPING. Notes are grouped when their onsets fall within GROUP_SEC of
      the group's FIRST onset — not of the previous note's. Chaining off the
      previous note would let a dense run swallow itself one 20ms gap at a
      time until an entire passage was a single "chord".

   2. HAND FILTERING. A note with no `hand` belongs to EVERY filter. The
      field is absent when the source had no such grouping (LilyPond), and
      the honest reading of "practise the right hand" on a score with no
      hands is "practise all of it", not "practise nothing". Same standard
      the hands COLORING toggle already sets: such a score behaves
      identically however the toggle is set.

   3. MOVE PAIRING. Which finger goes where is a matching problem, solved
      per hand by an optimal NON-CROSSING assignment over the two sorted
      pitch lists. Non-crossing is not a simplification of optimal — for
      points on a line it IS optimal, and it is also the only answer that
      draws arrows a hand could actually follow.
   ==================================================================== */
import type { Bar, BarRange, Hand, Note, Pitch, Score } from "./types";

/** Which hands the learner is being asked to play. `both` is hands
 *  together; `upper`/`lower` name the same two streams `Hand` does, so
 *  there is no second vocabulary for the same fact. */
export type HandFilter = "both" | "upper" | "lower";

/** Onset-grouping tolerance, in SECONDS — the model's one time unit, so
 *  the name says so rather than inviting a units bug at the one place a
 *  reader would have to convert. 30ms: notes this close together are one
 *  step. Quantized MusicXML lands on exact equality and never needs it; a
 *  MIDI performance capture always does. One owner, asserted by
 *  layering.test.ts. */
export const GROUP_SEC = 0.03;

/** One simultaneity of the score, and the unit the practice cursor counts
 *  in. The three sets are disjoint and together answer the only question a
 *  learner has at this instant: what to strike, what to keep down, what to
 *  let go. */
export interface Step {
  /** Position in `Steps.steps` — carried in the value so a Step passed
   *  around alone can still say where it came from. */
  readonly index: number;
  /** Score seconds at which this step begins: the group's first onset. */
  readonly at: number;
  /** Notes beginning here. These must be freshly struck. */
  readonly attack: readonly Note[];
  /** Notes begun earlier and still sounding. These must stay held. */
  readonly sustain: readonly Note[];
  /** Notes sounding in the PREVIOUS step but not this one. These must be
   *  let go — and they are where most arrows start. */
  readonly release: readonly Note[];
}

/** A score cut into steps for one hand filter. The filter is carried
 *  alongside because a Steps built for the right hand and one built for
 *  both are different values that would otherwise be indistinguishable. */
export interface Steps {
  readonly steps: readonly Step[];
  readonly hand: HandFilter;
}

/** A run of consecutive steps, by index — `first` inclusive, `last`
 *  exclusive, so `last - first` is how many and `last` is where a cursor
 *  that has finished them stands. The steps that fall inside a bar range. */
export interface Span {
  readonly first: number;
  readonly last: number;
}

/** One arrow: a key that is down now, and the key it moves to next. */
export interface Move {
  readonly from: Pitch;
  readonly to: Pitch;
  /** The hand both ends belong to; absent when the source had no hands.
   *  Pairing never crosses hands, so one field describes both ends. */
  readonly hand?: Hand;
}

/** Does this note belong to the hand being practised? See decision 2. */
export const inHand = (n: Note, hand: HandFilter): boolean =>
  hand === "both" || n.hand === undefined || n.hand === hand;

/** The notes of `score` NOT being practised — what the other-hand toggles
 *  show and sound. Complement of `inHand`, so the two can never disagree
 *  about a note and leave it in both or neither. */
export const otherHand = (score: Score, hand: HandFilter): readonly Note[] =>
  score.notes.filter((n) => !inHand(n, hand));

const endOf = (n: Note): number => n.onset + n.duration;

/** Cut a score into steps for one hand.
 *
 *  `sustain` is computed from the note's own duration rather than from
 *  "was it in the previous step", so a note held across four steps appears
 *  in all four — which is what a learner holding it needs to see. A note
 *  ending exactly at a step's onset is NOT sustained into it (half-open
 *  intervals, matching Core.activeAt). */
export function makeSteps(score: Score, hand: HandFilter): Steps {
  const mine = score.notes.filter((n) => inHand(n, hand));

  // group by onset. score.notes is already sorted by onset (Core.makeScore
  // guarantees it) and filtering preserves order, so one pass suffices.
  const groups: Note[][] = [];
  for (const n of mine) {
    const g = groups[groups.length - 1];
    // ...within GROUP_SEC of the group's FIRST onset — see decision 1.
    if (g && n.onset - g[0].onset <= GROUP_SEC) g.push(n);
    else groups.push([n]);
  }

  const steps: Step[] = groups.map((attack, index) => {
    const at = attack[0].onset;
    // sounding but not struck here. `at` is the group's first onset, so a
    // note struck 20ms later in the same group is in `attack`, never here.
    const sustain = mine.filter((n) => n.onset < at && endOf(n) > at);
    return { index, at, attack, sustain, release: [] as readonly Note[] };
  });

  // `release` is the previous step's sounding set minus this one's, so it
  // needs both neighbours and is filled in a second pass rather than woven
  // into the first.
  return {
    hand,
    steps: steps.map((s, i) => {
      if (i === 0) return s;
      const prev = steps[i - 1];
      const now = new Set([...s.attack, ...s.sustain].map((n) => n.id));
      const release = [...prev.attack, ...prev.sustain].filter((n) => !now.has(n.id));
      return { ...s, release };
    }),
  };
}

/** Everything sounding during a step: what the learner's hands hold. */
export const soundingIn = (s: Step): readonly Note[] => [...s.attack, ...s.sustain];

/** The step at or after a score time — how a scrub lands on a step. Returns
 *  `steps.length` when `t` is past the last step, which is exactly the
 *  cursor's "finished" index. */
export function stepAt(steps: readonly Step[], t: number): number {
  const i = steps.findIndex((s) => s.at >= t);
  return i === -1 ? steps.length : i;
}

/** The steps that begin inside a run of bars: every step whose `at` falls
 *  in [bars[from].start, bars[to].end). Both edges are the same `stepAt`
 *  a scrub uses, so "isolate bar 3" and "scrub to the start of bar 3" land
 *  on the same step. A range with no steps in it (a bar of rests, or of
 *  the other hand only) comes back empty with `first === last`. */
export function spanOf(steps: readonly Step[], bars: readonly Bar[], range: BarRange): Span {
  const from = bars[Math.max(0, Math.min(range.from, bars.length - 1))];
  const to = bars[Math.max(0, Math.min(range.to, bars.length - 1))];
  return { first: stepAt(steps, from.start), last: stepAt(steps, to.end) };
}

/** Pair the keys held during `current` with the keys struck in `next`, one
 *  arrow each. Hands are matched separately (decision 3), so a right-hand
 *  arrow can never point at a left-hand key; notes with no hand form their
 *  own group and match among themselves.
 *
 *  Attacks with no partner get no Move — the view still highlights them,
 *  it just has nothing honest to draw an arrow from. */
export function movesBetween(current: Step, next: Step): readonly Move[] {
  const byHand = new Map<Hand | "none", { from: Pitch[]; to: Pitch[] }>();
  const bucket = (h: Hand | undefined) => {
    const k = h ?? "none";
    let b = byHand.get(k);
    if (!b) byHand.set(k, (b = { from: [], to: [] }));
    return b;
  };
  for (const n of soundingIn(current)) bucket(n.hand).from.push(n.pitch);
  for (const n of next.attack) bucket(n.hand).to.push(n.pitch);

  const out: Move[] = [];
  for (const [k, { from, to }] of byHand) {
    const hand = k === "none" ? undefined : k;
    // dedupe: two voices on one pitch are one key, and one key is one arrow.
    const f = [...new Set(from)].sort((a, b) => a - b);
    const t = [...new Set(to)].sort((a, b) => a - b);
    for (const [i, j] of pairSorted(f, t))
      out.push({ from: f[i], to: t[j], ...(hand !== undefined && { hand }) });
  }
  // one stable order regardless of Map iteration, so markup is deterministic.
  return out.sort((a, b) => a.from - b.from || a.to - b.to);
}

/** Optimal non-crossing matching of two sorted pitch lists: choose which
 *  min(|a|,|b|) pairs to make so total |a[i] - b[j]| is least, with i and j
 *  both increasing. A straight O(n·m) DP — the lists are a hand's worth of
 *  notes, so the table is a handful of cells.
 *
 *  Ties break toward the EARLIER index (the `<=` below), which is what
 *  makes the result a function of the inputs alone and the markup
 *  byte-identical across runs. */
function pairSorted(a: readonly Pitch[], b: readonly Pitch[]): [number, number][] {
  const n = a.length;
  const m = b.length;
  const want = Math.min(n, m);
  if (want === 0) return [];

  // cost[i][j] = least total distance pairing a[i..] with b[j..], making as
  // many pairs as still fit. INF marks "cannot make enough pairs from here".
  const INF = Infinity;
  const cost: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(INF));
  for (let i = n; i >= 0; i--)
    for (let j = m; j >= 0; j--) {
      const left = Math.min(n - i, m - j); // pairs still makeable
      if (left === 0) { cost[i][j] = 0; continue; }
      const take = Math.abs(a[i] - b[j]) + cost[i + 1][j + 1];
      // skipping is only allowed while enough of the other list remains
      const skipA = n - i > left ? cost[i + 1][j] : INF;
      const skipB = m - j > left ? cost[i][j + 1] : INF;
      cost[i][j] = Math.min(take, skipA, skipB);
    }

  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    const left = Math.min(n - i, m - j);
    const take = Math.abs(a[i] - b[j]) + cost[i + 1][j + 1];
    if (take <= cost[i][j]) { pairs.push([i, j]); i++; j++; continue; }
    if (n - i > left && cost[i + 1][j] === cost[i][j]) i++;
    else j++;
  }
  return pairs;
}

export const StepModel = { makeSteps, movesBetween, inHand, otherHand, soundingIn, stepAt, spanOf };
