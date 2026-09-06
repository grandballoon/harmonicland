# Spoken Score — a piece as a sequence of physical instructions

This document specifies a text output: given a score, produce instructions a player can follow by hand, on piano or guitar, without reading notation.
It is written the way `tonnetz-instrument.md` is — a shared reference every task can rely on, then small tasks each sized for a fresh session that reads only the files in its **Context budget**.

## Why this exists

Every output in this project so far is a *picture*: a staff, a roll, a lattice, a wheel.
Each answers "where is this note?" spatially, which is exactly the project's stated point — make the mapping from pitch to position visible.

But a picture requires eyes on a screen, and it says nothing about *hands*.
"Which key, in relation to a landmark I can feel" and "what changes between this chord and the next" are questions notation answers badly and prose answers well.
This is the projection for a player who is looking at the instrument, not at the screen — and, incidentally, the only projection that works with no screen at all.

## The reframing that makes this tractable

The first design of this feature carried time: beats, note values, tempo.
That design needed model changes the parsers could not supply, and produced per-note transliteration nobody can follow.

**Time is out of scope.**
A piece is a *state machine*: an ordered sequence of sonorities, and the transitions between them.
No tempo, no beats, no note values.
Two consequences follow immediately, and both were measured, not assumed.

### The measurement

A probe over `scores/chopin_prelude_op28_no4.musicxml`, using exactly the extraction rules in the Shared reference below:

```
598 notes  →  189 onsets  →  98 states  →  97 transitions

average sonority                          3.77 notes
  the hand already has                    2.10   (0.41 sustained + 1.69 restruck)
  the hand must genuinely find            1.69
transitions adding at most one new key    58%
transitions preserving the hand size      87%
distinct sonorities                       70 of 98
```

598 notes become 97 instructions, over half of which add a single new key.
The first two transitions read:

```
55 59 64 71  →  55 59 64 72     hold three, top voice up a semitone
54 57 63 71  →  54 57 63 72     hold three, top voice up a semitone
```

Timing was never carrying the pedagogical load in this piece.
Voice leading was, and voice leading survives the reframing intact.

One line of that table is a correction worth recording, because the first probe got it wrong and Task 1's implementation caught it.
That probe reported "2.10 common tones held," measured over pitch sets.
Measured over note identities the figure is **0.41** — Chopin restrikes almost every chord, so very little is literally sustained.
The remaining 1.69 are the same key struck again: the finger never leaves it, but the note does stop.
Both facts are true and they are different instructions, so `Transition` reports them separately rather than averaging them into a number that describes neither.

### What the reframing costs, stated up front

- **Rhythm is unteachable.**
  These instructions convey navigation, fingering, and voice leading.
  They cannot convey how long anything lasts.
  That is the scope, not a defect to fix later.
- **Re-articulation is invisible unless you keep it.**
  A held C and a restruck C produce the same pitch set.
  See *Identity, not pitch* below; this is the one place the naive design is actively wrong.
- **Ornaments explode.**
  Trills, tremolos, and arpeggiation signs become long runs of near-identical states unless recognised and collapsed.
  Out of scope for the first pass; Task 6 handles the easy half of it, since a trill is exactly a two-transition figure restated, and falls out of chunking with no ornament-specific rule at all.
  What does not fall out is the *notated* ornament — a trill sign, which is one note in the model and never becomes a run of states in the first place.

---

## Shared reference

Every task below may rely on these facts without re-deriving them.

### Extracting the state sequence

A **state** is the set of notes sounding together.
Derive it from an existing `Score` with no new parser work and no model change:

1. Collect every distinct `onset` in `score.notes`, merging onsets within `EPS = 1e-3` seconds into one group.
   The epsilon exists for performed MIDI, where a notated chord is smeared over tens of milliseconds.
   MusicXML needs no epsilon — `<chord>` states simultaneity exactly — but one rule serving both formats is cheaper than two.
2. For each group, the state is the notes sounding across it: those whose onset falls inside the window, plus those still sounding from earlier.
   `Core.activeAt(score, t)` already answers exactly this question and is the whole implementation.
3. Run-length encode consecutive identical states.

Step 3 is not an optimisation, and getting it wrong is the most likely way to build the wrong thing.
In the Chopin file, 189 onsets collapse to 98 runs — **91 onsets are repeats**, with runs up to 6 long, and those repeated chords are the entire left-hand texture of the piece.
Silently deduplicating them deletes the music.
A state therefore carries a `repeat` count, and the prose says "play that chord four times," which is both shorter and truer than four identical sentences.

### Two grains: strikes and states

Step 3 above folds; the thing it folds is worth naming, because half the app wants it unfolded.

An **onset** is one strike of the score: the notes that begin there, and everything sounding as a result.
A **state** is a run of onsets with the same sonority.
`onsetsOf` produces the first and `statesOf` is its run-length encoding — three lines, so the two can never drift.

The grain you want depends on whether you are reading or playing, and the prelude says so in numbers:

```
598 notes  →  189 onsets  →  98 states
```

For **reading**, states are right: "play that chord four times" is one sentence, and four identical sentences would be worse.

For **playing**, onsets are right, and states are actively lossy in two ways.
Four strikes are four things you do, so a sequence of 98 asks for 98 of the 189.
And in this file **38 of the 98 runs strike a different subset at each statement** — the left hand restrikes its triad while the melody holds, or the reverse — so a state, which keeps only its first statement, does not even name the right notes for the other three.

Only at the onset grain is every note accounted for exactly once: a note is `struck` at exactly one onset, so a rule applied at every onset applies to each note exactly once.
That is the property the practice gate rests on, and it is why `sounding` and `struck` are separate fields rather than one — `sounding` minus `struck` is what the hand is *holding* rather than *playing*, and asking for the two differently is the whole of the gate.

### Identity, not pitch

A state is a set of **note identities**, not a set of pitch numbers.
Two states may hold the same pitch while referring to different notes — one sustained, one struck again — and the difference is a physical instruction ("keep holding" versus "play it again") that pitch sets cannot express.
Carry the `Note` reference (or a stable index into `score.notes`) inside the state, and derive pitch from it.
Set arithmetic over identities gives `held` / `released` / `pressed` for free and correctly; set arithmetic over pitches gives it for free and wrongly.

### The transition is the primary object

Between consecutive states:

```
held      the same note, still ringing, never re-attacked
released  notes that lift
pressed   notes newly struck
restruck  the subset of `pressed` at a pitch that was already sounding —
          the finger stays on the key and plays it again
motion    a matching released → pressed that minimises total displacement
```

`held` and `restruck` must not be merged.
A note still ringing and a key replayed are different instructions ("keep holding" versus "play it again"), and `pressed.length - restruck.length` — the keys the hand genuinely has to *find* — is the number that predicts how hard a transition is.
In the Chopin file that is 1.69 out of an average sonority of 3.77, which is why the piece is far easier than its note count suggests.

