/* Piano: fingerings as configurations, and the sentences they produce.

   Hand-built scores pin each rule, and the Chopin prelude is the end-to-end
   oracle — the point of the whole feature is that 598 notes become 97
   instructions a person can follow, and the only way to know that holds is
   to narrate the real file. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { Core } from "../core";
import { MusicxmlIn } from "../inputs/musicxml";
import { statesOf, transitionsOf, type State, type Transition } from "../states";
import type { Note, RawNote } from "../types";
import { planFor } from "./solver";
import { piano, pianoAlone, type Fingering, type Hand } from "./piano";

const n = (pitch: number, onset: number, duration: number): RawNote => ({ pitch, onset, duration });
const chord = (onset: number, duration: number, ...ps: number[]): RawNote[] =>
  ps.map((p) => n(p, onset, duration));

/** The transition into the first state: nothing was sounding, so everything
 *  is newly pressed. The solver plans states; only the caller pairs them up,
 *  and this is what that pairing looks like at the very start. */
const opening = (s: State): Transition => ({
  held: [], released: [], pressed: s.notes, restruck: [], motion: [],
});

/** Plan a hand-built score and say every state of it. */
const narrate = (raw: readonly RawNote[]) => {
  const states = statesOf(Core.makeScore([...raw]));
  const trans = transitionsOf(states);
  const plan = planFor(states, piano);
  const lines = states.map((s, i) => {
    const config = plan[i].config;
    return config === null
      ? null
      : piano.describe(i ? plan[i - 1].config : null, config, i ? trans[i - 1] : opening(s));
  });
  return { states, trans, plan, lines };
};

const hand = (f: Fingering, h: Hand) => f.placements.filter((p) => p.hand === h);
const shape = (f: Fingering, h: Hand) =>
  hand(f, h).map((p) => `${p.finger}:${p.note.pitch}`).join(" ");
const pitches = (ns: readonly Note[]) => ns.map((x) => x.pitch);

describe("candidates", () => {
  const state = (...ps: number[]): State => statesOf(Core.makeScore(chord(0, 1, ...ps)))[0];

  it("never asks a hand for a sixth finger or a wider reach than an octave", () => {
    for (const cands of [state(60, 62, 64, 65, 67, 69), state(48, 55, 60, 64, 67, 72)].map((s) =>
      piano.candidates(s),
    )) {
      expect(cands.length).toBeGreaterThan(0);
      for (const c of cands)
        for (const h of ["L", "R"] as const) {
          const ps = hand(c, h);
          expect(ps.length).toBeLessThanOrEqual(5);
          if (ps.length)
            expect(ps[ps.length - 1].note.pitch - ps[0].note.pitch).toBeLessThanOrEqual(12);
        }
    }
  });

  it("places every note of the state exactly once, hands never interleaving", () => {
    for (const c of piano.candidates(state(48, 52, 55, 60, 64, 67))) {
      expect(pitches(c.placements.map((p) => p.note))).toEqual([48, 52, 55, 60, 64, 67]);
      const left = hand(c, "L");
      const right = hand(c, "R");
      if (left.length && right.length)
        expect(left[left.length - 1].note.pitch).toBeLessThan(right[0].note.pitch);
    }
  });

  it("numbers fingers up with pitch in the right hand and down in the left", () => {
    // The thumbs face each other; it is the only asymmetry between the hands.
    for (const c of piano.candidates(state(48, 52, 55, 60, 64, 67)))
      for (const h of ["L", "R"] as const) {
        const fs = hand(c, h).map((p) => p.finger);
        const sorted = [...fs].sort((a, b) => (h === "R" ? a - b : b - a));
        expect(fs).toEqual(sorted);
      }
  });

  it("reports an unreachable sonority as unplayable rather than throwing", () => {
    // Eleven notes: one more than there are fingers.
    expect(piano.candidates(state(36, 38, 40, 41, 43, 45, 47, 48, 50, 52, 53))).toEqual([]);
    // Ten notes, but two of them a fifteenth apart from their neighbours.
    expect(piano.candidates(state(21, 45, 70, 108))).toEqual([]);
  });
});

