/-
  PERFECTO — a model of `src/harmony/perfecto.ts`: the scale and joystick
  tables, degreeOffsetOf, degreeQuality, chordIntervals and computeVoicing.

  Self-contained: Lean core only, nothing imported from the project.
  Check with `lean proofs/Harmonicland/Perfecto.lean`.

  TRANSLATION NOTES
  * Pitches, intervals, octaves and costs are `Int`. `Key.root` is an `Int`;
    the TypeScript type is the enum `PitchClass` (0..11), and theorems that
    need that range take it as the hypothesis `0 ≤ root ∧ root ≤ 11`.
  * `Degree` (the literal type `1 | … | 7`) is a seven-constructor inductive;
    `Degree.num` gives the number and `degreeIndex d = d - 1` as in the source.
  * `Record<…, number[]>` tables are total functions to `List Int`, so a table
    lookup cannot miss. ARRAY indexing (`scale[i]`) is `List.getD _ i 0`; the
    default `0` stands for JS `undefined` and `index_in_bounds` proves it is
    never used.
  * `Math.floor(a / n)` is the floor of an exact rational quotient
    (`jsFloorDiv`), not Lean's integer division.
  * `xs.sort((x, y) => x - y)` is `List.mergeSort` with `≤` (`jsSort`): a
    stable sort, as `Array.prototype.sort` is. `jsSort_eq_isort` proves it
    equal to an insertion sort the kernel can evaluate, which is how the
    concrete examples are checked.
  * `r[0] += 12` / `r[1] += 12` are `bumpFirst` / `bumpSecond`. They are only
    reached when `notes.length >= 2`, as in the source.
  * `Math.min(...ref.map(...))` is `jsMin`. For an empty list JS gives
    `Infinity`; `jsMin [] = 0` is a placeholder that is never reached, because
    the voice-leading branch is guarded by `previousVoicing.notes.length > 0`.
  * `previousVoicing?: Voicing | null` is `Option (List Int)` (the notes).
  * `for (const shift of [-1, 1])` is a `foldl` over `[-1, 1]` carrying
    `(best, bestCost)`.

  LEFT OUT
    Floating point; every display string (chordSymbol, chordName,
    degreeNumeral, labels, colours); `Voicing.bassNote` ("reserved, unused").
-/

namespace Harmonicland.Perfecto

/-! ## JavaScript primitives -/

/-- JS `xs.sort((x, y) => x - y)` on integers. -/
def jsSort (l : List Int) : List Int := l.mergeSort (fun a b => decide (a ≤ b))

/-- JS `Math.floor(a / n)` for non-negative integers `a`, `n`. -/
def jsFloorDiv (a n : Nat) : Int := ((a : Rat) / (n : Rat)).floor

/-- JS `Math.abs`. -/
def jsAbs (x : Int) : Int := if x < 0 then -x else x

/-- JS `Math.min(...xs)` for a non-empty list (see the header for `[]`). -/
def jsMin : List Int → Int
  | [] => 0
  | x :: xs => xs.foldl min x

/-! ## Translation: tables -/

-- src/harmony/perfecto.ts:33
inductive ScaleType
  | major | naturalMinor | harmonicMinor | melodicMinor
  | majorPentatonic | minorPentatonic | blues
  | dorian | mixolydian | lydian
  deriving DecidableEq, Repr

-- src/harmony/perfecto.ts:38
def SCALE_INTERVALS : ScaleType → List Int
  | .major           => [0, 2, 4, 5, 7, 9, 11]
  | .naturalMinor    => [0, 2, 3, 5, 7, 8, 10]
  | .harmonicMinor   => [0, 2, 3, 5, 7, 8, 11]
  | .melodicMinor    => [0, 2, 3, 5, 7, 9, 11]
  | .majorPentatonic => [0, 2, 4, 7, 9]
  | .minorPentatonic => [0, 3, 5, 7, 10]
  | .blues           => [0, 3, 5, 6, 7, 10]
  | .dorian          => [0, 2, 3, 5, 7, 9, 10]
  | .mixolydian      => [0, 2, 4, 5, 7, 9, 10]
  | .lydian          => [0, 2, 4, 6, 7, 9, 11]

-- src/harmony/perfecto.ts:59
structure Key where
  root : Int
  scale : ScaleType
  deriving DecidableEq, Repr

-- src/harmony/perfecto.ts:66   1 | 2 | 3 | 4 | 5 | 6 | 7
inductive Degree | d1 | d2 | d3 | d4 | d5 | d6 | d7
  deriving DecidableEq, Repr

def Degree.num : Degree → Nat
  | .d1 => 1 | .d2 => 2 | .d3 => 3 | .d4 => 4 | .d5 => 5 | .d6 => 6 | .d7 => 7

-- src/harmony/perfecto.ts:67
def degreeIndex (d : Degree) : Nat := d.num - 1

-- src/harmony/perfecto.ts:70
inductive JoystickMode | default | extended | chromatic
  deriving DecidableEq, Repr

-- src/harmony/perfecto.ts:71
inductive JoystickDirection
  | center | up | upRight | right | downRight | down | downLeft | left | upLeft
  deriving DecidableEq, Repr

-- src/harmony/perfecto.ts:76
structure JoystickOutcome where
  major : List Int
  minor : List Int
  dim : List Int
  deriving DecidableEq, Repr

-- src/harmony/perfecto.ts:82
def base : JoystickOutcome := { major := [0, 4, 7], minor := [0, 3, 7], dim := [0, 3, 6] }

