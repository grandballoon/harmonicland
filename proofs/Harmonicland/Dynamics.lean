/-!
# Dynamics — `src/inputs/dynamics.ts`

A source's loudness markings, placed in time, become each note's velocity.

## What the model is

A line-by-line translation of `fromPercent` and `makeDynamics`. Score time is
`Rat`; a velocity is `Int`. The closure's two arrays (`levels`, `accents`) are
the state record `St`, and `level`, `mark` and `velocityAt` are functions on it.

JavaScript's `w in LEVELS` asks about the object's OWN keys and the ones it
INHERITS from `Object.prototype`. The model keeps that: `inLEVELS` is true for
the ten own keys and for the inherited names a lower-cased word can spell
(`constructor`, `__proto__`), and `LEVELS[w]` for an inherited name is a value
that is not a number (`Vel.notANumber`: the function `Object`, or
`Object.prototype`).

## What the model leaves out

* Floating-point rounding, `NaN` and `Infinity` as inputs. `at = -Infinity`
  (dynamics.ts:84) is the explicit `none`. In doubles, `at + SAME_TIME * 2`,
  `t + SAME_TIME` and `Math.abs(a - t)` each round; the `fp` theorems below
  are about exact arithmetic.
* `word.trim().toLowerCase()` (dynamics.ts:68): `mark` here takes the word
  already trimmed and lower-cased.
* What arithmetic on a non-number yields exactly (`NaN`); it stays
  `Vel.notANumber`.
* Names Lean reserves: `at` is `time`.
-/

namespace Harmonicland.Dynamics

/-- `Math.abs`. -/
def absR (x : Rat) : Rat := if x < 0 then -x else x

theorem absR_lt {x e : Rat} : absR x < e ↔ -e < x ∧ x < e := by
  unfold absR; split <;> grind

/-- `Math.round`: the nearest integer, a half going up. -/
def jsRound (x : Rat) : Int := (x + 1 / 2).floor

/-- What a JavaScript expression that should be a velocity evaluates to. -/
inductive Vel where
  | num (v : Int)
  | notANumber
  deriving DecidableEq, Repr

/-- src/inputs/dynamics.ts:24 — the object's own keys. -/
def LEVELS : List (String × Int) :=
  [("pppp", 10), ("ppp", 20), ("pp", 33), ("p", 49), ("mp", 64), ("mf", 80), ("f", 96),
   ("ff", 112), ("fff", 124), ("ffff", 127)]

/-- src/inputs/dynamics.ts:29 — the object's own keys; `none` is `null`. -/
def ACCENTS : List (String × Option String) :=
  [("sf", none), ("sfz", none), ("sffz", none), ("fz", none), ("rf", none), ("rfz", none),
   ("fp", some "p"), ("sfp", some "p"), ("sfpp", some "pp"), ("fzp", some "p")]

/-- The properties every plain object inherits from `Object.prototype` whose
    names are all lower case, so that `word.toLowerCase()` can equal them. (The
    others — `toString`, `valueOf`, `hasOwnProperty`, ... — have a capital.) -/
def inherited : List String := ["constructor", "__proto__"]

/-- `w in LEVELS` (dynamics.ts:69): own or inherited. -/
def inLEVELS (w : String) : Bool := (LEVELS.lookup w).isSome || inherited.contains w

/-- `LEVELS[w]`, given `w in LEVELS`. -/
def getLEVELS (w : String) : Vel :=
  match LEVELS.lookup w with
  | some v => .num v
  | none => .notANumber

/-- `w in ACCENTS` (dynamics.ts:73): own or inherited. -/
def inACCENTS (w : String) : Bool := (ACCENTS.lookup w).isSome || inherited.contains w

/-- `LEVELS.mf` (dynamics.ts:93). -/
def MF : Int := 80

/-- src/inputs/dynamics.ts:36 -/
def ACCENT_LIFT : Int := 24
/-- src/inputs/dynamics.ts:37 -/
def ACCENT_FLOOR : Int := 96
/-- src/inputs/dynamics.ts:40 — `1e-6`. -/
def SAME_TIME : Rat := 1 / 1000000

/-- src/inputs/dynamics.ts:44 -/
def fromPercent (pct : Rat) : Int := max 1 (min 127 (jsRound (pct * 90 / 100)))

