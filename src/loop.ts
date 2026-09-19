/* ====================================================================
   LOOP — where the playback loop's edges go, and where a step lands.
   Pure: steps and seconds in, seconds out. The clock HONOURS a loop
   (clock.ts); this decides what a sensible one is. Bars in, bars out —
   Core.barTime is the one place a bar becomes seconds.

   Everything here counts in the same Steps practice mode counts in, so
   "one note at a time" means one simultaneity — a chord is one step, and
   what counts as "together" is steps.ts's GROUP_SEC, not a second opinion.

   Four decisions, stated because they are decisions:

   1. A STEP LANDS ON ITS LAST ATTACK, not its first. A chord captured
      from a performance spreads its notes over up to GROUP_SEC, and a
      playhead parked on the first of them would sound one note of the
      chord. Parked on the last, every attack is sounding — and the view
      moves by at most 30ms, which no eye can see. Quantized scores have
      one onset per step and never notice.

   2. EDGES SIT ON BARLINES, OR ON ATTACKS. The loop is a run of bars —
      the same BarRange practice mode isolates, and the same two
      bar-number boxes set it — so it is chosen in the unit a musician
      counts in, and by default an edge snaps to a barline. Finer, an edge
      may be trimmed into its bar (types.ts, BarRange), but only ever onto
      an ATTACK — the start of a step — so it still never starts the loop
      in silence halfway through a beat, and the steps it confines are
      whole steps.

   3. MARKING IS INCLUSIVE. `[` and `]` are pressed while standing in a
      bar, and both mean "this bar is in"; `{` and `}` are pressed while
      standing on a step, and both mean "this step is in".

   4. STEPPING WRAPS ONLY INSIDE A LOOP. Past the last step of a loop you
      come round to its first, which is the point of a loop. With no loop
      the piece's ends are walls — wrapping from the last note of a sonata
      to the first is never what an arrow key meant.
   ==================================================================== */
import { barAt, barTime, beatOfTime } from "./core";
import type { Bar, BarRange, Score, TimeRange } from "./types";
import type { Step } from "./steps";

export type Edge = "start" | "end";

/** Two times this close are the same instant. A step lands the clock on a
 *  note's onset exactly, but "exactly" in floating point is a promise not
 *  worth resting a comparison on. */
const EPS = 1e-6;

/** Where the playhead parks for a step (decision 1). A step always
 *  attacks at least one note — makeSteps builds steps FROM attacks. */
export const landing = (s: Step): number => Math.max(...s.attack.map((n) => n.onset));

/** The time a left/right step goes to from `t`, or null when there is
 *  nowhere to go. Within a loop only the loop's steps are candidates and
 *  the ends wrap (decision 4); from outside a loop, forward enters it at
 *  its first step and back at its last, which is the same rule seen from
 *  the other side. Back from BETWEEN two steps goes to the one you are
 *  in, as a debugger's step-back returns to the line you stopped on. */
export function stepFrom(
  steps: readonly Step[], t: number, dir: 1 | -1, loop: TimeRange | null,
): number | null {
  const inside = loop ? steps.filter((s) => s.at >= loop.start - EPS && s.at < loop.end - EPS) : steps;
  if (inside.length === 0) return null;
  const hit = dir === 1
    ? inside.find((s) => landing(s) > t + EPS)
    : [...inside].reverse().find((s) => landing(s) < t - EPS);
  if (hit) return landing(hit);
  if (!loop) return null; // a wall, not a wrap
  return landing(dir === 1 ? inside[0] : inside[inside.length - 1]);
}

/** Move one edge of a selection (or of the whole piece, when there is
 *  none) to score time `t` — onto a barline when `t` is one, trimmed into
 *  its bar otherwise. The end edge is exclusive, so a `t` on a barline
 *  closes the bar before it. An edge set past the other one does not swap
 *  them or refuse: the other edge gives way to its end of the piece,
 *  because the edge being set is the one the user is looking at. The edge
 *  that stays keeps its trim. */
