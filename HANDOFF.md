# Notation Animator — Handoff

A browser tool that loads MIDI, MusicXML, and LilyPond, animates the
notation with a moving playhead, plays synchronized audio, and lets you scrub.
The point of the project is pedagogical: make the **mapping from pitch to staff
position** visible, by projecting one note stream three ways — a linear 88-key
view, a conventional grand staff, and a falling-notes piano roll.

Current state: a **Vite + TypeScript** project (`src/`), tested with Vitest.
`npm run dev` to run, `npm run build` to bundle, `npm test` for the suite.

> **History:** this began as a single self-contained `notation-animator.html`
> with no build step and no dependencies. As of 2026-06-16 it was transpiled to
> TypeScript on branch `ts-transpile`; the old HTML is gone. The module *seams*
> below are unchanged — TypeScript only made them compiler-checked — but the
> "single file / no build / no deps" rule has been **intentionally retired**.
> See *Project layout* and *Constraints to preserve* below.

## Project layout

```
src/
  types.ts          the contract: Note, Score, Spelling, RawNote, View, Sink, Parser, Clock
  core.ts           makeScore, activeAt, defaultSpelling
  clock.ts          makeClock → Clock
  inputs/   midi.ts  musicxml.ts  mxl.ts  lily.ts
  outputs/  staff-full.ts  staff-std.ts  staff-piano.ts  piano-roll.ts
            tonnetz.ts  combo.ts  nashville.ts  audio.ts  midi-out.ts
  live-keys.ts      held-pitch set; press/release; the live-input seam
  loop.ts           where loop edges sit and where a step lands (pure)
  sections.ts       saved sections: named bar ranges per score (pure)
  section-store.ts  sections in localStorage, keyed by score content
  sections-panel.ts the Sections dropdown (owns its DOM; hands back a range)
  main.ts           the loop + DOM wiring + VIEWS
  *.test.ts         core, clock, parsers (incl. the real sample files)
index.html          the shell; loads /src/main.ts as a module
```

`types.ts` imports nothing and is imported by everyone — that dependency shape
*is* "inputs ignorant of outputs." The `readonly` `Note`/`Score` make "outputs
never mutate the model" a compile error; `Letter`/`Accidental` are literal
unions so the grand-staff math stays exhaustive.

---

## The one idea (read this first)

There is **one immutable data structure in the middle**. Everything else is a
function that either produces it (an input) or consumes it (an output). Inputs
don't know about outputs. Outputs don't know about inputs. Neither knows about
the clock. You can delete any edge without touching the others.

This is the whole design. If a change makes you reach across two modules at
once, the change is wrong — push the complexity *inside* one module instead.
Keep the middle dumb.

```
   INPUTS                  CORE MODEL                OUTPUTS
 MIDI file ──parse──┐                          ┌──▶ StaffFull  (linear, 88-key)
 MusicXML  ──parse──┼──▶  score = note[] ──────┼──▶ StaffStd   (grand staff)
 LilyPond  ──parse──┘     (sorted by onset)    ├──▶ PianoRoll  (falling notes)
                                               ├──▶ AudioOut   (WebAudio)
                                               └──▶ MidiOut    (Web MIDI out)
                              ▲
                              │ reads now()
                        ┌─────────────┐
                        │    CLOCK    │  the only moving part
                        └─────────────┘
```

---

## The core type

```js
note = {
  pitch:    int,            // MIDI number 0–127 — the unambiguous physical truth
  spelling: {letter, acc},  // e.g. {letter:"C", acc:"#"} — the NOTATION choice
  onset:    float,          // seconds from start (already tempo-resolved)
  duration: float,          // seconds
}
score = { notes: note[], duration: float }   // notes sorted by onset
```

Two facts about pitch are kept **deliberately separate**:

- `pitch` is the physical key. Drives audio and the linear staff. Unambiguous.
- `spelling` is the notational decision. Drives the grand staff only. C♯ and D♭
  are the same `pitch` but different `spelling`, and they land on different rows
  in `StaffStd`. This separation is the reason the grand staff can exist at all.

Time is in **seconds everywhere downstream**. The core knows nothing of tempo,
ticks, or beats — those are parser-internal concerns. A parser resolves tempo
once and freezes seconds into the value.

A note may also carry an optional `staff` (1-based; MusicXML `<staff>` /
part ordinal, MIDI track) — which stream it came from. In piano music that is
the hands: lowest staff present = upper staff = right hand
(`Core.upperStaff` normalizes, since MIDI note tracks may start at 2 behind a
tempo track). Advisory, not structural: it drives the optional hand-coloring
in the stacked views and nothing else; LilyPond leaves it unset.

