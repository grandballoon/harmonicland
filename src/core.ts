/* ====================================================================
   CORE — the one immutable value everything hangs off.
   A note is two facts about pitch kept deliberately separate:
     pitch    : MIDI number, the unambiguous physical truth (audio + linear staff)
     spelling : {letter, acc}, the notation choice (standard staff only)
   plus onset/duration already resolved to SECONDS. The core knows
   nothing of tempo, ticks, or beats. Downstream, time is just seconds.
   ==================================================================== */
import { pitchName } from "./pitch";
import type { Bar, BarRange, Barline, Pitch, Spelling, Note, NoteId, Score, RawNote, TimeRange } from "./types";

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

/** Clamp a range to the bars that exist, with `from <= to`, so a caller
 *  can say "bars 3 to 1" or "bar 40 of 12" and be understood. A trim
 *  survives only on an edge left where it was: one pulled in from past the
 *  piece, or swapped with the other, was never a point in the bar it lands
 *  on. Takes a bar COUNT, so it can be asked before a score's meters are;
 *  normalizeRange is the full answer once they are. */
export function clampRange(r: BarRange, bars: number): BarRange {
  const hi = Math.max(0, bars - 1);
  const a = Math.max(0, Math.min(r.from, hi));
  const b = Math.max(0, Math.min(r.to, hi));
  if (a > b) return { from: b, to: a };
  return {
    from: a, to: b,
    ...(a === r.from && r.fromBeat !== undefined && { fromBeat: r.fromBeat }),
    ...(b === r.to && r.toBeat !== undefined && { toBeat: r.toBeat }),
  };
}

/** Beats this close to a barline are ON it: a trim is a point strictly
 *  inside its bar, and a hair from the edge is floating point, not intent. */
const BEAT_EPS = 1e-6;

/** Score seconds `beat` beats into bar `b`, beats counted from 0. Linear
 *  within the bar, as the bar's own two instants are all the model knows
 *  of its tempo. */
export const timeOfBeat = (b: Bar, beat: number): number =>
  b.start + ((b.end - b.start) * beat) / b.beats;

/** How many of its own beats into bar `b` score time `t` falls — the
 *  inverse of timeOfBeat. */
export const beatOfTime = (b: Bar, t: number): number =>
  b.end > b.start ? ((t - b.start) / (b.end - b.start)) * b.beats : 0;

/** A range clamped (clampRange) with every trim strictly inside its bar,
 *  so each range has one spelling (types.ts, BarRange). A trim on a
 *  barline is dropped — or, at the far barline, moves the edge to the
 *  neighbouring bar whole: a start trimmed to the END of its bar begins at
 *  the next, an end trimmed to the START of its bar finishes with the one
 *  before. A one-bar range trimmed to nothing keeps its start and lets
 *  the end go to the barline. */
export function normalizeRange(score: Score, range: BarRange): BarRange {
  const r = clampRange(range, score.bars.length);
  let { from, to } = r;
  let head = r.fromBeat;
  let tail = r.toBeat;
  const beats = (i: number): number => score.bars[i].beats;
  if (head !== undefined && !(head > BEAT_EPS)) head = undefined;
  if (head !== undefined && head >= beats(from) - BEAT_EPS) {
    head = undefined;
    if (from < to) from++;
  }
  if (tail !== undefined && !(tail < beats(to) - BEAT_EPS)) tail = undefined;
  if (tail !== undefined && tail <= BEAT_EPS) {
    tail = undefined;
    if (to > from) to--;
  }
  if (from === to && head !== undefined && tail !== undefined && tail <= head + BEAT_EPS) tail = undefined;
  return { from, to, ...(head !== undefined && { fromBeat: head }), ...(tail !== undefined && { toBeat: tail }) };
}

/** Do two ranges name the same stretch of the piece? Null is the whole. */
export const sameRange = (a: BarRange | null, b: BarRange | null): boolean =>
  a === null || b === null
    ? a === b
    : a.from === b.from && a.to === b.to && a.fromBeat === b.fromBeat && a.toBeat === b.toBeat;

/** A trimmed edge within a microsecond of an attack lands ON it. Edges are
 *  set at attacks and stored in beats, and the trip there and back is
 *  floating point: without this, the note an edge was set on could fall a
 *  hair outside a range that is meant to begin with it. */
const onAttack = (score: Score, t: number): number =>
  score.notes.find((n) => Math.abs(n.onset - t) < 1e-6)?.onset ?? t;

/** The seconds a run of bars covers: from the first bar's start to the last
 *  bar's end, or to the trims when it has them. Null is the whole piece,
 *  so "no bars chosen" and "all of it" are one answer. The one conversion
 *  from bars to time — the practice cursor's span and the playback loop
 *  both stand on it. */
export function barTime(score: Score, range: BarRange | null): TimeRange {
  if (range === null) return { start: 0, end: score.duration };
  const r = normalizeRange(score, range);
  const a = score.bars[r.from];
  const b = score.bars[r.to];
  return {
    start: r.fromBeat === undefined ? a.start : onAttack(score, timeOfBeat(a, r.fromBeat)),
    end: r.toBeat === undefined ? b.end : onAttack(score, timeOfBeat(b, r.toBeat)),
  };
}

// which notes are sounding at time t — used by every output, same query.
// Callers key sets and maps on `n.id`; this returns the score's own Note
// objects, but nothing depends on that any more.
export function activeAt(score: Score, t: number): Note[] {
  return score.notes.filter((n) => t >= n.onset && t < n.onset + n.duration);
}

export const Core = {
  makeScore, activeAt, defaultSpelling, barAt, clampRange, normalizeRange, sameRange, timeOfBeat, beatOfTime, barTime,
};
