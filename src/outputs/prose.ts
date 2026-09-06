/* ====================================================================
   PROSE — the score as a list of things to do with your hands.

   THIS IS NOT A `View`, and that is a real boundary rather than an
   oversight. Every other output in `outputs/` is `(svg, score, t)`: a
   projection of the model onto a canvas at an instant. This one has no
   canvas and no instant. Time left the model at `states.ts` — a piece
   here is an ordered sequence of sonorities, not a function of `t` — and
   the result is sentences, not geometry. Forcing it through `View` would
   mean lying about both parameters, so it exports its own shape and
   main.ts renders it into a panel instead of into the svg.

   What it does own is the ASSEMBLY, and nothing else. The four layers
   below it each already answer their own question and none of them may
   be re-litigated here:

     states.ts     what the sonorities are, and what changes between them
     chunking.ts   which runs of transitions are one gesture
     solver.ts     which configuration to play each state in
     the instrument   what to SAY about a move — see `describe`

   So there is exactly one sentence this module writes itself, the
   summary line of a repeated figure, because that is the one sentence
   about the CHUNK TREE rather than about a transition; every other line
   is `inst.describe` verbatim. The moment prose starts phrasing moves,
   it has to know about keys and frets, and the seam is gone.
   ==================================================================== */
import { chunkLength, chunksOf, type Chunk, type Repeat, type Step } from "../chunking";
import { statesOf, type State, type Transition } from "../states";
import { planFor, type Instrument, type Plan } from "../instruments/solver";
import { count, direction, times } from "../words";
import type { Score } from "../types";

/** What sort of line this is, so a renderer can style it without parsing
 *  the English back out again. */
export type LineKind =
  /** The opening sonority: where the hands start, with nothing to move from. */
  | "start"
  /** One transition — the ordinary instruction. */
  | "step"
  /** The summary of a repeated figure; its detail follows, one depth deeper. */
  | "figure"
  /** A sonority this instrument cannot hold at all. */
  | "unplayable";

/** One instruction. */
export interface Line {
  /** The state it arrives at, as an index into the plan. A `figure` line
   *  points at the first state of its first statement. */
  readonly state: number;
  /** Nesting in the chunk tree; 0 is top level. A renderer indents by it. */
  readonly depth: number;
  readonly kind: LineKind;
  readonly text: string;
}

/** The transition into the first state: everything is new, nothing was
 *  held, and there is nowhere the hand is moving from. Real rather than a
 *  placeholder — it is what actually happens when the piece starts, and
 *  it lets the opening line go through `describe` like every other.
 *
 *  Exported because any surface showing ONE state needs the same honest
 *  answer for the first one — the Hands view asks for it too, and two
 *  definitions of "what happens when a piece starts" would be one too
 *  many. */
export const opening = (state: State): Transition => ({
  held: [],
  released: [],
  pressed: state.notes,
  restruck: [],
  motion: [],
});

/** Why a state has no line of its own beyond this one. Phrased without
 *  naming keys or frets, because this module does not know which it is —
 *  the instrument said "no", and how it says so is its own business. */
const UNPLAYABLE = "This sonority has no shape on this instrument — pick it up at the next chord.";

/** The summary line for a repeated figure: how long it is, and how its
 *  restatements sit against the first.
 *
 *  `offsets[0]` is always 0 (the first statement is the reference), so
 *  the sentence describes the rest. An all-zero set is a literal repeat
 *  and gets the shorter "played three times"; anything else is a
 *  sequence, and naming each step is the whole point of the interval
 *  pass finding it. */
function figureText(c: Repeat): string {
  const moves = c.body.reduce((sum, b) => sum + chunkLength(b), 0);
  const head = `The next ${count(moves)} ${moves === 1 ? "move" : "moves"}`;
  const rest = c.offsets.slice(1);
  if (rest.every((o) => o === 0)) return `${head}, ${times(c.count)}:`;
  return `${head}, then ${rest.map((o) => (o === 0 ? "again" : `again ${direction(o)}`)).join(", then ")}:`;
}

/** The instruction list for a plan, as sentences.
 *
 *  `plan` and `chunks` must come from the same state sequence — the plan
 *  is indexed by state and the chunk tree by transition, and transition
 *  `i` joins states `i` and `i + 1`. That is the only coupling between
 *  them, and it is why both are parameters rather than one being derived
 *  from the other: a caller with a plan already in hand should not pay
 *  for a second solve. */
export function proseOf<C>(
  plan: Plan<C>,
  chunks: readonly Chunk[],
  inst: Instrument<C>,
): Line[] {
  const out: Line[] = [];
  if (!plan.length) return out;

  const line = (state: number, depth: number, from: C | null, tr: Transition): void => {
    const to = plan[state].config;
    if (to === null) out.push({ state, depth, kind: "unplayable", text: UNPLAYABLE });
    else out.push({ state, depth, kind: state === 0 ? "start" : "step", text: inst.describe(from, to, tr) });
  };

  line(0, 0, null, opening(plan[0].state));

  const step = (c: Step, depth: number): void =>
    line(c.index + 1, depth, plan[c.index].config, c.transition);

  const walk = (cs: readonly Chunk[], depth: number): void => {
    for (const c of cs) {
      if (c.kind === "step") {
        step(c, depth);
        continue;
      }
      // The summary, then the detail of the FIRST statement. The later
      // statements are what the summary is for; spelling them out again
      // would undo the chunking that found them.
      out.push({ state: c.index, depth, kind: "figure", text: figureText(c) });
      walk(c.body, depth + 1);
    }
  };
  walk(chunks, 0);
  return out;
}

/** The whole pipeline for a score: states, a plan, a chunk tree, prose.
 *  The convenience the app actually calls — and the reason `proseOf`
 *  above stays parameterised on things a test can hand it directly. */
export function proseFor<C>(score: Score, inst: Instrument<C>): Line[] {
  const states = statesOf(score);
  return proseOf(planFor(states, inst), chunksOf(states), inst);
}

export const Prose = { proseOf, proseFor };
