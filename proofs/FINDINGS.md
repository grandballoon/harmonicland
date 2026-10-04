# Findings

Lean 4 models of the pure logic in `../src`, the claims the code makes about itself stated as theorems, and the places those claims fail.
Nothing in `src/` was changed: every failure below is noted, not fixed.

## What was done, and what it is worth

Lean cannot read TypeScript.
Each file in `Harmonicland/` is a hand translation of one or more modules, line by line, with JavaScript numbers replaced by exact rationals and integers (`CONVENTIONS.md` has the rules).
A theorem here is therefore a proof about the arithmetic the code means, not about IEEE doubles, the DOM, or an audio device.

Every claim was taken from the code itself: a header comment, a doc comment, a type's documentation, or a test's name.
Each one ended in one of three states.

- **Holds**: proved, for every input.
- **Holds only under a hypothesis the code does not enforce**: proved with the hypothesis, with a counterexample without it.
- **Fails**: a theorem named `FAILS_…` proves the negation from a concrete counterexample.

Every `FAILS_` theorem has a script in `repro/` that runs the real TypeScript on the same counterexample.
All of them reproduce, so no failure below is an artefact of the translation.
The reverse is not guaranteed: a "holds" is only as good as the translation and the exact-arithmetic assumption.

| | |
|---|---|
| Lean files | 22, about 21,000 lines |
| Theorems written | 1,051 |
| of which `FAILS_` counterexamples | 70 |
| `sorry`, added axioms, `native_decide` | none (checked by `Audit.lean` over all 4,628 theorems, generated ones included) |
| Repro scripts | 51 (all run clean under `check.sh --repro`) |
| `src/` test suite before and after | 1,075 passing, unchanged |

To re-check everything: `proofs/check.sh` (build, audit, counts), and `proofs/check.sh --repro` to also run every counterexample against the real code.
It needs `~/.elan` (installed for this work, 2.7 GB) and Node 22.

## Failures

Grouped by how likely a user is to meet them.
Each entry gives the claim, what breaks it, what the user sees, and where the proof and the repro are.

### 1. Reachable in ordinary use

**1.1 MIDI out: the sustain pedal is left down after a pause or seek.**
`flush` sends sustain-off because "what the pedal holds is part of what was playing" (`outputs/midi-out.ts:139`).
The scheduler sends pedal changes up to 100 ms ahead with a timestamp (`scheduler.ts:134`), but the flush's sustain-off is unstamped and so immediate.
A pedal-down already on its way arrives after it.
Pausing within 100 ms before a pedal mark leaves the synth's pedal down, and everything played while paused rings on; seeking does the same to the music at the new place.
In pedalled music that is roughly one pause in ten.
`MidiOut.lean` `FAILS_flush_lifts_pedal`; `repro/midi_pedal_stuck_after_pause.ts`.

**1.2 MIDI out: a note is left sounding when a flush follows a stalled ticker.**
"flush sends a note-off for every note it has struck" (`outputs/midi-out.ts:19`, `SPEC_playback.md:284`).
`flush` skips any note whose end has already passed (`midi-out.ts:137`), assuming `advance` sent its note-off; if no tick ran in between, nothing did.
Loading a file while playing does it: the parse and `loadScore`'s `clock.seek(0)` run in one task, so no tick can interleave.
The note sounds until that key is struck again or the output is switched.
`MidiOut.lean` `FAILS_flush_ends_every_struck_note`; `repro/midi_out.ts` sections 1–2.

**1.3 Playing along: a live key and a score note on the same pitch silence each other.**
The two paths "never touch each other" and flush "Leaves the live path alone" (`types.ts:190-193`, `204-205`).
On MIDI a note-off is the same three bytes whichever path sends it, so the score's note-off releases a key the user is holding, a flush does too, and the user's key-up cuts the score's note.
On the built-in piano a score strike cuts the user's held voice on that pitch (`outputs/audio.ts:326`); `audio.ts:14-21` says this is deliberate, so here two documents disagree.
`MidiOut.lean` `FAILS_flush_leaves_live_alone`, `FAILS_paths_never_touch`, `Audio.FAILS_audio_paths_never_touch`; `repro/midi_out.ts` sections 3–4, `repro/audio_shared_pitch.ts`.

