/* ====================================================================
   ENGRAVE — the score as NOTATION. Every other projection here draws a
   note as an instant on an axis; a page draws it as a VALUE — a quarter,
   a dotted eighth — with rests where nothing sounds, beams over the
   eighths of a beat, ties across the barline, and an accidental only
   where the key signature does not already say so. None of that is in
   the model, which stores seconds and a spelling. This module derives it,
   bar by bar, from the one thing a Bar remembers about beats: its meter.

   It is a MODEL, not a drawing: no pixels, no SVG, no DOM. staff-bars.ts
   turns what this returns into a picture. Keeping the two apart is what
   makes "a dotted quarter tied to a sixteenth" a testable fact rather
   than a shape in a string.

   Four decisions, each stated because it is a decision:

   1. QUANTIZATION. A note's start and length are snapped to the nearest
      thirty-second or triplet sixteenth of the bar's quarter. MusicXML
      and LilyPond durations land exactly; a MIDI performance lands near,
      and near is the honest reading of a page for a played file.

   2. VALUES. A length that is not one value is the largest that fits,
      then the largest that fits the remainder, tied — 1¼ quarters is a
      quarter tied to a sixteenth. Greedy is not always what an engraver
      would write across a beat, but it is always readable and always
      right.

   3. RESTS. The gaps in a staff are filled, split first at the beat so a
      rest never straddles one, then decomposed like a note. A staff with
      nothing in the bar gets a whole rest, whatever the meter, as the
      convention has it.

   4. BEAMS. Eighths and shorter are beamed with their neighbours inside
      one beat when they are contiguous — a rest or a gap breaks the
      group. The beat is the quarter, or the dotted quarter in compound
      meters, or the half in cut time.
   ==================================================================== */
import { octaveFor, semi, spell, type Spelt } from "../pitch";
import type { Accidental, Bar, Letter, Note, Pitch, Spelling } from "../types";

/** Which of the two staves a note is written on. The parser's hand when
 *  it gave one; otherwise middle C and up goes on the treble staff. */
export type Staff = "treble" | "bass";

/** The denominator of a note value: 4 is a quarter, 8 an eighth. */
export type Base = 1 | 2 | 4 | 8 | 16 | 32;

export interface Value {
  readonly base: Base;
  readonly dots: 0 | 1;
  /** Three in the time of two: a triplet eighth is an eighth in shape
   *  and two-thirds of one in length. */
  readonly triplet: boolean;
}

/** The accidental to PRINT before a head — "" when the key signature or
 *  an earlier note in the bar already says it, "n" for a natural that
 *  cancels one of those. Distinct from the note's spelling, which is
 *  what the note IS. */
export type Printed = "" | "#" | "b" | "n";

/** One notehead on the page. A note longer than one value, or crossing a
 *  barline, is several heads tied together, all pointing at one Note. */
export interface Head {
  readonly note: Note;
  readonly staff: Staff;
  /** Quarters from the start of the bar. */
  readonly q: number;
  readonly value: Value;
  readonly tiedFrom: boolean;
  readonly tiedTo: boolean;
  readonly acc: Printed;
}

/** Heads struck together on one staff with one value: one stem. Two
 *  values at the same instant are two chords, which the renderer stems
 *  in opposite directions. */
export interface Chord {
  readonly staff: Staff;
  readonly q: number;
  readonly value: Value;
  /** Sorted by pitch, lowest first. */
  readonly heads: readonly Head[];
}

export interface Rest {
  readonly staff: Staff;
  readonly q: number;
  readonly value: Value;
  /** A whole-bar rest: drawn centred in the bar, whatever the meter. */
  readonly whole: boolean;
}

/** One instant at which something on either staff begins — the unit of
 *  horizontal layout, since a grand staff aligns its two staves. */
export interface Column {
  readonly q: number;
  /** The same instant in score seconds, for finding a step's column. */
  readonly t: number;
  /** Does any head here print an accidental? It needs room to its left. */
  readonly accidentals: boolean;
}

export interface EngravedBar {
  readonly bar: Bar;
  /** Quarter notes in the bar, from its meter. */
  readonly quarters: number;
  readonly quarterSec: number;
  readonly columns: readonly Column[];
  readonly chords: readonly Chord[];
  readonly rests: readonly Rest[];
  /** Groups of chords sharing a beam, each in order of time. */
  readonly beams: readonly (readonly Chord[])[];
}

