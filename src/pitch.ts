/* ====================================================================
   PITCH — the physical-keyboard facts about a MIDI pitch, expressed once.
   A leaf with types.ts's property: it imports nothing. That is what makes
   it safe for core.ts, the harmony modules, and the renderers alike — a
   pure pitch leaf is not the kind of dependency their "imports nothing"
   headers are guarding against, which is dependencies that carry DOM,
   audio, or the model with them.

   These were previously four copies of the name table and two copies each
   of isWhite/isC/LOW/HIGH, and the renderers' agreement about which keys
   are black held only because four files independently typed the same
   literals. Now it holds by construction.
   ==================================================================== */
import type { Letter, Note, Pitch, Spelling } from "./types";

/** Sharp spellings of the 12 pitch classes. The naming default everywhere:
 *  C♯ not D♭. Choosing a different spelling is `Spelling`'s job, not this. */
export const PITCH_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;

/** The 88-key range: A0 .. C8. The span every keyboard-shaped view draws. */
export const LOW: Pitch = 21;
export const HIGH: Pitch = 108;

/** Pitch class, 0–11, correct for negative pitches too. */
export const semi = (p: Pitch): number => ((p % 12) + 12) % 12;

const BLACK = [1, 3, 6, 8, 10];

/** Is this a white key? The one definition — a view that disagreed with
 *  another about this would draw a keyboard you could not play. */
export const isWhite = (p: Pitch): boolean => !BLACK.includes(semi(p));

/** Is this a C? The octave landmark every keyboard view labels. */
export const isC = (p: Pitch): boolean => semi(p) === 0;

/** Sharp name for a pitch, e.g. 61 -> "C#". */
export const pitchName = (p: Pitch): string => PITCH_NAMES[semi(p)];

/** Scientific-pitch octave number: middle C (60) is C4. Off by one from
 *  the naive `p / 12` and easy to get wrong, so it is written once. */
export const octaveOf = (p: Pitch): number => Math.floor(p / 12) - 1;

/** Name with octave, e.g. 61 -> "C#4". What a reader calls the key. */
export const pitchLabel = (p: Pitch): string => `${pitchName(p)}${octaveOf(p)}`;

/** A note as it is written: letter, accidental, and the octave the LETTER
 *  is in — which is not always the octave the pitch is in. */
export interface Spelt {
  letter: Letter;
  acc: Spelling["acc"];
  octave: number;
}

/** Octave for a spelling. B♯ and C♭ cross the octave boundary: B♯3 is the
 *  same key as C4, and C♭4 the same as B3. Handled simply — double
 *  accidentals collapse to one glyph anyway. */
export function octaveFor(pitch: Pitch, sp: Spelling): number {
  let oct = octaveOf(pitch);
  if (sp.letter === "B" && sp.acc === "#") oct -= 1;
  if (sp.letter === "C" && sp.acc === "b") oct += 1;
  return oct;
}

/** A note's frozen spelling, with its written octave. The one place the
 *  staff renderers and the engraver agree about what letter a note is —
 *  the staff view and the page put a notehead on the same line because
 *  both ask this. */
export const spell = (n: Note): Spelt => ({
  letter: n.spelling.letter,
  acc: n.spelling.acc || "",
  octave: octaveFor(n.pitch, n.spelling),
});
