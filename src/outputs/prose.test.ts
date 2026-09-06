/* Prose: the assembly of states, chunks, a plan and an instrument into a
   list of sentences. A fake instrument carries the unit assertions, so what
   is tested here is the ASSEMBLY and never the English — the piano's and the
   guitar's own tests own their wording. The Chopin prelude is the golden
   oracle, and its two answers (98 lines on a piano, 8 of them unplayable on
   a guitar) are the same numbers Tasks 4 and 7 measured. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { Core } from "../core";
import { MusicxmlIn } from "../inputs/musicxml";
import { statesOf, type State } from "../states";
import { chunksOf } from "../chunking";
import { planFor, type Instrument } from "../instruments/solver";
import { piano } from "../instruments/piano";
import { guitar } from "../instruments/guitar";
import { proseFor, proseOf, type Line } from "./prose";

/** One chord per unit of time, nothing sustaining — the same fixture shape
 *  chunking.test.ts uses, so a figure here is a figure there. */
const seq = (...strikes: number[][]): State[] =>
  statesOf(
    Core.makeScore(
      strikes.flatMap((ps, i) => ps.map((pitch) => ({ pitch, onset: i, duration: 0.5 }))),
    ),
  );

/** An instrument that can hold anything and says only what it was given, so
 *  a wrong `from`, `to` or transition shows up as a wrong string. `unplayable`
 *  is the set of state sizes it refuses, which is how the null path is
 *  reached without contriving a seven-note chord. */
const fake = (unplayable: number[] = []): Instrument<string> => ({
  candidates: (s) => (unplayable.includes(s.notes.length) ? [] : [s.notes.map((n) => n.pitch).join("-")]),
  cost: () => 0,
  describe: (from, to, tr) => `${from ?? "-"}=>${to} held${tr.held.length} pressed${tr.pressed.length}`,
});

const texts = (lines: readonly Line[]) => lines.map((l) => l.text);
const kinds = (lines: readonly Line[]) => lines.map((l) => l.kind);

const prose = (states: readonly State[], inst: Instrument<string>): Line[] =>
  proseOf(planFor(states, inst), chunksOf(states), inst);

describe("proseOf — the opening", () => {
  it("gives the first state a line of its own, with nothing to move from", () => {
    const lines = prose(seq([60, 64], [62, 65]), fake());
    expect(lines[0].kind).toBe("start");
    expect(lines[0].state).toBe(0);
    expect(lines[0].depth).toBe(0);
    // no previous configuration, and every note of the sonority is newly struck
    expect(lines[0].text).toBe("-=>60-64 held0 pressed2");
  });

  it("returns nothing at all for an empty score", () => {
    expect(prose(seq(), fake())).toEqual([]);
  });
});

describe("proseOf — one line per instruction", () => {
  it("emits the opening plus one line per transition, in order", () => {
    // deliberately not a sequence: 60-62-64 would be one interval figure
    // restated, and chunking would rightly summarise it into a `figure`.
    const states = seq([60], [62], [67]);
    const lines = prose(states, fake());
    expect(kinds(lines)).toEqual(["start", "step", "step"]);
    expect(lines.map((l) => l.state)).toEqual([0, 1, 2]);
    // each step is described from the PREVIOUS state's configuration
    expect(texts(lines).slice(1)).toEqual([
      "60=>62 held0 pressed1",
      "62=>67 held0 pressed1",
    ]);
  });

  it("says nothing extra about a repeated chord — the state carries the count", () => {
    // Three strikes of one chord are one state, so they are one line: the
    // instrument's own `describe` is what says "played three times".
    const lines = prose(seq([60, 64], [60, 64], [60, 64], [62, 65]), fake());
    expect(kinds(lines)).toEqual(["start", "step"]);
  });
});

