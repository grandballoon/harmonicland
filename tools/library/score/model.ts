/* ====================================================================
   MODEL — one piano score, in notation terms, format-neutral.

   What a converter produces and the MusicXML writer consumes. It is
   shaped like notation rather than like any source: measures, voices,
   notes with their printed accidentals, beams, ties, slurs, marks.
   All time is exact (Fraction, in whole notes), and every timed item
   says where it sits in its measure, so the writer only serializes and
   never decides anything musical.

   One part (a piano), any number of staves. Staves and MusicXML voice
   numbers are 1-based, as MusicXML counts them.
   ==================================================================== */
import type { Fraction } from "./fraction.ts";

export interface Score {
  readonly title?: string;
  readonly subtitle?: string;
  readonly movement?: string;
  readonly composer?: string;
  readonly arranger?: string;
  readonly rights?: string;
  /** Where the encoding came from, e.g. a pinned source URL. */
  readonly source?: string;
  /** Free-text notes about how this file was made. */
  readonly encodingNotes: readonly string[];
  readonly staves: number;
  readonly measures: readonly Measure[];
}

export interface Measure {
  /** As printed; a pickup is "0". */
  readonly number: string;
  /** Not counted in bar numbering (a pickup, or the second half of a split bar). */
  readonly implicit: boolean;
  /** Absolute start, for ordering and diagnostics. */
  readonly start: Fraction;
  readonly length: Fraction;
  /** In force from the start of this measure, when changed here. */
  readonly attributes: Attributes | null;
  readonly left?: Barline;
  readonly right?: Barline;
  readonly items: readonly Item[];
}

export interface Attributes {
  /** Per staff when staves differ; one entry without `staff` when all agree. */
  readonly keys?: readonly Key[];
  readonly time?: Time;
  readonly clefs?: readonly Clef[];
}

export interface Key {
  readonly staff?: number;
  readonly fifths: number;
  readonly mode?: "major" | "minor";
}

export interface Time {
  readonly beats: number;
  readonly beatType: number;
  readonly symbol?: "common" | "cut" | "single-number";
  /** In force but not printed (senza misura). */
  readonly hidden?: boolean;
}

export interface Clef {
  readonly staff: number;
  readonly sign: "G" | "F" | "C" | "percussion";
  readonly line: number;
  readonly octaveChange?: number;
}

export type BarStyle =
  | "regular" | "dotted" | "dashed" | "heavy" | "light-light" | "light-heavy"
  | "heavy-light" | "heavy-heavy" | "tick" | "short" | "none";

export interface Barline {
  /** Absent: the reader's default (a regular line). */
  readonly style?: BarStyle;
  readonly repeat?: "forward" | "backward";
  /** Times the repeated section is played, when more than two. */
  readonly times?: number;
  readonly ending?: Ending;
}

export interface Ending {
  /** "1", "2", "1, 2" — the passes this ending is played on. */
  readonly number: string;
  readonly type: "start" | "stop" | "discontinue";
  /** Printed text, e.g. "1." — only on start. */
  readonly text?: string;
}

/* ---- timed items ---------------------------------------------------- */

interface Timed {
  /** From the measure start, in whole notes. */
  readonly offset: Fraction;
  /** MusicXML voice; absent for items that belong to no voice. */
  readonly voice?: number;
  readonly staff: number;
}

export type Item = NoteGroup | Direction | ClefChange;

/** A chord, a single note, or a rest (no pitches): one rhythmic event. */
export interface NoteGroup extends Timed {
  readonly kind: "group";
  /** Sounding length; zero for grace notes. */
  readonly duration: Fraction;
  readonly type: NoteType;
  readonly dots: number;
  /** Graces sort by this (negative, closer to zero is later). */
  readonly grace?: { readonly slash: boolean; readonly order: Fraction };
  readonly timeModification?: { readonly actual: number; readonly normal: number };
  readonly tuplets: readonly TupletMark[];
  readonly stem?: "up" | "down";
  readonly beams: readonly BeamMark[];
  /** Empty for a rest. */
  readonly notes: readonly PitchedNote[];
  readonly rest?: RestInfo;
  /** Present in the music but not printed (it still sounds). */
  readonly hidden?: boolean;
  /** Marks that belong to the chord as a whole; written on its first note. */
  readonly marks: readonly NoteMark[];
}

export type NoteType =
  | "maxima" | "long" | "breve" | "whole" | "half" | "quarter" | "eighth"
  | "16th" | "32nd" | "64th" | "128th" | "256th" | "512th" | "1024th";

export interface RestInfo {
  /** A whole-measure rest, drawn centred whatever the meter. */
  readonly measure: boolean;
  readonly display?: { readonly step: Step; readonly octave: number };
}

export type Step = "C" | "D" | "E" | "F" | "G" | "A" | "B";

