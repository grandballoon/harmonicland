import Harmonicland.Clock
import Harmonicland.Perform

/-!
# Scheduler — `src/scheduler.ts`

Performance × clock → strikes, ahead of time.

## What the model is

`makeScheduler`'s closure state is two numbers and a flag; everything it
does to its `Output` is a list of calls. The model is the functions that
compute those calls — `strikeOf` (the inner `strike`), `dropIns` and
`struckIn` (the two loops of `play`), `pedalAt`, `pedalWithin`, `audition` —
each returning the calls in the order the code makes them.

* scheduler.ts:103-104 `for (const n of perf.notes) { if (n.onset >= s.start)
  break; … }` is `takeWhile`.
* scheduler.ts:110 `for (i = firstAtOrAfter(perf, s.start); i < length &&
  notes[i].onset < s.end; i++)` is `drop` then `takeWhile`.

## What the model leaves out

Floating point; the `Ticker`; the wall clock itself (`wall` is an argument).
The clock the scheduler asks is `Clock.lean`'s, and what `tick` does with its
answer is in the theorems of that file: `ahead_straight_exactly_once` and
the `FAILS_ahead_*` counterexamples.
-/

namespace Harmonicland
namespace Scheduler

/-- src/scheduler.ts:40-45 -/
def TICK_MS : Rat := 25
def LOOKAHEAD_MS : Rat := 100
def LATE_MS : Rat := 50
def MIN_REMAINING_MS : Rat := 60

/-- src/types.ts:172 — `at` is `time`. -/
structure Strike where
  pitch : Int
  velocity : Int
  time : Rat
  off : Option Rat
  damp : Option Rat
  offset : Option Rat
  deriving Repr, DecidableEq

/-- scheduler.ts:87-91 — the object handed to `output.strike`. -/
def mkStrike (n : PerfNote) (time off damp offset : Rat) : Strike :=
  { pitch := n.pitch, velocity := n.velocity, time, off := some off,
    damp := if damp > off then some damp else none,
    offset := if offset > 0 then some offset else none }

/-- src/scheduler.ts:78-92 — `none` where the code returns without striking. -/
def strikeOf (n : PerfNote) (time off damp offset wall : Rat) : Option Strike :=
  if damp - time ≤ 0 then none
  else
    let late := wall - time
    if late > LATE_MS then
      if damp - wall < MIN_REMAINING_MS then none
      else some (mkStrike n wall (max off wall) damp (offset + late / 1000))
    else some (mkStrike n time off damp offset)

/-- scheduler.ts:97 -/
def wallIn (s : Stretch) (t : Rat) : Rat := s.time + (t - s.start) * 1000

/-- scheduler.ts:99 -/
def upTo (s : Stretch) (t : Rat) : Rat := wallIn s (min t s.until_)

/-- scheduler.ts:103-108 — "everything still sounding here". -/
def dropIns (perf : Performance) (s : Stretch) (wall : Rat) : List Strike :=
  (perf.notes.takeWhile (fun n => decide (n.onset < s.start))).filterMap fun n =>
    if min n.damp s.until_ ≤ s.start then none
    else if upTo s n.damp - s.time < MIN_REMAINING_MS then none
    else strikeOf n s.time (max s.time (upTo s n.end_)) (upTo s n.damp) (s.start - n.onset) wall

/-- scheduler.ts:110 — the notes the main loop visits. -/
def visited (perf : Performance) (s : Stretch) : List PerfNote :=
  (perf.notes.drop (firstAtOrAfter perf s.start)).takeWhile (fun n => decide (n.onset < s.end_))

/-- scheduler.ts:110-113 -/
def struckIn (perf : Performance) (s : Stretch) (wall : Rat) : List Strike :=
  (visited perf s).filterMap fun n =>
    strikeOf n (wallIn s n.onset) (upTo s n.end_) (upTo s n.damp) 0 wall

/-- A call to `output.pedal(down, at)`. -/
structure PedalCall where
  down : Bool
  time : Rat
  deriving Repr, DecidableEq

/-- src/scheduler.ts:118-121 -/
def pedalAt (perf : Performance) (s : Stretch) : List PedalCall :=
  ⟨false, s.time⟩ ::
    (if perf.pedal.any (fun r => decide (r.start ≤ s.start) && decide (s.start < r.end_)) then [⟨true, s.time⟩]
     else [])

/-- scheduler.ts:127 -/
structure Change where
  t : Rat
  down : Bool
  deriving Repr, DecidableEq

