import Harmonicland.Steps

/-!
# Loop and Backchain — `src/loop.ts`, `src/backchain.ts`

Where the playback loop's edges go, where a step lands, and a section learned
from its end.

## What the model is

A line-by-line translation over `Core.lean` and `Steps.lean`. `dir: 1 | -1`
is `forward : Bool`. A `null` loop or range is `none`.

## What the model leaves out

Floating point (see `Core.lean`). `Math.max(...[])` is `-Infinity` in
JavaScript; `landing` of a step with no attacks is `0` here, and no theorem
uses it — `makeSteps_attack` shows such a step is never built.
-/

namespace Harmonicland

/-- src/loop.ts:42 -/
inductive Edge where
  | start | end_
  deriving DecidableEq, Repr

/-- src/loop.ts:51 — `Math.max(...s.attack.map((n) => n.onset))`. -/
def landing (s : Step) : Rat :=
  match s.attack with
  | n :: rest => rest.foldl (fun m x => max m x.onset) n.onset
  | [] => 0

/-- loop.ts:62 — the steps a loop confines. -/
def insideOf (steps : List Step) (loop : Option TimeRange) : List Step :=
  match loop with
  | some l => steps.filter (fun s => decide (s.time ≥ l.start - EPS) && decide (s.time < l.end_ - EPS))
  | none => steps

/-- src/loop.ts:59-70 -/
def stepFrom (steps : List Step) (t : Rat) (forward : Bool) (loop : Option TimeRange) : Option Rat :=
  let inside := insideOf steps loop
  if inside.length = 0 then none
  else
    let hit :=
      if forward then inside.find? (fun s => decide (landing s > t + EPS))
      else inside.reverse.find? (fun s => decide (landing s < t - EPS))
    match hit with
    | some s => some (landing s)
    | none =>
      match loop with
      | none => none
      | some _ => (if forward then inside.head? else inside.getLast?).map landing

/-- src/loop.ts:79-95 -/
def withEdge (score : Score) (range : Option BarRange) (edge : Edge) (t : Rat) : BarRange :=
  let last : Int := score.bars.length - 1
  let cur : BarRange := range.getD { from_ := 0, to := last }
  let span := barTime score (some cur)
  let b := barAt score t
  let beat := beatOfTime b t
  match edge with
  | .start =>
    let fromBeat := if t > b.start + EPS ∧ t < b.end_ - EPS then some beat else none
    if t < span.end_ - EPS then { from_ := b.index, fromBeat, to := cur.to, toBeat := cur.toBeat }
    else { from_ := b.index, fromBeat, to := last, toBeat := none }
  | .end_ =>
    let tail : Int × Option Rat :=
      if t ≤ b.start + EPS then (max 0 ((b.index : Int) - 1), none)
      else if t ≥ b.end_ - EPS then (b.index, none)
      else (b.index, some beat)
    if t > span.start + EPS then { from_ := cur.from_, fromBeat := cur.fromBeat, to := tail.1, toBeat := tail.2 }
    else { from_ := 0, fromBeat := none, to := tail.1, toBeat := tail.2 }

/-- src/loop.ts:99-100 -/
def withBar (score : Score) (range : Option BarRange) (edge : Edge) (bar : Nat) : BarRange :=
  let b := score.bars.getD bar default
  withEdge score range edge (match edge with | .start => b.start | .end_ => b.end_)

/-- loop.ts:108-109 — `i`, as the count of leading steps at or before `t`
    (`i + 1`), so that "before the first step" is `0`, not `-1`. -/
def stepsUpTo (steps : List Step) (t : Rat) : Nat :=
  match steps with
  | s :: rest => if s.time ≤ t + EPS then stepsUpTo rest t + 1 else 0
  | [] => 0

/-- src/loop.ts:107-114 -/
def stepEdge (score : Score) (steps : List Step) (t : Rat) (edge : Edge) : Rat :=
  let k := stepsUpTo steps t
  if k = 0 then
    match edge with
    | .start => (barAt score t).start
    | .end_ => (barAt score t).end_
  else
    let cur := (steps.getD (k - 1) ⟨0, 0, [], [], []⟩).time
    match edge with
    | .start => cur
    | .end_ =>
      let next := match steps[k]? with
        | some s => s.time
        | none => score.duration
      min next (barAt score cur).end_