`motion` is the one real algorithm in the pure layer: a minimal-cost bipartite matching, so the prose can say "the middle voice drops a semitone" instead of "release E, press E-flat."
`released` and `pressed` are frequently of unequal size, so the matching must permit unmatched notes on either side (a voice appearing from nowhere, or vanishing).

### The instrument seam

Piano and guitar differ in a way that determines the whole shape of this feature.

**Piano is bijective.**
One pitch, one key.
The only free choice is which finger.

**Guitar is one-to-many.**
A single pitch lives at up to six places on the neck, so *position* and *fingering* are both free, and the right choice depends on where the hand already is.
No pure `Pitch → position` function exists for guitar.

These are not two systems.
The state-machine framing already supplies the missing ingredient — the previous state — so both reduce to a shortest path over candidate hand configurations, scored by how hard the transition is:

```ts
export interface Instrument<Config> {
  /** Every physical way to make this sonority. Empty means unplayable. */
  candidates(state: State): Config[];
  /** Difficulty of moving between two configurations. Lower is easier. */
  cost(from: Config | null, to: Config): number;
  /** The sentence for this transition. */
  describe(from: Config | null, to: Config, tr: Transition): string;
}
```

Piano's `candidates` returns a handful (fingering assignments); guitar's returns many (position × fingering).
The solver is identical.
**Choosing a fretting and choosing a fingering are the same computation.**

Two consequences to design for now rather than retrofit:

- **`candidates` may legitimately return nothing.**
  Six strings cannot voice a seven-note sonority, and the Chopin state sizes run 1 through 7 — so this is immediate, not hypothetical.
  Unplayability is a result the caller renders ("this chord does not fit the neck"), never an exception.
- **The description vocabularies genuinely differ.**
  Piano prose is landmark-relative ("the first two black keys right of middle C"), driven by the 2-and-3 grouping of the black keys, which is how the keyboard is navigated by feel.
  Guitar prose is shape-named ("open G", "E-shape barre at the 5th fret").
  Same transition data, different sentences.
  `describe` therefore lives *inside* the instrument; a shared prose layer that tried to serve both would accumulate every difference between them.

### Where the code goes

```
src/states.ts               score -> states -> transitions.  Pure. No instrument knowledge.
src/harmony/triads.ts       triad naming and P/L/R, lifted out of outputs/tonnetz.ts
src/instruments/
  solver.ts                 generic shortest path over candidates/cost
  piano-geometry.ts         pure keyboard facts: white/black, landmark-relative naming
  piano.ts                  Instrument impl: fingering candidates, cost, describe
  guitar-geometry.ts        pure fretboard facts: tuning, pitch -> positions
  guitar.ts                 Instrument impl: fretting candidates, cost, describe
src/outputs/prose.ts        the output surface
src/outputs/keyboard.ts     pixel geometry of the 88 keys, drawn and hit-tested
src/outputs/hands.ts        the same instructions, drawn on those keys
src/note-gate.ts            the practice gate: does this strike advance the sequence?
```

`src/instruments/` is a new top-level sibling of `inputs/` and `outputs/`, and that is deliberate.
An instrument is neither: it does not produce the model and it does not render it.
It is a third kind — the physical realisation of a state — and it depends only on `states.ts` and `types.ts`.
`states.ts` sits beside `core.ts` because it is the same sort of thing: a pure query over the model, importing only `types` and `core`.

### What each input format supplies

| | simultaneity | hand | spelling | fingering |
|---|---|---|---|---|
| MusicXML | exact (`<chord>`) | `<staff>` | stated | `<technical><fingering>` when present |
| LilyPond | exact (`< >`) | `\new Staff` | stated | `-1` syntax |
| MIDI, sequenced | exact | track convention | guessed | none |
| MIDI, performed | epsilon window | track convention | guessed | none |

Under this reframing MIDI is much stronger than it was under the timed design, because note values and bar numbers stopped mattering.
`scores/chopin_prelude_op28_no4.musicxml` carries 77 notes on staff 1 and 521 on staff 2, so hand assignment is available today, and Task 5 carries it through.

---

## Task 1 — The state sequence

**Status: shipped.**
`src/states.ts` and `src/states.test.ts` (18 tests) implement everything below.
Two things changed during implementation and are already reflected in this document: `Transition` gained `restruck` (see *The transition is the primary object*), and `State` gained `lastNotes` (see *Extracting the state sequence*).

**Goal.**
Create `src/states.ts`: score → states → transitions, pure, with no instrument knowledge whatsoever.

**Context budget.**
Read `src/types.ts`, `src/core.ts` (`activeAt` in particular), and the *Extracting the state sequence*, *Identity, not pitch*, and *The transition is the primary object* sections above.
Read nothing in `outputs/` or `inputs/`.

**Implementation.**

```ts
export interface State {
  readonly notes: readonly Note[];      // the sonority as FIRST struck, sorted by pitch
  readonly lastNotes: readonly Note[];  // same pitches, identities of the FINAL restatement
  readonly repeat: number;              // consecutive identical restatements; >= 1
}

export interface Move { readonly from: Note; readonly to: Note; }

export interface Transition {
  readonly held: readonly Note[];
  readonly released: readonly Note[];
  readonly pressed: readonly Note[];
  readonly restruck: readonly Note[];   // subset of `pressed`; same key, played again
  readonly motion: readonly Move[];     // minimal-displacement matching over released -> pressed
}

export function statesOf(score: Score): State[];
export function transitionsOf(states: readonly State[]): Transition[];
```

Two states are "identical" for run-length purposes when their pitch multisets match, not their identities — otherwise nothing ever repeats.
A run must therefore keep `lastNotes` as well as `notes`: a transition out of a repeated chord has to compare against the *final* restatement, since only those notes can still be sounding when the next state arrives.
Comparing against the first statement reports a sustained note as released-and-pressed, which is exactly the error the identity rule exists to prevent.

For `motion`, note that an optimal matching of points on a line never crosses — uncrossing a pair cannot increase the total of `|a - b|` — so an order-preserving DP over both sides sorted by pitch is exact in `O(n*m)`, with no permutation search and no size guard.
The smaller side is matched completely; the larger side skips, and its leftovers are the voices that appeared or vanished.

**Tests.**
Add `src/states.test.ts`.
Use hand-built scores for the unit assertions, and the real Chopin file as the golden oracle:

- A held bass under a moving melody yields one state per melody onset, with the bass note appearing in `held` on every transition.
- A chord restated identically four times yields one state with `repeat: 4`, not four states.
- A restruck note that was already sounding appears in both `released` and `pressed`, never in `held` — the identity rule.
- Onsets within `EPS` merge into one state; onsets beyond it do not.
- Golden, over `scores/chopin_prelude_op28_no4.musicxml`: 189 onsets, **98 states**, **97 transitions**, 91 onsets absorbed as repeats with a maximum run of 6, average held **0.41**, average restruck **1.69**, average new keys **1.69**, and over half the transitions adding at most one new key.
- Conservation, asserted on every transition rather than sampled: `held + released` is the previous state's size and `held + pressed` is the next one's, so no note is invented or silently dropped.

