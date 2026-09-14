# Hidden Coupling Audit

An audit of `harmonicland` for what Jimmy Koppel calls *hidden coupling* and *errors of modular reasoning*: places where one module's correctness silently depends on another module's implementation, in a way no interface states and no compiler enforces.

The framing throughout: read this codebase as if it were OCaml, where a `.mli` file is a real contract the compiler holds you to.
Nearly every file here opens with a header comment claiming that modules connect only through `types.ts` and that "nothing reaches across."
Several of those claims are false, and the falsehoods cost real, reproducible bugs.

**Method.** All ~4k lines of source were read, then throwaway probe tests were written to confirm each suspect empirically rather than assert it from reading.
The probes are noted inline as "confirmed."
At time of audit: all 130 existing tests pass and `tsc --noEmit` is clean — every violation below is invisible to the current suite.

---

## Tier 1 — the signature lies, and it costs you real bugs

### 1. `View` claims to be a function of `(score, t)`. Five of eight aren't.

[types.ts:58](src/types.ts#L58) declares `type View = (svg, score, t) => void`, and [main.ts:55](src/main.ts#L55) states it outright: *"the per-frame projection — pure function of (score, now())"*.

But [nashville.ts:79](src/outputs/nashville.ts#L79) is `render: View = (svg) => {...}` reading `PerfState.snapshot()`.
[tonnetz.ts:159](src/outputs/tonnetz.ts#L159) reads `TonnetzState.snapshot()`.
[piano-roll.ts:70](src/outputs/piano-roll.ts#L70) and [staff-full.ts:62](src/outputs/staff-full.ts#L62) read `LiveKeys.held()`.

The real signature is `svg -> score -> float -> LiveState -> unit`, with `LiveState` passed invisibly through module-level mutable globals.
In OCaml this is a functor that should have been written `module Make (S : LIVE_STATE) : VIEW` and instead reaches for a global `ref`.

**Cost:** you cannot snapshot-test a view, render two scores side by side, or render off-screen.
There is no test in the suite that renders Nashville or Tonnetz deterministically, because there is no way to.

**Suggested fix.**
Make the ambient state a parameter — the structural change described at the end of this document.
Widen the frame to carry it, and declare the snapshot types in `types.ts` so that file keeps its "imports nothing" property:

```ts
// types.ts
export interface LiveSnapshot {
  held: ReadonlySet<Pitch>;
  perf: PerfSnapshot;      // moved here from perf-state.ts
  tonnetz: TonnetzSnapshot; // moved here from tonnetz-state.ts
}
export interface Frame { score: Score; t: number; live: LiveSnapshot; }
export type View = (svg: SVGSVGElement, f: Frame) => void;
```

`main.ts`'s `clock.onFrame` assembles one `LiveSnapshot` per frame and hands the same value to every consumer, which also removes the current hazard that two views can observe different `LiveKeys` states within one frame.

If you want the testability before the type change, the cheap intermediate step is to push the state read to the outermost function of each view: give `nashville.ts` and `tonnetz.ts` an exported pure `markup(W, H, snapshot)` (as `piano-roll.ts` and `staff-std.ts` already have) and let `render` be the four-line wrapper that calls `PerfState.snapshot()` and delegates.
That alone makes both views snapshot-testable today and turns the eventual `Frame` migration into a change of one line per view.

### 2. `View` is defeated by reference-identity dispatch — and the real interface is unwritten

[main.ts:269-274](src/main.ts#L269-L274):

```ts
const rollRegion = () =>
  view === PianoRoll.render ? undefined
  : view === Combo.render ? Combo.rollRegion(svg)
  : view === StaffPiano.renderKeys ? StaffPiano.keysRegion(svg)
  : ...
```

A `View` is nominally just its type, but `main.ts` requires two things the type never mentions: **physical identity** with a specific module export, and a **companion `region` function**.

Consequences:

- Add a ninth view and pointer input silently does nothing. No error.
- Wrap any view in a decorator (memoize, log, profile) and hit-testing silently breaks.
- [staff-piano.ts:68-69](src/outputs/staff-piano.ts#L68-L69) produces both flavors from the same `stacked(...)` factory. They are distinct closures today only by luck of two separate calls; hoist that call and two branches collapse into one.

Worse, the same fact — *which views have a playable keyboard and where* — is now stated twice, in the `VIEWS` record and in this chain, kept in sync by hand.
The OCaml shape is a `VIEW` module type with `val keyboard_region : svg -> region option`, which forces all eight views to answer.

**Suggested fix.**
Make the view a record with a required region member, so the fact is stated once and every view is compelled to answer it:

```ts
// types.ts
export interface ViewModule {
  render: View;
  /** Where a pointer-playable keyboard sits in this view.
   *  `null` = this view has none; `undefined` = the whole svg. */
  keyboardRegion(svg: SVGSVGElement): Region | null | undefined;
}
```

`VIEWS` becomes `Record<string, ViewModule>`, `main.ts` holds `let view: ViewModule` and calls `view.render(...)` / `view.keyboardRegion(svg)`, and the whole identity chain at [main.ts:269-274](src/main.ts#L269-L274) is deleted.
Keep `keyboardRegion` **required**, not optional with a default — the point is that a ninth view cannot compile without answering the question.
The five views with no keyboard get `keyboardRegion: () => null`, which is a deliberate one-line declaration rather than an omission.

This also removes the `stacked(...)` closure-identity trap in passing: `renderKeys` and `renderRoll` become two `ViewModule` values that each carry their own region function, so hoisting or memoizing the shared factory can no longer collapse the dispatch.

### 3. `LiveKeys` is a set of ints, but three clients treat it as voice ownership

**Confirmed: silent-note bug.**
This is the load-bearing one.

[live-keys.ts:36](src/live-keys.ts#L36) exposes `press / release / releaseAll / held`.
Nothing in that interface can express *"these pitches are mine."*
Yet [perf-state.ts:56](src/perf-state.ts#L56) and [tonnetz-state.ts:25](src/tonnetz-state.ts#L25) each keep a **private mirror** (`sounding`) of what they believe they pressed, and diff against it to preserve common tones.

Meanwhile `LiveKeys.releaseAll()` is called from three places that know nothing about those mirrors: [main.ts:244](src/main.ts#L244) on every view change, `keysMapping.reset()` at [live-gamepad.ts:73](src/live-gamepad.ts#L73), and `LiveMidi.disable()`.

Verified repro: hold `1` in the Nashville view so a chord sounds, change the view dropdown so `releaseAll()` fires, and `PerfState.isSounding()` still returns `true`.
Nudge the joystick and `trigger()` diffs against the stale mirror, re-presses **nothing**, and the chord is silent forever while Nashville draws it as sounding and Tonnetz shows no lit nodes.

The same hazard exists in `TonnetzState`: after a `releaseAll`, an `L` transform re-presses only the one changed voice — measured `held.size < 3`.

The aliasing case has no mirror at all.
Pointer-press C4 while a Perfecto chord holds C4, then lift the pointer: `release` deletes it from the shared set and the chord loses a note.
There is no refcount, and the set-of-ints interface makes one inexpressible.
OCaml's move is `press : pitch -> voice` returning an abstract handle, with `release : voice -> unit`.

**Suggested fix.**
Two changes, one immediate and one structural.

*Hotfix (ship first, it is three lines).*
Every `releaseAll()` caller must release through the owner, not around it.
In [main.ts:244](src/main.ts#L244), replace the bare `LiveKeys.releaseAll()` with `PerfState.release(); TonnetzState.release(); LiveKeys.releaseAll();` and do the same in `keysMapping.reset()` and `LiveMidi.disable()`.
That closes the confirmed silent-note bug, but it does not close the class: it re-states in three call sites a fact the interface still cannot express, and it does nothing for the aliasing case.

*Real fix: make ownership a value.*
Hand out an opaque handle per press and refcount pitches inside `LiveKeys`:

```ts
export interface Voice { readonly pitch: Pitch; }   // opaque; identity is the handle

const voices = new Map<Pitch, Set<Voice>>();

function press(pitch: Pitch): Voice {
  const v: Voice = { pitch };
  const set = voices.get(pitch) ?? new Set();
  if (set.size === 0) { voices.set(pitch, set); AudioOut.liveOn(pitch); MidiOut.liveOn(pitch); }
  set.add(v);
  return v;
}
function release(v: Voice): void {
  const set = voices.get(v.pitch);
  if (!set?.delete(v)) return;             // already dead — idempotent
  if (set.size === 0) { voices.delete(v.pitch); AudioOut.liveOff(v.pitch); MidiOut.liveOff(v.pitch); }
}
function isLive(v: Voice): boolean { return voices.get(v.pitch)?.has(v) ?? false; }
function releaseAll(): void { for (const set of [...voices.values()]) for (const v of [...set]) release(v); }
const held = (): ReadonlySet<Pitch> => new Set(voices.keys());
```

Refcounting fixes the aliasing case outright: the pointer's C4 and the chord's C4 are two voices on one pitch, and the key stops sounding only when the last one lifts.

Then `PerfState.sounding` and `TonnetzState.sounding` become `Voice[]` instead of `number[]`, and — the important part — their state becomes *derived* rather than mirrored:

```ts
let sounding: Voice[] = [];
const liveVoices = () => sounding.filter(LiveKeys.isLive);
const isSounding = () => liveVoices().length > 0;
// trigger() diffs against liveVoices().map(v => v.pitch), not against a private copy
```

A `releaseAll()` from anywhere now invalidates those handles, so `isSounding()` reports `false` and the next `trigger()` correctly re-presses the whole chord.
The mirror stops being a second copy of the truth and becomes a query against the one copy — which is what removes the whole desync class, not just this instance of it.

*Regression test the current suite cannot express:* press a chord through `PerfState`, call `LiveKeys.releaseAll()`, call `PerfState.trigger()`, and assert `LiveKeys.held().size === 3`.

### 4. Note-object *physical identity* is load-bearing and unstated

[audio.ts:149-151](src/outputs/audio.ts#L149-L151), [midi-out.ts:67-79](src/outputs/midi-out.ts#L67-L79), and [piano-roll.ts:67](src/outputs/piano-roll.ts#L67) all do `new Set(Core.activeAt(score, t))` and then `.has(n)` against `score.notes` members or against last frame's set.
`AudioOut` even keys its voice map on `Note` objects.

This works *only* because [core.ts:37](src/core.ts#L37) uses `.filter`, returning the very same objects.
`Score` is typed `readonly notes: readonly Note[]` with `readonly` fields — a value type, which in OCaml is precisely the thing you are not allowed to compare with `==`.

Change `activeAt` to `.map(n => ({...n}))` — a change no signature forbids, and one a defensive-copy instinct invites — and every note re-attacks every frame, MIDI-out floods note-ons, and no falling bar ever lights.
Nothing in the type or in `core.test.ts` pins it.

**Suggested fix.**
Stop depending on allocation behavior and put the identity in the value, where the type system can carry it:

```ts
// types.ts
export type NoteId = number & { readonly __noteId: unique symbol };
export interface Note { readonly id: NoteId; /* ...as before */ }
```

`Core.makeScore` assigns `id` from the post-sort index, which is the only place a `Note` is ever constructed.
Consumers then diff on `Set<NoteId>` — `new Set(Core.activeAt(score, t).map(n => n.id))` — and `AudioOut`'s voice map becomes `Map<NoteId, Voice>`.
The invariant "the same note is the same note across frames" becomes a property of the data rather than of `.filter` not having been rewritten, and defensive copying anywhere in the chain becomes harmless.

The cheaper alternative, if you do not want an id field, is to state the contract and pin it: document `activeAt` as *returning the identical `Note` objects held by `score.notes`, which callers key sets and maps on*, and add to `core.test.ts` a one-line `expect(Core.activeAt(s, t)[0]).toBe(s.notes[0])`.
That converts a silent breakage into a failing test, but it leaves the obligation in prose — prefer the id.

### 5. `keysBandH` vs `KEYB`: a numeric precondition split across two modules

**Confirmed: broken hit-test.**

[piano-roll.ts:134](src/outputs/piano-roll.ts#L134) computes `strikeY = H - KEYB`, silently assuming its region is at least `KEYB` (96px) tall.
[staff-piano.ts:26](src/outputs/staff-piano.ts#L26) hands it `min(KEYB, round(H * 0.5))`, which is smaller than 96 on any viewport under 192px.
The staff-piano header claims the regions are *"computed from the same layout the renderers use so the two can never drift"*; they are in fact two different formulas in two files.

Verified at H=150, where band = 75 and `strikeY` = **-21**: every y in the band maps to the same white key, vertical discrimination is gone entirely, black keys are unreachable at any pixel, and the keyboard is drawn overflowing above the band where the clip eats it.
`rollBandH`'s `min(..., round(H*0.5))` has the identical floor.

**Suggested fix.**
Delete the precondition rather than trying to enforce it across two files.
`layout()` already owns the keyboard geometry for both drawing and hit-testing; let it own the keyboard *height* too, derived from the region it was actually given:

```ts
// piano-roll.ts, inside layout(W, H)
const keyH = Math.min(KEYB, H);   // never taller than the band we were handed
const strikeY = H - keyH;         // therefore never negative
const blackH = keyH * 0.62;
```

`KEYB` stays the exported preferred height that `staff-piano.ts` and `combo.ts` size their bands from; it stops being an unstated assumption about the band they hand back.
A short viewport then yields a squat but fully functional keyboard — black keys reachable, white keys discriminated, nothing drawn above the band — instead of a silently broken one.

Everywhere `KEYB` is used as a *drawing* height inside `markup()` ([piano-roll.ts:114](src/outputs/piano-roll.ts#L114)) must switch to `keyH` from the layout, or the keys still overflow the band.

*Regression test:* at `H = 150`, assert `layout(W, H).strikeY >= 0`, and assert `pitchAt` returns at least two distinct pitches for two y values in the band and reaches at least one black key.

### 6. `MidiOut`'s two paths disagree about whether a port exists

**Confirmed: orphan note-off.**

[midi-out.ts:61](src/outputs/midi-out.ts#L61) `at()` guards `if (!port) return` *before* touching `sounding`.
[midi-out.ts:93-102](src/outputs/midi-out.ts#L93-L102) `liveOn/liveOff` do not — they mutate `livePitches` and let `send` evaporate through `port?.send`.
So `livePitches`' invariant ("pitches currently note-on at the port") is false for any key pressed before MIDI-out was enabled.

Verified: press C4, enable MIDI out, and the dedupe guard skips the note-on so C4 never sounds on the synth.
Release it and the module emits `[0x80, 60, 0]` — a note-off for a note that was never on.

Because [main.ts:180](src/main.ts#L180) calls `AudioOut.setMuted(true)` at that same moment, the local voice dies too, while `LiveKeys.held()` keeps the key lit in every view.
Three modules, three mutually inconsistent answers to "is C4 sounding."

**Suggested fix.**
Pick one meaning for `livePitches` and make the port catch up to it.
The meaning that matches the caller's intent is *"pitches the user is holding"* — it is a mirror of `LiveKeys`, not of the wire — so it should be maintained regardless of port state, and enabling a port must flush the current hold:

```ts
async function enable(): Promise<MIDIOutput[]> {
  // ...open access and pick the port as today...
  for (const p of livePitches) send("on", p);   // the port catches up to what's held
  return [...access.outputs.values()];
}
```

`disable()` already calls `liveSilence()` before clearing `port`, so the note-offs go out while the port still exists — that half is correct and stays.
The invariant becomes stateable in one line at the declaration: *"pitches the user is holding; whenever `port` is open it has a matching note-on for exactly these."*

Note that the score path deliberately means something different — `sounding` is "notes the port has on" and correctly starts empty when a port opens mid-playback — so the two sets keep their asymmetry, but both now have a written invariant instead of one having a false one.

The deeper half of this finding is the three-way disagreement between `MidiOut`, `AudioOut.muted`, and `LiveKeys.held()` about what is audible.
That is finding 3's problem: once `LiveKeys` owns voices and drives both sinks off one refcount, "is C4 sounding" has exactly one answer, and `setMuted` becomes a routing choice underneath it rather than a fourth opinion.

*Regression test:* `liveOn(60)` with no port, `enable()` against a fake port, assert a note-on for 60 was sent; then `liveOff(60)` and assert exactly one note-off, not an orphan.

---

## Tier 2 — one fact, several owners

### 7. Chord quality has two implementations that disagree

[perfecto.ts:138-141](src/harmony/perfecto.ts#L138-L141) calls `degreeQuality` *"the one rule shared by computeVoicing and the views."*
Forty lines down, [perfecto.ts:238](src/harmony/perfecto.ts#L238) hardcodes `CENTER_QUALITY` from the major-mode convention, and [chordName](src/harmony/perfecto.ts#L262) uses it.

Verified: in A natural minor, degree I, `degreeQuality` says `"min"` and the voicing is A-C-E, while the Nashville now-playing readout prints **"A maj"**.
The file's own header ("Quality is DETECTED, not stored") is violated inside the file.

**Suggested fix.**
Delete `CENTER_QUALITY` and call the rule the file already declares to be the only one:

```ts
const quality =
  direction === "center"
    ? degreeQuality(key, degree)          // "maj" | "min" | "dim" — already the label text
    : QUALITY_LABEL[mode][direction];
```

The `ChordQuality` union values are already exactly the strings the readout wants, so this is a deletion, not a translation.

The same major-mode assumption sits in `DEGREE_NUMERAL` at [perfecto.ts:202](src/harmony/perfecto.ts#L202), whose own comment at [perfecto.ts:207](src/harmony/perfecto.ts#L207) admits the casing "does NOT re-case for minor keys."
That is the identical bug wearing different clothes: in A minor the readout prints `I` over an A-C-E triad.
Replace the flat record with `degreeNumeral(key, degree)` deriving casing (and the `°`) from `degreeQuality`, and let `DEGREE_COLOR` — which is also keyed on degree alone — key on quality instead, so a minor-key `I` colors as minor in the Nashville degree row.

*Regression test:* `chordName({root: A, scale: "naturalMinor"}, 1, "default", "center")` is `"A min"`, and `degreeNumeral` for that key/degree is `"i"`.

### 8. The pitch-name table exists four times; the scroll geometry three times

`["C","C#","D",...]` is duplicated in [core.ts:13](src/core.ts#L13), [perfecto.ts:27](src/harmony/perfecto.ts#L27), [tonnetz.ts:40](src/outputs/tonnetz.ts#L40), and [tonnetz-lattice.ts:20](src/harmony/tonnetz-lattice.ts#L20).
`PPS = 120` appears in three renderers, `PLAYHEAD_X = 0.18` in two, `LOW/HIGH = 21/108` in two, and `isWhite`/`isC` in two.

That last cluster is genuine hidden coupling, not just a DRY complaint.
[staff-piano.ts:10-13](src/outputs/staff-piano.ts#L10-L13) promises *"a note crosses the staff playhead exactly as its bar reaches the keyboard's strike line."*
That promise holds only because two unrelated files independently chose the literal `120`.
Edit one and the stacked view goes subtly out of sync, with no error and no failing test.

**Suggested fix.**
Two new leaf modules, both with `types.ts`'s property of importing nothing, so nothing about the dependency shape changes:

- `src/pitch.ts` — `PITCH_NAMES`, `semi`, `isWhite`, `isC`, `LOW`, `HIGH`.
  Imported by `core.ts`, `perfecto.ts`, `tonnetz-lattice.ts`, `tonnetz.ts`, `piano-roll.ts`, `staff-full.ts`.
  `perfecto.ts` keeps its "imports nothing, no DOM, no audio" character — a pure pitch leaf is not a dependency in the sense that header is guarding against, and the header should say so explicitly.
- `src/outputs/scroll.ts` — `export const SCROLL = { PPS: 120, PLAYHEAD_X: 0.18 } as const`.
  Imported by `staff-std.ts`, `staff-full.ts`, and `piano-roll.ts`.

Once `PPS` has one owner, the staff-piano sync promise holds by construction rather than by coincidence, and the header comment becomes true.
Do this one before finding 9 and before the finding-1 restructure: it is a pure deletion, and every later change is smaller against a graph with one copy of each fact.

### 9. The documented cycle-avoidance in `tonnetz-lattice.ts` guards against a cycle that doesn't exist

[tonnetz-lattice.ts:5-8](src/harmony/tonnetz-lattice.ts#L5-L8) says `pitchClassAt`/`triadName` are inlined "to prevent a circular dependency: tonnetz.ts imports TonnetzState which imports this file."

But the graph is `tonnetz.ts -> tonnetz-state.ts -> tonnetz-lattice.ts`, and `tonnetz-lattice.ts` imports nothing.
`tonnetz.ts -> tonnetz-lattice.ts` is perfectly acyclic — it is the *same direction* as the existing path.
The feared cycle would only arise if the lattice imported the view, which nobody proposed.

So there are now two copies of the `(7·col + 4·row) mod 12` formula and two copies of `triadName`/`cursorLabel` maintained by hand, justified by a comment that is wrong.

**Suggested fix.**
The lattice is the leaf and should own the math; the view should import it.
Export `pc` from `tonnetz-lattice.ts` (as `pitchClassAt`) along with `triadName`/`cursorLabel`, delete the copies in [tonnetz.ts](src/outputs/tonnetz.ts), and delete the comment at [tonnetz-lattice.ts:5-8](src/harmony/tonnetz-lattice.ts#L5-L8) rather than correcting it — with the duplication gone there is nothing left for it to justify.

Then make the rule the comment was groping for enforceable instead of narrated: the intended layering is `outputs/ -> harmony/ -> (leaves)`, never the reverse.
An `eslint` `no-restricted-imports` zone (or, if you would rather not add config, a five-line test that reads `src/harmony/*.ts` and asserts no line matches `from "..*outputs/`) turns "we must not create a cycle here" from a comment someone has to believe into a check that fails.
That is what makes the deletion safe permanently, rather than until the next person has the same worry and inlines another copy.

### 10. `#glow` is an undeclared global obligation on every `markup()` caller

[piano-roll.ts:99](src/outputs/piano-roll.ts#L99), [staff-std.ts:114](src/outputs/staff-std.ts#L114), and [tonnetz.ts:151](src/outputs/tonnetz.ts#L151) emit `filter="url(#glow)"` while defining no filter.
The precondition — *"a `<filter id='glow'>` must already exist in this document"* — lives only in prose.

Its consequences: the same filter literal is copy-pasted into five modules; `Combo` and `StaffPiano` must know that both stacked layers want the *same* id, so the two bands can never have different glow radii; and any future view wanting a second filter has to hand-coordinate a document-global name.
The type is `(number, number, Score, number) => string`; the truth is a function of the ambient DOM.

**Suggested fix.**
Make the filter a value the caller supplies, and give the literal one owner.

Add a leaf `src/outputs/defs.ts`:

```ts
export const glowFilter = (id: string, radius = 3): string =>
  `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%">
     <feGaussianBlur stdDeviation="${radius}" result="b"/>
     <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
   </filter>`;
```

Then thread the id through `markup`.
`piano-roll.ts`'s signature is already at six positional parameters with two booleans (`fall`, `hands`) — fold them together while you are here, which is the same fix at the type level:

```ts
export interface MarkupOpts { glowId: string; fall?: boolean; hands?: boolean; }
export const markup = (W: number, H: number, score: Score, t: number, o: MarkupOpts): string => ...
```

`Combo` and `StaffPiano` emit `<defs>${glowFilter("comboGlow")}</defs>` and pass `{ glowId: "comboGlow" }` to each layer — or two different ids with two different radii, which is currently impossible.
The precondition stops being prose: a caller that forgets the id does not compile.

### 11. `staff?: number` carries three incompatible namespaces in one field

[types.ts:33-37](src/types.ts#L33-L37) documents it as "MusicXML `<staff>`, MIDI track, part ordinal" — three different things.

[musicxml.ts:124](src/inputs/musicxml.ts#L124) writes `<staff>` *or falls back to* `partOrdinal`, mixing both namespaces within one score: an SATB export where all four parts declare `<staff>1</staff>` collapses onto staff 1.
[midi.ts:136](src/inputs/midi.ts#L136) writes the track index including a tempo track — which is exactly why [core.ts:43](src/core.ts#L43) `upperStaff` exists as a normalization hack.

Consumers then ask a *binary* question of it — `n.staff === upper ? hand-r : hand-l` at [staff-std.ts:112](src/outputs/staff-std.ts#L112) — so a four-part choral score renders as one right hand and three left hands.
The type cannot say which namespace a number is in.
The consumer's actual question is `hand : Hand.t option`, and the parser is the only module that knows the answer.

**Suggested fix.**
Have the parser answer the question the consumers actually ask, and stop shipping a raw namespace downstream:

```ts
// types.ts
export type Hand = "upper" | "lower";
export interface Note {
  readonly hand?: Hand;    // resolved by the parser; the question renderers ask
  readonly stream?: number; // raw provenance, advisory, never asked a binary question
}
```

Each parser resolves `hand` in its own namespace, once, where the information exists:

- `musicxml.ts` decides **per part, not per note**: if the part declares `<staff>` elements, map staff 1 → upper and the rest → lower; if it does not, use the part ordinal.
  Deciding once per part is what fixes the SATB collapse — the current per-note fallback is what lets two namespaces coexist in one score.
- `midi.ts` skips the tempo track when numbering, then maps lowest note-bearing track → upper, rest → lower.
- `lily.ts` emits no `hand`, and the hands toggle renders unchanged, as it does today.

`Core.upperStaff` then has nothing left to normalize and gets deleted, along with the `upper` plumbing in [staff-std.ts](src/outputs/staff-std.ts) and [piano-roll.ts:63](src/outputs/piano-roll.ts#L63) — both simply read `n.hand`.

Note what this deliberately does not do: it does not attempt to render four choral parts in four colors.
`Hand` is honestly two-valued because the renderers' question is honestly two-valued.
If per-voice coloring is wanted later, that is a *new* question (`stream` plus a palette), added as its own field — which is the point, since it is exactly the conflation of those two questions that produced this finding.

---

## Tier 3 — smaller, same family

**12.** [nashville.ts:150](src/outputs/nashville.ts#L150) spreads a `PerfSnapshot` into `computeVoicing`'s `ComputeVoicingArgs`.
It typechecks only because the two structurally overlap by accident, and TypeScript skips excess-property checks on spreads — so `sounding: number[]` rides silently into the call.
Add a field named `sounding` or `notes` to `ComputeVoicingArgs` and this starts feeding it garbage with no error.
OCaml's nominal records would force an explicit `to_voicing_args`.

**Suggested fix.**
The view should not be calling `computeVoicing` at all — the silent-state preview is `PerfState`'s question, not the renderer's.
Add `PerfState.preview(): number[]` returning `computeVoicing({ ...sel, voiceLeading: false, previousVoicing: null }).notes`, put it on `PerfSnapshot` as a `preview: number[]` field, and delete the import of `computeVoicing` from [nashville.ts](src/outputs/nashville.ts).
That removes the view→harmony call entirely, which is also what finding 1 needs in order for the view to be a pure function of its snapshot.

Inside `perf-state.ts`, write the conversion explicitly rather than spreading — `toVoicingArgs(sel, previousVoicing)` naming every field — so adding a field to either type is a compile error in exactly one place.

**13.** [perfecto.ts:184-196](src/harmony/perfecto.ts#L184-L196): with voice-leading on, the search loops over all three inversions and `a.inversion` survives only as a tiebreak seed.
So `cycleInversion()` (keyboard `i`, gamepad d-pad left) is a no-op while voice-leading is on — and [nashville.ts:164](src/outputs/nashville.ts#L164) keeps printing `s.inversion` as if it applied.

**Suggested fix.**
Treat the requested inversion as a constraint rather than a seed: under voice-leading, search the octave shifts `[-1, 0, 1]` only and keep `a.inversion` fixed.
The control then keeps doing what its label says, and voice-leading still does the work that actually matters musically — most of the common-tone gain comes from the octave shift, not from silently overriding the player's inversion.

If the unconstrained search is preferred musically, then the readout must stop lying: return the winner as `{ notes, inversion }` from `computeVoicing`, store it on `PerfSnapshot`, and have Nashville print the inversion that was *chosen* (dimmed, or suffixed "· auto") rather than the one that was requested.
Either is defensible; what is not defensible is a control that appears live, a readout that agrees with it, and no effect on the sound.

**14.** [clock.ts:5](src/clock.ts#L5) claims *"There is exactly one timer in this whole program."*
[live-gamepad.ts:129](src/live-gamepad.ts#L129) runs a second, independent `requestAnimationFrame` loop, so gamepad input is sampled on a different loop than rendering.
Also `onFrame` has no unsubscribe and `tick` no stop, making `makeClock` single-use-per-page by construction rather than by contract.

**Suggested fix.**
Give `Clock` the two operations its lifecycle needs, then fold the second loop into it:

```ts
// types.ts
export interface Clock {
  // ...as before...
  onFrame(fn: (t: number) => void): () => void;  // returns unsubscribe
  stop(): void;                                   // cancels the rAF
}
```

`LiveGamepad.enable(clock)` then subscribes its `step` via `clock.onFrame` and keeps the returned unsubscribe as its `disable`, deleting its own `requestAnimationFrame` entirely.
The gamepad only ever needed *a* per-frame tick, and the clock is exactly that; it grew its own loop because the clock was a module-level singleton with no way to share.

There is a real behavioral gain beyond making the comment true: input sampled inside the same frame as the render, before it, means a button press lights its key on the frame it happened rather than racing the renderer for it.

---

## The one structural change that dissolves most of this

Findings 1, 3, 4, and 12 are all the same shape: **live performance state is ambient**.
Make it a value.

```ts
interface Frame { score: Score; t: number; live: LiveSnapshot; }
type View = (svg: SVGSVGElement, f: Frame) => void;
```

with `LiveSnapshot` assembled once per frame in [main.ts:56](src/main.ts#L56) from `LiveKeys` / `PerfState` / `TonnetzState`.
Views become genuinely pure and testable, `main.ts`'s comment becomes true, and the mirror-desync class in finding 3 disappears the moment `LiveKeys` hands out owned voice handles instead of a shared int set.

Finding 2 wants a `VIEW` record type with an explicit `keyboardRegion` member, which also kills the identity dispatch.

## Suggested repair order

1. **Finding 3** and **finding 6** — live audible bugs.
2. **Finding 5** and **finding 7** — small, self-contained, user-visible.
3. **Finding 9** and **finding 8** — delete duplicated truth while the dependency graph is still small.
4. **Findings 1, 2, 4** — the structural change above.

Each of the first four gets a regression test that the current suite is structurally unable to express.
