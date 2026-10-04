/-!
# PedalMarks — `src/inputs/pedal.ts`

`pedalRanges`: a source's sustain-pedal down/up marks, in the order the parser
met them, become the ranges the pedal is down.

## What the model is

A line-by-line translation of `pedalRanges` (pedal.ts:20-34). Score time
(`PedalMark.at`, `TimeRange.start/end`) is `Rat`. The `for` loop over the sorted
marks is a `foldl` of `step` over a two-field state record (`out`, `downAt`).

## What the model leaves out

* Floating-point rounding and `NaN` times. (`a.m.at - b.m.at` on a `NaN` time
  makes the comparator inconsistent; nothing here speaks about that.)
* `Infinity`. The one `Infinity` the code produces — `end: Infinity` for a
  pedal never lifted (pedal.ts:32) — is the explicit open end `end_ = none`.
* `Array.prototype.sort` is modelled by `List.mergeSort`. The comparator
  (pedal.ts:22) breaks ties on the source index, so it is a strict total order
  on the indexed marks and every correct sort returns the same list.
* Names Lean reserves: `at` is `time`, `end` is `end_`.
-/

namespace Harmonicland.PedalMarks

/-- src/inputs/pedal.ts:15 -/
structure PedalMark where
  time : Rat
  down : Bool
  deriving DecidableEq, Repr

/-- src/types.ts:135 — `end_ = none` is `Infinity` (pedal.ts:32). -/
structure TimeRange where
  start : Rat
  end_ : Option Rat
  deriving DecidableEq, Repr

/-- src/inputs/pedal.ts:22 — the comparator `a.m.at - b.m.at || a.i - b.i`,
    as "is ≤ 0". The pair is `{ m, i }`. -/
def le (a b : PedalMark × Nat) : Bool :=
  decide (a.1.time < b.1.time) || (decide (a.1.time = b.1.time) && decide (a.2 ≤ b.2))

/-- src/inputs/pedal.ts:22 — `marks.map((m, i) => ({ m, i })).sort(...)`. -/
def sorted (marks : List PedalMark) : List (PedalMark × Nat) :=
  marks.zipIdx.mergeSort le

/-- The loop's mutable state (pedal.ts:23-24). -/
structure St where
  out : List TimeRange
  downAt : Option Rat
  deriving DecidableEq, Repr

/-- src/inputs/pedal.ts:26-30 — one turn of the loop. -/
def step (st : St) (m : PedalMark) : St :=
  if m.down && st.downAt.isNone then { st with downAt := some m.time }
  else
    match st.downAt with
    | some d =>
      if !m.down then { out := st.out ++ [{ start := d, end_ := some m.time }], downAt := none }
      else st
    | none => st

/-- src/inputs/pedal.ts:25-31 — the whole loop. -/
def scan (ms : List PedalMark) : St := ms.foldl step { out := [], downAt := none }

/-- src/inputs/pedal.ts:32-33 — close a pedal still down, and return. -/
def finish (st : St) : List TimeRange :=
  match st.downAt with
  | some d => st.out ++ [{ start := d, end_ := none }]
  | none => st.out

/-- src/inputs/pedal.ts:20 -/
def pedalRanges (marks : List PedalMark) : List TimeRange :=
  finish (scan ((sorted marks).map (·.1)))

/-! ## The sort -/

theorem le_trans' (a b c : PedalMark × Nat) : le a b = true → le b c = true → le a c = true := by
  simp only [le, Bool.or_eq_true, Bool.and_eq_true, decide_eq_true_eq]
  intro h1 h2
  rcases h1 with h1 | ⟨h1, h1'⟩ <;> rcases h2 with h2 | ⟨h2, h2'⟩
  · left; grind
  · left; grind
  · left; grind
  · right; exact ⟨by grind, by omega⟩