If an implementation choice moves those numbers, do not quietly retune the test — work out which rule changed, and correct this document.
That is how the held/restruck split above was found.

**Done when.**
`npm test` passes, and the Chopin golden matches.

---

## Task 2 — The instrument seam and the solver

**Status: shipped.**
`src/instruments/solver.ts` and `src/instruments/solver.test.ts` (9 tests) implement everything below, with the signatures unchanged.
Two small things the implementation had to settle and this document did not say: ties between candidates keep the earlier one, so a plan is a function of the instrument alone and never of iteration order; and `cost(null, ·)` is called at the start of every *segment*, not only at the start of the piece, since after an unplayable state there is no hand position to move from.

**Goal.**
Create `src/instruments/solver.ts` and the `Instrument` interface: choose one configuration per state, minimising total transition cost across the whole sequence.

**Context budget.**
Read `src/states.ts` (Task 1) and the *The instrument seam* section above.
No instrument exists yet; this task must not know what a key or a fret is.

**Implementation.**
A Viterbi pass over the state sequence: for each state, ask the instrument for its candidates; for each candidate, keep the cheapest path reaching it; backtrack at the end.
The layer is a dozen lines and is the reason piano fingering and guitar fretting never need separate code.

```ts
export type Plan<C> = { state: State; config: C | null }[];  // null = unplayable
export function planFor<C>(states: readonly State[], inst: Instrument<C>): Plan<C>;
```

An unplayable state (empty `candidates`) must not abort the plan.
Record `null`, reset the path, and continue — one impossible chord in bar 40 cannot cost the player the other 97 instructions.

**Tests.**
Add `src/instruments/solver.test.ts` with a *fake* instrument (two or three candidates per state, a trivial cost function) so the solver is tested with no real instrument in scope:

- The chosen path is globally cheapest, not greedily cheapest — include a case where the locally cheaper first choice forces an expensive second, and assert the solver takes the other branch.
- A state with no candidates yields `null` and the following state re-plans from scratch.
- A single-state sequence returns that state's cheapest candidate.

**Done when.**
`npm test` passes and the file imports nothing from `instruments/piano*` or `instruments/guitar*`.

---

## Task 3 — Keyboard geometry

**Status: shipped.**
`src/instruments/piano-geometry.ts` and `src/instruments/piano-geometry.test.ts` (16 tests) implement everything below, with the exported signatures unchanged.
Four things the implementation had to settle and this document did not say.

`Landmark` is `{ pitch, name, offset }` — the feelable key, its spoken name, and the signed semitone distance to the pitch it was found for.
Its `name` comes from `describeKey`, so the module has one vocabulary rather than two.
Ties go to a C first and the lower key second, which makes a landmark a function of the pitch alone.
The exhaustive sweep proves the useful invariant: nowhere on the board is any key more than two semitones from something the hand can find.

The absolute fallback is not dead code, and it has an exact trigger: a description may lean on a black-key group only when that whole group is on the 88-key board.
A0, A♯0 and B0 are the only three keys that fail it — their group of three has its lower two keys off the bottom of the keyboard, so the hand feels one stray black key rather than a group.
Those three get "A four octaves below middle C" and the other 85 keys are landmark-relative.

Descriptions are group-anchored uniformly, so `describeKey(61)` is "the first black key of the group of two above middle C" rather than the shorter "the first black key right of middle C" this document sketched.
They name the same key; the longer form is the one that generalises, because a group is felt directly whereas counting black keys rightward from a C is not.
The scheme is a twelve-entry table indexed by pitch class, which is why every key on the board is named and no two are named alike — both asserted exhaustively.

`whiteSteps` returns white-key steps only.
The other distance this document mentions, semitones, is `b - a` and does not need a function.

**Goal.**
Create `src/instruments/piano-geometry.ts`: the pure, instrument-independent facts about where a pitch physically sits on a keyboard, and how to name that place relative to something a player can feel.

**Context budget.**
Read `src/types.ts` only.
This module imports nothing else and knows nothing about states, transitions, or fingering.

**Why it is separate.**
The 2-and-3 grouping of the black keys is the entire navigational logic of playing by feel, and it is a property of the keyboard, not of this feature.
Kept separate it is small, exhaustively testable, and reusable by any future view — the existing 88-key staff could name its own keys with it.

**Implementation.**

```ts
export const isBlack = (p: Pitch): boolean;
export const octaveOf = (p: Pitch): number;                  // MIDI convention: 60 is C4
/** Which black-key group a black key belongs to, and its index within it. */
export const blackGroup = (p: Pitch): { size: 2 | 3; index: number } | null;
/** The nearest feelable landmark: a C, or the edge of a black-key group. */
export const landmarkFor = (p: Pitch): Landmark;
/** "the first black key right of middle C", "the white key just left of the group of three" */
export const describeKey = (p: Pitch): string;
/** Distance in white-key steps and in semitones, for describing hand movement. */
export const whiteSteps = (a: Pitch, b: Pitch): number;
```

Naming is landmark-relative by preference and absolute ("A-flat above middle C") only as a fallback, because a landmark can be found without looking and an absolute name cannot.

**Tests.**
Add `src/instruments/piano-geometry.test.ts`:
- `isBlack` matches the pattern across several octaves, and `blackGroup` gives sizes 2 and 3 in the right places.
- `describeKey(61)` names the first black key right of middle C.
- `whiteSteps(60, 67)` is 4, and is signed.
- Every pitch in 21..108 produces a non-empty description (exhaustive sweep — the module is small enough to test totally).

**Done when.**
`npm test` passes and the file has no imports beyond `types`.

---

## Task 4 — The piano instrument

**Status: shipped.**
`src/instruments/piano.ts` and `src/instruments/piano.test.ts` (16 tests) implement everything below, with the `Instrument` interface unchanged.
The Tonnetz payoff was taken by lifting rather than importing, so `src/harmony/triads.ts` and `src/harmony/triads.test.ts` (8 tests) are new too.
Five things the implementation had to settle and this document did not say.

**The import direction did read wrong, so `triadName` and `neoTransform` moved to `src/harmony/triads.ts`.**
`outputs/tonnetz.ts` imports `LiveKeys` and `TonnetzState`, so importing a name table from it would have dragged live global state into the pure instrument layer for the sake of two functions.
`harmony/` is where they belong: pitch classes, no DOM, no lattice coordinates, no state.
`outputs/tonnetz.ts` re-exports both, so its callers and its tests are untouched, and `harmony/tonnetz-lattice.ts` dropped the note-name table it had duplicated to dodge that same cycle — the reason for the duplication no longer exists.
The module also gained the two things naming a move actually needs: `triadOf`, which recognises a sonority as a triad by pitch class or refuses to guess, and `neoRelation`, which reads the P/L/R off a pair of them.

