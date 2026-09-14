/* ====================================================================
   CORE — the one immutable value everything hangs off.
   A note is two facts about pitch kept deliberately separate:
     pitch    : MIDI number, the unambiguous physical truth (audio + linear staff)
     spelling : {letter, acc}, the notation choice (standard staff only)
   plus onset/duration already resolved to SECONDS. The core knows
   nothing of tempo, ticks, or beats. Downstream, time is just seconds.
   ==================================================================== */
import { pitchName } from "./pitch";
import type { Bar, Barline, Pitch, Spelling, Note, NoteId, Score, RawNote } from "./types";

// spelling: pick a default from pitch (sharps, per pitch.ts's one name
// table). Frozen into the value once, here-ish, so no output ever has to
// guess again.
export function defaultSpelling(pitch: Pitch): Spelling {
  const name = pitchName(pitch);
  return { letter: name[0] as Spelling["letter"], acc: name.length > 1 ? "#" : "" };
}

// a `score` is just: { notes: note[] (sorted by onset), duration: float,
// bars: bar[] }. `barlines` are the bar boundaries the parser found, in
// seconds, as FENCE POSTS: the start of every bar plus the end of the last
// one, each optionally carrying the meter and key that take effect there.
// Empty (a source with no meter) makes one 4/4 bar of the whole piece.
export function makeScore(rawNotes: readonly RawNote[], barlines: readonly Barline[] = []): Score {
  // sort first, then number: the id IS the post-sort index, so it is stable,
  // unique, and dense. This is the only place a Note is constructed, which is
  // what lets every consumer diff on `id` instead of on object identity.
  const notes: Note[] = rawNotes
    .map((n) => ({
      pitch: n.pitch,
      spelling: n.spelling ?? defaultSpelling(n.pitch),
      onset: n.onset,
      duration: n.duration,
      ...(n.hand !== undefined && { hand: n.hand }),
      ...(n.stream !== undefined && { stream: n.stream }),
    }))
    .sort((a, b) => a.onset - b.onset)
    .map((n, i) => ({ id: i as NoteId, ...n }));
  const duration = notes.reduce((m, n) => Math.max(m, n.onset + n.duration), 0);
  return { notes, duration, bars: makeBars(barlines, duration) };
}

/** Fence posts -> bars. Three repairs, each for a real source:
 *
 *  - a first post after 0 gets a bar prepended from 0 — a pickup that the
 *    source counted from its first full bar;
 *  - posts that never reach `duration` are continued at the last bar's
 *    length — a MIDI note that hangs past the final barline, or a file
 *    whose meter map stops early;
 *  - fewer than two usable posts is no meter at all, and the whole piece
 *    is one bar.
 *
 *  Duplicate and descending posts are dropped rather than trusted; a
 *  zero-length bar would be a bar nothing can ever be in. */
function makeBars(barlines: readonly Barline[], duration: number): Bar[] {
  // meter and key are carried FORWARD from post to post: a bare number
  // inherits, an object overrides what it names. Common time and no
  // sharps or flats until a source says otherwise.
  interface Post { at: number; beats: number; unit: number; fifths: number }
  const posts: Post[] = [];
  const given = barlines.map((b) => (typeof b === "number" ? { at: b } : b)).sort((a, b) => a.at - b.at);
  let sig = { beats: 4, unit: 4, fifths: 0 };
  for (const b of given) {
    sig = {
      beats: b.beats && b.beats > 0 ? b.beats : sig.beats,
      unit: b.unit && b.unit > 0 ? b.unit : sig.unit,
      fifths: b.fifths ?? sig.fifths,
    };
    if (b.at >= 0 && (posts.length === 0 || b.at > posts[posts.length - 1].at))
      posts.push({ at: b.at, ...sig });
  }
  if (posts.length > 0 && posts[0].at > 0) posts.unshift({ ...posts[0], at: 0 });
  if (posts.length < 2) return [{ index: 0, start: 0, end: duration, beats: 4, unit: 4, fifths: 0 }];
  const tail = posts[posts.length - 1];
  const last = tail.at - posts[posts.length - 2].at;
  while (posts[posts.length - 1].at < duration)
    posts.push({ ...tail, at: posts[posts.length - 1].at + last });
  return posts.slice(1).map((end, i) => ({
    index: i, start: posts[i].at, end: end.at,
    beats: posts[i].beats, unit: posts[i].unit, fifths: posts[i].fifths,
  }));
}

/** The bar containing score time `t`. Clamped at both ends, so a time past
 *  the piece names the last bar and a negative one the first — a caller
 *  asking "which bar is the cursor in" always gets a bar. */
export function barAt(score: Score, t: number): Bar {
  const { bars } = score;
  let lo = 0;
  for (let i = 1; i < bars.length && bars[i].start <= t; i++) lo = i;
  return bars[lo];
}

// which notes are sounding at time t — used by every output, same query.
// Callers key sets and maps on `n.id`; this returns the score's own Note
// objects, but nothing depends on that any more.
export function activeAt(score: Score, t: number): Note[] {
  return score.notes.filter((n) => t >= n.onset && t < n.onset + n.duration);
}

export const Core = { makeScore, activeAt, defaultSpelling, barAt };
