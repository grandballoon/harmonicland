/* ====================================================================
   PERFORM — score -> performance. The musical decisions about HOW the
   notes are played, made once per score and shared by every output: the
   built-in piano and a MIDI synth hear the same performance. Pure: no
   clock, no devices, no time passing (that is scheduler.ts).

   What it decides today:
   - each note's velocity. A score with real dynamics is played as written
     (a note the source left unmarked at DEFAULT_VELOCITY). A FLAT score —
     no velocities, or one velocity for nearly every note, which is what
     most notation exports write — is shaped, unless shaping is off: a
     small lift on the strong beats, and the lower hand a little under the
     upper, so plain scores stop sounding mechanical without being given an
     interpretation they do not have. The rare note at another velocity in
     a flat score is an accent someone meant, and keeps it. See
     SPEC_playback.md, "Shaping";
   - which notes are struck at all. Two voices meeting on a unison are
     one key: struck once, held for the longer of the two;
   - where each note really ends. A key cannot sound twice at once, so a
     note is cut where the next note on its pitch begins. Sources overlap
     repeated notes more often than one would think (a MIDI file's legato,
     a tie resolved to two notes), and left alone the first note's release
     would silence the second;
   - when each note's dampers fall (`damp`): at its key-up, or — when the
     sustain pedal is down then — where the pedal lifts. A note let go of
     at the very instant the pedal goes down is NOT caught: that is a pedal
     change clearing the old harmony, the whole point of changing it. The
     built-in piano sounds `damp`; a MIDI synth is sent the pedal itself
     and sustains by its own lights.
   ==================================================================== */
import type { Bar, Note, NoteId, Pitch, Score, TimeRange } from "./types";

/** What a note is played at when nothing says otherwise: mezzo-forte. */
export const DEFAULT_VELOCITY = 80;

/** Shaping, as offsets from a base a little under mezzo-forte. */
const SHAPE_BASE = 72;
const SHAPE_DOWNBEAT = 8;
const SHAPE_SECONDARY = 4;
const SHAPE_LOWER_HAND = -6;

export interface PerformOptions {
  /** Shape a flat score (see above). On unless turned off. */
  readonly shape?: boolean;
}

export interface PerfNote {
  readonly id: NoteId;
  readonly pitch: Pitch;
  readonly velocity: number;
  /** Seconds, as in the score. */
  readonly onset: number;
  /** Seconds — the key-up: the score's end, or earlier where the key is
   *  struck again. */
  readonly end: number;
  /** Seconds — when the dampers fall: `end`, or later where the sustain
   *  pedal holds them off; never past the key's next strike. */
  readonly damp: number;
}

/** A score as it will be played: notes sorted by onset, like the score's,
 *  and where the sustain pedal is down (Score.pedal). */
export interface Performance {
  readonly notes: readonly PerfNote[];
  readonly pedal: readonly TimeRange[];
}

/** Where the pedal lifts, when it is down at `t` (and went down before
 *  it); otherwise `t`. The ranges are sorted and never overlap. */
function heldTo(pedal: readonly TimeRange[], t: number): number {
  let lo = 0;
  let hi = pedal.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (pedal[mid].end <= t) lo = mid + 1;
    else hi = mid;
  }
  const r = pedal[lo];
  return r && r.start < t ? r.end : t;
}

/** A flat score's one velocity must cover at least this share of it. */
const FLAT_SHARE = 0.95;

/** The velocity (or absence of one) a flat score plays nearly all its
 *  notes at, or null when the score has dynamics of its own. */
function flatVelocity(score: Score): number | undefined | null {
  const counts = new Map<number | undefined, number>();
  for (const n of score.notes) counts.set(n.velocity, (counts.get(n.velocity) ?? 0) + 1);
  let common: number | undefined;
  let most = 0;
  for (const [v, c] of counts) if (c > most) [common, most] = [v, c];
  return most >= FLAT_SHARE * score.notes.length ? common : null;
}

/** No dynamics of its own: nearly every note at one velocity, or none. */
export const isFlat = (score: Score): boolean => flatVelocity(score) !== null;

/** How strong a beat the instant `t` falls on in `bar`: the downbeat, the
 *  bar's secondary strong beat (the middle of an even meter of four or
 *  more beats: 4/4's third, 6/8's fourth), or neither. */
function metricLift(bar: Bar, t: number): number {
  const len = bar.end - bar.start;
  const near = (x: number): boolean => Math.abs(t - x) < Math.min(0.03, len / 64);
  if (near(bar.start)) return SHAPE_DOWNBEAT;
  if (bar.beats >= 4 && bar.beats % 2 === 0 && near(bar.start + len / 2)) return SHAPE_SECONDARY;
  return 0;
}

/** Every note's velocity, by the rules above, in score order. */
function velocities(score: Score, shape: boolean): number[] {
  const flat = flatVelocity(score);
  if (!shape || flat === null) return score.notes.map((n) => n.velocity ?? DEFAULT_VELOCITY);
  // notes and bars are both in time order: walk them together
  let b = 0;
  return score.notes.map((n) => {
    while (b + 1 < score.bars.length && score.bars[b + 1].start <= n.onset + 1e-9) b++;
    if (n.velocity !== flat) return n.velocity ?? DEFAULT_VELOCITY; // an accent: kept
    const hand = n.hand === "lower" ? SHAPE_LOWER_HAND : 0;
    return SHAPE_BASE + metricLift(score.bars[b], n.onset) + hand;
  });
}

export function perform(score: Score, { shape = true }: PerformOptions = {}): Performance {
  const velocity = new Map<NoteId, number>();
  velocities(score, shape).forEach((v, i) => velocity.set(score.notes[i].id, v));
  // score.notes is sorted by onset, so a unison's two notes are met in turn.
  // The louder of the two decides how hard the one key is struck.
  const keys: Note[] = [];
  const struck = new Map<string, number>(); // "pitch@onset" -> index in keys
  for (const n of score.notes) {
    const k = `${n.pitch}@${n.onset}`;
    const i = struck.get(k);
    if (i === undefined) {
      struck.set(k, keys.length);
      keys.push(n);
    } else {
      const loud = Math.max(velocity.get(n.id)!, velocity.get(keys[i].id)!);
      if (n.duration > keys[i].duration) keys[i] = n;
      velocity.set(keys[i].id, loud);
    }
  }
  // walking backwards meets each note's next same-pitch neighbour first
  const nextOnset = new Map<Pitch, number>();
  const notes: PerfNote[] = new Array(keys.length);
  for (let i = keys.length - 1; i >= 0; i--) {
    const n = keys[i];
    const next = nextOnset.get(n.pitch) ?? Infinity;
    const end = Math.min(n.onset + n.duration, next);
    notes[i] = {
      id: n.id,
      pitch: n.pitch,
      velocity: velocity.get(n.id)!,
      onset: n.onset,
      end,
      damp: Math.min(heldTo(score.pedal, end), next),
    };
    nextOnset.set(n.pitch, n.onset);
  }
  return { notes, pedal: score.pedal };
}

/** Index of the first note with onset >= t (binary search). */
export function firstAtOrAfter(p: Performance, t: number): number {
  let lo = 0;
  let hi = p.notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (p.notes[mid].onset < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