**A named harmonic move requires the hand to make it, not merely the harmony to permit it.**
Two chords can be an R apart while the player leaps an octave and re-fingers everything, and "keep the root and the third" would then be false.
Tier 1 therefore fires only when the transition itself moves exactly one voice, and that voice's pitch classes are the ones `neoRelation` names.
This is why the tier is exact rather than approximate: no distance threshold, and no sentence that is only plausible.

**`cost` never sees the transition, and does not need to.**
The signature is `cost(from, to)`, so the discount is a property of the two configurations: the same hand, the same finger, the same pitch.
That proxy counts held and restruck notes alike, which is right — for the hand they are one fact, "you were already there", and only the ear knows the difference.
The discount can drive a cost below zero; the solver compares totals and never assumed otherwise.

**A hand reaches an octave, and that number was measured rather than chosen.**
The prelude's widest sonority (`35 42 47 51 54 59 63`) splits into two hands of exactly twelve semitones, and no sonority in the file needs more, so `MAX_SPAN = 12` leaves the piece with no unplayable state — as Task 4's own test asserts.
Candidates are every split of the sonority between the hands times the best three fingerings for each: 6 to 33 per state, 16.8 on average.
Keeping every finger subset instead would multiply the solver's work tenfold for no better plan, because intra-hand comfort is a genuinely local question.

**The Tonnetz payoff is real and, in this piece, rare.**
Across the 97 transitions the tiers land at **1 harmonic, 0 shape translations, 71 voice moves, 25 full restatements**.
Only 29 of the 98 states have three distinct pitch classes at all — this prelude is built from sevenths and chromatic inner voices, not triads — so P/L/R almost never applies, and honesty about that is better than loosening the test until it does.
The 25 restatements are not a defect either: 9 of them move three voices at once and the rest change the size of the sonority, which is exactly when naming keys is the shortest true sentence.
The number to watch is the 71: three quarters of the piece is one or two fingers moving a semitone, which is the claim the whole reframing rests on.

Two smaller decisions, recorded so they are not re-litigated.
`Fingering` carries the state's `repeat`, because `describe` is handed configurations and a transition and never a state, and "played four times" is part of the instruction.
When a voice move has nothing held to move relative to, the sentence names the destination key outright ("the right hand's thumb up a whole tone, to …"), since with no anchor the interval alone does not locate anything.

**Goal.**
Create `src/instruments/piano.ts`: an `Instrument` whose configuration is a fingering, whose cost is physical effort, and whose `describe` emits landmark-relative English.

**Context budget.**
Read `src/states.ts` (Task 1), the `Instrument` interface (Task 2), `src/instruments/piano-geometry.ts` (Task 3).

**Implementation.**
A configuration is an assignment of notes to (hand, finger).
Generate candidates by assigning the notes of a state to fingers in ascending order per hand, discarding assignments that exceed a hand span or cross fingers.
Cost combines lateral movement of each hand, stretch within the hand, and a discount for notes that stay held — the transition's `held` set is what makes a good plan cheap.

`describe` prefers, in order:
1. **A named harmonic move,** when the transition is one — see the Tonnetz note below.
2. **A shape translation,** when the interval pattern is preserved: "same shape, up a third."
3. **A voice move,** when one or two notes move: "hold the outer two, middle finger down a semitone."
4. **A full restatement,** otherwise: the landmark description of each key.

A state with `repeat > 1` appends "…, played N times" rather than repeating the sentence.

**The Tonnetz payoff.**
`tonnetz-instrument.md` already specifies a state machine over triads whose transitions keep two common tones and move one, and `src/outputs/tonnetz.ts` already exports `neoTransform` and `triadName`.
That is this feature's transition alphabet, already named and involution-checked.
When a transition is a P, L, or R between triads, `describe` should say so physically — P is literally "keep the root and the fifth, move the middle finger" — because that sentence is both shorter and more memorable than three key names.
Import `neoTransform` / `triadName` from `outputs/tonnetz`, or lift them into `harmony/` first if that import direction reads wrong; do not duplicate the tables.

**Tests.**
Add `src/instruments/piano.test.ts`:
- A C major triad to A minor is described as holding two notes and moving one, and names the `R` relation.
- A four-note figure repeated a third higher is described once as a shape translation.
- Both hands stay put when the transition's `held` set covers one hand entirely.
- A `repeat: 4` state produces one sentence mentioning four restatements.
- End to end over the Chopin file: `planFor` returns 98 entries with no `null`, and every transition yields a non-empty sentence.

**Done when.**
`npm test` passes and the Chopin file narrates end to end.

---

## Task 5 — Hands, through the parser

**Status: shipped.**
`src/types.ts`, `src/core.ts` and `src/inputs/musicxml.ts` carry the field, and `src/inputs/parsers.test.ts` grew five assertions for it (26 tests to 31).
Three things the implementation had to settle and this document did not say.

**The golden was wrong, and the corrected figures are 77 and 521.**
This document said 82 and 573, which do not sum to the 598 notes the parser has always produced — 82 was a count of `<note>` *elements* and 573 was not a count of anything in the file.
The file holds 607 note elements, 82 on staff 1 and 525 on staff 2, of which 9 never become notes: 5 rests, 2 grace notes, and 2 tie-stops that extend a note already emitted.
77 + 521 = 598, and the test asserts that sum against `notes.length` rather than restating the total, so the two goldens cannot drift apart.

**Absence is literal absence, not an undefined value.**
`makeScore` and the parser both spread the field in conditionally, so a note from a single-staff part has no `staff` key at all.
That is what makes "this format states no staves" distinguishable from "this note has none", and the test asserts `"staff" in n` is `false` rather than the weaker `=== undefined`.

**LilyPond does not fall out, so it was left alone.**
`\new` consumes its context token identically for `Staff` and `Voice` and keeps no scoped state, so carrying a staff would mean distinguishing the two and threading a counter through `parseItem`'s recursion — a restructure, which this task forbids.
The two-staff fixture is therefore MusicXML only, and LilyPond joins MIDI in the "states no staves" assertion.

**Goal.**
Carry `<staff>` from MusicXML into the model so the prose can say "right hand" instead of inferring it from pitch.

**Context budget.**
Read `src/types.ts`, `src/inputs/musicxml.ts`, `src/inputs/parsers.test.ts`.

**Implementation.**
Add one optional field to `Note` and `RawNote`:

```ts
readonly staff?: number;   // 1 = upper (usually right hand), 2 = lower. Absent when the format states none.
```

Follow the precedent `bars` already sets, and which `types.ts` documents: a field the format may not supply is *absent*, and every consumer treats absence as a fact about the input rather than special-casing per parser.
`piano.ts` therefore reads `staff` when present and falls back to a pitch split when it is not — and the fallback is the only piano-specific inference in the whole feature.

