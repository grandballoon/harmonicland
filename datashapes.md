# Data shapes

Every TypeScript type, interface, enum, and shape-bearing constant table in `src/`, with what it is for.

The organizing principle holds throughout: **inputs and outputs both depend on the model's types, never on each other**.
It is now stated in *two* files rather than one.
`types.ts` is the **model** contract — what a score is — and imports nothing at all.
`view.ts` is the **projection** contract — what it takes to draw one — and imports only types.
They are separate because a `Frame` carries live performance state spelled in the harmony vocabulary (`Key`, `Degree`, `Cursor`), and dragging all of that into `types.ts` would trade an honest boundary for a bigger muddle.

Below those sit four **leaves**, each importing nothing but types: `pitch.ts` (physical-keyboard facts, and how a note is spelt), `outputs/scroll.ts` (time-to-pixels geometry), `outputs/defs.ts` (the SVG glow filter and `<text>` helper), and `steps.ts` (the score cut into simultaneities).
The first three exist because the fact each owns was previously duplicated across four or five files and held only by coincidence.
`steps.ts` is a leaf for a different reason: it is a second *projection axis* of the model — score × step rather than score × time — and keeping it import-free is what lets both the practice cursor and the practice view depend on it without either depending on the other.

```
                 types.ts (zero imports) · view.ts (types only)
                            │
   pitch.ts · steps.ts · outputs/scroll.ts · outputs/defs.ts   (leaves)
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
   inputs/*            core.ts / clock.ts    outputs/*
   (bytes → Score)     (Score, time)         (svg, Frame) → svg
                            │
   harmony/*  (pure chord + lattice math; progressions → RawNote[] + Chart)
                            │
   perf-state.ts / tonnetz-state.ts / practice-state.ts   (live selection)
                            │
                    live-keys.ts   (live voices, press edges)
                            │
        live-midi.ts · live-gamepad.ts · gamepad-*.ts   (input surfaces)
```

That shape is asserted, not narrated: `src/layering.test.ts` checks that `types.ts` imports nothing, that the four leaves import nothing but types, that `harmony/` never reaches into `inputs/` or `outputs/`, and that `inputs/` and `outputs/` never import each other.
It also pins the edges the progression work added: `harmony/progression.ts` never imports `core.ts`, `harmony/repertoire.ts` depends on `progression.ts` and never the reverse, only `main.ts` imports the repertoire, and only `main.ts` builds a clock.

Types are marked **exported** or **module-private**.
A module-private shape is deliberately not part of any contract — it is an implementation detail of one file, and several of the file headers say so explicitly.

---

## 1. The model contract — `src/types.ts`

Pure declarations, zero runtime, zero imports.
This is the whole contract between the two halves of the program, expressed once.

### `Pitch` — exported

```ts
type Pitch = number;
```

A MIDI note number, 0–127.
The unambiguous physical truth about a note: what key gets pressed, what frequency sounds.
Deliberately separate from how the note is *written*.

### `Letter` — exported

```ts
type Letter = "C" | "D" | "E" | "F" | "G" | "A" | "B";
```

A diatonic letter name.
A union rather than `string` so that the grand-staff row math and `octaveFor` stay exhaustive and typos are caught at author time.

### `Accidental` — exported

```ts
type Accidental = "" | "#" | "b";
```

Single accidentals only.
Double accidentals collapse to one glyph, because staff position is determined by the letter anyway; this matches the `ACC` glyph map in the renderers.

### `Hand` — exported

```ts
type Hand = "upper" | "lower";
```

Which of the two rendered streams a note belongs to.
Honestly two-valued, because the renderers' question is honestly two-valued: the hands toggle colors a note one way or the other.
This replaces the old arrangement where renderers asked a *numeric* `staff` field a binary question and normalized it through a `Core.upperStaff` helper — a normalization that only the parser had the information to do correctly.
Per-voice coloring of, say, four choral parts is a different question — `stream` plus a palette — and would be its own field; conflating the two is exactly what this replaces.

### `Spelling` — exported

```ts
interface Spelling {
  letter: Letter;
  acc: Accidental;
}
```

The notation choice for a pitch, kept deliberately apart from `pitch`.
C♯ and D♭ are the same `Pitch` but different `Spelling`, and that difference is exactly what the standard-staff renderer needs and the piano roll ignores.

### `NoteId` — exported

```ts
type NoteId = number & { readonly __noteId: unique symbol };
```

A note's identity, unique within its `Score`, and branded so a raw `number` cannot be passed where one is wanted.
Every consumer that must answer "is this the same note as last frame?" — the audio voice map, the MIDI-out edge detector, the piano roll's lit bars — asks this and not object identity.

It exists because that question used to be answered by `===` on the `Note` **object**, which worked only because `Core.activeAt` happens to `.filter` rather than `.map`.
Nothing in the types said so, and a defensive `{...n}` anywhere in the chain would have silently re-attacked every note every frame.
Identity now lives in the value, where the type system carries it.

### `Note` — exported

```ts
interface Note {
  readonly id: NoteId;
  readonly pitch: Pitch;
  readonly spelling: Spelling;
  readonly onset: number;    // seconds from start (tempo already resolved)
  readonly duration: number; // seconds
  readonly hand?: Hand;
  readonly stream?: number;
}
```

The one immutable value everything hangs off.
`readonly` on every field makes "outputs consume but never mutate the model" a compile error to violate rather than a convention to remember.
Time is in **seconds, with tempo already resolved** — the core knows nothing of ticks, beats, or BPM, because every parser has already done that conversion.

`id` is assigned by `Core.makeScore` from the **post-sort index**, which is the only place a `Note` is ever constructed — that is what makes it unique, stable, and dense.

The old single `staff?: number` field is now split in two, which is the substantive model change in this round:

- `hand` is the question the renderers actually ask, **resolved by the parser** in the parser's own namespace, because the parser is the only module that knows what its stream numbers mean.
  Absent when the source has no such grouping (LilyPond).
- `stream` is raw provenance — a MusicXML `<staff>`, a MIDI track index, a part ordinal — and is **advisory only**.
  Its namespace varies by source and even the number of streams is source-dependent, so nothing may ask it a binary question.

### `Bar` — exported

```ts
interface Bar {
  readonly index: number;  // position in Score.bars, 0-based
  readonly start: number;  // seconds
  readonly end: number;    // seconds, exclusive
  readonly beats: number;  // the time signature: beats over unit
  readonly unit: number;
  readonly fifths: number; // the key signature: sharps (+) or flats (−)
}
```

One measure, as two instants, plus the meter and key in force during it.
Half-open like every other interval in the model, so a note beginning exactly at `end` is in the next bar.
Bars are **resolved by the parser**, the way `hand` is: MIDI carries time-signature and key-signature meta events, MusicXML has `<measure>`, `<time>` and `<key>`, LilyPond has `\time`, `\partial` and `\key`, and only the parser knows its source's meter.
The model still stores seconds; `beats`/`unit` is the one place it remembers how many of them make a beat, and only the engraver — which needs a *quarter* to draw stems and flags — ever asks: a quarter lasts `(end − start) / (beats · 4 / unit)`.
`fifths` decides which accidentals get printed, never what sounds; a note's own `Spelling` already says what it is.
Bar *numbers* as a musician says them are `index + 1`, and only a label ever adds the one.

### `Barline` — exported

```ts
type Barline = number | {
  readonly at: number;
  readonly beats?: number;
  readonly unit?: number;
  readonly fifths?: number;
};
```

What a parser knows about one barline: where it falls, and — when it changes there — the meter and key in force from then on.
A bare number is a barline in whatever meter and key were already in force, so a fence-post list of seconds still reads as one; `Core.makeScore` carries the signature forward from post to post and starts from common time with no sharps or flats.

### `BarRange` — exported

```ts
interface BarRange {
  readonly from: number;
  readonly to: number;
}
```

A contiguous run of bars by index, both ends inclusive, so `from === to` is one bar.
The unit practice mode isolates and loops; it lives in `types.ts` because it is a fact about the score's bars, not about the cursor.

### `Score` — exported

```ts
interface Score {
  readonly notes: readonly Note[];
  readonly duration: number;
  readonly bars: readonly Bar[];
}
```

A whole piece: notes sorted by onset, total duration, and its bars.
`duration` is derived once (`max(onset + duration)`) so the clock and the scrub bar never have to recompute it.
`bars` is **never empty** and always covers the piece: a source with no bar information yields one bar spanning it, so a consumer never has to ask "does this score have bars" before asking "which bar is this".
`Core.barAt(score, t)` answers the second question, clamped at both ends.

### `RawNote` — exported

```ts
interface RawNote {
  pitch: Pitch;
  spelling?: Spelling;
  onset: number;
  duration: number;
  hand?: Hand;
  stream?: number;
}
```

What a parser produces and `Core.makeScore` consumes.
It is the mutable, spelling-optional, **id-less** twin of `Note`: mutable because tie-merging parsers extend a note's `duration` in place after pushing it (and because `inputs/midi.ts` back-fills `hand` in a second pass), spelling-optional because MIDI files carry no spelling and let `Core.defaultSpelling` fill one in.
`makeScore(raw, barlines?)` is the one place `RawNote[]` becomes a `Score`, and the one place a `NoteId` is minted.
`barlines` are the bar boundaries the parser found, in seconds, as **fence posts** — the start of every bar plus the end of the last — and `makeScore` repairs what a real source gets wrong: a first post after zero gets a pickup bar prepended, posts that stop short of `duration` are continued at the last bar's length, and fewer than two usable posts means no meter and one bar of the whole piece.

### `Sink` — exported

```ts
type Sink = (score: Score, t: number, playing: boolean) => void;
```

A time sink driven each frame that produces something other than pixels.
`AudioOut.at` and `MidiOut.at` are the two implementations; both are edge-triggered, diffing this frame's active set against what they already have sounding.
`playing` is passed separately because a paused transport must silence held voices even though `t` has not changed.

### `Parser<I>` — exported

```ts
type Parser<I> = (input: I) => Score;
```

A parser: bytes-or-text in, `Score` out.
The generic parameter is the input medium — `Parser<ArrayBuffer>` for the SMF reader, `Parser<string>` for MusicXML and LilyPond.

### `Clock` — exported

```ts
interface Clock {
  now(): number;
  play(): void;
  pause(): void;
  seek(t: number): void;
  isPlaying(): boolean;
  onFrame(fn: (t: number) => void): () => void;
  stop(): void;
}
```

The single source of truth for time, and the only moving part in the program.
The interface exists precisely so the `requestAnimationFrame` implementation in `clock.ts` can be swapped for `Tone.Transport` or an audio clock without the loop or any output noticing.
`seek()` *is* scrubbing — there is no separate scrub concept.

