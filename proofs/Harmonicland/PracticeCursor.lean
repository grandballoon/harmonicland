/-!
# PracticeCursor — `src/practice-state.ts`

The practice lesson's cursor (`enter`, `stepBy`, `seekToTime`, `setRange`,
`isolate`, `setHand`, `reset`, `nextOf`) and THE ADVANCE RULE (`pendingOf`,
`droppedOf`, `check`, the `onPress` listener), with the other hand's
auto-play (`reconcileOther`) because the rule reads the same `LiveKeys.held()`
that auto-play writes.

## What the model is

One state record, `PS`, for the module's mutable state (`session`, `fresh`,
`auto`, `reconciling`, `cfg.playOther`) together with the LiveKeys it shares,
and one transition per exported function, translated line by line.

* STEPS ARE ABSTRACT. A `Step` is its time `at` (here `time`) and the PITCHES
  of its `attack`, `sustain` and `release` notes — the advance rule and the
  snapshot read nothing else of a note. `Step.other` is `otherAt(step)`
  (practice-state.ts:244-251): the other hand's pitches sounding at that
  step, a function of the step alone once the session's `rest` is fixed.
  `makeSteps` guarantees `attack` is non-empty; theorems that need it say so.
* THE SPAN IS AN INPUT. `setRange(range)` computes `spanOf(steps,
  barTime(score, range))`; here `setRange` is handed the resulting span, and
  the theorems assume only what `Steps.lean`/`Core.lean` establish separately
  for `spanOf`: `0 ≤ first ≤ last ≤ total` (`ValidSpan`). `session.range` is
  reduced to `ranged` (is it non-null), which is all the cursor reads of it.
  `isolate`'s bar arithmetic is modelled on its own at the end.
* `setHand` re-cuts the score: the new hand's steps and the kept range's span
  over them are inputs.
* LiveKeys is modelled by its interface, as `LiveKeys.lean` proves it behaves
  (`live_press`, `live_release`, `releaseAll_invalidates`, `held_iff`):
  `LK.live` is the list of live handles and `held()` their pitches. Every
  surface here presses audibly, so the silent flag is omitted.
* THE LISTENER AND RE-ENTRANCY. `LiveKeys.press` calls the lesson's `onPress`
  listener synchronously — including when the lesson itself presses, inside
  `reconcileOther`, inside `enter`, inside `check`, inside that listener.
  `reconcileOtherWith L` is `reconcileOther` with the listener `L` called
  after each of its presses, exactly as the source runs; `reconcile_guard`
  proves that for any listener that returns at once while `reconciling` is
  set — as the real one does, `listener_guarded` — the result is the same as
  with no listener at all. That is what lets `enter` be defined before the
  listener that calls it, and `reconcileOther_is_real` ties the knot.
* `advances` is a ghost counter: how many times `check` has moved the cursor.

## What the model leaves out

* Floating point, `NaN`; indices are `Int`, times are `Rat`.
* `hits`/`hit` and `nowMs()` (wall-clock acknowledgement pulses), `pan`,
  `heldFocus`/`focus`, `chart`/`change`, `showOther`/`showArrows`/
  `wholeScore`: presentation, read by nothing the cursor or the rule decides.
* `cachedMoves` is reduced to WHERE its arrows start (`arrowsFrom`); the
  pairing itself (`movesBetween`) is `steps.ts`.
* The clock: `seek(t)` is recorded as the last target sought (`sought`).
* Names Lean reserves: `at` is `time`, `end` is `endLesson`, `from` is `from_`.
-/

namespace Harmonicland.PracticeCursor

abbrev Pitch := Int

/-! ## LiveKeys, by its interface -/

/-- src/live-keys.ts:51 -/
structure Voice where
  id : Nat
  pitch : Pitch
  deriving DecidableEq, Repr

structure LK where
  live : List Voice
  nextId : Nat
  deriving DecidableEq, Repr

/-- `LiveKeys.press(p)` without its listener loop (live-keys.ts:81-87). -/
def LK.press (lk : LK) (p : Pitch) : LK × Voice :=
  ({ live := lk.live ++ [⟨lk.nextId, p⟩], nextId := lk.nextId + 1 }, ⟨lk.nextId, p⟩)

/-- `LiveKeys.release(v)` (live-keys.ts:97). -/
def LK.release (lk : LK) (v : Voice) : LK :=
  { lk with live := lk.live.filter (fun w => decide (w ≠ v)) }

/-- `LiveKeys.isLive(v)` (live-keys.ts:105). -/
def LK.isLive (lk : LK) (v : Voice) : Bool := decide (v ∈ lk.live)

/-- `LiveKeys.held()` (live-keys.ts:111). -/
def LK.held (lk : LK) : List Pitch := lk.live.map (·.pitch)

/-! ## The state -/

/-- src/steps.ts:54-67, reduced to what practice-state.ts reads; plus
    `otherAt` of this step (practice-state.ts:244). -/
structure Step where
  time : Rat
  attack : List Pitch
  sustain : List Pitch
  release : List Pitch
  other : List Pitch
  deriving DecidableEq, Repr

/-- src/steps.ts:80-83 -/
structure Span where
  first : Int
  last : Int
  deriving DecidableEq, Repr

/-- Where `enter` last sent the clock (practice-state.ts:310-314). -/
inductive Seek where
  | stepTime (t : Rat)
  | rangeStart
  | scoreEnd
  deriving DecidableEq, Repr

structure PS where
  /-- `session !== null` (practice-state.ts:205) -/
  active : Bool
  /-- `session.steps.steps` -/
  steps : List Step
  /-- `session.range !== null` -/
  ranged : Bool
  /-- `session.span` -/
  span : Span
  /-- `session.index` -/
  index : Int
  /-- practice-state.ts:211 `fresh` -/
  fresh : List Pitch
  /-- practice-state.ts:215 `auto` -/
  auto : List Voice
  /-- practice-state.ts:223 `reconciling` -/
  reconciling : Bool
  /-- practice-state.ts:166 `cfg.playOther` -/
  playOther : Bool
  lk : LK
  /-- the last `session.seek(...)` -/
  sought : Option Seek
  /-- the step `cachedMoves` draws its arrows from, when it has any to draw -/
  arrowsFrom : Option Int
  /-- ghost: how many times `check` has advanced the cursor -/
  advances : Nat
  deriving DecidableEq, Repr

/-- Module load: no lesson, the toggles at their defaults (lines 163-169). -/
def init : PS :=
  { active := false, steps := [], ranged := false, span := ⟨0, 0⟩, index := 0, fresh := [],
    auto := [], reconciling := false, playOther := true, lk := ⟨[], 0⟩, sought := none,
    arrowsFrom := none, advances := 0 }

/-- `session.steps.steps.length` — the snapshot's `total` (line 519). -/
def total (s : PS) : Int := s.steps.length

/-- `steps[i]` for a JavaScript number `i`. -/
def nth (steps : List Step) (i : Int) : Option Step :=
  if 0 ≤ i then steps[i.toNat]? else none

/-- practice-state.ts:229-233 — `step(i)`. -/
def stepOf (s : PS) (i : Int) : Option Step :=
  if !s.active then none
  else if i ≥ s.span.first ∧ i < s.span.last then nth s.steps i else none

/-- practice-state.ts:234 -/
def liveAuto (s : PS) : List Voice := s.auto.filter s.lk.isLive

/-! ## The other hand — practice-state.ts:253-267 -/

/-- lines 257-260, one turn: keep a voice still wanted, release the rest. -/
def keepOrRelease (want : List Pitch) (acc : LK × List Voice) (v : Voice) : LK × List Voice :=
  if v.pitch ∈ want then (acc.1, acc.2 ++ [v]) else (acc.1.release v, acc.2)

/-- line 262, one turn — `if (!down.has(p)) kept.push(LiveKeys.press(p))` —
    with `L` called on the new voice, as `LiveKeys.press` calls its listeners
    (live-keys.ts:91). -/
def pressMissingWith (L : PS → Voice → PS) (down : List Pitch) (acc : PS × List Voice)
    (p : Pitch) : PS × List Voice :=
  if p ∈ down then acc
  else
    (L { acc.1 with lk := (acc.1.lk.press p).1 } (acc.1.lk.press p).2,
     acc.2 ++ [(acc.1.lk.press p).2])

/-- practice-state.ts:253-267 — `reconcileOther(want)`, with the press
    listener `L` in the loop. -/
def reconcileOtherWith (L : PS → Voice → PS) (s : PS) (want : List Pitch) : PS :=
  let s := { s with reconciling := true }
  let r1 := (liveAuto s).foldl (keepOrRelease want) (s.lk, [])
  let s := { s with lk := r1.1 }
  let down := r1.2.map (·.pitch)
  let r2 := want.foldl (pressMissingWith L down) (s, r1.2)
  { r2.1 with auto := r2.2, reconciling := false }

/-- `reconcileOther` as it runs: every listener call inside it returns at
    once (see `reconcile_guard`). -/
def reconcileOther (s : PS) (want : List Pitch) : PS :=
  reconcileOtherWith (fun s _ => s) s want

/-! ## Moving the cursor — practice-state.ts:272-316 -/

/-- lines 278-289: the value `i` ends with. -/
def landIndex (first last : Int) (ranged : Bool) (i : Int) : Int :=
  let i := if i < first then first else i
  if i ≥ last then (if ranged ∧ last > first then first else last) else i

/-- lines 278-289: the value `from` ends with. -/
def landFrom (first last : Int) (ranged : Bool) (i : Int) : Int :=
  let from0 := i - 1
  let i := if i < first then first else i
  if i ≥ last then (if ranged ∧ last > first then last - 1 else from0) else from0

/-- lines 244-251 with line 315: what `enter` asks `reconcileOther` for. -/
def wantOf (playOther : Bool) (cur : Option Step) : List Pitch :=
  if playOther then (match cur with | some c => c.other | none => []) else []

/-- practice-state.ts:272-316 — `enter(i)`. -/
def enter (s : PS) (i : Int) : PS :=
  if !s.active then s
  else
    let from_ := landFrom s.span.first s.span.last s.ranged i
    let s := { s with index := landIndex s.span.first s.span.last s.ranged i, fresh := [] }
    let prev := stepOf s from_
    let cur := stepOf s s.index
    let s := { s with
      arrowsFrom := (match prev, cur with | some _, some _ => some from_ | _, _ => none),
      sought := some (match cur with
        | some c => Seek.stepTime c.time
        | none => if s.ranged then Seek.rangeStart else Seek.scoreEnd) }
    reconcileOther s (wantOf s.playOther cur)

