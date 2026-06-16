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
  inputs/   midi.ts  musicxml.ts  lily.ts
  outputs/  staff-full.ts  staff-std.ts  piano-roll.ts  audio.ts
  live-keys.ts      held-pitch set; press/release; the live-input seam
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
                                               └──▶ (MidiOut, later)
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
| `LilyIn` (`inputs/lily.ts`) | `text → score` | LilyPond source (common subset); real spellings |
| `StaffFull` (`outputs/staff-full.ts`) | `View` | linear y = f(pitch), all 88 keys |
| `StaffStd` (`outputs/staff-std.ts`) | `View` | grand staff, y = f(diatonic step) |
| `PianoRoll` (`outputs/piano-roll.ts`) | `View` (+ `pitchAt`) | "Synthesia": x = f(pitch), notes fall onto a keyboard |
| `AudioOut` (`outputs/audio.ts`) | `Sink` (+ `liveOn/liveOff`) | WebAudio, edge-triggered voices |
| `LiveKeys` (`live-keys.ts`) | `press/release/releaseAll/held` | held-pitch set; the live-input seam |
| LOOP (`main.ts`) | — | ~12 lines wiring score + view fn + clock |

`View`, `Sink`, `Parser`, and `Clock` are type aliases in `types.ts` — the
prose seams above, now compiler-checked. `VIEWS` is just `Record<string, View>`.

### Clock
One `requestAnimationFrame` loop. Everything reads `now()`. **`seek()` *is*
scrubbing.** There is exactly one timer in the program — do not add a second.
It's wrapped behind an interface specifically so it can be replaced with
Tone.js `Transport` (or the WebAudio clock) later without touching anything.

### MidiIn
From-scratch Standard MIDI File reader: header/track chunks, variable-length
deltas, running status, set-tempo meta → seconds, LIFO note-on/off pairing.
It only knows `pitch`, so it assigns `defaultSpelling` (sharps). **This is why
imported MIDI shows only sharps in the grand staff** — it's the MIDI→notation
spelling ambiguity living correctly in the parser, not a renderer bug.

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
WebAudio triangle-wave oscillator pool. **Edge-triggered**: each frame it diffs
the current `activeAt` set against playing voices and starts/stops on the
transitions. Reads the same `activeAt` query the staves use. Utilitarian sound
by design — a sampler/soundfont is a later swap, fully contained here.

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
loader sniffs content (`MThd` magic → MIDI, else MusicXML text), so one "Load
file" button feeds both. Not yet handled (isolated, like every limitation):
compressed `.mxl` (a zip) and timewise scores — both rejected with a message.

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

**Better audio** — swap the oscillator for a sampler/soundfont inside
`AudioOut` only. Same `at()` signature.

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

**Add a MidiOut output** — new `Sink` (`(score, t, playing) → void`) module that
emits Web MIDI note-on/off instead of drawing. Same edge-triggered shape as
`AudioOut`.

---

## Known limitations (all intentional, all isolated)

- Imported MIDI shows only sharps in the grand staff (parser default speller).
  Load the same piece as MusicXML to get correct flats/naturals.
- MusicXML: compressed `.mxl` and timewise scores are rejected; double
  accidentals collapse to a single glyph (staff position is by letter anyway);
  tempo is seeded per part from the first `<sound tempo>`, so a mid-piece tempo
  change that only appears in one part won't propagate to the others.
- LilyPond: only the subset above. Ignored/unsupported — tuplets (`\times`),
  `\repeat`, grace notes, lyrics, and **named-variable indirection** (the inline
  music definition is what gets parsed; `melody = …` then `\melody` is not
  resolved). Relative octaves across `<< >>` use the block's entry reference per
  voice; brace each voice. Double accidentals collapse to one glyph (as MusicXML).
- Audio is a plain triangle wave — correct timing, plain sound.
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