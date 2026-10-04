/-
  PITCH — a model of `src/pitch.ts`, and what its doc comments promise.

  Self-contained: Lean core only, nothing imported from the project.
  Check with `lean proofs/Harmonicland/Pitch.lean`.

  MODELLED
    semi, isWhite, isC, octaveOf, octaveFor, whitesIn, spanOf, LOW, HIGH,
    FULL_SPAN.

  TRANSLATION NOTES
  * A `Pitch` is an `Int`. Nothing in `pitch.ts` restricts it to 0–127 or to
    the 88 keys, so neither does the model; where a theorem needs a range it
    says so as a hypothesis.
  * JS `%` is truncated remainder (`-1 % 12 === -1`), so it is `Int.tmod`,
    not Lean's `%` (which is Euclidean). `semi_eq_emod` proves the double-mod
    idiom in `semi` turns the one into the other.
  * `Math.floor(p / 12)` is modelled as the floor of an exact rational
    quotient, and `octaveOf_eq` proves it is Lean's integer division.
  * `pad` is a `Nat`. The two callers pass the literal `3` (`PAD`,
    isolated-keys.ts:41) or nothing (default 0).
  * Loops. `do a--; while (!isWhite(a))` is `downLoop`, a well-founded
    recursion whose termination proof is the fact that no two adjacent keys
    are black. The counted loops (`for i < pad`, `for p = lo; p <= hi`) are
    structural recursions on the remaining trip count.

  LEFT OUT
    Floating point, NaN, ±Infinity and non-integer pitches; the string
    functions `pitchName`, `pitchLabel`; `spell` (a record re-packing of
    `octaveFor`).
-/

namespace Harmonicland.Pitch

/-! ## Translation -/

/-- JS `a % b` on integers: truncated remainder. -/
def jsMod (a b : Int) : Int := a.tmod b

-- src/pitch.ts:21
def LOW : Int := 21
-- src/pitch.ts:22
def HIGH : Int := 108

-- src/pitch.ts:25   ((p % 12) + 12) % 12
def semi (p : Int) : Int := jsMod (jsMod p 12 + 12) 12

-- src/pitch.ts:27
def BLACK : List Int := [1, 3, 6, 8, 10]

-- src/pitch.ts:31   !BLACK.includes(semi(p))
def isWhite (p : Int) : Bool := !BLACK.contains (semi p)

-- src/pitch.ts:34
def isC (p : Int) : Bool := semi p == 0

-- src/pitch.ts:41   Math.floor(p / 12) - 1
def octaveOf (p : Int) : Int := ((p : Rat) / 12).floor - 1

-- src/types.ts:14
inductive Letter | C | D | E | F | G | A | B
  deriving DecidableEq, Repr

-- src/types.ts:18   "" | "#" | "b"
inductive Accidental | natural | sharp | flat
  deriving DecidableEq, Repr

-- src/types.ts:29
structure Spelling where
  letter : Letter
  acc : Accidental
  deriving DecidableEq, Repr

-- src/pitch.ts:57
def octaveFor (pitch : Int) (sp : Spelling) : Int :=
  let oct := octaveOf pitch
  let oct := if sp.letter = Letter.B ∧ sp.acc = Accidental.sharp then oct - 1 else oct
  let oct := if sp.letter = Letter.C ∧ sp.acc = Accidental.flat then oct + 1 else oct
  oct

-- src/pitch.ts:77
structure KeySpan where
  lo : Int
  hi : Int
  deriving DecidableEq, Repr

-- src/pitch.ts:83
def FULL_SPAN : KeySpan := { lo := LOW, hi := HIGH }

-- src/pitch.ts:88   for (let p = s.lo; p <= s.hi; p++) if (isWhite(p)) out.push(p);
-- `n` is the number of iterations still to run.
def whitesInLoop : Nat → Int → List Int → List Int
  | 0, _, out => out
  | n + 1, p, out => whitesInLoop n (p + 1) (if isWhite p then out ++ [p] else out)

-- src/pitch.ts:86
def whitesIn (s : KeySpan) : List Int :=
  whitesInLoop (s.hi + 1 - s.lo).toNat s.lo []

/-- Arithmetic fact behind both do-while loops: a black key's pitch class. -/
theorem semi_eq_emod (p : Int) : semi p = p % 12 := by
  unfold semi jsMod
  rw [Int.tmod_eq_emod, Int.tmod_eq_emod]
  split <;> split <;> omega