**1.4 Practice mode: the auto-played hand can play the learner's part for them.**
A step completes when every attacked pitch is "down at that moment", and `dropped` is "Sustains the learner has let go of" (`practice-state.ts:16-18`, `111-118`).
All of these read `LiveKeys.held()`, which includes the other hand's auto-pressed voices.
When the two hands share a pitch at a step, the learner can lift that key and still advance, a dropped sustain does not block, and a wrong key the accompaniment is also holding is not shown as wrong.
Needs a one-hand lesson with auto-play on (the default) and a unison between the hands.
`PracticeCursor.lean` `FAILS_pending_struck_and_let_go`, `FAILS_advance_all_down`, `FAILS_dropped_let_go`, `FAILS_wrong_hidden_by_auto`; `repro/practice_cursor.ts` A–C.

**1.5 Practice mode: switching hands can throw the cursor backward, and an empty range reads as "done".**
`setHand` is to "land on the first step at or after the one you were on" (`practice-state.ts:399-401`); when that step lies outside the kept bars the cursor wraps to the range's first step instead.
`index` "equals `total` exactly when the score is finished" (`practice-state.ts:101-102`); isolating a bar with nothing for the practised hand parks the cursor at `total` with nothing played, and `outputs/practice.ts:677` prints "done".
`PracticeCursor.lean` `FAILS_setHand_lands_at_or_after`, `FAILS_index_total_iff_finished`; `repro/practice_cursor.ts` D–E.
Noted beside these, with no stated claim broken: toggling Loop after finishing a piece calls `setRange(null)`, which restarts the lesson at step 0.

**1.6 LilyPond: tempo and meter leak from one voice to the other.**
The parser's tempo and meter are globals in parse order (`inputs/lily.ts:82`), and the meter map answers with the last entry pushed, not the last in time (`lily.ts:94`).
In `<< … \\ … >>` a tempo change in the first voice is already in force when the second voice starts, and a meter change in the first voice replaces the opening meter for the whole piece.
The hands come out of sync from the first note and every barline is wrong.
For the meter case the second voice only needs its own `\key` or `\time` at its head, which piano scores nearly always have.
`XmlLily.lean` `FAILS_voices_keep_time_together`, `FAILS_meter_map_is_in_time_order`; `repro/XmlLily_lily_voices_tempo.ts`, `repro/XmlLily_lily_voices_meter.ts`.

**1.7 LilyPond: an unresolved tie swallows a later note.**
A `~` "joins a note to the next note of its pitch" (`lily.ts:10`), but the open tie is keyed by pitch alone and never expires (`lily.ts:105-110`).
A tied chord where not every note is tied on, ordinary piano writing, leaves a note open until that pitch next appears, however far away: a drone and a missing attack.
`XmlLily.lean` `FAILS_tie_joins_only_the_next_note`; `repro/XmlLily_lily_tie_swallows.ts`.

**1.8 MusicXML: a tempo change inside a measure desynchronises the staves.**
"tempo is a property of time" (`inputs/musicxml.ts:55`), but the tempo used is the last mark met in document order, so `<backup>` and the whole second staff are timed at the new tempo.
A rit. or a tempo mid-measure in a piano part puts the hands out of sync for that measure and makes the bar too long.
`XmlLily.lean` `FAILS_voices_meet_on_the_beat`; `repro/XmlLily_musicxml_tempo_midmeasure.ts`.

**1.9 Engraving: short notes vanish from the page.**
The engraver "writes a note too short to quantize as a thirty-second, not nothing" (`outputs/engrave.test.ts:107`).
Each end of a note snaps independently to the straight or the triplet grid, and a span on neither gets no values at all.
Four of every six triplet thirty-seconds have no head; so does a short performed note straddling the two grids.
The note sounds and lights its key, and a rest is drawn where it sounds.
`Engrave.lean` `FAILS_every_note_in_the_bar_has_a_head`, `triplet_thirty_seconds_lose_four`; `repro/Engrave_note_without_head.ts`.