/-- scheduler.ts:128-132 — the loop that gathers the changes. -/
def changesIn (perf : Performance) (s : Stretch) : List Change :=
  (perf.pedal.takeWhile (fun r => decide (r.start < s.end_))).flatMap fun r =>
    (if r.start ≥ s.start then [⟨r.start, true⟩] else []) ++
      (if r.end_ ≥ s.start ∧ r.end_ < s.end_ ∧ r.end_ < s.until_ then [⟨r.end_, false⟩] else [])

/-- scheduler.ts:133 — `a.t - b.t || Number(a.down) - Number(b.down)`, as "a
    sorts no later than b". -/
def changeLe (a b : Change) : Bool :=
  decide (a.t < b.t) || (decide (a.t = b.t) && (!a.down || b.down))

/-- src/scheduler.ts:126-135 -/
def pedalWithin (perf : Performance) (s : Stretch) : List PedalCall :=
  ((changesIn perf s).mergeSort changeLe).map fun c => ⟨c.down, s.time + (c.t - s.start) * 1000⟩

/-- src/scheduler.ts:157-164, after its `reset()`. -/
def audition (perf : Performance) (t wall : Rat) : List Strike :=
  ((perf.notes.takeWhile (fun n => decide (n.onset ≤ t))).filter (fun n => decide (n.end_ > t))).map fun n =>
    { pitch := n.pitch, velocity := n.velocity, time := wall, off := none, damp := none, offset := none }

/-! # Theorems

## A strike

> "Late ticks: a strike stamped a little in the past is still struck … one
> stamped more than LATE_MS in the past is dropped into, at its offset, like
> a seek — or skipped if it is nearly over." — scheduler.ts:32
-/

/-- **Holds.** Whatever `strike` hands the Output is well formed, given a key
    that comes up no earlier than it goes down: it sounds the note's own pitch
    and velocity, no more than `LATE_MS` in the past; the key goes down no
    later than it comes up; a damper time, when given, is after both; and an
    offset, when given, is positive. -/
theorem strikeOf_wf (n : PerfNote) (time off damp offset wall : Rat) (st : Strike)
    (hoff : time ≤ off)
    (h : strikeOf n time off damp offset wall = some st) :
    st.pitch = n.pitch ∧ st.velocity = n.velocity ∧ wall - LATE_MS ≤ st.time ∧
      (∃ o, st.off = some o ∧ st.time ≤ o ∧ ∀ d, st.damp = some d → o < d) ∧
      (∀ x, st.offset = some x → 0 < x) := by
  unfold strikeOf at h
  split at h
  · cases h
  · simp only at h
    split at h
    · rename_i hlate
      split at h
      · cases h
      · cases h
        refine ⟨rfl, rfl, by simp only [mkStrike]; unfold LATE_MS; grind, ?_, ?_⟩
        · refine ⟨max off wall, rfl, by simp only [mkStrike]; grind, ?_⟩
          intro d hd
          simp only [mkStrike] at hd
          split at hd
          · cases hd; assumption
          · cases hd
        · intro x hx
          simp only [mkStrike] at hx
          split at hx
          · cases hx; assumption
          · cases hx
    · rename_i hlate
      cases h
      refine ⟨rfl, rfl, by simp only [mkStrike]; grind, ?_, ?_⟩
      · refine ⟨off, rfl, hoff, ?_⟩
        intro d hd
        simp only [mkStrike] at hd
        split at hd
        · cases hd; assumption
        · cases hd
      · intro x hx
        simp only [mkStrike] at hx
        split at hx
        · cases hx; assumption
        · cases hx

/-- **Holds.** A note struck in a stretch goes down no later than it comes
    up — even where the stretch stops short of the note's end (a loop wraps) —
    so `strikeOf_wf` applies to every strike of the main loop. A note that
    would begin at or after the pass's end is not struck at all. -/
theorem struck_note_wf (s : Stretch) (n : PerfNote) (wall : Rat) (st : Strike)
    (hn : n.onset ≤ n.end_)
    (h : strikeOf n (wallIn s n.onset) (upTo s n.end_) (upTo s n.damp) 0 wall = some st) :
    n.onset < s.until_ ∧ wallIn s n.onset ≤ upTo s n.end_ := by
  unfold strikeOf at h
  split at h
  · cases h
  · rename_i hpos
    simp only [upTo, wallIn] at hpos ⊢
    constructor <;> grind

