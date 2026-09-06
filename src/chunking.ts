/* ====================================================================
   CHUNKING — the instruction list as gestures rather than steps. A pure
   query over the state sequence, a sibling of states.ts: it imports only
   states.ts and knows nothing about keys, frets, hands or prose.

   With time gone, a piece is a STRING over an alphabet of states, so
   "describe this figure once and say it happens three times" is plain
   repeated-substring detection. The Chopin prelude has 70 distinct states
   across 98, which is the redundancy this exploits.

   THE STRING IS THE TRANSITIONS, NOT THE STATES, and that is the one
   decision the whole module rests on. An instruction IS a transition, so
   chunking transitions makes the tree exactly cover the instruction list:
   `expand` reproduces the original index sequence, with nothing invented
   and nothing dropped. Chunking states instead would leave every repeat
   one transition short in its final copy — the figure's own return to its
   start, which the last copy never performs — and no honest rendering of
   that exists. A figure "repeated three times" is therefore three times
   its transitions, which means it comes back to where it began.

   TWO KEYINGS, ONE SEARCH. The exact pass matches literal restatements;
   the interval pass matches a figure restated at another pitch. They are
   not two passes over the sequence, because every exact repeat is also an
   interval repeat of at least the same length: one left-to-right scan that
   considers both keyings and prefers the longest match — exact winning
   ties — subsumes running them in series, and additionally stops a short
   literal repeat from hiding a long transposed one.
   ==================================================================== */
import { transitionsOf, type State, type Transition } from "./states";

/** One instruction: a single transition, with the states it joins. */
export interface Step {
  readonly kind: "step";
  /** Index into `transitionsOf(states)`, for the FIRST statement of any
   *  repeat containing it. `expand` recovers the rest. */
  readonly index: number;
  readonly from: State;
  readonly to: State;
  readonly transition: Transition;
}

/** A figure and how many times it is restated. */
export interface Repeat {
  readonly kind: "repeat";
  /** The first transition covered — the start of the first statement. */
  readonly index: number;
  /** Statements, always at least 2. */
  readonly count: number;
  /** Semitones each statement sits above the first; length is `count` and
   *  the first entry is always 0. All zeroes means a literal repeat; the
   *  interval pass is what produces anything else. */
  readonly offsets: readonly number[];
  readonly body: readonly Chunk[];
}

/** The instruction list as a tree: a summary line, then its detail. */
export type Chunk = Step | Repeat;

export interface ChunkOptions {
  /** Match figures restated at another pitch. Off leaves only literal
   *  repeats, which is what makes "the interval pass found this, the exact
   *  pass did not" a statement a test can check. Defaults to on. */
  readonly transposed?: boolean;
}

/** How many transitions a chunk covers once expanded. */
export function chunkLength(c: Chunk): number {
  return c.kind === "step" ? 1 : c.count * bodyLength(c.body);
}

const bodyLength = (body: readonly Chunk[]): number =>
  body.reduce((sum, c) => sum + chunkLength(c), 0);

/** The transition indices a tree covers, in playing order. Chunking is a
 *  regrouping and never a filter, so over a whole piece this is exactly
 *  `0 .. transitions.length - 1` — the invariant that proves no content was
 *  lost, and the way a renderer walks the later statements of a repeat. */
export function expand(chunks: readonly Chunk[]): number[] {
  const out: number[] = [];
  const walk = (cs: readonly Chunk[], shift: number): void => {
    for (const c of cs) {
      if (c.kind === "step") {
        out.push(c.index + shift);
        continue;
      }
      const len = bodyLength(c.body);
      for (let m = 0; m < c.count; m++) walk(c.body, shift + m * len);
    }
  };
  walk(chunks, 0);
  return out;
}

// A state's key. `repeat` is part of it because "play that chord four times"
// and "play it twice" are different gestures, not one gesture counted wrong.
// Pitches are written relative to `root`: 0 gives the literal key, the
// from-state's lowest pitch gives the transposition-invariant one.
const stateKey = (s: State, root: number): string =>
  `${s.notes.map((n) => n.pitch - root).join(",")}*${s.repeat}`;

const rootOf = (s: State): number => (s.notes.length ? s.notes[0].pitch : 0);

/** The state sequence regrouped into gestures. */
export function chunksOf(states: readonly State[], opts: ChunkOptions = {}): Chunk[] {
  const transitions = transitionsOf(states);
  const roots = states.map(rootOf);

  // Keying a TRANSITION, not a state, and both halves of a transposed key
  // share the from-state's root. That shared root is what makes a matched
  // run coherent for free: adjacent transitions overlap on a state, so the
  // offset one of them implies is forced to equal the next one's, and no
  // separate consistency check is needed.
  const exact = transitions.map((_, i) => `${stateKey(states[i], 0)}>${stateKey(states[i + 1], 0)}`);
  const shape = transitions.map(
    (_, i) => `${stateKey(states[i], roots[i])}>${stateKey(states[i + 1], roots[i])}`,
  );
  const keyings = opts.transposed === false ? [exact] : [exact, shape];

  /** The best tandem repeat starting exactly at `i`, or null. "Best" is the
   *  longest coverage; ties go to the exact keying and then to the shorter
   *  period, so the tree is a function of the input alone. */
  const bestRepeat = (i: number, hi: number): { period: number; count: number } | null => {
    const rem = hi - i;
    let best: { period: number; count: number; coverage: number } | null = null;
    for (const keys of keyings) {
      for (let p = 1; p * 2 <= rem; p++) {
        if (keys[i] !== keys[i + p]) continue; // cheap reject before the full compare
        let k = 1;
        while ((k + 1) * p <= rem && copyMatches(keys, i, p, k)) k++;
        if (k >= 2 && (!best || p * k > best.coverage)) best = { period: p, count: k, coverage: p * k };
        if (best?.coverage === rem) break; // covering everything cannot be beaten
      }
      if (best?.coverage === rem) break;
    }
    return best && { period: best.period, count: best.count };
  };

  const build = (lo: number, hi: number): Chunk[] => {
    const out: Chunk[] = [];
    let i = lo;
    while (i < hi) {
      const rep = bestRepeat(i, hi);
      if (!rep) {
        out.push({
          kind: "step",
          index: i,
          from: states[i],
          to: states[i + 1],
          transition: transitions[i],
        });
        i++;
        continue;
      }
      const { period, count } = rep;
      out.push({
        kind: "repeat",
        index: i,
        count,
        // Recovered from the states rather than tracked through the search:
        // the offset of a statement is simply where its first state sits.
        offsets: Array.from({ length: count }, (_, m) => roots[i + m * period] - roots[i]),
        // A statement can hold gestures of its own — a figure that is itself
        // two restatements of a smaller one. The body is strictly shorter
        // than the region, so the recursion terminates.
        body: build(i, i + period),
      });
      i += period * count;
    }
    return out;
  };

  return build(0, transitions.length);
}

const copyMatches = (keys: readonly string[], i: number, p: number, k: number): boolean => {
  for (let j = 0; j < p; j++) if (keys[i + k * p + j] !== keys[i + j]) return false;
  return true;
};

export const Chunking = { chunksOf, chunkLength, expand };