describe("cost", () => {
  const state = (...ps: number[]): State => statesOf(Core.makeScore(chord(0, 1, ...ps)))[0];
  const cheapest = (s: State, from: Fingering | null) =>
    piano.candidates(s).reduce((a, b) => (piano.cost(from, b) < piano.cost(from, a) ? b : a));

  it("prefers the fingering that leaves fingers where they already are", () => {
    const first = cheapest(state(60, 64, 67), null);
    const second = cheapest(state(60, 64, 69), first);
    // Two of the three keys are unchanged, so two fingers should not move.
    const kept = second.placements.filter((p) =>
      first.placements.some((q) => q.note.pitch === p.note.pitch && q.finger === p.finger),
    );
    expect(kept.map((p) => p.note.pitch)).toEqual([60, 64]);
  });

  it("charges for a stretch beyond a comfortable span", () => {
    const wide = piano.candidates(state(60, 72))[0]; // an octave in one hand
    const close = piano.candidates(state(60, 64))[0];
    expect(piano.cost(null, wide)).toBeGreaterThan(piano.cost(null, close));
  });
});

describe("describe", () => {
  it("names the R relation, and says which two notes to keep", () => {
    const { lines } = narrate([...chord(0, 1, 60, 64, 67), ...chord(1, 1, 60, 64, 69)]);
    expect(lines[1]).toBe(
      "C to Am (R): keep the root and the third; the right hand's little finger up a whole tone.",
    );
  });

  it("names P and L too, from the same transition data", () => {
    expect(narrate([...chord(0, 1, 60, 64, 67), ...chord(1, 1, 60, 63, 67)]).lines[1]).toContain(
      "C to Cm (P): keep the root and the fifth",
    );
    expect(narrate([...chord(0, 1, 60, 64, 67), ...chord(1, 1, 59, 64, 67)]).lines[1]).toContain(
      "C to Em (L): keep the third and the fifth",
    );
  });

  it("says a restated figure once, as a shape translation", () => {
    const figure = [...chord(0, 1, 60, 64, 67, 72), ...chord(1, 1, 63, 67, 70, 75)];
    expect(narrate(figure).lines[1]).toBe("The same shape, up a minor third.");
  });

  it("holds the outer two and moves the one in the middle", () => {
    // Deliberately not a triad at either end, so tier 1 cannot claim it —
    // C-D-G to C-E-flat-G, an inner voice rising while the outer two stay.
    const { lines } = narrate([...chord(0, 1, 60, 62, 67), ...chord(1, 1, 60, 63, 67)]);
    expect(lines[1]).toMatch(/^Hold the outer two; the right hand's \w+ finger up a semitone\.$/);
  });

  it("names the destination when nothing is held to move relative to", () => {
    const { lines } = narrate([n(60, 0, 1), n(62, 1, 1)]);
    expect(lines[1]).toBe("The right hand's thumb up a whole tone, to the white key between the two black keys of the group of two above middle C.");
  });

  it("falls back to naming every key, by landmark, when nothing shorter is true", () => {
    // Three voices move at once: no transform, no translation, no anchor.
    const { lines } = narrate([...chord(0, 1, 60, 64, 67), ...chord(1, 1, 62, 65, 71)]);
    expect(lines[1]).toContain("Right hand:");
    expect(lines[1]).toContain("middle C"); // relative to a landmark, never "D4"
    expect(lines[1]).not.toContain("Hold");
  });

  it("counts a run of restatements instead of repeating the sentence", () => {
    const { states, lines } = narrate([
      ...chord(0, 0.5, 60, 64, 67), ...chord(1, 0.5, 60, 64, 67),
      ...chord(2, 0.5, 60, 64, 67), ...chord(3, 0.5, 60, 64, 67),
    ]);
    expect(states).toHaveLength(1);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("played four times");
  });

  it("says 'twice' for a run of two", () => {
    const { lines } = narrate([...chord(0, 0.5, 60, 64, 67), ...chord(1, 0.5, 60, 64, 67)]);
    expect(lines[0]).toContain("played twice");
  });
});

describe("planFor with the piano", () => {
  it("leaves a hand completely still while the other one moves", () => {
    // A sustained left-hand chord under a melody: the left hand is entirely
    // inside every transition's `held` set, so nothing should re-finger it.
    const { plan, trans } = narrate([
      ...chord(0, 4, 48, 52, 55),
      n(72, 0, 1), n(74, 1, 1), n(76, 2, 1), n(77, 3, 1),
    ]);
    for (const t of trans) expect(pitches(t.held)).toEqual([48, 52, 55]);
    const left = plan.map((p) => shape(p.config!, "L"));
    expect(new Set(left).size).toBe(1);
    // and the right hand really did move, so the assertion above is not
    // measuring an instrument that never changes anything.
    expect(new Set(plan.map((p) => shape(p.config!, "R"))).size).toBe(4);
  });

  it("narrates the Chopin prelude end to end", () => {
    const score = MusicxmlIn.parse(readFileSync("scores/chopin_prelude_op28_no4.musicxml", "utf8"));
    const states = statesOf(score);
    const trans = transitionsOf(states);
    const plan = planFor(states, piano);

    expect(plan).toHaveLength(98);
    expect(plan.filter((p) => p.config === null)).toEqual([]);
    for (const p of plan)
      expect(pitches(p.config!.placements.map((x) => x.note))).toEqual(pitches(p.state.notes));

    const lines = states.map((s, i) =>
      piano.describe(i ? plan[i - 1].config : null, plan[i].config!, i ? trans[i - 1] : opening(s)),
    );
    expect(lines).toHaveLength(98);
    for (const line of lines) {
      expect(line.length).toBeGreaterThan(0);
      expect(line.endsWith(".")).toBe(true);
    }

    // Most of the piece is voice leading, which is the claim the whole
    // reframing rests on: the short sentences dominate the long ones.
    const short = lines.filter((l) => /^(Hold|The same shape|The (left|right) hand)/.test(l));
    expect(short.length / lines.length).toBeGreaterThan(0.7);
  });
});

/* One hand alone. The whole of "practise hands separately" at the
   instrument layer: the splits that share the sonority out are simply not
   offered, and everything else about the instrument is unchanged. */
describe("pianoAlone", () => {
  const state = (...ps: number[]): State => statesOf(Core.makeScore(chord(0, 1, ...ps)))[0];

  it("gives every note to the hand asked for, and none to the other", () => {
    for (const hand of ["L", "R"] as const)
      for (const f of pianoAlone(hand).candidates(state(60, 64, 67)))
        for (const p of f.placements) expect(p.hand).toBe(hand);
  });

  it("places the whole sonority, never a subset", () => {
    for (const f of pianoAlone("L").candidates(state(60, 64, 67)))
      expect(f.placements.map((p) => p.note.pitch)).toEqual([60, 64, 67]);
  });

  it("keeps the hand's own asymmetry: fingers rise right, fall left", () => {
    const [r] = pianoAlone("R").candidates(state(60, 64, 67));
    const [l] = pianoAlone("L").candidates(state(60, 64, 67));
    const fingers = (f: Fingering) => f.placements.map((p) => p.finger);
    expect(fingers(r)).toEqual([...fingers(r)].sort((a, b) => a - b));
    expect(fingers(l)).toEqual([...fingers(l)].sort((a, b) => b - a));
  });

  it("refuses what one hand cannot reach, though two hands can", () => {
    const fourteenth = state(36, 57); // 21 semitones
    expect(pianoAlone("L").candidates(fourteenth)).toEqual([]);
    expect(piano.candidates(fourteenth).length).toBeGreaterThan(0);
    // and more notes than the hand has fingers
    expect(pianoAlone("R").candidates(state(60, 61, 62, 63, 64, 65))).toEqual([]);
  });

  it("shares cost and describe verbatim — a one-handed fingering is a fingering", () => {
    const one = pianoAlone("L");
    const [f] = one.candidates(state(48, 52, 55));
    expect(one.cost).toBe(piano.cost);
    expect(one.describe(null, f, {
      held: [], released: [], pressed: f.placements.map((p) => p.note), restruck: [], motion: [],
    })).toMatch(/^Left hand: /);
  });
});
