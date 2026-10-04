/* ====================================================================
   TYPES — the contract, expressed once. Pure declarations, zero runtime.
   Everyone imports this; it imports nothing. That dependency shape IS the
   architecture: inputs and outputs both depend on the model's type, never
   on each other. The projection contract — View, Frame, ViewModule — is its
   counterpart in view.ts; see that file for why the two are separate.
   ==================================================================== */

/** MIDI note number, 0–127. The unambiguous physical truth. */
export type Pitch = number;

/** A diatonic letter name. A union (not `string`) so the grand-staff row
 *  math and `octaveFor` stay exhaustive and typos are caught at author time. */
export type Letter = "C" | "D" | "E" | "F" | "G" | "A" | "B";

/** Single accidentals only; doubles collapse to one glyph (position is by
 *  letter anyway), matching the renderers' ACC map. */
export type Accidental = "" | "#" | "b";

/** Which of the two rendered streams a note belongs to. Honestly two-valued,
 *  because the renderers' question is honestly two-valued: the hands toggle
 *  colors a note one way or the other. Per-voice coloring of, say, four
 *  choral parts is a DIFFERENT question — `stream` plus a palette — and would
 *  be its own field, since conflating the two is what this replaces. */
export type Hand = "upper" | "lower";

/** The notation choice for a pitch — kept deliberately separate from `pitch`.
 *  C♯ and D♭ are the same `pitch` but different `Spelling`. */
export interface Spelling {
  letter: Letter;
  acc: Accidental;
}

/** A note's identity, unique within its Score. Every consumer that must know
 *  "is this the same note as last frame?" — the audio voice map, the MIDI-out
 *  edge detector, the piano roll's lit keys — asks this and not object
 *  identity. Branded so a raw number can't be passed where one is wanted.
 *
 *  It exists because that question used to be answered by `===` on the Note
 *  OBJECT, which worked only because `activeAt` happens to `.filter` rather
 *  than `.map`. Nothing in the types said so; a defensive `{...n}` anywhere in
 *  the chain would have re-attacked every note every frame. Identity now lives
 *  in the value, where the type system carries it. */
export type NoteId = number & { readonly __noteId: unique symbol };

/** The one immutable value everything hangs off. `readonly` makes "outputs
 *  consume but never mutate the model" a compile error to violate. */
export interface Note {
  /** Assigned by `Core.makeScore` from the post-sort index — the only place a
   *  Note is ever constructed, which is what makes it unique and stable. */
  readonly id: NoteId;
  readonly pitch: Pitch;
  readonly spelling: Spelling;
  readonly onset: number; // seconds from start (tempo already resolved)
  readonly duration: number; // seconds
  /** Which hand/staff to render this note as — RESOLVED BY THE PARSER, in the
   *  parser's own namespace, because the parser is the only module that knows
   *  what its stream numbers mean. This is the question the renderers actually
   *  ask ("right hand or left?"), so it is the question the model answers.
   *  Absent when the source has no such grouping (LilyPond). */
  readonly hand?: Hand;
  /** How hard the key is struck, 1–127 as MIDI counts it — RESOLVED BY THE
   *  PARSER from whatever its source says about loudness (a MIDI note-on,
   *  a MusicXML or LilyPond dynamic). Absent when the source says nothing;
   *  perform.ts decides what an absent velocity is played at. */
  readonly velocity?: number;
  /** Raw provenance from the source: MusicXML `<staff>`, MIDI track index,
   *  part ordinal — whichever the parser had. ADVISORY ONLY. Its namespace
   *  varies by source and even the number of streams is source-dependent, so
   *  nothing may ask it a binary question; that is what `hand` is for. */
  readonly stream?: number;
}

/** One bar (measure) of the score, in seconds, half-open like every other
 *  interval here: a note beginning exactly at `end` is in the next bar.
 *  Bars are RESOLVED BY THE PARSER, the way `hand` is — MIDI carries a
 *  time-signature meta event, MusicXML has `<measure>` elements, LilyPond
 *  has `\time` — because only the parser knows its source's meter. The
 *  model itself still knows nothing of beats: a bar arrives as two
 *  instants, tempo already resolved. */
