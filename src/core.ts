/* ====================================================================
   CORE — the one immutable value everything hangs off.
   A note is two facts about pitch kept deliberately separate:
     pitch    : MIDI number, the unambiguous physical truth (audio + linear staff)
     spelling : {letter, acc}, the notation choice (standard staff only)
   plus onset/duration already resolved to SECONDS. The core knows
   nothing of tempo, ticks, or beats. Downstream, time is just seconds.
   ==================================================================== */
import type { Pitch, Spelling, Note, Score, RawNote } from "./types";

// spelling: pick a default from pitch (sharps). Frozen into the value
// once, here-ish, so no output ever has to guess again.
const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;

export function defaultSpelling(pitch: Pitch): Spelling {
  const name = SHARP_NAMES[((pitch % 12) + 12) % 12];
  return { letter: name[0] as Spelling["letter"], acc: name.length > 1 ? "#" : "" };
}

// a `score` is just: { notes: note[] (sorted by onset), duration: float }
export function makeScore(rawNotes: readonly RawNote[]): Score {
  const notes: Note[] = rawNotes
    .map((n) => ({
      pitch: n.pitch,
      spelling: n.spelling ?? defaultSpelling(n.pitch),
      onset: n.onset,
      duration: n.duration,
      ...(n.staff !== undefined && { staff: n.staff }),
    }))
    .sort((a, b) => a.onset - b.onset);
  const duration = notes.reduce((m, n) => Math.max(m, n.onset + n.duration), 0);
  return { notes, duration };
}

// which notes are sounding at time t — used by every output, same query.
export function activeAt(score: Score, t: number): Note[] {
  return score.notes.filter((n) => t >= n.onset && t < n.onset + n.duration);
}

// the lowest staff number present = the score's UPPER staff (right hand in
// piano music). Staff numbering varies by source (MIDI note tracks may start
// at 2 behind a tempo track), so hand-coloring normalizes against this.
export function upperStaff(score: Score): number {
  let lo = Infinity;
  for (const n of score.notes) if (n.staff !== undefined && n.staff < lo) lo = n.staff;
  return lo === Infinity ? 1 : lo;
}

export const Core = { makeScore, activeAt, defaultSpelling, upperStaff };
