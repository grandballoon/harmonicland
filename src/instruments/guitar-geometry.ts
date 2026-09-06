/* ====================================================================
   GUITAR GEOMETRY — where a pitch physically sits on a neck.

   The keyboard's answer to "where is this pitch" is a single key. The
   neck's answer is up to six places, and that is the whole difference
   between the two instruments: no pure `Pitch -> position` function
   exists here, only a set of candidates for something else to choose
   between. This module supplies the set and nothing else — no notion of
   a chord, a hand, a state or a cost.

   A tuning is DATA: an array of open-string pitches, lowest string
   first. Standard, drop D, DADGAD and a capo are then all the same kind
   of thing, which is why nothing below branches on any of them. A capo
   is `capo(tuning, n)`, and after it fret numbers are counted from the
   capo — exactly as a player counts them, and the reason the capo needs
   no separate representation.

   These are facts about a guitar, not about this feature. The module
   imports `types` and nothing else.
   ==================================================================== */
import type { Pitch } from "../types";

/** Open-string pitches, LOWEST string first. Index, not string number:
 *  a guitarist counts the other way (see `stringNumber`), but an index is
 *  what indexes the array, and one of the two has to be the storage form. */
export type Tuning = readonly Pitch[];

/** E2 A2 D3 G3 B3 E4. */
export const STANDARD: Tuning = [40, 45, 50, 55, 59, 64];
/** Standard with the lowest string down a whole tone. */
export const DROP_D: Tuning = [38, 45, 50, 55, 59, 64];

/** The highest fret a chord is played at. Necks run to 20-odd frets, but
 *  the body stops the fretting hand long before that, and every voicing
 *  above the twelfth repeats one an octave lower. Fifteen is generous. */
export const FRETS = 15;

/** One place on the neck. `string` is an index into the tuning, so
 *  `tuning[string] + fret` is the pitch — always, for every tuning. */
export interface Position {
  readonly string: number;
  readonly fret: number;
}

/** What the player calls that string: 6 is the lowest on a six-string. */
export const stringNumber = (tuning: Tuning, string: number): number => tuning.length - string;

/** The pitch a string sounds when stopped at `fret`; fret 0 is open. */
export const pitchAt = (tuning: Tuning, string: number, fret: number): Pitch =>
  tuning[string] + fret;

/** Every way to sound this pitch, lowest string first.
 *
 *  Empty when the pitch is off the instrument entirely, which for the
 *  bottom of a piano score is the common case rather than the exotic one:
 *  a guitar starts at E2 and a left hand does not. */
export function positionsFor(pitch: Pitch, tuning: Tuning = STANDARD, frets = FRETS): Position[] {
  const out: Position[] = [];
  for (let string = 0; string < tuning.length; string++) {
    const fret = pitch - tuning[string];
    if (fret >= 0 && fret <= frets) out.push({ string, fret });
  }
  return out;
}

/** The tuning as heard with a capo at `fret`. Every string rises by the
 *  same amount, and the player then counts frets from the capo — so the
 *  capo is not a third parameter anywhere, it is just a different tuning. */
export const capo = (tuning: Tuning, fret: number): Tuning => tuning.map((p) => p + fret);

const ORDINALS = ["", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th",
  "10th", "11th", "12th", "13th", "14th", "15th"];

/** "5th", "12th" — for fret numbers and string numbers alike. */
export const ordinal = (n: number): string => ORDINALS[n] ?? `${n}th`;

/** "the 5th string, 3rd fret" / "the 4th string, open". */
export const describePosition = (tuning: Tuning, pos: Position): string =>
  `the ${ordinal(stringNumber(tuning, pos.string))} string, ` +
  (pos.fret === 0 ? "open" : `${ordinal(pos.fret)} fret`);

export const GuitarGeometry = {
  STANDARD, DROP_D, FRETS, positionsFor, pitchAt, capo, stringNumber, describePosition, ordinal,
};
