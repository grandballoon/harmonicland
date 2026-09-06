/* ====================================================================
   GUITAR — an Instrument whose configuration is a fretting.

   This module is the seam's proof. Nothing outside `src/instruments/`
   changed to add it: the solver that plans a piano fingering plans a
   guitar fretting with the same dozen lines, because "which finger" and
   "which fret" are the same question — pick one of several ways to hold
   this sonority, given where the hand already is.

   What genuinely differs from the piano is TWO things, and they are
   both real rather than cosmetic:

   The neck is one-to-many. A pitch lives at up to six places, so a
   candidate is an assignment of notes to distinct STRINGS, and the
   candidate count is combinatorial where the piano's was a handful.

   Unplayability is ordinary. A guitar starts at E2 and stops six notes
   wide; a piano score does neither. Over the Chopin prelude most states
   have no fretting at all, and that is the honest answer the solver was
   built to carry — `candidates` returns nothing and the plan records a
   `null` rather than inventing a chord nobody has hands for.

   The prose differs too: a guitarist navigates by SHAPE, not by
   landmark, so `describe` names the open and barre shapes it recognises
   and falls back to string-and-fret. That is exactly why `describe`
   lives inside the instrument.
   ==================================================================== */
import { PC_NAMES, triadOf, type Quality } from "../harmony/triads";
import { cap, count, times } from "../words";
import type { Note } from "../types";
import type { State, Transition } from "../states";
import type { Instrument } from "./solver";
import {
  describePosition, ordinal, positionsFor, STANDARD, stringNumber, type Tuning,
} from "./guitar-geometry";

/** One note, and the place on the neck that sounds it. */
export interface Stop {
  readonly note: Note;
  /** Index into the tuning, lowest string first — see guitar-geometry. */
  readonly string: number;
  readonly fret: number;
}

/** One physical way to hold a sonority.
 *
 *  `stops` is ordered by STRING, not by pitch, because that is the order
 *  a chord is read and played in — and because the two orders can differ:
 *  an open B string sounds above a stopped G string.
 *
 *  `repeat` rides along for the same reason it does on the piano:
 *  `describe` never sees a state, and "strum it four times" is part of
 *  the instruction. */
export interface Fretting {
  readonly tuning: Tuning;
  readonly stops: readonly Stop[];
  /** The fret laid across by the index finger, or null for no barre. */
  readonly barre: number | null;
  readonly repeat: number;
}

/* -------- the shape of a hand on a neck ----------------------------- */

/** Frets the fretting hand covers without shifting position. */
const REACH = 4;
/** Frets it covers without stretching at all. */
const COMFORT = 2;
/** Fingers available to stop strings. The thumb is not one of them here;
 *  players who fret with it are doing something this model does not name. */
const FINGERS = 4;

/** How many frettings to keep per state. The neck offers dozens of ways
 *  to voice a chord and they are not all worth planning over: what the
 *  solver needs is a few genuinely different NECK POSITIONS, which the
 *  best few by intrinsic difficulty already spans. */
const PER_STATE = 24;

/* -------- cost weights ---------------------------------------------- */

const FINGER = 1; // per finger the shape needs
const STRETCH = 2; // per fret of span beyond COMFORT
const BARRE = 2; // one finger doing the work of several
const POSITION = 0.2; // mild preference for the low, open end of the neck
const CROSS = 1; // per pair of notes whose string order fights their pitch
const MOVE = 1; // per fret the hand slides
const HOLD = 3; // discount per finger that does not have to move

/** Where the fretting hand sits, in frets: the lowest stopped fret, or
 *  null when the chord is entirely open and the hand is nowhere. */
const handAt = (f: Fretting): number | null => {
  const fretted = f.stops.filter((s) => s.fret > 0);
  return fretted.length ? Math.min(...fretted.map((s) => s.fret)) : null;
};

/** Fingers the shape needs. A barre is one finger however many strings it
 *  covers, which is the entire reason barre chords exist. */