/-- practice-state.ts:321-327 — `nextOf()`. -/
def nextOf (s : PS) : Option Step :=
  match stepOf s s.index with
  | none => none
  | some _ =>
    if s.index + 1 < s.span.last then stepOf s (s.index + 1)
    else if s.ranged then stepOf s s.span.first else none

/-! ## The advance rule — practice-state.ts:329-353 -/

/-- practice-state.ts:332-336 — `pendingOf(cur, held)`, reading `fresh`. -/
def pendingOf (cur : Step) (fresh held : List Pitch) : List Pitch :=
  cur.attack.filter (fun p => decide (p ∉ fresh ∨ p ∉ held))

/-- practice-state.ts:338-339 — `droppedOf(cur, held)`. -/
def droppedOf (cur : Step) (held : List Pitch) : List Pitch :=
  cur.sustain.filter (fun p => decide (p ∉ held))

/-- practice-state.ts:346-353 — `check()`. -/
def check (s : PS) : PS :=
  match stepOf s s.index with
  | none => s
  | some cur =>
    if (pendingOf cur s.fresh s.lk.held).length > 0 then s
    else if (droppedOf cur s.lk.held).length > 0 then s
    else enter { s with advances := s.advances + 1 } (s.index + 1)

/-- `fresh.add(p)` -/
def addFresh (fresh : List Pitch) (p : Pitch) : List Pitch :=
  if p ∈ fresh then fresh else fresh ++ [p]

/-- practice-state.ts:372-381 — the `onPress` listener (its `hits` line
    omitted). While no lesson is running it is unsubscribed, which is the
    same as returning at once. -/
def listener (s : PS) (v : Voice) : PS :=
  if s.reconciling ∨ !s.active then s
  else check { s with fresh := addFresh s.fresh v.pitch }

/-! ## Everything that can happen -/

/-- `LiveKeys.press(p)` by anyone but the lesson — the learner's finger, a
    MIDI key, the microphone — with the listener it notifies. -/
def pressKey (s : PS) (p : Pitch) : PS × Voice :=
  (listener { s with lk := (s.lk.press p).1 } (s.lk.press p).2, (s.lk.press p).2)

/-- `LiveKeys.release(v)` by anyone. There is no release listener
    (live-keys.ts:39). -/
def releaseKey (s : PS) (v : Voice) : PS := { s with lk := s.lk.release v }

/-- `LiveKeys.releaseAll()` (main.ts:859). -/
def releaseAllKeys (s : PS) : PS := { s with lk := { s.lk with live := [] } }

/-- practice-state.ts:387-397 — `end()`. -/
def endLesson (s : PS) : PS :=
  let s := reconcileOther s []
  { s with auto := [], fresh := [], arrowsFrom := none, active := false }

/-- practice-state.ts:364-384 — `begin(score, seek, chart)`; `steps` is
    `makeSteps(score, cfg.hand)`. -/
def begin (s : PS) (steps : List Step) : PS :=
  let s := endLesson s
  enter { s with active := true, steps := steps, ranged := false,
                 span := ⟨0, steps.length⟩, index := 0 } 0

/-- practice-state.ts:418-421 — the new `session.range` and `session.span`.
    `ranged` is `range !== null`; `sp` is `spanOf(steps, barTime(score,
    range))` when it is. -/
def withRange (s : PS) (ranged : Bool) (sp : Span) : PS :=
  { s with ranged := ranged, span := if ranged then sp else ⟨0, s.steps.length⟩ }

/-- practice-state.ts:416-424 — `setRange(range)`. -/
def setRange (s : PS) (ranged : Bool) (sp : Span) : PS :=
  if !s.active then s
  else
    let s := withRange s ranged sp
    if s.index < s.span.first ∨ s.index ≥ s.span.last then enter s s.span.first else s

/-- practice-state.ts:443-445 — `stepBy(delta)`. -/
def stepBy (s : PS) (delta : Int) : PS := if s.active then enter s (s.index + delta) else s

/-- src/steps.ts:155-158 — `stepAt(steps, t)`. -/
def stepAt (steps : List Step) (t : Rat) : Int :=
  (steps.findIdx (fun st => decide (t ≤ st.time)) : Nat)

/-- practice-state.ts:471-473 — `seekToTime(t)`. -/
def seekToTime (s : PS) (t : Rat) : PS := if s.active then enter s (stepAt s.steps t) else s

/-- practice-state.ts:475 — `reset()`. -/
def reset (s : PS) : PS := enter s (if s.active then s.span.first else 0)

/-- practice-state.ts:464-467 — `setPlayOther(on)`. -/
def setPlayOther (s : PS) (on : Bool) : PS :=
  let s := { s with playOther := on }
  if s.active then reconcileOther s (wantOf on (stepOf s s.index)) else s

/-- practice-state.ts:402-410 — `setHand(hand)`. `steps'` is the score re-cut
    for the new hand, `sp'` the kept range's span over it, `duration` the
    score's. -/
def setHand (s : PS) (steps' : List Step) (sp' : Span) (duration : Rat) : PS :=
  if !s.active then s
  else
    let t := match stepOf s s.index with | some c => c.time | none => duration
    let ranged := s.ranged
    let s := begin s steps'
    let s := if ranged then setRange s true sp' else s
    enter s (stepAt s.steps t)

/-! ## `reconcileOther`, in closed form -/

/-- The same two loops over LiveKeys alone. -/
def pressMissing (down : List Pitch) (acc : LK × List Voice) (p : Pitch) : LK × List Voice :=
  if p ∈ down then acc else ((acc.1.press p).1, acc.2 ++ [(acc.1.press p).2])

def recLK (lk : LK) (auto : List Voice) (want : List Pitch) : LK × List Voice :=
  let r1 := (auto.filter lk.isLive).foldl (keepOrRelease want) (lk, [])
  want.foldl (pressMissing (r1.2.map (·.pitch))) r1

private theorem fold_guarded (L : PS → Voice → PS)
    (hL : ∀ s v, s.reconciling = true → L s v = s) (down : List Pitch) (W : List Pitch) :
    ∀ (s : PS) (kept : List Voice), s.reconciling = true →
      W.foldl (pressMissingWith L down) (s, kept) =
        ({ s with lk := (W.foldl (pressMissing down) (s.lk, kept)).1 },
         (W.foldl (pressMissing down) (s.lk, kept)).2) := by
  induction W with
  | nil => intro s kept _; rfl
  | cons p W ih =>
    intro s kept hr
    by_cases hp : p ∈ down
    · simp only [List.foldl_cons, pressMissingWith, pressMissing, hp, ite_true]
      exact ih s kept hr
    · simp only [List.foldl_cons, pressMissingWith, pressMissing, hp, ite_false]
      rw [hL { s with lk := (s.lk.press p).1 } _ hr]
      exact ih _ _ hr

/-- **practice-state.ts:219-223** "True while we are pressing or releasing the
    other hand ourselves … the guard — not handle identity — is what keeps
    the cursor from grading its own accompaniment." For ANY listener that
    returns at once while `reconciling` is set, `reconcileOther` with that
    listener in its press loop does exactly what it does with none: nothing
    but LiveKeys, `auto` and the flag itself changes. -/
theorem reconcile_guard (L : PS → Voice → PS)
    (hL : ∀ s v, s.reconciling = true → L s v = s) (s : PS) (want : List Pitch) :
    reconcileOtherWith L s want =
      { s with lk := (recLK s.lk s.auto want).1, auto := (recLK s.lk s.auto want).2,
               reconciling := false } := by
  unfold reconcileOtherWith
  simp only
  rw [fold_guarded L hL _ _ _ _ rfl]
  rfl

theorem reconcileOther_eq (s : PS) (want : List Pitch) :
    reconcileOther s want =
      { s with lk := (recLK s.lk s.auto want).1, auto := (recLK s.lk s.auto want).2,
               reconciling := false } :=
  reconcile_guard _ (fun _ _ _ => rfl) s want

/-- The real listener is such a listener (practice-state.ts:373). -/
theorem listener_guarded (s : PS) (v : Voice) (h : s.reconciling = true) : listener s v = s := by
  simp [listener, h]

/-- So the model's `reconcileOther` IS the source's, in which every
    `LiveKeys.press` notifies the real listener. -/
theorem reconcileOther_is_real (s : PS) (want : List Pitch) :
    reconcileOtherWith listener s want = reconcileOther s want := by
  rw [reconcile_guard listener listener_guarded, reconcileOther_eq]

/-! ## Frame facts -/

section Frame
variable (s : PS) (want : List Pitch) (i : Int)

@[simp] theorem rec_active : (reconcileOther s want).active = s.active := by rw [reconcileOther_eq]
@[simp] theorem rec_steps : (reconcileOther s want).steps = s.steps := by rw [reconcileOther_eq]
@[simp] theorem rec_ranged : (reconcileOther s want).ranged = s.ranged := by rw [reconcileOther_eq]
@[simp] theorem rec_span : (reconcileOther s want).span = s.span := by rw [reconcileOther_eq]
@[simp] theorem rec_index : (reconcileOther s want).index = s.index := by rw [reconcileOther_eq]
@[simp] theorem rec_fresh : (reconcileOther s want).fresh = s.fresh := by rw [reconcileOther_eq]
@[simp] theorem rec_playOther : (reconcileOther s want).playOther = s.playOther := by
  rw [reconcileOther_eq]
@[simp] theorem rec_advances : (reconcileOther s want).advances = s.advances := by
  rw [reconcileOther_eq]
@[simp] theorem rec_sought : (reconcileOther s want).sought = s.sought := by rw [reconcileOther_eq]
@[simp] theorem rec_arrows : (reconcileOther s want).arrowsFrom = s.arrowsFrom := by
  rw [reconcileOther_eq]
@[simp] theorem rec_reconciling : (reconcileOther s want).reconciling = false := by
  rw [reconcileOther_eq]

@[simp] theorem enter_active : (enter s i).active = s.active := by
  unfold enter; split <;> simp
@[simp] theorem enter_steps : (enter s i).steps = s.steps := by
  unfold enter; split <;> simp
@[simp] theorem enter_ranged : (enter s i).ranged = s.ranged := by
  unfold enter; split <;> simp
@[simp] theorem enter_span : (enter s i).span = s.span := by
  unfold enter; split <;> simp
@[simp] theorem enter_playOther : (enter s i).playOther = s.playOther := by
  unfold enter; split <;> simp
