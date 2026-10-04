import Harmonicland.Core

/-!
# Perform — `src/perform.ts`

Score → performance: each note's velocity, which notes are struck at all,
where each really ends, and when its dampers fall.

## What the model is

A line-by-line translation over the `Score` of `Core.lean`.

* The two binary searches (`heldTo`, perform.ts:70-80; `firstAtOrAfter`,
  perform.ts:164-173) are one function, `bsearch`, over the test each applies.
* `perform`'s two `Map`s keyed by note id (`velocity`) and by `"pitch@onset"`
  (`struck`) become a list `keys` of `(note, velocity)` pairs, in the order
  the code's `keys` array holds them. Reading `velocity.get(keys[i].id)` is
  reading the pair — the same thing exactly when ids are unique, which
  `makeNotes_id_unique` proves of every `Score` that `makeScore` builds.
* `Infinity` (no later note on this pitch) is `none`.

## What the model leaves out

Floating point. The key `"pitch@onset"` compares onsets as strings of
doubles; here it compares them as rationals.
-/

namespace Harmonicland

/-- src/perform.ts:34 -/
def DEFAULT_VELOCITY : Int := 80

/-- src/perform.ts:37-40 -/
def SHAPE_BASE : Int := 72
def SHAPE_DOWNBEAT : Int := 8
def SHAPE_SECONDARY : Int := 4
def SHAPE_LOWER_HAND : Int := -6

/-- src/perform.ts:47 -/
structure PerfNote where
  id : Nat
  pitch : Int
  velocity : Int
  onset : Rat
  end_ : Rat
  damp : Rat
  deriving Repr, DecidableEq

/-- src/perform.ts:63 -/
structure Performance where
  notes : List PerfNote
  pedal : List TimeRange
  deriving Repr

/-- perform.ts:73-77 and 167-171 — `while (lo < hi) { mid = (lo + hi) >> 1;
    if (test(mid)) lo = mid + 1; else hi = mid }`, returning `lo`. -/
def bsearch (test : Nat → Bool) (lo hi : Nat) : Nat :=
  if lo < hi then
    let mid := (lo + hi) / 2
    if test mid then bsearch test (mid + 1) hi else bsearch test lo mid
  else lo
termination_by hi - lo

/-- perform.ts:75 — `pedal[mid].end <= t`. -/
def liftedBy (pedal : List TimeRange) (t : Rat) (mid : Nat) : Bool :=
  match pedal[mid]? with
  | some r => decide (r.end_ ≤ t)
  | none => false

/-- src/perform.ts:70-80 -/
def heldTo (pedal : List TimeRange) (t : Rat) : Rat :=
  let lo := bsearch (liftedBy pedal t) 0 pedal.length
  match pedal[lo]? with
  | some r => if r.start < t then r.end_ else t
  | none => t

/-- perform.ts:88-89 — how many notes carry velocity `v`. -/
def countOf (notes : List Note) (v : Option Int) : Nat :=
  (notes.filter (fun n => n.velocity == v)).length

/-- perform.ts:90-92 — the commonest velocity, the first met winning a tie:
    a `Map` iterates in insertion order and `c > most` is strict. -/
def commonest (notes : List Note) : Option Int × Nat :=
  ((notes.map (·.velocity)).eraseDups).foldl
    (fun (acc : Option Int × Nat) v => if countOf notes v > acc.2 then (v, countOf notes v) else acc)
    (none, 0)

/-- src/perform.ts:87-94 — `none` is the code's `null`; `some none` is a flat
    score whose one velocity is "absent". `FLAT_SHARE` is 0.95. -/
def flatVelocity (score : Score) : Option (Option Int) :=
  let (common, most) := commonest score.notes
  if (most : Rat) ≥ (95 / 100) * (score.notes.length : Rat) then some common else none

/-- src/perform.ts:97 -/
def isFlat (score : Score) : Bool := (flatVelocity score).isSome

/-- src/perform.ts:102-108 -/
def metricLift (bar : Bar) (t : Rat) : Int :=
  let len := bar.end_ - bar.start
  let near := fun (x : Rat) => decide (absR (t - x) < min (3 / 100) (len / 64))
  if near bar.start then SHAPE_DOWNBEAT
  -- `bar.beats % 2 === 0`: `beats` is an even whole number
  else if bar.beats ≥ 4 ∧ ((bar.beats / 2).floor : Rat) = bar.beats / 2 ∧ near (bar.start + len / 2) then
    SHAPE_SECONDARY
  else 0

/-- perform.ts:117 — `while (b + 1 < bars.length && bars[b + 1].start <= onset + 1e-9) b++`. -/
def advanceBar (bars : List Bar) (onset : Rat) (b : Nat) : Nat :=
  if h : b + 1 < bars.length then
    if bars[b + 1].start ≤ onset + 1 / 1000000000 then advanceBar bars onset (b + 1) else b
  else b
termination_by bars.length - b