theorem isWhite_iff (p : Int) :
    isWhite p = true ↔
      (p % 12 ≠ 1 ∧ p % 12 ≠ 3 ∧ p % 12 ≠ 6 ∧ p % 12 ≠ 8 ∧ p % 12 ≠ 10) := by
  simp [isWhite, BLACK, semi_eq_emod]

theorem isWhite_false_iff (p : Int) :
    isWhite p = false ↔
      (p % 12 = 1 ∨ p % 12 = 3 ∨ p % 12 = 6 ∨ p % 12 = 8 ∨ p % 12 = 10) := by
  have := isWhite_iff p
  cases h : isWhite p <;> simp [h] at this ⊢ <;> omega

-- src/pitch.ts:99   do a--; while (!isWhite(a));
def downLoop (a : Int) : Int :=
  let a' := a - 1
  if isWhite a' then a' else downLoop a'
termination_by (semi (a - 1)).toNat
decreasing_by
  rename_i h
  have h' := (isWhite_false_iff (a - 1)).mp (by simpa using h)
  simp only [semi_eq_emod]
  omega

-- src/pitch.ts:100   do b++; while (!isWhite(b));
def upLoop (b : Int) : Int :=
  let b' := b + 1
  if isWhite b' then b' else upLoop b'
termination_by (12 - semi (b + 1)).toNat
decreasing_by
  rename_i h
  have h' := (isWhite_false_iff (b + 1)).mp (by simpa using h)
  simp only [semi_eq_emod]
  omega

-- src/pitch.ts:99   for (let i = 0; i < pad && a > LOW; i++) <downLoop>
-- First argument: iterations of `i` still allowed.
def padDown : Nat → Int → Int
  | 0, a => a
  | n + 1, a => if a > LOW then padDown n (downLoop a) else a

-- src/pitch.ts:100   for (let i = 0; i < pad && b < HIGH; i++) <upLoop>
def padUp : Nat → Int → Int
  | 0, b => b
  | n + 1, b => if b < HIGH then padUp n (upLoop b) else b

-- src/pitch.ts:96
def spanOf (lo hi : Int) (pad : Nat := 0) : KeySpan :=
  let a := max LOW lo
  let b := min HIGH hi
  let a := padDown pad a
  let b := padUp pad b
  let a := if !isWhite a then a - 1 else a
  let b := if !isWhite b then b + 1 else b
  { lo := a, hi := b }

/-! ## semi, isC, octaveOf, octaveFor -/

/-- pitch.ts:24 "Pitch class, 0–11, correct for negative pitches too." -/
theorem semi_range (p : Int) : 0 ≤ semi p ∧ semi p < 12 := by
  rw [semi_eq_emod]; omega

/-- pitch.ts:24: `semi` is the true (Euclidean) residue, so transposing by an
    octave never changes it — including across zero. -/
theorem semi_octave (p k : Int) : semi (p + 12 * k) = semi p := by
  simp only [semi_eq_emod]; omega

/-- `Math.floor(p / 12)` is integer floor division, for negative `p` too. -/
theorem floor_div_twelve (a : Int) : ((a : Rat) / 12).floor = a / 12 := by
  have h1 : ((a / 12 : Int) : Rat) ≤ (a : Rat) / 12 := by
    have : (12 : Int) * (a / 12) ≤ a := by omega
    have h : ((12 * (a / 12) : Int) : Rat) ≤ (a : Rat) := Rat.intCast_le_intCast.mpr this
    simp only [Rat.intCast_mul] at h
    grind
  have h2 : (a : Rat) / 12 < ((a / 12 + 1 : Int) : Rat) := by
    have : a < (12 : Int) * (a / 12 + 1) := by omega
    have h : (a : Rat) < ((12 * (a / 12 + 1) : Int) : Rat) := Rat.intCast_lt_intCast.mpr this
    simp only [Rat.intCast_mul] at h
    grind
  have := Rat.le_floor_iff.mpr h1
  have := Rat.floor_lt_iff.mpr h2
  omega

theorem octaveOf_eq (p : Int) : octaveOf p = p / 12 - 1 := by
  simp [octaveOf, floor_div_twelve]