/-- The closure's state (dynamics.ts:58-59), each array in push order. -/
structure St where
  levels : List (Rat × Vel)
  accents : List Rat

/-- src/inputs/dynamics.ts:57 — `makeDynamics()`. -/
def empty : St := { levels := [], accents := [] }

/-- src/inputs/dynamics.ts:61 -/
def level (s : St) (velocity : Vel) (time : Rat) : St :=
  { s with levels := s.levels ++ [(time, velocity)] }

/-- src/inputs/dynamics.ts:67-80 — `w` is the word trimmed and lower-cased. -/
def mark (s : St) (w : String) (time : Rat) : Bool × St :=
  if inLEVELS w then (true, level s (getLEVELS w) time)
  else if inACCENTS w then
    let s1 : St := { s with accents := s.accents ++ [time] }
    match (ACCENTS.lookup w).join with
    | some after => (true, level s1 (getLEVELS after) (time + SAME_TIME * 2))
    | none => (true, s1)
  else (false, s)

/-- The loop variables of `velocityAt` (dynamics.ts:83-84); `time = none` is
    `-Infinity`. -/
structure Scan where
  inForce : Option Vel
  time : Option Rat
  deriving DecidableEq, Repr

/-- `x >= at` (dynamics.ts:86), where `at` may still be `-Infinity`. -/
def notBefore (time : Option Rat) (x : Rat) : Bool :=
  match time with
  | none => true
  | some a => decide (x ≥ a)

/-- src/inputs/dynamics.ts:86-89 — one turn of the loop. -/
def scanStep (t : Rat) (sc : Scan) (l : Rat × Vel) : Scan :=
  if l.1 ≤ t + SAME_TIME ∧ notBefore sc.time l.1 = true then
    { inForce := some l.2, time := some l.1 }
  else sc

/-- src/inputs/dynamics.ts:83-89 -/
def scan (levels : List (Rat × Vel)) (t : Rat) : Scan :=
  levels.foldl (scanStep t) { inForce := none, time := none }

/-- src/inputs/dynamics.ts:90 — `accents.some((a) => Math.abs(a - t) < SAME_TIME)`. -/
def accented (accents : List Rat) (t : Rat) : Bool :=
  accents.any (fun a => decide (absR (a - t) < SAME_TIME))

/-- src/inputs/dynamics.ts:93 —
    `Math.min(127, Math.max((inForce ?? LEVELS.mf) + ACCENT_LIFT, ACCENT_FLOOR))`. -/
def lift (inForce : Option Vel) : Vel :=
  match inForce with
  | none => .num (min 127 (max (MF + ACCENT_LIFT) ACCENT_FLOOR))
  | some (.num v) => .num (min 127 (max (v + ACCENT_LIFT) ACCENT_FLOOR))
  | some .notANumber => .notANumber

/-- src/inputs/dynamics.ts:81-94 — `none` is `undefined`. -/
def velocityAt (s : St) (t : Rat) : Option Vel :=
  let inForce := (scan s.levels t).inForce
  if !accented s.accents t then inForce else some (lift inForce)

/-! ## `fromPercent` (dynamics.ts:42-44) -/

/-- dynamics.ts:42 "A velocity from a percentage": for every (finite)
    percentage the result is a MIDI velocity, 1..127. -/
theorem fromPercent_range (pct : Rat) : 1 ≤ fromPercent pct ∧ fromPercent pct ≤ 127 := by
  unfold fromPercent
  omega

/-- dynamics.test.ts:44 "reads MusicXML's percentages of forte". -/
theorem fromPercent_tests :
    fromPercent 100 = 90 ∧ fromPercent 50 = 45 ∧ fromPercent 500 = 127 ∧ fromPercent 0 = 1 := by
  decide +kernel

/-! ## The tables (dynamics.ts:23-32) -/

/-- dynamics.ts:23 "Marked levels as MIDI velocities": every one is 1..127. -/
theorem LEVELS_range : ∀ p ∈ LEVELS, 1 ≤ p.2 ∧ p.2 ≤ 127 := by decide

/-- dynamics.ts:23 "pppp to ffff": the table rises strictly. -/
theorem LEVELS_increasing : LEVELS.Pairwise (fun a b => a.2 < b.2) := by decide

/-- dynamics.ts:28 "the level each leaves in force after it": every such level
    is one of `LEVELS`' own keys, so `LEVELS[after]` is a number. -/