Two members are new, and both exist to make "exactly one timer in the whole program" true rather than aspirational.
`onFrame` now returns an **unsubscribe** function; without one, anything needing a per-frame callback had to start its own `rAF` loop, which is precisely how `live-gamepad.ts` grew a second timer.
`stop()` cancels the loop and clears subscribers, making the clock's lifecycle a contract rather than a single-use-per-page accident.
The tick iterates a *copy* of the subscriber set, so a subscriber may unsubscribe from inside its own callback.

---

## 2. The projection contract — `src/view.ts`

Pure declarations, zero runtime; every import is type-only, so nothing here survives compilation.
The file exists to fix two things the old `View = (svg, score, t) => void` alias let through.

**Hidden state.** Five of the eight views read module-level mutable globals (`LiveKeys`, `PerfState`, `TonnetzState`), so the real signature was `svg → score → t → LiveState → unit` with `LiveState` passed invisibly.
You could not snapshot-test a view, render two scores side by side, or render off-screen.

**Hidden dispatch.** Pointer input was routed by comparing `view` for reference identity against specific module exports, plus a companion region function that neither the type nor the compiler knew about — so a ninth view silently had no keyboard, and wrapping any view in a decorator silently broke hit-testing.

### `LiveSnapshot` — exported

```ts
interface LiveSnapshot {
  held: ReadonlySet<Pitch>;
  perf: PerfSnapshot;
  tonnetz: TonnetzSnapshot;
  practice: PracticeSnapshot;
  pagePan: PagePan | null;
}
```

Everything live about this instant that is neither the score nor the clock.
`main.ts` assembles exactly one per frame and hands the same one to every consumer, which also removes the hazard of two views observing different live state within a single frame.

`practice` is new.
It is inert (`active: false`) unless practice mode is running, the same way `perf` is inert unless a chord is being played, so every view receives it and all but one ignore it.

`pagePan` is where a page has been panned by its tape, or null at rest; only the `StaffPiano` flavors read it.

### `Frame` — exported

```ts
interface Frame {
  score: Score;
  t: number;
  live: LiveSnapshot;
}
```

The one moment a view draws — the hidden parameter made a value.

### `Region` — exported

```ts
interface Region { x: number; y: number; w: number; h: number; }
```

A rectangle in an svg's local pixel space, used to say where a playable keyboard sits.
It lived in `outputs/piano-roll.ts` before; it belongs here now because `ViewModule` names it.

### `PagePan` — exported

```ts
interface PagePan {
  bar: number; // the bar the page is fitted to
  pan: number; // pixels along the strip from resting on it
}
```

A page panned by its tape.
At rest the page is fitted to the bar the playhead is in and turns as the playhead moves on.
Panned, it stays fitted to the bar it was panned from, since a page that refitted itself to every bar the playhead crossed would change its scale under the reader's finger.
It comes back to rest once the playhead leaves its window, which the view decides and reports back through `Tape.pagePan`.

### `Tape` — exported

```ts
interface Tape {
  region: Region;
  axis: "x" | "y";
  length: number;
  pos: number;
  pagePan: PagePan | null;
  seek(pos: number): { t: number; pagePan: PagePan | null };
}
```

The part of a clock-driven view that a native scroller is laid over, standing for the playhead.
Scrolling it moves the playhead, so the notes, the keys, the sound and the scrub bar keep one "now" between them.
`pos` is where the scroller stands for the frame drawn, and `seek` is where a scroller moved elsewhere puts the playhead.
`main.ts` owns the DOM in between: it stands the scroller at `pos` every frame and seeks the clock on any position it did not set itself.
The piano roll's tape is its falling notes, the whole piece stood on end with its start at the bottom, so a swipe down brings the notes down onto the keys.
The `StaffPiano` flavors' tape is the page, panned across the piece, with the music sliding under a playhead that stays where it was on screen.
Practice mode has none: its learner, not the clock, is the transport, so its scroller (`Scroller` in `practice.ts`) moves only the page.

### `View` — exported

```ts
type View = (svg: SVGSVGElement, f: Frame) => void;
```

An output projection, genuinely a function of its arguments now.
`outputs/view-purity.test.ts` exercises exactly what that bought: `Nashville` and `Tonnetz` can be rendered from a constructed snapshot and asserted byte-identical, which no test in the suite could do before.

### `ViewModule` — exported

```ts
interface ViewModule {
  render: View;
  keyboardRegion(svg: SVGSVGElement, live: LiveSnapshot): Region | null;
  tape(svg: SVGSVGElement, f: Frame): Tape | null;
}
```

A view plus the facts about it that `main.ts` needs and the render function cannot carry, stated once instead of restated in a hand-synced dispatch chain.
`keyboardRegion` is **required, not optional-with-a-default**: a new view cannot compile without answering the question.
Views with no keyboard write `() => null`, which is a declaration rather than an omission.

`keyboardRegion` now also receives the frame's `live` snapshot — the **same** one the frame was rendered from.
A view's layout may legitimately depend on live state: practice mode gives up a column to its harmony bar when, and only when, the lesson carries a `Chart`, and a region function that could not see that would hand back a keyboard wider than the one drawn.
That failure is silent — a hit-test disagreeing with the pixels produces no error, just wrong notes near the edge — which is why the parameter is in the type rather than the region being recomputed from a global.
Views whose geometry is a function of size alone simply ignore it, which is itself a statement.

`tape` is required for the same reason, and answered from the whole frame because where a tape stands is a function of the playhead.

Every renderer now exports one: `StaffStd`, `PianoRoll`, `Tonnetz`, `Combo`, `Nashville`, `Practice`, and `StaffPiano.keysView` / `StaffPiano.rollView` — eight in all, which `view-purity.test.ts` asserts.
The two `StaffPiano` flavors each carry their own region function, which closes the old trap where `renderKeys` and `renderRoll` were distinguishable only because `stacked(...)` happened to be called twice.

---

## 3. Generative harmony — `src/harmony/perfecto.ts`

The generative counterpart to `core.ts`.
Where the core holds an immutable `Score` to be played *back*, this turns three live choices — a key, a numbered degree, and a joystick coloration — into MIDI numbers on the fly.
Pure: no DOM, no audio, no side effects.
Its one import is `PITCH_NAMES` from the `pitch.ts` leaf, which it re-exports because its callers name pitches too.

### `PitchClass` — exported enum

```ts
enum PitchClass { C = 0, Cs, D, Ds, E, F, Fs, G, Gs, A, As, B }
```

The 12 pitch classes as a numeric enum, 0–11.
Used as the `root` of a `Key`; `PITCH_NAMES` is its display twin.

### `ScaleType` — exported

```ts
type ScaleType =
  | "major" | "naturalMinor" | "harmonicMinor" | "melodicMinor"
  | "majorPentatonic" | "minorPentatonic" | "blues"
  | "dorian" | "mixolydian" | "lydian";
```

Which scale the numbered degrees are drawn from.
Note that three of these are **short scales** (5 or 6 notes), which is why the voicing math wraps degree indices with `% n` plus a `floor(.../n) * 12` octave-add: the diatonic third and fifth above a degree can run off the end of the interval array, and thirds must still stack.
The degree-root half of that wrap now lives in exactly one function, `degreeOffsetOf(key, degree)`, because three callers needed it — the quality rule, the voicing, and the progression realizer, which must know where a degree sits before any voicing exists.
`layering.test.ts` asserts the wrap expression appears only in `perfecto.ts`.

### `Key` — exported

```ts
interface Key {
  root: PitchClass;
  scale: ScaleType;
}
```

A tonal center: root pitch class plus scale type.
Everything downstream (degree roots, chord quality, chord names, roman-numeral casing) is computed from this pair rather than stored.

### `Degree` — exported

```ts
type Degree = 1 | 2 | 3 | 4 | 5 | 6 | 7; // I, ii, iii, IV, V, vi, vii°
```

A Nashville-number chord degree, 1-based.
`degreeIndex(d) = d - 1` converts it to a zero-based index into the scale's interval array.
A literal union rather than `number` so a stray 0 or 8 is a compile error, and so `Record<Degree, …>` tables are exhaustive.

### `JoystickMode` — exported

```ts
type JoystickMode = "default" | "extended" | "chromatic";
```

Which of three coloration tables the joystick direction is looked up in.
Roughly: familiar triads and sevenths, then extensions, then altered/chromatic voicings.

### `JoystickDirection` — exported

```ts
type JoystickDirection =
  | "center" | "up" | "upRight" | "right" | "downRight"
  | "down" | "downLeft" | "left" | "upLeft";
```

One of nine joystick zones: the eight compass directions plus the deadzone center.
`center` always means the uncolored base triad.

### `JoystickOutcome` — exported

```ts
interface JoystickOutcome {
  major: number[];
  minor: number[];
  dim: number[];
}
```

What one joystick cell produces, as semitone intervals above the chord root, with one pre-baked list per base quality.
Chord quality is **detected, not stored** — the diatonic third and fifth above the degree root decide it — and that detection just selects which of these three lists to use.
Some cells deliberately collapse all three qualities to the same list; that is how the table *forces* a quality regardless of degree.

That selection is now made in exactly one place, `chordIntervals(key, degree, mode, direction)`, which both `computeVoicing` and `chordName` call.
A caller that *names* a chord and one that *sounds* it can therefore never disagree about which of a cell's lists it uses.

### `Inversion` — exported

```ts
type Inversion = "root" | "first" | "second";
```

Which inversion to apply after building the interval stack.
Implemented by raising the lowest one or two notes an octave and re-sorting, so it works on chords of any size.

### `Voicing` — exported

```ts
interface Voicing {
  notes: number[];   // MIDI note numbers, sorted ascending
  bassNote?: number; // optional slash-chord bass (reserved, currently unused)
}
```

The output of `computeVoicing`: concrete MIDI numbers ready for `LiveKeys.press`.
It is also the *input* to the next chord's voice-leading search, which is why `PerfState` keeps the last one around after release.
`bassNote` remains reserved and unwritten — nothing sets it and nothing reads it.

### `ComputeVoicingArgs` — exported

```ts
interface ComputeVoicingArgs {
  key: Key;
  degree: Degree;
  joystickMode: JoystickMode;
  joystickDirection: JoystickDirection;
  inversion: Inversion;
  octave: number;
  voiceLeading: boolean;
  previousVoicing?: Voicing | null;
}
```

The complete input to the one generative function — every live choice in one flat record.
`PerfSnapshot` is structurally compatible with it minus `previousVoicing`, which is what lets `PerfState` compute a `preview` with `computeVoicing({ ...sel, voiceLeading: false, previousVoicing: null })`.
When `voiceLeading` is on and a `previousVoicing` exists, the function searches three octave shifts (−1, 0, +1) and picks the candidate with the least total motion from the previous chord.
`inversion` is held **fixed** during that search — it is a constraint the player set, not a seed.
The search used to range over all three inversions too, which silently overrode the field and made the inversion control a no-op whenever voice-leading was on.
`octave` follows the MIDI convention middle C = C4 = 60, hence the `(octave + 1) * 12` in the root calculation.