export const quartersPerBar = (b: Bar): number => (b.beats * 4) / b.unit;

/** How long a value lasts, in quarters. */
export const quartersOf = (v: Value): number =>
  (4 / v.base) * (v.dots ? 1.5 : 1) * (v.triplet ? 2 / 3 : 1);

/** The beat a meter is felt in, in quarters — what rests are split at and
 *  beams are grouped by. See decision 4. */
export const beatOf = (b: Bar): number =>
  b.unit === 8 && b.beats % 3 === 0 ? 1.5 : b.unit === 2 ? 2 : 1;

export const staffOf = (n: Note): Staff =>
  n.hand === "lower" ? "bass" : n.hand === "upper" ? "treble" : n.pitch < 60 ? "bass" : "treble";

const v = (base: Base, dots: 0 | 1 = 0, triplet = false): Value => ({ base, dots, triplet });

/** Every value a length may be written as, longest first, for the greedy
 *  fit in decision 2. Double dots are not offered: a tie is plainer. */
const STRAIGHT: readonly Value[] = [
  v(1), v(2, 1), v(2), v(4, 1), v(4), v(8, 1), v(8), v(16, 1), v(16), v(32),
];
const TRIPLET: readonly Value[] = [v(4, 0, true), v(8, 0, true), v(16, 0, true)];

const EPS = 1e-6;

/** Snap a quarter count to the finer of the straight (1/8) and triplet
 *  (1/6) grids — decision 1. */
export function snap(q: number): number {
  const straight = Math.round(q * 8) / 8;
  const triplet = Math.round(q * 6) / 6;
  return Math.abs(straight - q) <= Math.abs(triplet - q) + EPS ? straight : triplet;
}

const onStraightGrid = (q: number): boolean => Math.abs(q * 8 - Math.round(q * 8)) < EPS;

/** The values a length is written as, tied — decision 2. A length on the
 *  triplet grid is written in triplet values alone; one that fits neither
 *  grid whole (a triplet with a straight remainder) drops what it cannot
 *  say, which is the kind of thing quantization already promised. */
export function valuesFor(len: number): Value[] {
  const out: Value[] = [];
  let rem = len;
  const pool = onStraightGrid(len) ? STRAIGHT : TRIPLET;
  while (rem > EPS) {
    const next = pool.find((x) => quartersOf(x) <= rem + EPS);
    if (!next) break;
    out.push(next);
    rem -= quartersOf(next);
  }
  return out;
}

// --- key signatures ------------------------------------------------------

/** Sharps in the order they are written, F C G D A E B; flats the reverse. */
const SHARPS: readonly Letter[] = ["F", "C", "G", "D", "A", "E", "B"];

/** The accidental a key signature puts on a letter. */
export function keyAccidental(fifths: number, letter: Letter): Accidental {
  if (fifths > 0 && SHARPS.indexOf(letter) < fifths) return "#";
  if (fifths < 0 && SHARPS.length - SHARPS.indexOf(letter) <= -fifths) return "b";
  return "";
}

/** Sharp and flat spellings of the twelve pitch classes; a white key has
 *  only its own letter. */
const SHARP_SP: readonly Spelling[] = [
  { letter: "C", acc: "" }, { letter: "C", acc: "#" }, { letter: "D", acc: "" }, { letter: "D", acc: "#" },
  { letter: "E", acc: "" }, { letter: "F", acc: "" }, { letter: "F", acc: "#" }, { letter: "G", acc: "" },
  { letter: "G", acc: "#" }, { letter: "A", acc: "" }, { letter: "A", acc: "#" }, { letter: "B", acc: "" },
];
const FLAT_SP: readonly Spelling[] = [
  { letter: "C", acc: "" }, { letter: "D", acc: "b" }, { letter: "D", acc: "" }, { letter: "E", acc: "b" },
  { letter: "E", acc: "" }, { letter: "F", acc: "" }, { letter: "G", acc: "b" }, { letter: "G", acc: "" },
  { letter: "A", acc: "b" }, { letter: "A", acc: "" }, { letter: "B", acc: "b" }, { letter: "B", acc: "" },
];