theorem ACCENTS_after_known :
    ∀ p ∈ ACCENTS, ∀ after, p.2 = some after → (LEVELS.lookup after).isSome := by decide

/-- A level `mark` or a well-behaved `level` caller records. -/
def Vel.ok : Vel → Prop
  | .num v => 1 ≤ v ∧ v ≤ 127
  | .notANumber => False

theorem getLEVELS_ok_of_lookup (w : String) (h : (LEVELS.lookup w).isSome) : (getLEVELS w).ok := by
  unfold getLEVELS
  cases hl : LEVELS.lookup w with
  | none => simp [hl] at h
  | some v =>
    have hm : (w, v) ∈ LEVELS := by
      have := List.lookup_eq_some_iff.mp hl
      obtain ⟨l1, l2, heq, _⟩ := this
      rw [heq]; simp
    exact LEVELS_range (w, v) hm

/-! ## `mark` (dynamics.ts:47-49, 67-80) -/

/-- The words the reader knows: `LEVELS`' and `ACCENTS`' own keys. -/
def known (w : String) : Bool := (LEVELS.lookup w).isSome || (ACCENTS.lookup w).isSome

/-- dynamics.ts:47-48 "False if it is not a dynamic this reader knows, so the
    caller can ignore it" and dynamics.test.ts:37 "ignores words that are not
    dynamics" — HOLDS ONLY UNDER A HYPOTHESIS the code does not enforce: the
    word is not a name inherited from `Object.prototype`
    (`constructor`, `__proto__`). Then `mark` answers exactly "is it known",
    and an unknown word leaves the state as it was. -/
theorem mark_known_iff (s : St) (w : String) (time : Rat) (hw : inherited.contains w = false) :
    (mark s w time).1 = known w ∧ (known w = false → (mark s w time).2 = s) := by
  unfold mark known inLEVELS inACCENTS
  rw [hw]
  cases h1 : (LEVELS.lookup w).isSome <;> cases h2 : (ACCENTS.lookup w).isSome <;> simp
  all_goals (split <;> simp)

/-- FAILS without it. dynamics.ts:47-48 / dynamics.test.ts:37: the word
    `constructor` is no dynamic, yet `mark` answers true and records a level
    whose velocity is not a number (`LEVELS["constructor"]` is the function
    `Object`); the notes after it are then given that as their velocity.
    Repro: proofs/repro/dynamics_constructor.ts. -/
theorem FAILS_mark_ignores_words_that_are_not_dynamics :
    known "constructor" = false
    ∧ (mark empty "constructor" 0).1 = true
    ∧ velocityAt (mark empty "constructor" 0).2 0 = some .notANumber
    ∧ velocityAt (mark (mark empty "constructor" 0).2 "sfz" 1).2 1 = some .notANumber := by
  decide +kernel

/-- Every level in force is a MIDI velocity. -/
def LevelsOK (s : St) : Prop := ∀ l ∈ s.levels, l.2.ok

theorem empty_ok : LevelsOK empty := by simp [LevelsOK, empty]

/-- `level` keeps the levels MIDI velocities when it is handed one — as its
    one caller does (musicxml.ts:125 passes `fromPercent(...)`,
    `fromPercent_range`). `level` itself checks nothing. -/
theorem level_ok (s : St) (v : Int) (time : Rat) (hs : LevelsOK s) (hv : 1 ≤ v ∧ v ≤ 127) :
    LevelsOK (level s (.num v) time) := by
  intro l hl
  simp only [level, List.mem_append, List.mem_singleton] at hl
  rcases hl with hl | hl
  · exact hs l hl
  · subst hl; exact hv

/-- `mark` keeps the levels MIDI velocities — under the same unenforced
    hypothesis as `mark_known_iff`. -/