/-! ## Which notes a stretch strikes

> "hands the Output every note that starts in it" — scheduler.ts:5
-/

/-- In a list sorted by a key, `takeWhile (key < x)` keeps exactly the
    elements with `key < x`. -/
theorem takeWhile_eq_filter_sorted (l : List PerfNote) (hs : l.Pairwise (fun a b => a.onset ≤ b.onset)) (x : Rat) :
    l.takeWhile (fun n => decide (n.onset < x)) = l.filter (fun n => decide (n.onset < x)) := by
  induction l with
  | nil => rfl
  | cons a rest ih =>
    rw [List.pairwise_cons] at hs
    by_cases ha : a.onset < x
    · simp [ha, ih hs.2]
    · simp only [List.takeWhile_cons, List.filter_cons, ha, decide_false, Bool.false_eq_true, ite_false]
      symm
      rw [List.filter_eq_nil_iff]
      intro b hb
      have := hs.1 b hb
      simp only [decide_eq_true_eq]; grind

/-- Dropping the notes before the index `firstAtOrAfter` finds keeps exactly
    the notes that begin at or after `t`. -/
theorem drop_eq_filter_sorted (l : List PerfNote) (t : Rat) (i : Nat)
    (hbefore : ∀ j (hj : j < l.length), j < i → l[j].onset < t)
    (hafter : ∀ j (hj : j < l.length), i ≤ j → t ≤ l[j].onset) :
    l.drop i = l.filter (fun n => decide (t ≤ n.onset)) := by
  induction l generalizing i with
  | nil => simp
  | cons a rest ih =>
    cases i with
    | zero =>
      simp only [List.drop_zero]
      symm
      rw [List.filter_eq_self]
      intro b hb
      obtain ⟨j, hj, rfl⟩ := List.getElem_of_mem hb
      simpa using hafter j hj (Nat.zero_le _)
    | succ i =>
      have h0 := hbefore 0 (by simp) (by omega)
      simp only [List.getElem_cons_zero] at h0
      have : ¬ t ≤ a.onset := by grind
      simp only [List.drop_succ_cons, List.filter_cons, this, decide_false, Bool.false_eq_true, ite_false]
      apply ih
      · intro j hj hlt; exact hbefore (j + 1) (by simpa using hj) (by omega)
      · intro j hj hle; exact hafter (j + 1) (by simpa using hj) (by omega)

/-- **Holds.** The notes a stretch's main loop visits are exactly "every note
    that starts in it": those with `start ≤ onset < end`, in score order —
    on a performance sorted by onset (`perform_sorted`). -/
theorem visited_spec (perf : Performance) (hs : perf.notes.Pairwise (fun a b => a.onset ≤ b.onset)) (s : Stretch) :
    visited perf s =
      perf.notes.filter (fun n => decide (s.start ≤ n.onset) && decide (n.onset < s.end_)) := by
  obtain ⟨_, h1, h2⟩ := firstAtOrAfter_spec perf hs s.start
  unfold visited
  rw [drop_eq_filter_sorted perf.notes s.start _ h1 h2]
  rw [takeWhile_eq_filter_sorted _ (List.Pairwise.sublist List.filter_sublist hs)]
  rw [List.filter_filter]
  apply List.filter_congr
  intro n _
  rw [Bool.and_comm]

/-- **Holds.** With no loop, contiguous windows visit "every note … exactly
    once": the notes the two windows `[w0, w1)` and `[w1, w2)` visit are,
    together and in order, the notes the one window `[w0, w2)` visits. -/
theorem windows_visit_once (c : Clock) (d : Rat) (perf : Performance)
    (hs : perf.notes.Pairwise (fun a b => a.onset ≤ b.onset))
    (w0 w1 w2 : Rat) (hp : c.playing = true) (hl : looping c = false)
    (hw0 : c.startedAt ≤ w0) (h01 : w0 < w1) (h12 : w1 < w2) (n : PerfNote) (hn : n ∈ perf.notes) :
    ((∃ s ∈ ahead c d w0 w1, n ∈ visited perf s) ∨ (∃ s ∈ ahead c d w1 w2, n ∈ visited perf s) ↔
        ∃ s ∈ ahead c d w0 w2, n ∈ visited perf s) ∧
      ¬ ((∃ s ∈ ahead c d w0 w1, n ∈ visited perf s) ∧ (∃ s ∈ ahead c d w1 w2, n ∈ visited perf s)) := by
  have key : ∀ l : List Stretch, (∃ s ∈ l, n ∈ visited perf s) ↔ Covers l n.onset := by
    intro l
    simp only [Covers, visited_spec perf hs, List.mem_filter, hn, true_and, Bool.and_eq_true, decide_eq_true_eq]
  rw [key, key, key]
  have := ahead_straight_exactly_once c d w0 w1 w2 n.onset hp hl hw0 h01 h12
  exact ⟨this.1.symm, this.2⟩

