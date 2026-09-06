/* Guitar: frettings as configurations, and the sentences they produce.

   The point of this file is the seam. Every assertion below is about the
   guitar alone, and the solver it is planned with is the same object,
   unmodified, that plans a piano fingering — so the last test narrating
   the Chopin prelude on six strings is not a musical proposal. It is the
   evidence that a second instrument cost the shared layers nothing, down
   to and including the eight sonorities no guitar can hold. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { Core } from "../core";
import { MusicxmlIn } from "../inputs/musicxml";
import { statesOf, transitionsOf, type State, type Transition } from "../states";
import type { RawNote } from "../types";
import { planFor } from "./solver";
import { guitar, guitarIn, type Fretting } from "./guitar";
import { DROP_D, FRETS, pitchAt, STANDARD } from "./guitar-geometry";

const n = (pitch: number, onset: number, duration: number): RawNote => ({ pitch, onset, duration });
const chord = (onset: number, duration: number, ...ps: number[]): RawNote[] =>
  ps.map((p) => n(p, onset, duration));
const state = (...ps: number[]): State => statesOf(Core.makeScore(chord(0, 1, ...ps)))[0];

/** The transition into the first state: nothing was sounding before it. */
const opening = (s: State): Transition => ({
  held: [], released: [], pressed: s.notes, restruck: [], motion: [],
});

/** Plan a hand-built score and say every state of it; null where unplayable. */
const narrate = (raw: readonly RawNote[], inst = guitar) => {
  const states = statesOf(Core.makeScore([...raw]));
  const trans = transitionsOf(states);
  const plan = planFor(states, inst);
  const lines = states.map((s, i) => {
    const config = plan[i].config;
    return config === null
      ? null
      : inst.describe(i ? plan[i - 1].config : null, config, i ? trans[i - 1] : opening(s));
  });
  return { states, plan, lines };
};

/** The grip as a chord diagram reads it: one entry per string, low to
 *  high, with `x` for a string that is not played. */
const grid = (f: Fretting): string => {
  const out = f.tuning.map(() => "x");
  for (const s of f.stops) out[s.string] = String(s.fret);
  return out.join(" ");
};

/** Say one transition with both grips named outright, as chord diagrams.
 *  The solver has an opinion about where a hand should be — usually the
 *  open end of the neck — and a tier of `describe` is a property of the
 *  two grips, not of that opinion. */
const sayGrips = (raw: readonly RawNote[], from: string, to: string): string => {
  const states = statesOf(Core.makeScore([...raw]));
  const pick = (s: State, g: string) => guitar.candidates(s).find((c) => grid(c) === g)!;
  return guitar.describe(
    pick(states[0], from), pick(states[1], to), transitionsOf(states)[0],
  );
};

const E_MAJOR = [40, 47, 52, 56, 59, 64]; // the open E chord
const A_MAJOR = [45, 52, 57, 61, 64, 69]; // the same shape, barred at the 5th

describe("candidates", () => {
  it("puts every note on a string of its own, at a fret that sounds it", () => {
    for (const s of [state(...E_MAJOR), state(48, 52, 55), state(60, 64, 67, 72)])
      for (const c of guitar.candidates(s)) {
        expect(c.stops.map((x) => x.note)).toHaveLength(s.notes.length);
        expect(new Set(c.stops.map((x) => x.string)).size).toBe(s.notes.length);
        for (const stop of c.stops)
          expect(pitchAt(c.tuning, stop.string, stop.fret)).toBe(stop.note.pitch);
      }
  });

  it("never asks for a fifth finger or a reach past four frets", () => {
    for (const s of [state(...A_MAJOR), state(48, 52, 55, 60), state(50, 57, 62, 66)])
      for (const c of guitar.candidates(s)) {
        const fretted = c.stops.filter((x) => x.fret > 0);
        if (fretted.length > 1) {
          const fs = fretted.map((x) => x.fret);
          expect(Math.max(...fs) - Math.min(...fs)).toBeLessThan(4);
        }
        const fingers = c.barre === null
          ? fretted.length
          : 1 + fretted.filter((x) => x.fret !== c.barre).length;
        expect(fingers).toBeLessThanOrEqual(4);
      }
  });

  it("claims a barre only where a finger could really lie flat", () => {
    for (const s of [state(...A_MAJOR), state(...E_MAJOR), state(48, 55, 60, 64)])
      for (const c of guitar.candidates(s)) {
        if (c.barre === null) continue;
        const barred = c.stops.filter((x) => x.fret === c.barre).map((x) => x.string);
        expect(barred.length).toBeGreaterThan(1);
        // No string may be played open beneath the finger holding the barre.
        const lo = Math.min(...barred);
        const hi = Math.max(...barred);
        for (const stop of c.stops)
          if (stop.string > lo && stop.string < hi) expect(stop.fret).toBeGreaterThan(0);
      }
  });

  it("reports a sonority the neck cannot hold as unplayable, rather than throwing", () => {
    expect(guitar.candidates(state(60, 62, 64, 65, 67, 69, 71))).toEqual([]); // seven notes, six strings
    expect(guitar.candidates(state(28, 40, 52))).toEqual([]); // a bass note below the bottom E
    expect(guitar.candidates(state(48, 52, 57, 78))).toEqual([]); // on the neck, but not in one hand
  });
});