-- src/harmony/perfecto.ts:84
def JOYSTICK_TABLES : JoystickMode → JoystickDirection → JoystickOutcome
  | .default, .center    => base
  | .default, .up        => { major := [0, 3, 7],     minor := [0, 4, 7],     dim := [0, 4, 7] }
  | .default, .upRight   => { major := [0, 4, 7, 10], minor := [0, 3, 7, 10], dim := [0, 3, 6, 10] }
  | .default, .right     => { major := [0, 4, 7, 11], minor := [0, 3, 7, 10], dim := [0, 3, 6, 10] }
  | .default, .downRight => { major := [0, 4, 7, 14], minor := [0, 3, 7, 14], dim := [0, 3, 6, 14] }
  | .default, .down      => { major := [0, 5, 7],     minor := [0, 5, 7],     dim := [0, 5, 7] }
  | .default, .downLeft  => { major := [0, 4, 7, 9],  minor := [0, 2, 7],     dim := [0, 2, 6] }
  | .default, .left      => { major := [0, 3, 7],     minor := [0, 3, 6],     dim := [0, 3, 6] }
  | .default, .upLeft    => { major := [0, 4, 8],     minor := [0, 3, 8],     dim := [0, 3, 7] }
  | .extended, .center    => base
  | .extended, .up        => { major := [0, 3, 7],         minor := [0, 4, 7],         dim := [0, 4, 7] }
  | .extended, .upRight   => { major := [0, 4, 7, 10, 14], minor := [0, 3, 7, 10, 14], dim := [0, 3, 6, 10, 14] }
  | .extended, .right     => { major := [0, 4, 7, 17],     minor := [0, 3, 7, 17],     dim := [0, 3, 6, 17] }
  | .extended, .downRight => { major := [0, 3, 7, 10, 17], minor := [0, 3, 7, 10, 17], dim := [0, 3, 7, 10, 17] }
  | .extended, .down      => { major := [0, 4, 7, 10, 15], minor := [0, 3, 7, 10, 15], dim := [0, 3, 6, 10, 15] }
  | .extended, .downLeft  => { major := [0, 4, 7, 14],     minor := [0, 3, 7, 14],     dim := [0, 3, 6, 14] }
  | .extended, .left      => { major := [0, 5, 7, 10],     minor := [0, 5, 7, 10],     dim := [0, 5, 7, 10] }
  | .extended, .upLeft    => { major := [0, 3, 6, 10],     minor := [0, 3, 6, 10],     dim := [0, 3, 6, 10] }
  | .chromatic, .center    => base
  | .chromatic, .up        => { major := [0, 3, 7, 11],         minor := [0, 3, 7, 11],         dim := [0, 3, 7, 11] }
  | .chromatic, .upRight   => { major := [0, 4, 7, 10, 14, 21], minor := [0, 4, 7, 10, 14, 21], dim := [0, 4, 7, 10, 14, 21] }
  | .chromatic, .right     => { major := [0, 4, 7, 9, 14],      minor := [0, 3, 7, 9, 14],      dim := [0, 3, 6, 9, 14] }
  | .chromatic, .downRight => { major := [0, 4, 8, 10, 15],     minor := [0, 4, 8, 10, 15],     dim := [0, 4, 8, 10, 15] }
  | .chromatic, .down      => { major := [0, 4, 7, 11, 14, 21], minor := [0, 4, 7, 11, 14, 21], dim := [0, 4, 7, 11, 14, 21] }
  | .chromatic, .downLeft  => { major := [0, 4, 7, 10, 13],     minor := [0, 3, 7, 10, 13],     dim := [0, 3, 6, 10, 13] }
  | .chromatic, .left      => { major := [0, 3, 6, 10],         minor := [0, 3, 6, 10],         dim := [0, 3, 6, 10] }
  | .chromatic, .upLeft    => { major := [0, 4, 7, 11, 18],     minor := [0, 4, 7, 11, 18],     dim := [0, 4, 7, 11, 18] }

-- src/harmony/perfecto.ts:121
inductive Inversion | root | first | second
  deriving DecidableEq, Repr

-- src/harmony/perfecto.ts:139
inductive ChordQuality | maj | min | dim
  deriving DecidableEq, Repr

/-! ## Translation: functions -/

-- src/harmony/perfecto.ts:151
def degreeOffsetOf (key : Key) (degree : Degree) : Int :=
  let scale := SCALE_INTERVALS key.scale
  let n := scale.length
  let degIdx := degreeIndex degree
  scale.getD (degIdx % n) 0 + jsFloorDiv degIdx n * 12

-- src/harmony/perfecto.ts:158
def degreeQuality (key : Key) (degree : Degree) : ChordQuality :=
  let scale := SCALE_INTERVALS key.scale
  let n := scale.length
  let degIdx := degreeIndex degree
  let degreeOffset := degreeOffsetOf key degree
  let thirdSteps := degIdx + 2
  let fifthSteps := degIdx + 4
  let thirdAbs := scale.getD (thirdSteps % n) 0 + jsFloorDiv thirdSteps n * 12
  let fifthAbs := scale.getD (fifthSteps % n) 0 + jsFloorDiv fifthSteps n * 12
  let isMinor : Bool := decide (thirdAbs - degreeOffset < 4)
  let isDim : Bool := isMinor && decide (fifthAbs - degreeOffset < 7)
  if isDim then .dim else if isMinor then .min else .maj

-- src/harmony/perfecto.ts:176
def chordIntervals (key : Key) (degree : Degree) (mode : JoystickMode)
    (direction : JoystickDirection) : List Int :=
  let outcome := JOYSTICK_TABLES mode direction
  let quality := degreeQuality key degree
  if quality = .dim then outcome.dim else if quality = .min then outcome.minor else outcome.major

-- src/harmony/perfecto.ts:128
structure ComputeVoicingArgs where
  key : Key
  degree : Degree
  joystickMode : JoystickMode
  joystickDirection : JoystickDirection
  inversion : Inversion
  octave : Int
  voiceLeading : Bool
  previousVoicing : Option (List Int)

-- src/harmony/perfecto.ts:190   ivls.map((i) => chordRoot + i + octaveShift * 12).sort(...)
def build (chordRoot : Int) (ivls : List Int) (octaveShift : Int) : List Int :=
  jsSort (ivls.map (fun i => chordRoot + i + octaveShift * 12))

-- src/harmony/perfecto.ts:196   r[0] += 12
def bumpFirst : List Int → List Int
  | a :: rest => (a + 12) :: rest
  | [] => []

-- src/harmony/perfecto.ts:197   r[1] += 12
def bumpSecond : List Int → List Int
  | a :: b :: rest => a :: (b + 12) :: rest
  | l => l

-- src/harmony/perfecto.ts:193
def applyInversion (notes : List Int) (inv : Inversion) : List Int :=
  if notes.length < 2 then notes
  else
    let r := jsSort notes
    let r :=
      if inv = .first then bumpFirst r
      else if inv = .second then bumpSecond (bumpFirst r)
      else r
    jsSort r

-- src/harmony/perfecto.ts:201
def cost (cand ref : List Int) : Int :=
  cand.foldl (fun sum note => sum + jsMin (ref.map (fun r => jsAbs (note - r)))) 0

-- src/harmony/perfecto.ts:184
def computeVoicing (a : ComputeVoicingArgs) : List Int :=
  let degreeOffset := degreeOffsetOf a.key a.degree
  let intervals := chordIntervals a.key a.degree a.joystickMode a.joystickDirection
  let chordRoot := a.key.root + (a.octave + 1) * 12 + degreeOffset
  match a.previousVoicing with
  | some prev =>
    if a.voiceLeading = true ∧ prev.length > 0 then
      let best := applyInversion (build chordRoot intervals 0) a.inversion
      let bestCost := cost best prev
      let step := fun (acc : List Int × Int) (shift : Int) =>
        let cand := applyInversion (build chordRoot intervals shift) a.inversion
        let c := cost cand prev
        if c < acc.2 then (cand, c) else acc
      ([-1, 1].foldl step (best, bestCost)).1
    else applyInversion (build chordRoot intervals 0) a.inversion
  | none => applyInversion (build chordRoot intervals 0) a.inversion

/-! ## Names for the pieces of `computeVoicing`, for stating theorems -/

