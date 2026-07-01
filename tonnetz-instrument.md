# Tonnetz Instrument — playing the lattice with a gamepad

This document specifies a lattice-native instrument for the Tonnetz view, and breaks it into small, independent tasks.
Each task is written so a fresh Sonnet session can complete it after reading only the files listed in that task's **Context budget**.
Do the tasks in order; each one builds on the previous, but none requires holding the whole design in context.

## Why this exists

The Tonnetz today is a passive view.
It reads `LiveKeys.held()` and `Core.activeAt(score, t)` and lights up whatever pitch classes are sounding (`src/outputs/tonnetz.ts:83-86`).
It has no play verbs of its own.

The existing `perfectoMapping` (`src/gamepad-perfecto.ts`) already drives chords into `LiveKeys`, so a gamepad *can* light the Tonnetz today — but it does so in the Nashville degree model (I, ii, V…), not the lattice model.
This instrument is the lattice-native alternative: the player walks a cursor across the triangular lattice using neo-Riemannian transforms and lattice steps, exactly the "walk across shared edges" the Tonnetz header comment describes.

The design mirrors the existing Perfecto stack so it slots into the same seams:

```
TonnetzState  ->  LiveKeys  ->  (AudioOut, MidiOut, Tonnetz glow)
```

`TonnetzState` is the lattice-native twin of `PerfState` (`src/perf-state.ts`).
It owns a cursor (a current triad) and pushes MIDI notes through `LiveKeys`, so audio, MIDI-out, and the Tonnetz glow all come for free — nothing new reaches across a module boundary.

## Bindings will become customizable

The button-to-function map is not fixed.
We will eventually let the player rebind which controller button does what, so the design treats the binding as **data over a stable action vocabulary**, not as hardcoded button handling.

The vocabulary is the set of named things the instrument can do — each corresponds to a `TonnetzState` verb:

| Action id | Effect | Trigger kind |
|---|---|---|
| `transform.P` / `transform.L` / `transform.R` | `TonnetzState.apply(t)` | momentary (on button down) |
| `step.fifthUp` / `step.fifthDown` | `TonnetzState.step(...)` | momentary |
| `step.majThirdUp` / `step.majThirdDown` | `TonnetzState.step(...)` | momentary |
| `step.minThirdUp` / `step.minThirdDown` | `TonnetzState.step(...)` | momentary (optional) |
| `octave.up` / `octave.down` | `TonnetzState.nudgeOctave(±1)` | momentary |
| `home` | `TonnetzState.home()` | momentary |
| `sustain` | `trigger()` on down, `release()` on up | hold (both edges) |

A **binding** is then just `Record<buttonIndex, ActionId>`.
Task 3 ships a `DEFAULT_BINDINGS` table plus a generic dispatcher, so the later customization layer (Task 6) only has to swap that table — no handler code changes.
Keep this shape even though the customization UI does not exist yet; a hardcoded `switch` on button index would have to be torn out to add it.

## Shared reference — the lattice math

Every task below can rely on these facts without re-deriving them.
They are all consistent with `src/outputs/tonnetz.ts`.

**Coordinates.**
A cell is `(col, row)`.
Its pitch class is `pitchClassAt(col, row) = (((7*col + 4*row) % 12) + 12) % 12` — east is +7 (a fifth), up is +4 (a major third).

**A cursor is a triangle.**
`{ col, row, orient: "up" | "down" }` uniquely names one triangle.
The up-triangle is major; the down-triangle is minor.
Cell roles match `tonnetz.ts:138-139` exactly:

```
up-triangle (col,row)   -> root = (col, row)      third = (col, row+1)    fifth = (col+1, row)      [major]
down-triangle (col,row) -> root = (col, row+1)    third = (col+1, row)    fifth = (col+1, row+1)    [minor]
```

Sanity check: up `(0,0)` has root pc 0, third pc 4, fifth pc 7 — a C major triad `{0,4,7}`.

**Neo-Riemannian transforms.**
Each crosses one shared edge to the neighbouring triangle, keeps two common tones, and flips quality.
This table is derived and involution-checked (applying a transform twice returns to the start):

