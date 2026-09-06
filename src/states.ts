/* ====================================================================
   STATES — the score as a state machine. A pure projection of the model,
   a sibling of core.ts: it imports only the types and answers questions
   about a Score, exactly as activeAt does.

   Time is deliberately gone. A piece here is an ordered sequence of
   SONORITIES and the TRANSITIONS between them — no tempo, no beats, no
   note values. That loses rhythm and keeps voice leading, which is the
   trade this exists to make: in the Chopin prelude, 598 notes collapse to
   97 transitions of which over half move a single key. See
   spoken-score.md for the measurement and the reasoning.

   Two rules carry the whole design, and both are easy to get subtly wrong:

   IDENTITY, NOT PITCH. A state holds `Note` objects, never pitch numbers.
   A sustained C and a restruck C are the same pitch and different notes,
   and that difference is the instruction — "keep holding" versus "play it
   again". Set arithmetic over identities gets held/released/pressed right
   for free; set arithmetic over pitches gets it wrong for free.

   REPEATS ARE CONTENT. Consecutive identical sonorities are run-length
   encoded rather than deduplicated. In the Chopin file that absorbs 91 of
   189 onsets — and those repeats ARE the left-hand texture, so dropping
   them would delete the music rather than compress it. A run therefore
   remembers both ends: `notes` is the sonority as first struck, and
   `lastNotes` its final restatement, because only the final statement's
   notes can still be sounding when the next state arrives.
   ==================================================================== */
import type { Note, Score } from "./types";

/** How far apart two onsets may be and still count as struck together.
 *  MusicXML states simultaneity exactly (<chord> shares an onset) and needs
 *  no tolerance; performed MIDI smears a chord over tens of milliseconds and
 *  does. One rule serving both formats is cheaper than two. */
export const ONSET_EPS = 1e-3;

// A note ending exactly as the next strikes is not held. Float drift must not
// turn that into a spurious common tone, so the comparison carries the same
// order of slack core.ts uses on bar boundaries.
const END_EPS = 1e-6;

/** One strike of the score: the notes that begin here, and everything
 *  sounding as a result.
 *
 *  This is the finest grain the model has, and the level at which every
 *  note is accounted for exactly once — a note is `struck` at exactly one
 *  onset, and `sounding` at every onset it rings through. A `State` is a
 *  run of these with the same sonority, which is the right grain for
 *  READING (it is what makes "play that chord four times" one sentence)
 *  and the wrong grain for PLAYING (it is four things you do). So both
 *  exist, and the second is derived from the first. */
export interface Onset {
  /** When the group begins, in seconds. */
  readonly time: number;
  /** The notes that start here, sorted by pitch. Never empty. */
  readonly struck: readonly Note[];
  /** Everything down as a result — `struck` plus whatever is still
   *  ringing from earlier — sorted by pitch. `sounding` minus `struck` is
   *  what the hand is holding rather than playing. */
  readonly sounding: readonly Note[];
}

/** One sonority, plus how many times in a row it was restated. */
export interface State {
  /** The sounding notes as FIRST struck, sorted by pitch ascending. */
  readonly notes: readonly Note[];
  /** The same pitches, as identities of the FINAL restatement. Identical to
   *  `notes` when `repeat` is 1, which is the common case. */
  readonly lastNotes: readonly Note[];
  /** Consecutive identical restatements; always at least 1. */
  readonly repeat: number;
}

/** One voice moving: a released note and the pressed note that replaced it. */
export interface Move {
  readonly from: Note;
  readonly to: Note;
}

/** What changes between two consecutive states.
 *
 *  Three facts matter physically, and they are not the same fact:
 *  a note still RINGING (`held`), a key the hand keeps but strikes again
 *  (`restruck`), and a key the hand must actually move to (everything in
 *  `pressed` that is not in `restruck`). Conflating the first two is the
 *  easy mistake: in the Chopin prelude only 0.41 notes per transition are
 *  genuinely sustained, but a further 1.69 are the same key played again —
 *  so the hand moves far less than `pressed` alone suggests. */
export interface Transition {
  /** Notes still down — the same note, never re-attacked. */
  readonly held: readonly Note[];
  readonly released: readonly Note[];
  readonly pressed: readonly Note[];
  /** The subset of `pressed` at a pitch that was already sounding: the finger
   *  stays on the key and plays it again. `pressed.length - restruck.length`
   *  is the number of keys the hand genuinely has to find. */
  readonly restruck: readonly Note[];
  /** A minimal-displacement matching of released onto pressed. Notes left
   *  unmatched on either side are voices that appeared or vanished. */
  readonly motion: readonly Move[];
}

const byPitch = (a: Note, b: Note): number => a.pitch - b.pitch || a.onset - b.onset;

// run-length equality is by PITCH, not identity — otherwise a restruck chord
// is never equal to itself and nothing ever repeats.
const pitchKey = (ns: readonly Note[]): string => ns.map((n) => n.pitch).join(",");

/** The score as a sequence of strikes — every onset the piece has, in
 *  order, with what each one starts and what it leaves sounding. */