/-! ## The pedal

> "The pedal's changes inside a stretch, in time order — a change's up
> before its down." — scheduler.ts:123
-/

theorem changeLe_trans (a b c : Change) (h1 : changeLe a b = true) (h2 : changeLe b c = true) :
    changeLe a c = true := by
  unfold changeLe at *
  simp only [Bool.or_eq_true, Bool.and_eq_true, decide_eq_true_eq, Bool.not_eq_true'] at *
  rcases h1 with h1 | ⟨e1, d1⟩ <;> rcases h2 with h2 | ⟨e2, d2⟩
  · left; grind
  · left; grind
  · left; grind
  · right; refine ⟨by grind, ?_⟩
    cases ha : a.down <;> cases hb : b.down <;> cases hc : c.down <;> simp_all

theorem changeLe_total (a b : Change) : (changeLe a b || changeLe b a) = true := by
  unfold changeLe
  simp only [Bool.or_eq_true, Bool.and_eq_true, decide_eq_true_eq, Bool.not_eq_true']
  by_cases h : a.t < b.t
  · left; left; exact h
  · by_cases h' : b.t < a.t
    · right; left; exact h'
    · have e : a.t = b.t := Rat.le_antisymm (Rat.not_lt.mp h') (Rat.not_lt.mp h)
      cases ha : a.down <;> cases hb : b.down <;> simp_all

/-- **Holds.** The pedal calls inside a stretch are made "in time order — a
    change's up before its down". -/
theorem pedalWithin_ordered (perf : Performance) (s : Stretch) :
    (pedalWithin perf s).Pairwise
      (fun a b => a.time < b.time ∨ (a.time = b.time ∧ (a.down = true → b.down = true))) := by
  unfold pedalWithin
  rw [List.pairwise_map]
  have := List.pairwise_mergeSort (le := changeLe) changeLe_trans changeLe_total (changesIn perf s)
  apply this.imp
  intro a b h
  unfold changeLe at h
  simp only [Bool.or_eq_true, Bool.and_eq_true, decide_eq_true_eq, Bool.not_eq_true'] at h
  rcases h with h | ⟨e, hd⟩
  · left; grind
  · right; refine ⟨by rw [e], ?_⟩
    intro ha
    have ha' : a.down = true := ha
    rcases hd with hd | hd
    · rw [ha'] at hd; cases hd
    · exact hd

/-! ## audition

> "Sound the notes under a parked playhead" — scheduler.ts:59
-/

/-- **Holds.** `audition(t)` strikes one note for each performed note whose
    key is down at `t` — `onset ≤ t < end` — on a performance sorted by onset. -/
theorem audition_spec (perf : Performance) (hs : perf.notes.Pairwise (fun a b => a.onset ≤ b.onset))
    (t wall : Rat) :
    (audition perf t wall).map (fun st => (st.pitch, st.velocity)) =
      (perf.notes.filter (fun n => decide (n.onset ≤ t) && decide (t < n.end_))).map
        (fun n => (n.pitch, n.velocity)) := by
  have tw : perf.notes.takeWhile (fun n => decide (n.onset ≤ t)) =
      perf.notes.filter (fun n => decide (n.onset ≤ t)) := by
    generalize perf.notes = l at hs
    induction l with
    | nil => rfl
    | cons a rest ih =>
      rw [List.pairwise_cons] at hs
      by_cases ha : a.onset ≤ t
      · simp [ha, ih hs.2]
      · simp only [List.takeWhile_cons, List.filter_cons, ha, decide_false, Bool.false_eq_true, ite_false]
        symm
        rw [List.filter_eq_nil_iff]
        intro b hb
        have := hs.1 b hb
        simp only [decide_eq_true_eq]; grind
  unfold audition
  rw [tw, List.filter_filter, List.map_map]
  congr 1
  apply List.filter_congr
  intro n _
  rw [Bool.and_comm]

end Scheduler
end Harmonicland