Read `:scope > staff` in the `note` branch of the MusicXML parser and pass it through `Core.makeScore` unchanged.
Do the same for LilyPond only if it falls out of the existing `\new Staff` handling; do not restructure that parser for it.

**Do not** attempt fingering (`<technical><fingering>`) in this task.
It is a second optional field with the same shape, it is absent from both sample scores, and it is only worth adding once something consumes it.

**Tests.**
Extend `src/inputs/parsers.test.ts`:
- A two-staff MusicXML fixture round-trips `staff` onto the right notes.
- A MIDI parse leaves `staff` undefined on every note.
- Golden, over the Chopin file: 77 notes with `staff === 1` and 521 with `staff === 2`, summing to all 598.
- A single-staff MusicXML part leaves the key absent, and a cross-staff voice lands on the staff it is printed on rather than the one its pitch suggests.

**Done when.**
`npm test` passes and no existing assertion changed — the field is additive.

---

## Task 6 — Chunking

**Status: shipped, and it finds nothing in the Chopin prelude.**
`src/chunking.ts` and `src/chunking.test.ts` (10 tests) implement everything below.
The instruction count for the prelude is 97 before chunking and 97 after, which is the honest answer and not a defect — the measurement, and the four things the implementation had to settle, are below.

**The string is the transitions, not the states.**
An instruction *is* a transition, so chunking the transition sequence makes the tree cover the instruction list exactly: `expand` returns `0 .. 96`, with nothing invented and nothing dropped, and that invariant is asserted on every fixture rather than sampled.
Chunking states instead cannot be lossless, and the reason is worth recording because the sketch above asked for it.
A period-*p* repeat of *k* state-statements spans `p*k` states but only `p*k - 1` transitions: the final statement never performs the figure's own return to its start, because the piece has moved on.
Rendering that as "play this figure three times" over-generates by exactly one instruction, and no honest rendering of the truncated copy exists.
So a figure repeated three times is three times its *transitions*, which means it comes back to where it began — a four-chord figure played three times is thirteen states, not twelve.
The twelve-state case is chunked as two statements plus the remainder spelled out, and a test pins that boundary.

**The two passes are one search under two keyings, and that is stronger rather than cheaper.**
Every exact repeat is also an interval repeat of at least the same length, so a single left-to-right scan that tries both keyings and prefers the longest match — exact winning ties — subsumes running them in series.
It also fixes a defect the serial version has: a first pass that claims a short literal repeat can hide a longer transposed one that overlaps it, which contradicts the requirement that overlapping candidates resolve to the longest.
Both halves of a transposed key are written relative to the *from*-state's lowest pitch, and that single choice is what makes a matched run coherent for free: adjacent transitions overlap on a state, so the offset one of them implies is forced to equal the next one's, and no separate consistency check is needed.
A statement's offset is then recovered from the states rather than tracked through the search.

**A gesture includes how many times a chord is struck.**
`State.repeat` is part of the key, because "play that chord twice" and "play it three times" are different instructions rather than one instruction counted wrong.
This costs matches — 92 of the prelude's 97 transitions are unique with the repeat count in the key, 88 without — and it is still right.

**The prelude has no repeated gesture, and this was measured four ways before being believed.**

```
transitions                                     97
distinct transitions (exact)                    92
distinct transitions (transposition-invariant)  90
adjacent repeats of any period                   0
longest repeated run anywhere                    3   (transitions 47-49 restate 1-3)
```

Four independent framings agree, so the negative is a fact about the piece and not about the design:

- **Task 1 already spent the adjacent redundancy.**
  Run-length encoding collapsed 189 onsets to 98 states, absorbing 91 repeats.
  What survives is by construction a string in which no two adjacent states are equal, and the compression this piece had, it already got.
- **State-level redundancy does not imply transition-level redundancy.**
  The 70-distinct-of-98 figure quoted in the original sketch is real, but a transition is a *pair* of states, and pairs are far more distinct than singletons: 92 of 97.
  The duplicated states are single chords recurring in different neighbourhoods, not figures.
- **The one true repeat is not adjacent.**
  Bar 1 returns at transition 47, three transitions long.
  A tandem model cannot express it, and the most permissive non-adjacent reference scheme — longest earlier match at every position, under either keying — was measured at **95** instructions, so it does not rescue the criterion either.
- **No chord is a transposition of its predecessor.**
  The prelude descends chromatically by moving one voice at a time, so the interval pass finds no more than the exact one.
  Even the loosest gesture alphabet — key each transition by what the hand *does* (how many held, how many restruck, the multiset of voice movements) — yields 95 runs over 97 transitions.

This is the same shape of finding as Task 4's Tonnetz result, and it is the same conclusion: the prelude is through-composed, and reporting that is better than loosening a rule until it repeats.
Chunking is worth shipping regardless, because it fires on music that does repeat — the fixtures cover an ostinato, a sequence walking up a minor third, and a trill, which needs no ornament-specific rule because it *is* a two-transition figure restated.

**Goal.**
Collapse the instruction list from per-transition to per-gesture, so a repeating figure is described once.

**Context budget.**
Read `src/states.ts` (Task 1) and this section.
No instrument knowledge; chunking operates on the state sequence alone.

**Why it is easy.**
With time gone, the piece is a *string* over an alphabet of transitions.
Repeated-substring detection and run-length encoding are plain string algorithms.

**Implementation.**
Two keyings of the transition sequence, searched together, both pure:
1. **Exact repeats.** Maximal adjacent repeats of the literal sequence, emitted as one chunk with a count.
2. **Transposed repeats.** The same, over the *interval* sequence rather than the pitch sequence, so a figure restated a third higher matches its original. This is what turns a sequence into "the same four-chord move, walking down by semitone."

Emit a tree — chunks containing transitions — not a flat list, so the prose layer can render a summary line and then its detail.
A statement can hold gestures of its own, so the body of a repeat is chunked recursively; a body is strictly shorter than its region, which is why that terminates.

```ts
export type Chunk = Step | Repeat;
export function chunksOf(states: readonly State[], opts?: ChunkOptions): Chunk[];
export function chunkLength(c: Chunk): number;   // transitions covered once expanded
export function expand(chunks: readonly Chunk[]): number[];  // the transition indices, in order
```

`ChunkOptions.transposed` turns the interval keying off.
It exists so "the interval pass found this and the exact pass did not" is a statement a test can make, which is otherwise unobservable from the outside.

**Tests.**
Add `src/chunking.test.ts`:
- A four-chord figure repeated three times becomes one chunk of count 3.
- The same figure transposed up a third on its second statement is matched by the interval pass and not by the exact pass.
- A sequence with no repetition is returned unchanged, one chunk per transition.
- Overlapping candidate repeats resolve to the longest, deterministically, with the shorter one surviving nested inside it.
- Losslessness on every fixture: `expand` is the identity over the transition indices, so chunking is a regrouping and never a filter.