`Core` exposes: `makeScore(rawNotes)`, `activeAt(score, t)`,
`defaultSpelling(pitch)`. The authoritative definitions now live in
`src/types.ts` (`Note`, `Score`, `Spelling`, `RawNote`); this block is the
conceptual view.

---

## The modules (each a closed box)

| Module (file) | Signature | Role |
|---|---|---|
| `Core` (`core.ts`) | — | the model + `activeAt` query + default speller |
| `makeClock` (`clock.ts`) | `getDuration → Clock` | the one timer |
| `MidiIn` (`inputs/midi.ts`) | `bytes → score` | SMF parser (pitch only → default sharps) |
| `MusicxmlIn` (`inputs/musicxml.ts`) | `text → score` | partwise MusicXML; carries real spellings |
| `MxlIn` (`inputs/mxl.ts`) | `bytes → xml text` | unzips compressed `.mxl` → feeds `MusicxmlIn` |
| `LilyIn` (`inputs/lily.ts`) | `text → score` | LilyPond source (common subset); real spellings |
| `StaffFull` (`outputs/staff-full.ts`) | `View` | linear y = f(pitch), all 88 keys |
| `StaffStd` (`outputs/staff-std.ts`) | `View` | grand staff, y = f(diatonic step) |
| `PianoRoll` (`outputs/piano-roll.ts`) | `View` (+ `pitchAt`) | "Synthesia": x = f(pitch), notes fall onto a keyboard |
| `StaffPiano` (`outputs/staff-piano.ts`) | two `View`s (+ `setHands`) | grand staff stacked over the piano: keys-only band, or the full falling-notes roll; optional hand coloring by `staff` |
| `AudioOut` (`outputs/audio.ts`) | `Sink` (+ `liveOn/liveOff`) | WebAudio, edge-triggered voices |
| `MidiOut` (`outputs/midi-out.ts`) | `Sink` (+ `enable/disable`) | Web MIDI out, edge-triggered note-on/off |
| `LiveKeys` (`live-keys.ts`) | `press/release/releaseAll/held` | held-pitch set; the live-input seam |
| LOOP (`main.ts`) | — | ~12 lines wiring score + view fn + clock |

`View`, `Sink`, `Parser`, and `Clock` are type aliases in `types.ts` — the
prose seams above, now compiler-checked. `VIEWS` is just `Record<string, View>`.

### Clock
One `requestAnimationFrame` loop. Everything reads `now()`. **`seek()` *is*
scrubbing.** There is exactly one timer in the program — do not add a second.

The clock also owns the **playback loop** (`setLoop(range)` / `loop()`).
The wrap happens inside `now()`, so no reader ever sees a time past the loop's end, and every view and sink loops without knowing loops exist.
Where the edges may sit and where the ← → arrow keys land is `loop.ts`, a pure module; steps count in the same `Steps` practice mode does (a chord is one step), and edges sit on barlines.
`main.ts` owns ONE bar selection shared by every view: in practice mode it confines the lesson (`PracticeState.setRange`), elsewhere it is the playback loop (`clock.setLoop(Core.barTime(...))`), and `applyBars` is the only place either is written.
The bar-number boxes, the two draggable flags on the scrub bar, `[` and `]` on the bar under the playhead, and a click on a bar of the practice page all edit that selection, so they always agree.
The Loop button switches playback round the selection on and off without forgetting the bars; practice mode hides it, since a lesson always goes round its bars, but keeps the flags, and `[` `]` mark the bar the cursor stands in.
Edges snap to barlines by default, but either end may be trimmed into its bar, onto a note: Alt-drag a flag, press `{` `}` on the step under the playhead or cursor, or drag a grip on the practice page.
The isolated range on the practice page (strip or whole score, either engraver) has a pill-shaped grip at each end; dragging one moves that end to the nearest barline or gap before a note (`outputs/range-marks.ts`, hit-tested through `Scroller.gripAt` / `timeAt`), while `PracticeState.holdFocus` pins the strip's layout so the bars do not re-flow under the pointer.
A trim is stored in beats of its bar (`BarRange.fromBeat` / `toBeat`), and `Core.barTime` is the one place it becomes seconds, for the loop and the lesson alike.