export interface PitchedNote {
  readonly step: Step;
  /** In semitones, as MusicXML's <alter>. */
  readonly alter: number;
  readonly octave: number;
  /** A note of a chord can sit on another staff than the chord's voice. */
  readonly staff: number;
  readonly accidental?: PrintedAccidental;
  readonly tie?: { readonly start: boolean; readonly stop: boolean; readonly letRing?: boolean };
  readonly marks: readonly NoteMark[];
  readonly notehead?: string;
}

export interface PrintedAccidental {
  readonly value:
    | "sharp" | "flat" | "natural" | "double-sharp" | "flat-flat"
    | "quarter-sharp" | "quarter-flat" | "three-quarters-sharp" | "three-quarters-flat";
  readonly cautionary: boolean;
  readonly parentheses: boolean;
}

export interface TupletMark {
  readonly type: "start" | "stop";
  readonly number: number;
  /** Only on start: the printed ratio. */
  readonly actual?: number;
  readonly normal?: number;
  /** Only on start: the number is not printed. */
  readonly hidden?: boolean;
}

export interface BeamMark {
  readonly level: number;
  readonly value: "begin" | "continue" | "end" | "forward hook" | "backward hook";
}

type Placement = "above" | "below";

/** A spanner (slur, wedge, …) is started and stopped by marks sharing an
 *  `id`, unique within the score. The MusicXML `number` is the writer's to
 *  choose, since readers pair numbers in document order, which only the
 *  writer knows. */
export type SpannerId = number;

/** Everything written inside a note's <notations>. */
export type NoteMark =
  | { readonly kind: "slur"; readonly type: "start" | "stop"; readonly id: SpannerId; readonly placement?: Placement }
  | { readonly kind: "articulation"; readonly name: ArticulationName; readonly placement?: Placement }
  | {
      readonly kind: "ornament";
      readonly name: OrnamentName;
      readonly placement?: Placement;
      /** The long (trill-length) form: prallprall, prallmordent, and the compound ornaments. */
      readonly long?: boolean;
      /** For compound ornaments: where the ornament enters from or leaves to. */
      readonly approach?: "above" | "below";
      readonly departure?: "above" | "below";
    }
  | { readonly kind: "wavy-line"; readonly type: "start" | "stop"; readonly id: SpannerId }
  | { readonly kind: "tremolo"; readonly marks: number }
  | {
      readonly kind: "fingering";
      readonly text: string;
      readonly placement?: Placement;
      /** Replaces the fingering before it, mid-note (a finger substitution). */
      readonly substitution?: boolean;
    }
  | { readonly kind: "technical"; readonly name: TechnicalName; readonly placement?: Placement }
  | { readonly kind: "fermata"; readonly shape: FermataShape; readonly inverted: boolean }
  | { readonly kind: "arpeggiate"; readonly direction?: "up" | "down"; readonly number?: number }
  | { readonly kind: "glissando"; readonly type: "start" | "stop"; readonly id: SpannerId };

export type ArticulationName =
  | "accent" | "strong-accent" | "staccato" | "tenuto" | "detached-legato"
  | "staccatissimo" | "spiccato" | "breath-mark" | "stress" | "unstress" | "soft-accent";

export type OrnamentName =
  | "trill-mark" | "turn" | "inverted-turn" | "mordent" | "inverted-mordent" | "shake" | "schleifer";

export type TechnicalName = "up-bow" | "down-bow" | "harmonic" | "open-string" | "stopped" | "thumb-position" | "snap-pizzicato" | "heel" | "toe";

export type FermataShape = "normal" | "angled" | "square" | "double-angled" | "double-square" | "half-curve" | "curlew";

/** A <direction>: something printed at a point in time, not on a note. */
export interface Direction extends Timed {
  readonly kind: "direction";
  readonly placement?: Placement;
  readonly content: readonly DirectionContent[];
  /** Playback: quarter notes per minute from here on. */
  readonly tempo?: number;
}

export type DirectionContent =
  | { readonly kind: "dynamics"; readonly value: string }
  | { readonly kind: "wedge"; readonly type: "crescendo" | "diminuendo" | "stop"; readonly id: SpannerId }
  | { readonly kind: "words"; readonly text: string; readonly italic?: boolean; readonly bold?: boolean }
  | { readonly kind: "dashes"; readonly type: "start" | "stop"; readonly id: SpannerId }
  | { readonly kind: "pedal"; readonly type: "start" | "stop" | "change"; readonly line: boolean; readonly sign: boolean; readonly pedal: "sustain" | "sostenuto" }
  | { readonly kind: "octave-shift"; readonly type: "up" | "down" | "stop"; readonly size: number; readonly id: SpannerId }
  | {
      readonly kind: "metronome";
      readonly beatUnit: NoteType;
      readonly dots: number;
      readonly perMinute: string;
      readonly hidden: boolean;
    }
  | { readonly kind: "rehearsal"; readonly text: string }
  | { readonly kind: "segno" }
  | { readonly kind: "coda" };

/** A clef change inside a measure, before whatever else starts there. */
export interface ClefChange extends Timed {
  readonly kind: "clef";
  readonly clef: Clef;
}