describe("cost", () => {
  const cheapest = (s: State, from: Fretting | null) =>
    guitar.candidates(s).reduce((a, b) => (guitar.cost(from, b) < guitar.cost(from, a) ? b : a));

  it("prefers the grip that leaves fingers where they already are", () => {
    const first = cheapest(state(45, 52, 57, 61), null);
    const second = cheapest(state(45, 52, 57, 60), first);
    const kept = second.stops.filter((s) =>
      first.stops.some((q) => q.string === s.string && q.fret === s.fret && s.fret > 0),
    );
    expect(kept.length).toBeGreaterThanOrEqual(2);
  });

  it("charges for sliding the hand up the neck", () => {
    const low = guitar.candidates(state(45, 52, 57, 61))[0];
    const near = state(47, 54, 59, 63); // two frets away
    const far = state(57, 64, 69, 73); // twelve
    const best = (s: State) => Math.min(...guitar.candidates(s).map((c) => guitar.cost(low, c)));
    expect(best(far)).toBeGreaterThan(best(near));
  });
});

describe("describe", () => {
  it("names the open shapes a player already knows", () => {
    expect(narrate(chord(0, 1, ...E_MAJOR)).lines[0]).toBe("E major: the open E shape.");
    expect(narrate(chord(0, 1, 45, 52, 57, 60, 64)).lines[0]).toBe("A minor: the open Am shape.");
    expect(narrate(chord(0, 1, 48, 52, 55, 60, 64)).lines[0]).toBe("C major: the open C shape.");
    expect(narrate(chord(0, 1, 50, 57, 62, 66)).lines[0]).toBe("D major: the open D shape.");
    expect(narrate(chord(0, 1, 43, 47, 50, 55, 59, 67)).lines[0]).toBe("G major: the open G shape.");
  });

  it("names a barre chord by the shape it is made of and the fret it sits at", () => {
    expect(narrate(chord(0, 1, ...A_MAJOR)).lines[0]).toBe(
      "A major: the E shape barred at the 5th fret.",
    );
  });

  it("says a grip moved up the neck once, as a shape translation", () => {
    // Four fretted strings, no open ones and no name in the shape table, so
    // only the translation tier can claim it. The grips are named outright
    // because the solver would sooner drop to the second fret than slide:
    // on a guitar the same shape lower down is a different, easier grip.
    expect(
      sayGrips([...chord(0, 1, 45, 52, 57, 61), ...chord(1, 1, 47, 54, 59, 63)],
        "5 7 7 6 x x", "7 9 9 8 x x"),
    ).toBe("The same shape, up two frets.");
    expect(
      sayGrips([...chord(0, 1, 47, 54, 59, 63), ...chord(1, 1, 45, 52, 57, 61)],
        "7 9 9 8 x x", "5 7 7 6 x x"),
    ).toBe("The same shape, down two frets.");
  });

  it("moves one string and keeps the rest, when the rest are struck again", () => {
    const { lines } = narrate([...chord(0, 1, 40, 47, 52, 56), ...chord(1, 1, 40, 47, 52, 55)]);
    expect(lines[1]).toBe("Keep the other three strings; the 3rd string to open.");
  });

  it("lets the rest ring instead, when they are genuinely still sounding", () => {
    // The same transition, with the lower three notes sustained rather than
    // restruck: identical pitches, a different instruction.
    const { lines } = narrate([...chord(0, 4, 40, 47, 52), n(56, 0, 1), n(55, 1, 1)]);
    expect(lines[1]).toBe("Let the other three strings ring; the 3rd string to open.");
  });

  it("falls back to naming every string when nothing shorter is true", () => {
    const { lines } = narrate([...chord(0, 1, 48, 52, 55), ...chord(1, 1, 50, 57, 62, 66)]);
    expect(lines[1]).toBe("D major: the open D shape."); // tier 1 still wins here
    expect(narrate(chord(0, 1, 48, 52, 55)).lines[0]).toMatch(
      /^The \dth string, (open|\d+\w+ fret)(; the \d\w+ string, (open|\d+\w+ fret))+\.$/,
    );
  });

  it("counts a run of restatements instead of repeating the sentence", () => {
    const { states, lines } = narrate([
      ...chord(0, 0.5, ...E_MAJOR), ...chord(1, 0.5, ...E_MAJOR),
      ...chord(2, 0.5, ...E_MAJOR), ...chord(3, 0.5, ...E_MAJOR),
    ]);
    expect(states).toHaveLength(1);
    expect(lines[0]).toBe("E major: the open E shape, played four times.");
  });
});

