/* ====================================================================
   PIANO GEOMETRY — where a pitch physically sits, and how to say so.

   A keyboard is navigated by feel, and the thing a hand feels is the
   2-and-3 grouping of the black keys. That grouping is the entire
   navigational logic of playing without looking: "the white key just
   left of the group of three" can be found in the dark, and "F4"
   cannot. So naming here is landmark-relative by preference, and
   absolute ("A-flat above middle C") only where no landmark is
   trustworthy — at the bottom of the board, where a group is cut off
   by the end of the keyboard and the hand would feel a lone black key
   rather than a group.

   These are facts about a piano, not about this feature: no state, no
   transition, no fingering, no instrument seam. The module imports
   `types` and nothing else, and any view that wants to name a key can
   have this without dragging the narrator in behind it.
   ==================================================================== */
import type { Pitch } from "../types";

/** The 88-key board, A0 to C8. Landmarks off the board cannot be felt,
 *  which is what makes the absolute fallback below a real case. */
export const LOWEST: Pitch = 21;
export const HIGHEST: Pitch = 108;

/** Pitch class, correct for negative pitches too (`%` alone is not). */
const pc = (p: Pitch): number => ((p % 12) + 12) % 12;

/** The C at or below `p` — the octave a description is anchored to. */
const anchorC = (p: Pitch): Pitch => p - pc(p);

/** Octaves from middle C to that anchor; the one number every name needs. */
const octaveDistance = (p: Pitch): number => (anchorC(p) - 60) / 12;

const BLACK = [false, true, false, true, false, false, true, false, true, false, true, false];

export const isBlack = (p: Pitch): boolean => BLACK[pc(p)];

/** MIDI convention: 60 is C4, so the octave turns over at every C. */
export const octaveOf = (p: Pitch): number => Math.floor(p / 12) - 1;

/** Which black-key group a black key belongs to, and its index within it.
 *  C♯/D♯ are the group of two; F♯/G♯/A♯ the group of three. `null` for a
 *  white key, which belongs to no group — it is described by the group it
 *  sits beside instead. */
export const blackGroup = (p: Pitch): { size: 2 | 3; index: number } | null => {
  switch (pc(p)) {
    case 1: return { size: 2, index: 0 };
    case 3: return { size: 2, index: 1 };
    case 6: return { size: 3, index: 0 };
    case 8: return { size: 3, index: 1 };
    case 10: return { size: 3, index: 2 };
    default: return null;
  }
};

/* -------- naming the octave a landmark lives in -------------------- */

const WORDS = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

/** "middle C", "the C an octave below middle C", "the C two octaves above…". */
const nameC = (d: number): string => {
  if (d === 0) return "middle C";
  const n = Math.abs(d);
  const count = n === 1 ? "an octave" : `${WORDS[n] ?? n} octaves`;
  return `the C ${count} ${d > 0 ? "above" : "below"} middle C`;
};

/** The same octave, phrased as a position rather than a key: "above middle
 *  C", "an octave below middle C". Used for both black-key groups and the
 *  absolute fallback, so the two vocabularies stay one vocabulary. */
const nameOctave = (d: number): string => {
  if (d === 0) return "above middle C";
  const n = Math.abs(d);
  const count = n === 1 ? "an octave" : `${WORDS[n] ?? n} octaves`;
  return `${count} ${d > 0 ? "above" : "below"} middle C`;
};

/* -------- describing a key ----------------------------------------- */

/** Every key's relation to the black-key group it is found by, indexed by
 *  pitch class. `%2` and `%3` stand for the two groups of the anchor octave.
 *  Twelve entries is the whole scheme: exhaustive by construction, so no key
 *  can fall through to a default that says nothing. Pitch class 0 is absent
 *  because a C is a landmark itself and names itself. */
const RELATION = [
  "",                                              // C — handled as a landmark
  "the first black key of %2",                     // C#
  "the white key between the two black keys of %2", // D
  "the second black key of %2",                    // D#
  "the white key just right of %2",                // E
  "the white key just left of %3",                 // F
  "the first black key of %3",                     // F#
  "the white key between the first two black keys of %3", // G
  "the second black key of %3",                    // G#
  "the white key between the last two black keys of %3",  // A
  "the third black key of %3",                     // A#
  "the white key just right of %3",                // B
];

