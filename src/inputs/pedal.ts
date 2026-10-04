/* ====================================================================
   PEDAL — a source's sustain-pedal markings -> the ranges it is down
   (Score.pedal). Shared by the parsers: each collects down/up marks at the
   score time they stand at, in the order it met them, and this turns them
   into ranges.

   Marks at one instant keep their source order, which is what makes a
   pedal CHANGE — up then down at the same moment — come out as two
   ranges that touch rather than one that never lifts. A down while down
   and an up while up change nothing; a pedal still down at the end is
   held to the end of the piece.
   ==================================================================== */
import type { TimeRange } from "../types";

export interface PedalMark {
  readonly at: number;
  readonly down: boolean;
}

export function pedalRanges(marks: readonly PedalMark[]): TimeRange[] {
  // a stable sort: marks at one instant stay in the order they were met
  const sorted = marks.map((m, i) => ({ m, i })).sort((a, b) => a.m.at - b.m.at || a.i - b.i);
  const out: TimeRange[] = [];
  let downAt: number | null = null;
  for (const { m } of sorted) {
    if (m.down && downAt === null) downAt = m.at;
    else if (!m.down && downAt !== null) {
      out.push({ start: downAt, end: m.at });
      downAt = null;
    }
  }
  if (downAt !== null) out.push({ start: downAt, end: Infinity }); // makeScore clamps it
  return out;
}