describe("tuning is data", () => {
  it("plays in drop D what standard tuning cannot reach, changing nothing else", () => {
    const dropD = guitarIn(DROP_D);
    const low = state(38, 45, 50); // a D two frets below the bottom E
    expect(guitar.candidates(low)).toEqual([]);
    expect(dropD.candidates(low).length).toBeGreaterThan(0);
    // And the shapes that did not need the sixth string are unaffected.
    expect(narrate(chord(0, 1, 50, 57, 62, 66), dropD).lines[0]).toBe("D major: the open D shape.");
  });
});

describe("planFor with the guitar", () => {
  it("records a null for an unplayable state and re-plans from the next one", () => {
    const { plan, lines } = narrate([
      ...chord(0, 1, ...E_MAJOR),
      ...chord(1, 1, 60, 62, 64, 65, 67, 69, 71), // seven notes: no fretting exists
      ...chord(2, 1, ...A_MAJOR),
    ]);
    expect(plan.map((p) => p.config === null)).toEqual([false, true, false]);
    expect(lines[2]).toBe("A major: the E shape barred at the 5th fret.");
  });

  it("plans the Chopin prelude on six strings, and says where it cannot", () => {
    const score = MusicxmlIn.parse(readFileSync("scores/chopin_prelude_op28_no4.musicxml", "utf8"));
    const states = statesOf(score);
    const trans = transitionsOf(states);
    const plan = planFor(states, guitar);

    expect(plan).toHaveLength(98);
    // 90 of the 98 sonorities fit on a neck. Of the 8 that do not, 4 reach
    // below the bottom E (one of them is the seven-note chord as well) and
    // 4 are on the neck but wider than one hand — the honest result, and
    // the one the whole `null` path exists to carry.
    const unplayable = plan.flatMap((p, i) => (p.config === null ? [i] : []));
    expect(unplayable).toEqual([60, 61, 62, 63, 65, 95, 96, 97]);
    expect(
      unplayable.filter((i) => states[i].notes.some((x) => x.pitch < STANDARD[0])),
    ).toHaveLength(4);
    expect(states[96].notes.length).toBeGreaterThan(STANDARD.length);

    for (const p of plan) {
      if (!p.config) continue;
      expect(p.config.stops.map((s) => s.note.pitch).sort((a, b) => a - b))
        .toEqual(p.state.notes.map((x) => x.pitch));
      for (const s of p.config.stops) expect(s.fret).toBeLessThanOrEqual(FRETS);
    }

    const lines = states.map((s, i) =>
      plan[i].config === null
        ? null
        : guitar.describe(
            i ? plan[i - 1].config : null, plan[i].config!, i ? trans[i - 1] : opening(s),
          ),
    );
    expect(lines.filter((l) => l !== null)).toHaveLength(90);
    for (const line of lines) {
      if (line === null) continue;
      expect(line.length).toBeGreaterThan(0);
      expect(line.endsWith(".")).toBe(true);
    }
    // The tiers, measured rather than hoped for: 0 named shapes, 3 shape
    // translations, 54 one- or two-finger moves, 33 full restatements.
    //
    // Zero is the interesting number and it is not a defect. This prelude
    // is built from sevenths and chromatic inner voices, so no sonority in
    // it is an open-position triad — the same finding Task 4 records for
    // the Tonnetz transforms, reached independently on another instrument.
    const tier = (l: string) =>
      /^[A-G]#? (major|minor):|^The (open|[A-G])[a-z]* shape/.test(l) ? "shape"
        : /^The same shape/.test(l) ? "translation"
          : /^(Keep|Let)/.test(l) ? "finger" : "restatement";
    const hist: Record<string, number> = {};
    for (const l of lines) if (l !== null) hist[tier(l)] = (hist[tier(l)] ?? 0) + 1;
    expect(hist).toEqual({ translation: 3, finger: 54, restatement: 33 });
    // Three of the 33 restatements open a segment, with no previous grip to
    // be shorter than; the rest genuinely re-place the whole hand.
    const opens = plan.filter((p, i) => p.config && (i === 0 || !plan[i - 1].config));
    expect(opens).toHaveLength(3);
  });
});

describe("the diagram, as a sanity check on the grips themselves", () => {
  it("holds the open chords exactly as they are taught", () => {
    const best = (ps: number[]) =>
      grid(guitar.candidates(state(...ps)).reduce((a, b) =>
        guitar.cost(null, b) < guitar.cost(null, a) ? b : a));
    expect(best(E_MAJOR)).toBe("0 2 2 1 0 0");
    expect(best(A_MAJOR)).toBe("5 7 7 6 5 5");
    expect(best([45, 52, 57, 60, 64])).toBe("x 0 2 2 1 0");
  });
});
