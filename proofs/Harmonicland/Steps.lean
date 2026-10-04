import Harmonicland.Core

/-!
# Steps — `src/steps.ts`

The score re-cut into simultaneities: the unit the practice cursor, the arrow
keys and the backchain all count in.

## What the model is

A line-by-line translation of `steps.ts` over the `Score` of `Core.lean`.

* The grouping loop (steps.ts:118-124) is a left fold whose accumulator holds
  the groups newest-first, so its head is the code's `groups[groups.length - 1]`.
* The cost table of `pairSorted` (steps.ts:235-245) is written as the
  recurrence it memoises: cell `[i][j]` depends only on the suffixes `a[i..]`
  and `b[j..]`, so the model's `cost` takes those suffixes. `Infinity` is
  `none`.
* A JavaScript `Set` of pitches, sorted, is a list sorted strictly ascending.

## What the model leaves out

Floating point (see `Core.lean`); `Step.at` is `time`; the `Map` iteration
order `movesBetween` re-sorts away (steps.ts:215).
-/

namespace Harmonicland

/-- src/steps.ts:40 -/
inductive HandFilter where
  | both | upper | lower
  deriving DecidableEq, Repr

/-- src/steps.ts:48 -/
def GROUP_SEC : Rat := 3 / 100

theorem GROUP_SEC_pos : 0 < GROUP_SEC := by unfold GROUP_SEC; grind

/-- src/steps.ts:54 -/
structure Step where
  index : Nat
  time : Rat
  attack : List Note
  sustain : List Note
  release : List Note
  deriving Repr

/-- src/steps.ts:80 -/
structure Span where
  first : Nat
  last : Nat
  deriving Repr, DecidableEq

/-- src/steps.ts:95-96 -/
def inHand (n : Note) (hand : HandFilter) : Bool :=
  match hand with
  | .both => true
  | .upper => n.hand == none || n.hand == some Hand.upper
  | .lower => n.hand == none || n.hand == some Hand.lower

/-- src/steps.ts:101-102 -/
def otherHand (score : Score) (hand : HandFilter) : List Note :=
  score.notes.filter (fun n => !inHand n hand)

/-- src/steps.ts:104 -/
def endOf (n : Note) : Rat := n.onset + n.duration

/-- `g[0].onset` — the group's first onset. A group is never empty
    (`groupByOnset_ne_nil`); the `0` is for the case that cannot arise. -/
def firstOnset (g : List Note) : Rat :=
  match g with
  | n :: _ => n.onset
  | [] => 0

/-- steps.ts:119-124, one turn of the loop. `groups` is held newest-first. -/
def groupStep (groups : List (List Note)) (n : Note) : List (List Note) :=
  match groups with
  | (first :: more) :: older =>
    if n.onset - first.onset ≤ GROUP_SEC then ((first :: more) ++ [n]) :: older
    else [n] :: groups
  | _ => [n] :: groups

/-- steps.ts:118-124 -/
def groupByOnset (mine : List Note) : List (List Note) :=
  (mine.foldl groupStep []).reverse

/-- steps.ts:126-132 — `groups.map((attack, index) => ...)`. -/
def firstPass (mine : List Note) : Nat → List (List Note) → List Step
  | _, [] => []
  | index, attack :: rest =>
    let time := firstOnset attack
    { index, time, attack,
      sustain := mine.filter (fun n => decide (n.onset < time) && decide (endOf n > time)),
      release := [] } :: firstPass mine (index + 1) rest

/-- steps.ts:141-144 — a step's `release`, from the step before it. -/
def withRelease (prev s : Step) : Step :=
  let now := (s.attack ++ s.sustain).map (·.id)
  { s with release := (prev.attack ++ prev.sustain).filter (fun n => !now.contains n.id) }

/-- steps.ts:139-145, for the steps after the first. -/
def fillFrom (prev : Step) : List Step → List Step
  | [] => []
  | s :: rest => withRelease prev s :: fillFrom s rest

/-- steps.ts:139-145 -/
def fillRelease : List Step → List Step
  | [] => []
  | s :: rest => s :: fillFrom s rest

/-- The practised notes — steps.ts:114. -/
def mineOf (score : Score) (hand : HandFilter) : List Note :=
  score.notes.filter (fun n => inHand n hand)

/-- src/steps.ts:113-147, the `steps` of the `Steps` it returns. -/
def makeSteps (score : Score) (hand : HandFilter) : List Step :=
  let mine := mineOf score hand
  fillRelease (firstPass mine 0 (groupByOnset mine))

/-- src/steps.ts:150 -/
def soundingIn (s : Step) : List Note := s.attack ++ s.sustain

/-- src/steps.ts:155-158 — `findIndex`, with `steps.length` for "none". -/
def stepAt (steps : List Step) (t : Rat) : Nat :=
  steps.findIdx (fun s => decide (s.time ≥ t))

/-- steps.ts:166-168 — the code's `i`, or `none` where it is negative. -/
def soundingIndex (steps : List Step) (t : Rat) : Option Nat :=
  let next := stepAt steps t
  let hit : Bool :=
    match steps[next]? with
    | some s => decide (s.time = t)
    | none => false
  if hit then some next else if next = 0 then none else some (next - 1)

/-- steps.ts:169-173 — a step cut down to what still sounds at `t`. -/
def cutTo (s : Step) (t : Rat) : Option Step :=
  let on := fun (n : Note) => decide (n.onset ≤ t) && decide (endOf n > t)
  let attack := s.attack.filter on
  let sustain := s.sustain.filter on
  if attack.length ≠ 0 ∨ sustain.length ≠ 0 then some { s with attack, sustain } else none

/-- src/steps.ts:165-174 -/
def stepSounding (steps : List Step) (t : Rat) : Option Step :=
  match soundingIndex steps t with
  | none => none
  | some i =>
    match steps[i]? with
    | none => none
    | some s => cutTo s t

/-- src/steps.ts:183-185 -/
def spanOf (steps : List Step) (time : TimeRange) : Span :=
  { first := stepAt steps time.start, last := stepAt steps time.end_ }

/-! # Theorems

## The hand filter

> "Complement of `inHand`, so the two can never disagree about a note and
> leave it in both or neither." — steps.ts:98
-/

/-- **Holds.** Every note is in exactly one of the practised hand and the other. -/
theorem otherHand_complement (score : Score) (hand : HandFilter) (n : Note) (h : n ∈ score.notes) :
    (n ∈ mineOf score hand ∧ n ∉ otherHand score hand) ∨
      (n ∉ mineOf score hand ∧ n ∈ otherHand score hand) := by
  simp only [mineOf, otherHand, List.mem_filter, h, true_and]
  cases inHand n hand <;> simp

/-- **Holds.** "A note with no `hand` belongs to EVERY filter" (steps.ts:22). -/
theorem inHand_of_no_hand (n : Note) (hand : HandFilter) (h : n.hand = none) : inHand n hand = true := by
  cases hand <;> simp [inHand, h]

/-- **Holds.** Hands together is every note. -/
theorem mineOf_both (score : Score) : mineOf score .both = score.notes := by
  simp [mineOf, inHand]

/-! ## Grouping

> "Notes are grouped when their onsets fall within GROUP_SEC of the group's
> FIRST onset — not of the previous note's." — steps.ts:17
-/

/-- What the grouping loop keeps true of the groups so far (newest-first). -/
structure GroupsInv (groups : List (List Note)) : Prop where
  ne : ∀ g ∈ groups, g ≠ []
  within : ∀ g ∈ groups, ∀ x ∈ g, firstOnset g ≤ x.onset ∧ x.onset ≤ firstOnset g + GROUP_SEC
  apart : groups.Pairwise (fun newer older => firstOnset older + GROUP_SEC < firstOnset newer)