```
from up  (col,row):   P -> down (col,   row-1)     L -> down (col,   row)     R -> down (col-1, row)
from down(col,row):   P -> up   (col,   row+1)     L -> up   (col,   row)     R -> up   (col+1, row)
```

Meaning, starting from C major = up `(0,0)`:
- `P` -> C minor (parallel: keep root + fifth, move third).
- `L` -> E minor (leading-tone: keep third + fifth, move root).
- `R` -> A minor (relative: keep root + third, move fifth).

**Lattice translations.**
These preserve orientation and quality and slide the whole triad:

```
fifth up     (+7):  col + 1
fifth down   (-7):  col - 1
majThird up  (+4):  row + 1
majThird down(-4):  row - 1
minThird up  (+3):  col + 1, row - 1     (optional; it is the diagonal = fifth - majThird)
minThird down(-3):  col - 1, row + 1     (optional)
```

**Voicing a cursor to MIDI.**
Given the three role pitch classes and an `octave`, place a tight root-position triad:

```
rootMidi  = (octave + 1) * 12 + rootPc
thirdMidi = rootMidi + ((thirdPc - rootPc + 12) % 12)
fifthMidi = rootMidi + ((fifthPc - rootPc + 12) % 12)
```

MIDI convention: middle C = C4 = 60, hence `(octave + 1) * 12` (same as `perfecto.ts:168`).

---

## Task 1 — Pure lattice core

**Goal.**
Create `src/harmony/tonnetz-lattice.ts`: the pure, DOM-free, audio-free math for cursors, transforms, translations, and voicing.
This is the only task with non-trivial math, so it is isolated and tested hard.

**Context budget.**
Read `src/outputs/tonnetz.ts:37-52` (for `pitchClassAt`, `triadName`, cell roles) and the **Shared reference** section above.
Nothing else is required.

**Implementation.**
Export:

```ts
export type Orient = "up" | "down";
export interface Cursor { col: number; row: number; orient: Orient; }
export type Transform = "P" | "L" | "R";
export type LatticeStep =
  | "fifthUp" | "fifthDown" | "majThirdUp" | "majThirdDown"
  | "minThirdUp" | "minThirdDown";

export function triadCells(c: Cursor): { root: [number, number]; third: [number, number]; fifth: [number, number] };
export function triadPitchClasses(c: Cursor): { root: number; third: number; fifth: number };
export function transform(c: Cursor, t: Transform): Cursor;
export function translate(c: Cursor, step: LatticeStep): Cursor;
export function voiceTriad(c: Cursor, octave: number): number[];   // MIDI, sorted ascending
export function cursorLabel(c: Cursor): string;                    // reuse triadName, e.g. "C" / "Am"
```

Keep it pure: import only `pitchClassAt` and `triadName` from `../outputs/tonnetz`, or inline the two-line formulas if that avoids a circular import (check the import direction — `tonnetz.ts` must not end up importing this file).

**Tests.**
Add `src/harmony/tonnetz-lattice.test.ts`:
- Up `(0,0)` pitch classes are `{root:0, third:4, fifth:7}`; `voiceTriad` at octave 4 is `[60, 64, 67]`.
- `transform` is an involution for every start and every `P`/`L`/`R` (applying twice is identity).
- From up `(0,0)`: `P` -> C minor pcs `{0,3,7}`, `L` -> E minor `{4,7,11}`, `R` -> A minor `{9,0,4}`.
- Each transform preserves exactly two of the three pitch classes (common tones).
- `translate` deltas match the table (e.g. `fifthUp` raises every pitch class by 7 mod 12; `majThirdUp` by 4).

**Done when.**
`npm test` passes for the new test file and the math matches the assertions above.

---

## Task 2 — TonnetzState module

**Goal.**
Create `src/tonnetz-state.ts`: the live cursor state and the trigger/release plumbing, the lattice-native twin of `PerfState`.

**Context budget.**
Read `src/perf-state.ts` (the pattern to mirror), `src/live-keys.ts` (the sink), and the API of Task 1.
Do not re-read `tonnetz.ts`.

**Implementation.**
Hold a single mutable `cursor` (default up `(0,0)` = C major) and an `octave` (default 4), plus a `sounding: number[]` of the exact MIDI notes currently pressed — same three-field shape as `PerfState`.
Mirror `PerfState.trigger`'s diff-reconcile loop so re-sounding a transformed chord keeps common tones down (no re-attack) and releases only what changed.