theorem mark_ok (s : St) (w : String) (time : Rat) (hs : LevelsOK s)
    (hw : inherited.contains w = false) : LevelsOK (mark s w time).2 := by
  unfold mark inLEVELS inACCENTS
  rw [hw]
  simp only [Bool.or_false]
  split
  · rename_i h
    intro l hl
    simp only [level, List.mem_append, List.mem_singleton] at hl
    rcases hl with hl | hl
    · exact hs l hl
    · subst hl; exact getLEVELS_ok_of_lookup w h
  · split
    · rename_i h
      cases hl : ACCENTS.lookup w with
      | none => simp [hl] at h
      | some a =>
        cases a with
        | none => simpa [Option.join, LevelsOK] using hs
        | some after =>
          have hm : (w, some after) ∈ ACCENTS := by
            obtain ⟨l1, l2, heq, _⟩ := List.lookup_eq_some_iff.mp hl
            rw [heq]; simp
          have hk := ACCENTS_after_known (w, some after) hm after rfl
          intro l hl'
          have hl'' : l ∈ s.levels ++ [(time + SAME_TIME * 2, getLEVELS after)] := hl'
          rw [List.mem_append] at hl''
          rcases hl'' with hl'' | hl''
          · exact hs l hl''
          · simp at hl''; subst hl''; exact getLEVELS_ok_of_lookup after hk
    · exact hs

/-! ## `velocityAt`: the level in force (dynamics.ts:82-89) -/

/-- What dynamics.ts:82 says the loop computes, with its tolerance spelled out:
    "the latest level at or before t" — at or before `t + SAME_TIME`, since "a
    note this close to a marking is struck where it stands" (dynamics.ts:39) —
    "among equals, the last recorded". `levels` splits around the chosen level
    `(a, v)`: nothing eligible recorded before it is later, nothing eligible
    recorded after it is as late. -/
def Latest (levels : List (Rat × Vel)) (t : Rat) (sc : Scan) : Prop :=
  (sc = { inForce := none, time := none } ∧ ∀ x ∈ levels, ¬ x.1 ≤ t + SAME_TIME)
  ∨ ∃ pre a v post, levels = pre ++ (a, v) :: post
      ∧ sc = { inForce := some v, time := some a }
      ∧ a ≤ t + SAME_TIME
      ∧ (∀ x ∈ pre, x.1 ≤ t + SAME_TIME → x.1 ≤ a)
      ∧ (∀ x ∈ post, x.1 ≤ t + SAME_TIME → x.1 < a)