**Saved sections.** A score can be broken into named runs of bars and kept (`sections.ts`).
A section is bars, not seconds, so the same one loops in the falling-notes views and confines a lesson in practice mode with no tempo to convert.
It deliberately does not remember a hand: the hand is chosen per sitting, and loading a section leaves it as it was.
Loading one is just `selectBars(range)`, the same path a dragged flag takes.
To change a saved section's span, select the bars you want (loading the section first is handy but not required) and press that row's "Use selection" in the Sections panel, which moves the section (name and all) onto the selection.
Sections are stored in localStorage per score (`section-store.ts`), keyed by a hash of the file's bytes, so a renamed file keeps its sections and a re-exported one starts afresh; progressions are keyed by structure, the demo by name.
A step parks the paused clock and sets `auditioning`, which the loop passes to the sinks in place of `playing` so the step is heard.
It's wrapped behind an interface specifically so it can be replaced with
Tone.js `Transport` (or the WebAudio clock) later without touching anything.

### MidiIn
From-scratch Standard MIDI File reader: header/track chunks, variable-length
deltas, running status, set-tempo meta → seconds, LIFO note-on/off pairing.
It only knows `pitch`, so it assigns `defaultSpelling` (sharps). **This is why
imported MIDI shows only sharps in the grand staff** — it's the MIDI→notation
spelling ambiguity living correctly in the parser, not a renderer bug.

### MxlIn
Compressed MusicXML (`.mxl`) is a ZIP archive — and the *default* export of
MuseScore, Finale, and Sibelius. `MxlIn.extract(bytes) → xml text` is a
from-scratch minimal ZIP reader (same spirit as the SMF reader): it walks the
central directory, reads the entry `META-INF/container.xml` names (falling back
to the first non-META-INF `*.xml`), and inflates deflated entries with the
browser-native `DecompressionStream("deflate-raw")` — zero dependencies. The
extracted text then goes through `MusicxmlIn.parse` like any other file.
Inflation is injectable because Node 18 lacks `deflate-raw`; tests supply
`node:zlib`. CRCs are not verified — corruption surfaces as a parse error one
step later.

### StaffFull
Simplest output, built first. Vertical position is a straight linear function of
`pitch` across A0(21)–C8(108). One hairline per white key, brighter on each C
with octave labels. Notes scroll right-to-left past a fixed playhead at 18% from
the left; the sounding note lights up. Ignores `spelling` entirely.

### StaffStd
The conventional grand staff. Vertical position is a function of **diatonic step
(letter name), not pitch number** — this is the hard, interesting one, and where
`spelling` earns its keep. Verified geometry: one "position unit" = a half
line-space, lines on even positions, spaces on odd, anchored at middle C = 0.

```
   treble lines  E4 G4 B4 D5 F5  →  +2 +4 +6 +8 +10
   bass   lines  G2 B2 D3 F3 A3  →  -10 -8 -6 -4 -2
   middle C (ledger in the gap)  →   0
```

Draws clef glyphs, accidentals from `spelling.acc`, and ledger lines for notes
above treble / below bass / in the middle gap. Octave-boundary spellings (B♯,
C♭) are handled in `octaveFor`.

### PianoRoll
The "Synthesia" view, and the proof the output seam composes: it's `StaffFull`
rotated a quarter turn. Pitch runs along the **x** axis as a literal piano
keyboard at the bottom (white keys tile evenly, black keys straddle the lower
white key's right edge at 62% width); time runs **down** the **y** axis. Notes
fall toward the keyboard, and a note's leading edge reaches the strike line (the
keyboard top) at exactly `t == onset`, then descends behind the keys. A key
glows while any note of its pitch is sounding, read from the same `activeAt`
query the staves and audio use. Like `StaffFull` it reads `pitch` only and
ignores `spelling` — the keyboard *is* the physical-key view, not the notation
view, so there's nothing to spell. Adding it touched exactly one module plus the
view toggle (a `VIEWS` lookup map) and two key-color tokens — no `Core`, parser,
audio, or clock change.

### AudioOut
A **sampled piano** (the promised "later swap," landed fully inside this
module): the Salamander Grand (Alexander Holm, CC BY), 30 mp3 recordings a
minor third apart A0–C8, bundled under `public/samples/salamander/` — no
dependency, no third-party host at runtime. A note plays the nearest sample
rate-shifted by at most one semitone; note-off is a short damper fade; a
master compressor tames chords. Samples decode lazily on `ensure()` (the
first user gesture); until each is ready — or if its fetch fails — that range
falls back to the original triangle oscillator, so sound is never silently
broken. **Edge-triggered**: each frame it diffs the current `activeAt` set
against playing voices and starts/stops on the transitions. Reads the same
`activeAt` query the staves use.

### The loop
```js
clock.onFrame((t) => {
  view(svg, score, t);                       // view = StaffFull | StaffStd | PianoRoll .render
  AudioOut.at(score, t, clock.isPlaying());
  // update scrub bar + time readout
});
```
Toggle = swap `view`. New input = swap how `score` is built. New clock = swap
`makeClock`. Nothing reaches across.