**Done when.**
`npm test` passes, and the tree covers the Chopin transition list exactly once with nothing invented or dropped.
The original criterion here was "the instruction count drops materially below 97", and it is unreachable on this piece by any repeat-detection scheme — see the measurement above, which puts the ceiling at 95.

---

## Task 7 — The guitar instrument

**Status: shipped, and nothing outside `src/instruments/` changed.**
`src/instruments/guitar-geometry.ts` and its test (9 tests), `src/instruments/guitar.ts` and its test (17 tests).
The seam held exactly as specified: `solver.ts`, `states.ts` and every output are byte-for-byte untouched, and the Viterbi pass that plans a piano fingering plans a guitar fretting with no change at all.
Six things the implementation had to settle and this document did not say.

**A tuning is data, which is what makes a capo not a parameter.**
`positionsFor(pitch, tuning)` takes the array of open-string pitches, so standard, drop D and DADGAD differ only in their contents, and `capo(tuning, n)` raises every string by `n`.
A player counts frets from the capo, and that falls straight out: with a capo at 2, every pitch sits exactly where the pitch two semitones lower sat before, which the test asserts across the whole neck rather than at a sample.
`FRETS = 15` — necks run past twenty, but the body stops the hand long before that and every voicing above the twelfth repeats one an octave below.

**Unplayability has two distinct causes and both are ordinary.**
Eight of the prelude's 98 states have no fretting.
Four reach below the guitar's bottom E — the piece descends to 28 and the instrument stops at 40 — and one of those is also the seven-note sonority that Task 4 measured, which no six-string can hold whatever its pitches.
The other four sit entirely on the neck and still have no grip, because a hand covers four frets and they need more: `48 52 57 78` puts its top note at the 14th fret of the first string and its bottom note no higher than the 8th.
So the `null` path is exercised by the first real file rather than by a contrived test, which is what the design predicted and the reason it was built that way.

**The shape table names the open chords and the barre chords with the same eight entries.**
A barre chord *is* an open shape transposed with the nut replaced by a finger, so one table of fret patterns (E, Em, A, Am, D, Dm, C, G) recognises both: at offset 0 it is the open chord, and higher up it is that shape barred at the fret its open strings landed on.
The chord's own name comes from `triadOf` over the sounding pitches rather than from a stored root, so it stays correct in drop D and under a capo, and refuses to guess at a seventh.

**`describe` needs the transition for exactly one thing, and it is the thing only the transition knows.**
Whether the strings that keep their fret are still ringing or are being struck again is invisible in the two grips and is the difference between "let the other three strings ring" and "keep the other three strings".
That is the *Identity, not pitch* rule arriving intact at the last layer of the feature.

**The solver would sooner drop to the second fret than slide a shape up the neck, and it is right to.**
On a keyboard the same shape moved is the same difficulty; on a neck it is not, because the open end is easier and every voicing recurs there.
So the translation tier fires rarely and cannot be tested through the solver at all — the test names both grips outright, which is honest about what the tier is: a property of two configurations, not of the plan.

**The tiers over the prelude are 0 named shapes, 3 translations, 54 finger moves, 33 restatements, over the 90 playable states.**
Zero is the interesting number.
This piece is sevenths and chromatic inner voices, so not one of its sonorities is an open-position triad, and the shape vocabulary — the thing that makes guitar prose worth writing — never fires.
That is the same shape of finding as Task 4's Tonnetz result and Task 6's chunking result, reached a third time on a different instrument, and it is reported rather than tuned around.
Three of the 33 restatements open a segment and have no previous grip to be shorter than; of the remaining 30, seven change at most two `(string, fret)` pairs and could be shortened by a tier that also names a string added or dropped.
That is a different sentence from "this finger moves", it was left out, and this paragraph is the record of the boundary rather than a defect to find later.

**Goal.**
Create `src/instruments/guitar-geometry.ts` and `src/instruments/guitar.ts`, proving the seam by adding a second instrument that changes no shared code.

**Context budget.**
Read the `Instrument` interface and solver (Task 2), `src/instruments/piano.ts` (Task 4) as the pattern, and the *The instrument seam* section above.
Do not modify `states.ts`, `solver.ts`, or anything under `outputs/`.

**Implementation.**
`guitar-geometry.ts` is the pure fretboard: a tuning (an array of open-string pitches, so standard, drop D, and a capo are all just data), and `positionsFor(pitch)` returning every `{ string, fret }` that sounds it.

`guitar.ts` generates candidates as assignments of the state's notes to distinct strings, filtered by fret span and finger count, including open strings.
Cost combines neck position change, span, and barre difficulty, with the usual discount for fingers that stay put.
`describe` names shapes where it can — open chords and barre shapes by their common names — and falls back to string-and-fret when it cannot.

If `candidates` is empty, return empty.
The solver already handles it, and the prose layer already renders it.

**Tests.**
Add `src/instruments/guitar-geometry.test.ts` and `src/instruments/guitar.test.ts`:
- Standard tuning: E2 has exactly one position; a mid-range pitch has several, all sounding the same pitch.
- A capo or drop-D tuning shifts positions correctly, tuning being the only input that changed.
- An open E major chord is recognised and named.
- A seven-note state returns no candidates, and the plan records `null` there while continuing afterwards.
- The same Chopin state sequence produces a guitar plan with some `null` entries and no crash — the honest result, and the one that proves the seam.

**Done when.**
`npm test` passes and `git diff` touches no file outside `src/instruments/` and its tests.

---

## Task 8 — The output surface

**Status: shipped.**
`src/outputs/prose.ts` and `src/outputs/prose.test.ts` (12 tests) are the assembly; `src/ui/prose-panel.ts` and its test (6 tests) are the DOM; `index.html` and `src/main.ts` carry the selector and the panel.
Six things the implementation had to settle and this document did not say.

**The output split in two, along the line every other output here is already split along.**
The sentences are a pure function of the score and the instrument; the DOM is not.
So `outputs/prose.ts` emits `Line[]` and knows nothing about a document, and `ui/prose-panel.ts` lays lines out and knows nothing about music — the same division `outputs/tonnetz.ts` and `ui/gamepad-remap.ts` already keep, and the reason the panel's six tests need no score and the prose's twelve need no DOM.

**Prose writes exactly one sentence of its own, and that is the whole design.**
Every line except the summary of a repeated figure is `inst.describe` verbatim, because the summary is the only sentence that is about the *chunk tree* rather than about a transition.
The moment this layer starts phrasing a move it has to know whether the thing that moved was a finger or a fret, and the seam Task 7 proved is gone.

**The opening line is a real transition rather than a special case.**
The first state has nothing before it, so `proseOf` hands `describe` a transition in which everything is pressed, nothing is held, and `from` is null — which is not a placeholder, it is what actually happens when a piece starts.
Both instruments already fall through their tiers to a full restatement when `from` is null, since Task 7 found the same situation after every unplayable state, so no instrument changed to gain an opening sentence.