export interface Bar {
  /** Position in `Score.bars`, 0-based. Bar NUMBERS as a musician says
   *  them are this plus one, and only a label ever adds it. */
  readonly index: number;
  readonly start: number;
  readonly end: number;
  /** The time signature in force: `beats` over `unit` — 3 and 4 for 3/4,
   *  6 and 8 for 6/8. What turns this bar's seconds back into note VALUES
   *  for engraving: a quarter lasts `(end - start) / (beats * 4 / unit)`.
   *  The model still stores seconds; this is the one place it remembers
   *  how many of them make a beat, and only a renderer that draws stems
   *  and flags ever asks. */
  readonly beats: number;
  readonly unit: number;
  /** The key signature in force, as sharps (positive) or flats (negative)
   *  on the circle of fifths: 0 is C major / A minor, 2 is D major, -3 is
   *  E♭ major. Decides which accidentals are printed, never what sounds —
   *  a note's own `Spelling` already says what it is. */
  readonly fifths: number;
}

/** What a parser knows about one barline: where it falls, and — when it
 *  changes there — the meter and key in force from then on. A bare number
 *  is a barline in whatever meter and key were already in force, so a
 *  fence-post list of seconds still reads as one. */
export type Barline = number | {
  readonly at: number;
  readonly beats?: number;
  readonly unit?: number;
  readonly fifths?: number;
};

/** A contiguous run of bars by index, both ends inclusive — `from === to`
 *  is one bar. The unit practice mode isolates and loops.
 *
 *  Either end may be TRIMMED to a point inside its bar, counted in that
 *  bar's own beats (`Bar.beats`, from 0) so a trimmed edge means the same
 *  thing at any tempo, as a bar does. Absent is the barline: the range
 *  begins at bar `from`'s opening barline and ends at bar `to`'s closing
 *  one. A trimmed end is exclusive, like every interval here — `toBeat: 2`
 *  stops as beat 3 of a 4/4 bar begins. Core.normalizeRange keeps a trim
 *  strictly inside its bar, so "trimmed to the barline" has one spelling:
 *  absent. Only the time conversions honour a trim; a view that shows
 *  whole bars reads `from` and `to` and is right as it stands. */
export interface BarRange {
  readonly from: number;
  readonly to: number;
  readonly fromBeat?: number;
  readonly toBeat?: number;
}

/** A stretch of score time in seconds, `start` inclusive and `end`
 *  exclusive — the playback loop. Seconds, not bars or steps, because the
 *  clock is what honours it and seconds are the clock's only unit. */
export interface TimeRange {
  readonly start: number;
  readonly end: number;
}

/** A score: notes sorted by onset, the total duration, and its bars. */
export interface Score {
  readonly notes: readonly Note[];
  readonly duration: number;
  /** Never empty, and together covering the whole piece: a source with no
   *  bar information yields ONE bar spanning it, so a consumer never has to
   *  ask "does this score have bars" before asking "which bar is this". */
  readonly bars: readonly Bar[];
  /** Where the sustain pedal is down: sorted, never overlapping, within
   *  the piece — and never merged where they touch, because a range that
   *  ends where the next begins is a pedal CHANGE, the dampers dropping
   *  for an instant between. RESOLVED BY THE PARSER, like `hand`; empty
   *  when the source says nothing about the pedal. A performance fact,
   *  not a notational one: `Note.duration` keeps its notated meaning. */
  readonly pedal: readonly TimeRange[];
}

/** What a parser produces and `Core.makeScore` consumes — spelling optional,
 *  filled with a default when absent (the MIDI case). */
export interface RawNote {
  pitch: Pitch;
  spelling?: Spelling;
  onset: number;
  duration: number;
  hand?: Hand;
  velocity?: number;
  stream?: number;
}

/** One note handed to an Output, already placed in WALL time — the
 *  `performance.now()` milliseconds Web MIDI and rAF share. The scheduler
 *  decides when; the Output only decides how it sounds. */
