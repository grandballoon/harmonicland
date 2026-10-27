/* ====================================================================
   ALIGNMENT — a score put to the timing of a recording of it. Pure:
   anchors in, seconds out. Where anchors are kept is alignment-store.ts;
   how they are tapped in is recording-row.ts; what plays the recording is
   outputs/recording.ts.

   Three decisions, stated because they are decisions:

   1. THE SCORE MOVES, NOT THE RECORDING. A played recording has rubato and
      a written score has none, so one of them has to give. Bending the
      recording to the score's tempo would destroy the very thing it is
      listened to for. So the score is retimed (Core.warp): its seconds
      become the recording's, and the clock, the loop, the steps and every
      view go on speaking seconds without knowing whose they are.

   2. AN ANCHOR IS A BARLINE. `bar` counts barlines as fence posts: barline
      i opens bar i, and barline `bars.length` closes the piece. Between
      two barlines time runs evenly, because that is all the model knows of
      a bar's tempo (Core.timeOfBeat) and what the engraver reads note
      values from — an anchor inside a bar would turn its quarters into
      something else on the page. Rubato within a bar is therefore not
      followed; the bar as a whole is.

   3. NOT EVERY BARLINE NEEDS ONE. Barlines between two anchors share out
      the recording's time in the proportions the score gives them, so the
      score's own tempo changes survive where nobody tapped. Before the
      first anchor and after the last, the recording is taken to keep the
      pace of the nearest anchored stretch — or the score's own, when there
      is only one anchor, which then says no more than where it starts.

   The retimed score still begins at 0, as every score does. Where the
   recording has that instant is `lead`: its applause, its silence, its
   announcer. It can be negative — a recording that starts mid-piece.
   ==================================================================== */
import { Core } from "./core";
import type { Score } from "./types";

/** Where one barline is heard: `at` seconds into the recording. */
export interface Anchor {
  readonly bar: number;
  readonly at: number;
}

/** Anchors in order, each on a barline that exists and each later in the
 *  recording than the one before. What breaks that is dropped, not
 *  trusted: a barline heard before an earlier one is a slip of the hand. */
export function clean(anchors: readonly Anchor[], bars: number): Anchor[] {
  const out: Anchor[] = [];
  const usable = anchors.filter((a) =>
    Number.isInteger(a.bar) && a.bar >= 0 && a.bar <= bars && Number.isFinite(a.at) && a.at >= 0);
  for (const a of usable.sort((x, y) => x.bar - y.bar || x.at - y.at)) {
    const last = out[out.length - 1];
    if (last && (a.bar === last.bar || a.at <= last.at)) continue;
    out.push({ bar: a.bar, at: a.at });
  }
  return out;
}

/** Place one barline. The new anchor wins: the old one on its barline goes,
 *  and so does any other it has just contradicted — an earlier barline it
 *  is now heard before, a later one it is heard after. */
export function set(anchors: readonly Anchor[], a: Anchor): Anchor[] {
  const kept = anchors.filter((o) => (o.bar < a.bar && o.at < a.at) || (o.bar > a.bar && o.at > a.at));
  return [...kept, a].sort((x, y) => x.bar - y.bar);
}

/** When each barline is heard, in recording seconds: one per fence post,
 *  the anchored ones where they were put and the rest by decision 3. With
 *  no anchors, the score's own barlines. */
export function barlines(score: Score, anchors: readonly Anchor[]): number[] {
  const { bars } = score;
  const written = [...bars.map((b) => b.start), bars[bars.length - 1].end];
  const known = clean(anchors, bars.length);
  if (known.length === 0) return written;
  /** Recording seconds per score second between anchors k and k + 1. */
  const pace = (k: number): number =>
    (known[k + 1].at - known[k].at) / (written[known[k + 1].bar] - written[known[k].bar]);
  const head = known.length > 1 ? pace(0) : 1;
  const tail = known.length > 1 ? pace(known.length - 2) : 1;
  let k = 0;
  return written.map((w, bar) => {
    while (k + 1 < known.length && known[k + 1].bar <= bar) k++;
    const a = known[k];
    if (bar < a.bar) return a.at - (written[a.bar] - w) * head;
    if (k + 1 === known.length) return a.at + (w - written[a.bar]) * tail;
    return a.at + (w - written[a.bar]) * pace(k);
  });
}

/** The score at the recording's timing, and where in the recording it
 *  begins. With no anchors, the score itself, beginning where the
 *  recording does. */
export function retime(score: Score, anchors: readonly Anchor[]): { score: Score; lead: number } {
  if (clean(anchors, score.bars.length).length === 0) return { score, lead: 0 };
  const heard = barlines(score, anchors);
  const lead = heard[0];
  const warped = Core.warp(score, (t) => {
    const b = Core.barAt(score, t);
    const from = heard[b.index] - lead;
    return from + ((t - b.start) / (b.end - b.start)) * (heard[b.index + 1] - lead - from);
  });
  return { score: warped, lead };
}

/** Anchors read back from storage, or from anything else untrusted. */
export function parse(raw: unknown): Anchor[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((a: unknown) => {
    const { bar, at } = (a ?? {}) as Partial<Anchor>;
    return typeof bar === "number" && typeof at === "number" ? [{ bar, at }] : [];
  });
}

export const Alignment = { clean, set, barlines, retime, parse };