### `ChordQuality` — exported

```ts
type ChordQuality = "maj" | "min" | "dim";
```

The detected quality of a degree in a key.
One rule, `degreeQuality`, shared by every consumer: `chordIntervals` picks a `JoystickOutcome` list with it, `degreeNumeral` and `homeNumeral` derive roman-numeral casing from it, and the Nashville view and the practice harmony bar both color by it through the one `QUALITY_COLOR` table — so the color, the printed numeral, and the sound can never disagree.

Chord *names* are no longer looked up at all.
`chordSymbol(intervals)` derives the suffix ("min7", "dom9", "½dim7", "6/9") from the intervals that will actually sound, and `chordName` prefixes the root.
The table it replaced was keyed by joystick direction alone — a second, quality-blind copy of the harmony that called a ii chord "maj7" — and `layering.test.ts` now asserts `chordSymbol` is declared exactly once.

---

## 4. Lattice harmony — `src/harmony/tonnetz-lattice.ts`

Pure lattice math for the Tonnetz instrument.
This is the leaf that **owns** the lattice math: `pitchClassAt`, `triadName`, and `cursorLabel` live here, and `outputs/tonnetz.ts` imports the first two rather than keeping its own.
Both files previously carried hand-maintained copies, justified by a circular dependency that did not actually exist; the copies are gone and `layering.test.ts` keeps the next person from reintroducing a third.

### `Orient` — exported

```ts
type Orient = "up" | "down";
```

Which way a lattice triangle points, which *is* its chord quality: up = major, down = minor.
That equivalence is the pedagogical point of the whole view.

### `Cursor` — exported

```ts
interface Cursor { col: number; row: number; orient: Orient; }
```

The player's position on the infinite lattice — one triangle.
`col` advances by perfect fifths (+7 semitones), `row` by major thirds (+4); the pitch class at a cell is `(7 * col + 4 * row) mod 12`.
Coordinates are unbounded integers: the lattice repeats every 12 pitch classes, so walking far in any direction simply wraps in sound while the cursor keeps counting.
Default is `{ col: 0, row: 0, orient: "up" }`, which is C major.

### `Transform` — exported

```ts
type Transform = "P" | "L" | "R";
```

The three neo-Riemannian transforms.
Each keeps two common tones, moves one voice, flips `orient`, and is an **involution** — applying it twice returns to the start.
As lattice moves: from an up-triangle, P → down at `row - 1`, L → down at the same cell, R → down at `col - 1`; from a down-triangle the offsets mirror.

### `LatticeStep` — exported

```ts
type LatticeStep =
  | "fifthUp" | "fifthDown"
  | "majThirdUp" | "majThirdDown"
  | "minThirdUp" | "minThirdDown";
```

Translations across the lattice that **preserve orientation and quality**, unlike a `Transform`.
Fifths move along `col`, major thirds along `row`, and minor thirds are the diagonal difference of the two (`col + 1, row - 1`).

---

## 5. Progressions — `src/harmony/progression.ts`, `src/harmony/repertoire.ts`

The third way the program can name music.
`core.ts` holds a `Score` — notes at times, played back — and `perfecto.ts` holds one live chord.
Neither can say "ii–V–I", because that is a *sequence* of Perfecto selections: a structure, not a moment and not a recording.

A progression is a **source** of a score, taking its place beside the MIDI and MusicXML parsers rather than sitting beside practice mode as a second engine.
`realize` lowers one to `RawNote[]` and every downstream module — `makeSteps`, the cursor, the keyboard coloring, the arrows — works unchanged.
It hands back `RawNote[]` and lets the caller call `Core.makeScore`, which is what keeps `core.ts` out of `harmony/`.

### `Change` — exported

```ts
interface Change {
  readonly key: Key;
  readonly degree: Degree;
  readonly mode: JoystickMode;
  readonly direction: JoystickDirection;
  readonly inversion?: Inversion; // default "root"
  readonly beats: number;
  readonly label?: string;
}
```

One harmonic state, named in theory rather than in pitches.
The four harmonic fields are exactly `PerfState`'s live selection, deliberately: a `Change` is one frozen position of the same instrument, so anything that can play a chord can play a progression, and the Nashville vocabulary needs no translation.

`key` is the key this chord is **heard in**, and it is the one mechanism for three things.
Usually it is the progression's home; overriding it expresses a borrowed chord (♭VII in major), a secondary dominant (V/V), or an outright modulation (Coltrane changes).
There is no chromatic escape hatch: every chord in the program, wherever it came from, is still a degree of *some* key.

`beats`, not seconds, because a progression is written in bars and tempo is the realizer's business — the same split `core.ts` makes when parsers resolve ticks to seconds.

`label` is the analyst's name relative to home when the derived numeral cannot know it.
"V/V" is a fact about function that no analysis of a D major triad in C will recover; `homeNumeral` would honestly say "II".
It is absent by default, because the derivation is right far more often than not and a label on every change would be a second copy of the harmony waiting to disagree with the first.

### `Progression` — exported

```ts
interface Progression {
  readonly id: string;     // stable — what a UI stores
  readonly name: string;
  readonly family: string; // "Jazz", "Blues", "Cadences", …
  readonly about: string;  // one sentence on what practising it teaches
  readonly home: Key;
  readonly changes: readonly Change[];
}
```

An ordered run of `Change`s plus what it is for.
`id` is separate from `name` so renaming breaks no stored selection.
`home` is the tonic every numeral is counted against, and the only thing `transposeTo(p, root)` needs to move: every change's own `key` shifts by the same interval, including foreign ones, so a modulating progression keeps its internal relationships instead of collapsing onto the new tonic.

### `ChartEntry` — exported

```ts
interface ChartEntry {
  readonly at: number;    // score seconds
  readonly until: number; // half-open, matching Core.activeAt
  readonly index: number; // into Chart.changes
}
```

Where one `Change` sits in realized score time.
`index` points into `Chart.changes` rather than repeating the `Change`, so a progression played four times over is four references to one cycle, and "which bar of the loop am I in" reads straight off the value.
`changeOf(chart, entry)` is the one place that indirection is dereferenced.

### `Chart` — exported

```ts
interface Chart {
  readonly home: Key;
  readonly name: string;
  readonly about: string;
  readonly changes: readonly Change[];      // one cycle — what a reader sees listed
  readonly entries: readonly ChartEntry[];  // the repeats, in time
}
```

The analysis that survives lowering.
Once C–E–G–B is four `RawNote`s, nothing in them remembers it was Imaj7 in C, and a `Note` has no room for harmony and should not grow one — the same pitches are Imaj-in-C and Vmaj-in-F depending on the piece.
So the chart rides **beside** the score, not inside it.
A score loaded from a file has none and says so with `null`: the program does not invent an analysis nobody gave it.

It is read by score time — `entryAt(chart, t)` / `entryAfter(chart, t)` — using the `at` a `Step` already carries, so the cursor and the analysis need no parallel index kept in step with each other.

### `RealizeOpts` — exported

```ts
interface RealizeOpts {
  octave?: number;  // register of the voicing; default 4 (C triad on middle C)
  bass?: boolean;   // emit the root as a separate lower-hand note; default true
  beatSec?: number; // seconds per beat; default 0.5 = 120bpm
  cycles?: number;  // times round; default 4
}
```

The realizer's knobs, all optional, merged over a module-private `DEFAULTS`.
`bass` defaults on because it is what gives the practice hand filter a musical meaning here: "left hand" becomes root motion and "right hand" the voicing.
The bass sits `BASS_DROP = 2` octaves under the anchor, not one, because a voicing may sit up to a tritone below the anchor and one octave would let the bass land inside its own chord.

### `Realized` — exported

```ts
interface Realized {
  readonly notes: readonly RawNote[];
  readonly chart: Chart;
  readonly duration: number;
  readonly barlines: readonly number[];
}
```

The output of `realize`: notes and barlines for `Core.makeScore`, the chart for `PracticeState.begin`, and the total length.
`barlines` fall on the beat grid every `beatsPerBar` beats (four unless `RealizeOpts` says otherwise) regardless of where the changes fall, because a progression is a source and hands the model the same thing a parser does — each post carrying the meter and the home key's signature, from `keySignature(key)`, which places a `Key` on the circle of fifths by its pitch class and shifts by scale (minor and its relatives three flats from the major, dorian two, mixolydian one).
Every emitted note carries `hand` (`"upper"` for the voicing, `"lower"` for the bass) and no `stream`.
Each change's notes end exactly where the next change's begin, so `makeSteps` sees one clean simultaneity per chord and every chord is struck fresh.
Voicings are placed by whole-octave shifts to sit within a tritone of a fixed anchor, rather than by `computeVoicing`'s chord-to-chord voice-leading — a greedy chain climbed the dominant cycle from C2 to A6.

### `Color` and `Opt` — module-private, `src/harmony/repertoire.ts`

```ts
type Color = Pick<Change, "mode" | "direction">;

interface Opt {
  key?: Key;
  color?: Color;
  inversion?: Change["inversion"];
  label?: string;
}
```

Authoring shapes for the catalogue, not part of any contract.
`Color` is one joystick cell given a musical name — `TRIAD`, `SEVENTH`, `DOM7`, `HALFDIM7`, `ALT`, and so on.
They are *cells*, not interval lists, so a coloration tweak in `perfecto.ts` reaches every progression using it; and `SEVENTH` (default/right) resolves to maj7, min7, or ø7 by the degree's detected quality, so "sevenths throughout" is one constant.
`Opt` is the optional tail of the `at(home)(degree, beats, opt)` change-builder that makes the tables read as numerals.

---

## 6. Steps — `src/steps.ts`

The score re-cut along a different axis.
Every other module projects score × **time**; this one projects score × **step**, which is why practice mode needed a model of its own rather than another renderer.
A leaf: it names types from `types.ts` and imports no runtime.

### `HandFilter` — exported

```ts
type HandFilter = "both" | "upper" | "lower";
```

Which hands the learner is asked to play.
`upper` / `lower` are the same two values as `Hand`, so there is no second vocabulary for one fact.
A note with **no** `hand` belongs to every filter: on a score with no hands, "practise the right hand" honestly means "practise all of it", not "practise nothing".
`inHand(note, filter)` is that rule and `otherHand(score, filter)` is its exact complement, so a note can never land in both or neither.

### `Step` — exported