theorem latest_step (levels : List (Rat × Vel)) (t : Rat) (sc : Scan) (l : Rat × Vel)
    (h : Latest levels t sc) : Latest (levels ++ [l]) t (scanStep t sc l) := by
  rcases h with ⟨hsc, hnone⟩ | ⟨pre, a, v, post, hl, hsc, hat, hpre, hpost⟩
  · subst hsc
    by_cases hc : l.1 ≤ t + SAME_TIME
    · right
      refine ⟨levels, l.1, l.2, [], rfl, by simp [scanStep, notBefore, hc], hc, ?_, by simp⟩
      intro x hx hxt
      exact absurd hxt (hnone x hx)
    · left
      refine ⟨by simp [scanStep, notBefore, hc], ?_⟩
      intro x hx
      rw [List.mem_append] at hx
      rcases hx with hx | hx
      · exact hnone x hx
      · simp at hx; subst hx; exact hc
  · subst hsc
    by_cases hc : l.1 ≤ t + SAME_TIME ∧ l.1 ≥ a
    · right
      refine ⟨levels, l.1, l.2, [], rfl, by simp [scanStep, notBefore, hc], hc.1, ?_, by simp⟩
      intro x hx hxt
      rw [hl] at hx
      simp only [List.mem_append, List.mem_cons] at hx
      rcases hx with hx | hx | hx
      · have := hpre x hx hxt; grind
      · subst hx; exact hc.2
      · have := hpost x hx hxt; grind
    · right
      refine ⟨pre, a, v, post ++ [l], by simp [hl], ?_, hat, hpre, ?_⟩
      · have hc' : ¬ (l.1 ≤ t + SAME_TIME ∧ notBefore (some a) l.1 = true) := by
          simpa [notBefore] using hc
        simp only [scanStep]
        simp [hc']
      · intro x hx hxt
        rw [List.mem_append] at hx
        rcases hx with hx | hx
        · exact hpost x hx hxt
        · simp at hx; subst hx; grind

theorem latest_foldl (done todo : List (Rat × Vel)) (t : Rat) (sc : Scan)
    (h : Latest done t sc) : Latest (done ++ todo) t (todo.foldl (scanStep t) sc) := by
  induction todo generalizing done sc with
  | nil => simpa using h
  | cons l rest ih =>
    have := ih (done ++ [l]) (scanStep t sc l) (latest_step done t sc l h)
    simpa using this

/-- dynamics.ts:82 "the latest level at or before t; among equals, the last
    recorded" — HOLDS, reading "at or before t" with the `SAME_TIME` tolerance
    the code applies (see `Latest`). -/
theorem scan_latest (levels : List (Rat × Vel)) (t : Rat) : Latest levels t (scan levels t) := by
  have := latest_foldl [] levels t { inForce := none, time := none } (Or.inl ⟨rfl, by simp⟩)
  simpa [scan] using this

/-- dynamics.ts:19 / dynamics.test.ts:5 "leaves notes before any level without
    a velocity": with no accent at `t`, `velocityAt` is `undefined` exactly when
    no level stands at or before `t + SAME_TIME`. -/
theorem velocityAt_undefined_iff (s : St) (t : Rat) (ha : accented s.accents t = false) :
    velocityAt s t = none ↔ ∀ x ∈ s.levels, ¬ x.1 ≤ t + SAME_TIME := by
  have h := scan_latest s.levels t
  simp only [velocityAt, ha, Bool.not_false, ite_true]
  rcases h with ⟨hsc, hnone⟩ | ⟨pre, a, v, post, hl, hsc, hat, _, _⟩
  · rw [hsc]; simp only [true_iff]; exact hnone
  · rw [hsc]
    simp only [reduceCtorEq, false_iff]
    intro hall
    exact hall (a, v) (by rw [hl]; simp) hat

/-- The level in force is one of the recorded levels. -/
theorem scan_mem (levels : List (Rat × Vel)) (t : Rat) (v : Vel)
    (h : (scan levels t).inForce = some v) : ∃ a, (a, v) ∈ levels := by
  rcases scan_latest levels t with ⟨hsc, _⟩ | ⟨pre, a, v', post, hl, hsc, _⟩
  · rw [hsc] at h; simp at h
  · rw [hsc] at h
    simp at h
    subst h
    exact ⟨a, by rw [hl]; simp⟩

/-! ## Accents (dynamics.ts:34-37, 90-93) -/

/-- dynamics.ts:34-35 "the least it lifts it to: sf over pp is still a forte":
    whatever number is in force, an accented note is at least `ACCENT_FLOOR`
    and at most 127. -/
theorem lift_range (inForce : Option Vel) (h : inForce ≠ some .notANumber) :
    ∃ v, lift inForce = .num v ∧ ACCENT_FLOOR ≤ v ∧ v ≤ 127 := by
  unfold lift ACCENT_FLOOR
  match inForce, h with
  | none, _ => exact ⟨_, rfl, by simp only [MF, ACCENT_LIFT]; omega⟩
  | some (.num v), _ => exact ⟨_, rfl, by omega⟩
  | some .notANumber, h => exact absurd rfl h

/-- dynamics.ts:34 "How far an accent lifts a note above the level in force":
    an accent never LOWERS a note — under the hypothesis that the level is a
    MIDI velocity (at most 127). -/
theorem lift_ge (v : Int) (hv : v ≤ 127) : ∃ w, lift (some (.num v)) = .num w ∧ v ≤ w := by
  refine ⟨_, rfl, ?_⟩
  unfold ACCENT_LIFT ACCENT_FLOOR
  omega

/-- dynamics.ts:16 "lifts only the notes struck where it stands" /
    dynamics.test.ts:21: a note no accent stands at plays the level in force,
    untouched. -/
theorem unaccented_is_level (s : St) (t : Rat) (ha : accented s.accents t = false) :
    velocityAt s t = (scan s.levels t).inForce := by
  simp [velocityAt, ha]

/-- dynamics.ts:52-53: the velocity `velocityAt` hands a note is a MIDI
    velocity, 1..127 — HOLDS ONLY UNDER A HYPOTHESIS the code does not
    enforce: every recorded level is one (`LevelsOK`; `mark_ok`, `level_ok`). -/
theorem velocityAt_range (s : St) (t : Rat) (hs : LevelsOK s) (r : Vel)
    (h : velocityAt s t = some r) : r.ok := by
  unfold velocityAt at h
  have hin : ∀ v, (scan s.levels t).inForce = some v → v.ok := by
    intro v hv
    obtain ⟨a, ha⟩ := scan_mem s.levels t v hv
    exact hs (a, v) ha
  split at h
  · exact hin r h
  · simp at h
    subst h
    cases hi : (scan s.levels t).inForce with
    | none => simp only [lift, Vel.ok, MF, ACCENT_LIFT, ACCENT_FLOOR]; omega
    | some v =>
      have hok := hin v hi
      cases v with
      | notANumber => exact absurd hok (by simp [Vel.ok])
      | num v =>
        simp only [lift, Vel.ok, ACCENT_LIFT, ACCENT_FLOOR]
        omega

/-- FAILS without it: `level` records whatever it is handed, and an unaccented
    note then plays it. `level(200, 0); velocityAt(0)` is 200.
    Repro: proofs/repro/dynamics_level_unclamped.ts. -/
theorem FAILS_velocityAt_range_without_checked_levels :
    velocityAt (level empty (.num 200) 0) 0 = some (.num 200) := by
  decide +kernel

/-- ... and with such a level an accent LOWERS the note it stands on: 200
    unaccented, 127 accented. -/
theorem FAILS_accent_lifts_without_checked_levels :
    velocityAt (mark (level empty (.num 200) 0) "sfz" 0).2 0 = some (.num 127) := by
  decide +kernel

/-! ## `fp`: forte, then piano (dynamics.ts:17, 76, 91-92) -/

/-- dynamics.ts:91-92 "an fp's own "p" sits just after its accent, so it is
    not yet in force for the accented note itself": a note that counts as
    struck where the accent stands (`|a - t| < SAME_TIME`, dynamics.ts:90) does
    not pass the in-force test (`l.at <= t + SAME_TIME`, dynamics.ts:86) for the
    level the fp recorded at `a + SAME_TIME * 2` (dynamics.ts:76). HOLDS, in
    exact arithmetic. -/
theorem fp_level_not_in_force_for_accented_note (a t : Rat)
    (h : absR (a - t) < SAME_TIME) : ¬ (a + SAME_TIME * 2 ≤ t + SAME_TIME) := by
  rw [absR_lt] at h
  grind

/-- ... and the two tolerances meet with no gap and no overlap: from the
    accent on, a note either is the accented note or already hears the "p" —
    never both, never neither. -/
theorem fp_accented_xor_piano (a t : Rat) (h : a ≤ t) :
    absR (a - t) < SAME_TIME ↔ ¬ (a + SAME_TIME * 2 ≤ t + SAME_TIME) := by
  rw [absR_lt]
  have : (0 : Rat) < SAME_TIME := by unfold SAME_TIME; grind
  grind

/-- The same for the whole function: marking an `fp` (or `sfp`, `sfpp`, `fzp`)
    at `a` does not change the level in force for any note it accents. -/
theorem fp_keeps_level_for_accented_note (s : St) (a t : Rat) (v : Vel)
    (h : absR (a - t) < SAME_TIME) :
    scan (s.levels ++ [(a + SAME_TIME * 2, v)]) t = scan s.levels t := by
  have hn := fp_level_not_in_force_for_accented_note a t h
  simp only [scan, List.foldl_append, List.foldl_cons, List.foldl_nil, scanStep]
  simp [hn]

/-- dynamics.test.ts:29 "strikes an fp forte, then holds piano", and the
    accent's floor and ceiling at work (dynamics.test.ts:21). -/
theorem fp_test :
    let s := (mark (mark empty "ff" 0).2 "fp" 1).2
    velocityAt s 1 = some (.num 127) ∧ velocityAt s 2 = some (.num 49) := by
  decide +kernel

/-- dynamics.test.ts:21 "lifts only the notes where an accent stands". -/
theorem sfz_test :
    let s := (mark (mark empty "p" 0).2 "sfz" 1).2
    velocityAt s 1 = some (.num 96) ∧ velocityAt s (3 / 2) = some (.num 49) := by
  decide +kernel

/-- dynamics.test.ts:13 "holds a level until the next, whatever order they
    were marked in". -/
theorem order_test :
    let s := (mark (mark empty "ff" 4).2 "pp" 0).2
    velocityAt s 1 = some (.num 33) ∧ velocityAt s 5 = some (.num 112) := by
  decide +kernel

/-- dynamics.test.ts:5 "leaves notes before any level without a velocity". -/
theorem before_test :
    let s := (mark empty "p" 2).2
    velocityAt s 1 = none ∧ velocityAt s 2 = some (.num 49) ∧ velocityAt s 9 = some (.num 49) := by
  decide +kernel

end Harmonicland.Dynamics
