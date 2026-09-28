/* ====================================================================
   BACKCHAIN — a section learned from its end. The trick opera singers use
   on a hard phrase in a foreign language (Gabriel Wyner, Fluent Forever):
   sing the last note, then the last two, then the last three, and so on
   until the whole phrase is sung — so every repetition ends on the part
   you know best, and each new note is the one thing you do not yet know.

   Pure: a range and its steps in, a list of ranges out. What loops a
   link — the clock, or a lesson — is the one bar selection every view
   already shares (main.ts); a link is only a narrower selection of it, so
   it plays, steps and confines by the same path as any other.

   Three decisions, stated because they are decisions:

   1. A LINK IS A RANGE. Link k is the section with its start pulled in to
      the k-th step from the end — a trimmed BarRange (types.ts), set by
      Loop.withEdge, the same way { sets a start on a note. Every link
      shares the section's end, trim and all, and plays start to end.

   2. A NOTE IS A STEP. "The last three notes" counts simultaneities, as
      ← → and practice mode do (steps.ts): a chord is one note of the
      chain, and grows it by one link, not three.

   3. THE LONGEST LINK IS THE SECTION. The last link is the section as it
      was chosen, not its first step's trim of it — so a section that
      opens on a rest, or a tied note from the bar before, is given back
      whole at the end of the chain rather than lost to it.
   ==================================================================== */
import { barTime, normalizeRange, sameRange } from "./core";
import { withEdge } from "./loop";
import type { Step } from "./steps";
import type { BarRange, Score } from "./types";

const EPS = 1e-6;

/** The links of `range`'s backchain, shortest first: the last step, the
 *  last two, … the whole section (decisions 1–3). Empty when no step
 *  begins inside it. `range` null is the whole piece. */
export function links(score: Score, steps: readonly Step[], range: BarRange | null): BarRange[] {
  const whole = normalizeRange(score, range ?? { from: 0, to: score.bars.length - 1 });
  const span = barTime(score, whole);
  const inside = steps.filter((s) => s.at >= span.start - EPS && s.at < span.end - EPS);
  const out = inside
    .reverse()
    .map((s) => normalizeRange(score, withEdge(score, whole, "start", s.at)));
  if (out.length > 0 && !sameRange(out[out.length - 1], whole)) out[out.length - 1] = whole;
  return out;
}

export const Backchain = { links };