const fingerCount = (stops: readonly Stop[], barre: number | null): number => {
  const fretted = stops.filter((s) => s.fret > 0);
  if (barre === null) return fretted.length;
  return 1 + fretted.filter((s) => s.fret !== barre).length;
};

/** A barre is a straight finger across a run of strings, so an OPEN string
 *  lying inside that run is not merely awkward, it is impossible — the
 *  finger is already on it. Strings outside the run are free. */
const barreIsLegal = (stops: readonly Stop[], barre: number): boolean => {
  const barred = stops.filter((s) => s.fret === barre).map((s) => s.string);
  if (barred.length < 2) return false;
  const lo = Math.min(...barred);
  const hi = Math.max(...barred);
  return !stops.some((s) => s.fret === 0 && s.string > lo && s.string < hi);
};

/** How hard this shape is on its own, before any question of moving to it.
 *  Used twice, deliberately: to rank candidates, and as the standing term
 *  of `cost`, so the two can never disagree about what is difficult. */
function difficulty(f: Fretting): number {
  const fretted = f.stops.filter((s) => s.fret > 0);
  const span = fretted.length
    ? Math.max(...fretted.map((s) => s.fret)) - Math.min(...fretted.map((s) => s.fret))
    : 0;
  let crossings = 0;
  for (let i = 1; i < f.stops.length; i++)
    if (f.stops[i].note.pitch < f.stops[i - 1].note.pitch) crossings++;
  return (
    FINGER * fingerCount(f.stops, f.barre) +
    STRETCH * Math.max(0, span - COMFORT) +
    (f.barre === null ? 0 : BARRE) +
    POSITION * (handAt(f) ?? 0) +
    CROSS * crossings
  );
}

/* -------- candidate generation --------------------------------------- */

/** Every assignment of the sonority's notes to distinct strings that a
 *  hand could actually hold, best few first.
 *
 *  The search is a DFS over notes in pitch order, pruned as it goes by the
 *  fret span, which is what keeps a combinatorial space small: a note
 *  whose only positions are five frets from where the hand already is
 *  kills its whole branch immediately. */