/-- pitch.ts:39 "Scientific-pitch octave number: middle C (60) is C4." -/
theorem octaveOf_middle_C : octaveOf 60 = 4 := by
  rw [octaveOf_eq]; decide

/-- pitch.ts:43 `pitchLabel` = name + octave "What a reader calls the key":
    the pitch class and the octave number together determine the pitch, and
    every octave starts on its C (the C of octave `o` is `12 * (o + 1)`). -/
theorem pitch_eq_octave_semi (p : Int) : p = 12 * (octaveOf p + 1) + semi p := by
  rw [octaveOf_eq, semi_eq_emod]; omega

/-- pitch.ts:33 "Is this a C? The octave landmark": the octave number changes
    exactly at a C. -/
theorem octave_changes_at_C (p : Int) :
    octaveOf p ≠ octaveOf (p - 1) ↔ isC p = true := by
  simp only [octaveOf_eq, isC, semi_eq_emod, beq_iff_eq]; omega

/-- Semitones of a letter above C. Not in pitch.ts: the yardstick the
    `octaveFor` claim is measured against. -/
def letterPc : Letter → Int
  | .C => 0 | .D => 2 | .E => 4 | .F => 5 | .G => 7 | .A => 9 | .B => 11

def accShift : Accidental → Int
  | .natural => 0 | .sharp => 1 | .flat => -1

/-- pitch.ts:54 "Octave for a spelling. B♯ and C♭ cross the octave boundary:
    B♯3 is the same key as C4, and C♭4 the same as B3." -/
theorem octaveFor_Bsharp_Cflat :
    octaveFor 60 ⟨.B, .sharp⟩ = 3 ∧ octaveFor 59 ⟨.C, .flat⟩ = 4 := by
  simp only [octaveFor, octaveOf_eq]; decide

/-- pitch.ts:46 "the octave the LETTER is in": for every spelling that really
    does name the pitch, the written letter, accidental and octave give the
    pitch back. This is the general statement of which the B♯/C♭ remark is the
    two boundary cases. -/
theorem octaveFor_spells_pitch (pitch : Int) (sp : Spelling)
    (h : (letterPc sp.letter + accShift sp.acc) % 12 = pitch % 12) :
    12 * (octaveFor pitch sp + 1) + letterPc sp.letter + accShift sp.acc = pitch := by
  obtain ⟨l, a⟩ := sp
  simp only [octaveFor, octaveOf_eq]
  cases l <;> cases a <;> simp [letterPc, accShift] at h ⊢ <;> omega

/-! ## isWhite, whitesIn -/

/-- pitch.ts:193 (piano-roll) relies on, and pitch.ts:75 states the reason
    for, "no two neighbouring keys are both black". -/
theorem black_neighbours_white (p : Int) (h : isWhite p = false) :
    isWhite (p - 1) = true ∧ isWhite (p + 1) = true := by
  have := (isWhite_false_iff p).mp h
  simp only [isWhite_iff]; omega

theorem whitesInLoop_acc (n : Nat) (p : Int) (out : List Int) :
    whitesInLoop n p out = out ++ whitesInLoop n p [] := by
  induction n generalizing p out with
  | zero => simp [whitesInLoop]
  | succ n ih =>
    simp only [whitesInLoop]
    split
    · rw [ih, ih (out := [] ++ [p])]; simp
    · exact ih _ _

theorem mem_whitesInLoop (n : Nat) (p x : Int) :
    x ∈ whitesInLoop n p [] ↔ (p ≤ x ∧ x < p + n ∧ isWhite x = true) := by
  induction n generalizing p with
  | zero => simp [whitesInLoop]; omega
  | succ n ih =>
    simp only [whitesInLoop]
    rw [whitesInLoop_acc]
    by_cases hw : isWhite p = true
    · simp only [hw, ite_true, List.nil_append, List.mem_append, List.mem_singleton, ih]
      constructor
      · rintro (rfl | ⟨h1, h2, h3⟩)
        · exact ⟨by omega, by omega, hw⟩
        · exact ⟨by omega, by omega, h3⟩
      · rintro ⟨h1, h2, h3⟩
        by_cases hx : x = p
        · exact Or.inl hx
        · exact Or.inr ⟨by omega, by omega, h3⟩
    · simp only [hw, List.nil_append, List.mem_append, ih]
      constructor
      · rintro (h | ⟨h1, h2, h3⟩)
        · simp at h
        · exact ⟨by omega, by omega, h3⟩
      · rintro ⟨h1, h2, h3⟩
        by_cases hx : x = p
        · subst hx; exact absurd h3 hw
        · exact Or.inr ⟨by omega, by omega, h3⟩