**`src/words.ts` is new, and it exists because this task would have been the third copy.**
`count`, `times` and `cap` were byte-identical in `piano.ts` and `guitar.ts`, and the figure summary needs all three plus the interval names piano had kept to itself.
It imports nothing at all, which is what makes it the right home for a vocabulary shared *across* the instrument seam rather than a utility drawer; the two instruments' wording is unchanged, as their own tests still assert.

**The panel sits beside the stage, not instead of it.**
`#stage` became a flex row, so the svg narrows and the existing views are otherwise untouched — reading "hold the outer two, middle finger down a semitone" while the same chord lights up on the roll is worth more than either alone.
The tuning menu is four entries (standard, drop D, capo 2, capo 5) because a tuning is data: `guitarIn(capo(STANDARD, 2))` is the whole implementation of a capo, exactly as Task 7 built it.

**Nothing highlights, and that follows from the reframing rather than from effort saved.**
These instructions have no time in them, so there is no "current" line for a playhead to point at, and a panel that scrolled itself would be inventing a tempo the model deliberately discarded.
The state number in the gutter is the whole navigational apparatus: it is what a reader counts by when they lose their place.

The measurement, for the record:

```
                 lines   unplayable   solve
piano               98            0    33 ms
guitar (standard)   98            8     7 ms
```

98 lines for 98 states, because Task 6 found no repeated figure in this prelude and the tree is therefore 97 steps plus the opening.
The guitar's eight are Task 7's eight, arriving unchanged at the last layer.
A whole-piece solve at that speed is why the panel re-plans on a change — a new score, a new instrument — and never per frame.

**Goal.**
Render a plan as readable instructions in the app, and choose the instrument.

**Context budget.**
Read `src/main.ts` (the view toggle and file loading), `src/outputs/combo.ts` as an example output, and Tasks 1–7's APIs.

**Implementation.**
`src/outputs/prose.ts` takes a `Plan` and a chunk tree and emits a list of sentences with the state index each belongs to.
It does **not** satisfy the `View` type — `View` is `(svg, score, t)`, and this output has no SVG and no `t`.
That is a real boundary and should be stated in the file header: this is the first output that is not a projection onto a canvas, and forcing it through `View` would mean lying about both parameters.