/-- perform.ts:116-121 — the shaped velocities, `b` carried from note to note. -/
def shapeGo (bars : List Bar) (flat : Option Int) : Nat → List Note → List Int
  | _, [] => []
  | b, n :: rest =>
    let b' := advanceBar bars n.onset b
    (if n.velocity ≠ flat then n.velocity.getD DEFAULT_VELOCITY
     else SHAPE_BASE + metricLift (bars.getD b' default) n.onset +
       (if n.hand = some Hand.lower then SHAPE_LOWER_HAND else 0)) :: shapeGo bars flat b' rest

/-- src/perform.ts:111-122 -/
def velocities (score : Score) (shape : Bool) : List Int :=
  match flatVelocity score with
  | none => score.notes.map (fun n => n.velocity.getD DEFAULT_VELOCITY)
  | some flat =>
    if ¬ shape then score.notes.map (fun n => n.velocity.getD DEFAULT_VELOCITY)
    else shapeGo score.bars flat 0 score.notes

/-- Is `k` the key `n` strikes — the same `"pitch@onset"` (perform.ts:132)? -/
def sameKey (k : Note × Int) (n : Note) : Bool := decide (k.1.pitch = n.pitch) && decide (k.1.onset = n.onset)

/-- perform.ts:131-142, one note of the loop: a new key, or a unison folded
    into the key already struck. -/
def strikeKey (keys : List (Note × Int)) (n : Note) (v : Int) : List (Note × Int) :=
  if keys.any (fun k => sameKey k n) then
    keys.map (fun k => if sameKey k n then (if n.duration > k.1.duration then n else k.1, max v k.2) else k)
  else keys ++ [(n, v)]

/-- perform.ts:129-142 -/
def keysOf (notes : List Note) (vels : List Int) : List (Note × Int) :=
  (notes.zip vels).foldl (fun keys nv => strikeKey keys nv.1 nv.2) []

/-- perform.ts:148 — `nextOnset.get(n.pitch) ?? Infinity`, walking backwards:
    the onset of the nearest later key on this pitch. -/
def nextOnsetOf (later : List (Note × Int)) (pitch : Int) : Option Rat :=
  (later.find? (fun k => decide (k.1.pitch = pitch))).map (·.1.onset)

/-- `Math.min(x, next)` where `next` may be `Infinity`. -/
def minNext (x : Rat) (next : Option Rat) : Rat :=
  match next with
  | some y => min x y
  | none => x

/-- perform.ts:146-159 -/
def cut (pedal : List TimeRange) : List (Note × Int) → List PerfNote
  | [] => []
  | (n, v) :: later =>
    let next := nextOnsetOf later n.pitch
    let end_ := minNext (n.onset + n.duration) next
    { id := n.id, pitch := n.pitch, velocity := v, onset := n.onset, end_,
      damp := minNext (heldTo pedal end_) next } :: cut pedal later

/-- src/perform.ts:124-161 -/
def perform (score : Score) (shape : Bool := true) : Performance :=
  { notes := cut score.pedal (keysOf score.notes (velocities score shape)), pedal := score.pedal }

/-- perform.ts:169 — `p.notes[mid].onset < t`. -/
def beginsBefore (notes : List PerfNote) (t : Rat) (mid : Nat) : Bool :=
  match notes[mid]? with
  | some n => decide (n.onset < t)
  | none => false

/-- src/perform.ts:164-173 -/
def firstAtOrAfter (p : Performance) (t : Rat) : Nat :=
  bsearch (beginsBefore p.notes t) 0 p.notes.length

/-! # Theorems

## The binary search -/

/-- What the loop returns, for any test: an index in range at which the test
    fails (or the end), and — when the test is true up to some point and false
    after it — the test holds everywhere before that index. -/
theorem bsearch_spec (test : Nat → Bool) (lo hi : Nat) (hle : lo ≤ hi) :
    lo ≤ bsearch test lo hi ∧ bsearch test lo hi ≤ hi ∧
      (bsearch test lo hi < hi → test (bsearch test lo hi) = false) ∧
      ((∀ i j, i ≤ j → test j = true → test i = true) →
        ∀ i, lo ≤ i → i < bsearch test lo hi → test i = true) := by
  induction lo, hi using bsearch.induct test with
  | case1 lo hi hlt mid htest ih =>
    have hmid : mid = (lo + hi) / 2 := rfl
    rw [bsearch]; simp only [hlt, ite_true]
    have hm : test ((lo + hi) / 2) = true := htest
    simp only [hm, ite_true]
    rw [← hmid]
    obtain ⟨h1, h2, h3, h4⟩ := ih (by omega)
    refine ⟨by omega, h2, h3, ?_⟩
    intro hmono i hlo' hlt'
    by_cases hc : i ≤ mid
    · exact hmono i _ hc (hmid ▸ hm)
    · exact h4 hmono i (by omega) hlt'
  | case2 lo hi hlt mid htest ih =>
    have hmid : mid = (lo + hi) / 2 := rfl
    rw [bsearch]; simp only [hlt, ite_true]
    have hm : test ((lo + hi) / 2) = false := by simpa using htest
    simp only [hm, Bool.false_eq_true, ite_false]
    rw [← hmid]
    obtain ⟨h1, h2, h3, h4⟩ := ih (by omega)
    refine ⟨h1, by omega, ?_, h4⟩
    intro hlt'
    by_cases hc : bsearch test lo mid < mid
    · exact h3 hc
    · have : bsearch test lo mid = mid := by omega
      rw [this, hmid]; exact hm
  | case3 lo hi hge =>
    rw [bsearch]; simp only [hge, ite_false]
    exact ⟨Nat.le_refl _, hle, fun h => h.elim, fun _ i h1 h2 => by omega⟩

/-! ## heldTo

> "Where the pedal lifts, when it is down at `t` (and went down before it);
> otherwise `t`. The ranges are sorted and never overlap." — perform.ts:68
-/

/-- **Holds.** `heldTo` never answers a time before `t` — for any pedal list. -/
theorem heldTo_ge (pedal : List TimeRange) (t : Rat) : t ≤ heldTo pedal t := by
  unfold heldTo
  simp only
  obtain ⟨_, _, h3, _⟩ := bsearch_spec (liftedBy pedal t) 0 pedal.length (Nat.zero_le _)
  generalize bsearch _ 0 pedal.length = lo at h3
  cases hr : pedal[lo]? with
  | none => exact Rat.le_refl
  | some r =>
    simp only
    split
    · have hlt : lo < pedal.length := (List.getElem?_eq_some_iff.mp hr).1
      have := h3 hlt
      simp only [liftedBy, hr, decide_eq_false_iff_not] at this
      exact Rat.le_of_lt (Rat.not_le.mp this)
    · exact Rat.le_refl

/-- **Holds.** With the pedal not down at `t` — or only just going down at
    `t` — the dampers fall at `t`: "A note let go of at the very instant the
    pedal goes down is NOT caught" (perform.ts:25). For any pedal list. -/
theorem heldTo_of_up (pedal : List TimeRange) (t : Rat)
    (h : ∀ r ∈ pedal, ¬ (r.start < t ∧ t < r.end_)) : heldTo pedal t = t := by
  unfold heldTo
  simp only
  obtain ⟨_, _, h3, _⟩ := bsearch_spec (liftedBy pedal t) 0 pedal.length (Nat.zero_le _)
  generalize bsearch _ 0 pedal.length = lo at h3
  cases hr : pedal[lo]? with
  | none => rfl
  | some r =>
    simp only
    split
    · rename_i hst
      exfalso
      obtain ⟨hlt, e⟩ := List.getElem?_eq_some_iff.mp hr
      have := h3 hlt
      simp only [liftedBy, hr, decide_eq_false_iff_not] at this
      exact h r (by rw [← e]; exact List.getElem_mem _) ⟨hst, Rat.not_le.mp this⟩
    · rfl

/-- **Holds.** With the pedal down at `t`, and down since before it, the
    dampers fall "where the pedal lifts" — given what `Score.pedal` promises:
    ranges that are non-empty, sorted and never overlapping. -/
theorem heldTo_of_down (pedal : List TimeRange) (t : Rat)
    (hpos : ∀ r ∈ pedal, r.start < r.end_)
    (hsorted : pedal.Pairwise (fun a b => a.end_ ≤ b.start))
    (r : TimeRange) (hr : r ∈ pedal) (h1 : r.start < t) (h2 : t < r.end_) : heldTo pedal t = r.end_ := by
  unfold heldTo
  simp only
  have hmono : ∀ i j, i ≤ j → liftedBy pedal t j = true → liftedBy pedal t i = true := by
    intro i j hij hj
    unfold liftedBy at hj ⊢
    cases hpj : pedal[j]? with
    | none => simp [hpj] at hj
    | some rj =>
      simp only [hpj, decide_eq_true_eq] at hj
      obtain ⟨hjlt, ej⟩ := List.getElem?_eq_some_iff.mp hpj
      have hilt : i < pedal.length := by omega
      simp only [List.getElem?_eq_getElem hilt, decide_eq_true_eq]
      by_cases e : i = j
      · subst e; rw [ej]; exact hj
      · have := (List.pairwise_iff_getElem.mp hsorted) i j hilt hjlt (by omega)
        have := hpos pedal[i] (List.getElem_mem _)
        have := hpos pedal[j] (List.getElem_mem _)
        rw [ej] at *
        grind
  obtain ⟨_, hle, h3, h4⟩ := bsearch_spec (liftedBy pedal t) 0 pedal.length (Nat.zero_le _)
  have h4 := h4 hmono
  generalize bsearch _ 0 pedal.length = lo at h3 h4 hle
  obtain ⟨j, hj, rfl⟩ := List.getElem_of_mem hr
  -- `lo` is `r`'s own index
  have hlo : lo = j := by
    apply Nat.le_antisymm
    · apply Nat.le_of_not_lt; intro hlt
      have := h4 j (Nat.zero_le _) hlt
      simp only [liftedBy, List.getElem?_eq_getElem hj, decide_eq_true_eq] at this
      grind
    · apply Nat.le_of_not_lt; intro hlt
      have hlolt : lo < pedal.length := by omega
      have := h3 hlolt
      simp only [liftedBy, List.getElem?_eq_getElem hlolt, decide_eq_false_iff_not] at this
      have := (List.pairwise_iff_getElem.mp hsorted) lo j hlolt hj hlt
      grind
  subst hlo
  simp [List.getElem?_eq_getElem hj, h1]

/-! ## firstAtOrAfter

> "Index of the first note with onset >= t (binary search)." — perform.ts:163
-/

/-- **Holds.** On a performance sorted by onset, every note before the index
    begins before `t` and every note from it on begins at or after `t`. -/
theorem firstAtOrAfter_spec (p : Performance) (hs : p.notes.Pairwise (fun a b => a.onset ≤ b.onset)) (t : Rat) :
    firstAtOrAfter p t ≤ p.notes.length ∧
      (∀ j (hj : j < p.notes.length), j < firstAtOrAfter p t → p.notes[j].onset < t) ∧
      (∀ j (hj : j < p.notes.length), firstAtOrAfter p t ≤ j → t ≤ p.notes[j].onset) := by
  have hmono : ∀ i j, i ≤ j → beginsBefore p.notes t j = true → beginsBefore p.notes t i = true := by
    intro i j hij hj
    unfold beginsBefore at hj ⊢
    cases hpj : p.notes[j]? with
    | none => simp [hpj] at hj
    | some nj =>
      simp only [hpj, decide_eq_true_eq] at hj
      obtain ⟨hjlt, ej⟩ := List.getElem?_eq_some_iff.mp hpj
      have hilt : i < p.notes.length := by omega
      simp only [List.getElem?_eq_getElem hilt, decide_eq_true_eq]
      by_cases e : i = j
      · subst e; rw [ej]; exact hj
      · have := (List.pairwise_iff_getElem.mp hs) i j hilt hjlt (by omega)
        rw [ej] at this; grind
  obtain ⟨_, hle, h3, h4⟩ := bsearch_spec (beginsBefore p.notes t) 0 p.notes.length (Nat.zero_le _)
  have h4 := h4 hmono
  unfold firstAtOrAfter
  generalize bsearch _ 0 p.notes.length = lo at h3 h4 hle
  refine ⟨hle, ?_, ?_⟩
  · intro j hj hlt
    have := h4 j (Nat.zero_le _) hlt
    simpa [beginsBefore, List.getElem?_eq_getElem hj] using this
  · intro j hj hlo
    have hlolt : lo < p.notes.length := by omega
    have := h3 hlolt
    simp only [beginsBefore, List.getElem?_eq_getElem hlolt, decide_eq_false_iff_not] at this
    by_cases e : lo = j
    · subst e; exact Rat.not_lt.mp this
    · have := (List.pairwise_iff_getElem.mp hs) lo j hlolt hj (by omega)
      grind

/-! ## The keys

> "Two voices meeting on a unison are one key: struck once, held for the
> longer of the two" — perform.ts:17
> "The louder of the two decides how hard the one key is struck." — perform.ts:128
-/

/-- A key's identity: the code's `"pitch@onset"`. -/
def keyOf (k : Note × Int) : Int × Rat := (k.1.pitch, k.1.onset)

theorem sameKey_iff (k : Note × Int) (n : Note) : sameKey k n = true ↔ keyOf k = (n.pitch, n.onset) := by
  simp [sameKey, keyOf]

theorem strikeKey_keys (keys : List (Note × Int)) (n : Note) (v : Int) :
    (strikeKey keys n v).map keyOf =
      if keys.any (fun k => sameKey k n) then keys.map keyOf else keys.map keyOf ++ [(n.pitch, n.onset)] := by
  unfold strikeKey
  split
  · rw [List.map_map]
    apply List.map_congr_left
    intro k _
    simp only [Function.comp]
    by_cases hk : sameKey k n = true
    · simp only [hk, ite_true]
      have := (sameKey_iff k n).mp hk
      simp only [keyOf] at this ⊢
      split <;> simp_all
    · simp [hk]
  · simp [keyOf]

/-- What the unison loop keeps true: keys in onset order, no key twice, and
    every key at or before every note still to come. -/
theorem foldl_strikeKey (rest : List (Note × Int)) (keys : List (Note × Int))
    (hs : rest.Pairwise (fun a b => a.1.onset ≤ b.1.onset))
    (hle : ∀ k ∈ keys.map keyOf, ∀ nv ∈ rest, k.2 ≤ nv.1.onset)
    (hsorted : (keys.map keyOf).Pairwise (fun a b => a.2 ≤ b.2))
    (hnodup : (keys.map keyOf).Pairwise (· ≠ ·)) :
    ((rest.foldl (fun keys nv => strikeKey keys nv.1 nv.2) keys).map keyOf).Pairwise (fun a b => a.2 ≤ b.2) ∧
      ((rest.foldl (fun keys nv => strikeKey keys nv.1 nv.2) keys).map keyOf).Pairwise (· ≠ ·) := by
  induction rest generalizing keys with
  | nil => exact ⟨hsorted, hnodup⟩
  | cons nv rest ih =>
    rw [List.pairwise_cons] at hs
    simp only [List.foldl_cons]
    have hk := strikeKey_keys keys nv.1 nv.2
    apply ih _ hs.2
    · intro k hkm x hx
      rw [hk] at hkm
      split at hkm
      · exact hle k hkm x (by simp [hx])
      · rcases List.mem_append.mp hkm with h | h
        · exact hle k h x (by simp [hx])
        · simp only [List.mem_singleton] at h; subst h; exact hs.1 x hx
    · rw [hk]; split
      · exact hsorted
      · rw [List.pairwise_append]
        refine ⟨hsorted, by simp, ?_⟩
        intro a ha b hb
        simp only [List.mem_singleton] at hb; subst hb
        exact hle a ha nv (by simp)
    · rw [hk]; split
      · exact hnodup
      · rename_i hany
        rw [List.pairwise_append]
        refine ⟨hnodup, by simp, ?_⟩
        intro a ha b hb
        simp only [List.mem_singleton] at hb; subst hb
        intro e
        apply hany
        obtain ⟨k, hkmem, rfl⟩ := List.mem_map.mp ha
        exact List.any_eq_true.mpr ⟨k, hkmem, (sameKey_iff k nv.1).mpr e⟩

/-- The notes and velocities the unison loop walks, in order. -/
theorem zip_sorted (notes : List Note) (vels : List Int) (hs : notes.Pairwise (fun a b => a.onset ≤ b.onset)) :
    (notes.zip vels).Pairwise (fun a b => a.1.onset ≤ b.1.onset) := by
  induction notes generalizing vels with
  | nil => simp
  | cons n rest ih =>
    cases vels with
    | nil => simp
    | cons v vs =>
      rw [List.pairwise_cons] at hs
      simp only [List.zip_cons_cons, List.pairwise_cons]
      refine ⟨?_, ih vs hs.2⟩
      intro b hb
      exact hs.1 b.1 (List.of_mem_zip hb).1

/-- **Holds.** The keys are in onset order, and "Two voices meeting on a
    unison are one key": no `(pitch, onset)` is struck twice. -/
theorem keysOf_keys (notes : List Note) (vels : List Int) (hs : notes.Pairwise (fun a b => a.onset ≤ b.onset)) :
    ((keysOf notes vels).map keyOf).Pairwise (fun a b => a.2 ≤ b.2) ∧
      ((keysOf notes vels).map keyOf).Pairwise (· ≠ ·) :=
  foldl_strikeKey _ [] (zip_sorted notes vels hs) (by simp) (by simp) (by simp)

/-- A score note and its velocity, as the key that sounds for it holds them. -/
def Heard (keys : List (Note × Int)) (n : Note) (v : Int) : Prop :=
  ∃ k ∈ keys, keyOf k = (n.pitch, n.onset) ∧ n.duration ≤ k.1.duration ∧ v ≤ k.2

theorem strikeKey_heard_self (keys : List (Note × Int)) (n : Note) (v : Int) : Heard (strikeKey keys n v) n v := by
  unfold strikeKey
  split
  · rename_i hany
    obtain ⟨k, hk, hsame⟩ := List.any_eq_true.mp hany
    refine ⟨(if n.duration > k.1.duration then n else k.1, max v k.2), ?_, ?_, ?_, ?_⟩
    · apply List.mem_map.mpr; exact ⟨k, hk, by simp [hsame]⟩
    · have := (sameKey_iff k n).mp hsame
      simp only [keyOf] at this ⊢
      split <;> simp_all
    · simp only; split <;> grind
    · simp only; omega
  · exact ⟨(n, v), by simp, rfl, Rat.le_refl, Int.le_refl _⟩

theorem strikeKey_heard_keeps (keys : List (Note × Int)) (n m : Note) (v w : Int) (h : Heard keys m w) :
    Heard (strikeKey keys n v) m w := by
  obtain ⟨k, hk, hkey, hdur, hvel⟩ := h
  unfold strikeKey
  split
  · by_cases hsame : sameKey k n = true
    · refine ⟨(if n.duration > k.1.duration then n else k.1, max v k.2), ?_, ?_, ?_, ?_⟩
      · apply List.mem_map.mpr; exact ⟨k, hk, by simp [hsame]⟩
      · have := (sameKey_iff k n).mp hsame
        simp only [keyOf] at this hkey ⊢
        split <;> simp_all
      · simp only; split <;> grind
      · simp only; omega
    · exact ⟨k, List.mem_map.mpr ⟨k, hk, by simp [hsame]⟩, hkey, hdur, hvel⟩
  · exact ⟨k, by simp [hk], hkey, hdur, hvel⟩

theorem foldl_strikeKey_heard (rest : List (Note × Int)) (keys : List (Note × Int)) :
    (∀ m w, Heard keys m w → Heard (rest.foldl (fun keys nv => strikeKey keys nv.1 nv.2) keys) m w) ∧
      ∀ nv ∈ rest, Heard (rest.foldl (fun keys nv => strikeKey keys nv.1 nv.2) keys) nv.1 nv.2 := by
  induction rest generalizing keys with
  | nil => exact ⟨fun _ _ h => h, by simp⟩
  | cons nv rest ih =>
    simp only [List.foldl_cons]
    obtain ⟨ih1, ih2⟩ := ih (strikeKey keys nv.1 nv.2)
    refine ⟨fun m w h => ih1 m w (strikeKey_heard_keeps keys nv.1 m nv.2 w h), ?_⟩
    intro x hx
    rcases List.mem_cons.mp hx with rfl | hx
    · exact ih1 _ _ (strikeKey_heard_self keys _ _)
    · exact ih2 x hx

/-- **Holds.** No note is left out, and a unison is "held for the longer of
    the two" at the velocity of "the louder of the two": every score note has
    a key at its pitch and onset, lasting at least as long and struck at least
    as hard. -/
theorem keysOf_heard (notes : List Note) (vels : List Int) :
    ∀ nv ∈ notes.zip vels, Heard (keysOf notes vels) nv.1 nv.2 :=
  (foldl_strikeKey_heard _ []).2

theorem strikeKey_mem (keys : List (Note × Int)) (n : Note) (v : Int) :
    ∀ k ∈ strikeKey keys n v, k.1 = n ∨ ∃ k' ∈ keys, k.1 = k'.1 := by
  intro k hk
  unfold strikeKey at hk
  split at hk
  · obtain ⟨k', hk', rfl⟩ := List.mem_map.mp hk
    by_cases hsame : sameKey k' n = true
    · simp only [hsame, ite_true]
      split
      · left; rfl
      · right; exact ⟨k', hk', rfl⟩
    · simp only [hsame, Bool.false_eq_true, ite_false]
      exact Or.inr ⟨k', hk', rfl⟩
  · rcases List.mem_append.mp hk with hk | hk
    · exact Or.inr ⟨k, hk, rfl⟩
    · simp only [List.mem_singleton] at hk; subst hk
      exact Or.inl rfl

theorem strikeKey_bounds (keys : List (Note × Int)) (n : Note) (v : Int) (lo hi : Int) (hv : lo ≤ v ∧ v ≤ hi)
    (hkeys : ∀ k ∈ keys, lo ≤ k.2 ∧ k.2 ≤ hi) : ∀ k ∈ strikeKey keys n v, lo ≤ k.2 ∧ k.2 ≤ hi := by
  intro k hk
  unfold strikeKey at hk
  split at hk
  · obtain ⟨k', hk', rfl⟩ := List.mem_map.mp hk
    have := hkeys k' hk'
    by_cases hsame : sameKey k' n = true
    · simp only [hsame, ite_true]; omega
    · simp only [hsame, Bool.false_eq_true, ite_false]; exact this
  · rcases List.mem_append.mp hk with hk | hk
    · exact hkeys k hk
    · simp only [List.mem_singleton] at hk; subst hk; exact hv

theorem foldl_strikeKey_mem (rest : List (Note × Int)) (keys : List (Note × Int)) :
    ∀ k ∈ rest.foldl (fun keys nv => strikeKey keys nv.1 nv.2) keys,
      (∃ nv ∈ rest, k.1 = nv.1) ∨ ∃ k' ∈ keys, k.1 = k'.1 := by
  induction rest generalizing keys with
  | nil => intro k hk; exact Or.inr ⟨k, hk, rfl⟩
  | cons nv rest ih =>
    intro k hk
    simp only [List.foldl_cons] at hk
    rcases ih (strikeKey keys nv.1 nv.2) k hk with ⟨x, hx, e⟩ | ⟨k', hk', e⟩
    · left; exact ⟨x, by simp [hx], e⟩
    · rcases strikeKey_mem keys nv.1 nv.2 k' hk' with e' | ⟨k'', hk'', e'⟩
      · left; exact ⟨nv, by simp, by rw [e, e']⟩
      · right; exact ⟨k'', hk'', by rw [e, e']⟩

theorem foldl_strikeKey_bounds (rest : List (Note × Int)) (keys : List (Note × Int)) (lo hi : Int)
    (hrest : ∀ nv ∈ rest, lo ≤ nv.2 ∧ nv.2 ≤ hi) (hkeys : ∀ k ∈ keys, lo ≤ k.2 ∧ k.2 ≤ hi) :
    ∀ k ∈ rest.foldl (fun keys nv => strikeKey keys nv.1 nv.2) keys, lo ≤ k.2 ∧ k.2 ≤ hi := by
  induction rest generalizing keys with
  | nil => exact hkeys
  | cons nv rest ih =>
    simp only [List.foldl_cons]
    exact ih _ (fun x hx => hrest x (by simp [hx]))
      (strikeKey_bounds keys nv.1 nv.2 lo hi (hrest nv (by simp)) hkeys)

/-- **Holds.** Every key is one of the score's own notes. -/
theorem keysOf_mem (notes : List Note) (vels : List Int) : ∀ k ∈ keysOf notes vels, k.1 ∈ notes := by
  intro k hk
  rcases foldl_strikeKey_mem (notes.zip vels) [] k hk with ⟨nv, hnv, e⟩ | ⟨k', hk', _⟩
  · rw [e]; exact (List.of_mem_zip hnv).1
  · cases hk'

/-- **Holds.** Every key is struck at a velocity within whatever bounds every
    note's velocity is within. -/
theorem keysOf_bounds (notes : List Note) (vels : List Int) (lo hi : Int) (hv : ∀ v ∈ vels, lo ≤ v ∧ v ≤ hi) :
    ∀ k ∈ keysOf notes vels, lo ≤ k.2 ∧ k.2 ≤ hi :=
  foldl_strikeKey_bounds (notes.zip vels) [] lo hi
    (fun nv hnv => hv nv.2 (List.of_mem_zip hnv).2) (fun _ h => by cases h)

/-! ## The cut

> "A key cannot sound twice at once, so a note is cut where the next note on
> its pitch begins." — perform.ts:19
> "when the dampers fall: `end`, or later where the sustain pedal holds them
> off; never past the key's next strike." — perform.ts:56
-/

theorem cut_keys (pedal : List TimeRange) (keys : List (Note × Int)) :
    (cut pedal keys).map (fun p => (p.pitch, p.onset)) = keys.map keyOf := by
  induction keys with
  | nil => rfl
  | cons k rest ih => obtain ⟨n, v⟩ := k; simp [cut, ih, keyOf]

theorem minNext_le (x : Rat) (next : Option Rat) : minNext x next ≤ x := by
  unfold minNext; split <;> grind

/-- In keys sorted by onset, the nearest later key on a pitch is the earliest. -/
theorem nextOnsetOf_le (later : List (Note × Int)) (pitch : Int)
    (hs : (later.map keyOf).Pairwise (fun a b => a.2 ≤ b.2)) (k : Note × Int) (hk : k ∈ later)
    (hp : k.1.pitch = pitch) : ∃ x, nextOnsetOf later pitch = some x ∧ x ≤ k.1.onset := by
  induction later with
  | nil => cases hk
  | cons a rest ih =>
    simp only [List.map_cons, List.pairwise_cons] at hs
    unfold nextOnsetOf
    by_cases ha : a.1.pitch = pitch
    · rw [List.find?_cons]
      simp only [ha, decide_true, Option.map_some]
      refine ⟨_, rfl, ?_⟩
      rcases List.mem_cons.mp hk with rfl | hk
      · exact Rat.le_refl
      · exact hs.1 (keyOf k) (List.mem_map.mpr ⟨k, hk, rfl⟩)
    · rcases List.mem_cons.mp hk with rfl | hk
      · exact absurd hp ha
      · rw [List.find?_cons]
        simp only [ha, decide_false]
        exact ih hs.2 hk

/-- The cut, key by key. -/
theorem cut_spec (pedal : List TimeRange) (keys : List (Note × Int))
    (hs : (keys.map keyOf).Pairwise (fun a b => a.2 ≤ b.2))
    (hnodup : (keys.map keyOf).Pairwise (· ≠ ·)) :
    (cut pedal keys).Pairwise (fun a b => a.pitch = b.pitch → a.end_ ≤ b.onset ∧ a.damp ≤ b.onset) ∧
      (∀ p ∈ cut pedal keys, p.end_ ≤ p.damp) ∧
      (∀ p ∈ cut pedal keys, ∃ k ∈ keys, p.id = k.1.id ∧ p.pitch = k.1.pitch ∧ p.onset = k.1.onset ∧
        p.velocity = k.2 ∧ p.end_ ≤ k.1.onset + k.1.duration ∧
        (0 ≤ k.1.duration → p.onset ≤ p.end_) ∧ (0 < k.1.duration → p.onset < p.end_)) := by
  induction keys with
  | nil => simp [cut]
  | cons k rest ih =>
    obtain ⟨n, v⟩ := k
    simp only [List.map_cons, List.pairwise_cons] at hs hnodup
    obtain ⟨ih1, ih2, ih3⟩ := ih hs.2 hnodup.2
    simp only [cut]
    -- the next strike of this key, if there is one, is strictly later
    have hnext : ∀ x, nextOnsetOf rest n.pitch = some x → n.onset < x := by
      intro x hx
      unfold nextOnsetOf at hx
      cases hf : rest.find? (fun k => decide (k.1.pitch = n.pitch)) with
      | none => simp [hf] at hx
      | some k0 =>
        simp only [hf, Option.map_some, Option.some.injEq] at hx
        subst hx
        have hmem := List.mem_of_find?_eq_some hf
        have hp : k0.1.pitch = n.pitch := by simpa using List.find?_some hf
        have h1 := hs.1 (keyOf k0) (List.mem_map.mpr ⟨k0, hmem, rfl⟩)
        have h2 := hnodup.1 (keyOf k0) (List.mem_map.mpr ⟨k0, hmem, rfl⟩)
        simp only [keyOf] at h1 h2
        apply Rat.not_le.mp; intro hle
        apply h2
        have : n.onset = k0.1.onset := Rat.le_antisymm h1 hle
        rw [hp, this]
    refine ⟨?_, ?_, ?_⟩
    · rw [List.pairwise_cons]
      refine ⟨?_, ih1⟩
      intro b hb hpitch
      obtain ⟨k', hk', _, hbp, hbo, _⟩ := ih3 b hb
      simp only at hpitch
      obtain ⟨x, hx, hle⟩ := nextOnsetOf_le rest n.pitch hs.2 k' hk' (by rw [← hbp, ← hpitch])
      simp only [hx, minNext]
      rw [hbo]; constructor <;> grind
    · intro p hp
      rcases List.mem_cons.mp hp with rfl | hp
      · simp only
        have := heldTo_ge pedal (minNext (n.onset + n.duration) (nextOnsetOf rest n.pitch))
        cases hn : nextOnsetOf rest n.pitch with
        | none => simp only [hn, minNext] at this ⊢; exact this
        | some x => simp only [hn, minNext] at this ⊢; grind
      · exact ih2 p hp
    · intro p hp
      rcases List.mem_cons.mp hp with rfl | hp
      · refine ⟨(n, v), by simp, rfl, rfl, rfl, rfl, minNext_le _ _, ?_, ?_⟩
        · intro hd
          cases hn : nextOnsetOf rest n.pitch with
          | none => simp only [minNext]; grind
          | some x => have := hnext x hn; simp only [minNext]; grind
        · intro hd
          cases hn : nextOnsetOf rest n.pitch with
          | none => simp only [minNext]; grind
          | some x => have := hnext x hn; simp only [minNext]; grind
      · obtain ⟨k, hk, h⟩ := ih3 p hp
        exact ⟨k, by simp [hk], h⟩

/-! ## perform, gathered -/

theorem shapeGo_length (bars : List Bar) (flat : Option Int) (b : Nat) (notes : List Note) :
    (shapeGo bars flat b notes).length = notes.length := by
  induction notes generalizing b with
  | nil => rfl
  | cons n rest ih => simp [shapeGo, ih]

/-- Every note is given a velocity: none is dropped by the pairing of notes
    with velocities (perform.ts:126). -/
theorem velocities_length (score : Score) (shape : Bool) :
    (velocities score shape).length = score.notes.length := by
  unfold velocities
  split
  · simp
  · split
    · simp
    · exact shapeGo_length _ _ _ _

/-- **Holds.** A performance's notes are "sorted by onset, like the score's"
    (perform.ts:61). -/
theorem perform_sorted (score : Score) (shape : Bool)
    (hs : score.notes.Pairwise (fun a b => a.onset ≤ b.onset)) :
    (perform score shape).notes.Pairwise (fun a b => a.onset ≤ b.onset) := by
  have hk := (keysOf_keys score.notes (velocities score shape) hs).1
  have := cut_keys score.pedal (keysOf score.notes (velocities score shape))
  have h2 : ((perform score shape).notes.map (fun p => (p.pitch, p.onset))).Pairwise (fun a b => a.2 ≤ b.2) := by
    simp only [perform]; rw [this]; exact hk
  exact (List.pairwise_map (f := fun (p : PerfNote) => (p.pitch, p.onset)) (R := fun a b => a.2 ≤ b.2)).mp h2

/-- **Holds.** "A key cannot sound twice at once" (perform.ts:19): of two
    performed notes on one pitch, the earlier has been let go — key up and
    dampers down — by the time the later is struck. -/
theorem perform_no_overlap (score : Score) (shape : Bool)
    (hs : score.notes.Pairwise (fun a b => a.onset ≤ b.onset)) :
    (perform score shape).notes.Pairwise
      (fun a b => a.pitch = b.pitch → a.end_ ≤ b.onset ∧ a.damp ≤ b.onset) := by
  obtain ⟨h1, h2⟩ := keysOf_keys score.notes (velocities score shape) hs
  exact (cut_spec score.pedal _ h1 h2).1

/-- **Holds.** Every performed note is struck, then released, then damped, in
    that order — and is struck for a time, not an instant — when the score's
    notes have positive length. -/
theorem perform_order (score : Score) (shape : Bool)
    (hs : score.notes.Pairwise (fun a b => a.onset ≤ b.onset))
    (hdur : ∀ n ∈ score.notes, 0 < n.duration) :
    ∀ p ∈ (perform score shape).notes, p.onset < p.end_ ∧ p.end_ ≤ p.damp := by
  obtain ⟨h1, h2⟩ := keysOf_keys score.notes (velocities score shape) hs
  obtain ⟨_, c2, c3⟩ := cut_spec score.pedal _ h1 h2
  intro p hp
  obtain ⟨k, hk, _, _, _, _, _, _, hpos⟩ := c3 p hp
  have hmem := keysOf_mem score.notes (velocities score shape) k hk
  exact ⟨hpos (hdur k.1 hmem), c2 p hp⟩

/-- `metricLift` is 0, 4 or 8 — perform.ts:105-107. -/
theorem metricLift_range (bar : Bar) (t : Rat) : 0 ≤ metricLift bar t ∧ metricLift bar t ≤ 8 := by
  unfold metricLift
  simp only
  split
  · decide
  · split <;> decide

theorem shapeGo_range (bars : List Bar) (flat : Option Int) (b : Nat) (notes : List Note)
    (hv : ∀ n ∈ notes, ∀ v, n.velocity = some v → 1 ≤ v ∧ v ≤ 127) :
    ∀ v ∈ shapeGo bars flat b notes, 1 ≤ v ∧ v ≤ 127 := by
  induction notes generalizing b with
  | nil => intro v hv'; cases hv'
  | cons n rest ih =>
    intro v hmem
    simp only [shapeGo] at hmem
    rcases List.mem_cons.mp hmem with rfl | hmem
    · split
      · cases hvel : n.velocity with
        | none => simp [DEFAULT_VELOCITY]
        | some w => simpa using hv n (by simp) w hvel
      · have := metricLift_range (bars.getD (advanceBar bars n.onset b) default) n.onset
        simp only [SHAPE_BASE, SHAPE_LOWER_HAND]
        split <;> omega
    · exact ih _ (fun m hm => hv m (by simp [hm])) v hmem

/-- **Holds.** A `Strike`'s velocity is "1–127, MIDI's unit" (types.ts:174)
    whenever every velocity a parser stated is: shaping stays within 66–80. -/
theorem perform_velocity (score : Score) (shape : Bool)
    (hv : ∀ n ∈ score.notes, ∀ v, n.velocity = some v → 1 ≤ v ∧ v ≤ 127) :
    ∀ p ∈ (perform score shape).notes, 1 ≤ p.velocity ∧ p.velocity ≤ 127 := by
  have hvels : ∀ v ∈ velocities score shape, 1 ≤ v ∧ v ≤ 127 := by
    have plain : ∀ v ∈ score.notes.map (fun n => n.velocity.getD DEFAULT_VELOCITY), 1 ≤ v ∧ v ≤ 127 := by
      intro v hmem
      obtain ⟨n, hn, rfl⟩ := List.mem_map.mp hmem
      cases hvel : n.velocity with
      | none => simp [DEFAULT_VELOCITY]
      | some w => simpa using hv n hn w hvel
    unfold velocities
    split
    · exact plain
    · split
      · exact plain
      · exact shapeGo_range _ _ _ _ hv
  intro p hp
  -- a performed note carries its key's velocity; `cut_spec` needs no ordering for that
  have key : ∀ keys : List (Note × Int), ∀ p ∈ cut score.pedal keys, ∃ k ∈ keys, p.velocity = k.2 := by
    intro keys
    induction keys with
    | nil => intro p hp; cases hp
    | cons k rest ih =>
      obtain ⟨n, v⟩ := k
      intro p hp
      simp only [cut] at hp
      rcases List.mem_cons.mp hp with rfl | hp
      · exact ⟨(n, v), by simp, rfl⟩
      · obtain ⟨k, hk, e⟩ := ih p hp; exact ⟨k, by simp [hk], e⟩
  obtain ⟨k, hk, e⟩ := key _ p hp
  rw [e]
  exact keysOf_bounds score.notes (velocities score shape) 1 127 hvels k hk

end Harmonicland