/-- perfecto.ts:188 `chordRoot`. -/
def chordRootOf (a : ComputeVoicingArgs) : Int :=
  a.key.root + (a.octave + 1) * 12 + degreeOffsetOf a.key a.degree

/-- perfecto.ts:186 `intervals`. -/
def intervalsOf (a : ComputeVoicingArgs) : List Int :=
  chordIntervals a.key a.degree a.joystickMode a.joystickDirection

/-- perfecto.ts:213/216: the candidate voicing at an octave shift. -/
def cand (a : ComputeVoicingArgs) (shift : Int) : List Int :=
  applyInversion (build (chordRootOf a) (intervalsOf a) shift) a.inversion

/-- perfecto.ts:211: is the voice-leading branch taken, and against what? -/
def leadingFrom (a : ComputeVoicingArgs) : Option (List Int) :=
  match a.previousVoicing with
  | some prev => if a.voiceLeading = true ∧ prev.length > 0 then some prev else none
  | none => none

/-! ## Sorting lemmas -/

theorem mem_jsSort {p : Int} {l : List Int} : p ∈ jsSort l ↔ p ∈ l := List.mem_mergeSort

theorem jsSort_sorted (l : List Int) : (jsSort l).Pairwise (· ≤ ·) := by
  have h := List.pairwise_mergeSort (le := fun a b : Int => decide (a ≤ b))
    (by intro a b c; simp; omega) (by intro a b; simp; omega) l
  simpa [jsSort] using h

theorem jsSort_of_sorted {l : List Int} (h : l.Pairwise (· ≤ ·)) : jsSort l = l := by
  unfold jsSort
  apply List.mergeSort_of_pairwise
  simpa using h

theorem jsSort_length (l : List Int) : (jsSort l).length = l.length := List.length_mergeSort l

/-- Sorting commutes with transposition. -/
theorem jsSort_map_add (l : List Int) (k : Int) :
    jsSort (l.map (· + k)) = (jsSort l).map (· + k) := by
  unfold jsSort
  rw [List.map_mergeSort (s := fun a b => decide (a ≤ b))]
  intro a _ b _
  simp

/-- An insertion sort the kernel can evaluate (a proof device only). -/
def insertSorted (x : Int) : List Int → List Int
  | [] => [x]
  | y :: ys => if x ≤ y then x :: y :: ys else y :: insertSorted x ys

def isort : List Int → List Int
  | [] => []
  | x :: xs => insertSorted x (isort xs)

theorem insertSorted_perm (x : Int) (l : List Int) : (insertSorted x l).Perm (x :: l) := by
  induction l with
  | nil => simp [insertSorted]
  | cons y ys ih =>
    simp only [insertSorted]
    split
    · exact List.Perm.refl _
    · exact (List.Perm.cons y ih).trans (List.Perm.swap x y ys)

theorem isort_perm (l : List Int) : (isort l).Perm l := by
  induction l with
  | nil => exact List.Perm.refl _
  | cons x xs ih => exact (insertSorted_perm x _).trans (List.Perm.cons x ih)

theorem insertSorted_sorted (x : Int) (l : List Int) (h : l.Pairwise (· ≤ ·)) :
    (insertSorted x l).Pairwise (· ≤ ·) := by
  induction l with
  | nil => simp [insertSorted]
  | cons y ys ih =>
    simp only [insertSorted]
    split
    · rename_i hxy
      rw [List.pairwise_cons] at h ⊢
      refine ⟨?_, List.pairwise_cons.mpr h⟩
      intro z hz
      rcases List.mem_cons.mp hz with rfl | hz
      · exact hxy
      · have := h.1 z hz; omega
    · rename_i hxy
      rw [List.pairwise_cons] at h ⊢
      refine ⟨?_, ih h.2⟩
      intro z hz
      rcases List.mem_cons.mp ((insertSorted_perm x ys).mem_iff.mp hz) with rfl | hz
      · omega
      · exact h.1 z hz

theorem isort_sorted (l : List Int) : (isort l).Pairwise (· ≤ ·) := by
  induction l with
  | nil => simp [isort]
  | cons x xs ih => exact insertSorted_sorted x _ ih

/-- `jsSort` is the insertion sort: on integers a sorted permutation is unique. -/
theorem jsSort_eq_isort (l : List Int) : jsSort l = isort l := by
  apply List.Perm.eq_of_pairwise (le := fun a b : Int => a ≤ b)
  · intro a b _ _ h1 h2; omega
  · exact jsSort_sorted l
  · exact isort_sorted l
  · exact (List.mergeSort_perm l _).trans (isort_perm l).symm

/-! ## The tables -/

/-- perfecto.ts:15 "For 5–6 note scales (pentatonic, blues)…": every scale is
    strictly ascending pitch classes starting on the tonic, with 5, 6 or 7
    notes. -/
theorem scale_tables (s : ScaleType) :
    (SCALE_INTERVALS s).Pairwise (· < ·) ∧ (SCALE_INTERVALS s).head? = some 0 ∧
    (∀ x ∈ SCALE_INTERVALS s, 0 ≤ x ∧ x < 12) ∧
    5 ≤ (SCALE_INTERVALS s).length ∧ (SCALE_INTERVALS s).length ≤ 7 := by
  cases s <;> decide

/-- Array indexing never goes out of bounds: perfecto.ts:155, 165, 166 index
    `scale` at `degIdx % n`, `thirdSteps % n`, `fifthSteps % n`. (The joystick
    and scale tables themselves are `Record`s over closed key types, total by
    construction.) -/
theorem index_in_bounds (s : ScaleType) (d : Degree) :
    let n := (SCALE_INTERVALS s).length
    degreeIndex d % n < n ∧ (degreeIndex d + 2) % n < n ∧ (degreeIndex d + 4) % n < n := by
  cases s <;> cases d <;> decide

/-- What a joystick interval list must look like for `computeVoicing` to
    behave: strictly ascending (so `build`'s sort is a no-op and no interval
    repeats), root first, at least a triad (so `applyInversion`'s
    `notes.length < 2` guard never fires and `r[1]` exists), nothing above a
    13th (21 semitones), and a second note low enough that raising it an
    octave stays within that. -/
def OkIvls (l : List Int) : Prop :=
  l.Pairwise (· < ·) ∧ l.getD 0 1 = 0 ∧ l.getD 1 99 ≤ 9 ∧ 3 ≤ l.length ∧ l.length ≤ 6 ∧
    ∀ x ∈ l, 0 ≤ x ∧ x ≤ 21

instance (l : List Int) : Decidable (OkIvls l) := by unfold OkIvls; infer_instance

theorem joystick_tables_ok (m : JoystickMode) (d : JoystickDirection) :
    OkIvls (JOYSTICK_TABLES m d).major ∧ OkIvls (JOYSTICK_TABLES m d).minor ∧
    OkIvls (JOYSTICK_TABLES m d).dim := by
  cases m <;> cases d <;> decide