export interface Strike {
  readonly pitch: Pitch;
  /** 1–127, MIDI's unit, whichever device ends up sounding it. */
  readonly velocity: number;
  /** When the key goes down. */
  readonly at: number;
  /** When it comes up. Absent is "held until the next flush" — a step the
   *  playhead is parked on has no end of its own. */
  readonly off?: number;
  /** When the dampers fall, if the sustain pedal holds them off past
   *  `off`. For an Output that sustains notes itself (the built-in piano);
   *  one that is sent the pedal (MIDI) ignores it. */
  readonly damp?: number;
  /** Seconds of the note already gone by at `at`: set when playback drops
   *  into a note rather than reaching its start (a seek, a loop wrap). */
  readonly offset?: number;
}

/** Where sound goes: the built-in piano or one MIDI port. Two paths that
 *  never touch each other — the SCORE path (strike/flush), which the
 *  scheduler drives ahead of time, and the LIVE path (liveOn/liveOff),
 *  which the user's hands drive immediately. See SPEC_playback.md. */
export interface Output {
  strike(s: Strike): void;
  /** Every strike up to wall time `until` has now been handed over. An
   *  Output that cannot recall what it sends (MIDI) holds anything later —
   *  a long note's note-off — until the scheduler's window reaches it. */
  advance(until: number): void;
  /** The sustain pedal goes down or up at wall time `at`. Every strike
   *  already carries its damper time, so only an Output that hands the
   *  pedal to something else (a MIDI synth) needs to act on this. */
  pedal(down: boolean, at: number): void;
  /** Silence the score path — sounding notes and anything scheduled but not
   *  yet heard. Leaves the live path alone. */
  flush(): void;
  /** Seconds from a strike's `at` to the moment it is heard. */
  latency(): number;
  liveOn(pitch: Pitch, velocity: number): void;
  liveOff(pitch: Pitch): void;
  /** No longer the active output: let go of everything, device included. */
  detach(): void;
}

/** A stretch of score time the clock is about to play, [start, end), and
 *  the wall time `start` will sound at. Score time runs linearly from
 *  `start` until `until` — the loop's end, or the piece's — so a note's
 *  wall time anywhere in the pass is `at + (t - start) * 1000`. */
export interface Stretch {
  readonly start: number;
  readonly end: number;
  readonly at: number;
  readonly until: number;
  /** Time JUMPED to `start` here (a loop wrap) instead of flowing into it,
   *  so notes already sounding at `start` must be dropped into. */
  readonly jump: boolean;
}

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
  /** Subscribe to the per-frame tick. Returns an unsubscribe — without one,
   *  anything needing a frame callback had to start its own rAF loop, which
   *  is how a program with "exactly one timer" grew a second. */
  onFrame(fn: (t: number) => void): () => void;
  /** Cancel the rAF loop. Together with onFrame's unsubscribe this makes the
   *  clock's lifecycle a contract rather than a single-use-per-page accident. */
  stop(): void;
  /** Confine playback to a loop, or free it with null. While playing, time
   *  that reaches `end` comes back round to `start`; play() from outside
   *  the loop enters it at `start`. Owned HERE, not by a subscriber seeking
   *  on overshoot, so no frame ever observes a time past the loop's end.
   *  An empty or out-of-score range is clamped, and one with nothing left
   *  is null. */
  setLoop(range: TimeRange | null): void;
  /** The loop as accepted — after clamping — or null. */
  loop(): TimeRange | null;
  /** The score time `lag` seconds ago on this play span — what is being
   *  HEARD now, when sound takes `lag` to arrive. Never earlier than where
   *  the span began, and folded into the loop like now(). */
  heard(lag: number): number;
  /** The score time the wall window [fromMs, toMs) will play, as Stretches:
   *  more than one only where the loop wraps inside it, none while paused. */
  ahead(fromMs: number, toMs: number): readonly Stretch[];
  /** Subscribe to transport changes — play, pause, seek, a new loop —
   *  anything that invalidates what was scheduled ahead. Returns the
   *  unsubscribe. */
  onChange(fn: () => void): () => void;
}