**1.10 Engraving: rests overrun their gap, and a wrong-note head can lose its accidental.**
"The gaps in a staff are filled" and note values are "always right" (`engrave.ts:26-28`); a gap that does not end on the eighth grid gets rests that run past the next head, and a length between the grids is written short.
`printedAt` is "the rule `engraveBar` prints by" (`engrave.ts:205`), but the two walk the heads in different orders and disagree when one instant has the same letter and octave with two accidentals, which MIDI's sharp spelling makes of any C against C♯ across the hands.
`Engrave.lean` `FAILS_rests_fill_the_gap`, `FAILS_valuesFor_always_right`, `FAILS_printedAt_is_engraveBars_rule`; `repro/Engrave_rest_overruns_gap.ts`, `repro/Engrave_valuesFor_always_right.ts`, `repro/Engrave_printedAt.ts`.

**1.11 Chord instrument: notes above MIDI 127.**
A `Pitch` is a "MIDI note number, 0–127" (`types.ts:9`), and `setOctave` allows 0–8.
In C major, the only key the app plays in, octave 7 with the chromatic dom13 coloration already reaches 128, and at octave 8 a plain diatonic seventh does.
On MIDI the note-on carries an illegal data byte, which `port.send` rejects and `midi-out.ts:113` swallows; the built-in piano plays the C8 sample at up to 3× speed.
`Perfecto.lean` `FAILS_notes_valid_midi_C_major_octave_7`, `FAILS_notes_valid_midi_octave_8` (and `_octave_6`, `_led_octave_5` for other keys); `repro/perfecto_midi_range.ts`.
What a real MIDI port does with the byte is from the Web MIDI spec, not run here.

**1.12 Chord instrument: one voicing names a pitch twice.**
The extended "7♯9" coloration in second inversion on a minor or diminished degree lifts the third onto the ♯9.
`PerfState` presses the key twice and its snapshot lists the pitch twice; the sound is unaffected.
`Reconcile.lean` `FAILS_computeVoicing_nodup`, `FAILS_one_voice_each`; `repro/reconcile_duplicate_voicing.ts`.

**1.13 Progressions: key signatures with seven accidentals.**
"an enharmonic tonic takes the side of the circle with fewer accidentals" (`harmony/progression.ts:271`).
G♯ minor comes out as seven flats, C♯ dorian as seven flats, F♯ lydian as seven sharps, each where the other spelling has five; and F♯ major gets six sharps where the comment says G♭ wins the tie.
Reached by the progression key picker, and engraved that way.
`Progression.lean` `FAILS_keySignature_fewer_accidentals`, `FAILS_keySignature_Gflat_wins_tie`; `repro/progression_keySignature.ts`.

**1.14 Stepping through a performance: a chord spread across a barline belongs to the wrong bar.**
Within a loop "only the loop's steps are candidates" and "the steps it confines are whole steps" (`loop.ts:26`, `53`).
A step is filed by its first onset but lands on its last (decision 1), so a chord played 10 ms either side of a barline is a step of the earlier bar, the arrow key parks the playhead past the loop's end, and the later bar's own downbeat chord is not one of its steps.
`Loop.lean` `FAILS_stepFrom_in_loop`; `repro/loop_step_lands_outside.ts`.

**1.15 Stepping: parking on a step's last attack does not sound every note of it.**
"Parked on the last, every attack is sounding" (`loop.ts:16`).
A note that ends before the step's last note begins is silent there: a grace note, or two 64ths at a fast tempo, which `GROUP_SEC` makes one step.
The arrow key sounds one note of a two-note step.
Holds when every note of the step outlasts `GROUP_SEC` (`landing_all_sounding`).
`Loop.lean` `FAILS_landing_all_sounding`; `repro/loop_landing_silent_attack.ts`.