export function withEdge(score: Score, range: BarRange | null, edge: Edge, t: number): BarRange {
  const last = score.bars.length - 1;
  const cur = range ?? { from: 0, to: last };
  const span = barTime(score, cur);
  const b = barAt(score, t);
  const beat = beatOfTime(b, t); // normalizeRange (via selectBars) drops a hair-thin trim
  if (edge === "start") {
    const head = { from: b.index, ...(t > b.start + EPS && t < b.end - EPS && { fromBeat: beat }) };
    const tail = { to: cur.to, ...(cur.toBeat !== undefined && { toBeat: cur.toBeat }) };
    return { ...head, ...(t < span.end - EPS ? tail : { to: last }) };
  }
  const tail = t <= b.start + EPS ? { to: Math.max(0, b.index - 1) }
    : t >= b.end - EPS ? { to: b.index }
    : { to: b.index, toBeat: beat };
  const head = { from: cur.from, ...(cur.fromBeat !== undefined && { fromBeat: cur.fromBeat }) };
  return { ...(t > span.start + EPS ? head : { from: 0 }), ...tail };
}

/** Move one edge to a barline: the start edge to bar `bar`'s opening one,
 *  the end edge to its closing one. withEdge, in whole bars. */
export const withBar = (score: Score, range: BarRange | null, edge: Edge, bar: number): BarRange =>
  withEdge(score, range, edge, edge === "start" ? score.bars[bar].start : score.bars[bar].end);

/** Where `{` or `}` puts an edge when the playhead stands at `t`
 *  (decision 3): the start edge on the step standing there, the end edge
 *  just past it — at the next step, or at its own bar's end if that comes
 *  first, so marking the last note of a bar does not reach into a rest at
 *  the top of the next one. Before the first step, the bar's own barline. */
export function stepEdge(score: Score, steps: readonly Step[], t: number, edge: Edge): number {
  let i = -1;
  while (i + 1 < steps.length && steps[i + 1].at <= t + EPS) i++;
  if (i < 0) return edge === "start" ? barAt(score, t).start : barAt(score, t).end;
  if (edge === "start") return steps[i].at;
  const next = i + 1 < steps.length ? steps[i + 1].at : score.duration;
  return Math.min(next, barAt(score, steps[i].at).end);
}

/** Where a FINELY dragged edge snaps: the nearest attack or barline to
 *  `t` (decision 2), and — as with snapBar — never onto or past the other
 *  edge, so the loop keeps at least one step or bar in it. */
export function snapFine(
  score: Score, steps: readonly Step[], t: number, edge: Edge, range: BarRange | null,
): number {
  const span = barTime(score, range);
  const lines = score.bars.map((b) => (edge === "start" ? b.start : b.end));
  const ok = (x: number): boolean => (edge === "start" ? x < span.end - EPS : x > span.start + EPS);
  const candidates = [...lines, ...steps.map((s) => s.at)].filter(ok);
  if (candidates.length === 0) return edge === "start" ? span.start : span.end;
  return candidates.reduce((best, x) => (Math.abs(x - t) < Math.abs(best - t) ? x : best));
}

/** The bar a DRAGGED edge snaps to (decision 2): the start edge to the
 *  nearest barline at or before the other edge's bar, the end edge to the
 *  nearest barline at or after it — so a loop is never less than a bar.
 *  Unlike marking, a drag is continuous, and letting it shove the other
 *  edge away would lose that edge the moment the pointer wobbled past. */
export function snapBar(
  bars: readonly Bar[], t: number, edge: Edge, range: BarRange | null,
): number {
  const cur = range ?? { from: 0, to: bars.length - 1 };
  const line = (i: number) => (edge === "start" ? bars[i].start : bars[i].end);
  const [lo, hi] = edge === "start" ? [0, cur.to] : [cur.from, bars.length - 1];
  let best = lo;
  for (let i = lo; i <= hi; i++) if (Math.abs(line(i) - t) < Math.abs(line(best) - t)) best = i;
  return best;
}

export const Loop = { landing, stepFrom, withEdge, withBar, stepEdge, snapFine, snapBar };
