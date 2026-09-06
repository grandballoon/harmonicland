/* ====================================================================
   WORDS — the English a physical instruction is written in. Numbers as
   people say them, intervals by name, and the two sentence fragments
   every instrument needs.

   It exists because piano.ts and guitar.ts had written the same eight
   lines twice, and prose.ts would have made it three times. Nothing here
   knows what a key, a fret or a state is: it imports nothing at all,
   which is what makes it the right home for a vocabulary shared across
   the instrument seam rather than a utility drawer.
   ==================================================================== */

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

/** A small number as a person says it; larger ones as digits, since
 *  "seventeen" reads worse than "17" in the middle of an instruction. */
export const count = (n: number): string => WORDS[n] ?? String(n);

/** A run of restatements, in the words a person would use for it. */
export const times = (n: number): string => (n === 2 ? "played twice" : `played ${count(n)} times`);

/** Sentence case. Instructions are composed from fragments, so the capital
 *  is applied once at the end rather than baked into every fragment. */
export const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

const INTERVALS = [
  "no distance", "a semitone", "a whole tone", "a minor third", "a major third",
  "a perfect fourth", "a tritone", "a perfect fifth", "a minor sixth", "a major sixth",
  "a minor seventh", "a major seventh", "an octave",
];

/** A distance in semitones, named. Past the octave the name stops helping
 *  a hand find anything, so the number is the honest answer. */
export const interval = (n: number): string => INTERVALS[n] ?? `${n} semitones`;

/** A signed distance: "up a major third", "down a semitone". */
export const direction = (d: number): string => `${d > 0 ? "up" : "down"} ${interval(Math.abs(d))}`;

export const Words = { count, times, cap, interval, direction };