**1.16 Microphone: frames are skipped when the model is slow, and the default sensitivity is not the default threshold.**
"each absolute frame is committed exactly once" (`mic/window.ts:16`); when more than about 1.9 s of audio arrives between two model runs, the frames in between never reach the tracker and notes struck there are lost.
`mic/transcriber.ts:131` admits this; the two comments contradict each other.
Separately, sensitivity 0.5 is meant to give "the defaults at 0.5" (`mic/settings.ts:58`) but gives a confirm threshold of 0.52, so the app never runs the thresholds its tests exercise.
`Mic.lean` `FAILS_each_frame_committed_exactly_once`, `FAILS_trackerOptions_default_confirm`; `repro/mic_skipped_frames.ts`, `repro/mic_settings_default.ts`.

**1.17 Keys-only view: a selection wholly outside the 88 keys has no keyboard.**
`spanOf` is "clamped to the 88" (`pitch.ts:94`); for notes all above C8 or all below A0 it returns a span whose low end is above its high end.
`whitesIn` is then empty and the placement is width 0 with NaN height.
The MIDI parser does not restrict pitch, so a file can do this.
`Pitch.lean` `FAILS_spanOf_clamped_above`, `FAILS_spanOf_clamped_below`; `repro/pitch_spanOf_outside_88.ts`.

**1.18 The empty score has a bar nothing can be in.**
`makeBars` drops duplicate posts because "a zero-length bar would be a bar nothing can ever be in" (`core.ts:83`), but `makeScore([])`, the app's state before a file is loaded, has exactly one bar, `[0, 0)`.
Every bar theorem in `Core.lean` therefore carries the hypothesis `0 < duration`.
No visible consequence was found; `beatOfTime` already guards for it.
`Core.lean` `FAILS_makeBars_positive`; `repro/core_zero_length_bar.ts`.

### 2. Reachable only from a malformed or crafted file

These are files a user could be handed, so they matter, but a well-formed file cannot trigger them.

**2.1 Three parsers can hang the tab.**
MIDI: a five-byte variable-length quantity overflows the 32-bit reader to a negative length, and the track loop steps back onto the same event forever (`inputs/midi.ts:79`, `108`); 38 bytes suffice.
MIDI: a time signature with denominator byte 30 asks for 2²⁸ bars from a 39-byte file and exhausts memory.
MusicXML: a `<chord/>` note with `<duration>Infinity</duration>` makes the score infinitely long while its barlines stay finite, and `makeBars`'s continuation loop never ends (`core.ts:105`).
LilyPond: `\time 0/4`, or a note of duration `0`, makes the fence-post loop add zero forever (`lily.ts:357`).
`MidiParse.lean` `FAILS_track_loop_terminates`, `tiny_file_many_bars`; `XmlLily.lean` `FAILS_makeBars_loop_ends_on_infinite_duration`, `FAILS_fence_loop_terminates`; `repro/MidiParse_track_loop_hangs.ts`, `repro/MidiParse_tiny_file_many_bars.ts`, `repro/XmlLily_musicxml_infinite_duration.ts`, `repro/XmlLily_lily_time_zero.ts`, `repro/XmlLily_lily_duration_zero.ts`.

**2.2 Times that are negative or not numbers.**
A MIDI header with division 0 gives NaN for every time; an overflowed delta gives a note before time 0; a MusicXML tempo of −60 or a negative `<duration>` does the same.
`MidiParse.lean` `FAILS_times_are_finite`, `FAILS_readVarLen_nonneg`; `XmlLily.lean` `FAILS_onsets_from_start`; `repro/MidiParse_division_zero.ts`, `repro/MidiParse_varlen_negative.ts`, `repro/XmlLily_musicxml_negative_onset.ts`.

