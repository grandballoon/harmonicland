/* ====================================================================
   TYPES — the contract, expressed once. Pure declarations, zero runtime.
   Everyone imports this; it imports nothing. That dependency shape IS the
   architecture: inputs and outputs both depend on the model's type, never
   on each other.
   ==================================================================== */

/** MIDI note number, 0–127. The unambiguous physical truth. */
export type Pitch = number;

/** A diatonic letter name. A union (not `string`) so the grand-staff row
 *  math and `octaveFor` stay exhaustive and typos are caught at author time. */
export type Letter = "C" | "D" | "E" | "F" | "G" | "A" | "B";

/** Single accidentals only; doubles collapse to one glyph (position is by
 *  letter anyway), matching the renderers' ACC map. */
export type Accidental = "" | "#" | "b";

/** The notation choice for a pitch — kept deliberately separate from `pitch`.
 *  C♯ and D♭ are the same `pitch` but different `Spelling`. */
export interface Spelling {
  letter: Letter;
  acc: Accidental;
}

/** The one immutable value everything hangs off. `readonly` makes "outputs
 *  consume but never mutate the model" a compile error to violate. */
export interface Note {
  readonly pitch: Pitch;
  readonly spelling: Spelling;
  readonly onset: number; // seconds from start (tempo already resolved)
  readonly duration: number; // seconds
}

/** A score: notes sorted by onset, plus the total duration. */
export interface Score {
  readonly notes: readonly Note[];
  readonly duration: number;
}

/** What a parser produces and `Core.makeScore` consumes — spelling optional,
 *  filled with a default when absent (the MIDI case). */
export interface RawNote {
  pitch: Pitch;
  spelling?: Spelling;
  onset: number;
  duration: number;
}

/** An output projection. Every view satisfies this exact shape, which is why
 *  the view toggle is a single reference swap. */
export type View = (svg: SVGSVGElement, score: Score, t: number) => void;

/** A time sink driven each frame (audio now, MIDI-out later). */
export type Sink = (score: Score, t: number, playing: boolean) => void;

/** A parser: bytes-or-text → score. */
export type Parser<I> = (input: I) => Score;

/** The single source of truth for time. The interface exists precisely so the
 *  rAF implementation can be swapped for Tone.Transport without touching the
 *  loop or any output. `seek()` IS scrubbing. */
export interface Clock {
  now(): number;
  play(): void;
  pause(): void;
  seek(t: number): void;
  isPlaying(): boolean;
  onFrame(fn: (t: number) => void): void;
}