theorem chordIntervals_ok (key : Key) (degree : Degree) (m : JoystickMode)
    (d : JoystickDirection) : OkIvls (chordIntervals key degree m d) := by
  have h := joystick_tables_ok m d
  simp only [chordIntervals]
  split
  · exact h.2.2
  · split
    · exact h.2.1
    · exact h.1

/-! ## degreeOffsetOf and the short-scale wrap -/

/-- perfecto.ts:145 "The chord root's semitone offset above the KEY root":
    never negative, and at most 15 (the 7th "degree" of a minor pentatonic is
    its 2nd note an octave up). -/
theorem degreeOffsetOf_range (key : Key) (d : Degree) :
    0 ≤ degreeOffsetOf key d ∧ degreeOffsetOf key d ≤ 15 := by
  obtain ⟨root, s⟩ := key
  simp only [degreeOffsetOf]
  cases s <;> cases d <;> decide +kernel

/-- For a seven-note scale there is no wrap: the offset is the scale tone. -/
theorem degreeOffsetOf_seven (key : Key) (d : Degree) (h : (SCALE_INTERVALS key.scale).length = 7) :
    degreeOffsetOf key d = (SCALE_INTERVALS key.scale).getD (degreeIndex d) 0 := by
  obtain ⟨root, s⟩ := key
  simp only [degreeOffsetOf]
  cases s <;> cases d <;> first | (simp [SCALE_INTERVALS] at h; done) | decide +kernel

/-- progression.ts:135 "The octave-wrap `degreeOffsetOf` carries for short
    scales is a multiple of 12 and falls out here": mod 12, the offset is
    always a tone of the scale. -/
theorem degreeOffsetOf_is_scale_tone (key : Key) (d : Degree) :
    (degreeOffsetOf key d) % 12 ∈ SCALE_INTERVALS key.scale := by
  obtain ⟨root, s⟩ := key
  simp only [degreeOffsetOf]
  cases s <;> cases d <;> decide +kernel

/-- perfecto.ts:15 "Short-scale wrapping is structural … the
    `% n + floor(.../n)*12` octave-add keeps thirds stacking": in every scale
    and on every degree the root, third and fifth the quality rule looks at
    are strictly ascending — the wrap never lets a "third" fall below its
    root. -/
theorem thirds_keep_stacking (s : ScaleType) (d : Degree) :
    let scale := SCALE_INTERVALS s
    let n := scale.length
    let i := degreeIndex d
    let root := scale.getD (i % n) 0 + jsFloorDiv i n * 12
    let third := scale.getD ((i + 2) % n) 0 + jsFloorDiv (i + 2) n * 12
    let fifth := scale.getD ((i + 4) % n) 0 + jsFloorDiv (i + 4) n * 12
    root < third ∧ third < fifth := by
  cases s <;> cases d <;> decide +kernel

/-- perfecto.test.ts:64 "wraps the chord ROOT itself into the next octave for
    high degrees": degree 6 of a 5-note scale is its tonic, an octave up. -/
theorem pentatonic_degree_six_wraps :
    degreeOffsetOf ⟨0, .majorPentatonic⟩ .d6 = 12 := by decide +kernel

/-! ## degreeQuality -/