/** How a bare pitch is written in a key: the spelling the key signature
 *  already says when one of them does, else a black key by the key's own
 *  side of the circle — sharps from C up, flats below. For a pitch the
 *  score never spelled, such as a key the learner pressed by mistake. */
export function spellIn(pitch: Pitch, fifths: number): Spelt {
  const pc = semi(pitch);
  const [sharp, flat] = [SHARP_SP[pc], FLAT_SP[pc]];
  const sp = [sharp, flat].find((c) => c.acc !== "" && keyAccidental(fifths, c.letter) === c.acc)
    ?? (fifths < 0 ? flat : sharp);
  return { ...sp, octave: octaveFor(pitch, sp) };
}

/** The accidental to print before a head spelled `sp` at `q` quarters
 *  into an engraved bar: what the key signature says, unless a head of
 *  the same letter and octave earlier in the bar — or in the same column —
 *  has said otherwise. The rule `engraveBar` prints by, asked of one head
 *  that is not in the bar. */
export function printedAt(eb: EngravedBar, q: number, sp: Spelt): Printed {
  let implied: Accidental = keyAccidental(eb.bar.fifths, sp.letter);
  const before = eb.chords.flatMap((c) => c.heads).filter((h) => h.q <= q + EPS).sort((a, b) => a.q - b.q);
  for (const h of before) {
    const hs = spell(h.note);
    if (hs.letter === sp.letter && hs.octave === sp.octave) implied = hs.acc;
  }
  return sp.acc === implied ? "" : sp.acc || "n";
}

// --- engraving one bar -----------------------------------------------------

const valueKey = (x: Value): string => `${x.base}${x.dots ? "." : ""}${x.triplet ? "t" : ""}`;

/** Engrave the notes that sound during `bar`. `notes` is whatever the
 *  caller wants on the page — a hand left off it is simply not passed. */
