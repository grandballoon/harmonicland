/* ====================================================================
   RANGE_MARKS — the isolated range as it is drawn over engraved bars: a
   panel under the bars, and a GRIP, a small upright pill, at each of its
   two ends that drags that end. Shared by every page that engraves bars
   — the practice strip, and both engravers' whole-score sheets — so the
   panel, the grips and the hit-test that finds them are one geometry.

   Pure: placed bars in, markup or a hit out. It knows nothing of pointers
   or of the selection; main.ts turns a grip dragged to a point into an
   edge moved (loop.ts), by the same path a dragged flag takes.

   Three decisions:

   1. AN ENGRAVER'S BAR IS A MarkBar: its barlines' x and, for each
      instant a note is struck in it, a STOP — that instant in quarters
      from the barline, and the x of its heads. That is all either
      engraver has to say, and all the marks need.

   2. A TRIMMED END SITS BETWEEN COLUMNS: midway from the last struck
      column outside the range to the first inside, so the panel's edge,
      and the grip on it, never cut through a notehead.

   3. A GRIP DRAGS TO THE PLACES AN END CAN SIT: a barline, or the gap
      before a struck column (decision 2). `timeAt` answers with the score
      time of the nearest such place to the pointer, in the engraver's
      quantized time; loop.ts snaps that onto the step it names.
   ==================================================================== */
import { quartersPerBar, snap, type EngravedBar, type Head } from "./engrave";
import type { Bar, BarRange } from "../types";

/** An instant a note is struck in a placed bar (decision 1). */
export interface Stop {
  /** Quarters from the bar's opening barline, on the engraver's grid. */
  readonly q: number;
  readonly x: number;
}

/** One bar as placed on a line, whichever engraver set it, in that
 *  line's units. `stops` are in order of time. */
export interface MarkBar {
  readonly bar: Bar;
  readonly x0: number;
  readonly x1: number;
  readonly stops: readonly Stop[];
}

/** Which end of the range a grip moves. The same two names loop.ts gives
 *  a loop's edges, because it is the same edge. */
export type End = "start" | "end";

const Q_EPS = 1e-6;
/** A grip: its width, and the most of the panel's height it stands. */
const GRIP_W = 6;
const GRIP_H = 30;
/** How far either side of a grip a pointer still takes hold of it —
 *  wider than the pill, since a finger or a trackpad is not a pen. */
export const GRIP_REACH = 9;

/** The struck instants of an engraved bar, placed by `xOf`: one stop per
 *  instant a head begins a note (a tied continuation is not struck), at
 *  the leftmost of its heads that `xOf` could place. */
export function stopsOf(eb: EngravedBar, xOf: (h: Head) => number | undefined): Stop[] {
  const at = new Map<number, number>();
  for (const c of eb.chords)
    for (const h of c.heads) {
      if (h.tiedFrom) continue;
      const x = xOf(h);
      if (x === undefined) continue;
      at.set(h.q, Math.min(at.get(h.q) ?? Infinity, x));
    }
  return [...at].map(([q, x]) => ({ q, x })).sort((a, b) => a.q - b.q);
}

/** Where an end `beat` beats into bar `b` is drawn (decision 2). */
export function beatX(b: MarkBar, beat: number): number {
  const q = snap((beat * 4) / b.bar.unit);
  const i = b.stops.findIndex((s) => s.q >= q - Q_EPS);
  if (i < 0) return b.x1;
  return ((i > 0 ? b.stops[i - 1].x : b.x0) + b.stops[i].x) / 2;
}

/** The range's stretch of one line: where its panel begins and ends, and
 *  whether the range's own start and end are on this line — a range over
 *  several lines has a grip only where it really begins and ends. Null
 *  when none of it is on the line. */
export function spanOnLine(
  bars: readonly MarkBar[], r: BarRange,
): { xa: number; xb: number; start: boolean; end: boolean } | null {
  const on = bars.filter((b) => b.bar.index >= r.from && b.bar.index <= r.to);
  if (!on.length) return null;
  const a = on[0];
  const b = on[on.length - 1];
  const start = a.bar.index === r.from;
  const end = b.bar.index === r.to;
  return {
    xa: start && r.fromBeat !== undefined ? beatX(a, r.fromBeat) : a.x0,
    xb: end && r.toBeat !== undefined ? beatX(b, r.toBeat) : b.x1,
    start, end,
  };
}

/** The panel under the range's stretch of a line, `y` to `y + h`. */
export function panelMarkup(bars: readonly MarkBar[], r: BarRange, y: number, h: number): string {
  const s = spanOnLine(bars, r);
  if (!s) return "";
  return `<rect x="${s.xa}" y="${y}" width="${Math.max(0, s.xb - s.xa)}" height="${h}" rx="4" fill="var(--panel)"/>`;
}

/** The grips on a line, over the music, centred on the panel's height. */
export function gripsMarkup(bars: readonly MarkBar[], r: BarRange, y: number, h: number): string {
  const s = spanOnLine(bars, r);
  if (!s) return "";
  const gh = Math.min(GRIP_H, h * 0.4);
  const pill = (x: number): string =>
    `<rect x="${x - GRIP_W / 2}" y="${y + (h - gh) / 2}" width="${GRIP_W}" height="${gh}" rx="${GRIP_W / 2}" ` +
    `fill="var(--grip)" stroke="var(--bg)" stroke-width="1.5"/>`;
  return (s.start ? pill(s.xa) : "") + (s.end ? pill(s.xb) : "");
}

/** Which grip a point `x` on the line is on, or null. A range too short to
 *  hold the two apart gives the nearer. */
export function gripAt(bars: readonly MarkBar[], r: BarRange, x: number, reach = GRIP_REACH): End | null {
  const s = spanOnLine(bars, r);
  if (!s) return null;
  const da = s.start ? Math.abs(x - s.xa) : Infinity;
  const db = s.end ? Math.abs(x - s.xb) : Infinity;
  if (Math.min(da, db) > reach) return null;
  return da <= db ? "start" : "end";
}

/** The score time of the place an end can sit that is nearest `x` on the
 *  line (decision 3), or null for a line with no bars. */
export function timeAt(bars: readonly MarkBar[], x: number): number | null {
  let best: { d: number; t: number } | null = null;
  const consider = (cx: number, t: number): void => {
    const d = Math.abs(x - cx);
    if (!best || d < best.d) best = { d, t };
  };
  for (const b of bars) {
    const qSec = (b.bar.end - b.bar.start) / quartersPerBar(b.bar);
    consider(b.x0, b.bar.start);
    b.stops.forEach((s, i) => {
      if (s.q > Q_EPS) consider(((i > 0 ? b.stops[i - 1].x : b.x0) + s.x) / 2, b.bar.start + s.q * qSec);
    });
    consider(b.x1, b.bar.end);
  }
  return best === null ? null : (best as { t: number }).t;
}

export const RangeMarks = { stopsOf, beatX, spanOnLine, panelMarkup, gripsMarkup, gripAt, timeAt, GRIP_REACH };