/-- loop.ts:127 — `candidates.reduce((best, x) => |x - t| < |best - t| ? x : best)`. -/
def nearest (t : Rat) (first : Rat) (rest : List Rat) : Rat :=
  rest.foldl (fun best x => if absR (x - t) < absR (best - t) then x else best) first

/-- src/loop.ts:119-128 -/
def snapFine (score : Score) (steps : List Step) (t : Rat) (edge : Edge) (range : Option BarRange) : Rat :=
  let span := barTime score range
  let lines := score.bars.map (fun b => match edge with | .start => b.start | .end_ => b.end_)
  let ok := fun (x : Rat) =>
    match edge with
    | .start => decide (x < span.end_ - EPS)
    | .end_ => decide (x > span.start + EPS)
  let candidates := (lines ++ steps.map (·.time)).filter ok
  match candidates with
  | [] => (match edge with | .start => span.start | .end_ => span.end_)
  | first :: rest => nearest t first rest

/-- loop.ts:142 — the `for` loop, from `i` up to and including `hi`. -/
def snapBarGo (line : Nat → Rat) (t : Rat) (best : Nat) : List Nat → Nat
  | [] => best
  | i :: rest =>
    snapBarGo line t (if absR (line i - t) < absR (line best - t) then i else best) rest

/-- src/loop.ts:135-144 -/
def snapBar (bars : List Bar) (t : Rat) (edge : Edge) (range : Option BarRange) : Nat :=
  let cur : BarRange := range.getD { from_ := 0, to := (bars.length : Int) - 1 }
  let line := fun (i : Nat) =>
    match edge with
    | .start => (bars.getD i default).start
    | .end_ => (bars.getD i default).end_
  let lo : Nat := match edge with | .start => 0 | .end_ => cur.from_.toNat
  let hi : Nat := match edge with | .start => cur.to.toNat | .end_ => bars.length - 1
  snapBarGo line t lo (List.range' lo (hi + 1 - lo))

/-! ## Backchain — src/backchain.ts -/

/-- backchain.ts:46 — `normalizeRange(score, range ?? { from: 0, to: bars.length - 1 })`. -/
def wholeOf (score : Score) (range : Option BarRange) : BarRange :=
  normalizeRange score (range.getD { from_ := 0, to := (score.bars.length : Int) - 1 })

/-- src/backchain.ts:55-58 -/
def added (score : Score) (steps : List Step) (range : Option BarRange) : List Step :=
  let span := barTime score (some (wholeOf score range))
  (steps.filter (fun s => decide (s.time ≥ span.start - EPS) && decide (s.time < span.end_ - EPS))).reverse

/-- backchain.ts:49 — `if (out.length > 0 && !sameRange(out[last], whole)) out[last] = whole`. -/
def setLast (out : List BarRange) (whole : BarRange) : List BarRange :=
  match out.getLast? with
  | none => out
  | some l => if sameRange (some l) (some whole) then out else out.dropLast ++ [whole]

/-- src/backchain.ts:45-51 -/
def links (score : Score) (steps : List Step) (range : Option BarRange) : List BarRange :=
  let whole := wholeOf score range
  let out := (added score steps range).map
    (fun s => normalizeRange score (withEdge score (some whole) .start s.time))
  setLast out whole

/-- backchain.ts:64-65 — the `for` loop, over the candidate indices in order. -/
def nextInHandGo (adds : List Step) (hand : HandFilter) (fallback : Nat) : List Nat → Nat
  | [] => fallback
  | i :: rest =>
    match adds[i]? with
    | some s => if s.attack.any (fun n => inHand n hand) then i else nextInHandGo adds hand fallback rest
    | none => nextInHandGo adds hand fallback rest

/-- src/backchain.ts:63-67 — the indices `at + dir, at + 2·dir, …` while in range. -/
def nextInHand (adds : List Step) (at_ : Nat) (forward : Bool) (hand : HandFilter) : Nat :=
  let candidates :=
    if forward then List.range' (at_ + 1) (adds.length - (at_ + 1))
    else (List.range (min at_ adds.length)).reverse
  nextInHandGo adds hand at_ candidates

/-! # Theorems

## landing

> "A STEP LANDS ON ITS LAST ATTACK … and the view moves by at most 30ms"
> — loop.ts:13
-/

theorem foldl_max_onset_mem (init : Rat) (l : List Note) :
    l.foldl (fun m x => max m x.onset) init = init ∨
      ∃ n ∈ l, l.foldl (fun m x => max m x.onset) init = n.onset := by
  induction l generalizing init with
  | nil => left; rfl
  | cons a l ih =>
    simp only [List.foldl_cons]
    rcases ih (max init a.onset) with h | ⟨n, hn, h⟩
    · rw [h]
      by_cases hm : init ≤ a.onset
      · right; exact ⟨a, by simp, by grind⟩
      · left; grind
    · right; exact ⟨n, by simp [hn], h⟩

/-- **Holds.** A step's landing is the onset of one of its attacks, and no
    attack is later. -/
theorem landing_spec (s : Step) (hne : s.attack ≠ []) :
    (∃ n ∈ s.attack, landing s = n.onset) ∧ ∀ n ∈ s.attack, n.onset ≤ landing s := by
  unfold landing
  cases h : s.attack with
  | nil => exact absurd h hne
  | cons a rest =>
    simp only
    refine ⟨?_, ?_⟩
    · rcases foldl_max_onset_mem a.onset rest with e | ⟨n, hn, e⟩
      · exact ⟨a, by simp, e⟩
      · exact ⟨n, by simp [hn], e⟩
    · intro n hn
      rcases List.mem_cons.mp hn with rfl | hn
      · exact foldl_max_ge_init (fun (x : Note) => x.onset) rest n.onset
      · exact foldl_max_ge_mem (fun (x : Note) => x.onset) rest a.onset n hn

/-- **Holds.** For a step `makeSteps` built, the landing is within `GROUP_SEC`
    — "at most 30ms" — after the step's `at`. -/
theorem landing_near (score : Score) (hand : HandFilter)
    (hs : score.notes.Pairwise (fun a b => a.onset ≤ b.onset)) (s : Step) (h : s ∈ makeSteps score hand) :
    s.time ≤ landing s ∧ landing s ≤ s.time + GROUP_SEC := by
  obtain ⟨hne, hin⟩ := makeSteps_attack score hand hs s h
  obtain ⟨⟨n, hn, e⟩, _⟩ := landing_spec s hne
  rw [e]; exact hin n hn

/-- **Holds only under a hypothesis the code does not enforce:** every note
    of the step lasts longer than `GROUP_SEC`. Then, "Parked on the last
    [attack], every attack is sounding" (loop.ts:16). -/
theorem landing_all_sounding (score : Score) (hand : HandFilter)
    (hs : score.notes.Pairwise (fun a b => a.onset ≤ b.onset)) (s : Step) (h : s ∈ makeSteps score hand)
    (hdur : ∀ n ∈ s.attack, GROUP_SEC < n.duration) :
    ∀ n ∈ s.attack, n.onset ≤ landing s ∧ landing s < endOf n := by
  obtain ⟨hne, hin⟩ := makeSteps_attack score hand hs s h
  have hnear := landing_near score hand hs s h
  intro n hn
  refine ⟨(landing_spec s hne).2 n hn, ?_⟩
  have := hin n hn
  have := hdur n hn
  unfold endOf; grind

/-- The counterexample for `FAILS_landing_all_sounding`: a 10ms note, and a
    second note 20ms after it began — a grace note, or two 64ths at a fast
    tempo. `makeSteps` groups them as one step (they are within `GROUP_SEC`). -/
def graceScore : Score :=
  { notes := [{ id := 0, pitch := 60, onset := 0, duration := 1 / 100 },
              { id := 1, pitch := 64, onset := 2 / 100, duration := 1 }],
    duration := 102 / 100,
    bars := [⟨0, 0, 102 / 100, 4, 4, 0⟩],
    pedal := [] }

/-- **Fails** without it: a step whose first note has ended before its last
    begins. Parked on the last attack, the first is silent — the arrow key
    sounds one note of a two-note step. Repro: `repro/loop_landing_silent_attack.ts`. -/
theorem FAILS_landing_all_sounding :
    ¬ ∀ (score : Score), score.notes.Pairwise (fun a b => a.onset ≤ b.onset) →
        ∀ s ∈ makeSteps score .both, ∀ n ∈ s.attack, landing s < endOf n := by
  intro h
  have hex : ∃ s ∈ makeSteps graceScore .both, ∃ n ∈ s.attack, ¬ landing s < endOf n := by
    decide +kernel
  obtain ⟨s, hs, n, hn, hnot⟩ := hex
  exact hnot (h graceScore (by simp [graceScore]; grind) s hs n hn)

/-! ## stepFrom

> "Within a loop only the loop's steps are candidates and the ends wrap
> (decision 4) … With no loop the piece's ends are walls" — loop.ts:53, 33
-/

/-- **Holds.** Whatever `stepFrom` returns is the landing of a step the loop
    confines (of any step, with no loop). -/
theorem stepFrom_mem (steps : List Step) (t : Rat) (forward : Bool) (loop : Option TimeRange) (r : Rat)
    (h : stepFrom steps t forward loop = some r) : ∃ s ∈ insideOf steps loop, r = landing s := by
  unfold stepFrom at h
  simp only at h
  split at h
  · cases h
  · split at h
    · rename_i s hhit
      cases h
      refine ⟨s, ?_, rfl⟩
      cases forward
      · simp only [Bool.false_eq_true, ite_false] at hhit
        exact List.mem_reverse.mp (List.mem_of_find?_eq_some hhit)
      · simp only [ite_true] at hhit
        exact List.mem_of_find?_eq_some hhit
    · split at h
      · cases h
      · cases forward
        · simp only [Bool.false_eq_true, ite_false, Option.map_eq_some_iff] at h
          obtain ⟨s, hs, rfl⟩ := h
          exact ⟨s, List.mem_of_getLast? hs, rfl⟩
        · simp only [ite_true, Option.map_eq_some_iff] at h
          obtain ⟨s, hs, rfl⟩ := h
          exact ⟨s, List.mem_of_head? hs, rfl⟩

theorem stepFrom_forward_eq (steps : List Step) (t : Rat) :
    stepFrom steps t true none = (steps.find? (fun s => decide (landing s > t + EPS))).map landing := by
  unfold stepFrom insideOf
  simp only [ite_true]
  by_cases hlen : steps.length = 0
  · have : steps = [] := List.eq_nil_of_length_eq_zero hlen
    subst this; simp
  · simp only [hlen, ite_false]
    cases steps.find? (fun s => decide (landing s > t + EPS)) <;> rfl

theorem stepFrom_back_eq (steps : List Step) (t : Rat) :
    stepFrom steps t false none = (steps.reverse.find? (fun s => decide (landing s < t - EPS))).map landing := by
  unfold stepFrom insideOf
  simp only [Bool.false_eq_true, ite_false]
  by_cases hlen : steps.length = 0
  · have : steps = [] := List.eq_nil_of_length_eq_zero hlen
    subst this; simp
  · simp only [hlen, ite_false]
    cases steps.reverse.find? (fun s => decide (landing s < t - EPS)) <;> rfl

/-- **Holds.** "With no loop the piece's ends are walls": stepping forward
    either goes strictly later, or — when no step lands later — nowhere. -/
theorem stepFrom_forward_no_loop (steps : List Step) (t : Rat) :
    (∀ r, stepFrom steps t true none = some r → t + EPS < r) ∧
      (stepFrom steps t true none = none → ∀ s ∈ steps, landing s ≤ t + EPS) := by
  rw [stepFrom_forward_eq]
  cases hf : steps.find? (fun s => decide (landing s > t + EPS)) with
  | some s =>
    have := List.find?_some hf
    simp only [gt_iff_lt, decide_eq_true_eq] at this
    simp [this]
  | none =>
    simp only [Option.map_none, reduceCtorEq, false_implies, implies_true, true_and]
    intro _ s hs
    have := List.find?_eq_none.mp hf s hs
    simpa [Rat.not_lt] using this

/-- **Holds.** Stepping back with no loop either goes strictly earlier or nowhere. -/
theorem stepFrom_back_no_loop (steps : List Step) (t : Rat) :
    (∀ r, stepFrom steps t false none = some r → r < t - EPS) ∧
      (stepFrom steps t false none = none → ∀ s ∈ steps, t - EPS ≤ landing s) := by
  rw [stepFrom_back_eq]
  cases hf : steps.reverse.find? (fun s => decide (landing s < t - EPS)) with
  | some s =>
    have := List.find?_some hf
    simp only [decide_eq_true_eq] at this
    simp [this]
  | none =>
    simp only [Option.map_none, reduceCtorEq, false_implies, implies_true, true_and]
    intro _ s hs
    have := List.find?_eq_none.mp hf s (List.mem_reverse.mpr hs)
    simpa [Rat.not_lt] using this

/-- **Holds.** "the ends wrap": inside a loop that holds any step at all, an
    arrow key always has somewhere to go. -/
theorem stepFrom_loop_some (steps : List Step) (t : Rat) (forward : Bool) (l : TimeRange)
    (hne : insideOf steps (some l) ≠ []) : (stepFrom steps t forward (some l)).isSome := by
  unfold stepFrom
  simp only
  have hlen : (insideOf steps (some l)).length ≠ 0 := by
    intro h; exact hne (List.eq_nil_of_length_eq_zero h)
  simp only [hlen, ite_false]
  split
  · rfl
  · cases forward
    · simp only [Bool.false_eq_true, ite_false, Option.isSome_map]
      cases h : (insideOf steps (some l)).getLast? with
      | none => exact absurd (List.getLast?_eq_none_iff.mp h) hne
      | some _ => rfl
    · simp only [ite_true, Option.isSome_map]
      cases h : (insideOf steps (some l)).head? with
      | none => exact absurd (List.head?_eq_none_iff.mp h) hne
      | some _ => rfl

/-- **Holds only under a hypothesis the code does not enforce:** every step
    lands where it begins (`landing = at`, which is so for a quantized score).
    Then a step taken inside a loop stays inside it. -/
theorem stepFrom_in_loop (steps : List Step) (t : Rat) (forward : Bool) (l : TimeRange) (r : Rat)
    (hq : ∀ s ∈ steps, landing s = s.time)
    (h : stepFrom steps t forward (some l) = some r) : l.start - EPS ≤ r ∧ r < l.end_ - EPS := by
  obtain ⟨s, hs, rfl⟩ := stepFrom_mem steps t forward (some l) r h
  simp only [insideOf, List.mem_filter, Bool.and_eq_true, decide_eq_true_eq] at hs
  rw [hq s hs.1]; exact hs.2

/-- The counterexample for `FAILS_stepFrom_in_loop`: a two-note chord spread
    across the loop's end, as a performance captured from a keyboard spreads
    one across a barline — 10ms before it and 10ms after. -/
def spreadSteps : List Step :=
  [{ index := 0, time := 99 / 100,
     attack := [{ id := 0, pitch := 60, onset := 99 / 100, duration := 1 },
                { id := 1, pitch := 64, onset := 101 / 100, duration := 1 }],
     sustain := [], release := [] }]

/-- **Fails** without it: a step that begins inside the loop but whose chord
    is spread across the loop's end lands PAST the end — the arrow key parks
    the playhead outside the loop it is stepping through.
    Repro: `repro/loop_step_lands_outside.ts`. -/
theorem FAILS_stepFrom_in_loop :
    ¬ ∀ (steps : List Step) (t : Rat) (forward : Bool) (l : TimeRange) (r : Rat),
        stepFrom steps t forward (some l) = some r → r < l.end_ := by
  intro h
  have := h spreadSteps 0 true ⟨0, 1⟩ (101 / 100) (by decide +kernel)
  exact absurd this (by decide +kernel)

/-! ## snapBar

> "the start edge to the nearest barline at or before the other edge's bar,
> the end edge to the nearest barline at or after it — so a loop is never
> less than a bar" — loop.ts:130
-/

theorem snapBarGo_spec (line : Nat → Rat) (t : Rat) (best : Nat) (l : List Nat) :
    (snapBarGo line t best l = best ∨ snapBarGo line t best l ∈ l) ∧
      absR (line (snapBarGo line t best l) - t) ≤ absR (line best - t) ∧
      ∀ i ∈ l, absR (line (snapBarGo line t best l) - t) ≤ absR (line i - t) := by
  induction l generalizing best with
  | nil => simp [snapBarGo]
  | cons i rest ih =>
    simp only [snapBarGo]
    by_cases h : absR (line i - t) < absR (line best - t)
    · simp only [h, ite_true]
      obtain ⟨h1, h2, h3⟩ := ih i
      refine ⟨?_, by grind, ?_⟩
      · rcases h1 with e | m
        · right; rw [e]; simp
        · right; simp [m]
      · intro j hj
        rcases List.mem_cons.mp hj with rfl | hj
        · exact h2
        · exact h3 j hj
    · simp only [h, ite_false]
      obtain ⟨h1, h2, h3⟩ := ih best
      refine ⟨?_, h2, ?_⟩
      · rcases h1 with e | m
        · left; exact e
        · right; simp [m]
      · intro j hj
        rcases List.mem_cons.mp hj with rfl | hj
        · grind
        · exact h3 j hj

/-- The bars the code calls `cur` — loop.ts:138. -/
def curOf (bars : List Bar) (range : Option BarRange) : BarRange :=
  range.getD { from_ := 0, to := (bars.length : Int) - 1 }

/-- **Holds.** A dragged START edge snaps to a bar "at or before the other
    edge's bar", and to the nearest barline among those. -/
theorem snapBar_start (bars : List Bar) (t : Rat) (range : Option BarRange) :
    snapBar bars t .start range ≤ (curOf bars range).to.toNat ∧
      ∀ i, i ≤ (curOf bars range).to.toNat →
        absR ((bars.getD (snapBar bars t .start range) default).start - t) ≤
          absR ((bars.getD i default).start - t) := by
  unfold snapBar
  simp only
  rw [show range.getD { from_ := 0, to := (bars.length : Int) - 1 } = curOf bars range from rfl]
  obtain ⟨h1, h2, h3⟩ := snapBarGo_spec (fun i => (bars.getD i default).start) t 0
    (List.range' 0 ((curOf bars range).to.toNat + 1 - 0))
  refine ⟨?_, ?_⟩
  · rcases h1 with e | m
    · rw [e]; omega
    · have := List.mem_range'_1.mp m; omega
  · intro i hi
    exact h3 i (List.mem_range'_1.mpr (by omega))

/-- **Holds.** A dragged END edge snaps to a bar "at or after" the start
    edge's bar, and to the nearest barline among those. -/
theorem snapBar_end (bars : List Bar) (t : Rat) (range : Option BarRange) :
    (curOf bars range).from_.toNat ≤ snapBar bars t .end_ range ∧
      ∀ i, (curOf bars range).from_.toNat ≤ i → i ≤ bars.length - 1 →
        absR ((bars.getD (snapBar bars t .end_ range) default).end_ - t) ≤
          absR ((bars.getD i default).end_ - t) := by
  unfold snapBar
  simp only
  rw [show range.getD { from_ := 0, to := (bars.length : Int) - 1 } = curOf bars range from rfl]
  obtain ⟨h1, h2, h3⟩ := snapBarGo_spec (fun i => (bars.getD i default).end_) t (curOf bars range).from_.toNat
    (List.range' (curOf bars range).from_.toNat (bars.length - 1 + 1 - (curOf bars range).from_.toNat))
  refine ⟨?_, ?_⟩
  · rcases h1 with e | m
    · rw [e]; omega
    · have := List.mem_range'_1.mp m; omega
  · intro i hi hi'
    exact h3 i (List.mem_range'_1.mpr (by omega))

/-! ## snapFine

> "the nearest attack or barline to `t` (decision 2), and — as with snapBar —
> never onto or past the other edge, so the loop keeps at least one step or
> bar in it." — loop.ts:116
-/

theorem nearest_mem (t first : Rat) (rest : List Rat) :
    nearest t first rest = first ∨ nearest t first rest ∈ rest := by
  unfold nearest
  induction rest generalizing first with
  | nil => left; rfl
  | cons x rest ih =>
    simp only [List.foldl_cons]
    rcases ih (if absR (x - t) < absR (first - t) then x else first) with e | m
    · rw [e]; split
      · right; simp
      · left; rfl
    · right; simp [m]

/-- **Holds.** A finely dragged START edge never lands "onto or past the other
    edge": it stops short of the range's end, unless there is nowhere short of
    it to go, in which case it stays where the range starts. -/
theorem snapFine_start (score : Score) (steps : List Step) (t : Rat) (range : Option BarRange) :
    snapFine score steps t .start range < (barTime score range).end_ - EPS ∨
      snapFine score steps t .start range = (barTime score range).start := by
  unfold snapFine
  simp only
  split
  · right; rfl
  · rename_i first rest hc
    left
    have hmem : nearest t first rest ∈ first :: rest := by
      rcases nearest_mem t first rest with e | m
      · rw [e]; simp
      · simp [m]
    rw [← hc] at hmem
    have := (List.mem_filter.mp hmem).2
    simpa using this

/-- **Holds.** Likewise a finely dragged END edge stays past the range's start. -/
theorem snapFine_end (score : Score) (steps : List Step) (t : Rat) (range : Option BarRange) :
    (barTime score range).start + EPS < snapFine score steps t .end_ range ∨
      snapFine score steps t .end_ range = (barTime score range).end_ := by
  unfold snapFine
  simp only
  split
  · right; rfl
  · rename_i first rest hc
    left
    have hmem : nearest t first rest ∈ first :: rest := by
      rcases nearest_mem t first rest with e | m
      · rw [e]; simp
      · simp [m]
    rw [← hc] at hmem
    have := (List.mem_filter.mp hmem).2
    simpa using this

/-! ## Backchain

> "Every link shares the section's end … THE LONGEST LINK IS THE SECTION"
> — backchain.ts:15, 24
-/

theorem setLast_length (out : List BarRange) (whole : BarRange) : (setLast out whole).length = out.length := by
  unfold setLast
  split
  · rfl
  · rename_i l hl
    split
    · rfl
    · have : out ≠ [] := by intro e; rw [e] at hl; simp at hl
      simp [List.length_dropLast]
      have := List.length_pos_iff.mpr this; omega

/-- **Holds.** There is one link for each step the section holds — "link k
    begins on the k-th step from the end" (backchain.ts:53). -/
theorem links_length (score : Score) (steps : List Step) (range : Option BarRange) :
    (links score steps range).length = (added score steps range).length := by
  unfold links; simp [setLast_length]

theorem setLast_getLast (out : List BarRange) (whole : BarRange) (hne : out ≠ []) :
    (setLast out whole).getLast? = some whole := by
  unfold setLast
  cases hl : out.getLast? with
  | none => exact absurd (List.getLast?_eq_none_iff.mp hl) hne
  | some l =>
    simp only
    split
    · rename_i hsame
      simp only [sameRange, beq_iff_eq, Option.some.injEq] at hsame
      rw [hl, hsame]
    · simp

/-- **Holds.** "THE LONGEST LINK IS THE SECTION" (backchain.ts:24): the last
    link is the section as chosen. -/
theorem links_last (score : Score) (steps : List Step) (range : Option BarRange)
    (hne : links score steps range ≠ []) :
    (links score steps range).getLast? = some (wholeOf score range) := by
  unfold links at hne ⊢
  simp only at hne ⊢
  apply setLast_getLast
  intro e
  rw [e] at hne
  simp [setLast] at hne

/-- **Holds.** Every link is a range in its one spelling, so selecting it
    (`selectBars` normalizes) leaves it exactly as it is — which is what keeps
    a running chain from being ended by its own link (main.ts:404). -/
theorem links_normal (score : Score) (hne : score.bars ≠ []) (steps : List Step) (range : Option BarRange) :
    ∀ l ∈ links score steps range, normalizeRange score l = l := by
  have fix : ∀ r, normalizeRange score (normalizeRange score r) = normalizeRange score r :=
    normalizeRange_idem score hne
  intro l hl
  unfold links setLast at hl
  simp only at hl
  split at hl
  · obtain ⟨s, _, rfl⟩ := List.mem_map.mp hl
    exact fix _
  · split at hl
    · obtain ⟨s, _, rfl⟩ := List.mem_map.mp hl
      exact fix _
    · rcases List.mem_append.mp hl with hl | hl
      · obtain ⟨s, _, rfl⟩ := List.mem_map.mp (List.dropLast_subset _ hl)
        exact fix _
      · simp only [List.mem_singleton] at hl
        subst hl; exact fix _

theorem nextInHandGo_spec (adds : List Step) (hand : HandFilter) (fallback : Nat) (l : List Nat) :
    (nextInHandGo adds hand fallback l = fallback ∧
        ∀ i ∈ l, ∀ s, adds[i]? = some s → s.attack.any (fun n => inHand n hand) = false) ∨
      (∃ pre post s, l = pre ++ nextInHandGo adds hand fallback l :: post ∧
        adds[nextInHandGo adds hand fallback l]? = some s ∧
        s.attack.any (fun n => inHand n hand) = true ∧
        ∀ i ∈ pre, ∀ s', adds[i]? = some s' → s'.attack.any (fun n => inHand n hand) = false) := by
  induction l with
  | nil => left; simp [nextInHandGo]
  | cons i rest ih =>
    simp only [nextInHandGo]
    cases hi : adds[i]? with
    | none =>
      simp only
      rcases ih with ⟨e, h⟩ | ⟨pre, post, s, e, hs, hin, hpre⟩
      · left
        refine ⟨e, ?_⟩
        intro j hj s' hs'
        rcases List.mem_cons.mp hj with rfl | hj
        · rw [hi] at hs'; cases hs'
        · exact h j hj s' hs'
      · right
        refine ⟨i :: pre, post, s, by rw [List.cons_append, ← e], hs, hin, ?_⟩
        intro j hj s' hs'
        rcases List.mem_cons.mp hj with rfl | hj
        · rw [hi] at hs'; cases hs'
        · exact hpre j hj s' hs'
    | some s =>
      simp only
      by_cases hin : s.attack.any (fun n => inHand n hand) = true
      · simp only [hin, ite_true]
        right; exact ⟨[], rest, s, rfl, hi, hin, by simp⟩
      · simp only [hin, Bool.false_eq_true, ite_false]
        rcases ih with ⟨e, h⟩ | ⟨pre, post, s2, e, hs, hin2, hpre⟩
        · left
          refine ⟨e, ?_⟩
          intro j hj s' hs'
          rcases List.mem_cons.mp hj with rfl | hj
          · rw [hi] at hs'; cases hs'; simpa using hin
          · exact h j hj s' hs'
        · right
          refine ⟨i :: pre, post, s2, by rw [List.cons_append, ← e], hs, hin2, ?_⟩
          intro j hj s' hs'
          rcases List.mem_cons.mp hj with rfl | hj
          · rw [hi] at hs'; cases hs'; simpa using hin
          · exact hpre j hj s' hs'

/-- **Holds.** Shift+↑ goes to "the nearest link that adds a note of this
    [hand]" and, "With no such link that way, it stays where it is"
    (backchain.ts:29): the result is `at`, or a later link adding the hand with
    none adding it in between. -/
theorem nextInHand_forward (adds : List Step) (at_ : Nat) (hand : HandFilter) :
    let r := nextInHand adds at_ true hand
    (r = at_ ∧ ∀ i, at_ < i → ∀ s, adds[i]? = some s → s.attack.any (fun n => inHand n hand) = false) ∨
      (at_ < r ∧ r < adds.length ∧
        (∃ s, adds[r]? = some s ∧ s.attack.any (fun n => inHand n hand) = true) ∧
        ∀ i, at_ < i → i < r → ∀ s, adds[i]? = some s → s.attack.any (fun n => inHand n hand) = false) := by
  intro r
  have hr : r = nextInHandGo adds hand at_ (List.range' (at_ + 1) (adds.length - (at_ + 1))) := by
    simp [r, nextInHand]
  rcases nextInHandGo_spec adds hand at_ (List.range' (at_ + 1) (adds.length - (at_ + 1)))
    with ⟨e, h⟩ | ⟨pre, post, s, e, hs, hin, hpre⟩
  · left
    refine ⟨by rw [hr, e], ?_⟩
    intro i hi s hs
    have hlt : i < adds.length := (List.getElem?_eq_some_iff.mp hs).1
    exact h i (List.mem_range'_1.mpr (by omega)) s hs
  · right
    rw [← hr] at e hs
    have hmem : r ∈ List.range' (at_ + 1) (adds.length - (at_ + 1)) := by rw [e]; simp
    have hb := List.mem_range'_1.mp hmem
    refine ⟨by omega, by omega, ⟨s, hs, hin⟩, ?_⟩
    intro i hi hir s' hs'
    apply hpre i _ s' hs'
    -- `i` is in the candidates, before `r`: so it is in `pre`
    have hsorted : (List.range' (at_ + 1) (adds.length - (at_ + 1))).Pairwise (· < ·) :=
      List.pairwise_lt_range'
    have himem : i ∈ List.range' (at_ + 1) (adds.length - (at_ + 1)) :=
      List.mem_range'_1.mpr (by omega)
    rw [e] at hsorted himem
    rcases List.mem_append.mp himem with h | h
    · exact h
    · exfalso
      rw [List.pairwise_append] at hsorted
      rcases List.mem_cons.mp h with rfl | h
      · omega
      · have := (List.pairwise_cons.mp hsorted.2.1).1 i h; omega

end Harmonicland