/** Which group's pitches a description leans on: the group of two for the
 *  lower half of the octave, the group of three for the upper. */
const groupPitches = (p: Pitch): Pitch[] => {
  const c = anchorC(p);
  return pc(p) <= 4 ? [c + 1, c + 3] : [c + 6, c + 8, c + 10];
};

/** A group cut off by the end of the keyboard is not a group the hand can
 *  feel — it feels like one stray black key — so nothing may be named
 *  relative to it. */
const groupIsWhole = (p: Pitch): boolean =>
  groupPitches(p).every((g) => g >= LOWEST && g <= HIGHEST);

const FLAT = ["C", "D-flat", "D", "E-flat", "E", "F", "G-flat", "G", "A-flat", "A", "B-flat", "B"];

/** The fallback: an absolute name. Truthful, but it cannot be found without
 *  looking, which is why it is the last resort and not the first. */
const absolute = (p: Pitch): string => `${FLAT[pc(p)]} ${nameOctave(octaveDistance(p))}`;

/** Name a key the way a player finds it: "middle C", "the first black key of
 *  the group of two above middle C", "the white key just left of the group of
 *  three an octave below middle C". Total over every pitch. */
export const describeKey = (p: Pitch): string => {
  const d = octaveDistance(p);
  if (pc(p) === 0) return nameC(d);
  if (!groupIsWhole(p)) return absolute(p);
  const size = pc(p) <= 4 ? "two" : "three";
  return RELATION[pc(p)].replace(/%[23]/, `the group of ${size} ${nameOctave(d)}`);
};

/* -------- landmarks ------------------------------------------------ */

/** A key a player can find without looking, and how far the pitch of
 *  interest sits from it. Landmarks are the Cs and the outer black keys of
 *  each group; nothing else on a keyboard is distinguishable by touch. */
export interface Landmark {
  /** The landmark key itself; always on the 88-key board. */
  readonly pitch: Pitch;
  /** Its spoken name, from `describeKey` — one vocabulary, not two. */
  readonly name: string;
  /** Semitones from the landmark to the pitch it was found for. Positive is
   *  to the right. Never more than two, anywhere on the board. */
  readonly offset: number;
}

const isLandmarkKey = (p: Pitch): boolean => {
  if (p < LOWEST || p > HIGHEST) return false;
  if (pc(p) === 0) return true;
  const g = blackGroup(p);
  return g !== null && (g.index === 0 || g.index === g.size - 1);
};

const LANDMARKS: readonly Pitch[] = Array.from(
  { length: HIGHEST - LOWEST + 1 },
  (_, i) => LOWEST + i,
).filter(isLandmarkKey);

/** The nearest landmark to `p`. Ties go to a C — the strongest landmark on
 *  the instrument — and then to the lower key, so the answer is a function of
 *  the pitch alone and never of how the candidates happened to be ordered. */
export const landmarkFor = (p: Pitch): Landmark => {
  let best = LANDMARKS[0];
  for (const q of LANDMARKS) {
    const d = Math.abs(p - q);
    const b = Math.abs(p - best);
    if (d < b || (d === b && pc(q) === 0 && pc(best) !== 0)) best = q;
  }
  return { pitch: best, name: describeKey(best), offset: p - best };
};

/* -------- distance ------------------------------------------------- */

/** White keys strictly below `p`, counting a black key as its left neighbour
 *  so that black and white pitches share one ruler. */
const WHITE_BELOW = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];
const whiteIndex = (p: Pitch): number => 7 * Math.floor(p / 12) + WHITE_BELOW[pc(p)];

/** Signed distance from `a` to `b` in white-key steps — how far the hand
 *  slides, which is what a player moves by. The other distance, semitones,
 *  is simply `b - a` and needs no function. */
export const whiteSteps = (a: Pitch, b: Pitch): number => whiteIndex(b) - whiteIndex(a);