export function engraveBar(notes: readonly Note[], bar: Bar): EngravedBar {
  const quarters = quartersPerBar(bar);
  const quarterSec = (bar.end - bar.start) / quarters;
  // slack for "did this note really cross the barline", in seconds: a
  // sixteenth of a quarter, comfortably above a sequencer's rounding.
  const slack = quarterSec / 16;
  const toQ = (t: number): number => Math.max(0, Math.min(quarters, snap((t - bar.start) / quarterSec)));

  // --- heads: each note in the bar, cut into values --------------------
  const heads: Head[] = [];
  for (const n of notes) {
    const end = n.onset + n.duration;
    // a note is in the bar if it begins here, or began earlier and is
    // still sounding past the slack — a note that merely grazes the
    // barline from the bar before is that bar's alone.
    const beginsHere = n.onset >= bar.start - slack && n.onset < bar.end - slack;
    const tiedFrom = n.onset < bar.start - slack && end > bar.start + slack;
    if (!beginsHere && !tiedFrom) continue;
    const tiedTo = end > bar.end + slack;
    const sQ = tiedFrom ? 0 : toQ(n.onset);
    let eQ = tiedTo ? quarters : toQ(end);
    if (sQ >= quarters) continue;
    if (eQ <= sQ) eQ = Math.min(quarters, sQ + 0.125); // too short to say: a thirty-second
    const values = valuesFor(eQ - sQ);
    let q = sQ;
    values.forEach((value, i) => {
      heads.push({
        note: n, staff: staffOf(n), q, value, acc: "",
        tiedFrom: i === 0 ? tiedFrom : true,
        tiedTo: i < values.length - 1 ? true : tiedTo,
      });
      q += quartersOf(value);
    });
  }
  heads.sort((a, b) => a.q - b.q || a.note.pitch - b.note.pitch);

  // --- accidentals: what the key and the bar so far already say ---------
  // Keyed by letter AND octave, as the convention has it: a C♯5 does not
  // make the C4 under it sharp. A tied-over head never restates its own.
  const inForce = new Map<string, Accidental>();
  const printed = heads.map((h): Head => {
    const sp = spell(h.note);
    const key = `${sp.letter}${sp.octave}`;
    const implied = inForce.get(key) ?? keyAccidental(bar.fifths, sp.letter);
    inForce.set(key, sp.acc);
    if (h.tiedFrom || sp.acc === implied) return h;
    return { ...h, acc: sp.acc || "n" };
  });

  // --- rests: the gaps on each staff, split at the beat -----------------
  const beat = beatOf(bar);
  const rests: Rest[] = [];
  for (const staff of ["treble", "bass"] as const) {
    const mine = printed.filter((h) => h.staff === staff);
    if (mine.length === 0) {
      rests.push({ staff, q: 0, value: v(1), whole: true });
      continue;
    }
    // sounding intervals, merged
    const spans = mine.map((h) => [h.q, h.q + quartersOf(h.value)] as [number, number]);
    spans.sort((a, b) => a[0] - b[0]);
    const merged: [number, number][] = [];
    for (const s of spans) {
      const last = merged[merged.length - 1];
      if (last && s[0] <= last[1] + EPS) last[1] = Math.max(last[1], s[1]);
      else merged.push([s[0], s[1]]);
    }
    const gaps: [number, number][] = [];
    let at = 0;
    for (const [a, b] of merged) {
      if (a > at + EPS) gaps.push([at, a]);
      at = b;
    }
    if (quarters > at + EPS) gaps.push([at, quarters]);
    for (const [a, b] of gaps) {
      // pieces: [a, next beat), [beat, beat), ..., [.., b)
      let p = a;
      while (p < b - EPS) {
        const nextBeat = (Math.floor(p / beat + EPS) + 1) * beat;
        const e = Math.min(b, nextBeat);
        let q = p;
        for (const value of valuesFor(snap(e - p))) {
          rests.push({ staff, q, value, whole: false });
          q += quartersOf(value);
        }
        p = e;
      }
    }
  }

  // --- columns: every instant something begins ---------------------------
  const qs = new Set<number>();
  for (const h of printed) qs.add(h.q);
  for (const r of rests) if (!r.whole) qs.add(r.q);
  if (qs.size === 0) qs.add(0);
  const columns: Column[] = [...qs].sort((a, b) => a - b).map((q) => ({
    q,
    t: bar.start + q * quarterSec,
    accidentals: printed.some((h) => h.q === q && h.acc !== ""),
  }));

  // --- chords: one stem per staff, instant and value --------------------
  const byChord = new Map<string, Head[]>();
  for (const h of printed) {
    const k = `${h.staff}|${h.q}|${valueKey(h.value)}`;
    let list = byChord.get(k);
    if (!list) byChord.set(k, (list = []));
    list.push(h);
  }
  const chords: Chord[] = [...byChord.values()].map((hs) => ({
    staff: hs[0].staff, q: hs[0].q, value: hs[0].value,
    heads: [...hs].sort((a, b) => a.note.pitch - b.note.pitch),
  }));
  chords.sort((a, b) => a.q - b.q || (a.staff === b.staff ? 0 : a.staff === "treble" ? -1 : 1));

  // --- beams: eighths and shorter, contiguous within a beat -------------
  const beams: Chord[][] = [];
  for (const staff of ["treble", "bass"] as const) {
    let group: Chord[] = [];
    const flush = (): void => {
      if (group.length > 1) beams.push(group);
      group = [];
    };
    for (const c of chords.filter((x) => x.staff === staff)) {
      if (c.value.base < 8) { flush(); continue; }
      const prev = group[group.length - 1];
      const joins = prev !== undefined
        && Math.floor(prev.q / beat + EPS) === Math.floor(c.q / beat + EPS)
        && Math.abs(prev.q + quartersOf(prev.value) - c.q) < EPS;
      if (!joins) flush();
      group.push(c);
    }
    flush();
  }

  return { bar, quarters, quarterSec, columns, chords, rests, beams };
}

/** Engrave a run of bars, `from` to `to` inclusive, clamped to the score. */
export function engrave(notes: readonly Note[], bars: readonly Bar[], from: number, to: number): EngravedBar[] {
  const a = Math.max(0, Math.min(from, bars.length - 1));
  const b = Math.max(a, Math.min(to, bars.length - 1));
  const out: EngravedBar[] = [];
  for (let i = a; i <= b; i++) out.push(engraveBar(notes, bars[i]));
  return out;
}

export const Engrave = {
  engrave, engraveBar, valuesFor, snap, quartersOf, quartersPerBar, beatOf, staffOf, keyAccidental, spellIn, printedAt,
};
