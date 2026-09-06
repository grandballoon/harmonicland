/* Chunking: the instruction list regrouped into gestures. Hand-built figures
   pin each rule; the Chopin prelude is the golden oracle, and its answer is a
   measured negative — see the last block, and spoken-score.md's Task 6. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { Core } from "./core";
import { MusicxmlIn } from "./inputs/musicxml";
import { statesOf, transitionsOf, type State } from "./states";
import { chunksOf, chunkLength, expand, type Chunk } from "./chunking";

/** The state sequence for a list of strikes, one chord per unit of time.
 *  Nothing sustains, so passing a chord twice in a row is how a `repeat` of 2
 *  is built — exactly as statesOf run-length-encodes a real score. */
const seq = (...strikes: number[][]): State[] =>
  statesOf(
    Core.makeScore(
      strikes.flatMap((ps, i) => ps.map((pitch) => ({ pitch, onset: i, duration: 0.5 }))),
    ),
  );

const kinds = (cs: readonly Chunk[]) => cs.map((c) => c.kind);
const covered = (cs: readonly Chunk[]) => cs.reduce((n, c) => n + chunkLength(c), 0);
const identity = (n: number) => Array.from({ length: n }, (_, i) => i);

/** Every chunking is a regrouping: the tree must cover exactly the transition
 *  list, in order, once each. Asserted on every fixture rather than sampled,
 *  because "no loss of content" is the whole contract. */
const isLossless = (states: readonly State[], cs: readonly Chunk[]) =>
  expect(expand(cs)).toEqual(identity(transitionsOf(states).length));