@[simp] theorem enter_advances : (enter s i).advances = s.advances := by
  unfold enter; split <;> simp

theorem enter_index (h : s.active = true) :
    (enter s i).index = landIndex s.span.first s.span.last s.ranged i := by
  unfold enter; simp [h]

theorem enter_fresh (h : s.active = true) : (enter s i).fresh = [] := by
  unfold enter; simp [h]

theorem enter_reconciling (h : s.reconciling = false) : (enter s i).reconciling = false := by
  unfold enter; split <;> simp [h]

/-- **practice-state.ts:307-314** "the clock follows the cursor: past the last
    step we park at the end … A range with no steps in it parks at the
    range's own start instead". -/
theorem enter_sought (h : s.active = true) :
    (enter s i).sought =
      some (match stepOf s (landIndex s.span.first s.span.last s.ranged i) with
        | some c => Seek.stepTime c.time
        | none => if s.ranged then Seek.rangeStart else Seek.scoreEnd) := by
  unfold enter; simp [h, stepOf]

end Frame

theorem stepOf_congr {s s' : PS} (ha : s'.active = s.active) (hs : s'.steps = s.steps)
    (hp : s'.span = s.span) (i : Int) : stepOf s' i = stepOf s i := by
  unfold stepOf; rw [ha, hs, hp]

/-! ## Where `enter` lands -/

theorem landIndex_in_span (first last : Int) (ranged : Bool) (i : Int) (h : first ≤ last) :
    first ≤ landIndex first last ranged i ∧ landIndex first last ranged i ≤ last := by
  unfold landIndex
  simp only
  split <;> split <;> (try split) <;> omega

theorem landIndex_loops (first last : Int) (i : Int) (h : first < last) :
    landIndex first last true i < last := by
  unfold landIndex
  simp only
  split <;> split <;> simp_all <;> omega

/-- Inside the span, `enter` goes exactly where it was told. -/
theorem landIndex_inside (first last : Int) (ranged : Bool) (i : Int)
    (h : first ≤ i ∧ i < last) : landIndex first last ranged i = i := by
  unfold landIndex
  simp only
  split <;> split <;> (try split) <;> omega

/-! ## The cursor invariant -/

/-- What `spanOf` returns (proved for it separately): a run of step indices
    inside the score's steps. -/
def ValidSpan (sp : Span) (steps : List Step) : Prop :=
  0 ≤ sp.first ∧ sp.first ≤ sp.last ∧ sp.last ≤ steps.length

structure CInv (s : PS) : Prop where
  /-- the span is a run of the score's steps -/
  span_ok : ValidSpan s.span s.steps
  /-- no range: the span is the whole piece (`wholeSpan`, line 237) -/
  whole : s.ranged = false → s.span = ⟨0, s.steps.length⟩
  /-- **practice-state.ts:98-99** "`index` is always within it (or at `last`,
      finished)" -/
  in_span : s.span.first ≤ s.index ∧ s.index ≤ s.span.last
  /-- a range that has steps never rests at its end: it loops -/
  loops : s.ranged = true → s.span.first < s.span.last → s.index < s.span.last

/-- `enter` establishes the cursor's half of the invariant from the span's. -/
theorem CInv_enter {s : PS} (i : Int) (ha : s.active = true) (hs : ValidSpan s.span s.steps)
    (hw : s.ranged = false → s.span = ⟨0, s.steps.length⟩) : CInv (enter s i) := by
  refine ⟨by simpa using hs, by simpa using hw, ?_, ?_⟩
  · rw [enter_index s i ha, enter_span]
    exact landIndex_in_span _ _ _ _ hs.2.1
  · intro hr hlt
    rw [enter_index s i ha, enter_span] at *
    rw [enter_ranged] at hr
    rw [hr]; exact landIndex_loops _ _ _ hlt

/-- `reconcileOther` moves nothing the invariant reads. -/
theorem CInv_rec {s : PS} (h : CInv s) (want : List Pitch) : CInv (reconcileOther s want) := by
  obtain ⟨a, b, c, d⟩ := h
  exact ⟨by simpa [ValidSpan] using a, by simpa using b, by simpa using c, by simpa using d⟩

theorem CInv_congr {s s' : PS} (h : CInv s) (h1 : s'.steps = s.steps) (h2 : s'.span = s.span)
    (h3 : s'.ranged = s.ranged) (h4 : s'.index = s.index) : CInv s' := by
  obtain ⟨a, b, c, d⟩ := h
  refine ⟨?_, ?_, ?_, ?_⟩
  · unfold ValidSpan; rw [h1, h2]; exact a
  · rw [h1, h2, h3]; exact b
  · rw [h2, h4]; exact c
  · rw [h2, h3, h4]; exact d

theorem check_active (s : PS) : (check s).active = s.active := by
  unfold check; split
  · rfl
  · split
    · rfl
    · split <;> simp

theorem CInv_check {s : PS} (h : CInv s) (ha : s.active = true) : CInv (check s) := by
  unfold check
  split
  · exact h
  · split
    · exact h
    · split
      · exact h
      · exact CInv_enter _ ha h.span_ok h.whole

theorem listener_active (s : PS) (v : Voice) : (listener s v).active = s.active := by
  unfold listener; split
  · rfl
  · rw [check_active]

theorem CInv_listener {s : PS} (h : CInv s) (v : Voice) : CInv (listener s v) := by
  unfold listener
  split
  · exact h
  · rename_i hc
    have ha : s.active = true := by
      cases hb : s.active <;> simp_all
    exact CInv_check (CInv_congr h rfl rfl rfl rfl) ha

theorem endLesson_active (s : PS) : (endLesson s).active = false := rfl

theorem begin_active (s : PS) (steps : List Step) : (begin s steps).active = true := by
  simp [begin]

theorem CInv_begin (s : PS) (steps : List Step) : CInv (begin s steps) := by
  unfold begin
  apply CInv_enter
  · rfl
  · simp [ValidSpan]
  · intro _; rfl

instance (sp : Span) (steps : List Step) : Decidable (ValidSpan sp steps) := by
  unfold ValidSpan; exact inferInstance

theorem setRange_active (s : PS) (ranged : Bool) (sp : Span) :
    (setRange s ranged sp).active = s.active := by
  unfold setRange
  split
  · rfl
  · dsimp only
    split
    · rw [enter_active]; rfl
    · rfl

theorem CInv_setRange {s : PS} (ha : s.active = true) (ranged : Bool) (sp : Span)
    (hv : ValidSpan sp s.steps) : CInv (setRange s ranged sp) := by
  have hspan : ValidSpan (withRange s ranged sp).span (withRange s ranged sp).steps := by
    show ValidSpan (if ranged = true then sp else ⟨0, s.steps.length⟩) s.steps
    split
    · exact hv
    · simp [ValidSpan]
  have hwhole : (withRange s ranged sp).ranged = false →
      (withRange s ranged sp).span = ⟨0, (withRange s ranged sp).steps.length⟩ := by
    intro hr
    have : ranged = false := hr
    subst this; rfl
  have hwa : (withRange s ranged sp).active = true := ha
  unfold setRange
  simp only [ha, Bool.not_true, Bool.false_eq_true, ite_false]
  split
  · exact CInv_enter _ hwa hspan hwhole
  · rename_i hc
    exact ⟨hspan, hwhole, by omega, fun _ _ => by omega⟩

/-- Every state the module can be driven into. `pressKey` / `releaseKey` /
    `releaseAllKeys` are LiveKeys calls made by anyone else — the learner, or
    another input surface — at any time. -/
inductive Reach : PS → Prop where
  | init : Reach init
  | begin {s} (steps : List Step) : Reach s → Reach (begin s steps)
  | endLesson {s} : Reach s → Reach (endLesson s)
  | setRange {s} (ranged : Bool) (sp : Span) :
      Reach s → ValidSpan sp s.steps → Reach (setRange s ranged sp)
  | stepBy {s} (delta : Int) : Reach s → Reach (stepBy s delta)
  | seekToTime {s} (t : Rat) : Reach s → Reach (seekToTime s t)
  | reset {s} : Reach s → Reach (reset s)
  | setPlayOther {s} (on : Bool) : Reach s → Reach (setPlayOther s on)
  | setHand {s} (steps' : List Step) (sp' : Span) (duration : Rat) :
      Reach s → ValidSpan sp' steps' → Reach (setHand s steps' sp' duration)
  | pressKey {s} (p : Pitch) : Reach s → Reach (pressKey s p).1
  | releaseKey {s} (v : Voice) : Reach s → Reach (releaseKey s v)
  | releaseAllKeys {s} : Reach s → Reach (releaseAllKeys s)

/-- **practice-state.ts:98-99** "`index` is always within [the span] (or at
    `last`, finished)" — after any sequence of calls, while a lesson runs,
    the span is a run of the score's steps, the cursor is inside it or at its
    end, and a non-empty range never rests at its end. -/
theorem CInv_of_Reach {s : PS} (h : Reach s) : s.active = true → CInv s := by
  induction h with
  | init => intro h; simp [init] at h
  | begin steps _ _ => intro _; exact CInv_begin _ steps
  | endLesson _ _ => intro h; simp [endLesson_active] at h
  | @setRange s ranged sp _ hv ih =>
    intro ha
    rw [setRange_active] at ha
    exact CInv_setRange ha ranged sp hv
  | @stepBy s delta _ ih =>
    intro ha
    unfold stepBy at ha ⊢
    split
    · rename_i h1; exact CInv_enter _ h1 (ih h1).span_ok (ih h1).whole
    · rename_i h1; simp [h1] at ha
  | @seekToTime s t _ ih =>
    intro ha
    unfold seekToTime at ha ⊢
    split
    · rename_i h1; exact CInv_enter _ h1 (ih h1).span_ok (ih h1).whole
    · rename_i h1; simp [h1] at ha
  | @reset s _ ih =>
    intro ha
    unfold reset at ha ⊢
    rw [enter_active] at ha
    exact CInv_enter _ ha (ih ha).span_ok (ih ha).whole
  | @setPlayOther s on _ ih =>
    intro ha
    unfold setPlayOther at ha ⊢
    simp only at ha ⊢
    split
    · rename_i h1
      exact CInv_rec (CInv_congr (s' := { s with playOther := on }) (ih h1) rfl rfl rfl rfl) _
    · rename_i h1; simp [h1] at ha
  | @setHand s steps' sp' duration _ hv ih =>
    intro _
    by_cases h1 : s.active = true
    · have hb := CInv_begin s steps'
      have hba := begin_active s steps'
      have hbs : (begin s steps').steps = steps' := by simp [begin]
      unfold setHand
      simp only [h1, Bool.not_true, Bool.false_eq_true, ite_false]
      cases s.ranged
      · exact CInv_enter _ hba hb.span_ok hb.whole
      · have h2 := CInv_setRange hba true sp' (by rw [hbs]; exact hv)
        have h2a : (setRange (begin s steps') true sp').active = true := by
          rw [setRange_active]; exact hba
        exact CInv_enter _ h2a h2.span_ok h2.whole
    · rename_i ha
      have hf : s.active = false := by simpa using h1
      simp [setHand, hf] at ha
  | @pressKey s p _ ih =>
    intro ha
    unfold pressKey at ha ⊢
    simp only at ha ⊢
    rw [listener_active] at ha
    exact CInv_listener
      (CInv_congr (s' := { s with lk := (s.lk.press p).1 }) (ih ha) rfl rfl rfl rfl) _
  | @releaseKey s v _ ih => intro ha; exact CInv_congr (ih ha) rfl rfl rfl rfl
  | @releaseAllKeys s _ ih => intro ha; exact CInv_congr (ih ha) rfl rfl rfl rfl

/-! ## The cursor's claims -/

/-- `steps[i]` exists for every index inside a valid span. -/
theorem nth_isSome {steps : List Step} {i : Int} (h0 : 0 ≤ i) (h1 : i < steps.length) :
    (nth steps i).isSome = true := by
  unfold nth
  simp only [h0, ite_true]
  have : i.toNat < steps.length := by omega
  simp [this]

/-- The step under the cursor is null exactly when the cursor stands at the
    end of its span. -/
theorem current_none_iff {s : PS} (h : CInv s) (ha : s.active = true) :
    stepOf s s.index = none ↔ s.index = s.span.last := by
  have hv := h.span_ok
  unfold ValidSpan at hv
  unfold stepOf
  simp only [ha, Bool.not_true, Bool.false_eq_true, ite_false]
  constructor
  · intro hn
    by_cases hc : s.index ≥ s.span.first ∧ s.index < s.span.last
    · simp only [hc, and_self, ite_true] at hn
      have := nth_isSome (steps := s.steps) (i := s.index) (by omega) (by omega)
      rw [hn] at this; simp at this
    · have := h.in_span; omega
  · intro he; simp [he]

/-- **practice-state.ts:101-102** "`index` … equals `total` exactly when the
    score is finished" — HOLDS ONLY UNDER A HYPOTHESIS the code does not
    enforce: no range is set (`hr`). With the whole piece as the span, the
    cursor is at `total` exactly when there is no current step. See
    `FAILS_index_total_iff_finished`. -/
theorem index_total_iff_finished {s : PS} (h : Reach s) (ha : s.active = true)
    (hr : s.ranged = false) : s.index = total s ↔ stepOf s s.index = none := by
  have hi := CInv_of_Reach h ha
  rw [current_none_iff hi ha, hi.whole hr]; rfl

/-- A lesson on one step, nothing played, and then a range whose span is
    empty and sits at the end of the piece (a bar after the hand's last
    note). -/
def exEmptyRange : PS :=
  setRange (begin init [⟨0, [60], [], [], []⟩]) true ⟨1, 1⟩

/-- **FAILS — "`index` … equals `total` exactly when the score is finished"**
    (practice-state.ts:101-102; also :52 "`index === total` is 'done'").
    Isolating a bar that holds no step of the practised hand and lies after
    its last note parks the cursor at `total` though nothing was played.
    Repro: `repro/practice_cursor.ts`, section E. -/
theorem FAILS_index_total_iff_finished :
    Reach exEmptyRange ∧ exEmptyRange.active = true ∧
      exEmptyRange.index = total exEmptyRange ∧ exEmptyRange.advances = 0 := by
  refine ⟨Reach.setRange _ _ (Reach.begin _ Reach.init) ?_, ?_, ?_, ?_⟩
  · decide
  · decide
  · decide
  · decide

/-- **practice-state.ts:49-52** "finishing the last step of the range lands on
    its first … The whole piece, with no range, still ends": entering the
    index after the span's last step goes to the range's first step when a
    range is set, and to `total` when none is. -/
theorem past_last_step {s : PS} (h : Reach s) (ha : s.active = true)
    (hlast : s.index + 1 = s.span.last) :
    (enter s (s.index + 1)).index = if s.ranged then s.span.first else total s := by
  have hi := CInv_of_Reach h ha
  rw [enter_index s _ ha]
  have := hi.in_span
  unfold landIndex
  cases hr : s.ranged
  · have hw := hi.whole hr
    have hl : s.span.last = total s := by rw [hw]; rfl
    simp only [Bool.false_eq_true, false_and, ite_false]
    split <;> split <;> omega
  · simp only [true_and, ite_true]
    split <;> split <;> (try split) <;> omega

/-- **practice-state.ts:439-442** "stepping back from the first step stays
    put" (test: "stops at the first step going back"). -/
theorem stepBack_from_first {s : PS} (h : Reach s) (ha : s.active = true)
    (hf : s.index = s.span.first) : (stepBy s (-1)).index = s.index := by
  have hi := CInv_of_Reach h ha
  have := hi.in_span
  unfold stepBy
  simp only [ha, ite_true]
  rw [enter_index s _ ha]
  unfold landIndex
  simp only
  split <;> split <;> (try split) <;> omega

/-- Any move by hand lands on the step asked for when that step is inside
    the span ("Bounded by the span like every other move"). -/
theorem stepBy_inside {s : PS} (ha : s.active = true) (delta : Int)
    (hin : s.span.first ≤ s.index + delta ∧ s.index + delta < s.span.last) :
    (stepBy s delta).index = s.index + delta := by
  unfold stepBy
  simp only [ha, ite_true]
  rw [enter_index s _ ha, landIndex_inside _ _ _ _ hin]

/-- **practice-state.ts:309, steps.ts:181-182** "A range with no steps in it
    parks at the range's own start" (test: "reports nothing to play for a
    range with no steps in it"): the cursor stands at the empty span, there is
    no current step and no next one, and the clock is sent to the range's
    start, not the end of the score. -/
theorem empty_range_parks {s : PS} (ha : s.active = true) (sp : Span) (he : sp.first = sp.last) :
    let s' := setRange s true sp
    s'.index = sp.first ∧ stepOf s' s'.index = none ∧ nextOf s' = none ∧
      s'.sought = some Seek.rangeStart := by
  have hw : (withRange s true sp).span = sp := rfl
  have hwa : (withRange s true sp).active = true := ha
  have key : setRange s true sp = enter (withRange s true sp) sp.first := by
    unfold setRange
    simp only [ha, Bool.not_true, Bool.false_eq_true, ite_false]
    split
    · rfl
    · rename_i hc; rw [hw] at hc; omega
  have hland : landIndex sp.first sp.last true sp.first = sp.first := by
    unfold landIndex; simp only
    split <;> split <;> (try split) <;> omega
  have hidx : (setRange s true sp).index = sp.first := by
    rw [key, enter_index _ _ hwa, hw]; exact hland
  have hnoneW : ∀ j, stepOf (withRange s true sp) j = none := by
    intro j
    unfold stepOf
    rw [hw]
    have : ¬ (j ≥ sp.first ∧ j < sp.last) := by omega
    simp [this]
  have hnone : ∀ j, stepOf (setRange s true sp) j = none := by
    intro j
    rw [key, stepOf_congr (enter_active _ _) (enter_steps _ _) (enter_span _ _)]
    exact hnoneW j
  refine ⟨hidx, hnone _, ?_, ?_⟩
  · unfold nextOf; rw [hnone]
  · rw [key, enter_sought _ _ hwa, hnoneW]
    rfl

/-- **practice-state.ts:412-415** "The cursor keeps its place when that place
    is inside the new range, and otherwise goes to the range's first step"
    (tests: "keeps your place when it is inside the new range", "confines the
    cursor to the steps in the range"). -/
theorem setRange_keeps_or_first {s : PS} (ha : s.active = true) (sp : Span)
    (hne : sp.first < sp.last) :
    (setRange s true sp).index =
      if sp.first ≤ s.index ∧ s.index < sp.last then s.index else sp.first := by
  have hw : (withRange s true sp).span = sp := rfl
  have hwi : (withRange s true sp).index = s.index := rfl
  have hwa : (withRange s true sp).active = true := ha
  unfold setRange
  simp only [ha, Bool.not_true, Bool.false_eq_true, ite_false]
  split
  · rename_i hc
    rw [enter_index _ _ hwa]
    rw [hw, hwi] at hc
    rw [hw, landIndex_inside _ _ _ _ ⟨Int.le_refl _, hne⟩]
    have : ¬ (sp.first ≤ s.index ∧ s.index < sp.last) := by omega
    simp [this]
  · rename_i hc
    rw [hw, hwi] at hc
    have : sp.first ≤ s.index ∧ s.index < sp.last := by omega
    simp [this, hwi]

/-- **Noted, not a failure of a stated claim** — `setRange(null)` on a piece
    that is FINISHED (cursor at `total`, no range) does not keep the cursor
    at the end: `index >= last` holds there, so line 423 sends it to step 0
    and the lesson starts over. `applyBars()` (main.ts:405) calls
    `setRange(selection)` with a null selection on every loop-button click,
    "all bars" click, view switch and score load.
    Run: `repro/practice_cursor.ts`, section F. -/
theorem setRange_null_restarts_finished_piece {s : PS} (ha : s.active = true)
    (hfin : s.index = total s) (sp : Span) : (setRange s false sp).index = 0 := by
  have hw : (withRange s false sp).span = ⟨0, s.steps.length⟩ := rfl
  have hwi : (withRange s false sp).index = s.index := rfl
  have hwa : (withRange s false sp).active = true := ha
  unfold total at hfin
  unfold setRange
  simp only [ha, Bool.not_true, Bool.false_eq_true, ite_false]
  split
  · rw [enter_index _ _ hwa, hw]
    unfold landIndex; simp only
    have : (0 : Int) ≤ s.steps.length := by omega
    split <;> split <;> (try split) <;> simp_all <;> omega
  · rename_i hc
    rw [hw, hwi] at hc
    simp only at hc
    omega

/-- **practice-state.ts:318-320** "At the end of an isolated range it is the
    range's first step — the loop's honest answer to 'then what' — and at the
    end of the whole piece there is none" (tests: "offers the range's first
    step as what comes next at its end", "has no look-ahead on the last
    step"). -/
theorem nextOf_at_end {s : PS} (h : Reach s) (ha : s.active = true)
    (hlast : s.index + 1 = s.span.last) :
    nextOf s = if s.ranged then stepOf s s.span.first else none := by
  have hi := CInv_of_Reach h ha
  have hcur : stepOf s s.index ≠ none := by
    rw [Ne, current_none_iff hi ha]; omega
  unfold nextOf
  cases hc : stepOf s s.index with
  | none => exact absurd hc hcur
  | some c =>
    have : ¬ (s.index + 1 < s.span.last) := by omega
    simp only [this, ite_false]

/-! ## The advance rule's claims -/

/-- "every pitch it ATTACKS has been freshly struck since the step began, all
    of them are down at that moment, and every pitch it SUSTAINS is still
    down" (practice-state.ts:16-18), as `check` tests it. -/
def Complete (cur : Step) (fresh held : List Pitch) : Prop :=
  (∀ a ∈ cur.attack, a ∈ fresh ∧ a ∈ held) ∧ (∀ u ∈ cur.sustain, u ∈ held)

instance (cur : Step) (fresh held : List Pitch) : Decidable (Complete cur fresh held) := by
  unfold Complete; exact inferInstance

theorem pending_nil_iff (cur : Step) (fresh held : List Pitch) :
    pendingOf cur fresh held = [] ↔ ∀ a ∈ cur.attack, a ∈ fresh ∧ a ∈ held := by
  unfold pendingOf
  rw [List.filter_eq_nil_iff]
  constructor
  · intro h a ha
    have := h a ha
    simp only [decide_eq_true_eq] at this
    constructor
    · exact Classical.byContradiction fun hc => this (Or.inl hc)
    · exact Classical.byContradiction fun hc => this (Or.inr hc)
  · intro h a ha
    simp only [decide_eq_true_eq]
    rintro (hc | hc)
    · exact hc (h a ha).1
    · exact hc (h a ha).2

theorem dropped_nil_iff (cur : Step) (held : List Pitch) :
    droppedOf cur held = [] ↔ ∀ u ∈ cur.sustain, u ∈ held := by
  unfold droppedOf
  rw [List.filter_eq_nil_iff]
  constructor
  · intro h u hu
    have := h u hu
    simpa using this
  · intro h u hu
    simpa using h u hu

/-- `check`, as the rule it implements. -/
theorem check_spec {s : PS} {cur : Step} (hc : stepOf s s.index = some cur) :
    check s = if Complete cur s.fresh s.lk.held
              then enter { s with advances := s.advances + 1 } (s.index + 1) else s := by
  unfold check
  simp only [hc]
  by_cases hp : pendingOf cur s.fresh s.lk.held = []
  · by_cases hd : droppedOf cur s.lk.held = []
    · have : Complete cur s.fresh s.lk.held :=
        ⟨(pending_nil_iff _ _ _).1 hp, (dropped_nil_iff _ _).1 hd⟩
      simp [hp, hd, this]
    · have hn : ¬ Complete cur s.fresh s.lk.held := fun h => hd ((dropped_nil_iff _ _).2 h.2)
      have : (droppedOf cur s.lk.held).length > 0 := by
        cases hl : droppedOf cur s.lk.held with
        | nil => exact absurd hl hd
        | cons _ _ => simp
      simp [hp, this, hn]
  · have hn : ¬ Complete cur s.fresh s.lk.held := fun h => hp ((pending_nil_iff _ _ _).2 h.1)
    have : (pendingOf cur s.fresh s.lk.held).length > 0 := by
      cases hl : pendingOf cur s.fresh s.lk.held with
      | nil => exact absurd hl hp
      | cons _ _ => simp
    simp [this, hn]

/-- The state a press leaves when it does not complete the step. -/
def pressed (s : PS) (p : Pitch) : PS :=
  { s with lk := (s.lk.press p).1, fresh := addFresh s.fresh p }

/-- **THE ADVANCE RULE** (practice-state.ts:14-18). One press, while a lesson
    is running and a step is current: the cursor advances exactly when, with
    this press counted, every attacked pitch has been struck since the step
    began and is down, and every sustained pitch is down. Otherwise the press
    is only recorded. -/
theorem press_spec {s : PS} {cur : Step} (ha : s.active = true) (hr : s.reconciling = false)
    (hc : stepOf s s.index = some cur) (p : Pitch) :
    (pressKey s p).1 =
      if Complete cur (addFresh s.fresh p) (s.lk.held ++ [p])
      then enter { pressed s p with advances := s.advances + 1 } (s.index + 1)
      else pressed s p := by
  have hlis : (pressKey s p).1 = check (pressed s p) := by
    have hcond : ¬ (({ s with lk := (s.lk.press p).1 } : PS).reconciling = true ∨
        (!({ s with lk := (s.lk.press p).1 } : PS).active) = true) := by simp [hr, ha]
    unfold pressKey listener
    simp only [hcond, ↓reduceIte]
    rfl
  have hc' : stepOf (pressed s p) (pressed s p).index = some cur := by
    rw [← hc]; exact stepOf_congr rfl rfl rfl _
  have hheld : (pressed s p).lk.held = s.lk.held ++ [p] := by simp [pressed, LK.press, LK.held]
  rw [hlis, check_spec hc', hheld]
  rfl

/-- **practice-state.ts:23-24** "the learner may build a chord up one finger
    at a time — press C, then E, then G — and complete it on the G" (test:
    "lets the learner build a chord up one finger at a time"). If every other
    attacked pitch is already freshly struck and down and the sustains are
    down, the press of the last one completes the step — and no earlier
    press did, while one was still missing (`press_spec`). -/
theorem last_finger_completes {s : PS} {cur : Step} (ha : s.active = true)
    (hr : s.reconciling = false) (hc : stepOf s s.index = some cur) (p : Pitch)
    (hothers : ∀ a ∈ cur.attack, a ≠ p → a ∈ s.fresh ∧ a ∈ s.lk.held)
    (hsus : ∀ u ∈ cur.sustain, u ∈ s.lk.held) :
    (pressKey s p).1.advances = s.advances + 1 := by
  rw [press_spec ha hr hc]
  have : Complete cur (addFresh s.fresh p) (s.lk.held ++ [p]) := by
    constructor
    · intro a haa
      by_cases hap : a = p
      · subst hap; unfold addFresh; split <;> simp_all
      · have := hothers a haa hap
        unfold addFresh; split <;> simp [this]
    · intro u hu; simp [hsus u hu]
  simp [this]

/-- …and a press that leaves any attacked pitch not freshly struck, or not
    down, moves nothing: it is recorded and the cursor stays. -/
theorem incomplete_press_stays {s : PS} {cur : Step} (ha : s.active = true)
    (hr : s.reconciling = false) (hc : stepOf s s.index = some cur) (p : Pitch) (a : Pitch)
    (haa : a ∈ cur.attack) (hap : a ≠ p) (hmiss : a ∉ s.fresh ∨ a ∉ s.lk.held) :
    (pressKey s p).1 = pressed s p := by
  rw [press_spec ha hr hc]
  have : ¬ Complete cur (addFresh s.fresh p) (s.lk.held ++ [p]) := by
    intro hcomp
    have := hcomp.1 a haa
    rcases hmiss with h | h
    · apply h
      have h1 := this.1
      unfold addFresh at h1; split at h1
      · exact h1
      · simp at h1; rcases h1 with h1 | h1
        · exact h1
        · exact absurd h1 hap
    · apply h
      have h2 := this.2
      simp at h2; rcases h2 with h2 | h2
      · exact h2
      · exact absurd h2 hap
  simp [this]

/-- **"one press advances at most one step"** — `check` calls `enter` once
    and `enter` never calls `check`: the presses `enter` makes for the other
    hand are not graded (`reconcile_guard`). -/
theorem press_advances_at_most_one (s : PS) (p : Pitch) :
    (pressKey s p).1.advances = s.advances ∨ (pressKey s p).1.advances = s.advances + 1 := by
  unfold pressKey listener
  simp only
  split
  · left; rfl
  · unfold check
    split
    · left; rfl
    · split
      · left; rfl
      · split
        · left; rfl
        · right; simp

/-- **practice-state.ts:21-22** "a chord played twice in a row is not
    satisfied by holding it once" (test: "requires a FRESH strike, so a chord
    held through does not play itself twice"). Whenever the cursor has just
    moved — by a completed step, a wrap, a manual step, a scrub — nothing
    counts as struck: every attacked pitch of the step it lands on is pending
    again, whatever keys are down. -/
theorem everything_pending_after_enter (s : PS) (i : Int) (ha : s.active = true) (cur : Step)
    (held : List Pitch) : pendingOf cur (enter s i).fresh held = cur.attack := by
  rw [enter_fresh s i ha]
  unfold pendingOf
  rw [List.filter_eq_self]
  intro a _; simp

/-- **practice-state.ts:341-345** "Only a press can ever complete a step — a
    release only makes the pending set larger": a release changes nothing but
    LiveKeys (so the cursor cannot move), and every pitch pending before it
    is pending after it. -/
theorem release_never_completes (s : PS) (v : Voice) :
    (releaseKey s v).index = s.index ∧ (releaseKey s v).advances = s.advances ∧
      (releaseKey s v).fresh = s.fresh ∧
      ∀ cur p, p ∈ pendingOf cur s.fresh s.lk.held →
        p ∈ pendingOf cur (releaseKey s v).fresh (releaseKey s v).lk.held := by
  refine ⟨rfl, rfl, rfl, ?_⟩
  intro cur p hp
  simp only [pendingOf, List.mem_filter, decide_eq_true_eq] at hp ⊢
  refine ⟨hp.1, ?_⟩
  rcases hp.2 with h | h
  · exact Or.inl h
  · right
    intro hc; apply h
    simp only [releaseKey, LK.release, LK.held, List.mem_map, List.mem_filter] at hc ⊢
    obtain ⟨w, hw, hwp⟩ := hc
    exact ⟨w, hw.1, hwp⟩

/-- **practice-state.ts:24-26** "Wrong notes are reported but never block"
    (test: "reports extra notes but never lets them block"): the rule is
    monotone in what is down. If a step is complete with some keys held, it
    is complete with any more keys held as well. -/
theorem extra_keys_never_block (cur : Step) (fresh held held' : List Pitch)
    (hsub : ∀ p ∈ held, p ∈ held') (h : Complete cur fresh held) : Complete cur fresh held' :=
  ⟨fun a ha => ⟨(h.1 a ha).1, hsub a (h.1 a ha).2⟩, fun u hu => hsub u (h.2 u hu)⟩

/-- **The other hand is never graded** (test: "does not grade its own
    accompaniment as the learner playing … our own press did not advance
    anything"): `reconcileOther`, whatever it presses, leaves `fresh`, the
    cursor and the advance count as they were. -/
theorem auto_play_not_graded (s : PS) (want : List Pitch) :
    (reconcileOtherWith listener s want).fresh = s.fresh ∧
      (reconcileOtherWith listener s want).index = s.index ∧
      (reconcileOtherWith listener s want).advances = s.advances := by
  rw [reconcileOther_is_real]; simp

/-! ### Can a step be un-completable? -/

theorem press_advances_mono (s : PS) (p : Pitch) : s.advances ≤ (pressKey s p).1.advances := by
  rcases press_advances_at_most_one s p with h | h <;> omega

/-- Press these pitches one after another, lifting nothing. -/
def pressAll (s : PS) (ps : List Pitch) : PS := ps.foldl (fun s p => (pressKey s p).1) s

theorem pressAll_mono (ps : List Pitch) : ∀ s : PS, s.advances ≤ (pressAll s ps).advances := by
  induction ps with
  | nil => intro s; exact Nat.le_refl _
  | cons p ps ih =>
    intro s
    exact Nat.le_trans (press_advances_mono s p) (ih _)

theorem mem_addFresh (fresh : List Pitch) (p q : Pitch) :
    q ∈ addFresh fresh p ↔ (q ∈ fresh ∨ q = p) := by
  unfold addFresh; split
  · constructor
    · exact Or.inl
    · rintro (h | rfl) <;> assumption
  · simp

private theorem pressAll_completes (cur : Step) (ps : List Pitch) :
    ∀ s : PS, ps ≠ [] → s.active = true → s.reconciling = false →
      stepOf s s.index = some cur →
      (∀ a ∈ cur.attack, a ∈ ps ∨ (a ∈ s.fresh ∧ a ∈ s.lk.held)) →
      (∀ u ∈ cur.sustain, u ∈ ps ∨ u ∈ s.lk.held) →
      s.advances < (pressAll s ps).advances := by
  induction ps with
  | nil => intro s h; exact absurd rfl h
  | cons p ps ih =>
    intro s _ ha hr hc hatt hsus
    have hspec := press_spec ha hr hc p
    by_cases hcomp : Complete cur (addFresh s.fresh p) (s.lk.held ++ [p])
    · -- this press completes it
      have h1 : (pressKey s p).1.advances = s.advances + 1 := by
        rw [hspec]; simp [hcomp, pressed]
      have := pressAll_mono ps (pressKey s p).1
      show s.advances < (pressAll (pressKey s p).1 ps).advances
      omega
    · have h1 : (pressKey s p).1 = pressed s p := by rw [hspec]; simp [hcomp]
      show s.advances < (pressAll (pressKey s p).1 ps).advances
      rw [h1]
      have hheld : (pressed s p).lk.held = s.lk.held ++ [p] := by
        simp [pressed, LK.press, LK.held]
      by_cases hps : ps = []
      · -- no presses left: but then this press had everything it needed
        subst hps
        exfalso; apply hcomp
        constructor
        · intro a haa
          rcases hatt a haa with h | h
          · have : a = p := by simpa using h
            subst this
            exact ⟨(mem_addFresh _ _ _).2 (Or.inr rfl), by simp⟩
          · exact ⟨(mem_addFresh _ _ _).2 (Or.inl h.1), by simp [h.2]⟩
        · intro u hu
          rcases hsus u hu with h | h
          · have : u = p := by simpa using h
            subst this; simp
          · simp [h]
      · have := ih (pressed s p) hps ha hr (by rw [← hc]; exact stepOf_congr rfl rfl rfl _)
          (by
            intro a haa
            rcases hatt a haa with h | h
            · rcases List.mem_cons.1 h with rfl | h
              · right
                exact ⟨(mem_addFresh _ _ _).2 (Or.inr rfl), by rw [hheld]; simp⟩
              · exact Or.inl h
            · right
              exact ⟨(mem_addFresh _ _ _).2 (Or.inl h.1), by rw [hheld]; simp [h.2]⟩)
          (by
            intro u hu
            rcases hsus u hu with h | h
            · rcases List.mem_cons.1 h with rfl | h
              · right; rw [hheld]; simp
              · exact Or.inl h
            · right; rw [hheld]; simp [h])
        exact this

/-- **No step is un-completable.** From any state of a running lesson with a
    current step — whatever is or is not held, whatever the other hand is
    auto-playing, wherever the step sits in a span — the learner completes it
    by pressing its sustained pitches and then its attacked ones, lifting
    nothing: the cursor has advanced by the time the last is down. (`attack`
    is never empty for a step `makeSteps` builds; the hypothesis `hne` asks
    only that the step names at least one pitch.) -/
theorem step_completable {s : PS} {cur : Step} (ha : s.active = true)
    (hr : s.reconciling = false) (hc : stepOf s s.index = some cur)
    (hne : cur.sustain ++ cur.attack ≠ []) :
    s.advances < (pressAll s (cur.sustain ++ cur.attack)).advances :=
  pressAll_completes cur _ s hne ha hr hc
    (fun _ haa => Or.inl (List.mem_append.2 (Or.inr haa)))
    (fun _ hu => Or.inl (List.mem_append.2 (Or.inl hu)))

/-- A step that names no pitch at all (which `makeSteps` never builds: a
    group has at least the note that opened it, steps.ts:118-124) is not
    stuck either: any press at all completes it. -/
theorem empty_step_completes_on_any_press {s : PS} {cur : Step} (ha : s.active = true)
    (hr : s.reconciling = false) (hc : stepOf s s.index = some cur)
    (h1 : cur.attack = []) (h2 : cur.sustain = []) (p : Pitch) :
    (pressKey s p).1.advances = s.advances + 1 := by
  rw [press_spec ha hr hc]
  have : Complete cur (addFresh s.fresh p) (s.lk.held ++ [p]) := by
    constructor <;> intro x hx <;> simp_all
  simp [this]

/-- `reconciling` is never left set, so `step_completable`'s hypothesis `hr`
    holds in every reachable state. -/
theorem not_reconciling_of_Reach {s : PS} (h : Reach s) : s.reconciling = false := by
  have hcheck : ∀ s : PS, s.reconciling = false → (check s).reconciling = false := by
    intro s hs
    unfold check; split
    · exact hs
    · split
      · exact hs
      · split
        · exact hs
        · exact enter_reconciling _ _ hs
  have hbegin : ∀ (s : PS) steps, (begin s steps).reconciling = false := by
    intro s steps; unfold begin; apply enter_reconciling; simp [endLesson]
  have hsetRange : ∀ (s : PS) r sp, s.reconciling = false →
      (setRange s r sp).reconciling = false := by
    intro s r sp hs
    unfold setRange; split
    · exact hs
    · dsimp only; split
      · exact enter_reconciling _ _ hs
      · exact hs
  induction h with
  | init => rfl
  | begin steps _ _ => exact hbegin _ _
  | endLesson _ _ => simp [endLesson]
  | setRange ranged sp _ _ ih => exact hsetRange _ _ _ ih
  | stepBy delta _ ih =>
    unfold stepBy; split
    · exact enter_reconciling _ _ ih
    · exact ih
  | seekToTime t _ ih =>
    unfold seekToTime; split
    · exact enter_reconciling _ _ ih
    · exact ih
  | reset _ ih => exact enter_reconciling _ _ ih
  | setPlayOther on _ ih =>
    unfold setPlayOther; simp only; split
    · simp
    · exact ih
  | setHand steps' sp' duration _ _ ih =>
    unfold setHand; split
    · exact ih
    · simp only; apply enter_reconciling
      split
      · exact hsetRange _ _ _ (hbegin _ _)
      · exact hbegin _ _
  | pressKey p _ ih =>
    unfold pressKey listener; simp only
    split
    · exact ih
    · exact hcheck _ ih
  | releaseKey v _ ih => exact ih
  | releaseAllKeys _ ih => exact ih

/-! ## What the snapshot reports — practice-state.ts:482-535 -/

/-- line 492 — `autoPitches`. -/
def autoPitches (s : PS) : List Pitch := (liveAuto s).map (·.pitch)

/-- line 493 — `mine`: the pitches of `soundingIn(cur)`. -/
def mineOf (cur : Option Step) : List Pitch :=
  match cur with | some c => c.attack ++ c.sustain | none => []

/-- line 495 — `leaving`. -/
def leavingOf (cur : Option Step) : List Pitch :=
  match cur with | some c => c.release | none => []

/-- line 497 — `learner`: held, not part of this step, not auto-played. -/
def learnerOf (s : PS) : List Pitch :=
  s.lk.held.filter (fun p =>
    decide (p ∉ mineOf (stepOf s s.index)) && decide (p ∉ autoPitches s))

/-- line 523 — `snapshot().pending`. -/
def snapPending (s : PS) : List Pitch :=
  match stepOf s s.index with | some c => pendingOf c s.fresh s.lk.held | none => []

/-- line 524 — `snapshot().dropped`. -/
def snapDropped (s : PS) : List Pitch :=
  match stepOf s s.index with | some c => droppedOf c s.lk.held | none => []

/-- line 525 — `snapshot().wrong`. -/
def snapWrong (s : PS) : List Pitch :=
  (learnerOf s).filter (fun p => decide (p ∉ leavingOf (stepOf s s.index)))

/-- line 526 — `snapshot().stale`. -/
def snapStale (s : PS) : List Pitch :=
  (learnerOf s).filter (fun p => decide (p ∈ leavingOf (stepOf s s.index)))

/-- The pitches under a finger that is not the lesson's own: some live voice
    holds it that is not one of the auto-played handles. -/
def learnerHeld (s : PS) : List Pitch :=
  (s.lk.live.filter (fun v => decide (v ∉ liveAuto s))).map (·.pitch)

/-- **practice-state.ts:116-129** `wrong` and `stale` never overlap, both are
    held, and neither includes a pitch the step expects (`mine`) nor one the
    lesson is auto-playing ("our own accompaniment is not the learner
    playing at all", line 496; test: "does not grade its own accompaniment",
    "keeps a stale finger out of wrong"). -/
theorem wrong_stale_spec (s : PS) (p : Pitch) :
    (p ∈ snapWrong s → p ∉ snapStale s) ∧
    (p ∈ snapWrong s ∨ p ∈ snapStale s →
      p ∈ s.lk.held ∧ p ∉ mineOf (stepOf s s.index) ∧ p ∉ autoPitches s) ∧
    (p ∈ snapStale s → p ∈ leavingOf (stepOf s s.index)) := by
  simp only [snapWrong, snapStale, learnerOf, List.mem_filter, decide_eq_true_eq,
    Bool.and_eq_true]
  refine ⟨?_, ?_, ?_⟩
  · rintro ⟨_, h⟩ ⟨_, h'⟩; exact h h'
  · rintro (⟨⟨a, b, c⟩, _⟩ | ⟨⟨a, b, c⟩, _⟩) <;> exact ⟨a, b, c⟩
  · rintro ⟨_, h⟩; exact h

/-- `held()` is the learner's keys together with the auto-played ones. -/
theorem held_split (s : PS) (p : Pitch) :
    p ∈ s.lk.held ↔ (p ∈ learnerHeld s ∨ p ∈ autoPitches s) := by
  simp only [LK.held, learnerHeld, autoPitches, List.mem_map, List.mem_filter, decide_eq_true_eq]
  constructor
  · rintro ⟨v, hv, rfl⟩
    by_cases ha : v ∈ liveAuto s
    · exact Or.inr ⟨v, ha, rfl⟩
    · exact Or.inl ⟨v, ⟨hv, ha⟩, rfl⟩
  · rintro (⟨v, ⟨hv, _⟩, rfl⟩ | ⟨v, hv, rfl⟩)
    · exact ⟨v, hv, rfl⟩
    · simp only [liveAuto, List.mem_filter, LK.isLive, decide_eq_true_eq] at hv
      exact ⟨v, hv.2, rfl⟩

/-- **`pending` and `dropped` as the snapshot documents them**
    (practice-state.ts:111-115: "Attacks not yet satisfied: not struck since
    the step began, or struck and since let go"; "Sustains the learner has
    let go of") — HOLD ONLY UNDER A HYPOTHESIS the code does not enforce: no
    auto-played voice is on a pitch this step attacks or sustains (`hsep`).
    Then both sets are about the learner's own fingers. Without it:
    `FAILS_pending_struck_and_let_go`, `FAILS_dropped_let_go`. -/
theorem pending_dropped_learner {s : PS} {cur : Step} (hc : stepOf s s.index = some cur)
    (hsep : ∀ p ∈ autoPitches s, p ∉ cur.attack ∧ p ∉ cur.sustain) (p : Pitch) :
    (p ∈ snapPending s ↔ (p ∈ cur.attack ∧ (p ∉ s.fresh ∨ p ∉ learnerHeld s))) ∧
    (p ∈ snapDropped s ↔ (p ∈ cur.sustain ∧ p ∉ learnerHeld s)) := by
  simp only [snapPending, snapDropped, hc, pendingOf, droppedOf, List.mem_filter,
    decide_eq_true_eq]
  constructor
  · constructor
    · rintro ⟨ha, h⟩
      refine ⟨ha, ?_⟩
      rcases h with h | h
      · exact Or.inl h
      · exact Or.inr fun hl => h ((held_split s p).2 (Or.inl hl))
    · rintro ⟨ha, h⟩
      refine ⟨ha, ?_⟩
      rcases h with h | h
      · exact Or.inl h
      · right; intro hh
        rcases (held_split s p).1 hh with h1 | h1
        · exact h h1
        · exact (hsep p h1).1 ha
  · constructor
    · rintro ⟨hs, h⟩
      exact ⟨hs, fun hl => h ((held_split s p).2 (Or.inl hl))⟩
    · rintro ⟨hs, h⟩
      refine ⟨hs, fun hh => ?_⟩
      rcases (held_split s p).1 hh with h1 | h1
      · exact h h1
      · exact (hsep p h1).2 hs

/-- **`wrong` as the snapshot documents it** (practice-state.ts:116-118:
    "Held, no part of this step, and not a leftover from the step you just
    played") — read of the learner's fingers, HOLDS ONLY UNDER A HYPOTHESIS
    the code does not enforce: the learner is not holding a key the lesson is
    also auto-playing (`hsep`). Without it: `FAILS_wrong_hidden_by_auto`. -/
theorem wrong_learner {s : PS} (hsep : ∀ p ∈ learnerHeld s, p ∉ autoPitches s) (p : Pitch) :
    p ∈ snapWrong s ↔
      (p ∈ learnerHeld s ∧ p ∉ mineOf (stepOf s s.index) ∧ p ∉ leavingOf (stepOf s s.index)) := by
  simp only [snapWrong, learnerOf, List.mem_filter, decide_eq_true_eq, Bool.and_eq_true]
  constructor
  · rintro ⟨⟨hh, hm, ha⟩, hl⟩
    rcases (held_split s p).1 hh with h1 | h1
    · exact ⟨h1, hm, hl⟩
    · exact absurd h1 ha
  · rintro ⟨hh, hm, hl⟩
    exact ⟨⟨(held_split s p).2 (Or.inl hh), hm, hsep p hh⟩, hl⟩

/-! ### The same pitch in both hands -/

/-- A lesson on the upper hand: step 0 attacks C4 and E4 while the lower hand
    holds C4 (auto-played); step 1 attacks D4. -/
def exShared : PS :=
  begin init [⟨0, [60, 64], [], [], [60]⟩, ⟨1, [62], [], [60, 64], [60]⟩]

/-- The learner strikes C4… -/
def exShared1 : PS := (pressKey exShared 60).1
/-- …lets it go (the handle that press returned)… -/
def exShared2 : PS := releaseKey exShared1 (pressKey exShared 60).2
/-- …and strikes E4. -/
def exShared3 : PS := (pressKey exShared2 64).1

theorem exShared3_reach : Reach exShared3 :=
  Reach.pressKey _ (Reach.releaseKey _ (Reach.pressKey _ (Reach.begin _ Reach.init)))

/-- **FAILS — `pending`: "Attacks not yet satisfied: not struck since the
    step began, or struck and since let go"** (practice-state.ts:111-112).
    The learner struck C4 and let it go; C4 is under no finger of theirs; and
    `pending` does not list it, because the auto-played lower-hand C4 keeps
    the pitch in `LiveKeys.held()`.
    Repro: `repro/practice_cursor.ts`, section A. -/
theorem FAILS_pending_struck_and_let_go :
    stepOf exShared2 exShared2.index = some ⟨0, [60, 64], [], [], [60]⟩ ∧
      60 ∈ exShared2.fresh ∧ 60 ∉ learnerHeld exShared2 ∧
      snapPending exShared2 = [64] := by
  decide

/-- **FAILS — THE ADVANCE RULE: "all of them are down at that moment"**
    (practice-state.ts:16-18; test "does not advance while a note struck
    earlier has been let go"). Continuing: the learner strikes E4 with C4
    lifted, holding one key of the two-note chord, and the step completes —
    the cursor moves to step 1. -/
theorem FAILS_advance_all_down :
    exShared2.index = 0 ∧ learnerHeld exShared2 = [] ∧
      exShared3.index = 1 ∧ exShared3.advances = 1 ∧ learnerHeld exShared3 = [64] := by
  decide

/-- A lesson on the upper hand: step 0 attacks C4, held for two steps; step 1
    attacks E4 over it while the lower hand strikes C4 too (auto-played). -/
def exDropped : PS :=
  begin init [⟨0, [60], [], [], []⟩, ⟨1, [64], [60], [], [60]⟩, ⟨2, [67], [], [60, 64], []⟩]

/-- The learner plays step 0 (C4)… -/
def exDropped1 : PS := (pressKey exDropped 60).1
/-- …lets go of the C4 they are meant to sustain… -/
def exDropped2 : PS := releaseKey exDropped1 (pressKey exDropped 60).2
/-- …and strikes E4. -/
def exDropped3 : PS := (pressKey exDropped2 64).1

/-- **FAILS — `dropped`: "Sustains the learner has let go of — the only
    blocking mistake"** (practice-state.ts:114; test "blocks on a sustain the
    learner let go of, and says which"). The learner has let go of the
    sustained C4; `dropped` is empty, because the auto-played C4 is in
    `held()`; and the step then completes on E4 alone.
    Repro: `repro/practice_cursor.ts`, section B. -/
theorem FAILS_dropped_let_go :
    exDropped2.index = 1 ∧ 60 ∉ learnerHeld exDropped2 ∧ snapDropped exDropped2 = [] ∧
      exDropped3.index = 2 := by
  decide

/-- A lesson on the upper hand: one step attacking E4, the lower hand's C3
    auto-played under it; the learner puts a finger on C3. -/
def exWrong : PS := (pressKey (begin init [⟨0, [64], [], [], [48]⟩]) 48).1

/-- **FAILS — `wrong`: "Held, no part of this step, and not a leftover from
    the step you just played. A genuine wrong note. Reported"**
    (practice-state.ts:116-118). The learner holds C3, which the practised
    hand was never asked for; it is not reported, because the lesson is
    auto-playing that pitch. With auto-play off the same finger IS reported.
    Repro: `repro/practice_cursor.ts`, section C. -/
theorem FAILS_wrong_hidden_by_auto :
    48 ∈ learnerHeld exWrong ∧ 48 ∉ mineOf (stepOf exWrong exWrong.index) ∧
      48 ∉ leavingOf (stepOf exWrong exWrong.index) ∧
      snapWrong exWrong = [] ∧ snapStale exWrong = [] ∧
      snapWrong (setPlayOther exWrong false) = [48] := by
  decide

/-! ## `setHand` — practice-state.ts:399-410 -/

theorem stepAt_le (steps : List Step) (t : Rat) : 0 ≤ stepAt steps t ∧ stepAt steps t ≤ steps.length := by
  unfold stepAt
  have := List.findIdx_le_length (p := fun st : Step => decide (t ≤ st.time)) (xs := steps)
  omega

/-- **src/steps.ts:152-154** "The step at or after a score time": `stepAt`
    is the first index whose step begins at or after `t` — every earlier step
    begins before it — and `steps.length` when there is none. -/
theorem stepAt_first_at_or_after (steps : List Step) (t : Rat) :
    (∀ k : Nat, (k : Int) < stepAt steps t → ∀ st, steps[k]? = some st → st.time < t) ∧
    (∀ st, nth steps (stepAt steps t) = some st → t ≤ st.time) := by
  unfold stepAt
  constructor
  · intro k hk st hst
    have hk' : k < steps.findIdx (fun st => decide (t ≤ st.time)) := by omega
    have hlt : k < steps.length := by
      have := List.findIdx_le_length (p := fun st : Step => decide (t ≤ st.time)) (xs := steps)
      omega
    have := List.not_of_lt_findIdx hk'
    rw [List.getElem?_eq_getElem hlt] at hst
    cases hst
    have h2 : ¬ t ≤ steps[k].time := by simpa using this
    exact Rat.not_le.1 h2
  · intro st hst
    unfold nth at hst
    simp only [Int.natCast_nonneg, ite_true, Int.toNat_natCast] at hst
    obtain ⟨hlt, heq⟩ := List.getElem?_eq_some_iff.1 hst
    have := List.findIdx_getElem (w := hlt)
    rw [heq] at this
    simpa using this

/-- **practice-state.ts:399-401** "Switch hands mid-lesson without losing
    your place: re-cut the score, keep the isolated bars, then land on the
    first step at or after the one you were on" (test: "re-cuts the score and
    keeps your place") — HOLDS ONLY UNDER A HYPOTHESIS the code does not
    enforce: that step lies inside the kept range, or it is the end of a
    piece with no range (`hin`). Then the cursor lands exactly on
    `stepAt(newSteps, at)`, which `stepAt_first_at_or_after` shows is the
    first step at or after the time you were on. Without it:
    `FAILS_setHand_lands_at_or_after`. -/
theorem setHand_lands {s : PS} (ha : s.active = true) (steps' : List Step) (sp' : Span)
    (duration : Rat)
    (hin : let j := stepAt steps'
                (match stepOf s s.index with | some c => c.time | none => duration)
           if s.ranged then sp'.first ≤ j ∧ j < sp'.last else True) :
    (setHand s steps' sp' duration).index =
      stepAt steps' (match stepOf s s.index with | some c => c.time | none => duration) := by
  have hba := begin_active s steps'
  have hbs : (begin s steps').steps = steps' := by simp [begin]
  have hbspan : (begin s steps').span = ⟨0, steps'.length⟩ := by simp [begin]
  have hbr : (begin s steps').ranged = false := by simp [begin]
  generalize ht : (match stepOf s s.index with | some c => c.time | none => duration) = t at hin
  have hj := stepAt_le steps' t
  unfold setHand
  simp only [ha, Bool.not_true, Bool.false_eq_true, ite_false, ht]
  cases hr : s.ranged
  · simp only [Bool.false_eq_true, ite_false]
    rw [enter_index _ _ hba, hbs, hbspan, hbr]
    unfold landIndex; simp only
    split <;> split <;> (try split) <;> simp_all <;> omega
  · simp only [hr, ite_true] at hin ⊢
    have h2a : (setRange (begin s steps') true sp').active = true := by
      rw [setRange_active]; exact hba
    have h2s : (setRange (begin s steps') true sp').steps = steps' := by
      unfold setRange; simp only [hba, Bool.not_true, Bool.false_eq_true, ite_false]
      split
      · rw [enter_steps]; exact hbs
      · exact hbs
    have h2span : (setRange (begin s steps') true sp').span = sp' := by
      unfold setRange; simp only [hba, Bool.not_true, Bool.false_eq_true, ite_false]
      split
      · rw [enter_span]; rfl
      · rfl
    rw [enter_index _ _ h2a, h2s, h2span]
    exact landIndex_inside _ _ _ _ hin

/-- Hands together, three steps — lower C3 at 0, upper C4 at 1, lower D3 at
    2 — with the first bar (the first two steps) isolated and the first step
    played, so the cursor stands on the upper hand's C4 at t = 1. -/
def exHand : PS :=
  (pressKey (setRange (begin init
    [⟨0, [48], [], [], []⟩, ⟨1, [60], [], [48], []⟩, ⟨2, [50], [], [60], []⟩]) true ⟨0, 2⟩) 48).1

/-- Switch to the lower hand: its steps are C3 at 0 and D3 at 2, and the kept
    bar holds only the first. -/
def exHand' : PS :=
  setHand exHand [⟨0, [48], [], [], [60]⟩, ⟨2, [50], [], [48], []⟩] ⟨0, 1⟩ 4

/-- **FAILS — `setHand`: "land on the first step at or after the one you were
    on"** (practice-state.ts:399-401). The lower hand's first step at or
    after t = 1 is D3 at t = 2, which lies outside the kept bar; `enter`
    wraps to the range's first step, and the cursor lands on C3 at t = 0 —
    BEFORE the step the learner was on.
    Repro: `repro/practice_cursor.ts`, section D. -/
theorem FAILS_setHand_lands_at_or_after :
    (stepOf exHand exHand.index).map (·.time) = some 1 ∧
      exHand'.index = 0 ∧ (stepOf exHand' exHand'.index).map (·.time) = some 0 := by
  decide

/-! ## The model against the real code

`repro/practice_cursor.ts`, section G, drives the real `PracticeState` through
a short lesson and prints the cursor; this is the same trace in the model.
(Every `FAILS_` example above is such a comparison too.) -/

/-- Eight single-note steps, 60..67, two to a bar. -/
def exEight : List Step :=
  [⟨0, [60], [], [], []⟩, ⟨1, [61], [], [60], []⟩, ⟨2, [62], [], [61], []⟩,
   ⟨3, [63], [], [62], []⟩, ⟨4, [64], [], [63], []⟩, ⟨5, [65], [], [64], []⟩,
   ⟨6, [66], [], [65], []⟩, ⟨7, [67], [], [66], []⟩]

/-- `begin`; `step(-1)`; `setRange(bar 1)` (steps 2 and 3); `step(-1)`; then
    play 62 and 63, lifting each. -/
def exG1 : PS := stepBy (begin init exEight) (-1)
def exG2 : PS := setRange exG1 true ⟨2, 4⟩
def exG3 : PS := stepBy exG2 (-1)
def exG4 : PS := releaseKey (pressKey exG3 62).1 (pressKey exG3 62).2
def exG5 : PS := releaseKey (pressKey exG4 63).1 (pressKey exG4 63).2

/-- The model prints what the real code prints: index 0 after stepping back
    from the first step; index 2 on isolating the bar; still 2 after stepping
    back from the range's first step; 3 after its first note; and back to 2 —
    the loop — after its second. -/
theorem model_matches_repro_G :
    exG1.index = 0 ∧ exG2.index = 2 ∧ exG2.span = ⟨2, 4⟩ ∧ exG3.index = 2 ∧
      exG4.index = 3 ∧ exG5.index = 2 ∧ exG5.advances = 2 ∧ snapPending exG5 = [62] := by
  decide

/-! ## `isolate` — practice-state.ts:431-437, with core.ts:129-180 -/

/-- src/types.ts:125-130, the bars only. A trim (`fromBeat`/`toBeat`) rides
    along untouched by `isolate` and moves no bar except as `normFromTo`
    says. -/
structure BarRange where
  from_ : Int
  to : Int
  deriving DecidableEq, Repr

/-- practice-state.ts:431-437 — the range `isolate(bar, extend)` passes to
    `setRange`, or `none` when it calls nothing (a click inside the range). -/
def isolateArg (r : Option BarRange) (bar : Int) (extend : Bool) : Option BarRange :=
  match extend, r with
  | false, _ => some ⟨bar, bar⟩
  | true, none => some ⟨bar, bar⟩
  | true, some r =>
    if bar < r.from_ then some ⟨bar, r.to⟩
    else if bar > r.to then some ⟨r.from_, bar⟩
    else none

/-- src/core.ts:129-140 — `clampRange`, its `from`/`to`. -/
def clampFromTo (r : BarRange) (bars : Int) : BarRange :=
  let hi := max 0 (bars - 1)
  let a := max 0 (min r.from_ hi)
  let b := max 0 (min r.to hi)
  if a > b then ⟨b, a⟩ else ⟨a, b⟩

/-- src/core.ts:163-180 — `normalizeRange`, its `from`/`to`. `headAtEnd` is
    "`fromBeat` is set and at or past the end of its bar" (line 170),
    `tailAtStart` is "`toBeat` is set and at the start of its bar" (line
    175). -/
def normFromTo (r : BarRange) (bars : Int) (headAtEnd tailAtStart : Bool) : BarRange :=
  let c := clampFromTo r bars
  let from1 := if headAtEnd ∧ c.from_ < c.to then c.from_ + 1 else c.from_
  let to1 := if tailAtStart ∧ c.to > from1 then c.to - 1 else c.to
  ⟨from1, to1⟩

/-- What `setRange` stores in `session.range` always has `from ≤ to`. -/
theorem normFromTo_ordered (r : BarRange) (bars : Int) (h t : Bool) :
    (normFromTo r bars h t).from_ ≤ (normFromTo r bars h t).to := by
  unfold normFromTo clampFromTo
  simp only
  split <;> split <;> split <;> simp_all <;> omega

/-- **`isolate(bar, extend)` keeps `from ≤ to`** (practice-state.ts:426-430,
    "Extending moves only the edge it has to … a click inside the range
    extends nothing"): from a stored range, which is ordered, every range it
    hands to `setRange` is already ordered, moves only one edge, and none is
    handed over for a click inside. -/
theorem isolate_ordered (r : Option BarRange) (bar : Int) (extend : Bool)
    (hr : ∀ r0, r = some r0 → r0.from_ ≤ r0.to) (r' : BarRange)
    (h : isolateArg r bar extend = some r') :
    r'.from_ ≤ r'.to ∧
      (extend = true → ∀ r0, r = some r0 →
        (r'.from_ = r0.from_ ∨ r'.to = r0.to) ∧ r'.from_ ≤ r0.from_ ∧ r0.to ≤ r'.to) := by
  unfold isolateArg at h
  cases extend with
  | false => simp at h; subst h; simp
  | true =>
    cases r with
    | none => simp at h; subst h; simp
    | some r0 =>
      have := hr r0 rfl
      simp only at h
      split at h
      · simp at h; subst h
        refine ⟨by simp; omega, fun _ r1 h1 => ?_⟩
        cases h1; simp; omega
      · split at h
        · simp at h; subst h
          refine ⟨by simp; omega, fun _ r1 h1 => ?_⟩
          cases h1; simp; omega
        · simp at h

theorem isolate_inside_is_noop (r0 : BarRange) (bar : Int)
    (h : r0.from_ ≤ bar ∧ bar ≤ r0.to) : isolateArg (some r0) bar true = none := by
  unfold isolateArg
  have h1 : ¬ bar < r0.from_ := by omega
  have h2 : ¬ bar > r0.to := by omega
  simp [h1, h2]

end Harmonicland.PracticeCursor