**2.3 A dynamic named `constructor`.**
`mark` returns "False if it is not a dynamic this reader knows" (`inputs/dynamics.ts:47`), but tests membership with `in`, which finds `Object.prototype`'s names.
`\constructor` in LilyPond, or `<other-dynamics>constructor</other-dynamics>`, gives every later note a function for a velocity.
With shaping on (the default) the score is judged flat and played normally; with shaping off the velocities reach the outputs as they are.
`Dynamics.lean` `FAILS_mark_ignores_words_that_are_not_dynamics`; `repro/dynamics_constructor.ts`.

**2.4 Smaller ones.**
A MIDI pitch byte of 128 or more aliases another track's key in the `track<<7|pitch` map (`MidiParse.lean` `FAILS_key_unpacks`).
A triple accidental puts the head on the wrong octave (`Engrave.lean` `FAILS_octaveFor_triple`).
`midi.ts:193` says note-ons pair "LIFO"; the code is FIFO (`FAILS_pairs_LIFO`), which is a comment that is wrong rather than behaviour that is.
A LilyPond file with no `\time`, `\key` or `\tempo` before its first note lays its first bars at the final tempo, not the one in force (`XmlLily.lean` `FAILS_barlines_at_the_tempo_in_force`).

### 3. Real, but needing a microsecond coincidence

All four come from one root: tolerances of 10⁻⁶ applied in different units, or on one side of a boundary only.

**3.1 At a loop wrap a note can be struck twice, or not at all.**
"THE WINDOWS are contiguous and half-open in wall time, so every note is struck exactly once per pass" (`scheduler.ts:18`).
`clock.ahead` treats a window that opens within `EPS` of a lap's start as opening on it (`clock.ts:119-122`), so that window's stretch is up to a microsecond out of step with its neighbours.
A note whose onset falls in the resulting sliver is struck by two windows, or by none.
Reproduced through the real scheduler: one note struck at wall 1099.9997 and again at 1100.0002, another never struck.
It needs a window boundary within a microsecond of a wrap and a note in a particular microsecond, so in practice it will not be heard.
Without a loop the claim holds exactly (`ahead_straight_exactly_once`, `Scheduler.windows_visit_once`).
`Clock.lean` `FAILS_ahead_struck_once`, `FAILS_ahead_struck_at_all`; `repro/clock_wrap_double_strike.ts`.

**3.2 A stretch can end past its own `until`.**
A `Stretch` "runs linearly from `start` until `until`" (`types.ts:217`); a window that opens just before a wrap and spans a whole lap of a loop shorter than the look-ahead returns one ending up to a microsecond past the loop's end.
The scheduler's guard (`damp - at <= 0`) keeps a note from being struck there.
Every stretch is proved to end within `EPS` of the loop's end, and not past it unless it is a jump (`ahead_loop_stretches`).
`Clock.lean` `FAILS_ahead_end_le_until`; `repro/clock_stretch_past_until.ts`.

**3.3 A trimmed range can cover a stretch that ends before it begins.**
`barTime` is "The seconds a run of bars covers" (`core.ts:196`).
Trims are kept apart in beats (`BEAT_EPS`) but snapped to attacks in seconds (`onAttack`), and only a trimmed edge is snapped.
A bar trimmed to two millionths of a beat, with a note just before its barline, gives `end < start`; `spanOf` then returns a span whose `last` is before its `first`, and the clock silently drops the loop.
It holds when the range is at least two microseconds long, or when both edges are trimmed or neither (`barTime_nonempty`, `barTime_ordered`).
`Core.lean` `FAILS_barTime_ordered`, `Steps.lean` `FAILS_spanOf_ordered`; `repro/core_bartime_inverted.ts`.

**3.4 Microphone: a re-strike inside the minimum hold is dropped.**
A fresh onset on a key already down "is reported as off-then-on" (`mic/note-tracker.ts:20`), but not within `minHoldFrames` (46 ms) of the first, and it is not kept for later.
That is faster than a piano repeats, so in practice it is model jitter.
`Mic.lean` `FAILS_restrike_reported_within_min_hold`; `repro/mic_restrike_lost.ts`.

### 4. Latent: no caller reaches these today