describe("chunksOf", () => {
  it("collapses a four-chord figure played three times into one chunk", () => {
    // A figure repeated three times is three times its TRANSITIONS, which
    // means it comes back to where it began — hence the trailing A.
    const A = [60, 64, 67];
    const B = [62, 65, 69];
    const C = [59, 62, 67];
    const D = [60, 65, 69];
    const states = seq(A, B, C, D, A, B, C, D, A, B, C, D, A);
    const tree = chunksOf(states);

    expect(tree).toHaveLength(1);
    const rep = tree[0];
    if (rep.kind !== "repeat") throw new Error("expected a repeat");
    expect(rep.count).toBe(3);
    expect(rep.index).toBe(0);
    expect(rep.offsets).toEqual([0, 0, 0]); // a literal restatement
    expect(kinds(rep.body)).toEqual(["step", "step", "step", "step"]);
    expect(chunkLength(rep)).toBe(12);
    isLossless(states, tree);
  });

  it("stops at the last complete statement when the figure is cut short", () => {
    // The same figure, but the piece leaves before the third statement closes.
    // Two statements, then the truncated remainder spelled out: the tree only
    // ever claims transitions that are actually played.
    const A = [60, 64, 67];
    const B = [62, 65, 69];
    const C = [59, 62, 67];
    const D = [60, 65, 69];
    const states = seq(A, B, C, D, A, B, C, D, A, B, C, D);
    const tree = chunksOf(states);

    expect(kinds(tree)).toEqual(["repeat", "step", "step", "step"]);
    expect((tree[0] as { count: number }).count).toBe(2);
    isLossless(states, tree);
  });

  it("matches a figure restated a minor third higher, which the exact pass cannot", () => {
    const states = seq([60, 64], [62, 65], [64, 67], [63, 67], [65, 68], [67, 70], [66, 70]);
    const tree = chunksOf(states);

    expect(tree).toHaveLength(1);
    const rep = tree[0];
    if (rep.kind !== "repeat") throw new Error("expected a repeat");
    expect(rep.count).toBe(2);
    expect(rep.offsets).toEqual([0, 3]); // the second statement sits a third up
    expect(chunkLength(rep)).toBe(6);
    isLossless(states, tree);

    // ...and nothing here is a literal repeat, so the exact pass alone leaves
    // the sequence untouched. That difference is the interval pass's whole job.
    const literal = chunksOf(states, { transposed: false });
    expect(kinds(literal)).toEqual(["step", "step", "step", "step", "step", "step"]);
    isLossless(states, literal);
  });

  it("returns a non-repeating sequence unchanged, one step per transition", () => {
    const states = seq([60], [62], [65], [71], [67], [61]);
    const tree = chunksOf(states);

    expect(kinds(tree)).toEqual(["step", "step", "step", "step", "step"]);
    expect(tree.map((c) => (c as { index: number }).index)).toEqual([0, 1, 2, 3, 4]);
    const first = tree[0];
    if (first.kind !== "step") throw new Error("expected a step");
    expect(first.from).toBe(states[0]);
    expect(first.to).toBe(states[1]);
    expect(first.transition).toEqual(transitionsOf(states)[0]);
    isLossless(states, tree);
  });

  it("resolves overlapping candidates to the longest, and nests the shorter one", () => {
    // 60 62 60 62 60 65, three times over. A two-transition figure repeats at
    // the head of every statement, so a short repeat and a long one both start
    // at transition 0; the long one wins and the short one survives inside it.
    const bar = [[60], [62], [60], [62], [60], [65]];
    const states = seq(...bar, ...bar, ...bar, [60]);
    const tree = chunksOf(states);

    expect(tree).toHaveLength(1);
    const outer = tree[0];
    if (outer.kind !== "repeat") throw new Error("expected a repeat");
    expect(outer.count).toBe(3);
    expect(chunkLength(outer)).toBe(18);
    expect(kinds(outer.body)).toEqual(["repeat", "step", "step"]);

    const inner = outer.body[0];
    if (inner.kind !== "repeat") throw new Error("expected a nested repeat");
    expect(inner.count).toBe(2);
    expect(chunkLength(inner)).toBe(4);
    isLossless(states, tree);
  });

  it("treats a different number of strikes as a different gesture", () => {
    const X = [55, 59, 62];
    const Y = [57, 60, 64];
    // struck twice each throughout: one figure, restated.
    const even = seq(X, X, Y, Y, X, X, Y, Y, X, X);
    expect(even.map((s) => s.repeat)).toEqual([2, 2, 2, 2, 2]);
    const chunked = chunksOf(even);
    expect(kinds(chunked)).toEqual(["repeat"]);
    expect((chunked[0] as { count: number }).count).toBe(2);

    // the same pitches, but one chord struck three times: "play it twice" and
    // "play it three times" are different instructions, so this is not a repeat.
    const uneven = seq(X, X, Y, Y, X, X, X, Y, Y, X, X);
    expect(uneven.map((s) => s.repeat)).toEqual([2, 2, 3, 2, 2]);
    expect(kinds(chunksOf(uneven))).toEqual(["step", "step", "step", "step"]);
    isLossless(uneven, chunksOf(uneven));
  });

  it("collapses a trill, which is a two-transition figure and nothing more", () => {
    const states = seq([60], [62], [60], [62], [60], [62], [60]);
    const tree = chunksOf(states);

    expect(tree).toHaveLength(1);
    const rep = tree[0];
    if (rep.kind !== "repeat") throw new Error("expected a repeat");
    expect(rep.count).toBe(3);
    expect(kinds(rep.body)).toEqual(["step", "step"]);
    isLossless(states, tree);
  });

  it("has nothing to say about a sequence with no transitions", () => {
    expect(chunksOf([])).toEqual([]);
    expect(chunksOf(seq([60]))).toEqual([]);
  });
});

describe("the Chopin prelude, end to end", () => {
  const chopin = statesOf(
    MusicxmlIn.parse(readFileSync("scores/chopin_prelude_op28_no4.musicxml", "utf8")),
  );
  const trans = transitionsOf(chopin);

  it("finds no repeated gesture in it, and says so rather than inventing one", () => {
    // A measured negative, not a bug. The prelude's adjacent redundancy was
    // already spent in Task 1: 189 onsets became 98 states, so no two states
    // in a row are equal by construction. What is left repeats almost nowhere
    // — 92 of the 97 transitions are unique, the longest repeated run is the
    // three-transition return of bar 1 at transition 47, and that is not
    // adjacent to its original. The piece is a chromatic descent that moves
    // one voice at a time, so no chord is a transposition of its predecessor
    // either, and the interval pass finds no more than the exact one.
    // spoken-score.md carries the full measurement.
    const tree = chunksOf(chopin);
    expect(tree).toHaveLength(97);
    expect(tree.every((c) => c.kind === "step")).toBe(true);
  });

  it("covers every transition exactly once regardless", () => {
    const tree = chunksOf(chopin);
    expect(covered(tree)).toBe(trans.length);
    expect(expand(tree)).toEqual(identity(trans.length));
  });
});
