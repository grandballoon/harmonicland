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
  /** Which printed staff the note is written on: 1 = upper (usually the
   *  right hand), 2 = lower. Absent when the format states none — the same
   *  rule `bars` follows, so a consumer reads absence as a fact about the
   *  input rather than special-casing per parser. It is notation, not
   *  physics: a hand is what a player infers from it, not what it is. */
  readonly staff?: number;
}

/** A measure boundary: when the bar starts, and what the score calls it.
 *  The label is the printed measure number, kept as text because it is one
 *  (a pickup is "0" or "1", repeats can give "12a") — display, never math. */
export interface Bar {
  readonly time: number; // seconds from start
  readonly label: string;
}

/** A score: notes sorted by onset, the total duration, and — when the input
 *  format states one — the bar grid. `bars` is empty for formats that carry
 *  no measures; every consumer treats that as "this score has no bar
 *  structure" rather than special-casing per parser. */
export interface Score {
  readonly notes: readonly Note[];
  readonly duration: number;
  readonly bars: readonly Bar[];
}

/** What a parser produces and `Core.makeScore` consumes — spelling optional,
 *  filled with a default when absent (the MIDI case). */
export interface RawNote {
  pitch: Pitch;
  spelling?: Spelling;
  onset: number;
  duration: number;
  staff?: number;
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
 *  loop or any output. `seek()` IS scrubbing, and `setRate()` IS playback
 *  speed — score time simply advances slower or faster than wall time, so
 *  nothing downstream (which only ever sees `t`) has to know. */
export interface Clock {
  now(): number;
  play(): void;
  pause(): void;
  seek(t: number): void;
  isPlaying(): boolean;
  rate(): number;
  setRate(r: number): void;
  onFrame(fn: (t: number) => void): void;
}