Each would become real the moment the named caller changes.

- **`makeBars` drops the meter of a single barline** (`core.ts:102`): one post stating 3/4 in E♭ yields a 4/4 bar in C. No parser hands over exactly one post. `Core.lean` `FAILS_makeBars_single_post_keeps_meter`.
- **Chord quality on scales the app cannot yet select**: degree III of harmonic and melodic minor is called major and sounds a fifth outside the scale; the tonic of minor pentatonic and blues is called major. `setKey` has no caller. `Perfecto.lean` `FAILS_base_cell_is_diatonic_on_minor_III`, `FAILS_quality_correct_for_pentatonic`.
- **`realize` with `beatsPerBar: 0` never returns**, and `beatSec: 0` or a change of zero beats gives degenerate bars. The one caller passes no options. `Progression.lean` `FAILS_realize_terminates`, `FAILS_barlines_increasing_beatSec_zero`, `FAILS_entries_positive_beats_zero`.
- **Sections do not survive a reload unless their range is normalized** (`from ≤ to`, trims > 0), and list order depends on save order when a range has `fromBeat: 0`. Every caller normalizes first, which `Core.lean` proves `normalizeRange` guarantees. `Sections.lean` `FAILS_load_save_roundtrip_*`, `FAILS_order_whatever_order_saved`.
- **Option values nothing sets**: tracker frame counts above 255 or 65535 wrap their typed-array counters; a negative gate rise sinks the floor below −100 dB; `level()` does not clamp a velocity; `cycleMode(-4)` indexes out of range; a strike with `off < at` or a negative offset. `Mic.lean`, `Dynamics.lean`, `Reconcile.lean`, `MidiOut.lean`.

## What holds

The long list is in the files; these are the results that carry the most weight.

**The score (`Core.lean`).**
`makeScore` returns notes sorted by onset with ids equal to their positions, loses and invents none, and gives a duration that covers every note.
Its pedal ranges are non-empty, sorted, non-overlapping, inside the piece, and down at exactly the instants the parser's were.
Its bars are never empty as a list, start at 0, tile without gaps, cover the piece, are numbered by position and have a usable meter; the continuation loop terminates.
`barAt` returns the bar containing a time and clamps at both ends.
`normalizeRange` always returns a valid range with every trim strictly inside its bar, and is idempotent, which is what keeps a running backchain from being ended by its own link.
`timeOfBeat` and `beatOfTime` are inverses.

**Steps (`Steps.lean`).**
Every practised note is attacked in exactly one step; steps are more than `GROUP_SEC` apart; attack, sustain and release are disjoint; sustain is exactly the notes begun earlier and still sounding.
`spanOf` is exactly the steps whose `at` falls in the stretch.
`pairSorted` is what its comment says: an optimal non-crossing matching, of as many pairs as fit, with total distance no greater than any other such matching.
`movesBetween` never draws an arrow from one hand to the other, and draws one arrow per key.

**Loop and backchain (`Loop.lean`).**
With no loop the ends are walls; inside a loop an arrow key always has somewhere to go.
A dragged edge never crosses the other, in bars or finely.
There is one backchain link per step, the last link is the section itself, and Shift+↑/↓ goes to the nearest link adding the practised hand's note.

**The clock (`Clock.lean`).**
The loop is always a valid, non-empty range inside the piece.
While a span that began before the loop's end is playing, `now()` never reaches that end, and once it has wrapped it is inside `[start, end)`.
`play()` with a loop always starts inside it; a loop set while playing is one the span is inside; setting the same loop again changes nothing; changing the loop does not move the present.

**Performance and scheduling (`Perform.lean`, `Scheduler.lean`).**
Both binary searches are correct on sorted input.
No key is struck twice at one instant; a unison is held for the longer note at the louder velocity; no note is left out.
Of two performed notes on one pitch, the earlier has its key up and dampers down by the time the later is struck.
Every performed note is struck, released, then damped, in that order.
Velocities stay within 1–127 whenever the parser's do.
Every strike handed to an output is well formed, and a stretch's main loop visits exactly the notes that begin in it.
Pedal calls inside a stretch are in time order with a change's up before its down.