```ts
interface Step {
  readonly index: number;              // position in Steps.steps
  readonly at: number;                 // score seconds — the group's first onset
  readonly attack: readonly Note[];    // begin here: strike these
  readonly sustain: readonly Note[];   // begun earlier, still sounding: hold these
  readonly release: readonly Note[];   // sounding last step, not this one: let go
}
```

One simultaneity, and the unit the practice cursor counts in.
The three sets are disjoint and together answer the only question a learner has at that instant.
Time survives only as `at`, which the cursor seeks the clock to so the rest of the program stays coherent.

Grouping is by onset within `GROUP_SEC` (30 ms) of the group's **first** onset, not the previous note's, so a dense run cannot chain itself into one giant "chord" one small gap at a time.
`sustain` comes from each note's own duration, so a note held across four steps appears in all four; intervals are half-open, matching `Core.activeAt`.
`release` is filled in a second pass by `NoteId`, since it needs both neighbours.

### `Steps` — exported

```ts
interface Steps {
  readonly steps: readonly Step[];
  readonly hand: HandFilter;
}
```

A score cut for one hand filter.
The filter travels with the steps because a right-hand cut and a both-hands cut are different values that would otherwise be indistinguishable.

### `Span` — exported

```ts
interface Span {
  readonly first: number; // inclusive
  readonly last: number;  // exclusive
}
```

A run of consecutive steps by index — the steps that begin inside a `BarRange`.
`last` is exclusive, so `last - first` is how many and `last` is where a cursor that has finished them stands, the same convention `PracticeSnapshot.index === total` already used for the whole piece.
`spanOf(steps, bars, range)` cuts one, using the same `stepAt` a scrub uses at both edges, so "isolate bar 3" and "scrub to the start of bar 3" land on the same step.
A range with no steps in it — a bar of rests, or of the other hand only — comes back with `first === last`.

### `Move` — exported

```ts
interface Move {
  readonly from: Pitch;
  readonly to: Pitch;
  readonly hand?: Hand; // absent when the source had no hands
}
```

One arrow: a key down now, and the key it moves to next.
`movesBetween(current, next)` pairs them per hand by an optimal **non-crossing** assignment over the two sorted pitch lists — for points on a line that *is* optimal, and it is also the only answer that draws arrows a hand could follow.
Pairing never crosses hands, which is why one `hand` field describes both ends.
Attacks with no partner get no `Move`; ties break toward the earlier index so the output, and the markup built from it, is deterministic.

---

## 7. Live performance state

Four singletons, each owning one piece of "what is happening right now" — none of which lives in the immutable `Score`.
Recording a live performance back *into* a score is the deferred mutable-model step, and all four modules draw that boundary explicitly.

### `Voice` — exported, `src/live-keys.ts`

```ts
interface Voice {
  readonly pitch: Pitch;
}
```

A single live press, and the round's other substantive model change: **ownership is now a value**.
`press()` hands back an opaque handle and `release()` takes one, so "these pitches are mine" is expressible in the interface rather than mirrored privately by every caller.
Identity *is* the handle — two presses of the same pitch are two distinct voices — and the only thing a holder may read is which pitch it sounds.

The state behind it is `Map<Pitch, Set<Voice>>`, which buys two things the old `Set<number>` could not have:

- **Refcounting.** A pointer-pressed C4 and a chord's C4 are two voices on one pitch; the key stops sounding only when the last one lifts.
- **No desync.** `releaseAll()` from anywhere invalidates every outstanding handle, so an owner that asks `isLive(v)` gets the truth instead of believing a stale private mirror.
  `release()` is idempotent, which is what lets owners release defensively.

`LiveKeys` exports `{ press, release, releaseAll, isLive, held, onPress }`, where `held(): ReadonlySet<Pitch>` is the derived read every view consumes through `LiveSnapshot.held`.
Everything upstream — hardware MIDI, gamepad, pointer on the drawn keyboard, `PerfState`, `TonnetzState`, and `PracticeState`'s auto-played other hand — converges here, which is why a chord triggered from a gamepad automatically sounds, sends MIDI, glows on the piano roll, and fills a triangle on the Tonnetz with no module reaching across another.

Note the deliberate name collision: this `Voice` is a *handle*, while `audio.ts`'s module-private `Voice` is a pair of WebAudio nodes.
They are the same word at two layers and never meet — `live-keys.ts` calls `AudioOut.liveOn(pitch)` and never sees the node pair.

### `PressListener` — exported, `src/live-keys.ts`

```ts
type PressListener = (v: Voice) => void;
```

A subscriber to press **edges**, registered with `onPress(fn)`, which returns the unsubscribe — the same shape as `Clock.onFrame`.
It exists because `held()` answers "what is down" but cannot answer "was this struck again": a chord played twice and a chord held through are the same set, and polling per frame would miss a release-and-re-press inside one frame.
Practice mode's advance rule turns on exactly that difference.

It is notified per **voice**, not per pitch, after the voice map and the sinks agree, so a listener reading `held()` synchronously already sees the press; and handing over the `Voice` is what lets a subscriber that also presses notes tell its own apart.
There is deliberately no release counterpart: a release only makes a set smaller, so every question about it is already answered by reading `held()`.

### `PerfSnapshot` — exported, `src/perf-state.ts`

```ts
interface PerfSnapshot {
  key: Key;
  degree: Degree;
  joystickMode: JoystickMode;
  joystickDirection: JoystickDirection;
  inversion: Inversion;
  octave: number;
  voiceLeading: boolean;
  sounding: number[]; // MIDI notes currently pressed (empty when silent)
  preview: number[];
}
```

A defensive copy of the entire Perfecto selection, plus what it currently has pressed into `LiveKeys`.
The Nashville view renders straight from one of these per frame, and `main.ts` builds its status line from one; neither can mutate the real state, since `snapshot()` spreads the selection and copies the arrays.

`preview` is new: the chord this selection *would* sound, root position, no voice-leading.
It is computed here rather than by a view, so "what does this selection mean" stays one module's question — and that is exactly what lets `outputs/nashville.ts` be a pure function of the snapshot with no harmony import of its own beyond display tables.

`PerfState` keeps two pieces of state deliberately apart behind that snapshot:

- `sounding: Voice[]` — the LiveKeys **handles** we are holding, so a re-trigger can diff (common tones stay down, no re-attack) and `release()` lifts precisely what it put down.
  Every read goes through a `liveVoices()` filter on `LiveKeys.isLive`, which drops any handle LiveKeys has since invalidated, so there is no second copy of "what is sounding" to fall out of sync with the first.
  The snapshot's `sounding: number[]` is derived from those handles at snapshot time.
- `previousVoicing: Voicing | null` — the last chord computed, fed back in for voice-leading.
  It deliberately **outlives `release()`**, so the next chord still leads from it, the way a player's hand stays near where it just was.

### `TonnetzSnapshot` — exported, `src/tonnetz-state.ts`

```ts
interface TonnetzSnapshot {
  cursor: Cursor;
  octave: number;
  sounding: number[];
}
```

The lattice-native twin of `PerfSnapshot`, also a defensive copy (the cursor is spread, the array copied).
`outputs/tonnetz.ts` reads `live.tonnetz.cursor` out of its `Frame` to draw the cursor triangle as a stroked outline, distinct from sounding fills.
That read is deliberately one-way — `TonnetzState` never imports the view back.

`TonnetzState` uses the same handle-based diff-reconcile as `PerfState.trigger`: moving the cursor while sounding releases only the notes that changed and holds the common tones, and `sounding: Voice[]` is filtered through `LiveKeys.isLive` for the same reason.

### `PracticeSnapshot` — exported, `src/practice-state.ts`

```ts
interface PracticeSnapshot {
  active: boolean;
  hand: HandFilter;
  showOther: boolean;
  playOther: boolean;
  showArrows: boolean;
  score: Score | null;               // the lesson's score; null when inactive
  range: BarRange | null;            // the isolated bars, or the whole piece
  focus: BarRange;                   // the bars a page should show
  span: Span;                        // the steps the cursor may visit
  index: number;                     // 0-based, absolute; === total when finished
  total: number;
  current: Step | null;
  next: Step | null;
  moves: readonly Move[];
  pending: ReadonlySet<Pitch>;       // attacks not yet satisfied
  dropped: ReadonlySet<Pitch>;       // sustains let go — the only blocking mistake
  wrong: ReadonlySet<Pitch>;         // genuine wrong notes — reported, never blocking
  stale: ReadonlySet<Pitch>;         // a finger still resting from the last step
  hit: ReadonlyMap<Pitch, number>;   // correct strikes → pulse age, 0..1
  chart: Chart | null;
  change: ChartEntry | null;
  nextChange: ChartEntry | null;
  other: ReadonlySet<Pitch>;         // the non-practised hand at this step
}
```

The step-by-step twin of `PerfSnapshot`, and the only way practice state reaches a view.
What `PracticeState` owns that the other two do not is a **position in a score that time does not move**: the learner is the transport, and the cursor seeks the clock rather than the clock driving the cursor.

The advance rule the snapshot reports on: a step completes when every pitch it attacks has been *freshly struck* since the step began (via `LiveKeys.onPress`), all are down at that moment, and every pitch it sustains is still down.
The key sets are partitioned so no key ever carries two roles:

- `pending` is recomputed rather than tracked — never struck this step, or struck and since released — so a release is handled by the same expression as a press.
- `wrong` and `stale` split "held but not part of this step" by whether `Step.release` names it.
  Without `stale`, every correct press flashed red: the step completes on the press, the cursor advances, and the key still under the finger is instantly "unasked for".
  The grace lasts exactly one step.
- `hit` is the one field that changes with nothing but wall-clock time.
  It lives in state because the view could not compute it: by the next frame the cursor has already moved and the key just played correctly belongs to the next step.
  Values are ages, not timestamps, so a view never subtracts a clock reading of its own; expired entries are absent.

`other` is always the fact, never gated by `showOther` — hiding it is the view's decision, and when it is auto-played those keys are genuinely held, so the view must be told in order to suppress their live-press color.
`showArrows` is likewise presentation only: `moves` is always populated.
`moves` runs from the **previous** step's sounding keys to the current step's attacks — the transition the hand is in right now — so step 0 has none.

`chart`, `change`, and `nextChange` are the lesson's analysis and where the cursor sits in it, all `null` for a file-loaded score.
`change` is looked up by the current `Step.at`, which is the whole coupling between cursor and chart.