---

## How to extend (and the test each change must pass)

The test for any change: **does it touch exactly one module?** If yes, the seam
is real and you're working with the architecture. If no, stop and reconsider.

**MusicXML input** — *done.* `MusicxmlIn.parse(string) → score` parses partwise
files with the browser's `DOMParser`: a per-part seconds cursor honoring
`<divisions>`, `<sound tempo>`, `<chord>`, `<backup>`/`<forward>`, and `<tie>`
(tied notes merge into one). Because MusicXML states each note's spelling
(`<step>` + `<alter>`), real flats and naturals flow straight through to
`StaffStd` with zero renderer changes — exactly as the seam promised. The file
loader sniffs content (`MThd` magic → MIDI, `PK` → zipped `.mxl` via `MxlIn`,
else MusicXML text), so one "Load file" button feeds all of them, and a UTF-16
byte-order mark switches the text decoder (some notation software exports
UTF-16). Not yet handled (isolated, like every limitation): timewise scores —
rejected with a message.

**LilyPond input** — *done, but not via the route this doc originally
suggested.* Routing LilyPond → MusicXML needs the `lilypond` binary, a native
dependency that breaks "single file, no deps, opens in Chrome." So `LilyIn`
parses LilyPond **source** directly in-browser → `score`. (The old warning still
holds for the *engraved SVG/PDF* — that has no note→time link — but source text
carries full timing, so parsing it is fine.) Like MusicXML, LilyPond states each
note's spelling (`cis` = C♯, `des` = D♭), so flats/sharps reach `StaffStd`
unchanged. Supported subset: `\relative`/absolute octaves, Dutch note names with
`is`/`es` (+ doubles, `as`/`es` shorthands), durations with dots and the
inherit-previous rule, chords `< >`, rests `r`/`s`, ties `~`, simultaneous
`<< >>` (brace each voice), and `\tempo \time \key \clef \new \score`; with
`\header`/`\layout`/`\paper`/`\midi`/`\version` skipped. The file loader routes
`.ly` (and lily-keyword text) here, XML-looking text to `MusicxmlIn`, `MThd` to
`MidiIn`. See `sample-lily.ly`.

**Better MIDI spelling** — key-context speller inside `MidiIn` only. Changes
which `spelling` values get frozen in; renderers untouched.

**Better audio** — *done.* The oscillator became a sampled piano inside
`AudioOut` only — same `at()` signature, no other module touched, exactly as
this section promised. The next audio step would be velocity/dynamics, which
first needs velocity in the model (`Note` has none today).

**Swap the clock for Tone.js** — implement the `{now, play, pause, seek,
isPlaying, onFrame}` interface backing onto `Tone.Transport`. The loop and every
output stay as-is. Beware: this introduces an audio-thread clock, so make sure
`now()` stays the single source of truth — do not let Tone schedule audio on a
*separate* timeline from the visual cursor. One clock, every view, always.

**Piano-roll output** — *done.* `PianoRoll.render(svg, score, t)`, a falling-
notes keyboard view; see the module section above. It slotted into the existing
output seam with no cross-module changes, exactly as this section promised.

**Live MIDI input** — *next up, designed, not yet built.* A MIDI controller is a
second driver of the **existing `LiveKeys` seam** — the pointer keyboard in
`main.ts` already proved it: an input surface that calls `LiveKeys.press(pitch)`
/ `LiveKeys.release(pitch)` and touches nothing else. `AudioOut` already sounds
live voices and `PianoRoll` already glows `held()` keys, so neither changes. And
because MIDI isn't tied to drawn geometry (unlike the pointer hit-test), it
works in *every* view.

Scope it tightly to **performance feedback only** (sound + key glow). Recording
played notes *into* the immutable `score` is the deferred mutable-model step
(`Live_in.stream : midi_event → score → score`, append-only) — do **not**
conflate the two; live feedback must never mutate `score`.

Plan:
- New `src/live-midi.ts` owning a pure `decode(data: Uint8Array): MidiNoteEvent
  | null` (note-on / note-off, with note-on-vel-0 ⇒ off; everything else ⇒
  `null`) and a small `{ enable(): Promise<MIDIInput[]>; disable(): void }`
  surface. `enable()` does `navigator.requestMIDIAccess({sysex:false})`, attaches
  `onmidimessage` to every input (re-attaching on `statechange` for hotplug),
  and routes decoded events to `LiveKeys`. `disable()` detaches and calls
  `LiveKeys.releaseAll()` (panic / stuck-note guard).