theorem whitesInLoop_sorted (n : Nat) (p : Int) :
    (whitesInLoop n p []).Pairwise (· < ·) := by
  induction n generalizing p with
  | zero => simp [whitesInLoop]
  | succ n ih =>
    simp only [whitesInLoop]
    rw [whitesInLoop_acc]
    split
    · simp only [List.nil_append, List.singleton_append, List.pairwise_cons]
      refine ⟨?_, ih _⟩
      intro x hx
      have := (mem_whitesInLoop n (p + 1) x).mp hx
      omega
    · simpa using ih _

/-- pitch.ts:85 "The white keys of a span": exactly the white pitches from
    `lo` to `hi` inclusive, nothing else. -/
theorem mem_whitesIn (s : KeySpan) (x : Int) :
    x ∈ whitesIn s ↔ (s.lo ≤ x ∧ x ≤ s.hi ∧ isWhite x = true) := by
  simp only [whitesIn, mem_whitesInLoop]
  constructor <;> rintro ⟨h1, h2, h3⟩ <;> exact ⟨by omega, by omega, h3⟩

/-- pitch.ts:85 "… low to high": strictly ascending, so no key twice. -/
theorem whitesIn_ascending (s : KeySpan) : (whitesIn s).Pairwise (· < ·) :=
  whitesInLoop_sorted _ _

/-- pitch.test.ts:5 "is all 88 keys, 52 of them white, by default". -/
theorem full_span_52_whites :
    FULL_SPAN = { lo := 21, hi := 108 } ∧ (whitesIn FULL_SPAN).length = 52 := by
  decide +kernel

/-- pitch.ts:20 "The 88-key range: A0 .. C8": 88 keys, A0 and C8 by name. -/
theorem eighty_eight_keys :
    HIGH - LOW + 1 = 88 ∧ semi LOW = 9 ∧ octaveOf LOW = 0 ∧ semi HIGH = 0 ∧ octaveOf HIGH = 8 := by
  simp only [octaveOf_eq]; decide

/-! ## spanOf: the two do-while loops, in closed form -/

theorem downLoop_eq (a : Int) :
    downLoop a = if isWhite (a - 1) then a - 1 else a - 2 := by
  rw [downLoop]
  by_cases h : isWhite (a - 1) = true
  · simp [h]
  · have hb : isWhite (a - 1) = false := by simpa using h
    have hw := (black_neighbours_white (a - 1) hb).1
    rw [downLoop]
    simp [hb, hw]; omega

theorem upLoop_eq (b : Int) :
    upLoop b = if isWhite (b + 1) then b + 1 else b + 2 := by
  rw [upLoop]
  by_cases h : isWhite (b + 1) = true
  · simp [h]
  · have hb : isWhite (b + 1) = false := by simpa using h
    have hw := (black_neighbours_white (b + 1) hb).2
    rw [upLoop]
    simp [hb, hw]; omega

/-- The do-while stops on a white key, one or two keys down. -/
theorem downLoop_spec (a : Int) :
    isWhite (downLoop a) = true ∧ a - 2 ≤ downLoop a ∧ downLoop a < a ∧
      (LOW < a → LOW ≤ downLoop a) := by
  rw [downLoop_eq]
  by_cases h : isWhite (a - 1) = true
  · simp [h, LOW]; omega
  · have hb : isWhite (a - 1) = false := by simpa using h
    have hw := (black_neighbours_white (a - 1) hb).1
    have hm := (isWhite_false_iff (a - 1)).mp hb
    have e : a - 1 - 1 = a - 2 := by omega
    rw [e] at hw
    simp [hb, hw, LOW]; omega

theorem upLoop_spec (b : Int) :
    isWhite (upLoop b) = true ∧ upLoop b ≤ b + 2 ∧ b < upLoop b ∧
      (b < HIGH → upLoop b ≤ HIGH) := by
  rw [upLoop_eq]
  by_cases h : isWhite (b + 1) = true
  · simp [h, HIGH]; omega
  · have hb : isWhite (b + 1) = false := by simpa using h
    have hw := (black_neighbours_white (b + 1) hb).2
    have hm := (isWhite_false_iff (b + 1)).mp hb
    have e : b + 1 + 1 = b + 2 := by omega
    rw [e] at hw
    simp [hb, hw, HIGH]; omega

