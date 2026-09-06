/* ====================================================================
   SOLVER — choosing how to play a state sequence.

   An instrument turns a sonority into a physical configuration: for a
   piano an assignment of notes to fingers, for a guitar a choice of
   string and fret for each note. Those look like different problems and
   are not. Both are "pick one of several ways to make this chord, given
   where the hand already is", and once the piece is a state sequence the
   previous state is exactly the missing ingredient. So both reduce to a
   shortest path over candidate configurations, scored by how hard each
   move is — and that path is the dozen lines below, shared by every
   instrument that will ever exist here.

   This layer knows nothing about keys, frets, hands or fingers, and it
   must stay that way: the moment it knows, there are two solvers.
   ==================================================================== */
import type { State, Transition } from "../states";

/** The seam. `Config` is whatever the instrument considers one physical way
 *  to hold a sonority; nothing outside the instrument may inspect it. */
export interface Instrument<Config> {
  /** Every physical way to make this sonority. Empty means unplayable —
   *  six strings cannot voice a seven-note chord, and that is a result,
   *  never an exception. */
  candidates(state: State): Config[];
  /** Difficulty of moving between two configurations; lower is easier.
   *  `from` is null at the start of the piece and after an unplayable
   *  state, where there is no hand position to move from. */
  cost(from: Config | null, to: Config): number;
  /** The sentence for this transition. Prose lives inside the instrument
   *  because the vocabularies genuinely differ — a piano speaks of
   *  landmarks and fingers, a guitar of shapes and frets. */
  describe(from: Config | null, to: Config, tr: Transition): string;
}

/** One configuration per state, in order. `null` marks an unplayable state. */
export type Plan<C> = { state: State; config: C | null }[];

/** A candidate under consideration, with the cheapest way to reach it. */
interface Node<C> {
  readonly config: C;
  readonly total: number;
  /** Index into the previous layer, or -1 when this node starts a segment. */
  readonly back: number;
}

/** Choose one configuration per state so the total cost of the whole
 *  sequence is least — a Viterbi pass, not a greedy walk: a cheap chord now
 *  that strands the hand for the next one loses to the alternative.
 *
 *  An unplayable state never aborts the plan. It records `null`, and the
 *  states after it re-plan from scratch, because the hand's position on the
 *  far side of a chord nobody can play is not knowable. One impossible bar
 *  must not cost the player the rest of the piece. */
export function planFor<C>(states: readonly State[], inst: Instrument<C>): Plan<C> {
  const plan: Plan<C> = states.map((state) => ({ state, config: null }));

  // The layers of the segment currently being built. A segment is a maximal
  // run of playable states; `start` is where it begins in `plan`.
  let layers: Node<C>[][] = [];
  let start = 0;

  // Walk back from the cheapest end of the finished segment, writing the
  // chosen configuration into each of its states.
  const settle = () => {
    if (!layers.length) return;
    const last = layers[layers.length - 1];
    let at = 0;
    for (let k = 1; k < last.length; k++) if (last[k].total < last[at].total) at = k;
    for (let d = layers.length - 1; d >= 0; d--) {
      const node = layers[d][at];
      plan[start + d].config = node.config;
      at = node.back;
    }
    layers = [];
  };

  for (let i = 0; i < states.length; i++) {
    const cands = inst.candidates(states[i]);
    if (!cands.length) {
      settle(); // the next playable state starts a fresh segment
      continue; // plan[i].config stays null
    }
    if (!layers.length) start = i;

    const prev = layers[layers.length - 1];
    layers.push(
      cands.map((config) => {
        if (!prev) return { config, total: inst.cost(null, config), back: -1 };
        // Ties keep the earlier candidate, so a plan is a function of the
        // instrument alone and never of iteration order.
        let back = 0;
        let total = prev[0].total + inst.cost(prev[0].config, config);
        for (let k = 1; k < prev.length; k++) {
          const t = prev[k].total + inst.cost(prev[k].config, config);
          if (t < total) {
            total = t;
            back = k;
          }
        }
        return { config, total, back };
      }),
    );
  }
  settle();
  return plan;
}

export const Solver = { planFor };
