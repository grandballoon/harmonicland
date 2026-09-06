/* ====================================================================
   CORE — the one immutable value everything hangs off.
   A note is two facts about pitch kept deliberately separate:
     pitch    : MIDI number, the unambiguous physical truth (audio + linear staff)
     spelling : {letter, acc}, the notation choice (standard staff only)
   plus onset/duration already resolved to SECONDS. The core knows
   nothing of tempo, ticks, or beats. Downstream, time is just seconds.
   ==================================================================== */
import type { Pitch, Spelling, Note, Score, RawNote, Bar } from "./types";

// spelling: pick a default from pitch (sharps). Frozen into the value
// once, here-ish, so no output ever has to guess again.
const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;

export function defaultSpelling(pitch: Pitch): Spelling {
  const name = SHARP_NAMES[((pitch % 12) + 12) % 12];
  return { letter: name[0] as Spelling["letter"], acc: name.length > 1 ? "#" : "" };
}

// a `score` is just: { notes: note[] (sorted by onset), duration: float,
// bars: bar[] (sorted by time; empty when the input states no measures) }
export function makeScore(rawNotes: readonly RawNote[], rawBars: readonly Bar[] = []): Score {
  const notes: Note[] = rawNotes
    .map((n) => ({
      pitch: n.pitch,
      spelling: n.spelling ?? defaultSpelling(n.pitch),
      onset: n.onset,
      duration: n.duration,
      // spread, not `staff: n.staff` — a format that states no staff leaves
      // the key absent rather than present-and-undefined, so "this input
      // carries no staves" stays distinguishable from "this note has none".
      ...(n.staff === undefined ? {} : { staff: n.staff }),
    }))
    .sort((a, b) => a.onset - b.onset);
  const duration = notes.reduce((m, n) => Math.max(m, n.onset + n.duration), 0);
  const bars = [...rawBars].sort((a, b) => a.time - b.time);
  return { notes, duration, bars };
}

// which notes are sounding at time t — used by every output, same query.
export function activeAt(score: Score, t: number): Note[] {
  return score.notes.filter((n) => t >= n.onset && t < n.onset + n.duration);
}

/* ---- bar grid ------------------------------------------------------
   Two pure queries over `bars`, kept here beside activeAt because they are
   the same kind of thing: a question about the score at time t. The
   transport asks them; it owns no notion of what a bar is. */

const EPS = 1e-6; // a seek lands exactly on a boundary; float drift must not push it back a bar

/** Index of the bar containing t, or -1 when the score has no bar grid. */
export function barIndexAt(score: Score, t: number): number {
  const { bars } = score;
  if (!bars.length) return -1;
  let i = 0;
  while (i + 1 < bars.length && bars[i + 1].time <= t + EPS) i++;
  return i;
}

// How far into a bar you may be and still have "back" mean "previous bar"
// rather than "restart this one" — the same forgiveness a DAW's rewind has.
const RESTART_AFTER = 0.12; // seconds of SCORE time, so it is speed-independent

/** Where the playhead lands when stepping one bar from t. Forward goes to the
 *  next bar's start (the end of the score at the last bar); back restarts the
 *  current bar unless you are already sitting at its start, which is what
 *  makes repeated taps walk backwards instead of sticking. */
export function barStep(score: Score, t: number, dir: -1 | 1): number {
  const { bars } = score;
  if (!bars.length) return t;
  const i = barIndexAt(score, t);
  if (dir > 0) return i + 1 < bars.length ? bars[i + 1].time : score.duration;
  if (t - bars[i].time > RESTART_AFTER) return bars[i].time;
  return bars[Math.max(0, i - 1)].time;
}

export const Core = { makeScore, activeAt, defaultSpelling, barIndexAt, barStep };