`range`, `span`, and `focus` are the bar isolation.
`range` is what the learner asked for (`setRange`, or `isolate(bar, extend)` from a click on the page) and `span` is the steps inside it, cut once by `spanOf` when the range is set and again by `setHand`, which re-cuts the steps it indexes.
The cursor may not leave the span: `enter` clamps at `first`, and past `last` an isolated range **loops** back to `first` — a passage isolated to be repeated should repeat — while the whole piece, with no range, still finishes at `total`.
On a wrap, `moves` runs from the range's last step, where the fingers actually are; on entering a range from elsewhere there are none, for the same reason step 0 has none.
`next` at the end of a range is its first step, the loop's honest answer to "then what".
`focus` is `range` when there is one and otherwise the bar the cursor stands in (`Core.barAt` on the current step's `at`), so the page turns itself.
`score` rides in the snapshot rather than being read off the frame so the steps and the page can never be cut from two different scores.
`step(delta)` moves the cursor by hand under the same rules, forgetting any partial progress on the step it leaves.

### `Session` — module-private, `src/practice-state.ts`

```ts
interface Session {
  score: Score;
  chart: Chart | null;
  steps: Steps;
  rest: readonly Note[];       // the notes NOT being practised
  range: BarRange | null;
  span: Span;
  index: number;
  seek: (t: number) => void;
}
```

One running lesson; `null` when none is.
`seek` is how the cursor moves the clock, passed into `begin` as a value so the module never imports the clock singleton and stays testable without a `rAF` loop.
`chart` is held here rather than passed per call so `setHand`, which restarts the lesson to re-cut it, cannot silently drop it.
`range` is held for the same reason, and `span` beside it so the per-frame snapshot never re-cuts what a range change already cut.

Beside it sit the module's other state, all module-private:

```ts
const cfg = { hand: "both" as HandFilter, showOther: true, playOther: true, showArrows: false };
let fresh: Set<Pitch>;           // struck since this step began
const hits: Map<Pitch, number>;  // pitch → performance.now() of a correct strike
let auto: Voice[];               // the other hand's LiveKeys handles
```

`cfg` is user preference and deliberately **outlives** a session, so changing score or hand does not silently reset the toggles.
`auto` is reconciled by the same handle diff as `PerfState.trigger` — common tones never re-attack — and a `reconciling` flag, not handle identity, keeps the cursor from grading its own accompaniment, because `LiveKeys` notifies from inside `press()` before the handle has been returned.
`hits` is bounded by the keyboard (one entry per pitch, overwritten) and is driven by wall-clock time, not the transport, since in practice mode score time stands still between presses.

---

## 8. Input surfaces

### `MidiNoteEvent` — module-private, `src/live-midi.ts`

```ts
interface MidiNoteEvent {
  kind: "on" | "off";
  pitch: number; // MIDI note number 0–127
  vel: number;   // 0–127 (dropped at the LiveKeys seam for now)
}
```

A decoded live Web MIDI message.
Private on purpose, exactly like `MidiEvent` in the file parser: it is an input detail, not part of the `types.ts` model contract.
A live message is only 3 bytes — no variable-length deltas, no running status, no tempo map — so `decode` is trivial next to the SMF reader.
Note-on with velocity 0 is decoded as the conventional note-off.
The module holds `Map<number, Voice>` (pitch → handle), because a hardware keyboard can only hold a pitch once and the map exists so a note-off releases *our* voice and not somebody else's.

### `GamepadButtonEvent` — module-private, `src/live-gamepad.ts`

```ts
interface GamepadButtonEvent {
  kind: "down" | "up";
  index: number; // button index within Gamepad.buttons
}
```

One button transition, produced by `diff(prev, curr)`.
The Gamepad API has no events, so the poll engine diffs last frame's held set against this frame's; these transitions are the stand-in for MIDI's discrete note-on/off.
It stays private because mappings never see it — they get the flattened `GamepadFrame` instead.

The poll now runs on the **clock's** frame rather than a private `rAF` loop, which it only ever had because `Clock.onFrame` could not be unsubscribed.
Sharing the clock also means a button press lights its key on the frame it happened instead of racing the renderer for it.

### `GamepadFrame` — exported, `src/live-gamepad.ts`

```ts
interface GamepadFrame {
  downs: number[];
  ups: number[];
  held: ReadonlySet<number>;
  axes: readonly number[];
}
```

What the poll engine hands a mapping each frame: button transitions, the currently-held set, and the raw analog axes.
`axes` exists for the Perfecto mapping's sticks; the engine itself never interprets any of it.

### `GamepadMapping` — exported, `src/live-gamepad.ts`

```ts
interface GamepadMapping {
  onFrame(f: GamepadFrame): void;
  reset(): void;
}
```

A controller *meaning* — the pluggable half of the input engine.
The same poll loop drives `keysMapping` (buttons → a run of chromatic pitches), `perfectoMapping` (buttons and sticks → `PerfState`), or `tonnetzMapping` (buttons → `TonnetzState`), and `main.ts` swaps it alongside the view, which is the same "swap a reference" move the view toggle already is.
`reset()` is the panic / stuck-state guard, called on disable and on every mapping switch so nothing is left ringing across the change.
`keysMapping` holds `Map<number, Voice>` (button index → handle), so a released button lifts exactly the voice that button pressed.

### `ActionId` — exported, `src/gamepad-tonnetz.ts`

```ts
type ActionId =
  | "transform.P" | "transform.L" | "transform.R"
  | "step.fifthUp" | "step.fifthDown"
  | "step.majThirdUp" | "step.majThirdDown"
  | "step.minThirdUp" | "step.minThirdDown"
  | "octave.up" | "octave.down"
  | "home" | "sustain";
```

A stable vocabulary of things the lattice instrument can do, named independently of any button.
This indirection is the point: bindings are data over this vocabulary rather than a switch on button index, so user-customizable bindings need only a new table, never new handler code.

### `CatalogEntry` — module-private, `src/gamepad-tonnetz.ts`

```ts
interface CatalogEntry {
  kind: "momentary" | "hold";
  down(): void;
  up?(): void;
}
```

The one place each action's effect lives, keyed by `ActionId` in `CATALOG: Record<ActionId, CatalogEntry>`.
`sustain` is the only `"hold"` action — both edges matter, because holding it rings the cursor triad and releasing it lifts the chord.
Every other action fires on `down` and ignores `up`, which is what lets you walk the lattice silently and then sustain wherever you land.

### `Bindings` — exported, `src/gamepad-tonnetz.ts`

```ts
type Bindings = Record<number, ActionId>;
```

Button index → action.
`DEFAULT_BINDINGS` puts sustain on RT, P/R/L on A/B/X, home on Y, lattice steps on the d-pad, and octave nudges on the bumpers.
`setBindings()` swaps the whole table.

### `PerfectoConfig` — exported, `src/gamepad-perfecto.ts`

```ts
interface PerfectoConfig {
  rootTrigger: "left" | "right"; // trigger that plays the root chord (I)
  chordStick: "left" | "right";  // stick that selects degrees ii..vii°
  colorStick: "left" | "right";  // stick that sets the coloration direction
}
```

Which physical control means what, mirroring `Bindings` for the Perfecto mapping: handedness is a data choice, not handler code.
`DEFAULT_CONFIG` is `{ rootTrigger: "right", chordStick: "right", colorStick: "left" }`.
`chordStick` and `colorStick` are meant to differ; if configured equal, the chord stick wins that stick and coloration falls back to center.
`setConfig()` releases any held chord before the controls change meaning.

### `HeldChord` — module-private, `src/gamepad-perfecto.ts`

```ts
interface HeldChord { src: string; degree: Degree; }
const held: HeldChord[] = []; // most-recent-last; the top source sounds
```

The held-chord stack.
A *source* is anything that can hold a chord: `"btn<i>"` for a degree button, `"trig"` for the root trigger, `"stick"` for the chord stick.
Keying by **source rather than by degree value** is the load-bearing detail: two sources holding the same degree number stay independent, so releasing one does not silence the other.
The stack is most-recent-wins, so the newest press is what sounds and releasing it falls back to whatever is still held underneath.

---

## 9. Parser-internal shapes

Each parser owns whatever intermediate shape its format needs and exports none of it except where tests require.
The shared output is always `RawNote[]` handed to `Core.makeScore`.

Each parser also now resolves `hand` itself, in the only namespace that knows what its stream numbers mean — see `Hand` above for why that moved out of the renderers.

### `MidiEvent` — module-private, `src/inputs/midi.ts`

```ts
interface MidiEvent {
  tick: number;
  kind: "tempo" | "meter" | "key" | "bar" | "on" | "off";
  pitch?: number;
  vel?: number;
  usPerQ?: number;
  beats?: number;  // meter and bar: the time signature
  unit?: number;
  fifths?: number; // key and bar: the key signature
  track?: number; // 1-based; piano exports put the hands on separate tracks
}
```

One event from a Standard MIDI File's first pass, still in **ticks**.
Tempo can change mid-stream, so the reader collects every track's events into one array, sorts by tick, then integrates seconds forward while updating `usPerQ` at each tempo event — a tempo map, not a single BPM.
`meter` events (the `0x58` time-signature meta) are turned into synthetic `bar` events on the tick grid *before* that integration, so a barline and the note on it land on the same second by construction rather than by two conversions agreeing; 4/4 is assumed when the file says nothing, and the final bar runs its full length past the last note-off.
Each `bar` event carries the meter it was laid down in and the `key` (`0x59` meta) in force at its tick, and becomes one `Barline`.
Note-on/off pairing is keyed `track << 7 | pitch` because tracks are independent streams and the same pitch may sound in both hands at once.

`track` becomes the note's `stream`, and then a second pass resolves `hand`: a format-1 file leads with a **tempo track that bears no notes**, so track 1 is routinely empty and "track 1 = upper" would be wrong.
The reader skips empty tracks and lets the lowest *note-bearing* track be the upper hand.

### `NoteTok` — module-private, `src/inputs/lily.ts`

```ts
type NoteTok =
  | { durSec: number; midi: null }
  | { durSec: number; midi: number; spelling: Spelling };
```

One resolved LilyPond note-or-rest token.
The discriminated union on `midi` is how rests (`r`) and spacers (`s`) advance time without producing a note — the `null` branch has no spelling to carry.
Resolving a token also updates the parser's running state: `lastDurQ` (LilyPond's "inherit previous duration" rule) and, in `\relative` mode, the running octave reference.
This parser emits neither `hand` nor `stream`, which is the source `Hand`'s optionality exists for.

The parser's running state is an inline record rather than a named type:

```ts
const st = { tempo: 120, lastDurQ: 1, mode: "abs" as "abs" | "rel", refDia: 28 }; // 28 = c'
```

`refDia` is a *diatonic* step counter (letter index + 7 × octave), not a MIDI number, because `\relative` resolves octaves by nearest letter rather than nearest semitone.

### MusicXML hand resolution — `src/inputs/musicxml.ts`