theorem padDown_spec (n : Nat) (a : Int) (ha : LOW ≤ a) :
    LOW ≤ padDown n a ∧ padDown n a ≤ a ∧
      (padDown n a = a ∨ isWhite (padDown n a) = true) := by
  induction n generalizing a with
  | zero => simp [padDown, ha]
  | succ n ih =>
    simp only [padDown]
    split
    · rename_i h
      have s := downLoop_spec a
      have i := ih (downLoop a) (s.2.2.2 h)
      refine ⟨i.1, by omega, ?_⟩
      rcases i.2.2 with e | w
      · right; rw [e]; exact s.1
      · right; exact w
    · simp [ha]

theorem padUp_spec (n : Nat) (b : Int) (hb : b ≤ HIGH) :
    padUp n b ≤ HIGH ∧ b ≤ padUp n b ∧
      (padUp n b = b ∨ isWhite (padUp n b) = true) := by
  induction n generalizing b with
  | zero => simp [padUp, hb]
  | succ n ih =>
    simp only [padUp]
    split
    · rename_i h
      have s := upLoop_spec b
      have i := ih (upLoop b) (s.2.2.2 h)
      refine ⟨i.1, by omega, ?_⟩
      rcases i.2.2 with e | w
      · right; rw [e]; exact s.1
      · right; exact w
    · simp [hb]

/-! ## spanOf: what holds for every input -/

/-- pitch.ts:75 (KeySpan) "Both ends are WHITE keys", pitch.test.ts:10 "ends on
    white keys, rounding a black end outward". Holds for EVERY integer `lo`,
    `hi` and `pad`, in range or not. -/
theorem spanOf_ends_white (lo hi : Int) (pad : Nat) :
    isWhite (spanOf lo hi pad).lo = true ∧ isWhite (spanOf lo hi pad).hi = true := by
  simp only [spanOf]
  constructor
  · by_cases h : isWhite (padDown pad (max LOW lo)) = true
    · simp [h]
    · have hb : isWhite (padDown pad (max LOW lo)) = false := by simpa using h
      simp [hb, (black_neighbours_white _ hb).1]
  · by_cases h : isWhite (padUp pad (min HIGH hi)) = true
    · simp [h]
    · have hb : isWhite (padUp pad (min HIGH hi)) = false := by simpa using h
      simp [hb, (black_neighbours_white _ hb).2]

/-- pitch.ts:94 "clamped to the 88" — the half of it that needs no
    hypothesis: the low end never goes below A0 and the high end never above
    C8, whatever is passed in. -/
theorem spanOf_outer_clamp (lo hi : Int) (pad : Nat) :
    LOW ≤ (spanOf lo hi pad).lo ∧ (spanOf lo hi pad).hi ≤ HIGH := by
  have ha : LOW ≤ max LOW lo := by omega
  have hb : min HIGH hi ≤ HIGH := by omega
  obtain ⟨sa, _, _⟩ := padDown_spec pad (max LOW lo) ha
  obtain ⟨sb, _, _⟩ := padUp_spec pad (min HIGH hi) hb
  simp only [spanOf]
  constructor
  · by_cases h : isWhite (padDown pad (max LOW lo)) = true
    · simp [h]; exact sa
    · have hbk : isWhite (padDown pad (max LOW lo)) = false := by simpa using h
      have hm := (isWhite_false_iff _).mp hbk
      simp only [hbk, Bool.not_false, ite_true]
      simp only [LOW] at sa hm ⊢; omega
  · by_cases h : isWhite (padUp pad (min HIGH hi)) = true
    · simp [h]; exact sb
    · have hbk : isWhite (padUp pad (min HIGH hi)) = false := by simpa using h
      have hm := (isWhite_false_iff _).mp hbk
      simp only [hbk, Bool.not_false, ite_true]
      simp only [HIGH] at sb hm ⊢; omega

/-- pitch.ts:92 "The span that holds every key from `lo` to `hi`" and
    pitch.ts:94 "clamped to the 88".

    HYPOTHESES THE CODE DOES NOT ENFORCE: `lo ≤ HIGH` and `LOW ≤ hi` — the
    requested stretch must overlap the 88 keys. (`lo ≤ hi` is enforced by the
    one caller, isolated-keys.ts:67.) With them, the result is a real span
    inside the 88 that contains every requested key the piano has. -/
