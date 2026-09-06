/* Solver: the shared shortest path over candidate configurations. Tested
   against a FAKE instrument whose configurations are single letters and whose
   costs come from a table, so that nothing here depends on a key, a fret, or
   any instrument existing at all — which is the property the seam is for. */
import { describe, it, expect } from "vitest";
import { Core } from "../core";
import { statesOf, type State } from "../states";
import { planFor, type Instrument } from "./solver";

/** One state per pitch, struck in order and never overlapping. */
const line = (...pitches: number[]): State[] =>
  statesOf(Core.makeScore(pitches.map((pitch, i) => ({ pitch, onset: i, duration: 0.5 }))));

const key = (s: State) => s.notes[0].pitch;

interface Fake {
  cands: (s: State) => string[];
  start?: (to: string) => number;
  step?: (from: string, to: string) => number;
}

const fake = (f: Fake): Instrument<string> => ({
  candidates: f.cands,
  cost: (from, to) => (from === null ? (f.start?.(to) ?? 0) : (f.step?.(from, to) ?? 0)),
  describe: (_from, to, _tr) => to,
});

const configs = <C,>(plan: { config: C | null }[]) => plan.map((p) => p.config);

describe("planFor", () => {
  it("takes the globally cheapest path, not the greedily cheapest first step", () => {
    // "a" is the cheaper opening (0 against 1) and a trap: every move out of
    // it costs 10, while "b" moves on for free. Greedy scores 10, optimal 1.
    const inst = fake({
      cands: () => ["a", "b"],
      start: (to) => (to === "a" ? 0 : 1),
      step: (from, to) => (from === "a" ? 10 : to === "b" ? 0 : 3),
    });
    expect(configs(planFor(line(60, 62), inst))).toEqual(["b", "b"]);
  });

  it("still prefers the cheap opening when nothing punishes it later", () => {
    // The same instrument minus the trap, to show the previous test measured
    // the lookahead and not a bias against the first candidate.
    const inst = fake({ cands: () => ["a", "b"], start: (to) => (to === "a" ? 0 : 1) });
    expect(configs(planFor(line(60, 62), inst))).toEqual(["a", "a"]);
  });

  it("records null for an unplayable state and re-plans the rest from scratch", () => {
    // 62 is unplayable. Continuity would keep "a" across the gap; a fresh
    // start prefers "b", because that is what cost(null, ·) says.
    const inst = fake({
      cands: (s) => (key(s) === 62 ? [] : ["a", "b"]),
      start: (to) => (to === "b" ? 0 : 5),
      step: (from, to) => (from === to ? 0 : 100),
    });
    const plan = planFor(line(60, 62, 64, 65), inst);
    expect(configs(plan)).toEqual(["b", null, "b", "b"]);
    expect(plan.map((p) => p.state)).toHaveLength(4);
  });

  it("plans a segment before an unplayable state on its own terms", () => {
    // The same trap, now inside the first segment: it must still be seen,
    // even though the gap means its choice cannot reach the far side — where
    // planning starts over and takes the cheap opening the trap ruled out.
    const inst = fake({
      cands: (s) => (key(s) === 64 ? [] : ["a", "b"]),
      start: (to) => (to === "a" ? 0 : 1),
      step: (from, to) => (from === "a" ? 10 : to === "b" ? 0 : 3),
    });
    expect(configs(planFor(line(60, 62, 64, 65), inst))).toEqual(["b", "b", null, "a"]);
  });

  it("returns the cheapest candidate for a single state", () => {
    const inst = fake({ cands: () => ["a", "b", "c"], start: (to) => (to === "c" ? -1 : 1) });
    expect(configs(planFor(line(60), inst))).toEqual(["c"]);
  });

  it("returns null for a lone unplayable state, and nothing at all for no states", () => {
    const inst = fake({ cands: () => [] });
    expect(configs(planFor(line(60), inst))).toEqual([null]);
    expect(planFor([], inst)).toEqual([]);
  });

  it("asks for a hand position of null exactly at the start of each segment", () => {
    const seen: (string | null)[] = [];
    const inst = fake({ cands: (s) => (key(s) === 62 ? [] : ["a"]) });
    const spy: Instrument<string> = { ...inst, cost: (from, to) => (seen.push(from), inst.cost(from, to)) };
    planFor(line(60, 62, 64, 65), spy);
    expect(seen).toEqual([null, null, "a"]);
  });

  it("keeps one entry per state, paired with the state it plans", () => {
    const states = line(60, 62, 64);
    const plan = planFor(states, fake({ cands: () => ["a"] }));
    expect(plan.map((p) => p.state)).toEqual(states);
  });

  it("scores the whole sequence, so a late constraint changes the first choice", () => {
    // Every state but the last offers both; the last offers only "b". Staying
    // put is free and switching costs 1, so the only zero-cost plan commits to
    // "b" four states before the reason for it appears.
    const inst = fake({
      cands: (s) => (key(s) === 67 ? ["b"] : ["a", "b"]),
      step: (from, to) => (from === to ? 0 : 1),
    });
    expect(configs(planFor(line(60, 62, 64, 65, 67), inst))).toEqual(["b", "b", "b", "b", "b"]);
  });
});