export function onsetsOf(score: Score): Onset[] {
  const notes = score.notes; // Core.makeScore guarantees onset order
  const out: Onset[] = [];
  const active: Note[] = [];
  let i = 0;

  while (i < notes.length) {
    // The group is every note struck within ONSET_EPS of its FIRST member,
    // measured from the group's start and never chained — otherwise a dense
    // tremolo could drift an unbounded number of onsets into one group.
    const t0 = notes[i].onset;
    let j = i;
    while (j < notes.length && notes[j].onset - t0 <= ONSET_EPS) j++;
    const tLast = notes[j - 1].onset;

    // an earlier note is still down only if it outlasts this strike...
    for (let k = active.length - 1; k >= 0; k--)
      if (active[k].onset + active[k].duration <= tLast + END_EPS) active.splice(k, 1);
    // ...and a note struck now is down by definition, however short it is.
    for (let k = i; k < j; k++) active.push(notes[k]);

    out.push({
      time: t0,
      struck: notes.slice(i, j).sort(byPitch),
      sounding: [...active].sort(byPitch),
    });
    i = j;
  }
  return out;
}

/** The score as a run-length-encoded sequence of sonorities: `onsetsOf`
 *  with consecutive identical sonorities folded into one. The fold is the
 *  only thing this adds, which is why it is three lines and not thirty. */
export function statesOf(score: Score): State[] {
  const states: State[] = [];
  for (const { sounding } of onsetsOf(score)) {
    const prev = states[states.length - 1];
    if (prev && pitchKey(prev.notes) === pitchKey(sounding))
      states[states.length - 1] = { notes: prev.notes, lastNotes: sounding, repeat: prev.repeat + 1 };
    else states.push({ notes: sounding, lastNotes: sounding, repeat: 1 });
  }
  return states;
}

/** Which strike the transport is sitting on at time `t`: the last one that
 *  has happened. Before the first, the answer is the first — what is
 *  coming is the useful thing to show — and an empty piece answers -1.
 *
 *  A binary search, sound because `time` rises strictly across the
 *  sequence: each group starts later than the last. */
export function onsetAt(onsets: readonly Onset[], t: number): number {
  if (!onsets.length) return -1;
  let lo = 0;
  let hi = onsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (onsets[mid].time <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** What changes across each adjacent pair. Length is `states.length - 1`. */
export function transitionsOf(states: readonly State[]): Transition[] {
  const out: Transition[] = [];
  for (let i = 1; i < states.length; i++) {
    // The FINAL statement of a run is what can still be sounding when the next
    // state arrives; its first statement may be several restrikes ago.
    const prev = states[i - 1].lastNotes;
    const next = states[i].notes;
    const before = new Set(prev);
    const after = new Set(next);
    const heldPitches = new Set(prev.map((x) => x.pitch));
    const held = next.filter((x) => before.has(x));
    const released = prev.filter((x) => !after.has(x));
    const pressed = next.filter((x) => !before.has(x));
    const restruck = pressed.filter((x) => heldPitches.has(x.pitch));
    out.push({ held, released, pressed, restruck, motion: matchMotion(released, pressed) });
  }
  return out;
}

/** Match released notes onto pressed ones so total semitone displacement is
 *  least. Exported because it is the only real algorithm here and deserves
 *  its own tests.
 *
 *  An optimal matching of points on a line never crosses — swapping a crossed
 *  pair cannot increase |a-b| totals — so an order-preserving DP over both
 *  sides sorted by pitch is exact, and costs O(n*m) instead of a permutation
 *  search. The smaller side is matched completely; the larger side skips,
 *  and its leftovers are the voices that appeared or vanished. */
export function matchMotion(released: readonly Note[], pressed: readonly Note[]): Move[] {
  const R = [...released].sort(byPitch);
  const P = [...pressed].sort(byPitch);
  if (!R.length || !P.length) return [];

  const swap = R.length > P.length;
  const A = swap ? P : R; // every element of A is matched
  const B = swap ? R : P; // B is free to skip
  const n = A.length;
  const m = B.length;

  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(Infinity));
  for (let j = 0; j <= m; j++) dp[0][j] = 0;
  for (let a = 1; a <= n; a++)
    for (let b = 1; b <= m; b++)
      dp[a][b] = Math.min(dp[a][b - 1], dp[a - 1][b - 1] + Math.abs(A[a - 1].pitch - B[b - 1].pitch));

  // Backtrack preferring the skip branch on a tie, which resolves equal-cost
  // matchings toward the lower-pitched partner — arbitrary, but deterministic.
  const moves: Move[] = [];
  let a = n;
  let b = m;
  while (a > 0) {
    if (b > 0 && dp[a][b] === dp[a][b - 1]) {
      b--;
      continue;
    }
    moves.push(swap ? { from: B[b - 1], to: A[a - 1] } : { from: A[a - 1], to: B[b - 1] });
    a--;
    b--;
  }
  return moves.sort((x, y) => x.from.pitch - y.from.pitch || x.to.pitch - y.to.pitch);
}

export const States = { onsetsOf, statesOf, onsetAt, transitionsOf, matchMotion, ONSET_EPS };