theorem spanOf_contains_and_clamped (lo hi : Int) (pad : Nat)
    (hlh : lo ≤ hi) (hlo : lo ≤ HIGH) (hhi : LOW ≤ hi) :
    LOW ≤ (spanOf lo hi pad).lo ∧
    (spanOf lo hi pad).lo ≤ max LOW lo ∧
    min HIGH hi ≤ (spanOf lo hi pad).hi ∧
    (spanOf lo hi pad).hi ≤ HIGH ∧
    (spanOf lo hi pad).lo ≤ (spanOf lo hi pad).hi := by
  have oc := spanOf_outer_clamp lo hi pad
  have ha : LOW ≤ max LOW lo := by omega
  have hb : min HIGH hi ≤ HIGH := by omega
  obtain ⟨_, sa, _⟩ := padDown_spec pad (max LOW lo) ha
  obtain ⟨_, sb, _⟩ := padUp_spec pad (min HIGH hi) hb
  have h1 : (spanOf lo hi pad).lo ≤ max LOW lo := by
    simp only [spanOf]; split <;> omega
  have h2 : min HIGH hi ≤ (spanOf lo hi pad).hi := by
    simp only [spanOf]; split <;> omega
  refine ⟨oc.1, h1, h2, oc.2, ?_⟩
  simp only [LOW, HIGH] at *
  omega

/-- The same, for a request wholly inside the 88: every requested key is in
    the span. -/
theorem spanOf_contains (lo hi : Int) (pad : Nat)
    (hlh : lo ≤ hi) (hlo : LOW ≤ lo) (hhi : hi ≤ HIGH) :
    (spanOf lo hi pad).lo ≤ lo ∧ hi ≤ (spanOf lo hi pad).hi := by
  have h := spanOf_contains_and_clamped lo hi pad hlh (by omega) (by omega)
  simp only [LOW, HIGH] at *
  omega

/-! ## spanOf: where "clamped to the 88" fails

  Without the overlap hypotheses the result is not a span of the keyboard at
  all. Repro: `proofs/repro/pitch_spanOf_outside_88.ts`. -/

/-- A closed-form twin of `spanOf` that the kernel can evaluate (`downLoop` is
    a well-founded recursion, which `decide` cannot unfold). -/
def padDown' : Nat → Int → Int
  | 0, a => a
  | n + 1, a => if a > LOW then padDown' n (if isWhite (a - 1) then a - 1 else a - 2) else a

def padUp' : Nat → Int → Int
  | 0, b => b
  | n + 1, b => if b < HIGH then padUp' n (if isWhite (b + 1) then b + 1 else b + 2) else b

def spanOf' (lo hi : Int) (pad : Nat) : KeySpan :=
  let a := padDown' pad (max LOW lo)
  let b := padUp' pad (min HIGH hi)
  { lo := if !isWhite a then a - 1 else a, hi := if !isWhite b then b + 1 else b }