- `MidiNoteEvent` stays **private to `live-midi.ts`** (like `MidiEvent` in
  `midi.ts`); it is an input detail, not part of the `types.ts` model contract.
- Wiring: one `Enable MIDI` button in `index.html` (behind a user gesture —
  `requestMIDIAccess` prompts for permission and needs a secure context), whose
  handler calls `AudioOut.ensure()` then `LiveMidi.enable()`.
- **Types/deps:** Web MIDI is not in `lib.dom.d.ts`, so add `@types/webmidi`
  (types only, zero runtime) and list it in `tsconfig` `types`. Prefer the raw
  Web MIDI API over the `webmidi`/WEBMIDI.js runtime dependency — decoding a
  3-byte live message is simpler than the SMF reader (no var-length deltas, no
  running status), and that matches the from-scratch-parser spirit.
- **Velocity → loudness** is deliberately dropped at first; it's a later,
  isolated change inside `AudioOut.liveOn(pitch, velocity)` with no decoder or
  `LiveKeys` change.

**MidiOut output** (done) — `outputs/midi-out.ts`, a `Sink` that emits Web MIDI
note-on/off instead of drawing, edge-triggered exactly like `AudioOut`. It opens
its own `MIDIAccess` (outputs stay ignorant of inputs, so it never reaches into
`live-midi.ts`), picks the first output port, and re-picks on `statechange`
(hotplug). The frame loop calls `MidiOut.at` every frame; the `Enable MIDI out`
button just opens the port. The pure `encode(kind, pitch, vel)` helper is the
mirror of live-midi's `decode()` and is what's unit-tested. Known gaps, both
deliberate and isolated: fixed velocity 100 (the velocity→loudness note above
applies here too — a one-line change in `encode`'s default), emits on channel 1
only, and per-`Note` tracking means two same-pitch notes overlapping can cut each
other's tail (one MIDI pitch per channel can't sound twice anyway).

---

## Known limitations (all intentional, all isolated)

- Imported MIDI shows only sharps in the grand staff (parser default speller).
  Load the same piece as MusicXML to get correct flats/naturals.
- MusicXML: timewise scores are rejected (`.mxl` is now unwrapped by `MxlIn`);
  double accidentals collapse to a single glyph (staff position is by letter
  anyway); tempo is seeded per part from the first `<sound tempo>`, so a
  mid-piece tempo change that only appears in one part won't propagate to the
  others.
- LilyPond: only the subset above. Ignored/unsupported — tuplets (`\times`),
  `\repeat`, grace notes, lyrics, and **named-variable indirection** (the inline
  music definition is what gets parsed; `melody = …` then `\melody` is not
  resolved). Relative octaves across `<< >>` use the block's entry reference per
  voice; brace each voice. Double accidentals collapse to one glyph (as MusicXML).
- Audio plays one flat dynamic: `Note` carries no velocity, so every note
  sounds at the same level (single-velocity-layer samples, gain 0.5). The
  first notes after page load may sound as triangle-wave fallback for a
  moment while samples decode.
- Scrubbing fast re-triggers voices as the active set churns; can sound busy.
  Lives entirely in `AudioOut`; smooth there if it matters.
- `StaffStd` has no key-signature rendering and no beaming — noteheads only.
- `PianoRoll` keyboard band is a fixed 96px; on very short viewports it eats
  the fall area. Ignores `spelling` by design (it's the physical-key view), so
  enharmonics share a key — that's correct, not a gap.
- Web MIDI *live input* is not wired yet — but the seam is built and proven: a
  pointer-driven playable keyboard already routes through `LiveKeys` (sound +
  key glow). Web MIDI just needs to feed the same `press/release` calls; see
  *Live MIDI input* under "How to extend." Recording into the `score`
  (`Live_in.stream : midi_event → score → score`, append-only) remains a
  separate, deferred step.
- Browser support: built/tested for Chrome. Web MIDI and the audio path are
  weakest on Safari/Firefox.

---

## Constraints to preserve

- *(Retired 2026-06-16: the original "single file, no build, no deps" rule.
  Now a Vite + TS project.)* The surviving spirit: **stay lean.** Reach for a
  dependency only with a strong reason, and when you do, isolate it behind one
  module's interface (e.g. `@types/webmidi` for live MIDI, a sampler inside
  `AudioOut`, Tone.Transport behind `Clock`). No network at runtime.
- One timer. One source-of-truth clock. Derive everything from `now()`.
- Inputs ignorant of outputs, outputs ignorant of inputs, both ignorant of the
  clock. The moment two modules need to know about each other, the design has
  drifted — fix the seam, don't paper over it.
- Simplicity over cleverness. When something feels complex, it belongs inside
  one module, never spread across the boundaries.