Export:

```ts
export const TonnetzState = {
  trigger,            // voice current cursor, diff into LiveKeys, return the notes
  release,            // lift current chord (keep cursor)
  isSounding,         // sounding.length > 0
  apply,              // (t: Transform) => void   — move cursor; re-sound if already sounding
  step,               // (s: LatticeStep) => void — translate cursor; re-sound if sounding
  nudgeOctave,        // (delta: number) => void  — clamp 0..8 like PerfState.setOctave; re-sound if sounding
  home,               // reset cursor to up (0,0); re-sound if sounding
  snapshot,           // { cursor, octave, sounding } — for the future cursor-render task
};
```

`apply`, `step`, `nudgeOctave`, and `home` change the cursor and then re-sound **only if** a chord is currently sounding (the `resoundIfHeld` pattern from `gamepad-perfecto.ts:53`); they never start sound on their own.

**Tests.**
Add `src/tonnetz-state.test.ts` (mirror `perf-state.test.ts` if it exists):
- `trigger` on the default cursor presses `[60,64,67]` into `LiveKeys`.
- `apply("P")` while sounding leaves the common tones (root + fifth) held and swaps only the third in `LiveKeys.held()`.
- `release` lifts exactly the sounding notes and leaves `LiveKeys.held()` empty.
- `nudgeOctave` clamps to `0..8`.

**Done when.**
`npm test` passes and `LiveKeys.held()` reflects the diffs above.

---

## Task 3 — Gamepad mapping

**Goal.**
Create `src/gamepad-tonnetz.ts`: a `GamepadMapping` that binds controller buttons to `TonnetzState`, mirroring `src/gamepad-perfecto.ts`.

**Context budget.**
Read `src/gamepad-perfecto.ts` (the pattern), `src/live-gamepad.ts:20-41` (the `GamepadFrame` / `GamepadMapping` interfaces), the **Bindings will become customizable** section above, and the API of Task 2.

**Structure it as data, not a switch.**
Define the action vocabulary and a default binding table, then a generic `onFrame` that looks up each pressed/released button in the table and dispatches:

```ts
export type ActionId =
  | "transform.P" | "transform.L" | "transform.R"
  | "step.fifthUp" | "step.fifthDown" | "step.majThirdUp" | "step.majThirdDown"
  | "step.minThirdUp" | "step.minThirdDown"
  | "octave.up" | "octave.down" | "home" | "sustain";

// The one place each action's effect lives. `sustain` is the only hold action:
// it reacts to both edges; every other action fires on down and ignores up.
const CATALOG: Record<ActionId, { kind: "momentary" | "hold"; down(): void; up?(): void }> = { /* ... */ };

export type Bindings = Record<number, ActionId>;   // gamepad button index -> action

export const DEFAULT_BINDINGS: Bindings = {
  7: "sustain",                                     // RT
  0: "transform.P", 1: "transform.R", 2: "transform.L", 3: "home",   // A B X Y
  12: "step.majThirdUp", 13: "step.majThirdDown",   // d-pad up / down
  15: "step.fifthUp", 14: "step.fifthDown",         // d-pad right / left
  4: "octave.down", 5: "octave.up",                 // LB / RB
};
```

`onFrame` should, for each `f.downs`, look up the bound action and call its `down()`; for each `f.ups`, call `up()` only for `hold` actions.
The active `Bindings` is a module-level `let` initialised to `DEFAULT_BINDINGS`; expose a `setBindings(b: Bindings)` setter now (Task 6 uses it) even though nothing calls it yet.

**Design intent.**
Sustain-to-sound: hold the `sustain` button (RT by default) to ring the current cursor triad, then walk the lattice while it sustains.
This decouples "where the cursor is" from "is it sounding", which the cursor-render task (Task 5) then makes visible.

`AudioOut.ensure()` must be called when the `sustain` action fires `down()`, exactly as `gamepad-perfecto.ts:58` unlocks audio on a user gesture.
`reset()` must call `TonnetzState.release()` so no chord is left stuck when the mapping is swapped out or disabled.