**Live keys (`LiveKeys.lean`, `Reconcile.lean`).**
After any sequence of press, release, releaseAll and output switches, including calls made from inside a listener, the active output has exactly the pitches with a live audible voice.
No failure was found in `live-keys.ts` or `outputs/sound.ts`.
A re-trigger with no change presses and releases nothing, and common tones are never re-attacked.

**Harmony (`Tonnetz.lean`, `Perfecto.lean`, `Progression.lean`).**
P, L and R are involutions that keep two common tones and are the parallel, leading-tone and relative transforms; no failure was found in the lattice.
No table lookup in `perfecto.ts` is ever out of bounds; voicings are sorted; voice-leading keeps the requested inversion.
`inRegister` keeps a voicing within a tritone of its anchor, and the bass is always clear of the chord.

**Everything else.**
`Sections.lean`: every operation keeps ids unique and the list in score order; `chunk` partitions the bars.
`PedalMarks.lean`: no failures; a pedal change gives two touching ranges.
`Mic.lean`: the ring buffer never loses a sample a snapshot needs; tracker events strictly alternate on and off; no frame is committed twice.
`Engrave.lean`: `spellIn` names the right pitch for every pitch and every key signature, including those past seven accidentals.
`Layout.lean`: no failures; white keys tile the width, hit-testing is the inverse of drawing, and a note crosses the staff playhead as its bar reaches the strike line.
`PracticeCursor.lean`: the cursor is always inside its span or at its end; only a press can complete a step; one press advances at most one step; wrong notes never block.

## What was not modelled

- **Floating point.** One consequence was seen in the real code and is outside every model: `perform` detects a unison by exact equality of onsets (`perform.ts:132`), while every other comparison of times uses a tolerance. Two notes on one pitch at `0.3` and `0.1 + 0.2` become two strikes, the first lasting 5×10⁻¹⁷ s. Whether a parser produces such onsets was not established.
- **`main.ts`** (1,315 lines of wiring) and every renderer's markup: `staff-bars`, `staff-score`, `practice`, `piano-roll`'s drawing, `mei`, `verovio`, `nashville`, `tonnetz`. Only their pure geometry is in `Layout.lean`.
- **The DOM modules**: `sections-panel`, `section-chips`, `selection-tip`, `backchain-bar`, `mic-panel`, `sound-row`, `view`.
- **Devices and time**: Web Audio beyond the voice registry's same-pitch rule, Web MIDI ports, the gamepad, `requestAnimationFrame`, the worker ticker.
- **Text handling in the parsers**: tokenizing, XML, `mxl` unzipping. The models start from the numbers those extract. LilyPond tuplets are out of scope in the source too.
- **The scheduler's `tick`/`reset` state** is not a state machine here; what `tick` does with the clock's answer is covered by the theorems on `ahead` and on a single stretch.
- **`withEdge`, `withBar` and `stepEdge`** in `loop.ts` are translated (the backchain model uses them) but have no theorems of their own.
- One unverified suspicion from reading `audio.ts`: `makeRoomFor` can exceed the 96-voice limit when every counted voice is scheduled but not yet started. It needs 96 distinct pitches inside one 100 ms window and was neither modelled nor reproduced.

## How far to trust this

- A `FAILS_` is certain: it is proved in the model and reproduced in the code.
- A "holds" says the logic is right in exact arithmetic, for the translation as written. Each definition cites the lines it translates so the translation can be checked against the source.
- Where a model restructures the code to make a proof possible (a fold for a loop, a recurrence for a memo table, a list for a `Map`), the file's header says so.
- The three loops that can genuinely diverge are modelled with a step budget, and their non-termination is proved as "still running after any number of steps".
- The 22 files were written in five independent slices; the 16 outside the timing core import nothing from each other, so where one relies on another's result it does so by restating it as a hypothesis, not by using the theorem.
