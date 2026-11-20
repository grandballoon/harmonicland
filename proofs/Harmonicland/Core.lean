/-!
# Core — `src/types.ts` and `src/core.ts`

The one immutable value everything hangs off: a `Score` of notes, bars and
pedal ranges, all in seconds; and the conversions between bars, beats and time.

## What the model is

A line-by-line translation of `core.ts`. JavaScript numbers that are seconds or
beats are `Rat` — exact rationals — so every theorem here is about the
arithmetic the code *means*, not about IEEE doubles. Indices and pitches are
`Nat`/`Int`.

## What the model leaves out

* Floating-point rounding, `NaN`, and `Infinity`. The one `Infinity` the code
  itself produces — a pedal never lifted (`inputs/pedal.ts`) — is modelled as
  an explicit open end, `RawPedal.end_ = none`.
* `Note.spelling` and `Note.stream`: carried through `makeScore` untouched and
  read by nothing in this file.
* Names Lean reserves: `end` is `end_`, `from` is `from_`, `at` is `time`.
-/

namespace Harmonicland

/-! ## Small tools -/

/-- `Math.abs`. -/
def absR (x : Rat) : Rat := if x < 0 then -x else x

theorem absR_lt {x e : Rat} : absR x < e ↔ -e < x ∧ x < e := by
  unfold absR; split <;> grind

theorem absR_nonneg (x : Rat) : 0 ≤ absR x := by
  unfold absR; split <;> grind

/-- `1e-6`: `BEAT_EPS` in core.ts:143, and the literal in `onAttack`
    (core.ts:194), `loop.ts`'s and `backchain.ts`'s `EPS`. -/
def EPS : Rat := 1 / 1000000

theorem EPS_pos : 0 < EPS := by unfold EPS; grind

/-! ## The types — src/types.ts -/

/-- src/types.ts:25 -/
inductive Hand where
  | upper | lower
  deriving DecidableEq, Repr

/-- src/types.ts:159 — what a parser produces. -/
structure RawNote where
  pitch : Int
  onset : Rat
  duration : Rat
  hand : Option Hand := none
  velocity : Option Int := none
  deriving Repr

/-- src/types.ts:48 -/
structure Note where
  id : Nat
  pitch : Int
  onset : Rat
  duration : Rat
  hand : Option Hand := none
  velocity : Option Int := none
  deriving Repr, DecidableEq

/-- src/types.ts:135 — `start` inclusive, `end` exclusive. -/
structure TimeRange where
  start : Rat
  end_ : Rat
  deriving Repr, DecidableEq

/-- A pedal range as a parser hands it over: `end_ = none` is the `Infinity`
    that `pedalRanges` writes for a pedal never lifted (inputs/pedal.ts:32). -/
structure RawPedal where
  start : Rat
  end_ : Option Rat
  deriving Repr

/-- src/types.ts:81 -/
structure Bar where
  index : Nat
  start : Rat
  end_ : Rat
  beats : Rat
  unit : Int
  fifths : Int
  deriving Repr, DecidableEq

instance : Inhabited Bar := ⟨⟨0, 0, 0, 4, 4, 0⟩⟩

/-- src/types.ts:106 — a bare number is a `Barline` with nothing overridden. -/
structure Barline where
  time : Rat
  beats : Option Rat := none
  unit : Option Int := none
  fifths : Option Int := none
  deriving Repr

/-- src/types.ts:125 -/
structure BarRange where
  from_ : Int
  to : Int
  fromBeat : Option Rat := none
  toBeat : Option Rat := none
  deriving Repr, DecidableEq

/-- src/types.ts:141 -/
structure Score where
  notes : List Note
  duration : Rat
  bars : List Bar
  pedal : List TimeRange
  deriving Repr

/-! ## makeScore: the notes — src/core.ts:34-45 -/

/-- core.ts:44 — `.sort((a, b) => a.onset - b.onset)`: a stable ascending
    sort, which is what `List.mergeSort` is. -/
def sortByOnset (raw : List RawNote) : List RawNote :=
  raw.mergeSort (fun a b => decide (a.onset ≤ b.onset))

/-- core.ts:45 — `.map((n, i) => ({ id: i, ...n }))`. -/
def number (sorted : List RawNote) : List Note :=
  sorted.zipIdx.map fun (n, i) =>
    { id := i, pitch := n.pitch, onset := n.onset, duration := n.duration,
      hand := n.hand, velocity := n.velocity }

/-- core.ts:34-45 -/
def makeNotes (raw : List RawNote) : List Note := number (sortByOnset raw)

/-- core.ts:46 -/
def lastKeyUp (notes : List Note) : Rat :=
  notes.foldl (fun m n => max m (n.onset + n.duration)) 0

/-- core.ts:49-52 -/
def scoreDuration (pedal : List RawPedal) (keyUp : Rat) : Rat :=
  pedal.foldl
    (fun m r =>
      match r.end_ with
      | some e => if r.start < keyUp then max m e else m
      | none => m)
    keyUp

/-! ## pedalWithin — src/core.ts:58-70 -/

/-- core.ts:61 — clamp one range to the piece. -/
def clampPedal (duration : Rat) (r : RawPedal) : TimeRange :=
  { start := max 0 r.start,
    end_ := match r.end_ with
      | some e => min duration e
      | none => duration }

/-- core.ts:64-68, one turn of the loop. `out` is held newest-first, so its
    head is the code's `out[out.length - 1]`. -/
def mergeStep (out : List TimeRange) (r : TimeRange) : List TimeRange :=
  match out with
  | last :: rest =>
    if r.start < last.end_ then { start := last.start, end_ := max last.end_ r.end_ } :: rest
    else r :: out
  | [] => [r]

/-- core.ts:58-70 -/
def pedalWithin (pedal : List RawPedal) (duration : Rat) : List TimeRange :=
  let sorted :=
    ((pedal.map (clampPedal duration)).filter (fun r => decide (r.end_ > r.start))).mergeSort
      (fun a b => decide (a.start ≤ b.start))
  (sorted.foldl mergeStep []).reverse

/-! ## makeBars — src/core.ts:84-111 -/

/-- core.ts:88 -/
structure Post where
  time : Rat
  beats : Rat
  unit : Int
  fifths : Int
  deriving Repr

/-- core.ts:91, the running `sig`. -/
structure Sig where
  beats : Rat
  unit : Int
  fifths : Int

/-- core.ts:93-97. `b.beats && b.beats > 0 ? b.beats : sig.beats`: an absent,
    zero or negative value inherits. -/
def nextSig (sig : Sig) (b : Barline) : Sig :=
  { beats := match b.beats with
      | some x => if x > 0 then x else sig.beats
      | none => sig.beats,
    unit := match b.unit with
      | some x => if x > 0 then x else sig.unit
      | none => sig.unit,
    fifths := b.fifths.getD sig.fifths }

/-- core.ts:98 — `b.at >= 0 && (posts.length === 0 || b.at > posts[posts.length - 1].at)`.
    `posts` is held newest-first, so its head is the code's last post. -/
def keeps (posts : List Post) (b : Barline) : Bool :=
  decide (b.time ≥ 0) &&
    (match posts with
     | [] => true
     | last :: _ => decide (b.time > last.time))