theorem le_total' (a b : PedalMark × Nat) : (le a b || le b a) = true := by
  simp only [le, Bool.or_eq_true, Bool.and_eq_true, decide_eq_true_eq]
  by_cases h : a.1.time < b.1.time
  · exact Or.inl (Or.inl h)
  · by_cases h' : b.1.time < a.1.time
    · exact Or.inr (Or.inl h')
    · have e : a.1.time = b.1.time := by grind
      by_cases hi : a.2 ≤ b.2
      · exact Or.inl (Or.inr ⟨e, hi⟩)
      · exact Or.inr (Or.inr ⟨e.symm, by omega⟩)

/-- pedal.ts:21 "a stable sort: marks at one instant stay in the order they
    were met" — the sorted list is in time order, and marks at one instant are
    in source-index order. -/
theorem sorted_pairwise (marks : List PedalMark) :
    (sorted marks).Pairwise
      (fun a b => a.1.time < b.1.time ∨ (a.1.time = b.1.time ∧ a.2 ≤ b.2)) := by
  have h := List.pairwise_mergeSort (le := le) le_trans' le_total' marks.zipIdx
  refine List.Pairwise.imp ?_ h
  intro a b hab
  simpa [le] using hab

/-- The sort loses and invents no mark. -/
theorem sorted_perm (marks : List PedalMark) : (sorted marks).Perm marks.zipIdx :=
  List.mergeSort_perm _ _

/-- The marks the loop walks are in time order. -/
theorem sorted_times (marks : List PedalMark) :
    ((sorted marks).map (·.1)).Pairwise (fun a b => a.time ≤ b.time) := by
  rw [List.pairwise_map]
  refine List.Pairwise.imp ?_ (sorted_pairwise marks)
  intro a b h
  rcases h with h | ⟨h, _⟩ <;> grind

/-! ## "A down while down and an up while up change nothing" (pedal.ts:9-10) -/

/-- pedal.ts:9 "A down while down ... change[s] nothing". -/
theorem down_while_down (out : List TimeRange) (d t : Rat) :
    step { out := out, downAt := some d } { time := t, down := true }
      = { out := out, downAt := some d } := by
  simp [step]

/-- pedal.ts:10 "... and an up while up change nothing". -/
theorem up_while_up (out : List TimeRange) (t : Rat) :
    step { out := out, downAt := none } { time := t, down := false }
      = { out := out, downAt := none } := by
  simp [step]

/-- A mark is redundant in a state: a down while down, or an up while up. -/
def Redundant (st : St) (m : PedalMark) : Prop := m.down = st.downAt.isSome

theorem step_redundant (st : St) (m : PedalMark) (h : Redundant st m) : step st m = st := by
  unfold Redundant at h
  cases hd : st.downAt <;> cases hm : m.down <;> simp_all [step]

/-- pedal.ts:9-10, for the whole loop: a redundant mark anywhere in the walk
    can be deleted without changing what comes out. -/
theorem scan_redundant (pre post : List PedalMark) (m : PedalMark)
    (h : Redundant (scan pre) m) :
    finish (scan (pre ++ m :: post)) = finish (scan (pre ++ post)) := by
  unfold scan at *
  simp only [List.foldl_append, List.foldl_cons]
  rw [step_redundant _ _ h]

/-! ## "A pedal CHANGE ... two ranges that touch" (pedal.ts:7-9) -/

/-- pedal.ts:7-9 "a pedal CHANGE — up then down at the same moment — come[s]
    out as two ranges that touch rather than one that never lifts": while the
    pedal is down since `d`, an up and then a down at `t` closes `[d, t)` and
    leaves the pedal down since `t`. -/
theorem change_while_down (out : List TimeRange) (d t : Rat) :
    step (step { out := out, downAt := some d } { time := t, down := false })
        { time := t, down := true }
      = { out := out ++ [{ start := d, end_ := some t }], downAt := some t } := by
  simp [step]

/-- The source order is what does it (pedal.ts:7): the same two marks met the
    other way round — down then up — lift the pedal and leave it up. -/
theorem down_then_up_while_down (out : List TimeRange) (d t : Rat) :
    step (step { out := out, downAt := some d } { time := t, down := true })
        { time := t, down := false }
      = { out := out ++ [{ start := d, end_ := some t }], downAt := none } := by
  simp [step]

/-- pedal.test.ts:13 "keeps a change — up and down at one instant — as two
    ranges that touch", for every `a < t < b` and through the real sort. -/
theorem change_gives_touching_ranges (a t b : Rat) (h1 : a < t) (h2 : t < b) :
    pedalRanges [⟨a, true⟩, ⟨t, false⟩, ⟨t, true⟩, ⟨b, false⟩]
      = [⟨a, some t⟩, ⟨t, some b⟩] := by
  have hs : sorted [⟨a, true⟩, ⟨t, false⟩, ⟨t, true⟩, ⟨b, false⟩]
      = [(⟨a, true⟩, 0), (⟨t, false⟩, 1), (⟨t, true⟩, 2), (⟨b, false⟩, 3)] := by
    unfold sorted
    apply List.mergeSort_of_pairwise
    simp [List.zipIdx, le]
    grind
  simp [pedalRanges, hs, scan, step, finish]

/-! ## Sorted, non-overlapping, and only the last range open -/

/-- What the loop keeps true, given the marks still to come: the ranges out so
    far are closed, non-empty-or-point, in order without overlap, and end no
    later than the pedal's current press and every mark still to come. -/
def Good (st : St) (rest : List PedalMark) : Prop :=
  st.out.Pairwise (fun r s => ∃ e, r.end_ = some e ∧ e ≤ s.start)
  ∧ (∀ r ∈ st.out, ∃ e, r.end_ = some e ∧ r.start ≤ e
        ∧ (∀ m ∈ rest, e ≤ m.time) ∧ (∀ d, st.downAt = some d → e ≤ d))
  ∧ (∀ d, st.downAt = some d → ∀ m ∈ rest, d ≤ m.time)

theorem good_keep (st : St) (m : PedalMark) (rest : List PedalMark)
    (hg : Good st (m :: rest)) : Good st rest := by
  obtain ⟨hp, hr, hd⟩ := hg
  refine ⟨hp, ?_, ?_⟩
  · intro r hrm
    obtain ⟨e, he, hse, hrest, hed⟩ := hr r hrm
    exact ⟨e, he, hse, fun x hx => hrest x (List.mem_cons_of_mem _ hx), hed⟩
  · intro d hd' x hx
    exact hd d hd' x (List.mem_cons_of_mem _ hx)

theorem good_step (st : St) (m : PedalMark) (rest : List PedalMark)
    (hs : (m :: rest).Pairwise (fun a b => a.time ≤ b.time)) (hg : Good st (m :: rest)) :
    Good (step st m) rest := by
  have hkeep := good_keep st m rest hg
  obtain ⟨hp, hr, hd⟩ := hg
  have hm : ∀ x ∈ rest, m.time ≤ x.time := (List.pairwise_cons.mp hs).1
  cases hdn : st.downAt with
  | none =>
    cases hmd : m.down with
    | false =>
      have : step st m = st := by simp [step, hdn, hmd]
      rw [this]; exact hkeep
    | true =>
      -- a down while up
      have : step st m = { st with downAt := some m.time } := by simp [step, hdn, hmd]
      rw [this]
      refine ⟨hp, ?_, ?_⟩
      · intro r hrm
        obtain ⟨e, he, hse, hrest, _⟩ := hr r hrm
        refine ⟨e, he, hse, fun x hx => hrest x (List.mem_cons_of_mem _ hx), ?_⟩
        intro d hd'
        simp at hd'
        subst hd'
        exact hrest m List.mem_cons_self
      · intro d hd' x hx
        simp at hd'
        subst hd'
        exact hm x hx
  | some d =>
    cases hmd : m.down with
    | true =>
      have : step st m = st := by simp [step, hdn, hmd]
      rw [this]; exact hkeep
    | false =>
      -- an up while down: a range is pushed
      have : step st m
          = { out := st.out ++ [{ start := d, end_ := some m.time }], downAt := none } := by
        simp [step, hdn, hmd]
      rw [this]
      have hdm : d ≤ m.time := hd d hdn m List.mem_cons_self
      refine ⟨?_, ?_, ?_⟩
      · show List.Pairwise _ (st.out ++ [_])
        rw [List.pairwise_append]
        refine ⟨hp, by simp, ?_⟩
        intro r hrm s hsm
        obtain ⟨e, he, _, _, hed⟩ := hr r hrm
        simp at hsm
        subst hsm
        exact ⟨e, he, hed d hdn⟩
      · intro r hrm
        have hrm' : r ∈ st.out ++ [{ start := d, end_ := some m.time }] := hrm
        rw [List.mem_append] at hrm'
        rcases hrm' with hrm' | hrm'
        · obtain ⟨e, he, hse, hrest, _⟩ := hr r hrm'
          exact ⟨e, he, hse, fun x hx => hrest x (List.mem_cons_of_mem _ hx), by simp⟩
        · simp at hrm'
          subst hrm'
          exact ⟨m.time, rfl, hdm, hm, by simp⟩
      · simp

theorem good_foldl (ms : List PedalMark) (st : St)
    (hs : ms.Pairwise (fun a b => a.time ≤ b.time)) (hg : Good st ms) :
    Good (ms.foldl step st) [] := by
  induction ms generalizing st with
  | nil => exact hg
  | cons m rest ih =>
    exact ih (step st m) (List.pairwise_cons.mp hs).2 (good_step st m rest hs hg)

theorem good_scan (marks : List PedalMark) :
    Good (scan ((sorted marks).map (·.1))) [] := by
  apply good_foldl _ _ (sorted_times marks)
  simp [Good]

/-- The pedal ranges come out sorted and non-overlapping, and only the last
    can be open (pedal.ts:1-11; `Score.pedal` relies on it, and
    pedal.test.ts:6 "pairs downs with ups, in time order whatever order they
    were met"): every range before another is closed, and ends no later than
    the other starts. -/
theorem pedalRanges_sorted_disjoint (marks : List PedalMark) :
    (pedalRanges marks).Pairwise (fun r s => ∃ e, r.end_ = some e ∧ e ≤ s.start) := by
  obtain ⟨hp, hr, _⟩ := good_scan marks
  unfold pedalRanges finish
  split
  · rename_i d hdn
    rw [List.pairwise_append]
    refine ⟨hp, by simp, ?_⟩
    intro r hrm s hsm
    obtain ⟨e, he, _, _, hed⟩ := hr r hrm
    simp at hsm
    subst hsm
    exact ⟨e, he, hed d hdn⟩
  · exact hp

/-- No range runs backwards: a closed range ends at or after its start. (It
    may be a point — a down and an up at one instant, in that order — which
    `makeScore` drops.) -/
theorem pedalRanges_start_le_end (marks : List PedalMark) :
    ∀ r ∈ pedalRanges marks, ∀ e, r.end_ = some e → r.start ≤ e := by
  obtain ⟨_, hr, _⟩ := good_scan marks
  intro r hrm e he
  unfold pedalRanges finish at hrm
  split at hrm
  · rw [List.mem_append] at hrm
    rcases hrm with hrm | hrm
    · obtain ⟨e', he', hse, _, _⟩ := hr r hrm
      rw [he] at he'
      cases he'
      exact hse
    · simp at hrm
      subst hrm
      simp at he
  · obtain ⟨e', he', hse, _, _⟩ := hr r hrm
    rw [he] at he'
    cases he'
    exact hse

/-! ## "a pedal still down at the end is held to the end" (pedal.ts:10-11) -/

/-- pedal.ts:10-11 "a pedal still down at the end is held to the end of the
    piece": when the loop ends with the pedal down since `d`, the last range
    is `[d, ∞)`. -/
theorem still_down_is_held_open (marks : List PedalMark) (d : Rat)
    (h : (scan ((sorted marks).map (·.1))).downAt = some d) :
    (pedalRanges marks).getLast? = some { start := d, end_ := none } := by
  simp [pedalRanges, finish, h]

/-- ... and when it ends with the pedal up, every range is closed. -/
theorem up_at_end_all_closed (marks : List PedalMark)
    (h : (scan ((sorted marks).map (·.1))).downAt = none) :
    ∀ r ∈ pedalRanges marks, r.end_ ≠ none := by
  obtain ⟨_, hr, _⟩ := good_scan marks
  intro r hrm
  simp only [pedalRanges, finish, h] at hrm
  obtain ⟨e, he, _⟩ := hr r hrm
  simp [he]

/-- A down mark always leaves the pedal down. -/
theorem step_down_is_down (st : St) (m : PedalMark) (h : m.down = true) :
    (step st m).downAt.isSome = true := by
  unfold step
  cases hd : st.downAt <;> simp [h, hd]

/-- pedal.ts:10-11 from the marks' side: if the mark latest in time (last in
    source order among those) is a down, the last range is open. -/
theorem last_mark_down_is_held_open (marks : List PedalMark) (m : PedalMark) (i : Nat)
    (hl : (sorted marks).getLast? = some (m, i)) (hd : m.down = true) :
    ∃ d, (pedalRanges marks).getLast? = some { start := d, end_ := none } := by
  obtain ⟨pre, hpre⟩ : ∃ pre, sorted marks = pre ++ [(m, i)] := by
    rcases List.eq_nil_or_concat (sorted marks) with h | ⟨pre, x, h⟩
    · simp [h] at hl
    · rw [h] at hl
      simp at hl
      exact ⟨pre, by rw [h, hl]; simp⟩
  have hsome : (scan ((sorted marks).map (·.1))).downAt.isSome = true := by
    rw [hpre]
    simp only [scan, List.map_append, List.map_cons, List.map_nil, List.foldl_append,
      List.foldl_cons, List.foldl_nil]
    exact step_down_is_down _ _ hd
  obtain ⟨d, hd'⟩ := Option.isSome_iff_exists.mp hsome
  exact ⟨d, still_down_is_held_open marks d hd'⟩

/-! ## The test file's cases, run through the model (pedal.test.ts) -/

set_option linter.unusedSimpArgs false

/-- pedal.test.ts:6 -/
example : pedalRanges [⟨3, true⟩, ⟨4, false⟩, ⟨0, true⟩, ⟨1, false⟩]
    = [⟨0, some 1⟩, ⟨3, some 4⟩] := by
  simp +decide [pedalRanges, sorted, List.mergeSort, List.MergeSort.Internal.splitInTwo, List.merge,
    List.zipIdx, le, scan, step, finish]

/-- pedal.test.ts:13 -/
example : pedalRanges [⟨0, true⟩, ⟨2, false⟩, ⟨2, true⟩, ⟨4, false⟩]
    = [⟨0, some 2⟩, ⟨2, some 4⟩] := by
  simp +decide [pedalRanges, sorted, List.mergeSort, List.MergeSort.Internal.splitInTwo, List.merge,
    List.zipIdx, le, scan, step, finish]

/-- pedal.test.ts:19 -/
example : pedalRanges [⟨0, false⟩, ⟨1, true⟩, ⟨2, true⟩, ⟨3, false⟩, ⟨5, false⟩]
    = [⟨1, some 3⟩] := by
  simp +decide [pedalRanges, sorted, List.mergeSort, List.MergeSort.Internal.splitInTwo, List.merge,
    List.zipIdx, le, scan, step, finish]

/-- pedal.test.ts:25 (the `pedalRanges` half) -/
example : pedalRanges [⟨1, true⟩] = [⟨1, none⟩] := by
  simp +decide [pedalRanges, sorted, List.mergeSort, List.MergeSort.Internal.splitInTwo, List.merge,
    List.zipIdx, le, scan, step, finish]

end Harmonicland.PedalMarks