No named type, but the rule is a shape-level decision worth recording alongside `Hand`.
The hand is decided **once per part**, in that part's own namespace, by asking whether the part is genuinely multi-staff — `<attributes><staves>` says so outright, and failing that, more than one distinct `<staff>` value does.
If it is, `<staff>` 1 is the upper hand and the rest are lower; if it is not, the part's **ordinal** decides.

"Declares any `<staff>` at all" is explicitly *not* the test: an SATB export gives every part a lone `<staff>1</staff>`, and that reading collapsed all four parts onto staff 1.

### `InflateRaw` — exported, `src/inputs/mxl.ts`

```ts
type InflateRaw = (data: Uint8Array<ArrayBuffer>) => Promise<Uint8Array>;
```

Injectable raw-deflate decompression.
The default uses the browser-native `DecompressionStream("deflate-raw")`, keeping the project dependency-free; it is a parameter only because Node 18's `DecompressionStream` lacks `deflate-raw`, so tests supply `node:zlib`.

### `ZipEntry` — exported, `src/inputs/mxl.ts`

```ts
interface ZipEntry {
  name: string;
  method: number; // 0 = stored, 8 = deflate
  csize: number;  // compressed bytes on disk
  offset: number; // of the local file header
}
```

One entry from a `.mxl` archive's **central directory**, which is read as authoritative because local headers may carry zeroed sizes when the archive was written streaming.
Only stored (0) and deflate (8) are supported — the only methods MusicXML tools emit.
The extractor picks the entry named by `META-INF/container.xml`'s `<rootfile full-path>`, falling back to the first `*.xml` / `*.musicxml` outside `META-INF/` when the manifest is missing (out of spec, but seen in the wild).

---

## 10. Output-internal shapes

### `MarkupOpts` — exported, three of them

Three renderers expose a `markup(W, H, score, t, o)` that draws into an exact rectangle so a stacking view can compose it.
Each now names its extra arguments in a `MarkupOpts` record rather than trailing positional booleans and ambient assumptions.

```ts
// outputs/piano-roll.ts
interface MarkupOpts {
  glowId: string;
  held: ReadonlySet<Pitch>;
  fall?: boolean;   // draw the falling-note field, or keys only. Default true.
  hands?: boolean;  // hue bars and lit keys by hand. Default false.
  keyStyles?: ReadonlyMap<Pitch, KeyStyle>; // per-key override; see KeyStyle
}

// outputs/staff-std.ts
interface MarkupOpts { glowId: string; hands?: boolean; }

// outputs/tonnetz.ts
interface MarkupOpts { glowId: string; held: ReadonlySet<Pitch>; cursor: Cursor; }
```

Two preconditions became parameters here, and both were previously invisible to the compiler.

`glowId` is **required**.
Every `markup()` referenced a filter by a fixed document-global name but defined none, so its real type was a function of the ambient DOM and "a matching `<filter>` must already exist in this document" lived only in prose.
Five modules copy-pasted the same filter literal to satisfy it, and a stacked view could not give its two bands different glow radii because both layers named the same id.
Now the caller passes the id it defined, and one that forgets does not compile.

`held` (and `cursor`) are passed in rather than read from `LiveKeys` / `TonnetzState` module globals — the same fix `Frame` makes at the `View` level, applied one layer down so `markup` is testable in isolation too.

`fall` and `hands` were positional booleans; folding them in means a call site says which is which.

The practice view has no `MarkupOpts` of its own: its `markup(W, H, snapshot, held)` takes the `PracticeSnapshot` whole, the same way Nashville's takes a `PerfSnapshot`.

### Notation — `src/outputs/engrave.ts`

The score as **notation**: what a page draws that no other projection does — a note as a *value*, rests where nothing sounds, beams over the eighths of a beat, ties across the barline, an accidental only where the key signature does not already say so.
None of that is in the model, which stores seconds and a spelling; this module derives it per bar from the one thing a `Bar` remembers about beats, its meter.
A leaf of its own kind: it imports the pitch leaf and the model's types and nothing that draws, so "a dotted quarter tied to a sixteenth" is a testable fact rather than a shape in a string.
`layering.test.ts` pins that.

```ts
type Staff = "treble" | "bass";
type Base = 1 | 2 | 4 | 8 | 16 | 32;              // the value's denominator
interface Value { base: Base; dots: 0 | 1; triplet: boolean }
type Printed = "" | "#" | "b" | "n";              // the accidental to PRINT, not the note's spelling

interface Head  { note: Note; staff: Staff; q: number; value: Value; tiedFrom: boolean; tiedTo: boolean; acc: Printed }
interface Chord { staff: Staff; q: number; value: Value; heads: readonly Head[] }   // one stem
interface Rest  { staff: Staff; q: number; value: Value; whole: boolean }
interface Column { q: number; t: number; accidentals: boolean }                    // an instant something begins
interface EngravedBar {
  bar: Bar; quarters: number; quarterSec: number;
  columns: readonly Column[]; chords: readonly Chord[]; rests: readonly Rest[];
  beams: readonly (readonly Chord[])[];
}
```

`q` is quarters from the start of the bar, everywhere.
Four decisions, each stated in the file's header because it is a decision: starts and lengths are **quantized** to the nearer of a thirty-second and a triplet sixteenth (MusicXML and LilyPond land exactly, a MIDI performance lands near); a length that is no single value is written **greedily**, largest first, tied; **rests** fill each staff's gaps, split first at the beat so none straddles one, and a staff with nothing in the bar gets one whole rest; **beams** join contiguous eighths-and-shorter inside one beat, where the beat is the quarter, the dotted quarter in compound meters, or the half in cut time.
A note that crosses a barline is a `Head` in each bar, `tiedTo`/`tiedFrom` set; two values struck at one instant on one staff are two `Chord`s, which the renderer stems apart.
`acc` follows the convention: stated once a bar per letter-and-octave against what the key signature implies, a natural to cancel, never restated on a tied-over head.

### `BarsOpts`, `PlacedBar`, `PageLayout` — exported, `src/outputs/staff-bars.ts`

```ts
interface BarsOpts {
  glowId: string;
  focus: BarRange;          // the bars engraved in full
  range: BarRange | null;   // the bars ISOLATED, drawn on a panel
  current: Step | null;     // its heads in the strike gold, with a rule through their column
  hand: HandFilter;         // the other hand wears its dim token
  showOther: boolean;       // ...or is left off the page
}
interface PlacedBar { eb: EngravedBar; x0: number; x1: number; colX: readonly number[]; context: boolean; visible: readonly [number, number]; sig: { key: boolean; time: boolean } }
interface PageLayout { placed: readonly PlacedBar[]; sigX: number; first: Bar; preludeW: number }
```