theorem padDown_eq (n : Nat) (a : Int) : padDown n a = padDown' n a := by
  induction n generalizing a with
  | zero => rfl
  | succ n ih => simp only [padDown, padDown', downLoop_eq, ih]

theorem padUp_eq (n : Nat) (b : Int) : padUp n b = padUp' n b := by
  induction n generalizing b with
  | zero => rfl
  | succ n ih => simp only [padUp, padUp', upLoop_eq, ih]

theorem spanOf_eq (lo hi : Int) (pad : Nat) : spanOf lo hi pad = spanOf' lo hi pad := by
  simp only [spanOf, spanOf', padDown_eq, padUp_eq]

/-- pitch.test.ts:10–24: the five worked examples in the test file. -/
theorem spanOf_test_examples :
    spanOf 60 64 = ⟨60, 64⟩ ∧ spanOf 61 66 = ⟨60, 67⟩ ∧
    spanOf 64 67 3 = ⟨59, 72⟩ ∧ spanOf 61 66 3 = ⟨57, 71⟩ ∧
    spanOf 22 108 3 = ⟨21, 108⟩ := by
  simp only [spanOf_eq]; decide

/-- FAILS: pitch.ts:94 "clamped to the 88", pitch.ts:74 "every key from `lo`
    to `hi`, inclusive".

    A stretch wholly ABOVE C8: `spanOf(120, 120, 3)` is `{lo: 115, hi: 108}`.
    The low end is seven keys past the top of the piano and above the high
    end, so the "span" is empty and has no white keys. -/
theorem FAILS_spanOf_clamped_above :
    spanOf 120 120 3 = ⟨115, 108⟩ ∧
    ¬ ((spanOf 120 120 3).lo ≤ HIGH) ∧
    ¬ ((spanOf 120 120 3).lo ≤ (spanOf 120 120 3).hi) ∧
    whitesIn (spanOf 120 120 3) = [] := by
  simp only [spanOf_eq]; decide

/-- FAILS: the mirror image, wholly BELOW A0: `spanOf(10, 10, 3)` is
    `{lo: 21, hi: 14}` — the high end is below the bottom of the piano. -/
theorem FAILS_spanOf_clamped_below :
    spanOf 10 10 3 = ⟨21, 14⟩ ∧
    ¬ (LOW ≤ (spanOf 10 10 3).hi) ∧
    ¬ ((spanOf 10 10 3).lo ≤ (spanOf 10 10 3).hi) ∧
    whitesIn (spanOf 10 10 3) = [] := by
  simp only [spanOf_eq]; decide

/-! ## spanOf: the padding count -/

/-- How many of the `n` keys `x, x+1, …, x+n-1` are white. -/
def countWhites (x : Int) : Nat → Nat
  | 0 => 0
  | n + 1 => (if isWhite x then 1 else 0) + countWhites (x + 1) n

theorem countWhites_eq_loop (x : Int) (n : Nat) :
    countWhites x n = (whitesInLoop n x []).length := by
  induction n generalizing x with
  | zero => rfl
  | succ n ih =>
    simp only [countWhites, whitesInLoop]
    rw [whitesInLoop_acc, ih]
    split <;> simp <;> omega

/-- `countWhites` counts what `whitesIn` lists. -/
theorem countWhites_eq_whitesIn (x : Int) (n : Nat) :
    countWhites x n = (whitesIn ⟨x, x + n - 1⟩).length := by
  have e : (x + ↑n - 1 + 1 - x).toNat = n := by omega
  simp only [whitesIn, e, countWhites_eq_loop]

/-- How many whites the pad should add on one side: `pad`, except that a black
    end "rounds outward" to its own white even when `pad` is 0, and never more
    than the keyboard has. -/
def wantPad (pad : Nat) (endKey : Int) (available : Nat) : Nat :=
  min (max pad (if isWhite endKey then 0 else 1)) available

/-- pitch.ts:92 "`pad` white keys more beyond each end — rounded outward to a
    white key where it would otherwise stop on a black one, and clamped to the
    88, so a pad past A0 or C8 is only as wide as there is keyboard", and
    pitch.test.ts:15 "pads by white keys beyond the notes, a black end's own
    white counting as one".

    For the key `k = 21 + i`: the whites from the span's low end up to (not
    including) `k`, and the whites above `k` up to the span's high end, each
    number exactly `wantPad`. Checked exhaustively for every key of the 88 and
    every `pad` from 0 to 7. The only caller passes 3 (isolated-keys.ts:41)
    and the default is 0; larger pads are not covered by this theorem (the
    kernel check grows too expensive), only by the general theorems above. -/
theorem spanOf_pad_count :
    ∀ pad : Fin 8, ∀ i : Fin 88,
      let k : Int := 21 + i.val
      let s := spanOf' k k pad.val
      countWhites s.lo (k - s.lo).toNat = wantPad pad.val k (countWhites LOW i.val) ∧
      countWhites (k + 1) (s.hi - k).toNat
        = wantPad pad.val k (countWhites (k + 1) (87 - i.val)) := by
  decide +kernel

/-- Each end of the span depends only on its own argument, which is what lets
    `spanOf_pad_count` speak about one key at a time. -/
theorem spanOf_ends_independent (lo hi : Int) (pad : Nat) :
    (spanOf lo hi pad).lo = (spanOf lo lo pad).lo ∧
    (spanOf lo hi pad).hi = (spanOf hi hi pad).hi := ⟨rfl, rfl⟩

end Harmonicland.Pitch
