/* ====================================================================
   INTERVALS — the ear-training vocabulary, and what it means for a key.
   A RELATION is an interval in a direction: a major third up, a minor
   sixth down. Given the key pressed and the relations chosen, which keys
   are those relations of it? That is the whole question, and it is
   pure: no state, no DOM, no sound. echoes.ts asks it on every press and
   sounds the answer; the tray's interval row builds its buttons from the
   one table here, so the names on the buttons and the names on the keys
   cannot disagree.

   Simple intervals only, a minor second to an octave: the ones a learner
   names by ear. Compound intervals are the same sounds an octave apart,
   and the tritone is one name, not "augmented fourth" and "diminished
   fifth" — the key is the same and this is about what is heard, not how
   it would be spelt.
   ==================================================================== */
import { HIGH, LOW } from "./pitch";
import type { Pitch } from "./types";

export interface Interval {
  /** How far, in semitones: 1 (a minor second) to 12 (an octave). */
  readonly semitones: number;
  /** The short name a key is labelled with: "M3". */
  readonly name: string;
  /** What a reader calls it: "major third". */
  readonly long: string;
}

/** Every interval on offer, smallest first. The one catalogue. */
export const INTERVALS: readonly Interval[] = [
  { semitones: 1, name: "m2", long: "minor second" },
  { semitones: 2, name: "M2", long: "major second" },
  { semitones: 3, name: "m3", long: "minor third" },
  { semitones: 4, name: "M3", long: "major third" },
  { semitones: 5, name: "P4", long: "perfect fourth" },
  { semitones: 6, name: "TT", long: "tritone" },
  { semitones: 7, name: "P5", long: "perfect fifth" },
  { semitones: 8, name: "m6", long: "minor sixth" },
  { semitones: 9, name: "M6", long: "major sixth" },
  { semitones: 10, name: "m7", long: "minor seventh" },
  { semitones: 11, name: "M7", long: "major seventh" },
  { semitones: 12, name: "P8", long: "octave" },
];

export type Direction = "up" | "down";

/** An interval in a direction: "a major third up". */
export interface Relation {
  readonly semitones: number;
  readonly dir: Direction;
}

/** A key some relation of the pressed key lands on, and what to call it. */
export interface Relative {
  readonly pitch: Pitch;
  /** The interval's short name: "M3". */
  readonly name: string;
  readonly dir: Direction;
}

/** Which way an interval went, as a key's label shows it. */
export const ARROW: Readonly<Record<Direction, string>> = { up: "↑", down: "↓" };

const intervalOf = (semitones: number): Interval | undefined =>
  INTERVALS.find((i) => i.semitones === semitones);

/** Is this a relation the catalogue names? Anything else read back from
 *  storage is dropped rather than trusted. */
export const isRelation = (r: unknown): r is Relation => {
  const v = r as Partial<Relation> | null;
  return typeof v === "object" && v !== null &&
    (v.dir === "up" || v.dir === "down") &&
    typeof v.semitones === "number" && intervalOf(v.semitones) !== undefined;
};

/** The same relation, compared by value: a stable key for a set of them. */
export const relationKey = ({ semitones, dir }: Relation): string => `${dir}:${semitones}`;

const nameOf = (semitones: number): string => intervalOf(semitones)?.name ?? `${semitones}st`;

/** The label a key carries: "M3↑", "m6↓". */
export function label({ semitones, dir }: Relation): string {
  return `${nameOf(semitones)}${ARROW[dir]}`;
}

/** What a reader calls it: "major third up". */
export function describe({ semitones, dir }: Relation): string {
  return `${intervalOf(semitones)?.long ?? `${semitones} semitones`} ${dir}`;
}

const signed = ({ semitones, dir }: Relation): number => (dir === "up" ? semitones : -semitones);

/** The keys `relations` of `pitch` land on, lowest first — the order an
 *  arpeggio of them climbs — leaving out any that fall off the 88. The
 *  pressed key itself is never one: every interval is at least a semitone. */
export function relativesOf(pitch: Pitch, relations: readonly Relation[]): Relative[] {
  return [...relations]
    .sort((a, b) => signed(a) - signed(b))
    .map((r) => ({ pitch: pitch + signed(r), name: nameOf(r.semitones), dir: r.dir }))
    .filter((r) => r.pitch >= LOW && r.pitch <= HIGH);
}