**Tests.**
Add `src/gamepad-tonnetz.test.ts` (mirror `gamepad-perfecto.test.ts`):
- With `DEFAULT_BINDINGS`: sustain-button down triggers; a following P-button down re-sounds the P-transformed chord; sustain-button up releases.
- A momentary action ignores its button-up edge (no double-fire).
- `setBindings` remaps a button and the new binding dispatches the new action.
- `reset()` releases any held chord.
- Feed synthetic `GamepadFrame`s (the tests should not need a real gamepad).

**Done when.**
`npm test` passes.

---

## Task 4 — Wire into main.ts

**Goal.**
Swap in `tonnetzMapping` when the Tonnetz view is active, the same "swap a reference with the view" move Perfecto uses.

**Context budget.**
Read `src/main.ts` (find where the view toggle calls `LiveGamepad.setMapping`, around the Nashville/perfecto branch) and the export from Task 3.

**Implementation.**
Where `main.ts` currently chooses `perfectoMapping` for the Nashville view and `keysMapping` otherwise, add a branch that selects `tonnetzMapping` when the active view is the Tonnetz (and, if it applies, the Combo view).
Change nothing else about the toggle.

**Done when.**
Selecting the Tonnetz view and holding RT on a connected gamepad sounds a chord and lights the lattice; A/B/X walk it; the view swap still releases cleanly (no stuck notes across a switch).
Verify by running the app (`/run`) and watching the lattice respond, not just by unit tests.

---

## Task 5 (optional) — Render the cursor on the lattice

**Goal.**
Draw the current cursor triangle distinctly even when it is silent, so the player can see where they are before they sound it.

**Context budget.**
Read `src/outputs/tonnetz.ts` (the whole file — this task edits shared render code) and `TonnetzState.snapshot()` from Task 2.

**Implementation.**
In `tonnetz.ts` `markup`, after the sounding-triad fills, overlay the cursor triangle from `TonnetzState.snapshot().cursor` with a distinct outline (e.g. a stroked polygon in `var(--note-lit)`, no fill) so it reads as a selection rather than a sounding chord.
Keep the existing lit/sounding logic untouched; the cursor is an additive layer.
Because `tonnetz.ts` is also used by the Combo view via `markup`, confirm the cursor renders there too and does not spill past the clip.

**Design note.**
This is the one task that couples the view to `TonnetzState`.
Until now the view imported nothing but `Core`, `LiveKeys`, and `types`; adding a `TonnetzState` import is a deliberate new dependency, so keep it a single read of `snapshot()` and document the boundary in the file header comment.

**Done when.**
The cursor triangle is visible and distinct from sounding triads in both the full Tonnetz view and the Combo view, verified by running the app.

---

## Task 6 (future) — customizable bindings

**Goal.**
Let the player rebind controller buttons to actions at runtime, and persist the choice.

**Why it is cheap by now.**
Task 3 already made the binding data (`Bindings` = `Record<buttonIndex, ActionId>`) over a fixed action vocabulary (`ActionId`), with a `setBindings` setter and a single dispatch path.
So this task adds no handler code — it only produces a `Bindings` object from somewhere and calls `setBindings`.

**Likely pieces (not yet specified in detail).**
- A persistence read/write for the binding table (localStorage is consistent with the app's other client-only state).
- A small "listen for the next button press" capture flow so the player can assign a button to a selected action by pressing it.
- A view that lists the `ActionId` catalog with each action's currently-bound button, reusing the design language already in `nashville.ts`.

**Design note.**
Keep the action vocabulary (`ActionId` and `CATALOG`) as the single source of truth.
The customization view should enumerate `CATALOG`, never hardcode its own list, so a new action becomes bindable the moment it is added to the catalog.

---

## Order and independence

Tasks 1 -> 2 -> 3 -> 4 are a strict chain; each depends only on the one before.
Task 5 depends on Task 2 (for `snapshot()`) but is otherwise independent and optional — the instrument is fully playable after Task 4.
Task 6 depends on Task 3's `Bindings` / `setBindings` seam and is deferred; the default binding is fully playable without it.
Every task ships its own tests, so each can be reviewed and merged on its own.