theorem groupStep_flatten (groups : List (List Note)) (n : Note) :
    (groupStep groups n).reverse.flatten = groups.reverse.flatten ++ [n] := by
  unfold groupStep
  split
  · split <;> simp [List.flatten_append]
  · simp [List.flatten_append]

theorem groupStep_inv (groups : List (List Note)) (n : Note) (hinv : GroupsInv groups)
    (hle : ∀ g ∈ groups, ∀ x ∈ g, x.onset ≤ n.onset) : GroupsInv (groupStep groups n) := by
  unfold groupStep
  split
  · rename_i first more older
    have hg := hinv.within (first :: more) (by simp)
    have hfirst : firstOnset (first :: more) = first.onset := rfl
    split
    · rename_i hclose
      refine ⟨?_, ?_, ?_⟩
      · intro g hg'
        rcases List.mem_cons.mp hg' with rfl | hg'
        · simp
        · exact hinv.ne g (by simp [hg'])
      · intro g hg' x hx
        rcases List.mem_cons.mp hg' with rfl | hg'
        · have hf : firstOnset (first :: more ++ [n]) = first.onset := rfl
          rw [hf]
          rcases List.mem_append.mp hx with hx | hx
          · have := hg x hx; rw [hfirst] at this; exact this
          · simp at hx; subst hx
            have := hle (first :: more) (by simp) first (by simp)
            grind
        · exact hinv.within g (by simp [hg']) x hx
      · have := hinv.apart
        rw [List.pairwise_cons] at this ⊢
        exact ⟨this.1, this.2⟩
    · rename_i hfar
      refine ⟨?_, ?_, ?_⟩
      · intro g hg'
        rcases List.mem_cons.mp hg' with rfl | hg'
        · simp
        · exact hinv.ne g hg'
      · intro g hg' x hx
        rcases List.mem_cons.mp hg' with rfl | hg'
        · simp at hx; subst hx; simp [firstOnset]; have := GROUP_SEC_pos; grind
        · exact hinv.within g hg' x hx
      · rw [List.pairwise_cons]
        refine ⟨?_, hinv.apart⟩
        intro g hg'
        have hn : firstOnset [n] = n.onset := rfl
        rw [hn]
        rcases List.mem_cons.mp hg' with rfl | hg'
        · rw [hfirst]; grind
        · have := (List.pairwise_cons.mp hinv.apart).1 g hg'
          rw [hfirst] at this
          have := GROUP_SEC_pos
          grind
  · rename_i hno
    -- no group yet, or (never) an empty one at the head
    refine ⟨?_, ?_, ?_⟩
    · intro g hg'
      rcases List.mem_cons.mp hg' with rfl | hg'
      · simp
      · exact hinv.ne g hg'
    · intro g hg' x hx
      rcases List.mem_cons.mp hg' with rfl | hg'
      · simp at hx; subst hx; simp [firstOnset]; have := GROUP_SEC_pos; grind
      · exact hinv.within g hg' x hx
    · cases groups with
      | nil => simp
      | cons g older =>
        cases g with
        | nil => exact absurd rfl (hinv.ne [] (by simp))
        | cons first more => exact absurd rfl (hno first more older)

theorem foldl_groupStep (l : List Note) (groups : List (List Note)) (hinv : GroupsInv groups)
    (hs : l.Pairwise (fun a b => a.onset ≤ b.onset))
    (hle : ∀ g ∈ groups, ∀ x ∈ g, ∀ y ∈ l, x.onset ≤ y.onset) :
    GroupsInv (l.foldl groupStep groups) ∧
      (l.foldl groupStep groups).reverse.flatten = groups.reverse.flatten ++ l := by
  induction l generalizing groups with
  | nil => simp; exact hinv
  | cons n l ih =>
    rw [List.pairwise_cons] at hs
    have hinv' := groupStep_inv groups n hinv (fun g hg x hx => hle g hg x hx n (by simp))
    have hflat := groupStep_flatten groups n
    have hle' : ∀ g ∈ groupStep groups n, ∀ x ∈ g, ∀ y ∈ l, x.onset ≤ y.onset := by
      intro g hg x hx y hy
      have hx' : x ∈ (groupStep groups n).reverse.flatten := by
        rw [List.mem_flatten]; exact ⟨g, List.mem_reverse.mpr hg, hx⟩
      rw [hflat] at hx'
      rcases List.mem_append.mp hx' with hx' | hx'
      · obtain ⟨g', hg', hxg'⟩ := List.mem_flatten.mp hx'
        exact hle g' (List.mem_reverse.mp hg') x hxg' y (by simp [hy])
      · simp at hx'; subst hx'; exact hs.1 y hy
    obtain ⟨h1, h2⟩ := ih (groupStep groups n) hinv' hs.2 hle'
    refine ⟨h1, ?_⟩
    simp only [List.foldl_cons]
    rw [h2, hflat]; simp

/-- The groups, in the order the code holds them. -/
theorem groupByOnset_spec (mine : List Note) (hs : mine.Pairwise (fun a b => a.onset ≤ b.onset)) :
    (groupByOnset mine).flatten = mine ∧
      (∀ g ∈ groupByOnset mine, g ≠ []) ∧
      (∀ g ∈ groupByOnset mine, ∀ x ∈ g, firstOnset g ≤ x.onset ∧ x.onset ≤ firstOnset g + GROUP_SEC) ∧
      (groupByOnset mine).Pairwise (fun a b => firstOnset a + GROUP_SEC < firstOnset b) := by
  obtain ⟨hinv, hflat⟩ := foldl_groupStep mine [] ⟨by simp, by simp, List.Pairwise.nil⟩ hs (by simp)
  unfold groupByOnset
  refine ⟨by simpa using hflat, ?_, ?_, ?_⟩
  · intro g hg; exact hinv.ne g (List.mem_reverse.mp hg)
  · intro g hg; exact hinv.within g (List.mem_reverse.mp hg)
  · rw [List.pairwise_reverse]; exact hinv.apart

/-! ## makeSteps -/

/-- The parts of a step the second pass (steps.ts:139-145) leaves alone. -/
def Step.core (s : Step) : Nat × Rat × List Note × List Note := (s.index, s.time, s.attack, s.sustain)

theorem fillFrom_core (prev : Step) (l : List Step) : (fillFrom prev l).map Step.core = l.map Step.core := by
  induction l generalizing prev with
  | nil => rfl
  | cons s rest ih => simp [fillFrom, ih, withRelease, Step.core]

theorem fillRelease_core (l : List Step) : (fillRelease l).map Step.core = l.map Step.core := by
  cases l with
  | nil => rfl
  | cons s rest => simp [fillRelease, fillFrom_core]

theorem firstPass_core (mine : List Note) (i : Nat) (groups : List (List Note)) :
    (firstPass mine i groups).map Step.core =
      groups.zipIdx.map (fun (g, k) =>
        (i + k, firstOnset g, g,
          mine.filter (fun n => decide (n.onset < firstOnset g) && decide (endOf n > firstOnset g)))) := by
  induction groups generalizing i with
  | nil => rfl
  | cons g rest ih =>
    simp only [firstPass, List.map_cons, List.zipIdx_cons, ih (i + 1)]
    simp only [Step.core, Nat.add_zero, List.cons.injEq, true_and]
    rw [List.zipIdx_succ, List.map_map]
    apply List.map_congr_left
    intro ⟨g', k⟩ _
    simp; omega

/-- `Step.core` of every step `makeSteps` returns, read off the groups. -/
theorem makeSteps_core (score : Score) (hand : HandFilter) :
    (makeSteps score hand).map Step.core =
      (groupByOnset (mineOf score hand)).zipIdx.map (fun (g, k) =>
        (k, firstOnset g, g,
          (mineOf score hand).filter
            (fun n => decide (n.onset < firstOnset g) && decide (endOf n > firstOnset g)))) := by
  unfold makeSteps
  simp only
  rw [fillRelease_core, firstPass_core]
  apply List.map_congr_left
  intro ⟨g, k⟩ _
  simp

theorem makeSteps_length (score : Score) (hand : HandFilter) :
    (makeSteps score hand).length = (groupByOnset (mineOf score hand)).length := by
  have := congrArg List.length (makeSteps_core score hand)
  simpa using this

/-- Reading one step: it is group `k`, at that group's first onset. -/
theorem makeSteps_getElem (score : Score) (hand : HandFilter) (k : Nat) (h : k < (makeSteps score hand).length) :
    ∃ hk : k < (groupByOnset (mineOf score hand)).length,
      let g := (groupByOnset (mineOf score hand))[k]
      (makeSteps score hand)[k].index = k ∧
      (makeSteps score hand)[k].time = firstOnset g ∧
      (makeSteps score hand)[k].attack = g ∧
      (makeSteps score hand)[k].sustain =
        (mineOf score hand).filter (fun n => decide (n.onset < firstOnset g) && decide (endOf n > firstOnset g)) := by
  have hk : k < (groupByOnset (mineOf score hand)).length := by rw [← makeSteps_length]; exact h
  refine ⟨hk, ?_⟩
  have hc := makeSteps_core score hand
  have := congrArg (fun l => l[k]?) hc
  simp only [List.getElem?_map, List.getElem?_eq_getElem h, Option.map_some] at this
  rw [List.getElem?_eq_getElem (by simpa using hk)] at this
  simp only [List.getElem_zipIdx, Option.map_some, Option.some.injEq, Step.core, Nat.zero_add,
    Prod.mk.injEq] at this
  exact this

/-- **Holds.** `Step.index` is the "Position in `Steps.steps`" (steps.ts:55). -/
theorem makeSteps_index (score : Score) (hand : HandFilter) (k : Nat) (h : k < (makeSteps score hand).length) :
    (makeSteps score hand)[k].index = k :=
  (makeSteps_getElem score hand k h).2.1

/-- **Holds.** Every practised note is struck in exactly one step, in score
    order: the attacks, laid end to end, are the practised notes. -/
theorem makeSteps_attacks (score : Score) (hand : HandFilter)
    (hs : score.notes.Pairwise (fun a b => a.onset ≤ b.onset)) :
    ((makeSteps score hand).map (·.attack)).flatten = mineOf score hand := by
  have hm : (mineOf score hand).Pairwise (fun a b => a.onset ≤ b.onset) :=
    List.Pairwise.sublist List.filter_sublist hs
  have hc := congrArg (List.map (fun (c : Nat × Rat × List Note × List Note) => c.2.2.1)) (makeSteps_core score hand)
  simp only [List.map_map] at hc
  have e1 : ((fun (c : Nat × Rat × List Note × List Note) => c.2.2.1) ∘ Step.core) = (·.attack) := rfl
  rw [e1] at hc
  rw [hc]
  have e2 : ((fun (c : Nat × Rat × List Note × List Note) => c.2.2.1) ∘
      fun (x : List Note × Nat) => (x.2, firstOnset x.1, x.1,
        (mineOf score hand).filter
          (fun n => decide (n.onset < firstOnset x.1) && decide (endOf n > firstOnset x.1)))) = Prod.fst := rfl
  rw [e2, List.zipIdx_map_fst]
  exact (groupByOnset_spec _ hm).1

/-- A step of `makeSteps`, as a fact about its group. -/
theorem makeSteps_mem (score : Score) (hand : HandFilter) (s : Step) (h : s ∈ makeSteps score hand) :
    ∃ g ∈ groupByOnset (mineOf score hand), s.time = firstOnset g ∧ s.attack = g ∧
      s.sustain = (mineOf score hand).filter (fun n => decide (n.onset < s.time) && decide (endOf n > s.time)) := by
  obtain ⟨k, hk, rfl⟩ := List.getElem_of_mem h
  obtain ⟨hk', _, h2, h3, h4⟩ := makeSteps_getElem score hand k hk
  exact ⟨_, List.getElem_mem hk', h2, h3, by rw [h2]; exact h4⟩

/-- **Holds.** "A step always attacks at least one note" (loop.ts:49), every
    attack lies within `GROUP_SEC` of the step's `at`, and `at` is the earliest
    of them — "the group's first onset" (steps.ts:58). -/
theorem makeSteps_attack (score : Score) (hand : HandFilter)
    (hs : score.notes.Pairwise (fun a b => a.onset ≤ b.onset)) (s : Step) (h : s ∈ makeSteps score hand) :
    s.attack ≠ [] ∧ ∀ n ∈ s.attack, s.time ≤ n.onset ∧ n.onset ≤ s.time + GROUP_SEC := by
  have hm : (mineOf score hand).Pairwise (fun a b => a.onset ≤ b.onset) :=
    List.Pairwise.sublist List.filter_sublist hs
  obtain ⟨g, hg, ht, ha, _⟩ := makeSteps_mem score hand s h
  obtain ⟨_, hne, hwithin, _⟩ := groupByOnset_spec _ hm
  rw [ha, ht]
  exact ⟨hne g hg, hwithin g hg⟩

/-- **Holds.** `sustain` is exactly the practised notes "begun earlier and
    still sounding" (steps.ts:62), and "A note ending exactly at a step's
    onset is NOT sustained into it" (steps.ts:110). -/
theorem makeSteps_sustain (score : Score) (hand : HandFilter) (s : Step) (h : s ∈ makeSteps score hand) (n : Note) :
    n ∈ s.sustain ↔ n ∈ mineOf score hand ∧ n.onset < s.time ∧ s.time < endOf n := by
  obtain ⟨g, _, _, _, hsus⟩ := makeSteps_mem score hand s h
  rw [hsus]; simp

/-- **Holds.** Steps are in time order and more than `GROUP_SEC` apart, so no
    two share an `at`. -/
theorem makeSteps_apart (score : Score) (hand : HandFilter)
    (hs : score.notes.Pairwise (fun a b => a.onset ≤ b.onset)) :
    (makeSteps score hand).Pairwise (fun a b => a.time + GROUP_SEC < b.time) := by
  have hm : (mineOf score hand).Pairwise (fun a b => a.onset ≤ b.onset) :=
    List.Pairwise.sublist List.filter_sublist hs
  have hp := (groupByOnset_spec _ hm).2.2.2
  have hc := congrArg (List.map (fun (c : Nat × Rat × List Note × List Note) => c.2.1)) (makeSteps_core score hand)
  simp only [List.map_map] at hc
  have e1 : ((fun (c : Nat × Rat × List Note × List Note) => c.2.1) ∘ Step.core) = (·.time) := rfl
  have e2 : ((fun (c : Nat × Rat × List Note × List Note) => c.2.1) ∘
      fun (x : List Note × Nat) => (x.2, firstOnset x.1, x.1,
        (mineOf score hand).filter
          (fun n => decide (n.onset < firstOnset x.1) && decide (endOf n > firstOnset x.1)))) =
        firstOnset ∘ Prod.fst := rfl
  rw [e1, e2, ← List.map_map, List.zipIdx_map_fst] at hc
  have : ((makeSteps score hand).map (·.time)).Pairwise (fun a b => a + GROUP_SEC < b) := by
    rw [hc]; exact List.pairwise_map.mpr hp
  exact List.pairwise_map.mp this

/-- **Holds.** "The three sets are disjoint" (steps.ts:51): no note a step
    attacks is one it sustains. -/
theorem makeSteps_attack_sustain_disjoint (score : Score) (hand : HandFilter)
    (hs : score.notes.Pairwise (fun a b => a.onset ≤ b.onset)) (s : Step) (h : s ∈ makeSteps score hand)
    (n : Note) (ha : n ∈ s.attack) : n ∉ s.sustain := by
  intro hsus
  have h1 := (makeSteps_attack score hand hs s h).2 n ha
  have h2 := (makeSteps_sustain score hand s h n).mp hsus
  grind

theorem fillFrom_release (prev : Step) (l : List Step) :
    ∀ s ∈ fillFrom prev l, ∀ n ∈ s.release, n ∉ s.attack ∧ n ∉ s.sustain := by
  induction l generalizing prev with
  | nil => intro s hs; cases hs
  | cons x rest ih =>
    intro s hs n hn
    simp only [fillFrom] at hs
    rcases List.mem_cons.mp hs with rfl | hs
    · simp only [withRelease, List.mem_filter, Bool.not_eq_true'] at hn ⊢
      have hno := hn.2
      refine ⟨fun hmem => ?_, fun hmem => ?_⟩
      · have : ((x.attack ++ x.sustain).map (·.id)).contains n.id = true := by
          simp only [List.contains_eq_mem, List.mem_map, decide_eq_true_eq]
          exact ⟨n, by simp [hmem], rfl⟩
        rw [this] at hno; cases hno
      · have : ((x.attack ++ x.sustain).map (·.id)).contains n.id = true := by
          simp only [List.contains_eq_mem, List.mem_map, decide_eq_true_eq]
          exact ⟨n, by simp [hmem], rfl⟩
        rw [this] at hno; cases hno
    · exact ih x s hs n hn

theorem firstPass_release (mine : List Note) (i : Nat) (groups : List (List Note)) :
    ∀ s ∈ firstPass mine i groups, s.release = [] := by
  induction groups generalizing i with
  | nil => intro s hs; cases hs
  | cons g rest ih =>
    intro s hs
    simp only [firstPass] at hs
    rcases List.mem_cons.mp hs with rfl | hs
    · rfl
    · exact ih (i + 1) s hs

/-- **Holds.** "The three sets are disjoint" (steps.ts:51): no note a step
    releases is one it attacks or sustains. -/
theorem makeSteps_release_disjoint (score : Score) (hand : HandFilter) (s : Step) (h : s ∈ makeSteps score hand)
    (n : Note) (hr : n ∈ s.release) : n ∉ s.attack ∧ n ∉ s.sustain := by
  unfold makeSteps at h
  simp only at h
  have hl := firstPass_release (mineOf score hand) 0 (groupByOnset (mineOf score hand))
  generalize firstPass (mineOf score hand) 0 (groupByOnset (mineOf score hand)) = l at h hl
  cases l with
  | nil => cases h
  | cons x rest =>
    simp only [fillRelease] at h
    rcases List.mem_cons.mp h with rfl | h
    · -- the first step: its `release` is the first pass's, empty
      have : s.release = [] := hl s (by simp)
      rw [this] at hr; cases hr
    · exact fillFrom_release x rest s h n hr

/-! ## stepAt and spanOf

> "The step at or after a score time … Returns `steps.length` when `t` is
> past the last step" — steps.ts:152
> "The steps that begin inside a stretch of time: every step whose `at`
> falls in [start, end)." — steps.ts:176
-/

theorem stepAt_le_length (steps : List Step) (t : Rat) : stepAt steps t ≤ steps.length :=
  List.findIdx_le_length

/-- **Holds.** The step `stepAt` names begins at or after `t`. -/
theorem stepAt_ge (steps : List Step) (t : Rat) (s : Step) (h : steps[stepAt steps t]? = some s) :
    t ≤ s.time := by
  obtain ⟨hlt, e⟩ := List.getElem?_eq_some_iff.mp h
  have := @List.findIdx_getElem _ (fun (s : Step) => decide (s.time ≥ t)) steps hlt
  subst e
  simpa [stepAt] using this

/-- **Holds.** Every step before it begins before `t`. -/
theorem stepAt_before (steps : List Step) (t : Rat) (i : Nat) (s : Step) (h : i < stepAt steps t)
    (hs : steps[i]? = some s) : s.time < t := by
  obtain ⟨hlt, e⟩ := List.getElem?_eq_some_iff.mp hs
  have := @List.not_of_lt_findIdx _ (fun (s : Step) => decide (s.time ≥ t)) steps i h
  rw [e] at this
  exact Rat.not_le.mp (by simpa using this)

/-- **Holds.** A later time never names an earlier step — for any list of steps. -/
theorem stepAt_mono (steps : List Step) (t t' : Rat) (h : t ≤ t') : stepAt steps t ≤ stepAt steps t' := by
  apply List.findIdx_le_findIdx
  intro s _ hs
  simp only [decide_eq_true_eq] at hs ⊢
  grind

/-- In steps sorted by time, `stepAt` is at or before `i` exactly when `t` is
    at or before step `i`. -/
theorem stepAt_le_iff (steps : List Step) (hsorted : steps.Pairwise (fun a b => a.time < b.time))
    (t : Rat) (i : Nat) (hi : i < steps.length) : stepAt steps t ≤ i ↔ t ≤ steps[i].time := by
  constructor
  · intro hle
    have hlt : stepAt steps t < steps.length := by omega
    have h1 := stepAt_ge steps t _ (List.getElem?_eq_getElem hlt)
    by_cases e : stepAt steps t = i
    · simp only [e] at h1; exact h1
    · have := (List.pairwise_iff_getElem.mp hsorted) (stepAt steps t) i hlt hi (by omega)
      grind
  · intro hge
    apply Nat.le_of_not_lt
    intro hlt
    have := stepAt_before steps t i _ hlt (List.getElem?_eq_getElem hi)
    grind

/-- **Holds only under a hypothesis the code does not enforce:** the stretch
    is not inverted (`start ≤ end`). Then `first ≤ last`, as `Span` documents —
    "`last - first` is how many" (steps.ts:78). -/
theorem spanOf_ordered (steps : List Step) (time : TimeRange) (h : time.start ≤ time.end_) :
    (spanOf steps time).first ≤ (spanOf steps time).last :=
  stepAt_mono steps _ _ h

theorem spanOf_last_le (steps : List Step) (time : TimeRange) : (spanOf steps time).last ≤ steps.length :=
  stepAt_le_length steps _

/-- **Holds.** In steps sorted by time, the span is "every step whose `at`
    falls in [start, end)" — exactly those, no more and no fewer. -/
theorem spanOf_spec (steps : List Step) (hsorted : steps.Pairwise (fun a b => a.time < b.time))
    (time : TimeRange) (i : Nat) (hi : i < steps.length) :
    ((spanOf steps time).first ≤ i ∧ i < (spanOf steps time).last) ↔
      (time.start ≤ steps[i].time ∧ steps[i].time < time.end_) := by
  simp only [spanOf]
  rw [stepAt_le_iff steps hsorted time.start i hi]
  have := stepAt_le_iff steps hsorted time.end_ i hi
  constructor
  · intro ⟨h1, h2⟩
    refine ⟨h1, ?_⟩
    apply Rat.not_le.mp; intro hle; have := this.mpr hle; omega
  · intro ⟨h1, h2⟩
    refine ⟨h1, ?_⟩
    apply Nat.lt_of_not_le; intro hle; have := this.mp hle; grind

/-- **Fails** without it: the inverted stretch `Core.barTime` can return
    (`FAILS_barTime_ordered`) cuts to a span whose `last` is before its
    `first`. Repro: `repro/core_bartime_inverted.ts`. -/
theorem FAILS_spanOf_ordered :
    ¬ ∀ (score : Score), BarsWF score.bars → score.notes.Pairwise (fun a b => a.onset ≤ b.onset) →
        ∀ range : BarRange,
          (spanOf (makeSteps score .both) (barTime score (some range))).first ≤
            (spanOf (makeSteps score .both) (barTime score (some range))).last := by
  intro h
  have := h invertedScore invertedScore_wf (by simp [invertedScore])
    { from_ := 1, to := 1, toBeat := some (2 / 1000000) }
  exact absurd this (by decide +kernel)

/-! ## stepSounding

> "The step a PLAYING score is in at `t` — the last one begun at or before
> it — cut down to the notes still sounding at `t`, or null when nothing of
> it is" — steps.ts:160
-/

/-- The step `stepSounding` cuts from is "the last one begun at or before" `t`. -/
theorem soundingIndex_spec (steps : List Step) (hsorted : steps.Pairwise (fun a b => a.time < b.time))
    (t : Rat) (i : Nat) (h : soundingIndex steps t = some i) :
    ∃ hi : i < steps.length, steps[i].time ≤ t ∧
      ∀ j (hj : j < steps.length), i < j → t < steps[j].time := by
  unfold soundingIndex at h
  simp only at h
  cases hnext : steps[stepAt steps t]? with
  | none =>
    simp only [hnext, Bool.false_eq_true, ite_false] at h
    have hlen : steps.length ≤ stepAt steps t := List.getElem?_eq_none_iff.mp hnext
    have := stepAt_le_length steps t
    split at h
    · cases h
    · cases h
      have hi : stepAt steps t - 1 < steps.length := by omega
      refine ⟨hi, ?_, ?_⟩
      · exact Rat.le_of_lt (stepAt_before steps t _ _ (by omega) (List.getElem?_eq_getElem hi))
      · intro j hj hlt; omega
  | some s =>
    obtain ⟨hlt, hs⟩ := List.getElem?_eq_some_iff.mp hnext
    have hge := stepAt_ge steps t s hnext
    simp only [hnext] at h
    by_cases heq : s.time = t
    · simp only [heq, decide_true, ite_true, Option.some.injEq] at h
      subst h
      refine ⟨hlt, by rw [hs, heq]; exact Rat.le_refl, ?_⟩
      intro j hj hij
      have := (List.pairwise_iff_getElem.mp hsorted) (stepAt steps t) j hlt hj hij
      rw [hs, heq] at this; exact this
    · simp only [heq, decide_false, Bool.false_eq_true, ite_false] at h
      split at h
      · cases h
      · cases h
        have hi : stepAt steps t - 1 < steps.length := by omega
        refine ⟨hi, ?_, ?_⟩
        · exact Rat.le_of_lt (stepAt_before steps t _ _ (by omega) (List.getElem?_eq_getElem hi))
        · intro j hj hij
          by_cases e : j = stepAt steps t
          · subst e; rw [hs]; grind
          · have := (List.pairwise_iff_getElem.mp hsorted) (stepAt steps t) j hlt hj (by omega)
            rw [hs] at this; grind

/-- **Holds.** What `stepSounding` returns is a step of the list that began at
    or before `t`, with no later step begun by `t`, holding exactly its notes
    that sound at `t` — and at least one of them. -/
theorem stepSounding_spec (steps : List Step) (hsorted : steps.Pairwise (fun a b => a.time < b.time))
    (t : Rat) (r : Step) (h : stepSounding steps t = some r) :
    ∃ i, ∃ hi : i < steps.length,
      steps[i].time ≤ t ∧
      (∀ j (hj : j < steps.length), i < j → t < steps[j].time) ∧
      r.attack = steps[i].attack.filter (fun n => decide (n.onset ≤ t) && decide (endOf n > t)) ∧
      r.sustain = steps[i].sustain.filter (fun n => decide (n.onset ≤ t) && decide (endOf n > t)) ∧
      (r.attack ≠ [] ∨ r.sustain ≠ []) := by
  unfold stepSounding at h
  cases hidx : soundingIndex steps t with
  | none => simp [hidx] at h
  | some i =>
    obtain ⟨hi, h1, h2⟩ := soundingIndex_spec steps hsorted t i hidx
    simp only [hidx, List.getElem?_eq_getElem hi] at h
    unfold cutTo at h
    simp only at h
    split at h
    · rename_i hne
      cases h
      refine ⟨i, hi, h1, h2, rfl, rfl, ?_⟩
      simpa using hne
    · cases h

/-! # pairSorted — src/steps.ts:226-258

> "Optimal non-crossing matching of two sorted pitch lists: choose which
> min(|a|,|b|) pairs to make so total |a[i] - b[j]| is least, with i and j
> both increasing." — steps.ts:218
-/

/-- `Math.abs` on pitches. -/
def absI (x : Int) : Int := if x < 0 then -x else x

theorem absI_nonneg (x : Int) : 0 ≤ absI x := by unfold absI; split <;> omega

/-- `Math.min` where `none` is `Infinity`. -/
def minInf : Option Int → Option Int → Option Int
  | none, b => b
  | a, none => a
  | some a, some b => some (min a b)

/-- `x + c` where `c` may be `Infinity`. -/
def addInf (x : Int) (c : Option Int) : Option Int := c.map (x + ·)

/-- `a <= b` where `none` is `Infinity`. -/
def leInf : Option Int → Option Int → Bool
  | _, none => true
  | none, some _ => false
  | some a, some b => decide (a ≤ b)

/-- steps.ts:236-245 — `cost[i][j]`, as a function of the suffixes `a[i..]`
    and `b[j..]` it is computed from. `left` is `Math.min(n - i, m - j)`. -/
def cost : List Int → List Int → Option Int
  | [], _ => some 0
  | _ :: _, [] => some 0
  | x :: as, y :: bs =>
    let left := min (as.length + 1) (bs.length + 1)
    let take := addInf (absI (x - y)) (cost as bs)
    let skipA := if as.length + 1 > left then cost as (y :: bs) else none
    let skipB := if bs.length + 1 > left then cost (x :: as) bs else none
    minInf (minInf take skipA) skipB
termination_by as bs => as.length + bs.length

/-- steps.ts:250-256 — the walk back through the table, from cell `[i][j]`. -/
def trace : List Int → List Int → Nat → Nat → List (Nat × Nat)
  | [], _, _, _ => []
  | _ :: _, [], _, _ => []
  | x :: as, y :: bs, i, j =>
    let left := min (as.length + 1) (bs.length + 1)
    let take := addInf (absI (x - y)) (cost as bs)
    if leInf take (cost (x :: as) (y :: bs)) then (i, j) :: trace as bs (i + 1) (j + 1)
    else if as.length + 1 > left ∧ cost as (y :: bs) = cost (x :: as) (y :: bs) then
      trace as (y :: bs) (i + 1) j
    else trace (x :: as) bs i (j + 1)
termination_by as bs => as.length + bs.length

/-- src/steps.ts:226-258 -/
def pairSorted (a b : List Int) : List (Nat × Nat) :=
  if min a.length b.length = 0 then [] else trace a b 0 0

/-- A non-crossing matching of `as` against `bs`, whose first elements stand at
    positions `i` and `j`: the pairs made, and their total distance. Walking
    both lists front to back, each element is paired with the other list's
    current one or skipped — which is what "with i and j both increasing"
    means. -/
inductive Matching : List Int → List Int → Nat → Nat → List (Nat × Nat) → Int → Prop
  | done (as bs i j) : Matching as bs i j [] 0
  | take {x y as bs i j ps c} :
      Matching as bs (i + 1) (j + 1) ps c → Matching (x :: as) (y :: bs) i j ((i, j) :: ps) (absI (x - y) + c)
  | skipA {x as bs i j ps c} : Matching as bs (i + 1) j ps c → Matching (x :: as) bs i j ps c
  | skipB {y as bs i j ps c} : Matching as bs i (j + 1) ps c → Matching as (y :: bs) i j ps c

/-- No cell of the table is `Infinity`, and none is negative. -/
theorem cost_some (as bs : List Int) : ∃ c, cost as bs = some c ∧ 0 ≤ c := by
  induction as, bs using cost.induct with
  | case1 bs => exact ⟨0, by simp [cost], Int.le_refl _⟩
  | case2 x as => exact ⟨0, by simp [cost], Int.le_refl _⟩
  | case3 x as y bs ih1 ih2 ih3 =>
    obtain ⟨c1, h1, p1⟩ := ih1
    have hx := absI_nonneg (x - y)
    rw [cost]; simp only [h1, addInf, Option.map_some]
    by_cases hA : as.length + 1 > min (as.length + 1) (bs.length + 1)
    · obtain ⟨c2, h2, p2⟩ := ih2
      have hB : ¬ bs.length + 1 > min (as.length + 1) (bs.length + 1) := by omega
      simp only [hA, hB, ite_true, ite_false, h2, minInf]
      exact ⟨_, rfl, by omega⟩
    · by_cases hB : bs.length + 1 > min (as.length + 1) (bs.length + 1)
      · obtain ⟨c3, h3, p3⟩ := ih3
        simp only [hA, hB, ite_true, ite_false, h3, minInf]
        exact ⟨_, rfl, by omega⟩
      · simp only [hA, hB, ite_false, minInf]
        exact ⟨_, rfl, by omega⟩

/-- The recurrence, with the `Infinity`s resolved: what a cell is when neither
    suffix is empty. -/
theorem cost_cons (x y : Int) (as bs : List Int) (c1 : Int) (h1 : cost as bs = some c1) :
    (as.length = bs.length ∧ cost (x :: as) (y :: bs) = some (absI (x - y) + c1)) ∨
    (as.length > bs.length ∧ ∃ c2, cost as (y :: bs) = some c2 ∧
        cost (x :: as) (y :: bs) = some (min (absI (x - y) + c1) c2)) ∨
    (as.length < bs.length ∧ ∃ c3, cost (x :: as) bs = some c3 ∧
        cost (x :: as) (y :: bs) = some (min (absI (x - y) + c1) c3)) := by
  rw [cost]; simp only [h1, addInf, Option.map_some]
  by_cases hA : as.length + 1 > min (as.length + 1) (bs.length + 1)
  · obtain ⟨c2, h2, _⟩ := cost_some as (y :: bs)
    have hB : ¬ bs.length + 1 > min (as.length + 1) (bs.length + 1) := by omega
    right; left
    refine ⟨by omega, c2, h2, ?_⟩
    simp only [hA, hB, ite_true, ite_false, h2, minInf]
  · by_cases hB : bs.length + 1 > min (as.length + 1) (bs.length + 1)
    · obtain ⟨c3, h3, _⟩ := cost_some (x :: as) bs
      right; right
      refine ⟨by omega, c3, h3, ?_⟩
      simp only [hA, hB, ite_true, ite_false, h3, minInf]
    · left
      refine ⟨by omega, ?_⟩
      simp only [hA, hB, ite_false, minInf]

/-- **Holds.** The pairs `pairSorted` returns are a non-crossing matching, as
    many as fit ("min(|a|,|b|) pairs"), and their total distance is the
    table's top-left cell. -/
theorem trace_matching (as bs : List Int) (i j : Nat) :
    ∃ c, cost as bs = some c ∧ Matching as bs i j (trace as bs i j) c ∧
      (trace as bs i j).length = min as.length bs.length := by
  induction as, bs, i, j using trace.induct with
  | case1 bs i j => exact ⟨0, by simp [cost], by rw [trace]; exact .done _ _ _ _, by simp [trace]⟩
  | case2 x as i j => exact ⟨0, by simp [cost], by rw [trace]; exact .done _ _ _ _, by simp [trace]⟩
  | case3 x as y bs i j take htake ih =>
    obtain ⟨c1, h1, m1, l1⟩ := ih
    obtain ⟨c, hc, _⟩ := cost_some (x :: as) (y :: bs)
    have htake' : leInf (addInf (absI (x - y)) (cost as bs)) (cost (x :: as) (y :: bs)) = true := htake
    rw [trace]; simp only [htake', ite_true]
    rw [h1, hc] at htake'
    simp only [addInf, Option.map_some, leInf, decide_eq_true_eq] at htake'
    have : c = absI (x - y) + c1 := by
      rcases cost_cons x y as bs c1 h1 with ⟨_, e⟩ | ⟨_, c2, _, e⟩ | ⟨_, c3, _, e⟩ <;>
        (rw [hc] at e; cases e; omega)
    subst this
    exact ⟨_, hc, .take m1, by simp only [List.length_cons, l1]; omega⟩
  | case4 x as y bs i j left take htake hskip ih =>
    obtain ⟨c2, h2, m2, l2⟩ := ih
    have htake' : ¬ leInf (addInf (absI (x - y)) (cost as bs)) (cost (x :: as) (y :: bs)) = true := htake
    have hskip' : as.length + 1 > min (as.length + 1) (bs.length + 1) ∧
        cost as (y :: bs) = cost (x :: as) (y :: bs) := hskip
    rw [trace]; simp only [htake', hskip', Bool.false_eq_true, ite_false, and_self, ite_true]
    refine ⟨c2, ?_, .skipA m2, ?_⟩
    · rw [← hskip'.2]; exact h2
    · have := hskip'.1; simp only [List.length_cons] at l2 ⊢; omega
  | case5 x as y bs i j left take htake hskip ih =>
    obtain ⟨c3, h3, m3, l3⟩ := ih
    obtain ⟨c1, h1, _⟩ := cost_some as bs
    obtain ⟨c, hc, _⟩ := cost_some (x :: as) (y :: bs)
    have htake' : ¬ leInf (addInf (absI (x - y)) (cost as bs)) (cost (x :: as) (y :: bs)) = true := htake
    have hskip' : ¬ (as.length + 1 > min (as.length + 1) (bs.length + 1) ∧
        cost as (y :: bs) = cost (x :: as) (y :: bs)) := hskip
    rw [trace]; simp only [htake', hskip', Bool.false_eq_true, ite_false]
    rw [h1, hc] at htake'
    simp only [addInf, Option.map_some, leInf, decide_eq_true_eq] at htake'
    -- the cell is not `take`, and not `skipA`: so it is `skipB`, which is allowed
    rcases cost_cons x y as bs c1 h1 with ⟨_, e⟩ | ⟨hlen, c2, h2, e⟩ | ⟨hlen, c3', h3', e⟩
    · rw [hc] at e; cases e; omega
    · rw [hc] at e; cases e
      exfalso; apply hskip'
      refine ⟨by omega, ?_⟩
      rw [h2, hc]; congr 1; omega
    · rw [hc] at e; cases e
      rw [h3] at h3'; cases h3'
      refine ⟨c3, ?_, .skipB m3, ?_⟩
      · rw [hc]; congr 1; omega
      · simp only [List.length_cons] at l3 ⊢; omega

theorem Matching.length_le {as bs : List Int} {i j : Nat} {ps : List (Nat × Nat)} {c : Int}
    (m : Matching as bs i j ps c) : ps.length ≤ min as.length bs.length := by
  induction m with
  | done => simp
  | take _ ih => simp only [List.length_cons]; omega
  | skipA _ ih => simp only [List.length_cons]; omega
  | skipB _ ih => simp only [List.length_cons]; omega

theorem Matching.cost_nonneg {as bs : List Int} {i j : Nat} {ps : List (Nat × Nat)} {c : Int}
    (m : Matching as bs i j ps c) : 0 ≤ c := by
  induction m with
  | done => exact Int.le_refl _
  | @take x y _ _ _ _ _ _ _ ih => have := absI_nonneg (x - y); omega
  | skipA _ ih => exact ih
  | skipB _ ih => exact ih

/-- **Holds.** "so total |a[i] - b[j]| is least": no non-crossing matching
    with as many pairs costs less than the table says. -/
theorem cost_le_matching {as bs : List Int} {i j : Nat} {ps : List (Nat × Nat)} {c' : Int}
    (m : Matching as bs i j ps c') (hfull : ps.length = min as.length bs.length)
    (c : Int) (hc : cost as bs = some c) : c ≤ c' := by
  induction m generalizing c with
  | done as bs i j =>
    -- no pairs at all: one list is empty, and the cell is 0
    cases as with
    | nil => simp [cost] at hc; omega
    | cons x as =>
      cases bs with
      | nil => simp [cost] at hc; omega
      | cons y bs => simp at hfull
  | @take x y as bs i j ps c0 m ih =>
    obtain ⟨c1, h1, _⟩ := cost_some as bs
    have := ih (by simp only [List.length_cons] at hfull; omega) c1 h1
    rcases cost_cons x y as bs c1 h1 with ⟨_, e⟩ | ⟨_, c2, _, e⟩ | ⟨_, c3, _, e⟩ <;>
      (rw [hc] at e; cases e; omega)
  | @skipA x as bs i j ps c0 m ih =>
    have hle := m.length_le
    have hnn := m.cost_nonneg
    cases bs with
    | nil => simp [cost] at hc; omega
    | cons y bs =>
      simp only [List.length_cons] at hfull hle
      have hlen : as.length > bs.length := by omega
      obtain ⟨c1, h1, _⟩ := cost_some as bs
      obtain ⟨c2, h2, _⟩ := cost_some as (y :: bs)
      have := ih (by simp only [List.length_cons]; omega) c2 h2
      rcases cost_cons x y as bs c1 h1 with ⟨_, e⟩ | ⟨_, c2', h2', e⟩ | ⟨_, c3, _, e⟩
      · omega
      · rw [hc] at e; cases e; rw [h2] at h2'; cases h2'; omega
      · omega
  | @skipB y as bs i j ps c0 m ih =>
    have hle := m.length_le
    have hnn := m.cost_nonneg
    cases as with
    | nil => simp [cost] at hc; omega
    | cons x as =>
      simp only [List.length_cons] at hfull hle
      have hlen : as.length < bs.length := by omega
      obtain ⟨c1, h1, _⟩ := cost_some as bs
      obtain ⟨c3, h3, _⟩ := cost_some (x :: as) bs
      have := ih (by simp only [List.length_cons]; omega) c3 h3
      rcases cost_cons x y as bs c1 h1 with ⟨_, e⟩ | ⟨_, c2, _, e⟩ | ⟨_, c3', h3', e⟩
      · omega
      · omega
      · rw [hc] at e; cases e; rw [h3] at h3'; cases h3'; omega

/-- What a non-crossing matching is, read off its pairs: positions inside the
    two lists, increasing in both. -/
theorem Matching.pairs {as bs : List Int} {i j : Nat} {ps : List (Nat × Nat)} {c : Int}
    (m : Matching as bs i j ps c) :
    (∀ p ∈ ps, i ≤ p.1 ∧ p.1 < i + as.length ∧ j ≤ p.2 ∧ p.2 < j + bs.length) ∧
      ps.Pairwise (fun p q => p.1 < q.1 ∧ p.2 < q.2) := by
  induction m with
  | done => simp
  | @take x y as bs i j ps c m ih =>
    refine ⟨?_, ?_⟩
    · intro p hp
      rcases List.mem_cons.mp hp with rfl | hp
      · simp only [List.length_cons]; omega
      · have := ih.1 p hp; simp only [List.length_cons]; omega
    · rw [List.pairwise_cons]
      exact ⟨fun q hq => by have := ih.1 q hq; simp only; omega, ih.2⟩
  | skipA m ih =>
    exact ⟨fun p hp => by have := ih.1 p hp; simp only [List.length_cons]; omega, ih.2⟩
  | skipB m ih =>
    exact ⟨fun p hp => by have := ih.1 p hp; simp only [List.length_cons]; omega, ih.2⟩

/-- **Holds.** `pairSorted` is the "Optimal non-crossing matching" its comment
    says (steps.ts:218): it makes `min(|a|, |b|)` pairs, with positions in
    range and increasing in both lists, and no non-crossing matching of that
    many pairs has a smaller total distance. -/
theorem pairSorted_optimal (a b : List Int) :
    ∃ c, Matching a b 0 0 (pairSorted a b) c ∧
      (pairSorted a b).length = min a.length b.length ∧
      ∀ ps c', Matching a b 0 0 ps c' → ps.length = min a.length b.length → c ≤ c' := by
  obtain ⟨c, hc, m, hl⟩ := trace_matching a b 0 0
  have e : pairSorted a b = trace a b 0 0 := by
    unfold pairSorted
    by_cases h0 : min a.length b.length = 0
    · simp only [h0, ite_true]; symm
      apply List.eq_nil_of_length_eq_zero; rw [hl]; exact h0
    · simp only [h0, ite_false]
  rw [e]
  exact ⟨c, m, hl, fun ps c' m' hfull => cost_le_matching m' hfull c hc⟩

/-- **Holds.** `pairSorted`'s pairs index into the lists and never cross:
    "with i and j both increasing". -/
theorem pairSorted_pairs (a b : List Int) :
    (∀ p ∈ pairSorted a b, p.1 < a.length ∧ p.2 < b.length) ∧
      (pairSorted a b).Pairwise (fun p q => p.1 < q.1 ∧ p.2 < q.2) := by
  obtain ⟨c, m, _, _⟩ := pairSorted_optimal a b
  have := m.pairs
  exact ⟨fun p hp => by have := this.1 p hp; omega, this.2⟩

/-! # movesBetween — src/steps.ts:194-216

> "Hands are matched separately (decision 3), so a right-hand arrow can never
> point at a left-hand key" — steps.ts:188
> "two voices on one pitch are one key, and one key is one arrow." — steps.ts:208
-/

/-- src/steps.ts:86 -/
structure Move where
  from_ : Int
  to : Int
  hand : Option Hand
  deriving Repr, DecidableEq

/-- steps.ts:209-210 — `[...new Set(xs)].sort((a, b) => a - b)`. -/
def sortedSet (xs : List Int) : List Int := xs.eraseDups.mergeSort (fun a b => decide (a ≤ b))

/-- steps.ts:202 — the keys held during `current`, in one hand's bucket. -/
def fromOf (current : Step) (k : Option Hand) : List Int :=
  sortedSet (((soundingIn current).filter (fun n => n.hand == k)).map (·.pitch))

/-- steps.ts:203 — the keys struck in `next`, in one hand's bucket. -/
def toOf (next : Step) (k : Option Hand) : List Int :=
  sortedSet ((next.attack.filter (fun n => n.hand == k)).map (·.pitch))

/-- steps.ts:206-213 — one hand's arrows. -/
def movesFor (current next : Step) (k : Option Hand) : List Move :=
  (pairSorted (fromOf current k) (toOf next k)).map fun ij =>
    { from_ := (fromOf current k).getD ij.1 0, to := (toOf next k).getD ij.2 0, hand := k }

/-- steps.ts:215 — `a.from - b.from || a.to - b.to`, as "a sorts no later than b". -/
def moveLe (a b : Move) : Bool :=
  decide (a.from_ < b.from_) || (decide (a.from_ = b.from_) && decide (a.to ≤ b.to))

/-- src/steps.ts:194-216. The buckets are visited in the order a `Map` holds
    them — first seen, first — and the result re-sorted. -/
def movesBetween (current next : Step) : List Move :=
  let hands := ((soundingIn current).map (·.hand) ++ next.attack.map (·.hand)).eraseDups
  (hands.flatMap (movesFor current next)).mergeSort moveLe

theorem eraseDups_nodup (l : List Int) : l.eraseDups.Pairwise (· ≠ ·) := by
  suffices ∀ n (l : List Int), l.length ≤ n → l.eraseDups.Pairwise (· ≠ ·) from this l.length l (Nat.le_refl _)
  intro n
  induction n with
  | zero => intro l h; have : l = [] := List.eq_nil_of_length_eq_zero (by omega); subst this; simp
  | succ n ih =>
    intro l h
    cases l with
    | nil => simp
    | cons a rest =>
      rw [List.eraseDups_cons, List.pairwise_cons]
      refine ⟨?_, ih _ ?_⟩
      · intro b hb e
        rw [List.mem_eraseDups, List.mem_filter] at hb
        subst e; simp at hb
      · have := List.length_filter_le (fun b => !b == a) rest
        simp only [List.length_cons] at h; omega

/-- A sorted set is strictly ascending, and holds exactly the given values. -/
theorem sortedSet_spec (xs : List Int) :
    (sortedSet xs).Pairwise (· < ·) ∧ ∀ x, x ∈ sortedSet xs ↔ x ∈ xs := by
  unfold sortedSet
  have hle := List.pairwise_mergeSort (le := fun (a b : Int) => decide (a ≤ b))
    (by intro a b c; simp; omega) (by intro a b; simp; omega) xs.eraseDups
  have hne : (xs.eraseDups.mergeSort (fun a b => decide (a ≤ b))).Pairwise (· ≠ ·) :=
    (List.Perm.pairwise_iff (fun h => Ne.symm h) (List.mergeSort_perm _ _)).mpr (eraseDups_nodup xs)
  refine ⟨?_, ?_⟩
  · exact (hle.and hne).imp (by intro a b ⟨h1, h2⟩; simp at h1; omega)
  · intro x; rw [List.mem_mergeSort, List.mem_eraseDups]

theorem getD_strictMono (l : List Int) (hs : l.Pairwise (· < ·)) (i j : Nat) (hij : i < j) (hj : j < l.length) :
    l.getD i 0 < l.getD j 0 := by
  have hi : i < l.length := by omega
  simp only [List.getD_eq_getElem?_getD, List.getElem?_eq_getElem hi, List.getElem?_eq_getElem hj, Option.getD_some]
  exact (List.pairwise_iff_getElem.mp hs) i j hi hj hij

/-- **Holds.** Within one hand, "one key is one arrow": the arrows' starting
    keys ascend strictly and so do the keys they point to, so no key starts
    two arrows and no key receives two. As many arrows as the smaller side
    has keys. -/
theorem movesFor_one_arrow_per_key (current next : Step) (k : Option Hand) :
    (movesFor current next k).Pairwise (fun a b => a.from_ < b.from_ ∧ a.to < b.to) ∧
      (movesFor current next k).length = min (fromOf current k).length (toOf next k).length := by
  obtain ⟨hin, hpair⟩ := pairSorted_pairs (fromOf current k) (toOf next k)
  have hf := (sortedSet_spec (((soundingIn current).filter (fun n => n.hand == k)).map (·.pitch))).1
  have ht := (sortedSet_spec ((next.attack.filter (fun n => n.hand == k)).map (·.pitch))).1
  refine ⟨?_, ?_⟩
  · unfold movesFor
    rw [List.pairwise_map]
    apply hpair.imp_of_mem
    intro p q hp hq hlt
    exact ⟨getD_strictMono _ hf _ _ hlt.1 (hin q hq).1, getD_strictMono _ ht _ _ hlt.2 (hin q hq).2⟩
  · unfold movesFor
    rw [List.length_map]
    exact (pairSorted_optimal _ _).choose_spec.2.1

/-- **Holds.** "a right-hand arrow can never point at a left-hand key": every
    arrow starts on a key that is down in the current step and ends on a key
    the next step strikes, and both belong to the arrow's own hand. -/
theorem movesBetween_same_hand (current next : Step) (m : Move) (hm : m ∈ movesBetween current next) :
    (∃ n ∈ soundingIn current, n.pitch = m.from_ ∧ n.hand = m.hand) ∧
      (∃ n ∈ next.attack, n.pitch = m.to ∧ n.hand = m.hand) := by
  unfold movesBetween at hm
  simp only [List.mem_mergeSort, List.mem_flatMap] at hm
  obtain ⟨k, _, hmk⟩ := hm
  unfold movesFor at hmk
  obtain ⟨ij, hij, rfl⟩ := List.mem_map.mp hmk
  obtain ⟨h1, h2⟩ := (pairSorted_pairs (fromOf current k) (toOf next k)).1 ij hij
  refine ⟨?_, ?_⟩
  · have hmem : (fromOf current k).getD ij.1 0 ∈ fromOf current k := by
      simp only [List.getD_eq_getElem?_getD, List.getElem?_eq_getElem h1, Option.getD_some]
      exact List.getElem_mem _
    unfold fromOf at hmem
    rw [(sortedSet_spec _).2] at hmem
    obtain ⟨n, hn, e⟩ := List.mem_map.mp hmem
    rw [List.mem_filter] at hn
    exact ⟨n, hn.1, e, by simpa using hn.2⟩
  · have hmem : (toOf next k).getD ij.2 0 ∈ toOf next k := by
      simp only [List.getD_eq_getElem?_getD, List.getElem?_eq_getElem h2, Option.getD_some]
      exact List.getElem_mem _
    unfold toOf at hmem
    rw [(sortedSet_spec _).2] at hmem
    obtain ⟨n, hn, e⟩ := List.mem_map.mp hmem
    rw [List.mem_filter] at hn
    exact ⟨n, hn.1, e, by simpa using hn.2⟩

/-- **Holds.** "one stable order regardless of Map iteration, so markup is
    deterministic" (steps.ts:214): the arrows come out sorted by the key they
    start on, then by the key they point to. -/
theorem movesBetween_sorted (current next : Step) :
    (movesBetween current next).Pairwise
      (fun a b => a.from_ < b.from_ ∨ (a.from_ = b.from_ ∧ a.to ≤ b.to)) := by
  unfold movesBetween
  have := List.pairwise_mergeSort (le := moveLe)
    (by
      intro a b c h1 h2
      simp only [moveLe, Bool.or_eq_true, Bool.and_eq_true, decide_eq_true_eq] at *
      omega)
    (by
      intro a b
      simp only [moveLe, Bool.or_eq_true, Bool.and_eq_true, decide_eq_true_eq]
      omega)
    ((((soundingIn current).map (·.hand) ++ next.attack.map (·.hand)).eraseDups).flatMap (movesFor current next))
  exact this.imp (by
    intro a b h
    simpa only [moveLe, Bool.or_eq_true, Bool.and_eq_true, decide_eq_true_eq] using h)

end Harmonicland