function frettings(state: State, tuning: Tuning): Fretting[] {
  const notes = state.notes;
  if (!notes.length || notes.length > tuning.length) return [];

  // Every note must be reachable, or the sonority is off the instrument.
  const options = notes.map((n) => positionsFor(n.pitch, tuning));
  if (options.some((o) => !o.length)) return [];

  const out: Fretting[] = [];
  const used = new Set<number>();
  const acc: Stop[] = [];

  const emit = () => {
    const stops = [...acc].sort((a, b) => a.string - b.string);
    // Both readings of the same grip: barred, and each finger on its own.
    // The finger budget decides which survive, and cost prefers the free
    // hand when both do.
    const low = handAt({ tuning, stops, barre: null, repeat: state.repeat });
    for (const barre of low !== null && barreIsLegal(stops, low) ? [null, low] : [null]) {
      if (fingerCount(stops, barre) > FINGERS) continue;
      out.push({ tuning, stops, barre, repeat: state.repeat });
    }
  };

  const walk = (i: number, lo: number, hi: number) => {
    if (i === notes.length) return emit();
    for (const pos of options[i]) {
      if (used.has(pos.string)) continue;
      // Open strings need no finger and so constrain no position.
      const nlo = pos.fret > 0 ? Math.min(lo, pos.fret) : lo;
      const nhi = pos.fret > 0 ? Math.max(hi, pos.fret) : hi;
      if (nhi - nlo >= REACH) continue;
      used.add(pos.string);
      acc.push({ note: notes[i], string: pos.string, fret: pos.fret });
      walk(i + 1, nlo, nhi);
      acc.pop();
      used.delete(pos.string);
    }
  };
  walk(0, Infinity, -Infinity);

  // A stable sort keeps generation order on ties, so a candidate list is a
  // function of the sonority and the tuning alone.
  return out
    .map((f) => ({ f, d: difficulty(f) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, PER_STATE)
    .map((x) => x.f);
}

/* -------- shapes ----------------------------------------------------- */

/** The shapes a guitarist knows by name, as fret patterns over the strings
 *  low to high; `null` is a string that is not played.
 *
 *  Transposing one of these up the neck and laying the index finger across
 *  its open strings is the whole CAGED system, so the same eight entries
 *  name both the open chords and the barre chords — see `nameShape`. */
const SHAPES: readonly { name: string; pattern: readonly (number | null)[] }[] = [
  { name: "E", pattern: [0, 2, 2, 1, 0, 0] },
  { name: "Em", pattern: [0, 2, 2, 0, 0, 0] },
  { name: "A", pattern: [null, 0, 2, 2, 2, 0] },
  { name: "Am", pattern: [null, 0, 2, 2, 1, 0] },
  { name: "D", pattern: [null, null, 0, 2, 3, 2] },
  { name: "Dm", pattern: [null, null, 0, 2, 3, 1] },
  { name: "C", pattern: [null, 3, 2, 0, 1, 0] },
  { name: "G", pattern: [3, 2, 0, 0, 0, 3] },
];

/** The fretting as a pattern over all six strings, for shape matching. */
const patternOf = (f: Fretting): (number | null)[] => {
  const out: (number | null)[] = f.tuning.map(() => null);
  for (const s of f.stops) out[s.string] = s.fret;
  return out;
};

const QUALITY: Record<Quality, string> = { maj: "major", min: "minor" };

/** What the chord IS, when it is a plain triad: "A major". Null otherwise,
 *  and a seventh or a cluster is genuinely otherwise — guessing a name for
 *  an ambiguous sonority puts a wrong chord in a player's ear. */
const chordName = (f: Fretting): string | null => {
  const t = triadOf(f.stops.map((s) => s.note.pitch));
  return t ? `${PC_NAMES[t.root]} ${QUALITY[t.quality]}` : null;
};

/** Recognise the grip as a known shape, open or barred. The shape names
 *  itself by its position: at offset 0 it is the open chord, and higher up
 *  it is that shape barred at the fret its open strings landed on. */
function nameShape(f: Fretting): string | null {
  const pat = patternOf(f);
  for (const shape of SHAPES) {
    if (pat.length !== shape.pattern.length) continue;
    let offset: number | null = null;
    let ok = true;
    for (let i = 0; i < pat.length && ok; i++) {
      const a = pat[i];
      const b = shape.pattern[i];
      if (a === null || b === null) ok = a === null && b === null;
      else if (offset === null) offset = a - b;
      else ok = a - b === offset;
    }
    if (!ok || offset === null || offset < 0) continue;
    if (offset === 0) return `the open ${shape.name} shape`;
    // Above the nut the shape's open strings must be stopped by something,
    // and the only thing that stops five of them at once is a barre.
    if (f.barre !== offset) continue;
    return `the ${shape.name} shape barred at the ${ordinal(offset)} fret`;
  }
  return null;
}

/* -------- prose ------------------------------------------------------ */

const frets = (n: number): string => (n === 1 ? "a fret" : `${count(n)} frets`);

const at = (f: Fretting, s: Stop): string => describePosition(f.tuning, s);
const stringOf = (f: Fretting, s: Stop): string =>
  `the ${ordinal(stringNumber(f.tuning, s.string))} string`;

const sameStrings = (a: Fretting, b: Fretting): boolean =>
  a.stops.length === b.stops.length &&
  a.stops.every((s, i) => s.string === b.stops[i].string);

/** Tier 1: a shape with a name. The shortest true sentence there is on
 *  this instrument — a player who knows the shape needs no other detail. */
function shape(to: Fretting): string | null {
  const s = nameShape(to);
  if (!s) return null;
  const chord = chordName(to);
  return chord ? `${chord}: ${s}` : cap(s);
}

/** Tier 2: the same grip, somewhere else on the neck. The hand does not
 *  change at all; it only slides, which is a guitar's cheapest move. */
function translation(from: Fretting | null, to: Fretting): string | null {
  if (!from || !sameStrings(from, to)) return null;
  const d = to.stops[0].fret - from.stops[0].fret;
  if (d === 0) return null;
  // An open string cannot slide, so a shape containing one is not the same
  // shape two frets up — it is a different grip that happens to look alike.
  if (from.stops.some((s, i) => s.fret === 0 || to.stops[i].fret - s.fret !== d)) return null;
  return `The same shape, ${d > 0 ? "up" : "down"} ${frets(Math.abs(d))}`;
}

/** Tier 3: one or two stops move and the rest of the grip stays put.
 *
 *  This is the one tier that needs the transition rather than just the two
 *  configurations: whether the strings that keep their fret are RINGING or
 *  being struck again is not visible in the fretting, and it is the
 *  difference between letting the chord sustain and playing it again. */
function fingerMove(from: Fretting | null, to: Fretting, tr: Transition): string | null {
  if (!from || !sameStrings(from, to)) return null;
  const moved = to.stops.filter((s, i) => s.fret !== from.stops[i].fret);
  if (!moved.length || moved.length > 2) return null;

  const still = to.stops.filter((s, i) => s.fret === from.stops[i].fret);
  const ringing = new Set(tr.held);
  const rest = still.every((s) => ringing.has(s.note))
    ? `Let the other ${still.length === 1 ? "string" : `${count(still.length)} strings`} ring`
    : `Keep the other ${still.length === 1 ? "string" : `${count(still.length)} strings`}`;

  const move = moved
    .map((s) => {
      const was = from.stops.find((q) => q.string === s.string)!;
      const d = s.fret - was.fret;
      const where = s.fret === 0 ? "open" : `the ${ordinal(s.fret)} fret`;
      const how = was.fret === 0 || s.fret === 0
        ? `to ${where}`
        : `${d > 0 ? "up" : "down"} ${frets(Math.abs(d))}, to ${where}`;
      return `${stringOf(to, s)} ${how}`;
    })
    .join(", and ");
  return `${rest}; ${move}`;
}

/** Tier 4: every string by name. The honest fallback, and the only tier
 *  that works with no previous grip to compare against. */
const restatement = (to: Fretting): string =>
  cap(to.stops.map((s) => at(to, s)).join("; "));

/* -------- the instrument --------------------------------------------- */

/** An `Instrument` for a given tuning. A tuning is data, so standard, drop
 *  D and a capo are the same code — which is the point of building the
 *  fretboard as data in the first place. */
export function guitarIn(tuning: Tuning): Instrument<Fretting> {
  return {
    candidates: (state: State) => frettings(state, tuning),

    /** What the shape costs to hold, plus what it costs to get there, less
     *  a discount for every finger already in place. Open strings earn no
     *  discount: there is no finger on them to keep. */
    cost(from: Fretting | null, to: Fretting): number {
      let c = difficulty(to);
      const a = from && handAt(from);
      const b = handAt(to);
      // A hand that was nowhere (an open chord) has not moved, and a hand
      // arriving at an open chord does not need to be anywhere.
      if (b !== null) c += MOVE * Math.abs(b - (a ?? b));
      if (from) {
        const kept = new Set(from.stops.filter((s) => s.fret > 0).map((s) => `${s.string}:${s.fret}`));
        for (const s of to.stops) if (s.fret > 0 && kept.has(`${s.string}:${s.fret}`)) c -= HOLD;
      }
      return c;
    },

    describe(from: Fretting | null, to: Fretting, tr: Transition): string {
      const body =
        shape(to) ?? translation(from, to) ?? fingerMove(from, to, tr) ?? restatement(to);
      return `${body}${to.repeat > 1 ? `, ${times(to.repeat)}` : ""}.`;
    },
  };
}

/** The default instrument: six strings, standard tuning. */
export const guitar = guitarIn(STANDARD);

export const Guitar = { guitar, guitarIn, REACH, FINGERS, PER_STATE };