Wire it into `main.ts` as a panel with an instrument selector (piano / guitar, and guitar's tuning), populated whenever a score loads.
Keep the selector's state next to the view toggle; it is the same kind of thing.

**Done when.**
Loading `scores/chopin_prelude_op28_no4.musicxml` shows a followable instruction list, switching to guitar re-plans it, and the existing views are untouched.
Verify by running the app (`/run`), and hand it off for visual checking rather than checking it yourself.

---

## Task 10 — The keyboard surface

**Status: shipped.**
`src/outputs/hands.ts` and `src/outputs/hands.test.ts` (22 tests) are the view; `src/outputs/keyboard.ts` and its test (12 tests) are the geometry it shares with the piano roll; `src/states.ts` gained `onsetOf` / `indexAt` and five tests for them.

Task 8 gave the instructions a panel to be read in.
This gives them a *keyboard* to be seen on, and the two are the same information: one state at a time, the sentence from `piano.describe` verbatim, and the keys it names lit under the hand that plays them.
Nothing falls and nothing scrolls — there is no time axis in this view at all, which is the reframing arriving on screen rather than only in the model.

Four things the implementation had to settle and this document did not say.

**The keyboard became a module, because a second view wanted it.**
The roll drew its own 88 keys, and a keyboard whose position a player has learned must be in exactly the same place in every view that shows one.
So `outputs/keyboard.ts` now owns `layout` and its inverse `pitchAt` — kept adjacent deliberately, since a hit-test derived independently of the drawing is a hit-test that drifts — and the roll draws through it.
The musical facts are not restated there: `LOW`, `HIGH` and `isBlack` still come from `instruments/piano-geometry.ts`, and the new module only turns them into pixels.
Its central test is the one the split exists for: every one of the 88 keys, at every band height a view uses, hit-tests back to itself.

**Locating yourself in the score is a query, not a field.**
A view that shows one thing at a time has to know which one the transport is sitting on, and `State` deliberately carries no time.
It does not need to: an `Onset` carries its own, and `onsetAt` is a binary search over that — sound because the time rises strictly across the sequence.
The first version of this derived the time back out of a state (the latest onset in its sonority is the strike that created it), which worked and was cleverness standing in for a missing export; exposing `onsetsOf` deleted it.

**The view is a `View` that uses its `t` exactly once.**
`t` cannot be a coordinate here the way it is in the roll; it is spent on `indexAt` and never mentioned again.
That is also the whole of what sequencing will replace: when the cursor stops being a function of the clock and starts being a number someone steps, one line changes.

**The keyboard is the payload, so the sentence is a caption.**
`piano.describe`'s longest tier names every key by landmark, and in this prelude that runs to 903 characters — a sentence whose entire job is answering "which key", which the lit keys have already answered.
There is room above the keyboard for ten lines of it at full size, and fitting by height alone took them, burying the instrument under a wall of prose.
So the caption steps its type down until the sentence is *both* short enough to read as a caption (four lines) and small enough to fit; below the floor it is dropped rather than truncated, since a half-instruction is worse than none and the keys and the note names are still complete.
Measured over every strike of the prelude, no text baseline crosses the keyboard at any stage size, and only a stage under about 350px tall loses any captions at all.

The colour convention, which is the reading:

```
left hand   --hand-l (cool)      right hand  --hand-r (warm)
dimmed      still ringing from the last chord — do NOT re-strike
solid       strike it, with the finger number on the key face
green ring  you are holding it right now (live MIDI / keyboard / mouse)
```

Held and restruck stay separate here for the same reason `Transition` keeps them apart: a note still sounding and a key played again are different instructions, and this is the first output where the difference is a colour rather than a clause.
The keyboard is playable, like the roll's — the same `pitchAt`, so pressing what you are told to press rings the key you were told to press.

### Hands separately

`pianoAlone(hand)` in `src/instruments/piano.ts` (5 tests) and the practice filter in `hands.ts` (9 tests).

**Practising one hand is a shorter piece, not a dimmer picture.**
That is the decision the whole feature rests on, and the naive version — draw both hands, grey one out — gets it wrong in a way that matters: it leaves you stepping through states the practised hand never moved through.
So the score is filtered *before* the pipeline, and the states, transitions, voice leading and sentences are all the ones that hand actually performs.
Measured on the prelude: 189 strikes become 173 for the left hand and 77 for the right — 521 notes and 77 notes of the 598.

**One hand is one line of instrument.**
`pianoAlone` is `piano` with the splits that share a sonority out simply not offered; `cost` and `describe` are shared verbatim, because a one-handed fingering is an ordinary `Fingering` with one hand's placements in it.
It follows for free that a sonority one hand cannot reach returns nothing — and that is not hypothetical, since the prelude writes three chords on the lower staff spanning more than an octave.
Those get their own sentence ("the left hand alone cannot hold this chord — roll it, or take it with both hands"), because *playable, but not by one hand* is a different fact from *playable by nobody*, and the keys stay lit either way.

**The score's own answer decides whose note it is.**
MusicXML writes the two hands as two staves, which is a choice the composer made rather than one to re-derive, so `staff` wins wherever it is stated.
Only where the input says nothing does the solver get asked, and its answer is the same split the both-hands view already draws.

**The transport is untouched.**
Onsets survive the filter, so `t` still locates you in the whole piece; only the *steps* are one hand's.
A one-handed solve costs about a millisecond against the full piece's 33, so the filter is free.

**A seam worth naming.**
In both-hands mode the view colours notes by the *solver's* split, which is what `prose.ts` narrates too — `piano.candidates` has never consulted `staff`, even though Task 5 carried it into the model.
One hand at a time uses the notated staves.
The two agree almost everywhere and disagree on notes the solver would reach for with the other hand; making `candidates` prefer the notated split would close it, at the cost of re-cutting every existing prose sentence.

### Sequencing

`stepTime` in `hands.ts` (9 tests, three of them the whole prelude walked end to end), two buttons and the ↑ / ↓ keys.

**Stepping is a seek, and that is the whole design.**
The obvious build is a cursor of its own — an index someone increments, with the clock as a second, rival source of truth for "where am I".
Two cursors is two chances to disagree, and every other surface (the roll, the audio, the scrubber, the bar readout) would have had to be taught about the new one.
So a step just seeks the transport to the next sonority's onset: `stepTime` is a pure query returning a time, the exact shape of `Core.barStep`, and everything downstream follows without being told anything.
`onsetAt` then reads that time back as the strike it came from, exactly — a test walks the prelude strike by strike and asserts it visits all 189, once each, in order.

**It is independent of tempo without being independent of time.**
One tap is one strike however long that strike lasts, which is the sense the reframing meant: the *ordering* is by what you do, not by beats.
The prelude's strikes run from a semiquaver to four seconds and every one of them is a single tap.

**Horizontal is time, vertical is the chord list.**
← / → keep stepping bars; ↑ / ↓ step sonorities, along the axis the instruction list reads down.
And a step walks the sequence currently being *practised*, so stepping the left hand alone skips every strike that was only the right hand's.

**Going back from inside a chord returns to that chord first.**
The same forgiveness `barStep` gives a bar, with a far smaller tolerance: a sonority can be shorter than the 0.12s a bar is allowed, so anything generous would make "back" stick on a tremolo instead of walking out of it.

---

### Wait for notes

`src/note-gate.ts` and `src/note-gate.test.ts` (17 tests), the practice-loop tests in `hands.test.ts`, and one strike counter added to `live-keys.ts`.

Switch it on and nothing advances the sequence but playing it.
That is the last piece of the reframing: with time gone, "when does the next chord arrive" had no answer left except *when you play this one*.

**Advance when every key is down and every struck key is freshly struck**, and each half of that asks a different thing.
`hold` is the whole sonority, including notes still ringing that the fingers are merely resting on.
`strike` is what the score actually starts here.

**Demanding the whole strike set is what accounts for every note**, and it is the only rule that does.
Three candidates were on the table and two of them lose notes:

| rule | gates | notes it makes you play |
|---|---|---|
| one strike per state | 98 | skips 91 of 189 onsets — the entire left-hand texture |
| one *fresh key* per onset | 189 | a three-note chord passes on one finger |
| **the onset's whole strike set** | **189** | **598 of 598** |

The middle one is the version that writes itself, and it is wrong twice over: a chord goes by on one finger, and for the 38 runs whose statements strike different subsets it is asking for the wrong notes in the first place.
The test that pins this plays the whole prelude twice at every strike — once as a *lazy player* who releases what stopped sounding, puts down only what is genuinely new, and leaves every already-down key where it is, and once honestly.
The lazy pass is refused all 170 times it is available, and the honest pass plays 598 notes.

**Freshness cannot be read from the held set.**
A release and the next press can both land between two frames, and `PerfState.trigger()` does exactly that: it releases and re-presses a whole chord in one synchronous call, so a reader polling `LiveKeys.held()` sees nothing happen and waits forever.
`live-keys.ts` therefore counts strikes per pitch — monotonic, so it survives any sampling rate — and the gate compares counts rather than sets.
Counting them *per pitch* rather than one counter for the keyboard is also what makes a wrong note harmless: a brushed neighbour is not one of the chord's own keys, so it cannot pass the gate on the chord's behalf.

**Extra keys do not block.**
A wrong note is a mistake you can already see — the Hands view rings every key you are holding — not a reason to refuse the right ones.

**The gate marks the strike counts when the sequence ARRIVES**, which is how it tells a chord you are about to play from one you were already holding.
Land on a sonority your fingers happen to be resting on and it waits for you to play it rather than skipping it.
In the app the frame loop supplies sixty of those arrival frames a second, so the distinction never costs anything; in a test it is one call, and every practice test starts with it.

**Two waits, named apart.**
"I am holding all four keys and it still will not move" is the one state a single number cannot explain, so the readout says `WAITING · 3 / 4 DOWN` while keys are missing and `STRIKE 2 MORE` once they are all down but not all played.
`check` is an edge detector asked once per frame by one caller; the view reads `status`, `progress` and `satisfied`, which do not consume the edge.

**"Wait for notes" and "play it for me" are the same claim twice**, and only one of them can be true, so switching the gate on stops the transport and takes Play out of the running until it is switched off.
Stepping and scrubbing stay: navigating past a chord you cannot play yet is not the same as the piece advancing on its own.

---

## Task 9 (optional) — Narrate the live instrument

**Goal.**
Point the same narrator at `PerfState` / `TonnetzState` instead of a file.

**Context budget.**
Read `src/perf-state.ts`, `src/tonnetz-state.ts`, and Task 1's `State` type.

**Why it is nearly free.**
Both already emit a chord sequence with no timing — which is precisely a state sequence.
A small adapter turning `snapshot().sounding` into a `State` on each change lets the prose layer describe a live improvisation as it happens, and gives the Tonnetz a spoken twin of the P/L/R walk it already draws.

**Done when.**
Walking the lattice with a gamepad produces a running commentary of the transitions.

---

## Order and independence

Task 1 is the foundation and everything depends on it.
Task 2 depends only on Task 1's types, and Tasks 3, 5, and 6 are independent of each other and of the solver — Task 3 imports nothing but `types`, Task 5 touches only the parser, Task 6 touches only the state sequence.
Task 4 is the first convergence: it needs 1, 2, and 3, and it is the point at which the feature does something a person can read.
Task 7 needs 2 and 4 as a pattern and is the seam's proof.
Task 8 needs everything before it; Task 9 needs only Task 1 and an instrument.

The feature is genuinely useful after Task 4 and genuinely finished after Task 8.
Every task ships its own tests and can be reviewed and merged on its own.