/-- Quality depends on the scale and the degree, never on the key's root. -/
theorem quality_root_independent (r r' : Int) (s : ScaleType) (d : Degree) :
    degreeQuality ⟨r, s⟩ d = degreeQuality ⟨r', s⟩ d := rfl

theorem chordIntervals_root_independent (r r' : Int) (s : ScaleType) (d : Degree)
    (m : JoystickMode) (dir : JoystickDirection) :
    chordIntervals ⟨r, s⟩ d m dir = chordIntervals ⟨r', s⟩ d m dir := rfl

/-- perfecto.test.ts:44 "matches the classic major-scale pattern I–vii°". -/
theorem quality_major_scale (root : Int) :
    [Degree.d1, .d2, .d3, .d4, .d5, .d6, .d7].map (degreeQuality ⟨root, .major⟩)
      = [.maj, .min, .min, .maj, .maj, .min, .dim] := by
  simp only [List.map, quality_root_independent root 0]
  decide +kernel

/-- perfecto.test.ts:48 "differs by scale — natural minor starts minor" (i, ii°). -/
theorem quality_natural_minor (root : Int) :
    degreeQuality ⟨root, .naturalMinor⟩ .d1 = .min ∧
    degreeQuality ⟨root, .naturalMinor⟩ .d2 = .dim := by
  simp only [quality_root_independent root 0]
  decide +kernel

/-- The triad the scale itself stacks on a degree: the semitones from the
    degree's root to the scale tone two steps up and four steps up, with the
    source's own short-scale wrap (perfecto.ts:163-166). -/
def diatonicTriad (s : ScaleType) (d : Degree) : List Int :=
  let scale := SCALE_INTERVALS s
  let n := scale.length
  let i := degreeIndex d
  let root := scale.getD (i % n) 0 + jsFloorDiv i n * 12
  [0, scale.getD ((i + 2) % n) 0 + jsFloorDiv (i + 2) n * 12 - root,
      scale.getD ((i + 4) % n) 0 + jsFloorDiv (i + 4) n * 12 - root]

/-- perfecto.ts:12 "Quality is DETECTED, not stored. The diatonic 3rd/5th above
    the root decide major/minor/dim"; perfecto.test.ts:155 "agrees with the
    notes computeVoicing actually produces".

    In the base cell (default/center) the detected quality and the notes
    sounded always agree with each other, in every scale: `maj` sounds
    [0,4,7], `min` [0,3,7], `dim` [0,3,6]. -/
theorem base_cell_matches_quality (key : Key) (d : Degree) :
    chordIntervals key d .default .center =
      match degreeQuality key d with
      | .maj => [0, 4, 7] | .min => [0, 3, 7] | .dim => [0, 3, 6] := by
  simp only [chordIntervals]
  cases degreeQuality key d <;> rfl

/-- perfecto.ts:5 "computeVoicing feeds those through the diatonic-thirds
    rule": for the seven-note scales the base cell sounds exactly the triad
    the scale stacks on that degree — on every degree EXCEPT the two named in
    the hypothesis. -/
theorem base_cell_is_diatonic_triad (root : Int) (s : ScaleType) (d : Degree)
    (h7 : (SCALE_INTERVALS s).length = 7)
    (hex : ¬ ((s = .harmonicMinor ∨ s = .melodicMinor) ∧ d = .d3)) :
    chordIntervals ⟨root, s⟩ d .default .center = diatonicTriad s d := by
  rw [chordIntervals_root_independent root 0]
  cases s <;> cases d <;>
    first
    | (exact absurd h7 (by decide))
    | (exact absurd (And.intro (Or.inl rfl) rfl) hex)
    | (exact absurd (And.intro (Or.inr rfl) rfl) hex)
    | decide +kernel

/-- FAILS: "the diatonic 3rd/5th above the root decide major/minor/dim"
    (perfecto.ts:12), on degree III of the harmonic and melodic minor scales.

    The scale stacks an AUGMENTED triad there ([0, 4, 8]); the rule has no
    such quality, calls it `maj`, and the base cell sounds [0, 4, 7]. The
    perfect fifth it sounds (pitch class 10 above the key root, B♭ in C) is not
    a note of the scale. Repro: `proofs/repro/perfecto_quality.ts`. -/
theorem FAILS_base_cell_is_diatonic_on_minor_III :
    diatonicTriad .harmonicMinor .d3 = [0, 4, 8] ∧
    diatonicTriad .melodicMinor .d3 = [0, 4, 8] ∧
    degreeQuality ⟨0, .harmonicMinor⟩ .d3 = .maj ∧
    chordIntervals ⟨0, .harmonicMinor⟩ .d3 .default .center = [0, 4, 7] ∧
    chordIntervals ⟨0, .melodicMinor⟩ .d3 .default .center = [0, 4, 7] ∧
    (degreeOffsetOf ⟨0, .harmonicMinor⟩ .d3 + 7) % 12 ∉ SCALE_INTERVALS .harmonicMinor ∧
    (degreeOffsetOf ⟨0, .melodicMinor⟩ .d3 + 7) % 12 ∉ SCALE_INTERVALS .melodicMinor := by
  simp only [chordIntervals, degreeQuality, degreeOffsetOf, diatonicTriad]
  decide +kernel

/-- FAILS: perfecto.ts:143 "Honors the same short-scale octave-wrap as the
    voicing math, so it's correct for pentatonic/blues too."

    In a five-note scale two steps up is a FOURTH (5 semitones), which the
    rule `thirdAbs - degreeOffset < 4` reads as "not minor", i.e. major. So
    the tonic of the MINOR pentatonic is detected `maj` and sounds a major
    triad whose third (pitch class 4, E in C) is not in the scale — the scale
    has the minor third (3) instead. The same happens on the blues tonic.
    Repro: `proofs/repro/perfecto_quality.ts`. -/
theorem FAILS_quality_correct_for_pentatonic :
    degreeQuality ⟨0, .minorPentatonic⟩ .d1 = .maj ∧
    diatonicTriad .minorPentatonic .d1 = [0, 5, 10] ∧
    chordIntervals ⟨0, .minorPentatonic⟩ .d1 .default .center = [0, 4, 7] ∧
    (4 : Int) ∉ SCALE_INTERVALS .minorPentatonic ∧ (3 : Int) ∈ SCALE_INTERVALS .minorPentatonic ∧
    degreeQuality ⟨0, .blues⟩ .d1 = .maj ∧
    (4 : Int) ∉ SCALE_INTERVALS .blues ∧ (3 : Int) ∈ SCALE_INTERVALS .blues := by
  simp only [chordIntervals, degreeQuality, degreeOffsetOf, diatonicTriad]
  decide +kernel

/-- perfecto.ts:19 "Some joystick cells collapse all three qualities to one
    list — that's how the table FORCES a quality regardless of degree";
    perfecto.test.ts:82. The cell the test names (chromatic/up, minMaj7) gives
    the same intervals in every key and on every degree. -/
theorem forcing_cell_ignores_degree (key : Key) (d : Degree) :
    chordIntervals key d .chromatic .up = [0, 3, 7, 11] := by
  simp only [chordIntervals]
  cases degreeQuality key d <;> rfl

/-! ## applyInversion and build -/

theorem bumpFirst_map_add (l : List Int) (k : Int) :
    bumpFirst (l.map (· + k)) = (bumpFirst l).map (· + k) := by
  cases l with
  | nil => rfl
  | cons a t => simp [bumpFirst]; omega

theorem bumpSecond_map_add (l : List Int) (k : Int) :
    bumpSecond (l.map (· + k)) = (bumpSecond l).map (· + k) := by
  match l with
  | [] => rfl
  | [a] => rfl
  | a :: b :: t => simp [bumpSecond]; omega

/-- Inverting commutes with transposing: the shape of an inversion does not
    depend on where the chord sits. -/
theorem applyInversion_map_add (l : List Int) (inv : Inversion) (k : Int) :
    applyInversion (l.map (· + k)) inv = (applyInversion l inv).map (· + k) := by
  simp only [applyInversion, List.length_map]
  split
  · rfl
  · cases inv <;>
      simp [jsSort_map_add, bumpFirst_map_add, bumpSecond_map_add]

theorem build_shift (c : Int) (ivls : List Int) (s : Int) :
    build c ivls s = (build c ivls 0).map (· + s * 12) := by
  simp only [build]
  rw [← jsSort_map_add]
  congr 1
  simp only [List.map_map]
  apply List.map_congr_left
  intro i _
  simp only [Function.comp]
  omega

/-- perfecto.ts:204 "Voice-leading searches the OCTAVE SHIFT and keeps the
    requested inversion fixed": every candidate is the plain voicing moved by
    whole octaves, note for note. -/
theorem cand_shift (a : ComputeVoicingArgs) (s : Int) :
    cand a s = (cand a 0).map (· + s * 12) := by
  simp only [cand]
  rw [build_shift, applyInversion_map_add]

theorem applyInversion_sorted (l : List Int) (inv : Inversion) (h : l.Pairwise (· ≤ ·)) :
    (applyInversion l inv).Pairwise (· ≤ ·) := by
  simp only [applyInversion]
  split
  · exact h
  · exact jsSort_sorted _

theorem build_sorted (c : Int) (ivls : List Int) (s : Int) :
    (build c ivls s).Pairwise (· ≤ ·) := jsSort_sorted _

/-- For a well-formed interval list `build`'s sort changes nothing. -/
theorem build_eq (c : Int) (ivls : List Int) (h : ivls.Pairwise (· < ·)) :
    build c ivls 0 = ivls.map (fun i => c + i + 0 * 12) := by
  simp only [build]
  apply jsSort_of_sorted
  rw [List.pairwise_map]
  exact h.imp (by intro a b hab; omega)

/-- Where the notes of a candidate can be: within 21 semitones above the
    chord root, whatever the inversion. -/
theorem cand_zero_bounds (a : ComputeVoicingArgs) :
    ∀ p ∈ cand a 0, chordRootOf a ≤ p ∧ p ≤ chordRootOf a + 21 := by
  have ok : OkIvls (intervalsOf a) := chordIntervals_ok _ _ _ _
  obtain ⟨hs, h0, h1, hlen, _, hall⟩ := ok
  simp only [cand]
  rw [build_eq _ _ hs]
  generalize chordRootOf a = c at *
  generalize intervalsOf a = l at *
  match l, hlen with
  | x :: y :: z :: rest, _ =>
    simp only [List.getD_cons_zero, List.getD_cons_succ] at h0 h1
    have hx := hall x (by simp)
    have hy := hall y (by simp)
    have hrest : ∀ q ∈ z :: rest, 0 ≤ q ∧ q ≤ 21 :=
      fun q hq => hall q (List.mem_cons_of_mem _ (List.mem_cons_of_mem _ hq))
    have hsorted : ((x :: y :: z :: rest).map (fun i => c + i + 0 * 12)).Pairwise (· ≤ ·) := by
      rw [List.pairwise_map]; exact hs.imp (by intro a b hab; omega)
    intro p hp
    simp only [applyInversion, List.length_map, List.length_cons] at hp
    have hlen2 : ¬ (rest.length + 1 + 1 + 1 < 2) := by omega
    simp only [hlen2, ↓reduceIte] at hp
    rw [jsSort_of_sorted hsorted] at hp
    cases hinv : a.inversion <;> simp only [hinv, reduceCtorEq, ↓reduceIte, List.map_cons,
      bumpFirst, bumpSecond, mem_jsSort, List.mem_cons, List.mem_map] at hp
    · rcases hp with rfl | rfl | rfl | ⟨q, hq, rfl⟩
      · omega
      · omega
      · have := hrest z (by simp); omega
      · have := hrest q (by simp [hq]); omega
    · rcases hp with rfl | rfl | rfl | ⟨q, hq, rfl⟩
      · omega
      · omega
      · have := hrest z (by simp); omega
      · have := hrest q (by simp [hq]); omega
    · rcases hp with rfl | rfl | rfl | ⟨q, hq, rfl⟩
      · omega
      · omega
      · have := hrest z (by simp); omega
      · have := hrest q (by simp [hq]); omega

theorem cand_bounds (a : ComputeVoicingArgs) (s : Int) :
    ∀ p ∈ cand a s, chordRootOf a + s * 12 ≤ p ∧ p ≤ chordRootOf a + 21 + s * 12 := by
  intro p hp
  rw [cand_shift, List.mem_map] at hp
  obtain ⟨q, hq, rfl⟩ := hp
  have := cand_zero_bounds a q hq
  omega

theorem cand_sorted (a : ComputeVoicingArgs) (s : Int) : (cand a s).Pairwise (· ≤ ·) :=
  applyInversion_sorted _ _ (build_sorted _ _ _)

/-! ## computeVoicing: which candidate -/

/-- perfecto.ts:211-223: without voice-leading — switched off, or no previous
    voicing, or an empty one — the result is the plain candidate. -/
theorem computeVoicing_plain (a : ComputeVoicingArgs) (h : leadingFrom a = none) :
    computeVoicing a = cand a 0 := by
  simp only [leadingFrom] at h
  simp only [computeVoicing, cand, chordRootOf, intervalsOf]
  split
  · rename_i prev hp
    rw [hp] at h
    simp only at h
    split
    · rename_i hc; simp [hc] at h
    · rfl
  · rfl

/-- The `for (const shift of [-1, 1])` loop of perfecto.ts:215-219, unrolled. -/
theorem fold_pick (f : Int → List Int) (k : List Int → Int) :
    ([-1, 1].foldl (fun (acc : List Int × Int) (shift : Int) =>
        if k (f shift) < acc.2 then (f shift, k (f shift)) else acc) (f 0, k (f 0))).1
      = if k (f (-1)) < k (f 0) then (if k (f 1) < k (f (-1)) then f 1 else f (-1))
        else (if k (f 1) < k (f 0) then f 1 else f 0) := by
  simp only [List.foldl]
  by_cases h1 : k (f (-1)) < k (f 0) <;> by_cases h2 : k (f 1) < k (f (-1)) <;>
    by_cases h3 : k (f 1) < k (f 0) <;> simp [h1, h2, h3]

/-- perfecto.ts:211-220, written out: with voice-leading, shift 0 is the
    incumbent, −1 replaces it only if STRICTLY cheaper, and +1 replaces the
    winner of those two only if strictly cheaper again. So ties go to 0, then
    to −1. -/
theorem computeVoicing_led (a : ComputeVoicingArgs) (prev : List Int)
    (h : leadingFrom a = some prev) :
    computeVoicing a =
      let c0 := cost (cand a 0) prev
      let cm := cost (cand a (-1)) prev
      let cp := cost (cand a 1) prev
      if cm < c0 then (if cp < cm then cand a 1 else cand a (-1))
      else (if cp < c0 then cand a 1 else cand a 0) := by
  simp only [leadingFrom] at h
  simp only [computeVoicing, cand, chordRootOf, intervalsOf]
  split
  · rename_i prev' hp
    rw [hp] at h
    simp only at h
    split
    · rename_i hc
      have e : prev' = prev := by simpa [hc] using h
      rw [← e]
      exact fold_pick
        (fun shift => applyInversion (build (a.key.root + (a.octave + 1) * 12
          + degreeOffsetOf a.key a.degree)
          (chordIntervals a.key a.degree a.joystickMode a.joystickDirection) shift) a.inversion)
        (fun c => cost c prev')
    · rename_i hc; simp [hc] at h
  · rename_i hp; rw [hp] at h; simp at h

/-- The result is always one of the three candidates. -/
theorem computeVoicing_is_cand (a : ComputeVoicingArgs) :
    computeVoicing a = cand a 0 ∨ computeVoicing a = cand a (-1) ∨ computeVoicing a = cand a 1 := by
  cases h : leadingFrom a with
  | none => exact Or.inl (computeVoicing_plain a h)
  | some prev =>
    rw [computeVoicing_led a prev h]
    simp only
    split <;> split <;> simp

/-- perfecto.ts:204 "keeps the requested inversion fixed"; perfecto.test.ts:185
    "produces the requested inversion, octave-shifted at most one octave": the
    led voicing is the plain voicing of the SAME inversion, every note moved by
    the same −12, 0 or +12. -/
theorem voice_leading_keeps_inversion (a : ComputeVoicingArgs) :
    ∃ s : Int, (s = 0 ∨ s = -1 ∨ s = 1) ∧
      computeVoicing a = (computeVoicing { a with voiceLeading := false }).map (· + s * 12) := by
  have hplain : computeVoicing { a with voiceLeading := false } = cand a 0 := by
    rw [computeVoicing_plain]
    · rfl
    · simp only [leadingFrom]; split <;> simp
  rw [hplain]
  rcases computeVoicing_is_cand a with h | h | h
  · exact ⟨0, by simp, by rw [h]; simp⟩
  · exact ⟨-1, by simp, by rw [h, cand_shift]⟩
  · exact ⟨1, by simp, by rw [h, cand_shift]⟩

/-- perfecto.test.ts:198 "still voice-leads — it picks the octave nearest the
    previous chord", perfecto.test.ts:103 "minimizes motion": by the source's
    own cost function, no candidate is cheaper than the one returned. -/
theorem voice_leading_minimises_cost (a : ComputeVoicingArgs) (prev : List Int)
    (h : leadingFrom a = some prev) :
    cost (computeVoicing a) prev ≤ cost (cand a 0) prev ∧
    cost (computeVoicing a) prev ≤ cost (cand a (-1)) prev ∧
    cost (computeVoicing a) prev ≤ cost (cand a 1) prev := by
  rw [computeVoicing_led a prev h]
  simp only
  split <;> split <;> omega

/-- Tie-breaking (perfecto.ts:218, the strict `c < bestCost`): when no shift
    is strictly cheaper than staying put, the chord stays put. -/
theorem voice_leading_tie_stays (a : ComputeVoicingArgs) (prev : List Int)
    (h : leadingFrom a = some prev)
    (hm : cost (cand a 0) prev ≤ cost (cand a (-1)) prev)
    (hp : cost (cand a 0) prev ≤ cost (cand a 1) prev) :
    computeVoicing a = cand a 0 := by
  rw [computeVoicing_led a prev h]
  simp only
  have h1 : ¬ (cost (cand a (-1)) prev < cost (cand a 0) prev) := by omega
  have h2 : ¬ (cost (cand a 1) prev < cost (cand a 0) prev) := by omega
  simp only [h1, h2, ↓reduceIte]

/-! ## Voicing.notes "sorted ascending" -/

/-- perfecto.ts:124 `notes: number[]; // MIDI note numbers, sorted ascending`.
    Holds for every argument, with or without voice-leading. -/
theorem notes_sorted_ascending (a : ComputeVoicingArgs) :
    (computeVoicing a).Pairwise (· ≤ ·) := by
  rcases computeVoicing_is_cand a with h | h | h <;> rw [h] <;> exact cand_sorted a _

/-! ## Worked examples from perfecto.test.ts -/

/-- The test file's default arguments (perfecto.test.ts:17). -/
def testArgs : ComputeVoicingArgs :=
  { key := ⟨0, .major⟩, degree := .d1, joystickMode := JoystickMode.default, joystickDirection := .center,
    inversion := .root, octave := 4, voiceLeading := false, previousVoicing := none }

/-- perfecto.test.ts:32-40, 59-67, 72-80, 93-99: the literal expectations. -/
theorem test_examples :
    computeVoicing testArgs = [60, 64, 67] ∧
    computeVoicing { testArgs with degree := .d2 } = [62, 65, 69] ∧
    computeVoicing { testArgs with degree := .d7 } = [71, 74, 77] ∧
    computeVoicing { testArgs with key := ⟨0, .majorPentatonic⟩, degree := .d4 } = [67, 71, 74] ∧
    (computeVoicing { testArgs with key := ⟨0, .majorPentatonic⟩, degree := .d6 }).head? = some 72 ∧
    computeVoicing { testArgs with joystickDirection := .up } = [60, 63, 67] ∧
    computeVoicing { testArgs with joystickDirection := .upRight } = [60, 64, 67, 70] ∧
    computeVoicing { testArgs with inversion := .first } = [64, 67, 72] ∧
    computeVoicing { testArgs with inversion := .second } = [67, 72, 76] := by
  simp only [computeVoicing, build, applyInversion, jsSort_eq_isort, chordIntervals, degreeQuality,
    degreeOffsetOf, testArgs]
  decide +kernel

/-- perfecto.test.ts:198: led from a chord two octaves down, IV in C follows
    the hand down an octave; led from one nearby, it stays. -/
theorem test_voice_leading_follows :
    computeVoicing { testArgs with degree := .d4, voiceLeading := true,
                                   previousVoicing := some [60, 64, 67] } = [65, 69, 72] ∧
    computeVoicing { testArgs with degree := .d4, voiceLeading := true,
                                   previousVoicing := some [24, 28, 31] } = [53, 57, 60] := by
  simp only [computeVoicing, build, applyInversion, jsSort_eq_isort, chordIntervals, degreeQuality,
    degreeOffsetOf, testArgs, cost, List.foldl, List.map, jsMin, jsAbs]
  decide +kernel

/-! ## Are the notes valid MIDI numbers?

  types.ts:9 "MIDI note number, 0–127"; perfecto.ts:124 "MIDI note numbers";
  perfecto.ts:6 "returns MIDI numbers, ready for LiveKeys.press".
  perf-state.ts:132 clamps the octave to 0..8. -/

theorem chordRootOf_bounds (a : ComputeVoicingArgs) (hr : 0 ≤ a.key.root ∧ a.key.root ≤ 11) :
    (a.octave + 1) * 12 ≤ chordRootOf a ∧ chordRootOf a ≤ (a.octave + 1) * 12 + 26 := by
  have := degreeOffsetOf_range a.key a.degree
  simp only [chordRootOf]; omega

/-- No pitch is ever negative, for any octave the state allows (≥ 0), with or
    without voice-leading. -/
theorem notes_nonneg (a : ComputeVoicingArgs) (hr : 0 ≤ a.key.root ∧ a.key.root ≤ 11)
    (ho : 0 ≤ a.octave) : ∀ p ∈ computeVoicing a, 0 ≤ p := by
  have hc := chordRootOf_bounds a hr
  intro p hp
  rcases computeVoicing_is_cand a with h | h | h <;> rw [h] at hp <;>
    have := cand_bounds a _ p hp <;> omega

/-- HOLDS ONLY UNDER A HYPOTHESIS THE CODE DOES NOT ENFORCE: `octave ≤ 5`.
    Without voice-leading, every pitch is a valid MIDI number for octaves
    0..5. (perf-state.ts:132 allows up to 8.) -/
theorem notes_valid_midi_plain (a : ComputeVoicingArgs)
    (hr : 0 ≤ a.key.root ∧ a.key.root ≤ 11) (ho : 0 ≤ a.octave ∧ a.octave ≤ 5)
    (hvl : leadingFrom a = none) : ∀ p ∈ computeVoicing a, 0 ≤ p ∧ p ≤ 127 := by
  have hc := chordRootOf_bounds a hr
  intro p hp
  rw [computeVoicing_plain a hvl] at hp
  have := cand_bounds a 0 p hp
  omega

/-- HOLDS ONLY UNDER A HYPOTHESIS THE CODE DOES NOT ENFORCE: `octave ≤ 4`.
    With voice-leading, whatever the previous voicing was, every pitch is a
    valid MIDI number for octaves 0..4 (4 is the default). -/
theorem notes_valid_midi_led (a : ComputeVoicingArgs)
    (hr : 0 ≤ a.key.root ∧ a.key.root ≤ 11) (ho : 0 ≤ a.octave ∧ a.octave ≤ 4) :
    ∀ p ∈ computeVoicing a, 0 ≤ p ∧ p ≤ 127 := by
  have hc := chordRootOf_bounds a hr
  intro p hp
  rcases computeVoicing_is_cand a with h | h | h <;> rw [h] at hp <;>
    have := cand_bounds a _ p hp <;> omega

/-- FAILS at octave 6, the smallest octave at which it can without
    voice-leading (`notes_valid_midi_plain` covers 0..5).

    B minor pentatonic, degree 7, chromatic/upLeft (maj7♯11), root position,
    octave 6: the notes are [110, 114, 117, 121, 128], and 128 is not a MIDI
    note number. Repro: `proofs/repro/perfecto_midi_range.ts`. -/
theorem FAILS_notes_valid_midi_octave_6 :
    let a : ComputeVoicingArgs :=
      { key := ⟨11, .minorPentatonic⟩, degree := .d7, joystickMode := .chromatic,
        joystickDirection := .upLeft, inversion := .root, octave := 6, voiceLeading := false,
        previousVoicing := none }
    computeVoicing a = [110, 114, 117, 121, 128] ∧ ¬ (∀ p ∈ computeVoicing a, p ≤ 127) := by
  simp only [computeVoicing, build, applyInversion, jsSort_eq_isort, chordIntervals, degreeQuality,
    degreeOffsetOf]
  decide +kernel

/-- FAILS at octave 8 (the top of the clamp) in the DEFAULT key, C major, with
    the default-mode joystick: vii° with the diatonic seventh (default/right)
    is [119, 122, 125, 129]; and in B major a plain triad on ii is
    [121, 124, 128]. The worst case the clamp allows is 155.
    Repro: `proofs/repro/perfecto_midi_range.ts`. -/
theorem FAILS_notes_valid_midi_octave_8 :
    let a : ComputeVoicingArgs :=
      { key := ⟨0, .major⟩, degree := .d7, joystickMode := JoystickMode.default,
        joystickDirection := .right, inversion := .root, octave := 8, voiceLeading := false,
        previousVoicing := none }
    let b : ComputeVoicingArgs :=
      { key := ⟨11, .major⟩, degree := .d2, joystickMode := JoystickMode.default,
        joystickDirection := .center, inversion := .root, octave := 8, voiceLeading := false,
        previousVoicing := none }
    let c : ComputeVoicingArgs :=
      { key := ⟨11, .minorPentatonic⟩, degree := .d7, joystickMode := .chromatic,
        joystickDirection := .upRight, inversion := .root, octave := 8, voiceLeading := false,
        previousVoicing := none }
    computeVoicing a = [119, 122, 125, 129] ∧ computeVoicing b = [121, 124, 128] ∧
      computeVoicing c = [134, 138, 141, 144, 148, 155] := by
  simp only [computeVoicing, build, applyInversion, jsSort_eq_isort, chordIntervals, degreeQuality,
    degreeOffsetOf]
  decide +kernel

/-- The live instrument's own case. `PerfState.setKey` has no caller in the
    app, so the key the user plays in is always the default C major
    (perf-state.ts:57). HOLDS ONLY UNDER A HYPOTHESIS THE CODE DOES NOT
    ENFORCE: `octave ≤ 6`. In C major without voice-leading every pitch is a
    valid MIDI number for octaves 0..6. -/
theorem notes_valid_midi_plain_C_major (a : ComputeVoicingArgs)
    (hk : a.key = ⟨0, .major⟩) (ho : 0 ≤ a.octave ∧ a.octave ≤ 6)
    (hvl : leadingFrom a = none) : ∀ p ∈ computeVoicing a, 0 ≤ p ∧ p ≤ 127 := by
  have hoff : degreeOffsetOf ⟨0, .major⟩ a.degree ≤ 11 := by
    cases a.degree <;> decide +kernel
  have hoff0 := (degreeOffsetOf_range ⟨0, .major⟩ a.degree).1
  have hc : chordRootOf a = (a.octave + 1) * 12 + degreeOffsetOf ⟨0, .major⟩ a.degree := by
    simp only [chordRootOf, hk]; omega
  intro p hp
  rw [computeVoicing_plain a hvl] at hp
  have := cand_bounds a 0 p hp
  omega

/-- FAILS at octave 7 in C major, the smallest octave at which the live
    instrument can produce an invalid pitch without voice-leading: vii with
    the chromatic/upRight (dom13) coloration is [107, 111, 114, 117, 121, 128].
    Reached from the keyboard by pressing `=` three times, `m` twice, the
    up-right direction key and degree 7.
    Repro: `proofs/repro/perfecto_midi_range.ts`. -/
theorem FAILS_notes_valid_midi_C_major_octave_7 :
    let a : ComputeVoicingArgs :=
      { key := ⟨0, .major⟩, degree := .d7, joystickMode := .chromatic,
        joystickDirection := .upRight, inversion := .root, octave := 7, voiceLeading := false,
        previousVoicing := none }
    computeVoicing a = [107, 111, 114, 117, 121, 128] ∧ ¬ (∀ p ∈ computeVoicing a, p ≤ 127) := by
  simp only [computeVoicing, build, applyInversion, jsSort_eq_isort, chordIntervals, degreeQuality,
    degreeOffsetOf]
  decide +kernel

/-- FAILS at octave 5 with voice-leading on, the smallest octave at which it
    can (`notes_valid_midi_led` covers 0..4) — and without the octave ever
    having been higher. Three triggers in B minor pentatonic, degree 7, octave
    5, each led from the one before:
      1. chromatic/upRight, second inversion → [105, 108, 110, 112, 114, 119]
      2. default/center, root position       → [110, 114, 117]   (shifted +12)
      3. chromatic/upLeft, root position     → [110, 114, 117, 121, 128]
    Every intermediate chord is valid MIDI; the third contains 128.
    Repro: `proofs/repro/perfecto_midi_range.ts`. -/
theorem FAILS_notes_valid_midi_led_octave_5 :
    let a1 : ComputeVoicingArgs :=
      { key := ⟨11, .minorPentatonic⟩, degree := .d7, joystickMode := .chromatic,
        joystickDirection := .upRight, inversion := .second, octave := 5, voiceLeading := true,
        previousVoicing := none }
    let v1 := computeVoicing a1
    let a2 := { a1 with joystickMode := JoystickMode.default, joystickDirection := .center, inversion := .root,
                        previousVoicing := some v1 }
    let v2 := computeVoicing a2
    let a3 := { a2 with joystickMode := .chromatic, joystickDirection := .upLeft,
                        previousVoicing := some v2 }
    let v3 := computeVoicing a3
    v1 = [105, 108, 110, 112, 114, 119] ∧ v2 = [110, 114, 117] ∧
      v3 = [110, 114, 117, 121, 128] ∧ ¬ (∀ p ∈ v3, p ≤ 127) := by
  simp only [computeVoicing, build, applyInversion, jsSort_eq_isort, chordIntervals, degreeQuality,
    degreeOffsetOf, cost, List.foldl, jsMin, jsAbs]
  decide +kernel

end Harmonicland.Perfecto