The page in practice mode: the focus bars as sheet music, `markup(W, H, score, o)`.
`layout(W, score, focus, notes)` decides every x — the opening key and time signatures, then the focus bars fitted to the width by **rhythm** (a column's natural width grows with the square root of the time it spans, so a bar of eighths is wider than a bar with one whole note but not eight times wider), with the bar before and the bar after engraved at the same scale and **clipped** to a margin either side, torn at the edge, so the last few notes of one and the first few of the other show as context.
`barAt(W, score, focus, x, hand, showOther)` hit-tests that layout from the same notes, since leaving a hand off the page changes the spacing.
`timeline(W, score, focus, hand, showOther)` returns a `Timeline`, `{ xOf(t), timeAt(x), view }`: score time and x along the strip at rest, each the other's inverse, straight between columns and clamped at the ends of the piece.
It is how a page panned by its tape moves the playhead by exactly the music that slid under it.
Every staff line, clef, ledger, position and accidental glyph comes from `staff-std.ts`; every value, rest, beam and printed accidental from `engrave.ts`; this file owns the layout and the glyphs only a page has — heads by value, stems, flags, beams, rests, dots, ties, signatures — drawn as paths so the page does not depend on which music font the viewer has.

### `ScoreLayout`, `Sheet`, `System`, `BarSpan` — exported, `src/outputs/staff-score.ts`

```ts
interface BarSpan { index: number; x0: number; x1: number }        // a bar on a line, sheet units
interface System  { from: number; to: number; y: number; h: number; bars: readonly BarSpan[] }
interface BuiltInSystem extends System { line: PageLayout }        // how staff-bars.ts placed it
interface Sheet<S extends System = System> { top: number; systems: readonly S[] }
interface VerovioSheet extends Sheet { page: VrvPage }

type ScoreLayout =
  | { engine: "built-in"; k: number; x: number; height: number; sheets: readonly Sheet<BuiltInSystem>[] }
  | { engine: "verovio";  k: number; x: number; height: number; sheets: readonly VerovioSheet[] };
```

The whole piece on sheets of paper, as practice mode's whole-score toggle shows it.
`k` is pixels per sheet unit (1 unless the window is narrower than a sheet), `x` the sheets' left edge, `height` everything that scrolls, and a sheet's `top` is its place in the scrolling content.
A `System`'s `y`, `h` and its bars' `x0`/`x1` are in the sheet's own units.

The union is over **which engraver set the sheets**.
Verovio sets them once it has loaded, and until then (or if it cannot run) the built-in flow does.
Everything outside the sheets — `barAt`, `lineSpan`, `contentHeight`, the scroller — reads only the engine-neutral `System`, so it cannot tell the two apart.
Only drawing asks for more: a built-in line is drawn from its `PageLayout` by `StaffBars.drawLine`, and a Verovio sheet is its page's SVG.

### `PageSpec`, `VrvPage`, `VrvSystem`, `VrvBar` — exported, `src/outputs/verovio.ts`

```ts
interface PageSpec {
  width: number; height: number;                                   // the paper, in the caller's pixels
  margin: { top: number; bottom: number; left: number; right: number };
  space: number;                                                   // staff-line distance: the music's size
}
interface VrvBar    { index: number; x0: number; x1: number }
interface VrvSystem { top: number; bottom: number; bars: readonly VrvBar[] }   // outer staff lines
interface VrvPage {
  svg: string;                                                     // exactly width × height
  systems: readonly VrvSystem[];
  heads: ReadonlyMap<string, { x: number; y: number; system: number }>;        // notehead centres, by id
}
```

The engraving engine's input and output.
`verovio.ts` is the only module that imports the `verovio` package; it loads the WebAssembly engine asynchronously, and `engrave(mei, spec)` answers `null` until the engine has arrived.
A `PageSpec` is given in the caller's pixels and converted to Verovio's units, so its pages and the built-in engraver's are the same paper, with the music at the same size.
A `VrvPage`'s geometry is **read off the SVG Verovio drew**, not predicted, so hit-testing and the cursor cannot disagree with the pixels.
Each page's ids are renamed for its page number, because Verovio gives every page of a document the same root id, which scopes the page's glyphs and stylesheet.

What connects the SVG to the model is the id and class scheme `mei.ts` writes into the MEI and Verovio carries through.
A notehead is `n<NoteId>h<k>`, the k-th head of that note counting from its attack, and a measure is `b<bar index>`.
Every note, chord, beam and tie is classed by hand: `upper`, `lower`, or `free` for a note with no hand, plus `other` for the hand not being practised.
So the hand colours and the lit current step are a stylesheet over one engraving, which is set again only when the score, the hand or the other-hand toggle changes.

### `KeyStyle` — exported, `src/outputs/piano-roll.ts`

```ts
interface KeyStyle {
  fill: string;
  glow?: boolean; // default false
}
```

How one key should look, chosen by the **caller** and passed through `MarkupOpts.keyStyles`.
A styled key outranks both a live press and the score's own sounding hue — an override that lost to the default would not be one — and an absent map leaves every key exactly as before.

It exists because practice mode colors keys from a `Step` rather than a time — roles no query of `(score, t)` can answer — and the alternative was a second copy of the keyboard geometry in another module.
Fill and glow travel together because they are one decision; two parallel maps would let them disagree.
`glow` defaults off because an override is usually a quieter state, and the loud ones say so.
`Practice.keyStyles(snapshot)` builds the map lowest-precedence first, so the order of writes *is* the precedence and a key is only ever the loudest thing it is.

### `Voice` — module-private, `src/outputs/audio.ts`

```ts
interface Voice {
  src: OscillatorNode | AudioBufferSourceNode;
  gain: GainNode;
}
```

One sounding note's WebAudio nodes.
The union on `src` encodes the fallback: normally a pitch-shifted Salamander Grand piano sample (`AudioBufferSourceNode`), but a triangle `OscillatorNode` while that sample is still decoding or if its fetch failed — so sound is never silently broken.
Two separate maps hold them, and the split is the point:

```ts
const voices = new Map<NoteId, Voice>();  // score playback — keyed by NoteId
const live   = new Map<number, Voice>();  // user-played keys — keyed by pitch
```

Score voices key on `NoteId`, so two simultaneous notes of the same pitch in different hands each get their own voice; live voices key on pitch, because a physical key can only be held once.
The score map used to key on the `Note` **object**, which is the fragility `NoteId` exists to remove.

`MidiOut` mirrors this exactly: `Map<NoteId, Pitch>` for the score path (carrying the pitch each note-off must be sent on) and `Set<number>` for the live path.
The live set is documented as a mirror of `LiveKeys`, not of the wire, maintained whether or not a port is open — `enable()` flushes the current hold so an opening port catches up to what the user is already holding.

### `Layout` — exported, `src/outputs/piano-roll.ts`

```ts
interface Layout {
  whites: number[];
  ww: number;                    // white-key width
  whiteIdx: Map<number, number>; // pitch -> white-key ordinal
  bw: number;                    // black-key width
  keyH: number;                  // key height
  strikeY: number;               // top of the keyboard = the strike line
  blackH: number;
  lane: (p: number) => { x: number; w: number };
}
```

Keyboard geometry for the 88 keys, computed once per call and shared by the renderer and the inverse hit-test.
That sharing is deliberate: `markup()` draws with `lane()` and `pitchAt()` inverts it from the same `Layout`, so drawing and hit-testing can never drift.
`keyH` joined the record so the keys drawn are exactly the ones hit-tested.
Because the hit-test is pure coordinate math, the per-frame `innerHTML` rebuild cannot break it.

It is now **exported**, with `PianoRoll.geometry(W, H)` as its public constructor.
An overlay drawn above the keys — practice mode's arrows and next-step bars — must point at the same lanes the keys are drawn in, and the only alternative was a second copy of this math; `pitchAt` already established that this module owns the geometry in both directions.

`Region` used to live here; it is in `view.ts` now, because `ViewModule.keyboardRegion` names it.
Each view answers the keyboard question for itself: the full-screen roll returns the whole svg, `Combo` and the two `StaffPiano` flavors return a bottom band computed from the same band-height function their renderer used, `Practice` returns its bottom band narrowed by `chartBandW(W, live.practice.chart !== null)` — the same function its markup lays out against — and `StaffStd` / `Tonnetz` / `Nashville` return `null`.

### `Cell` and `Role` — module-private, `src/outputs/tonnetz.ts`

```ts
type Cell = readonly [number, number]; // lattice coords (col, row)
type Role = "root" | "third" | "fifth";
```

`Cell` is a lattice coordinate pair in the view's own drawing space.
The math it indexes now comes from `harmony/tonnetz-lattice.ts` — `pitchClassAt` and `triadName` are imported, not duplicated, in the one allowed direction `outputs/ → harmony/ → leaves`.
`Role` names a triad tone's function so `neoTransform(a, b, quality)` can decide which transform crosses the edge between two given tones: root+fifth is always P, and root+third / third+fifth swap between L and R depending on whether the triad is major or minor.

### `Spelt` — exported, `src/pitch.ts`

```ts
interface Spelt {
  letter: Letter;
  acc: Accidental;
  octave: number;
}
```

A note's `Spelling` resolved together with its **written** octave, which is where the standard staff earns the whole `spelling` field.
Vertical position is a function of diatonic step, not pitch number: one position unit is a half line-space, lines on even positions, spaces on odd, anchored at middle C = position 0.
`octaveFor` handles the two cases where written octave and sounding octave disagree — B♯3 sounds as C4, C♭4 sounds as B3.
It moved from `staff-std.ts` to the pitch leaf when the engraver needed it too: the staff view, the page and the accidental rule all ask `spell(note)`, and one owner is what keeps a note on the same line in all three.

---

## 11. Shape-bearing constant tables

These are data, not types, but their *shapes* are the contract — each is a `Record` keyed by one of the unions above, so adding a member to a union is a compile error until every table covers it.

### The leaves

Each of these owns a fact that used to exist in four or five copies, where agreement held only because several files independently typed the same literals.

| Export | Module | Purpose |
| --- | --- | --- |
| `PITCH_NAMES` | `pitch.ts` | `readonly string[]` of length 12, sharp-spelled. The naming default everywhere: C♯ not D♭. Choosing otherwise is `Spelling`'s job. `harmony/perfecto.ts` re-exports it; `core.ts`'s old `SHARP_NAMES` copy is gone. |
| `LOW` / `HIGH` | `pitch.ts` | 21 / 108 — the 88-key range, A0..C8, that every keyboard-shaped view draws. |
| `semi` / `isWhite` / `isC` / `pitchName` | `pitch.ts` | Pitch class (correct for negatives), black/white, the octave landmark, and the sharp name. One definition each: two views disagreeing about which keys are black would draw a keyboard you could not play. |
| `octaveOf` / `pitchLabel` | `pitch.ts` | Scientific-pitch octave (`floor(p / 12) - 1`, so 60 → 4) and name-with-octave (61 → `"C#4"`). Off by one from the naive `p / 12`, so it is written once; piano-roll's C labels used to carry their own copy of the arithmetic. |
| `SCROLL` | `outputs/scroll.ts` | `{ PPS: 120, PLAYHEAD_X: 0.18 }`. The stacked staff+piano view promises a note crosses the staff playhead exactly as its bar reaches the strike line — a promise about **two renderers agreeing on one number**. While each file declared its own `PPS`, it held by coincidence. |
| `glowFilter` / `glowAttr` | `outputs/defs.ts` | `(id, radius?) => string` and `(id, on?) => string`. The one visual accent, with one owner; see `MarkupOpts` for why the id is a parameter. |
| `esc` / `text` | `outputs/defs.ts` | Markup escaping, and a `<text>` element with the app's defaults (`opts: { size?, weight?, fill?, anchor? }`). Nashville and Practice both need their text to look the same, and agreement by copy-paste is what this file replaced. |
| `GROUP_SEC` | `steps.ts` | `0.03` — the onset-grouping tolerance, in seconds. What counts as "played together" is one decision; two copies would let the cursor and a renderer disagree about where a chord even is. |
| `spell` / `octaveFor` | `pitch.ts` | A note's written letter, accidental and octave. The staff view, the page and the engraver's accidental rule all put a note on a line by asking this; a second copy is a note on two different lines. |
| `HALF` / `CLEF_W` / `R` / `ACC` · `staves` / `notehead` / `ledgers` / `posFromMiddleC` / `yOfPos` | `outputs/staff-std.ts` | The grand staff's geometry — half-space in pixels, the clef gutter, the notehead radius, the accidental glyphs — and the functions that draw with it. Not a leaf, but one owner: `staff-bars.ts` engraves the same staff, and a notehead sitting on a different line in the two views would be a disagreement no test could see and every reader would. `layering.test.ts` pins it. |

### Keyed by `ScaleType`

| Table | Type | Purpose |
| --- | --- | --- |
| `SCALE_INTERVALS` | `Record<ScaleType, number[]>` | Semitones above the root. Length varies — 5, 6, or 7 — which is what forces the short-scale octave-wrap in the voicing math. |
| `SCALE_DISPLAY_NAMES` | `Record<ScaleType, string>` | Human-readable names for the view header. |

### Keyed by `JoystickMode` × `JoystickDirection`

| Table | Type | Purpose |
| --- | --- | --- |
| `JOYSTICK_TABLES` | `Record<JoystickMode, Record<JoystickDirection, JoystickOutcome>>` | The heart of the coloration system: 3 modes × 9 directions × 3 qualities of interval list. |
| `ZONE_LABEL` | `Record<JoystickMode, Record<JoystickDirection, string>>` | Short technical labels for the wheel UI ("Dom 7", "Sus 4"). |
| `COLORATION_DESCRIPTOR` | `Record<JoystickMode, Record<JoystickDirection, string>>` | A one-word *mood* per cell ("bluesy", "eerie") — the qualitative twin of `ZONE_LABEL`, because the player thinks in colors, not chord symbols. Subjective by design; the shape is what's stable. |

`QUALITY_LABEL` is gone.
It named chords by joystick cell alone and was blind to the degree's quality; `chordSymbol` now derives the name from the sounding intervals instead (see `ChordQuality`).

### Keyed by `Degree`

| Table | Type | Purpose |
| --- | --- | --- |
| `ROMAN` | `Record<Degree, string>` | `"I"` … `"VII"`, uppercase only. Module-private, and deliberately *not* the display table: `degreeNumeral(key, degree)` derives casing and the `°` from `degreeQuality`, so in A natural minor degree 1 prints `"i"`. The old flat `DEGREE_NUMERAL` baked in a major-mode assumption. |

`DEGREE_COLOR` is gone; the Nashville view colors degree buttons through `QUALITY_COLOR[degreeQuality(...)]`, so button color and sound come from one rule.

### Keyed by `ChordQuality`

| Table | Type | Purpose |
| --- | --- | --- |
| `QUALITY_COLOR` (perfecto.ts) | `Record<ChordQuality, string>` | Quality → CSS color token: major warm (`--note-lit`), minor cool (`--note`), diminished tense (`--playhead`). Exported and now the **one** owner — it used to be `QCOLOR`, private to `nashville.ts`, and the practice harmony bar needed the same map. It sits beside `ZONE_LABEL` because it is the same kind of fact: the vocabulary this harmony is displayed in. `nashville.ts` keeps a local `QCOLOR` alias to it; `layering.test.ts` asserts the literal appears only in `perfecto.ts`. |

### Progressions

| Table | Type | Purpose |
| --- | --- | --- |
| `REPERTOIRE` (repertoire.ts) | `readonly Progression[]` | Every built-in structure, in list order: cadences, song loops, blues, jazz, modal, drills. All written in C and transposed on demand, so each structure has one authoritative spelling rather than twelve that can drift. Only `main.ts` may import it. |
| `FAMILIES` (repertoire.ts) | `readonly string[]` | The distinct `family` headings in list order — **derived** from `REPERTOIRE`, so a new progression cannot introduce a heading the picker fails to show. `progressionById(id)` is the lookup beside it. |
| `NUMERALS` (progression.ts) | `string[]` of length 12 | `"I"`, `"♭II"`, … `"VII"` — numerals counted against the **major** scale of the home tonic, the Nashville system's own reference, so ♭7 is "♭7" in every mode. ♭V wins over ♯IV where they compete; a `Change` that cares says so in `label`. Module-private; `homeNumeral` applies case and `°` from the chord's quality. |
| `DEFAULTS` (progression.ts) | `{ octave: 4, bass: true, beatSec: 0.5, cycles: 4 }` | The values `RealizeOpts` fills from. Module-private. |

### Keyed by `JoystickDirection`

| Table | Type | Purpose |
| --- | --- | --- |
| `DIRECTION_SYMBOL` | `Record<JoystickDirection, string>` | Arrow glyphs, `·` for center. |
| `DIR_VEC` (nashville.ts) | `Record<JoystickDirection, [number, number]>` | Unit vectors in **screen** coordinates (y down) for laying the wheel out radially, so it reads as the stick itself. |
| `STICK_DEGREE` (gamepad-perfecto.ts) | `Partial<Record<JoystickDirection, Degree>>` | Six live stick directions → degrees ii–vii°, clockwise from up-right. `Partial` is meaningful: straight up, straight down, and center have **no** degree, and the mapping treats that as "hold the previous selection" rather than "release" so rotating past ↓ doesn't cut the chord. |
| `SECTORS` (gamepad-perfecto.ts) | `JoystickDirection[]` | The 8 directions in clockwise order from due east, for `atan2` sector lookup. It runs right, down-right, down, … because screen `atan2` has +90° pointing down. |

### Keyed by button index

| Table | Type | Purpose |
| --- | --- | --- |
| `PITCH_MAP` (live-gamepad.ts) | `Record<number, number>` | Default chromatic mapping: face buttons, bumpers, and d-pad → C4–E5. Unmapped buttons simply produce no note. |
| `DEGREE_BTN` (gamepad-perfecto.ts) | `Record<number, Degree>` | The classic parallel layout: A/B/X/Y → I–IV, d-pad ↑/→/↓ → V/vi/vii°. Live *alongside* the stick scheme, not instead of it. |
| `DEFAULT_BINDINGS` (gamepad-tonnetz.ts) | `Bindings` | Default lattice controls. |

### Other

| Table | Type | Purpose |
| --- | --- | --- |
| `STEP_SEMI` (musicxml.ts) | `Record<Letter, number>` | Letter → semitones above C, for `<step>` + `<alter>` → MIDI. |
| `LETTER` (staff-std.ts) | `Record<Letter, number>` | Letter → diatonic index 0–6, for staff row math. |
| `ACC` (staff-std.ts) | `Record<Accidental, string>` | Accidental → glyph (`♯`, `♭`, empty). |
| `SAMPLE_LETTER` (audio.ts) | `Record<number, string>` | Sample-pitch class → filename letter. The Salamander Grand has samples every 3 semitones (A, C, D♯, F♯ of each octave), so any playable pitch is within one semitone of a sample. |
| `VIEWS` (main.ts) | `Record<string, ViewModule>` | Select-element value → view module, nine entries now that `practice` is one. Was `Record<string, View>`; carrying the whole module is what retired the reference-identity dispatch chain that decided where a keyboard was. |
| `DIR_KEYS` (main.ts) | `Record<string, JoystickDirection>` | The QWE/ASD/ZXC keyboard harness for driving Perfecto without a gamepad. |

---

## Index

| Shape | Kind | Module | Visibility |
| --- | --- | --- | --- |
| `Pitch` | type alias | `types.ts` | exported |
| `Letter` | union | `types.ts` | exported |
| `Accidental` | union | `types.ts` | exported |
| `Hand` | union | `types.ts` | exported |
| `Spelling` | interface | `types.ts` | exported |
| `NoteId` | branded number | `types.ts` | exported |
| `Note` | interface | `types.ts` | exported |
| `Bar` | interface | `types.ts` | exported |
| `BarRange` | interface | `types.ts` | exported |
| `Barline` | union | `types.ts` | exported |
| `Score` | interface | `types.ts` | exported |
| `RawNote` | interface | `types.ts` | exported |
| `Sink` | function type | `types.ts` | exported |
| `Parser<I>` | function type | `types.ts` | exported |
| `Clock` | interface | `types.ts` | exported |
| `LiveSnapshot` | interface | `view.ts` | exported |
| `Frame` | interface | `view.ts` | exported |
| `Region` | interface | `view.ts` | exported |
| `View` | function type | `view.ts` | exported |
| `ViewModule` | interface | `view.ts` | exported |
| `PagePan` | interface | `view.ts` | exported |
| `Tape` | interface | `view.ts` | exported |
| `PitchClass` | enum | `harmony/perfecto.ts` | exported |
| `ScaleType` | union | `harmony/perfecto.ts` | exported |
| `Key` | interface | `harmony/perfecto.ts` | exported |
| `Degree` | union | `harmony/perfecto.ts` | exported |
| `JoystickMode` | union | `harmony/perfecto.ts` | exported |
| `JoystickDirection` | union | `harmony/perfecto.ts` | exported |
| `JoystickOutcome` | interface | `harmony/perfecto.ts` | exported |
| `Inversion` | union | `harmony/perfecto.ts` | exported |
| `Voicing` | interface | `harmony/perfecto.ts` | exported |
| `ComputeVoicingArgs` | interface | `harmony/perfecto.ts` | exported |
| `ChordQuality` | union | `harmony/perfecto.ts` | exported |
| `Orient` | union | `harmony/tonnetz-lattice.ts` | exported |
| `Cursor` | interface | `harmony/tonnetz-lattice.ts` | exported |
| `Transform` | union | `harmony/tonnetz-lattice.ts` | exported |
| `LatticeStep` | union | `harmony/tonnetz-lattice.ts` | exported |
| `Change` | interface | `harmony/progression.ts` | exported |
| `Progression` | interface | `harmony/progression.ts` | exported |
| `ChartEntry` | interface | `harmony/progression.ts` | exported |
| `Chart` | interface | `harmony/progression.ts` | exported |
| `RealizeOpts` | interface | `harmony/progression.ts` | exported |
| `Realized` | interface | `harmony/progression.ts` | exported |
| `Color` | type alias | `harmony/repertoire.ts` | module-private |
| `Opt` | interface | `harmony/repertoire.ts` | module-private |
| `HandFilter` | union | `steps.ts` | exported |
| `Step` | interface | `steps.ts` | exported |
| `Steps` | interface | `steps.ts` | exported |
| `Span` | interface | `steps.ts` | exported |
| `Move` | interface | `steps.ts` | exported |
| `Voice` | interface | `live-keys.ts` | exported |
| `PressListener` | function type | `live-keys.ts` | exported |
| `PerfSnapshot` | interface | `perf-state.ts` | exported |
| `TonnetzSnapshot` | interface | `tonnetz-state.ts` | exported |
| `PracticeSnapshot` | interface | `practice-state.ts` | exported |
| `Session` | interface | `practice-state.ts` | module-private |
| `MidiNoteEvent` | interface | `live-midi.ts` | module-private |
| `GamepadButtonEvent` | interface | `live-gamepad.ts` | module-private |
| `GamepadFrame` | interface | `live-gamepad.ts` | exported |
| `GamepadMapping` | interface | `live-gamepad.ts` | exported |
| `ActionId` | union | `gamepad-tonnetz.ts` | exported |
| `CatalogEntry` | interface | `gamepad-tonnetz.ts` | module-private |
| `Bindings` | type alias | `gamepad-tonnetz.ts` | exported |
| `PerfectoConfig` | interface | `gamepad-perfecto.ts` | exported |
| `HeldChord` | interface | `gamepad-perfecto.ts` | module-private |
| `MidiEvent` | interface | `inputs/midi.ts` | module-private |
| `NoteTok` | union | `inputs/lily.ts` | module-private |
| `InflateRaw` | function type | `inputs/mxl.ts` | exported |
| `ZipEntry` | interface | `inputs/mxl.ts` | exported |
| `Voice` | interface | `outputs/audio.ts` | module-private |
| `Layout` | interface | `outputs/piano-roll.ts` | exported |
| `Staff` | union | `outputs/engrave.ts` | exported |
| `Base` | union | `outputs/engrave.ts` | exported |
| `Value` | interface | `outputs/engrave.ts` | exported |
| `Printed` | union | `outputs/engrave.ts` | exported |
| `Head` | interface | `outputs/engrave.ts` | exported |
| `Chord` | interface | `outputs/engrave.ts` | exported |
| `Rest` | interface | `outputs/engrave.ts` | exported |
| `Column` | interface | `outputs/engrave.ts` | exported |
| `EngravedBar` | interface | `outputs/engrave.ts` | exported |
| `BarsOpts` | interface | `outputs/staff-bars.ts` | exported |
| `PlacedBar` | interface | `outputs/staff-bars.ts` | exported |
| `PageLayout` | interface | `outputs/staff-bars.ts` | exported |
| `Timeline` | interface | `outputs/staff-bars.ts` | exported |
| `MarkupOpts` | interface | `outputs/piano-roll.ts` | exported |
| `KeyStyle` | interface | `outputs/piano-roll.ts` | exported |
| `MarkupOpts` | interface | `outputs/staff-std.ts` | exported |
| `MarkupOpts` | interface | `outputs/tonnetz.ts` | exported |
| `Cell` | tuple type | `outputs/tonnetz.ts` | module-private |
| `Role` | union | `outputs/tonnetz.ts` | module-private |
| `Spelt` | interface | `pitch.ts` | exported |