describe("proseOf — repeated figures", () => {
  const A = [60, 64, 67];
  const B = [62, 65, 69];
  const C = [59, 62, 67];
  const D = [60, 65, 69];

  it("summarises a literal repeat once, then details its first statement", () => {
    const lines = prose(seq(A, B, C, D, A, B, C, D, A, B, C, D, A), fake());
    expect(kinds(lines)).toEqual(["start", "figure", "step", "step", "step", "step"]);
    expect(lines[1].text).toBe("The next four moves, played three times:");
    // the detail is one level in, and it is the FIRST statement — the later
    // two are what the summary line is for
    expect(lines.slice(2).map((l) => l.depth)).toEqual([1, 1, 1, 1]);
    expect(lines.slice(2).map((l) => l.state)).toEqual([1, 2, 3, 4]);
  });

  it("names the interval when the figure is restated at another pitch", () => {
    // the same two-chord figure, a minor third up each time
    const up = (ps: number[], n: number) => ps.map((p) => p + n);
    const states = seq(A, B, up(A, 3), up(B, 3), up(A, 6), up(B, 6), up(A, 9));
    const lines = prose(states, fake());
    expect(lines[1].kind).toBe("figure");
    expect(lines[1].text).toBe(
      "The next two moves, then again up a minor third, then again up a tritone:",
    );
  });

  it("nests a figure inside a figure, one depth per level", () => {
    // AB played twice is a figure; that pair played twice is another.
    const states = seq(A, B, A, B, A, B, A, B, A);
    const lines = prose(states, fake());
    const nested = lines.filter((l) => l.kind === "figure");
    expect(nested.length).toBeGreaterThanOrEqual(1);
    // whatever the tree's shape, detail is always deeper than its summary
    for (let i = 1; i < lines.length; i++)
      if (lines[i - 1].kind === "figure") expect(lines[i].depth).toBe(lines[i - 1].depth + 1);
  });
});

describe("proseOf — unplayable states", () => {
  it("renders the refusal as a line and keeps going afterwards", () => {
    // the three-note chord is refused; the two-note ones are not
    const lines = prose(seq([60, 64], [60, 64, 67], [62, 65]), fake([3]));
    expect(kinds(lines)).toEqual(["start", "unplayable", "step"]);
    expect(lines[1].text).toMatch(/no shape on this instrument/);
    // the state after an unplayable one re-plans from scratch, so it has no
    // previous configuration to be described against
    expect(lines[2].text).toBe("-=>62-65 held0 pressed2");
  });

  it("renders an unplayable opening rather than dropping the piece's start", () => {
    const lines = prose(seq([60, 64, 67], [62, 65]), fake([3]));
    expect(kinds(lines)).toEqual(["unplayable", "step"]);
    expect(lines[0].state).toBe(0);
  });
});

describe("proseFor — the whole pipeline over the Chopin prelude", () => {
  const score = MusicxmlIn.parse(readFileSync("scores/chopin_prelude_op28_no4.musicxml", "utf8"));
  const states = statesOf(score);

  it("gives the piano one followable line per state", () => {
    const lines = proseFor(score, piano);
    // 98 states, no repeated figure in this piece (Task 6's measured negative),
    // so the instruction list is the state list exactly.
    expect(states).toHaveLength(98);
    expect(lines).toHaveLength(98);
    expect(kinds(lines).filter((k) => k !== "step" && k !== "start")).toEqual([]);
    for (const l of lines) {
      expect(l.text.length).toBeGreaterThan(0);
      expect(l.text.endsWith(".")).toBe(true);
    }
    // the line for state i is the instruction that arrives at state i
    expect(lines.map((l) => l.state)).toEqual(states.map((_, i) => i));
  });

  it("reports the guitar's eight unholdable sonorities and narrates the rest", () => {
    const lines = proseFor(score, guitar);
    expect(lines).toHaveLength(98);
    expect(kinds(lines).filter((k) => k === "unplayable")).toHaveLength(8);
    for (const l of lines) expect(l.text.length).toBeGreaterThan(0);
  });

  it("never goes backwards through the piece", () => {
    // A reader follows this top to bottom, so the state index may repeat at a
    // figure's summary but must never decrease.
    const lines = proseFor(score, piano);
    for (let i = 1; i < lines.length; i++)
      expect(lines[i].state).toBeGreaterThanOrEqual(lines[i - 1].state);
  });
});