/-- core.ts:92-100, the loop over `given`. `posts` is held newest-first. -/
def collect : Sig → List Post → List Barline → List Post
  | _, posts, [] => posts
  | sig, posts, b :: rest =>
    let sig' := nextSig sig b
    collect sig'
      (if keeps posts b then
        { time := b.time, beats := sig'.beats, unit := sig'.unit, fifths := sig'.fifths } :: posts
       else posts)
      rest

/-- core.ts:101 — `if (posts.length > 0 && posts[0].at > 0) posts.unshift(...)`. -/
def unshift : List Post → List Post
  | [] => []
  | p :: rest => if p.time > 0 then { p with time := 0 } :: p :: rest else p :: rest

/-- core.ts:105-106 — `while (posts[posts.length - 1].at < duration) posts.push(...)`.
    Returns the posts pushed, given the time `cur` of the last one so far.

    The guard `0 < step` is not in the source: there `step` (the code's `last`)
    is always positive, which `extend_step_pos` below proves, and without the
    guard the Lean function would not be total. -/
def extend (tail : Post) (step duration cur : Rat) : List Post :=
  if _h : cur < duration ∧ 0 < step then
    { tail with time := cur + step } :: extend tail step duration (cur + step)
  else []
termination_by ((duration - cur) / step).ceil.toNat
decreasing_by
  obtain ⟨hlt, hstep⟩ := _h
  have hne : step ≠ 0 := by grind
  have e : (duration - (cur + step)) / step = (duration - cur) / step - 1 := by
    have : (duration - (cur + step)) = (duration - cur) - 1 * step := by grind
    rw [this, Rat.sub_eq_add_neg, Rat.sub_eq_add_neg, Rat.div_def, Rat.add_mul, ← Rat.div_def]
    have : -(1 * step) * step⁻¹ = -1 := by
      rw [Rat.one_mul, Rat.neg_mul, Rat.mul_inv_cancel _ hne]
    rw [this]; grind
  rw [e, Rat.ceil_sub_one]
  have hpos : 0 < (duration - cur) / step := by
    rw [Rat.div_def]; exact Rat.mul_pos (by grind) (Rat.inv_pos.mpr hstep)
  have : 0 < ((duration - cur) / step).ceil := by
    have := @Rat.le_ceil ((duration - cur) / step)
    have h0 : (0 : Rat) < (((duration - cur) / step).ceil : Rat) := by grind
    exact Rat.intCast_pos.mp h0
  omega

/-- core.ts:107-110 — `posts.slice(1).map((end, i) => ({ index: i, start:
    posts[i].at, end: end.at, ... posts[i] ... }))`, written as the walk over
    adjacent posts that it is. -/
def barsFrom (i : Nat) : List Post → List Bar
  | p :: q :: rest =>
    { index := i, start := p.time, end_ := q.time, beats := p.beats, unit := p.unit, fifths := p.fifths }
      :: barsFrom (i + 1) (q :: rest)
  | _ => []

/-- core.ts:90 — `barlines.map(...).sort((a, b) => a.at - b.at)`. -/
def sortBarlines (barlines : List Barline) : List Barline :=
  barlines.mergeSort (fun a b => decide (a.time ≤ b.time))

/-- The posts after collection and the pickup repair — core.ts:89-101. -/
def basePosts (barlines : List Barline) : List Post :=
  unshift (collect ⟨4, 4, 0⟩ [] (sortBarlines barlines)).reverse

/-- core.ts:103-106: the posts with the continuation to `duration` pushed on. -/
def allPosts (posts : List Post) (duration : Rat) : List Post :=
  match posts.reverse with
  | tail :: prev :: _ => posts ++ extend tail (tail.time - prev.time) duration tail.time
  | _ => posts

/-- core.ts:84-111 -/
def makeBars (barlines : List Barline) (duration : Rat) : List Bar :=
  let posts := basePosts barlines
  if posts.length < 2 then [{ index := 0, start := 0, end_ := duration, beats := 4, unit := 4, fifths := 0 }]
  else barsFrom 0 (allPosts posts duration)

/-- core.ts:26-54 -/
def makeScore (raw : List RawNote) (barlines : List Barline := []) (pedal : List RawPedal := []) : Score :=
  let notes := makeNotes raw
  let duration := scoreDuration pedal (lastKeyUp notes)
  { notes, duration, bars := makeBars barlines duration, pedal := pedalWithin pedal duration }

/-! # Theorems

## The notes

> "a `score` is just: { notes: note[] (sorted by onset) … }" — core.ts:20
> "the id IS the post-sort index, so it is stable, unique, and dense" — core.ts:31
-/

theorem number_map_onset (l : List RawNote) : (number l).map (·.onset) = l.map (·.onset) := by
  unfold number
  rw [List.map_map]
  have : ((fun (x : Note) => x.onset) ∘ fun (x : RawNote × Nat) =>
      ({ id := x.2, pitch := x.1.pitch, onset := x.1.onset, duration := x.1.duration,
         hand := x.1.hand, velocity := x.1.velocity } : Note)) = (fun n => n.onset) ∘ Prod.fst := rfl
  rw [this, ← List.map_map, List.zipIdx_map_fst]

/-- **Holds.** `Score.notes` is "sorted by onset" (types.ts:140, core.ts:20). -/
theorem makeNotes_sorted (raw : List RawNote) :
    (makeNotes raw).Pairwise (fun a b => a.onset ≤ b.onset) := by
  have h := List.pairwise_mergeSort (le := fun (a b : RawNote) => decide (a.onset ≤ b.onset))
    (by intro a b c; simp; exact Rat.le_trans)
    (by intro a b; simp; exact Rat.le_total) raw
  have h1 : (sortByOnset raw).Pairwise (fun a b => a.onset ≤ b.onset) := by
    unfold sortByOnset; exact h.imp (by simp)
  have h2 : ((sortByOnset raw).map (·.onset)).Pairwise (· ≤ ·) := List.pairwise_map.mpr h1
  have h3 : ((makeNotes raw).map (·.onset)).Pairwise (· ≤ ·) := by
    unfold makeNotes; rw [number_map_onset]; exact h2
  exact List.pairwise_map.mp h3

theorem makeNotes_length (raw : List RawNote) : (makeNotes raw).length = raw.length := by
  simp [makeNotes, number, sortByOnset, List.length_mergeSort]

/-- **Holds.** "the id IS the post-sort index" (core.ts:31): note `i` has id `i`. -/
theorem makeNotes_id (raw : List RawNote) (i : Nat) (h : i < (makeNotes raw).length) :
    (makeNotes raw)[i].id = i := by
  simp [makeNotes, number]

/-- **Holds.** Ids are "unique" (core.ts:32, types.ts:34): two positions with
    one id are one position. -/
theorem makeNotes_id_unique (raw : List RawNote) (i j : Nat)
    (hi : i < (makeNotes raw).length) (hj : j < (makeNotes raw).length)
    (h : (makeNotes raw)[i].id = (makeNotes raw)[j].id) : i = j := by
  rw [makeNotes_id, makeNotes_id] at h; exact h

/-- A `Note` with its id forgotten. -/
def Note.raw (n : Note) : RawNote :=
  { pitch := n.pitch, onset := n.onset, duration := n.duration, hand := n.hand, velocity := n.velocity }

/-- **Holds.** `makeScore` neither loses nor invents a note: the score's notes
    are the parser's, reordered. -/
theorem makeNotes_perm (raw : List RawNote) : ((makeNotes raw).map Note.raw).Perm raw := by
  have : (makeNotes raw).map Note.raw = sortByOnset raw := by
    unfold makeNotes number
    rw [List.map_map]
    have : (Note.raw ∘ fun (x : RawNote × Nat) =>
        ({ id := x.2, pitch := x.1.pitch, onset := x.1.onset, duration := x.1.duration,
           hand := x.1.hand, velocity := x.1.velocity } : Note)) = Prod.fst := rfl
    rw [this, List.zipIdx_map_fst]
  rw [this]; exact List.mergeSort_perm _ _

/-! ## The duration

> "a piece lasts until its sound is let go of" — core.ts:47
-/

theorem foldl_max_ge_init {α} (f : α → Rat) (l : List α) (m : Rat) :
    m ≤ l.foldl (fun m n => max m (f n)) m := by
  induction l generalizing m with
  | nil => exact Rat.le_refl
  | cons a l ih => exact Rat.le_trans (by grind) (ih (max m (f a)))

theorem foldl_max_ge_mem {α} (f : α → Rat) (l : List α) (m : Rat) (a : α) (h : a ∈ l) :
    f a ≤ l.foldl (fun m n => max m (f n)) m := by
  induction l generalizing m with
  | nil => cases h
  | cons b l ih =>
    rcases List.mem_cons.mp h with rfl | h
    · exact Rat.le_trans (by grind) (foldl_max_ge_init f l (max m (f a)))
    · exact ih _ h

theorem lastKeyUp_nonneg (notes : List Note) : 0 ≤ lastKeyUp notes := by
  have := foldl_max_ge_init (fun (n : Note) => n.onset + n.duration) notes 0
  unfold lastKeyUp; exact this

theorem lastKeyUp_ge (notes : List Note) (n : Note) (h : n ∈ notes) :
    n.onset + n.duration ≤ lastKeyUp notes := by
  have := foldl_max_ge_mem (fun (n : Note) => n.onset + n.duration) notes 0 n h
  unfold lastKeyUp; exact this

theorem scoreDuration_ge (pedal : List RawPedal) (keyUp : Rat) : keyUp ≤ scoreDuration pedal keyUp := by
  unfold scoreDuration
  suffices ∀ m, keyUp ≤ m → keyUp ≤ pedal.foldl
      (fun m r => match r.end_ with
        | some e => if r.start < keyUp then max m e else m
        | none => m) m from this keyUp Rat.le_refl
  induction pedal with
  | nil => intro m h; exact h
  | cons r l ih =>
    intro m h
    apply ih
    cases hr : r.end_ <;> simp <;> grind

/-- **Holds.** `Score.duration` is never negative. -/
theorem makeScore_duration_nonneg (raw : List RawNote) (barlines : List Barline) (pedal : List RawPedal) :
    0 ≤ (makeScore raw barlines pedal).duration :=
  Rat.le_trans (lastKeyUp_nonneg _) (scoreDuration_ge _ _)

/-- **Holds.** Every note has ended by `Score.duration`. -/
theorem makeScore_duration_covers (raw : List RawNote) (barlines : List Barline) (pedal : List RawPedal)
    (n : Note) (h : n ∈ (makeScore raw barlines pedal).notes) :
    n.onset + n.duration ≤ (makeScore raw barlines pedal).duration :=
  Rat.le_trans (lastKeyUp_ge _ n h) (scoreDuration_ge _ _)

/-! ## The pedal

> "Where the sustain pedal is down: sorted, never overlapping, within the
> piece — and never merged where they touch" — types.ts:148
-/

/-- One pedal range as the Score documents it. -/
def PedalOk (duration : Rat) (r : TimeRange) : Prop :=
  0 ≤ r.start ∧ r.start < r.end_ ∧ r.end_ ≤ duration

theorem mergeStep_inv (duration : Rat) (acc : List TimeRange) (r : TimeRange)
    (hP : ∀ x ∈ acc, PedalOk duration x) (hr : PedalOk duration r)
    (hS : acc.Pairwise (fun a b => b.end_ ≤ a.start)) :
    (∀ x ∈ mergeStep acc r, PedalOk duration x) ∧
      (mergeStep acc r).Pairwise (fun a b => b.end_ ≤ a.start) := by
  unfold mergeStep
  cases acc with
  | nil => simp; exact hr
  | cons last rest =>
    have hl := hP last (by simp)
    rw [List.pairwise_cons] at hS
    unfold PedalOk at *
    by_cases hlt : r.start < last.end_
    · simp only [hlt, ite_true]
      refine ⟨?_, ?_⟩
      · intro x hx
        rcases List.mem_cons.mp hx with rfl | hx
        · simp; grind
        · exact hP x (by simp [hx])
      · rw [List.pairwise_cons]; exact ⟨fun b hb => hS.1 b hb, hS.2⟩
    · simp only [hlt, ite_false]
      refine ⟨?_, ?_⟩
      · intro x hx
        rcases List.mem_cons.mp hx with rfl | hx
        · exact hr
        · exact hP x hx
      · rw [List.pairwise_cons]
        refine ⟨?_, List.pairwise_cons.mpr hS⟩
        intro b hb
        rcases List.mem_cons.mp hb with rfl | hb
        · grind
        · have := hS.1 b hb; grind

theorem foldl_mergeStep_inv (duration : Rat) (l acc : List TimeRange)
    (hl : ∀ x ∈ l, PedalOk duration x)
    (hP : ∀ x ∈ acc, PedalOk duration x)
    (hS : acc.Pairwise (fun a b => b.end_ ≤ a.start)) :
    (∀ x ∈ l.foldl mergeStep acc, PedalOk duration x) ∧
      (l.foldl mergeStep acc).Pairwise (fun a b => b.end_ ≤ a.start) := by
  induction l generalizing acc with
  | nil => exact ⟨hP, hS⟩
  | cons r l ih =>
    have := mergeStep_inv duration acc r hP (hl r (by simp)) hS
    exact ih _ (fun x hx => hl x (by simp [hx])) this.1 this.2

/-- **Holds.** `Score.pedal` is "sorted, never overlapping, within the piece"
    (types.ts:148): every range is non-empty and inside `[0, duration]`, and
    each ends no later than every later one begins. -/
theorem pedalWithin_ok (pedal : List RawPedal) (duration : Rat) :
    (∀ r ∈ pedalWithin pedal duration, PedalOk duration r) ∧
      (pedalWithin pedal duration).Pairwise (fun a b => a.end_ ≤ b.start) := by
  unfold pedalWithin
  have hin : ∀ x ∈ ((pedal.map (clampPedal duration)).filter (fun r => decide (r.end_ > r.start))).mergeSort
      (fun a b => decide (a.start ≤ b.start)), PedalOk duration x := by
    intro x hx
    rw [List.mem_mergeSort, List.mem_filter, List.mem_map] at hx
    obtain ⟨⟨r, _, rfl⟩, hpos⟩ := hx
    simp at hpos
    unfold PedalOk
    refine ⟨?_, hpos, ?_⟩
    · simp [clampPedal]; grind
    · simp only [clampPedal]; cases r.end_ <;> simp <;> grind
  have := foldl_mergeStep_inv duration _ [] hin (by simp) List.Pairwise.nil
  refine ⟨fun r hr => this.1 r (List.mem_reverse.mp hr), ?_⟩
  rw [List.pairwise_reverse]; exact this.2

/-- The pedal is down at `t` in one of these ranges. -/
def PedalDown (l : List TimeRange) (t : Rat) : Prop := ∃ r ∈ l, r.start ≤ t ∧ t < r.end_

theorem foldl_mergeStep_down (l acc : List TimeRange) (t : Rat)
    (hs : l.Pairwise (fun a b => a.start ≤ b.start))
    (hacc : ∀ last rest, acc = last :: rest → ∀ x ∈ l, last.start ≤ x.start) :
    PedalDown (l.foldl mergeStep acc) t ↔ PedalDown acc t ∨ PedalDown l t := by
  induction l generalizing acc with
  | nil => simp [PedalDown]
  | cons r l ih =>
    rw [List.pairwise_cons] at hs
    simp only [List.foldl_cons]
    have step : PedalDown (mergeStep acc r) t ↔ PedalDown acc t ∨ (r.start ≤ t ∧ t < r.end_) := by
      unfold mergeStep
      cases acc with
      | nil => simp [PedalDown]
      | cons last rest =>
        have hle := hacc last rest rfl r (by simp)
        by_cases hlt : r.start < last.end_
        · simp only [hlt, ite_true, PedalDown, List.mem_cons, exists_eq_or_imp]
          constructor
          · rintro (⟨h1, h2⟩ | h)
            · by_cases ht : t < last.end_
              · left; left; exact ⟨h1, ht⟩
              · right; grind
            · left; right; exact h
          · rintro ((⟨h1, h2⟩ | h) | ⟨h1, h2⟩)
            · left; exact ⟨h1, by grind⟩
            · right; exact h
            · left; exact ⟨by grind, by grind⟩
        · simp only [hlt, ite_false, PedalDown, List.mem_cons, exists_eq_or_imp]
          constructor
          · rintro (h | h)
            · right; exact h
            · left; exact h
          · rintro (h | h)
            · right; exact h
            · left; exact h
    have hnext : ∀ last rest, mergeStep acc r = last :: rest → ∀ x ∈ l, last.start ≤ x.start := by
      intro last rest e x hx
      unfold mergeStep at e
      cases acc with
      | nil => simp only [List.cons.injEq] at e; rw [← e.1]; exact hs.1 x hx
      | cons a rest' =>
        simp only at e
        split at e
        · simp only [List.cons.injEq] at e; rw [← e.1]; exact hacc a rest' rfl x (by simp [hx])
        · simp only [List.cons.injEq] at e; rw [← e.1]; exact hs.1 x hx
    rw [ih (mergeStep acc r) hs.2 hnext, step]
    simp only [PedalDown, List.mem_cons, exists_eq_or_imp]
    constructor
    · rintro ((h | h) | h)
      · left; exact h
      · right; left; exact h
      · right; right; exact h
    · rintro (h | h | h)
      · left; left; exact h
      · left; right; exact h
      · right; exact h

/-- **Holds.** "the overlapping joined" (core.ts:56) and nothing else changed:
    the pedal is down at `t` in `Score.pedal` exactly when it is down at `t` in
    one of the parser's ranges, clamped to the piece. -/
theorem pedalWithin_down (pedal : List RawPedal) (duration t : Rat) :
    PedalDown (pedalWithin pedal duration) t ↔ PedalDown (pedal.map (clampPedal duration)) t := by
  unfold pedalWithin
  simp only
  have hsorted := List.pairwise_mergeSort (le := fun (a b : TimeRange) => decide (a.start ≤ b.start))
    (by intro a b c; simp; exact Rat.le_trans) (by intro a b; simp; exact Rat.le_total)
    ((pedal.map (clampPedal duration)).filter (fun r => decide (r.end_ > r.start)))
  have h := foldl_mergeStep_down _ [] t (hsorted.imp (by simp)) (by intro _ _ e; cases e)
  have hrev : ∀ l : List TimeRange, PedalDown l.reverse t ↔ PedalDown l t := by
    intro l; simp [PedalDown]
  rw [hrev, h]
  simp only [PedalDown, List.not_mem_nil, false_and, exists_false, false_or, List.mem_mergeSort,
    List.mem_filter, decide_eq_true_eq]
  constructor
  · rintro ⟨r, ⟨hr, _⟩, h⟩; exact ⟨r, hr, h⟩
  · rintro ⟨r, hr, h⟩; exact ⟨r, ⟨hr, by grind⟩, h⟩

/-! ## The bars

> "Never empty, and together covering the whole piece: a source with no bar
> information yields ONE bar spanning it" — types.ts:144
> "Duplicate and descending posts are dropped rather than trusted; a
> zero-length bar would be a bar nothing can ever be in." — core.ts:82
-/

/-- What every post has. -/
def PostOk (p : Post) : Prop := 0 ≤ p.time ∧ 0 < p.beats ∧ 0 < p.unit

theorem nextSig_pos (sig : Sig) (b : Barline) (h : 0 < sig.beats ∧ 0 < sig.unit) :
    0 < (nextSig sig b).beats ∧ 0 < (nextSig sig b).unit := by
  unfold nextSig
  refine ⟨?_, ?_⟩
  · cases b.beats <;> simp <;> grind
  · cases b.unit <;> simp <;> grind

theorem collect_inv (sig : Sig) (acc : List Post) (bs : List Barline)
    (hsig : 0 < sig.beats ∧ 0 < sig.unit)
    (hok : ∀ p ∈ acc, PostOk p)
    (hdesc : acc.Pairwise (fun a b => b.time < a.time)) :
    (∀ p ∈ collect sig acc bs, PostOk p) ∧
      (collect sig acc bs).Pairwise (fun a b => b.time < a.time) := by
  induction bs generalizing sig acc with
  | nil => exact ⟨hok, hdesc⟩
  | cons b rest ih =>
    unfold collect
    have hs := nextSig_pos sig b hsig
    simp only
    by_cases hkeep : keeps acc b = true
    · simp only [hkeep, ite_true]
      unfold keeps at hkeep
      rw [Bool.and_eq_true, decide_eq_true_eq] at hkeep
      apply ih _ _ hs
      · intro p hp
        rcases List.mem_cons.mp hp with rfl | hp
        · exact ⟨hkeep.1, hs.1, hs.2⟩
        · exact hok p hp
      · rw [List.pairwise_cons]
        refine ⟨?_, hdesc⟩
        intro q hq
        cases acc with
        | nil => cases hq
        | cons last tl =>
          have h2 : b.time > last.time := by simpa using hkeep.2
          rw [List.pairwise_cons] at hdesc
          rcases List.mem_cons.mp hq with rfl | hq
          · exact h2
          · have := hdesc.1 q hq; simp; grind
    · simp only [hkeep]
      exact ih _ _ hs hok hdesc

/-- Posts in the order the code holds them: ascending. -/
def Ascending (l : List Post) : Prop := l.Pairwise (fun a b => a.time < b.time)

theorem unshift_inv (l : List Post) (hok : ∀ p ∈ l, PostOk p) (hasc : Ascending l) :
    (∀ p ∈ unshift l, PostOk p) ∧ Ascending (unshift l) ∧
      (∀ p rest, unshift l = p :: rest → p.time = 0) := by
  cases l with
  | nil => simp [unshift, Ascending]
  | cons p rest =>
    have hp := hok p (by simp)
    unfold unshift
    by_cases h : p.time > 0
    · simp only [h, ite_true]
      refine ⟨?_, ?_, ?_⟩
      · intro q hq
        rcases List.mem_cons.mp hq with rfl | hq
        · exact ⟨Rat.le_refl, hp.2⟩
        · exact hok q hq
      · unfold Ascending at *
        rw [List.pairwise_cons]
        refine ⟨?_, hasc⟩
        intro q hq
        rcases List.mem_cons.mp hq with rfl | hq
        · exact h
        · have := (List.pairwise_cons.mp hasc).1 q hq; simp; grind
      · intro q r e; simp at e; rw [← e.1]
    · simp only [h, ite_false]
      refine ⟨hok, hasc, ?_⟩
      intro q r e; simp at e; rw [← e.1]; unfold PostOk at hp; grind

theorem basePosts_inv (barlines : List Barline) :
    (∀ p ∈ basePosts barlines, PostOk p) ∧ Ascending (basePosts barlines) ∧
      (∀ p rest, basePosts barlines = p :: rest → p.time = 0) := by
  have h := collect_inv ⟨4, 4, 0⟩ [] (sortBarlines barlines) (by decide) (by simp) List.Pairwise.nil
  apply unshift_inv
  · intro p hp; exact h.1 p (List.mem_reverse.mp hp)
  · unfold Ascending; rw [List.pairwise_reverse]; exact h.2

/-- Everything `extend` pushes: later than `cur`, in ascending order, carrying
    the tail's meter. -/
theorem extend_inv (tail : Post) (step duration cur : Rat) :
    (∀ p ∈ extend tail step duration cur,
        cur < p.time ∧ p.beats = tail.beats ∧ p.unit = tail.unit ∧ p.fifths = tail.fifths) ∧
      Ascending (extend tail step duration cur) := by
  induction cur using extend.induct step duration with
  | case1 cur h ih =>
    rw [extend]; simp only [h, and_self, dite_true]
    refine ⟨?_, ?_⟩
    · intro p hp
      rcases List.mem_cons.mp hp with rfl | hp
      · simp; grind
      · have := ih.1 p hp; grind
    · unfold Ascending; rw [List.pairwise_cons]
      refine ⟨?_, ih.2⟩
      intro q hq; have := ih.1 q hq; simp; grind
  | case2 cur h =>
    rw [extend]; simp [h, Ascending]

/-- Where `extend` stops: at or past `duration`. -/
theorem extend_last (tail : Post) (step duration cur : Rat) (hstep : 0 < step) :
    match (extend tail step duration cur).getLast? with
    | some p => duration ≤ p.time
    | none => duration ≤ cur := by
  induction cur using extend.induct step duration with
  | case1 cur h ih =>
    rw [extend]; simp only [h, and_self, dite_true]
    rw [List.getLast?_cons]
    cases hl : (extend tail step duration (cur + step)).getLast? with
    | none => simp [hl] at ih ⊢; exact ih
    | some p => simp [hl] at ih ⊢; exact ih
  | case2 cur h =>
    rw [extend]; simp [h]; grind

/-- core.ts:104 — the code's `last`, the step `extend` is called with, is
    positive, so the guard added to `extend` never fires. -/
theorem extend_step_pos (posts : List Post) (hasc : Ascending posts) (tail prev : Post) (rest : List Post)
    (h : posts.reverse = tail :: prev :: rest) : 0 < tail.time - prev.time := by
  have : (posts.reverse).Pairwise (fun a b => b.time < a.time) := by
    rw [List.pairwise_reverse]; exact hasc
  rw [h, List.pairwise_cons] at this
  have := this.1 prev (by simp); grind

theorem allPosts_inv (posts : List Post) (duration : Rat)
    (hok : ∀ p ∈ posts, PostOk p) (hasc : Ascending posts) :
    (∀ p ∈ allPosts posts duration, PostOk p) ∧ Ascending (allPosts posts duration) := by
  unfold allPosts
  split
  · rename_i tail prev rest hrev
    have hstep := extend_step_pos posts hasc tail prev rest hrev
    have hext := extend_inv tail (tail.time - prev.time) duration tail.time
    have htail_mem : tail ∈ posts := by
      have : tail ∈ posts.reverse := by rw [hrev]; simp
      exact List.mem_reverse.mp this
    have htail := hok tail htail_mem
    have hmax : ∀ p ∈ posts, p.time ≤ tail.time := by
      intro p hp
      have hp' : p ∈ posts.reverse := List.mem_reverse.mpr hp
      have hd : (posts.reverse).Pairwise (fun a b => b.time < a.time) := by
        rw [List.pairwise_reverse]; exact hasc
      rw [hrev] at hp' hd
      rcases List.mem_cons.mp hp' with rfl | hp'
      · exact Rat.le_refl
      · have := (List.pairwise_cons.mp hd).1 p hp'; grind
    refine ⟨?_, ?_⟩
    · intro p hp
      rcases List.mem_append.mp hp with hp | hp
      · exact hok p hp
      · have := hext.1 p hp; unfold PostOk at *; grind
    · unfold Ascending
      rw [List.pairwise_append]
      refine ⟨hasc, hext.2, ?_⟩
      intro a ha b hb
      have := hext.1 b hb; have := hmax a ha; grind
  · exact ⟨hok, hasc⟩

/-- core.ts:105 — after the loop the last post is at or past `duration`. -/
theorem allPosts_last (posts : List Post) (duration : Rat) (hasc : Ascending posts)
    (hlen : 2 ≤ posts.length) :
    ∃ p, (allPosts posts duration).getLast? = some p ∧ duration ≤ p.time := by
  unfold allPosts
  split
  · rename_i tail prev rest hrev
    have hstep := extend_step_pos posts hasc tail prev rest hrev
    have hl := extend_last tail (tail.time - prev.time) duration tail.time hstep
    have htl : posts.getLast? = some tail := by
      rw [List.getLast?_eq_head?_reverse, hrev]; rfl
    cases he : (extend tail (tail.time - prev.time) duration tail.time).getLast? with
    | none =>
      rw [he] at hl
      have : extend tail (tail.time - prev.time) duration tail.time = [] := List.getLast?_eq_none_iff.mp he
      rw [this, List.append_nil]
      exact ⟨tail, htl, hl⟩
    | some p =>
      rw [he] at hl
      refine ⟨p, ?_, hl⟩
      rw [List.getLast?_append, he]; rfl
  · rename_i hne
    exfalso
    have : 2 ≤ posts.reverse.length := by simpa using hlen
    match hr : posts.reverse, this with
    | a :: b :: r, _ => exact hne a b r hr

/-! ### What `barsFrom` makes of a list of posts -/

/-- Each bar ends where the next begins. -/
def Contiguous : List Bar → Prop
  | a :: b :: rest => a.end_ = b.start ∧ Contiguous (b :: rest)
  | _ => True

theorem barsFrom_length (i : Nat) (l : List Post) : (barsFrom i l).length = l.length - 1 := by
  induction l generalizing i with
  | nil => rfl
  | cons p l ih =>
    cases l with
    | nil => rfl
    | cons q r => simp [barsFrom, ih (i + 1)]

theorem barsFrom_head (i : Nat) (p q : Post) (r : List Post) :
    (barsFrom i (p :: q :: r)).head? =
      some { index := i, start := p.time, end_ := q.time, beats := p.beats, unit := p.unit, fifths := p.fifths } := rfl

theorem barsFrom_contiguous (i : Nat) (l : List Post) : Contiguous (barsFrom i l) := by
  induction l generalizing i with
  | nil => trivial
  | cons p l ih =>
    cases l with
    | nil => trivial
    | cons q r =>
      cases r with
      | nil => simp [barsFrom, Contiguous]
      | cons s t =>
        have := ih (i + 1)
        simp only [barsFrom] at this ⊢
        exact ⟨rfl, this⟩

theorem barsFrom_index (i : Nat) (l : List Post) (k : Nat) (h : k < (barsFrom i l).length) :
    (barsFrom i l)[k].index = i + k := by
  induction l generalizing i k with
  | nil => simp [barsFrom] at h
  | cons p l ih =>
    cases l with
    | nil => simp [barsFrom] at h
    | cons q r =>
      cases k with
      | zero => simp [barsFrom]
      | succ k =>
        simp only [barsFrom, List.getElem_cons_succ]
        rw [ih (i + 1) k]; omega

theorem barsFrom_mem (i : Nat) (l : List Post) (hok : ∀ p ∈ l, PostOk p) (hasc : Ascending l) :
    ∀ b ∈ barsFrom i l, 0 ≤ b.start ∧ b.start < b.end_ ∧ 0 < b.beats ∧ 0 < b.unit := by
  induction l generalizing i with
  | nil => intro b hb; simp [barsFrom] at hb
  | cons p l ih =>
    cases l with
    | nil => intro b hb; simp [barsFrom] at hb
    | cons q r =>
      intro b hb
      unfold Ascending at hasc
      rw [List.pairwise_cons] at hasc
      simp only [barsFrom] at hb
      rcases List.mem_cons.mp hb with rfl | hb
      · have hp := hok p (by simp)
        have := hasc.1 q (by simp)
        exact ⟨hp.1, this, hp.2.1, hp.2.2⟩
      · exact ih (i + 1) (fun x hx => hok x (by simp [hx])) hasc.2 b hb

theorem barsFrom_getLast (i : Nat) (l : List Post) (hlen : 2 ≤ l.length) :
    ∃ b p, (barsFrom i l).getLast? = some b ∧ l.getLast? = some p ∧ b.end_ = p.time := by
  induction l generalizing i with
  | nil => simp at hlen
  | cons p l ih =>
    cases l with
    | nil => simp at hlen
    | cons q r =>
      cases r with
      | nil => exact ⟨_, q, rfl, rfl, rfl⟩
      | cons s t =>
        obtain ⟨b, x, hb, hx, e⟩ := ih (i + 1) (by simp)
        refine ⟨b, x, ?_, ?_, e⟩
        · simp only [barsFrom] at hb ⊢
          rw [List.getLast?_cons_cons]; exact hb
        · rw [List.getLast?_cons_cons]; exact hx

/-! ### `makeBars` -/

/-- **Holds.** `Score.bars` is "Never empty" (types.ts:144). -/
theorem makeBars_ne_nil (barlines : List Barline) (duration : Rat) : makeBars barlines duration ≠ [] := by
  unfold makeBars
  simp only
  split
  · simp
  · rename_i h
    have hl := barsFrom_length 0 (allPosts (basePosts barlines) duration)
    have : 2 ≤ (allPosts (basePosts barlines) duration).length := by
      unfold allPosts; split <;> (try simp only [List.length_append]) <;> omega
    intro e; rw [e] at hl; simp at hl; omega

/-- **Holds.** The first bar begins at 0 — "a first post after 0 gets a bar
    prepended from 0" (core.ts:74). -/
theorem makeBars_head (barlines : List Barline) (duration : Rat) :
    ∃ b, (makeBars barlines duration).head? = some b ∧ b.start = 0 := by
  unfold makeBars
  simp only
  split
  · exact ⟨_, rfl, rfl⟩
  · rename_i h
    have hinv := basePosts_inv barlines
    match hb : basePosts barlines with
    | [] => rw [hb] at h; simp at h
    | [_] => rw [hb] at h; simp at h
    | p :: q :: r =>
      have hp0 := hinv.2.2 p (q :: r) hb
      have : ∃ r', allPosts (p :: q :: r) duration = p :: q :: r' := by
        unfold allPosts; split
        · exact ⟨_, rfl⟩
        · exact ⟨_, rfl⟩
      obtain ⟨r', e⟩ := this
      rw [e, barsFrom_head]
      exact ⟨_, rfl, hp0⟩

/-- **Holds.** Bars tile: each ends exactly where the next begins. -/
theorem makeBars_contiguous (barlines : List Barline) (duration : Rat) :
    Contiguous (makeBars barlines duration) := by
  unfold makeBars
  simp only
  split
  · trivial
  · exact barsFrom_contiguous _ _

/-- **Holds.** `Bar.index` is the "Position in `Score.bars`, 0-based" (types.ts:82). -/
theorem makeBars_index (barlines : List Barline) (duration : Rat) (k : Nat)
    (h : k < (makeBars barlines duration).length) : (makeBars barlines duration)[k].index = k := by
  unfold makeBars at h ⊢
  simp only at h ⊢
  split
  · rename_i hlt
    simp [hlt] at h; subst h; simp
  · rename_i hlt
    have := barsFrom_index 0 (allPosts (basePosts barlines) duration) k (by simpa [hlt] using h)
    simpa using this

/-- **Holds.** The bars are "together covering the whole piece" (types.ts:144):
    the last bar ends at or after `duration`. -/
theorem makeBars_covers (barlines : List Barline) (duration : Rat) :
    ∃ b, (makeBars barlines duration).getLast? = some b ∧ duration ≤ b.end_ := by
  unfold makeBars
  simp only
  split
  · exact ⟨_, rfl, Rat.le_refl⟩
  · rename_i h
    have hinv := basePosts_inv barlines
    have hlen : 2 ≤ (basePosts barlines).length := by omega
    obtain ⟨p, hp, hd⟩ := allPosts_last (basePosts barlines) duration hinv.2.1 hlen
    have hlen' : 2 ≤ (allPosts (basePosts barlines) duration).length := by
      unfold allPosts; split <;> (try simp only [List.length_append]) <;> omega
    obtain ⟨b, p', hb, hp', e⟩ := barsFrom_getLast 0 _ hlen'
    rw [hp] at hp'; cases hp'
    exact ⟨b, hb, by rw [e]; exact hd⟩

/-- **Holds.** Every bar has a usable meter: `beats` and `unit` are positive,
    so `timeOfBeat`'s division is never by zero. -/
theorem makeBars_meter (barlines : List Barline) (duration : Rat) :
    ∀ b ∈ makeBars barlines duration, 0 < b.beats ∧ 0 < b.unit := by
  unfold makeBars
  simp only
  split
  · intro b hb; simp at hb; subst hb; exact ⟨by grind, by simp⟩
  · intro b hb
    have hinv := basePosts_inv barlines
    have ha := allPosts_inv (basePosts barlines) duration hinv.1 hinv.2.1
    have := barsFrom_mem 0 _ ha.1 ha.2 b hb
    exact ⟨this.2.2.1, this.2.2.2⟩

/-- **Holds only under a hypothesis the code does not enforce:** `0 < duration`.
    With it, no bar is empty — "a zero-length bar would be a bar nothing can
    ever be in" (core.ts:83). -/
theorem makeBars_positive (barlines : List Barline) (duration : Rat) (hd : 0 < duration) :
    ∀ b ∈ makeBars barlines duration, b.start < b.end_ := by
  unfold makeBars
  simp only
  split
  · intro b hb; simp at hb; subst hb; exact hd
  · intro b hb
    have hinv := basePosts_inv barlines
    have ha := allPosts_inv (basePosts barlines) duration hinv.1 hinv.2.1
    exact (barsFrom_mem 0 _ ha.1 ha.2 b hb).2.1

/-- **Fails** without it: the score of no notes — what `makeScore([])` returns,
    and what a file with no notes parses to — has one bar, `[0, 0)`, which
    nothing can ever be in. Repro: `repro/core_zero_length_bar.ts`. -/
theorem FAILS_makeBars_positive :
    ¬ ∀ (raw : List RawNote) (barlines : List Barline) (pedal : List RawPedal),
        ∀ b ∈ (makeScore raw barlines pedal).bars, b.start < b.end_ := by
  intro h
  have := h [] [] [] ⟨0, 0, 0, 4, 4, 0⟩ (by decide +kernel)
  exact absurd this (by decide +kernel)

/-- **Fails:** "each [post] optionally carrying the meter and key that take
    effect there" (core.ts:23). A source that states its meter on a single
    barline has that meter discarded: the one bar is always 4/4 with no
    sharps or flats (core.ts:102). Repro: `repro/core_single_post_meter.ts`. -/
theorem FAILS_makeBars_single_post_keeps_meter :
    ¬ ∀ (beats : Rat) (unit fifths : Int) (duration : Rat), 0 < beats → 0 < unit →
        ∀ b ∈ makeBars [{ time := 0, beats := some beats, unit := some unit, fifths := some fifths }] duration,
          b.beats = beats ∧ b.unit = unit ∧ b.fifths = fifths := by
  intro h
  have := h 3 4 (-3) 10 (by decide +kernel) (by decide) ⟨0, 0, 10, 4, 4, 0⟩ (by decide +kernel)
  exact absurd this.1 (by decide +kernel)

/-! # Bars, beats and time — src/core.ts:113-217 -/

/-- core.ts:118-119 — `for (let i = 1; i < bars.length && bars[i].start <= t; i++) lo = i`,
    walking the bars after the first; `lo` is always `i - 1`. -/
def barAtGo (t : Rat) : List Bar → Nat → Nat
  | b :: rest, lo => if b.start ≤ t then barAtGo t rest (lo + 1) else lo
  | [], lo => lo

/-- The index core.ts:120 reads: `lo`. -/
def barAtIndex (bars : List Bar) (t : Rat) : Nat := barAtGo t bars.tail 0

/-- core.ts:116-121 -/
def barAt (score : Score) (t : Rat) : Bar :=
  score.bars.getD (barAtIndex score.bars t) default

/-- core.ts:129-139 -/
def clampRange (r : BarRange) (bars : Int) : BarRange :=
  let hi := max 0 (bars - 1)
  let a := max 0 (min r.from_ hi)
  let b := max 0 (min r.to hi)
  if a > b then { from_ := b, to := a }
  else
    { from_ := a, to := b,
      fromBeat := if a = r.from_ then r.fromBeat else none,
      toBeat := if b = r.to then r.toBeat else none }

/-- core.ts:148-149 -/
def timeOfBeat (b : Bar) (beat : Rat) : Rat :=
  b.start + ((b.end_ - b.start) * beat) / b.beats

/-- core.ts:153-154 -/
def beatOfTime (b : Bar) (t : Rat) : Rat :=
  if b.end_ > b.start then ((t - b.start) / (b.end_ - b.start)) * b.beats else 0

/-- core.ts:168 — `score.bars[i].beats`. -/
def beatsOf (score : Score) (i : Int) : Rat := (score.bars.getD i.toNat default).beats

/-- core.ts:165-180 — everything `normalizeRange` does after its first line,
    to the already-clamped `r`. -/
def normalizeClamped (score : Score) (r : BarRange) : BarRange :=
  -- core.ts:169
  let head₁ : Option Rat := r.fromBeat.filter (fun h => decide (h > EPS))
  -- core.ts:170-173
  let over : Bool :=
    match head₁ with
    | some h => decide (h ≥ beatsOf score r.from_ - EPS)
    | none => false
  let head₂ : Option Rat := if over then none else head₁
  let from₁ : Int := if over ∧ r.from_ < r.to then r.from_ + 1 else r.from_
  -- core.ts:174
  let tail₁ : Option Rat := r.toBeat.filter (fun t => decide (t < beatsOf score r.to - EPS))
  -- core.ts:175-178
  let under : Bool :=
    match tail₁ with
    | some t => decide (t ≤ EPS)
    | none => false
  let tail₂ : Option Rat := if under then none else tail₁
  let to₁ : Int := if under ∧ r.to > from₁ then r.to - 1 else r.to
  -- core.ts:179
  let tail₃ : Option Rat :=
    match head₂, tail₂ with
    | some h, some t => if from₁ = to₁ ∧ t ≤ h + EPS then none else some t
    | _, _ => tail₂
  { from_ := from₁, to := to₁, fromBeat := head₂, toBeat := tail₃ }

/-- core.ts:163-181 -/
def normalizeRange (score : Score) (range : BarRange) : BarRange :=
  normalizeClamped score (clampRange range score.bars.length)

/-- core.ts:184-187 -/
def sameRange (a b : Option BarRange) : Bool := a == b

/-- core.ts:193-194 -/
def onAttack (score : Score) (t : Rat) : Rat :=
  match score.notes.find? (fun n => decide (absR (n.onset - t) < EPS)) with
  | some n => n.onset
  | none => t

/-- core.ts:201-210 -/
def barTime (score : Score) (range : Option BarRange) : TimeRange :=
  match range with
  | none => { start := 0, end_ := score.duration }
  | some range =>
    let r := normalizeRange score range
    let a := score.bars.getD r.from_.toNat default
    let b := score.bars.getD r.to.toNat default
    { start := match r.fromBeat with
        | none => a.start
        | some x => onAttack score (timeOfBeat a x),
      end_ := match r.toBeat with
        | none => b.end_
        | some x => onAttack score (timeOfBeat b x) }

/-- core.ts:215-217 -/
def activeAt (score : Score) (t : Rat) : List Note :=
  score.notes.filter (fun n => decide (t ≥ n.onset) && decide (t < n.onset + n.duration))

/-! ## What a well-formed list of bars is

The facts `types.ts` documents about `Score.bars`, gathered so the theorems
below can assume them. `makeBars_wf` shows `makeScore` establishes them — all
but `positive`, which needs a piece of positive length (see
`FAILS_makeBars_positive`). -/

structure BarsWF (bars : List Bar) : Prop where
  ne : bars ≠ []
  head : ∀ b, bars.head? = some b → b.start = 0
  contiguous : Contiguous bars
  positive : ∀ b ∈ bars, b.start < b.end_
  index : ∀ k (h : k < bars.length), bars[k].index = k
  meter : ∀ b ∈ bars, 0 < b.beats

/-- **Holds only under a hypothesis the code does not enforce:** `0 < duration`. -/
theorem makeBars_wf (barlines : List Barline) (duration : Rat) (hd : 0 < duration) :
    BarsWF (makeBars barlines duration) where
  ne := makeBars_ne_nil _ _
  head := by
    intro b hb
    obtain ⟨b', hb', h0⟩ := makeBars_head barlines duration
    rw [hb'] at hb; cases hb; exact h0
  contiguous := makeBars_contiguous _ _
  positive := makeBars_positive _ _ hd
  index := makeBars_index _ _
  meter := fun b hb => (makeBars_meter _ _ b hb).1

theorem contiguous_getElem (bars : List Bar) (hc : Contiguous bars) (k : Nat) (h : k + 1 < bars.length) :
    bars[k].end_ = bars[k + 1].start := by
  induction bars generalizing k with
  | nil => simp at h
  | cons a l ih =>
    cases l with
    | nil => simp at h
    | cons b rest =>
      cases k with
      | zero => exact hc.1
      | succ k => exact ih hc.2 k (by simpa using h)

/-- Bars in order: an earlier bar ends no later than a later one begins. -/
theorem bars_ordered (bars : List Bar) (hw : BarsWF bars) (i j : Nat) (hij : i < j) (hj : j < bars.length) :
    bars[i].end_ ≤ bars[j].start := by
  induction j with
  | zero => omega
  | succ j ih =>
    by_cases e : i = j
    · subst e; rw [contiguous_getElem bars hw.contiguous i hj]; exact Rat.le_refl
    · have h1 := ih (by omega) (by omega)
      have h2 := contiguous_getElem bars hw.contiguous j hj
      have h3 := hw.positive bars[j] (List.getElem_mem _)
      grind

theorem bars_start_mono (bars : List Bar) (hw : BarsWF bars) (i j : Nat) (hij : i ≤ j) (hj : j < bars.length) :
    bars[i].start ≤ bars[j].start := by
  by_cases e : i = j
  · subst e; exact Rat.le_refl
  · have := bars_ordered bars hw i j (by omega) hj
    have := hw.positive bars[i] (List.getElem_mem _)
    grind

/-! ## barAt

> "The bar containing score time `t`. Clamped at both ends, so a time past
> the piece names the last bar and a negative one the first" — core.ts:113
-/

theorem barAtGo_spec (t : Rat) (rest : List Bar) (lo : Nat) :
    lo ≤ barAtGo t rest lo ∧ barAtGo t rest lo ≤ lo + rest.length ∧
      (∀ j (h : j < rest.length), j < barAtGo t rest lo - lo → rest[j].start ≤ t) ∧
      (∀ (h : barAtGo t rest lo - lo < rest.length), t < rest[barAtGo t rest lo - lo].start) := by
  induction rest generalizing lo with
  | nil => simp [barAtGo]
  | cons b rest ih =>
    unfold barAtGo
    by_cases hb : b.start ≤ t
    · simp only [hb, ite_true]
      obtain ⟨h1, h2, h3, h4⟩ := ih (lo + 1)
      refine ⟨by omega, by simp; omega, ?_, ?_⟩
      · intro j hj hlt
        cases j with
        | zero => exact hb
        | succ j => exact h3 j (by simpa using hj) (by omega)
      · intro h
        have e : barAtGo t rest (lo + 1) - lo = (barAtGo t rest (lo + 1) - (lo + 1)) + 1 := by omega
        simp only [e, List.getElem_cons_succ]
        exact h4 (by simp at h; omega)
    · simp only [hb, ite_false]
      refine ⟨Nat.le_refl _, by omega, ?_, ?_⟩
      · intro j hj hlt; omega
      · intro h; simp; grind

theorem barAtIndex_lt (bars : List Bar) (hne : bars ≠ []) (t : Rat) : barAtIndex bars t < bars.length := by
  cases bars with
  | nil => exact absurd rfl hne
  | cons b rest =>
    have := (barAtGo_spec t rest 0).2.1
    simp [barAtIndex]; omega

/-- **Holds.** `barAt` names the bar that contains `t`: for a time inside the
    bars, `start ≤ t < end` (half-open, types.ts:74). -/
theorem barAt_contains (bars : List Bar) (hw : BarsWF bars) (t : Rat) (h0 : 0 ≤ t)
    (hend : ∀ b, bars.getLast? = some b → t < b.end_) :
    ∃ b, bars[barAtIndex bars t]? = some b ∧ b.start ≤ t ∧ t < b.end_ := by
  cases bars with
  | nil => exact absurd rfl hw.ne
  | cons b rest =>
    obtain ⟨_, h2, h3, h4⟩ := barAtGo_spec t rest 0
    simp only [barAtIndex, List.tail_cons]
    simp only [Nat.sub_zero] at h3 h4
    generalize barAtGo t rest 0 = k at *
    have hk : k < (b :: rest).length := by simp; omega
    refine ⟨(b :: rest)[k], by simp, ?_, ?_⟩
    · cases k with
      | zero => simp; rw [hw.head b rfl]; exact h0
      | succ k => simp only [List.getElem_cons_succ]; exact h3 k (by omega) (by omega)
    · by_cases hlast : k < rest.length
      · have hc := contiguous_getElem (b :: rest) hw.contiguous k (by simp; omega)
        rw [hc]; simp only [List.getElem_cons_succ]; exact h4 hlast
      · have hk' : k = rest.length := by omega
        apply hend
        rw [List.getLast?_eq_getElem?]
        simp [hk']

/-- **Holds.** "a negative [time names] the first" bar. -/
theorem barAt_negative (bars : List Bar) (hw : BarsWF bars) (t : Rat) (h : t < 0) : barAtIndex bars t = 0 := by
  cases bars with
  | nil => exact absurd rfl hw.ne
  | cons b rest =>
    simp only [barAtIndex, List.tail_cons]
    cases rest with
    | nil => rfl
    | cons c rest' =>
      have h1 := hw.head b rfl
      have h2 := hw.positive b (by simp)
      have h3 : b.end_ = c.start := hw.contiguous.1
      have : ¬ c.start ≤ t := by grind
      simp [barAtGo, this]

/-- **Holds.** "a time past the piece names the last bar". -/
theorem barAt_past_end (bars : List Bar) (hw : BarsWF bars) (t : Rat)
    (h : ∀ b ∈ bars, b.start ≤ t) : barAtIndex bars t = bars.length - 1 := by
  cases bars with
  | nil => exact absurd rfl hw.ne
  | cons b rest =>
    obtain ⟨_, h2, _, h4⟩ := barAtGo_spec t rest 0
    simp only [barAtIndex, List.tail_cons, List.length_cons, Nat.add_sub_cancel]
    simp only [Nat.sub_zero] at h4
    by_cases hlt : barAtGo t rest 0 < rest.length
    · have := h4 hlt
      have := h rest[barAtGo t rest 0] (by simp)
      grind
    · omega

/-- The bar `barAt` picks never moves backward as time moves forward. -/
theorem barAtIndex_mono (bars : List Bar) (hw : BarsWF bars) (t t' : Rat) (h : t ≤ t') :
    barAtIndex bars t ≤ barAtIndex bars t' := by
  cases bars with
  | nil => exact absurd rfl hw.ne
  | cons b rest =>
    obtain ⟨_, _, h3, _⟩ := barAtGo_spec t rest 0
    obtain ⟨_, _, _, h4'⟩ := barAtGo_spec t' rest 0
    simp only [barAtIndex, List.tail_cons]
    simp only [Nat.sub_zero] at h3 h4'
    apply Nat.le_of_not_lt
    intro hlt
    have hk : barAtGo t' rest 0 < rest.length := by
      have := (barAtGo_spec t rest 0).2.1; omega
    have := h4' hk
    have := h3 _ hk hlt
    grind

/-! ## clampRange

> "Clamp a range to the bars that exist, with `from <= to`" — core.ts:123
-/

/-- **Holds.** The clamped range names bars that exist, in order. -/
theorem clampRange_valid (r : BarRange) (bars : Int) (hb : 1 ≤ bars) :
    0 ≤ (clampRange r bars).from_ ∧ (clampRange r bars).from_ ≤ (clampRange r bars).to ∧
      (clampRange r bars).to < bars := by
  unfold clampRange
  simp only
  split <;> simp <;> omega

/-- **Holds.** A range already in bounds is left exactly as it was — "A trim
    survives only on an edge left where it was" (core.ts:125). -/
theorem clampRange_id (r : BarRange) (bars : Int) (h0 : 0 ≤ r.from_) (h1 : r.from_ ≤ r.to) (h2 : r.to < bars) :
    clampRange r bars = r := by
  unfold clampRange
  have ha : max 0 (min r.from_ (max 0 (bars - 1))) = r.from_ := by omega
  have hb : max 0 (min r.to (max 0 (bars - 1))) = r.to := by omega
  simp only [ha, hb]
  have : ¬ r.from_ > r.to := by omega
  simp [this]

/-! ## timeOfBeat and beatOfTime

> "How many of its own beats into bar `b` score time `t` falls — the inverse
> of timeOfBeat." — core.ts:151
-/

theorem div_mul_div_cancel' (x l n : Rat) (hl : l ≠ 0) (hn : n ≠ 0) : (l * x / n) / l * n = x := by
  rw [Rat.div_def, Rat.div_def]
  calc l * x * n⁻¹ * l⁻¹ * n = x * (l * l⁻¹) * (n⁻¹ * n) := by grind
    _ = x := by rw [Rat.mul_inv_cancel _ hl, Rat.inv_mul_cancel _ hn]; grind

/-- **Holds.** `beatOfTime` undoes `timeOfBeat`, in a bar of positive length. -/
theorem beatOfTime_timeOfBeat (b : Bar) (beat : Rat) (hlen : b.start < b.end_) (hbeats : 0 < b.beats) :
    beatOfTime b (timeOfBeat b beat) = beat := by
  unfold beatOfTime timeOfBeat
  simp only [gt_iff_lt, hlen, ite_true]
  have : b.start + (b.end_ - b.start) * beat / b.beats - b.start = (b.end_ - b.start) * beat / b.beats := by grind
  rw [this]
  exact div_mul_div_cancel' beat (b.end_ - b.start) b.beats (by grind) (by grind)

/-- **Holds.** `timeOfBeat` undoes `beatOfTime`, in a bar of positive length. -/
theorem timeOfBeat_beatOfTime (b : Bar) (t : Rat) (hlen : b.start < b.end_) (hbeats : 0 < b.beats) :
    timeOfBeat b (beatOfTime b t) = t := by
  unfold beatOfTime timeOfBeat
  simp only [gt_iff_lt, hlen, ite_true]
  have hl : b.end_ - b.start ≠ 0 := by grind
  have hn : b.beats ≠ 0 := by grind
  have : (b.end_ - b.start) * ((t - b.start) / (b.end_ - b.start) * b.beats) / b.beats = t - b.start := by
    rw [Rat.div_def, Rat.div_def]
    calc (b.end_ - b.start) * ((t - b.start) * (b.end_ - b.start)⁻¹ * b.beats) * b.beats⁻¹
        = (t - b.start) * ((b.end_ - b.start) * (b.end_ - b.start)⁻¹) * (b.beats * b.beats⁻¹) := by grind
      _ = t - b.start := by rw [Rat.mul_inv_cancel _ hl, Rat.mul_inv_cancel _ hn]; grind
  rw [this]; grind

/-- `timeOfBeat` as an affine map: `start + len/beats * beat`. -/
theorem timeOfBeat_eq (b : Bar) (beat : Rat) :
    timeOfBeat b beat = b.start + ((b.end_ - b.start) * b.beats⁻¹) * beat := by
  unfold timeOfBeat; rw [Rat.div_def]; grind

theorem secPerBeat_pos (b : Bar) (hlen : b.start < b.end_) (hbeats : 0 < b.beats) :
    0 < (b.end_ - b.start) * b.beats⁻¹ :=
  Rat.mul_pos (by grind) (Rat.inv_pos.mpr hbeats)

/-- **Holds.** Later beats are later times. -/
theorem timeOfBeat_lt (b : Bar) (x y : Rat) (hlen : b.start < b.end_) (hbeats : 0 < b.beats) (h : x < y) :
    timeOfBeat b x < timeOfBeat b y := by
  rw [timeOfBeat_eq, timeOfBeat_eq]
  have := (Rat.mul_lt_mul_left (secPerBeat_pos b hlen hbeats)).mpr h
  grind

theorem timeOfBeat_zero (b : Bar) : timeOfBeat b 0 = b.start := by
  rw [timeOfBeat_eq]; grind

theorem timeOfBeat_beats (b : Bar) (hbeats : 0 < b.beats) : timeOfBeat b b.beats = b.end_ := by
  rw [timeOfBeat_eq]
  have : (b.end_ - b.start) * b.beats⁻¹ * b.beats = (b.end_ - b.start) * (b.beats⁻¹ * b.beats) := by grind
  rw [this, Rat.inv_mul_cancel _ (by grind)]; grind

/-- **Holds.** A beat strictly inside the bar is a time strictly inside it. -/
theorem timeOfBeat_inside (b : Bar) (x : Rat) (hlen : b.start < b.end_) (hbeats : 0 < b.beats)
    (h0 : 0 < x) (h1 : x < b.beats) : b.start < timeOfBeat b x ∧ timeOfBeat b x < b.end_ := by
  have a := timeOfBeat_lt b 0 x hlen hbeats h0
  have c := timeOfBeat_lt b x b.beats hlen hbeats h1
  rw [timeOfBeat_zero] at a
  rw [timeOfBeat_beats b hbeats] at c
  exact ⟨a, c⟩

/-! ## normalizeRange

> "A range clamped (clampRange) with every trim strictly inside its bar, so
> each range has one spelling" — core.ts:156
-/

/-- A range in the one spelling `normalizeRange` promises. -/
structure Normal (score : Score) (r : BarRange) : Prop where
  lo : 0 ≤ r.from_
  ord : r.from_ ≤ r.to
  hi : r.to < score.bars.length
  head : ∀ h, r.fromBeat = some h → EPS < h ∧ h < beatsOf score r.from_ - EPS
  tail : ∀ t, r.toBeat = some t → EPS < t ∧ t < beatsOf score r.to - EPS
  one : ∀ h t, r.from_ = r.to → r.fromBeat = some h → r.toBeat = some t → h + EPS < t

set_option linter.unusedSimpArgs false in
/-- **Holds.** Whatever range it is given, `normalizeRange` returns bars that
    exist, in order, with "every trim strictly inside its bar" and a one-bar
    range never trimmed to nothing. -/
theorem normalizeClamped_normal (score : Score) (r : BarRange)
    (c0 : 0 ≤ r.from_) (c1 : r.from_ ≤ r.to) (c2 : r.to < score.bars.length) :
    Normal score (normalizeClamped score r) := by
  unfold normalizeClamped
  cases hf : r.fromBeat with
  | none =>
    cases ht : r.toBeat with
    | none => constructor <;> simp [hf, ht, Option.filter] <;> omega
    | some t =>
      by_cases h1 : t < beatsOf score r.to - EPS
      · by_cases h2 : t ≤ EPS
        · constructor <;> simp [hf, ht, Option.filter, h1, h2] <;> omega
        · constructor <;> simp [hf, ht, Option.filter, h1, h2] <;> first | omega | grind
      · constructor <;> simp [hf, ht, Option.filter, h1] <;> omega
  | some h =>
    by_cases g1 : h > EPS
    · by_cases g2 : h ≥ beatsOf score r.from_ - EPS
      · cases ht : r.toBeat with
        | none => constructor <;> simp [hf, ht, Option.filter, g1, g2] <;> grind
        | some t =>
          by_cases h1 : t < beatsOf score r.to - EPS
          · by_cases h2 : t ≤ EPS
            · constructor <;> simp [hf, ht, Option.filter, g1, g2, h1, h2] <;> grind
            · constructor <;> simp [hf, ht, Option.filter, g1, g2, h1, h2] <;> grind
          · constructor <;> simp [hf, ht, Option.filter, g1, g2, h1] <;> grind
      · cases ht : r.toBeat with
        | none => constructor <;> simp [hf, ht, Option.filter, g1, g2] <;> grind
        | some t =>
          by_cases h1 : t < beatsOf score r.to - EPS
          · by_cases h2 : t ≤ EPS
            · constructor <;> simp [hf, ht, Option.filter, g1, g2, h1, h2] <;> grind
            · constructor <;> simp [hf, ht, Option.filter, g1, g2, h1, h2] <;> grind
          · constructor <;> simp [hf, ht, Option.filter, g1, g2, h1] <;> grind
    · cases ht : r.toBeat with
      | none => constructor <;> simp [hf, ht, Option.filter, g1] <;> omega
      | some t =>
        by_cases h1 : t < beatsOf score r.to - EPS
        · by_cases h2 : t ≤ EPS
          · constructor <;> simp [hf, ht, Option.filter, g1, h1, h2] <;> omega
          · constructor <;> simp [hf, ht, Option.filter, g1, h1, h2] <;> first | omega | grind
        · constructor <;> simp [hf, ht, Option.filter, g1, h1] <;> omega

theorem normalizeRange_normal (score : Score) (hne : score.bars ≠ []) (range : BarRange) :
    Normal score (normalizeRange score range) := by
  have hlen : (1 : Int) ≤ score.bars.length := by
    have : 0 < score.bars.length := List.length_pos_iff.mpr hne
    omega
  obtain ⟨c0, c1, c2⟩ := clampRange_valid range score.bars.length hlen
  exact normalizeClamped_normal score _ c0 c1 c2

/-- A range already in normal form is left exactly as it is. -/
theorem normalizeClamped_of_normal (score : Score) (r : BarRange) (hn : Normal score r) :
    normalizeClamped score r = r := by
  obtain ⟨from_, to, fromBeat, toBeat⟩ := r
  obtain ⟨_, _, _, hhead, htail, hone⟩ := hn
  simp only at hhead htail hone
  unfold normalizeClamped
  cases fromBeat with
  | none =>
    cases toBeat with
    | none => simp [Option.filter]
    | some t =>
      have := htail t rfl
      have h1 : t < beatsOf score to - EPS := this.2
      have h2 : ¬ t ≤ EPS := by grind
      simp [Option.filter, h1, h2]
  | some h =>
    have := hhead h rfl
    have g1 : h > EPS := this.1
    have g2 : ¬ h ≥ beatsOf score from_ - EPS := by grind
    cases toBeat with
    | none => simp [Option.filter, g1, g2]
    | some t =>
      have := htail t rfl
      have h1 : t < beatsOf score to - EPS := this.2
      have h2 : ¬ t ≤ EPS := by grind
      have h3 : ¬ (from_ = to ∧ t ≤ h + EPS) := by
        intro ⟨e, l⟩; have := hone h t e rfl rfl; grind
      simp [Option.filter, g1, g2, h1, h2, h3]

/-- **Holds.** "each range has one spelling" (core.ts:157): normalizing twice
    is normalizing once. -/
theorem normalizeRange_idem (score : Score) (hne : score.bars ≠ []) (range : BarRange) :
    normalizeRange score (normalizeRange score range) = normalizeRange score range := by
  have hn := normalizeRange_normal score hne range
  generalize normalizeRange score range = n at hn
  unfold normalizeRange
  rw [clampRange_id n _ hn.lo hn.ord hn.hi]
  exact normalizeClamped_of_normal score n hn

/-! ## onAttack and barTime

> "The seconds a run of bars covers: from the first bar's start to the last
> bar's end, or to the trims when it has them." — core.ts:196
> "A trimmed edge within a microsecond of an attack lands ON it." — core.ts:189
-/

/-- **Holds.** `onAttack` moves a time by less than a microsecond. -/
theorem onAttack_near (score : Score) (t : Rat) : absR (onAttack score t - t) < EPS := by
  unfold onAttack
  split
  · rename_i n hfind
    have := List.find?_some hfind
    simpa using this
  · have : t - t = 0 := by grind
    rw [this]; unfold absR; simp; exact EPS_pos

/-- In a list sorted by onset, `find?` returns a note no later than any other
    note the predicate accepts. -/
theorem find?_sorted_le (l : List Note) (p : Note → Bool) (a : Note)
    (hs : l.Pairwise (fun a b => a.onset ≤ b.onset)) (hf : l.find? p = some a) :
    ∀ b ∈ l, p b = true → a.onset ≤ b.onset := by
  induction l with
  | nil => simp at hf
  | cons x l ih =>
    rw [List.pairwise_cons] at hs
    intro b hb hpb
    by_cases hx : p x = true
    · rw [List.find?_cons_of_pos hx] at hf
      cases hf
      rcases List.mem_cons.mp hb with rfl | hb
      · exact Rat.le_refl
      · exact hs.1 b hb
    · rw [List.find?_cons_of_neg hx] at hf
      rcases List.mem_cons.mp hb with rfl | hb
      · exact absurd hpb hx
      · exact ih hs.2 hf b hb hpb

/-- **Holds.** Snapping to attacks never puts two times out of order, on a
    score whose notes are sorted by onset. -/
theorem onAttack_mono (score : Score) (hs : score.notes.Pairwise (fun a b => a.onset ≤ b.onset))
    (s e : Rat) (hse : s ≤ e) : onAttack score s ≤ onAttack score e := by
  unfold onAttack
  cases h1 : score.notes.find? (fun n => decide (absR (n.onset - s) < EPS)) with
  | none =>
    cases h2 : score.notes.find? (fun n => decide (absR (n.onset - e) < EPS)) with
    | none => exact hse
    | some n2 =>
      simp only
      have hp2 := List.find?_some h2
      have hm2 := List.mem_of_find?_eq_some h2
      have hno := List.find?_eq_none.mp h1 n2 hm2
      simp only [decide_eq_true_eq] at hp2 hno
      rw [absR_lt] at hp2 hno
      grind
  | some n1 =>
    have hp1 := List.find?_some h1
    have hm1 := List.mem_of_find?_eq_some h1
    simp only [decide_eq_true_eq] at hp1
    rw [absR_lt] at hp1
    cases h2 : score.notes.find? (fun n => decide (absR (n.onset - e) < EPS)) with
    | none =>
      simp only
      have hno := List.find?_eq_none.mp h2 n1 hm1
      simp only [decide_eq_true_eq] at hno
      rw [absR_lt] at hno
      grind
    | some n2 =>
      simp only
      have hp2 := List.find?_some h2
      have hm2 := List.mem_of_find?_eq_some h2
      simp only [decide_eq_true_eq] at hp2
      rw [absR_lt] at hp2
      apply Rat.not_lt.mp
      intro hlt
      have hmin := find?_sorted_le score.notes _ n1 hs h1 n2 hm2
        (by simp only [decide_eq_true_eq]; rw [absR_lt]; grind)
      grind

/-- The range's edges before `onAttack` touches them — core.ts:207-208 with
    `onAttack` taken out. -/
def barTimeRaw (score : Score) (r : BarRange) : TimeRange :=
  let a := score.bars.getD r.from_.toNat default
  let b := score.bars.getD r.to.toNat default
  { start := match r.fromBeat with
      | none => a.start
      | some x => timeOfBeat a x,
    end_ := match r.toBeat with
      | none => b.end_
      | some x => timeOfBeat b x }

theorem barTime_some (score : Score) (range : BarRange) :
    barTime score (some range) =
      { start := match (normalizeRange score range).fromBeat with
          | none => (barTimeRaw score (normalizeRange score range)).start
          | some _ => onAttack score (barTimeRaw score (normalizeRange score range)).start,
        end_ := match (normalizeRange score range).toBeat with
          | none => (barTimeRaw score (normalizeRange score range)).end_
          | some _ => onAttack score (barTimeRaw score (normalizeRange score range)).end_ } := by
  unfold barTime barTimeRaw
  simp only
  cases (normalizeRange score range).fromBeat <;> cases (normalizeRange score range).toBeat <;> rfl

/-- **Holds.** Before snapping, a normalized range always covers a non-empty
    stretch of time, and one that lies inside its bars. -/
theorem barTimeRaw_nonempty (score : Score) (hw : BarsWF score.bars) (r : BarRange) (hn : Normal score r) :
    let a := score.bars.getD r.from_.toNat default
    let b := score.bars.getD r.to.toNat default
    (barTimeRaw score r).start < (barTimeRaw score r).end_ ∧
      a.start ≤ (barTimeRaw score r).start ∧ (barTimeRaw score r).end_ ≤ b.end_ := by
  obtain ⟨from_, to, fromBeat, toBeat⟩ := r
  obtain ⟨hlo, hord, hhi, hhead, htail, hone⟩ := hn
  simp only at hlo hord hhi hhead htail hone
  have hi : from_.toNat < score.bars.length := by omega
  have hj : to.toNat < score.bars.length := by omega
  have ea : score.bars.getD from_.toNat default = score.bars[from_.toNat] := by simp [hi]
  have eb : score.bars.getD to.toNat default = score.bars[to.toNat] := by simp [hj]
  have hbeats : ∀ i : Int, 0 ≤ i → (h : i.toNat < score.bars.length) →
      beatsOf score i = score.bars[i.toNat].beats := by
    intro i _ h; simp [beatsOf, h]
  have pa := hw.positive _ (List.getElem_mem hi)
  have pb := hw.positive _ (List.getElem_mem hj)
  have ma := hw.meter _ (List.getElem_mem hi)
  have mb := hw.meter _ (List.getElem_mem hj)
  -- the two bars, in order
  have hab : from_ < to → score.bars[from_.toNat].end_ ≤ score.bars[to.toNat].start := by
    intro h; exact bars_ordered score.bars hw _ _ (by omega) hj
  have hsame : from_ = to → score.bars[from_.toNat] = score.bars[to.toNat] := by
    intro h; subst h; rfl
  simp only [barTimeRaw, ea, eb]
  cases fromBeat with
  | none =>
    cases toBeat with
    | none =>
      refine ⟨?_, Rat.le_refl, Rat.le_refl⟩
      by_cases e : from_ = to
      · rw [hsame e]; exact pb
      · have := hab (by omega); grind
    | some t =>
      have ht := htail t rfl
      rw [hbeats to (by omega) hj] at ht
      have hin := timeOfBeat_inside _ t pb mb (by have := EPS_pos; grind) (by have := EPS_pos; grind)
      refine ⟨?_, Rat.le_refl, by simp only; grind⟩
      simp only
      by_cases e : from_ = to
      · rw [hsame e]; exact hin.1
      · have := hab (by omega); grind
  | some h =>
    have hh := hhead h rfl
    rw [hbeats from_ hlo hi] at hh
    have hin := timeOfBeat_inside _ h pa ma (by have := EPS_pos; grind) (by have := EPS_pos; grind)
    cases toBeat with
    | none =>
      refine ⟨?_, by simp only; grind, Rat.le_refl⟩
      simp only
      by_cases e : from_ = to
      · rw [← hsame e]; exact hin.2
      · have := hab (by omega); grind
    | some t =>
      have ht := htail t rfl
      rw [hbeats to (by omega) hj] at ht
      have hin' := timeOfBeat_inside _ t pb mb (by have := EPS_pos; grind) (by have := EPS_pos; grind)
      refine ⟨?_, by simp only; grind, by simp only; grind⟩
      simp only
      by_cases e : from_ = to
      · rw [← hsame e]
        have := hone h t e rfl rfl
        exact timeOfBeat_lt _ h t pa ma (by have := EPS_pos; grind)
      · have := hab (by omega); grind

/-- **Holds.** A range with no trims covers a non-empty stretch: from its
    first bar's start to its last bar's end. -/
theorem barTime_untrimmed (score : Score) (hw : BarsWF score.bars) (range : BarRange)
    (h1 : (normalizeRange score range).fromBeat = none) (h2 : (normalizeRange score range).toBeat = none) :
    (barTime score (some range)).start < (barTime score (some range)).end_ := by
  have hn := normalizeRange_normal score hw.ne range
  have := (barTimeRaw_nonempty score hw _ hn).1
  rw [barTime_some]; simp only [h1, h2]; exact this

/-- **Holds only under a hypothesis the code does not enforce:** the range,
    before snapping, is at least two microseconds long. Then the time it
    covers is non-empty: `start < end`. -/
theorem barTime_nonempty (score : Score) (range : BarRange)
    (hlong : 2 * EPS ≤ (barTimeRaw score (normalizeRange score range)).end_ -
      (barTimeRaw score (normalizeRange score range)).start) :
    (barTime score (some range)).start < (barTime score (some range)).end_ := by
  rw [barTime_some]
  generalize barTimeRaw score (normalizeRange score range) = raw at *
  have near_s := onAttack_near score raw.start
  have near_e := onAttack_near score raw.end_
  rw [absR_lt] at near_s near_e
  cases (normalizeRange score range).fromBeat <;> cases (normalizeRange score range).toBeat <;>
    simp only <;> have := EPS_pos <;> grind

/-- **Holds only under a hypothesis the code does not enforce:** both edges
    trimmed, or neither. Then, on a score whose notes are sorted, the time a
    range covers never runs backward: `start ≤ end`. -/
theorem barTime_ordered (score : Score) (hw : BarsWF score.bars)
    (hs : score.notes.Pairwise (fun a b => a.onset ≤ b.onset)) (range : BarRange)
    (hboth : (normalizeRange score range).fromBeat.isSome = (normalizeRange score range).toBeat.isSome) :
    (barTime score (some range)).start ≤ (barTime score (some range)).end_ := by
  have hn := normalizeRange_normal score hw.ne range
  have hraw := (barTimeRaw_nonempty score hw _ hn).1
  rw [barTime_some]
  generalize normalizeRange score range = r at *
  generalize barTimeRaw score r = raw at *
  have mono := onAttack_mono score hs raw.start raw.end_ (by grind)
  cases hf : r.fromBeat <;> cases ht : r.toBeat <;> simp [hf, ht] at hboth <;> simp only
  · grind
  · exact mono

/-- The counterexample for `FAILS_barTime_ordered`: two 4/4 bars of one second
    each, and one note a tenth of a microsecond before the second barline.
    Written out as the value `makeScore` returns for that note and barlines
    at 0, 1 and 2 (the repro script builds it that way). -/
def invertedScore : Score :=
  { notes := [{ id := 0, pitch := 60, onset := 9999999 / 10000000, duration := 1 }],
    duration := 19999999 / 10000000,
    bars := [⟨0, 0, 1, 4, 4, 0⟩, ⟨1, 1, 2, 4, 4, 0⟩],
    pedal := [] }

theorem invertedScore_wf : BarsWF invertedScore.bars where
  ne := by decide
  head := by intro b hb; cases hb; rfl
  contiguous := ⟨rfl, trivial⟩
  positive := by
    intro b hb
    simp [invertedScore] at hb
    rcases hb with rfl | rfl <;> decide +kernel
  index := by
    intro k h
    match k, h with
    | 0, _ => rfl
    | 1, _ => rfl
  meter := by
    intro b hb
    simp [invertedScore] at hb
    rcases hb with rfl | rfl <;> decide +kernel

/-- **Fails:** "The seconds a run of bars covers" (core.ts:196) can be a
    stretch that ends before it begins. The trims are kept apart in BEATS
    (`BEAT_EPS`, core.ts:143) but snapped to attacks in SECONDS (core.ts:194),
    and only a trimmed edge is snapped: bar 2 trimmed to end two millionths of
    a beat in is half a microsecond long, and its end snaps back to an attack
    just before the barline its untrimmed start sits on.
    Repro: `repro/core_bartime_inverted.ts`. -/
theorem FAILS_barTime_ordered :
    ¬ ∀ (score : Score), BarsWF score.bars → score.notes.Pairwise (fun a b => a.onset ≤ b.onset) →
        ∀ range : BarRange, (barTime score (some range)).start ≤ (barTime score (some range)).end_ := by
  intro h
  have := h invertedScore invertedScore_wf (by simp [invertedScore])
    { from_ := 1, to := 1, toBeat := some (2 / 1000000) }
  exact absurd this (by decide +kernel)

/-! ## activeAt

> "which notes are sounding at time t" — core.ts:212, half-open (types.ts:74).
-/

/-- **Holds.** `activeAt` is exactly the notes whose `[onset, onset + duration)`
    contains `t`. -/
theorem mem_activeAt (score : Score) (t : Rat) (n : Note) :
    n ∈ activeAt score t ↔ n ∈ score.notes ∧ n.onset ≤ t ∧ t < n.onset + n.duration := by
  simp [activeAt]

/-! ## makeScore, gathered -/

/-- **Holds only under a hypothesis the code does not enforce:** the piece has
    positive length. Then `makeScore` returns bars in the documented shape. -/
theorem makeScore_bars_wf (raw : List RawNote) (barlines : List Barline) (pedal : List RawPedal)
    (h : 0 < (makeScore raw barlines pedal).duration) : BarsWF (makeScore raw barlines pedal).bars :=
  makeBars_wf _ _ h

end Harmonicland
