/-
  TONNETZ — a model of `src/harmony/tonnetz-lattice.ts` and of the cursor /
  octave state in `src/tonnetz-state.ts`.

  Self-contained: Lean core only, nothing imported from the project.
  Check with `lean proofs/Harmonicland/Tonnetz.lean`.

  MODELLED
    pitchClassAt, triadCells, triadPitchClasses, transform, translate,
    voiceTriad (tonnetz-lattice.ts); the `cursor` and `octave` variables of
    tonnetz-state.ts and the four functions that write them (apply, step,
    nudgeOctave, home), plus the pitches `trigger` hands to `LiveKeys.press`.

  TRANSLATION NOTES
  * `col`, `row`, `octave` and pitches are `Int`.
  * JS `%` is truncated remainder, so it is `Int.tmod` (`jsMod`), not Lean's
    Euclidean `%`. `pitchClassAt_eq` proves what the double-mod idiom yields.
  * `[...].sort((a, b) => a - b)` is `List.mergeSort` with `≤`: a stable sort,
    as `Array.prototype.sort` is. (On integers the result of any correct sort
    is the same list.)
  * tonnetz-state.ts's `delta` is an `Int`; its callers pass `1` and `-1`
    (gamepad-tonnetz.ts:44-45).

  LEFT OUT
    Floating point and non-integer inputs; the strings (`triadName`,
    `cursorLabel`); in tonnetz-state.ts, the `sounding` voice handles and
    everything that touches `LiveKeys` — only WHICH pitches `trigger` asks
    for is modelled, not the press/release diffing.
-/

namespace Harmonicland.Tonnetz

/-! ## Translation -/

/-- JS `a % b` on integers: truncated remainder. -/
def jsMod (a b : Int) : Int := a.tmod b

/-- JS `xs.sort((a, b) => a - b)` on integers. -/
def jsSort (l : List Int) : List Int := l.mergeSort (fun a b => decide (a ≤ b))

-- src/harmony/tonnetz-lattice.ts:12
inductive Orient | up | down
  deriving DecidableEq, Repr

-- src/harmony/tonnetz-lattice.ts:13
structure Cursor where
  col : Int
  row : Int
  orient : Orient
  deriving DecidableEq, Repr

-- src/harmony/tonnetz-lattice.ts:14
inductive Transform | P | L | R
  deriving DecidableEq, Repr

-- src/harmony/tonnetz-lattice.ts:15
inductive LatticeStep
  | fifthUp | fifthDown | majThirdUp | majThirdDown | minThirdUp | minThirdDown
  deriving DecidableEq, Repr

-- src/harmony/tonnetz-lattice.ts:20
def FIFTH : Int := 7
-- src/harmony/tonnetz-lattice.ts:21
def MAJ3 : Int := 4

-- src/harmony/tonnetz-lattice.ts:25   (((FIFTH * col + MAJ3 * row) % 12) + 12) % 12
def pitchClassAt (col row : Int) : Int :=
  jsMod (jsMod (FIFTH * col + MAJ3 * row) 12 + 12) 12

structure Cells where
  root : Int × Int
  third : Int × Int
  fifth : Int × Int

-- src/harmony/tonnetz-lattice.ts:37
def triadCells (c : Cursor) : Cells :=
  if c.orient = Orient.up then
    { root := (c.col, c.row), third := (c.col, c.row + 1), fifth := (c.col + 1, c.row) }
  else
    { root := (c.col, c.row + 1), third := (c.col + 1, c.row), fifth := (c.col + 1, c.row + 1) }

structure Pcs where
  root : Int
  third : Int
  fifth : Int
  deriving DecidableEq, Repr

-- src/harmony/tonnetz-lattice.ts:56
def triadPitchClasses (c : Cursor) : Pcs :=
  let cells := triadCells c
  { root := pitchClassAt cells.root.1 cells.root.2
    third := pitchClassAt cells.third.1 cells.third.2
    fifth := pitchClassAt cells.fifth.1 cells.fifth.2 }

-- src/harmony/tonnetz-lattice.ts:70
def transform (c : Cursor) (t : Transform) : Cursor :=
  if c.orient = Orient.up then
    if t = Transform.P then { col := c.col, row := c.row - 1, orient := Orient.down }
    else if t = Transform.L then { col := c.col, row := c.row, orient := Orient.down }
    else { col := c.col - 1, row := c.row, orient := Orient.down }
  else
    if t = Transform.P then { col := c.col, row := c.row + 1, orient := Orient.up }
    else if t = Transform.L then { col := c.col, row := c.row, orient := Orient.up }
    else { col := c.col + 1, row := c.row, orient := Orient.up }

-- src/harmony/tonnetz-lattice.ts:82
def translate (c : Cursor) (step : LatticeStep) : Cursor :=
  match step with
  | .fifthUp => { c with col := c.col + 1 }
  | .fifthDown => { c with col := c.col - 1 }
  | .majThirdUp => { c with row := c.row + 1 }
  | .majThirdDown => { c with row := c.row - 1 }
  | .minThirdUp => { c with col := c.col + 1, row := c.row - 1 }
  | .minThirdDown => { c with col := c.col - 1, row := c.row + 1 }

-- src/harmony/tonnetz-lattice.ts:95
def voiceTriad (c : Cursor) (octave : Int) : List Int :=
  let pcs := triadPitchClasses c
  let rootMidi := (octave + 1) * 12 + pcs.root
  let thirdMidi := rootMidi + jsMod (pcs.third - pcs.root + 12) 12
  let fifthMidi := rootMidi + jsMod (pcs.fifth - pcs.root + 12) 12
  jsSort [rootMidi, thirdMidi, fifthMidi]

/-! ## pitchClassAt -/

theorem jsMod_double (x : Int) : jsMod (jsMod x 12 + 12) 12 = x % 12 := by
  unfold jsMod
  rw [Int.tmod_eq_emod, Int.tmod_eq_emod]
  split <;> split <;> omega

/-- tonnetz-lattice.ts:23 "The lattice formula: east = +fifth, up = +major
    third": the cell's pitch class is the true residue of `7·col + 4·row`. -/
theorem pitchClassAt_eq (col row : Int) : pitchClassAt col row = (7 * col + 4 * row) % 12 := by
  simp [pitchClassAt, jsMod_double, FIFTH, MAJ3]

/-- A pitch class is 0–11, for negative coordinates too. -/
theorem pitchClassAt_range (col row : Int) :
    0 ≤ pitchClassAt col row ∧ pitchClassAt col row < 12 := by
  rw [pitchClassAt_eq]; omega

/-- "east = +fifth, up = +major third", cell by cell. -/
theorem pitchClassAt_east_north (col row : Int) :
    pitchClassAt (col + 1) row = (pitchClassAt col row + 7) % 12 ∧
    pitchClassAt col (row + 1) = (pitchClassAt col row + 4) % 12 := by
  simp only [pitchClassAt_eq]; omega

/-! ## up = major, down = minor -/

/-- tonnetz-lattice.ts:34 "Cell roles for up (major) … triangles": an up
    triangle's third is a major third (4) and its fifth a perfect fifth (7)
    above its root. -/
theorem up_is_major (col row : Int) :
    let t := triadPitchClasses ⟨col, row, .up⟩
    (t.third - t.root) % 12 = 4 ∧ (t.fifth - t.root) % 12 = 7 := by
  simp only [triadPitchClasses, triadCells, pitchClassAt_eq, ite_true]; omega

/-- tonnetz-lattice.ts:34 "… and down (minor) triangles": minor third (3) and
    perfect fifth (7). -/
theorem down_is_minor (col row : Int) :
    let t := triadPitchClasses ⟨col, row, .down⟩
    (t.third - t.root) % 12 = 3 ∧ (t.fifth - t.root) % 12 = 7 := by
  simp [triadPitchClasses, triadCells, pitchClassAt_eq]; omega

/-- tonnetz-lattice.test.ts:16 "up (0,0) is C major {root:0, third:4, fifth:7}". -/
theorem origin_is_C_major : triadPitchClasses ⟨0, 0, .up⟩ = ⟨0, 4, 7⟩ := by decide

/-! ## The neo-Riemannian transforms -/

/-- tonnetz-lattice.ts:67 "Neo-Riemannian transforms — each is an involution
    (applying twice = identity)"; tonnetz-lattice.test.ts:30. For every cursor
    on the infinite lattice and every transform. -/
theorem transform_involution (c : Cursor) (t : Transform) :
    transform (transform c t) t = c := by
  obtain ⟨col, row, o⟩ := c
  cases o <;> cases t <;> simp [transform] <;> omega

/-- Every transform flips the triangle, hence major ↔ minor. -/
theorem transform_flips (c : Cursor) (t : Transform) : (transform c t).orient ≠ c.orient := by
  obtain ⟨col, row, o⟩ := c
  cases o <;> cases t <;> simp [transform]

/-- P is the PARALLEL transform: same root, same fifth, and the third moves by
    one semitone (major → minor lowers it, minor → major raises it). -/
theorem P_is_parallel (col row : Int) :
    (let a := triadPitchClasses ⟨col, row, .up⟩
     let b := triadPitchClasses (transform ⟨col, row, .up⟩ .P)
     b.root = a.root ∧ b.fifth = a.fifth ∧ (a.third - b.third) % 12 = 1) ∧
    (let a := triadPitchClasses ⟨col, row, .down⟩
     let b := triadPitchClasses (transform ⟨col, row, .down⟩ .P)
     b.root = a.root ∧ b.fifth = a.fifth ∧ (b.third - a.third) % 12 = 1) := by
  simp [triadPitchClasses, triadCells, transform, pitchClassAt_eq]; omega

/-- L is the LEADING-TONE exchange: from major, the third and fifth stay (as
    the new root and third) and the root falls a semitone to become the new
    fifth (C major → E minor); from minor, the reverse. -/
theorem L_is_leading_tone (col row : Int) :
    (let a := triadPitchClasses ⟨col, row, .up⟩
     let b := triadPitchClasses (transform ⟨col, row, .up⟩ .L)
     b.root = a.third ∧ b.third = a.fifth ∧ (a.root - b.fifth) % 12 = 1) ∧
    (let a := triadPitchClasses ⟨col, row, .down⟩
     let b := triadPitchClasses (transform ⟨col, row, .down⟩ .L)
     b.third = a.root ∧ b.fifth = a.third ∧ (b.root - a.fifth) % 12 = 1) := by
  simp [triadPitchClasses, triadCells, transform, pitchClassAt_eq]; omega

/-- R is the RELATIVE transform: from major, the root and third stay (as the
    new third and fifth) and the fifth rises a whole tone to become the new
    root (C major → A minor); from minor, the reverse. -/
theorem R_is_relative (col row : Int) :
    (let a := triadPitchClasses ⟨col, row, .up⟩
     let b := triadPitchClasses (transform ⟨col, row, .up⟩ .R)
     b.third = a.root ∧ b.fifth = a.third ∧ (b.root - a.fifth) % 12 = 2) ∧
    (let a := triadPitchClasses ⟨col, row, .down⟩
     let b := triadPitchClasses (transform ⟨col, row, .down⟩ .R)
     b.root = a.third ∧ b.third = a.fifth ∧ (a.root - b.fifth) % 12 = 2) := by
  simp [triadPitchClasses, triadCells, transform, pitchClassAt_eq]; omega

/-- The three pitch classes of a cursor's triad, as a list. -/
def pcList (c : Cursor) : List Int :=
  let t := triadPitchClasses c
  [t.root, t.third, t.fifth]

/-- `pcList` in terms of the lattice value `x = 7·col + 4·row` of the cursor's
    own cell. A proof device, not part of the source. -/
def shape (o : Orient) (x : Int) : List Int :=
  match o with
  | .up => [x % 12, (x + 4) % 12, (x + 7) % 12]
  | .down => [(x + 4) % 12, (x + 7) % 12, (x + 11) % 12]

theorem pcList_shape (col row : Int) (o : Orient) :
    pcList ⟨col, row, o⟩ = shape o (7 * col + 4 * row) := by
  cases o <;> simp [pcList, shape, triadPitchClasses, triadCells, pitchClassAt_eq] <;> omega

theorem shape_congr (o : Orient) (x y : Int) (h : x % 12 = y % 12) : shape o x = shape o y := by
  cases o <;> simp [shape] <;> omega

/-- How far each transform moves the cursor's cell value. -/
def transformDelta : Orient → Transform → Int
  | .up, .P => -4 | .up, .L => 0 | .up, .R => -7
  | .down, .P => 4 | .down, .L => 0 | .down, .R => 7

def flip : Orient → Orient
  | .up => .down | .down => .up

theorem pcList_transform (col row : Int) (o : Orient) (t : Transform) :
    pcList (transform ⟨col, row, o⟩ t) = shape (flip o) (7 * col + 4 * row + transformDelta o t) := by
  cases o <;> cases t <;> simp only [transform, ite_true, reduceCtorEq, ite_false, pcList_shape, flip,
    transformDelta] <;> apply shape_congr <;> omega

theorem two_common_residues :
    ∀ (o : Orient) (t : Transform) (r : Fin 12),
      ((shape o r.val).filter
        (fun p => (shape (flip o) (r.val + transformDelta o t)).contains p)).length = 2 := by
  intro o t
  cases o <;> cases t <;> decide

/-- tonnetz-lattice.test.ts:53 "each transform preserves exactly two pitch
    classes" — proved for every cursor on the lattice, not only the origin: of
    the three pitch classes of the triad, exactly two are also in the
    transformed one. -/
theorem transform_two_common_tones (c : Cursor) (t : Transform) :
    ((pcList c).filter (fun p => (pcList (transform c t)).contains p)).length = 2 := by
  obtain ⟨col, row, o⟩ := c
  rw [pcList_transform, pcList_shape]
  have hr : 0 ≤ (7 * col + 4 * row) % 12 ∧ (7 * col + 4 * row) % 12 < 12 := by omega
  have h := two_common_residues o t ⟨((7 * col + 4 * row) % 12).toNat, by omega⟩
  have e : (((7 * col + 4 * row) % 12).toNat : Int) = (7 * col + 4 * row) % 12 := by omega
  simp only [e] at h
  rw [shape_congr o (7 * col + 4 * row) ((7 * col + 4 * row) % 12) (by omega),
    shape_congr (flip o) (7 * col + 4 * row + transformDelta o t)
      ((7 * col + 4 * row) % 12 + transformDelta o t) (by omega)]
  exact h

/-! ## Translations -/

/-- Semitones each lattice step transposes by (tonnetz-lattice.test.ts:64-71). -/
def stepInterval : LatticeStep → Int
  | .fifthUp => 7 | .fifthDown => 5
  | .majThirdUp => 4 | .majThirdDown => 8
  | .minThirdUp => 3 | .minThirdDown => 9

/-- tonnetz-lattice.ts:81 "Lattice translations — preserve orientation…";
    tonnetz-lattice.test.ts:83 "preserves orientation". -/
theorem translate_preserves_orient (c : Cursor) (s : LatticeStep) :
    (translate c s).orient = c.orient := by
  cases s <;> rfl

/-- tonnetz-lattice.test.ts:74 "<step> shifts every pitch class by <delta> mod
    12": each step transposes the whole triad by its named interval — a fifth
    is 7 semitones, a major third 4, a minor third 3 — for every cursor. -/
theorem translate_transposes (c : Cursor) (s : LatticeStep) :
    let a := triadPitchClasses c
    let b := triadPitchClasses (translate c s)
    (b.root - a.root) % 12 = stepInterval s ∧
    (b.third - a.third) % 12 = stepInterval s ∧
    (b.fifth - a.fifth) % 12 = stepInterval s := by
  obtain ⟨col, row, o⟩ := c
  cases o <;> cases s <;>
    simp [triadPitchClasses, triadCells, translate, pitchClassAt_eq, stepInterval] <;> omega

/-- tonnetz-lattice.ts:81 "… preserve orientation and quality": the third and
    fifth sit the same number of semitones above the root before and after. -/
theorem translate_preserves_quality (c : Cursor) (s : LatticeStep) :
    let a := triadPitchClasses c
    let b := triadPitchClasses (translate c s)
    (b.third - b.root) % 12 = (a.third - a.root) % 12 ∧
    (b.fifth - b.root) % 12 = (a.fifth - a.root) % 12 := by
  obtain ⟨col, row, o⟩ := c
  cases o <;> cases s <;>
    simp [triadPitchClasses, triadCells, translate, pitchClassAt_eq] <;> omega

/-- Opposite steps undo each other. -/
theorem translate_inverse (c : Cursor) :
    translate (translate c .fifthUp) .fifthDown = c ∧
    translate (translate c .majThirdUp) .majThirdDown = c ∧
    translate (translate c .minThirdUp) .minThirdDown = c := by
  obtain ⟨col, row, o⟩ := c
  simp [translate] <;> omega

/-! ## voiceTriad -/

theorem jsSort_of_sorted {l : List Int} (h : l.Pairwise (· ≤ ·)) : jsSort l = l := by
  unfold jsSort
  apply List.mergeSort_of_pairwise
  simpa using h

/-- tonnetz-lattice.ts:93 "tight root-position triad, sorted ascending.
    rootMidi = (octave+1)*12 + rootPc; interval gaps are always the short way
    up."

    The exact value: root at the bottom, then the third 4 (major) or 3 (minor)
    semitones up, then the fifth 7 up. So the `sort` never reorders anything,
    the root is always the lowest note, and the chord spans a fifth. -/
theorem voiceTriad_eq (c : Cursor) (octave : Int) :
    voiceTriad c octave =
      let r := (octave + 1) * 12 + (triadPitchClasses c).root
      [r, r + (if c.orient = Orient.up then 4 else 3), r + 7] := by
  obtain ⟨col, row, o⟩ := c
  have nn : ∀ x : Int, 0 ≤ x → jsMod x 12 = x % 12 := fun x hx => Int.tmod_eq_emod_of_nonneg hx
  cases o
  · have h3 : jsMod ((7 * col + 4 * (row + 1)) % 12 - (7 * col + 4 * row) % 12 + 12) 12 = 4 := by
      rw [nn _ (by omega)]; omega
    have h5 : jsMod ((7 * (col + 1) + 4 * row) % 12 - (7 * col + 4 * row) % 12 + 12) 12 = 7 := by
      rw [nn _ (by omega)]; omega
    simp only [voiceTriad, triadPitchClasses, triadCells, pitchClassAt_eq, ite_true, h3, h5]
    apply jsSort_of_sorted
    simp; omega
  · have h3 : jsMod ((7 * (col + 1) + 4 * row) % 12 - (7 * col + 4 * (row + 1)) % 12 + 12) 12 = 3 := by
      rw [nn _ (by omega)]; omega
    have h5 : jsMod ((7 * (col + 1) + 4 * (row + 1)) % 12 - (7 * col + 4 * (row + 1)) % 12 + 12) 12 = 7 := by
      rw [nn _ (by omega)]; omega
    simp only [voiceTriad, triadPitchClasses, triadCells, pitchClassAt_eq, reduceCtorEq, ite_false,
      h3, h5]
    apply jsSort_of_sorted
    simp; omega

/-- "sorted ascending" — strictly, so the three notes are three distinct keys. -/
theorem voiceTriad_sorted (c : Cursor) (octave : Int) :
    (voiceTriad c octave).Pairwise (· < ·) := by
  rw [voiceTriad_eq]
  cases c.orient <;> simp <;> omega

/-- tonnetz-lattice.test.ts:22 "up (0,0) at octave 4 is [60,64,67]". -/
theorem voiceTriad_origin : voiceTriad ⟨0, 0, .up⟩ 4 = [60, 64, 67] := by
  rw [voiceTriad_eq]; decide

/-- types.ts:9 "MIDI note number, 0–127": every pitch `voiceTriad` produces for
    an octave in 0..8 is a valid MIDI note (in fact between 12 and 126). -/
theorem voiceTriad_midi_range (c : Cursor) (octave : Int) (h0 : 0 ≤ octave) (h8 : octave ≤ 8) :
    ∀ p ∈ voiceTriad c octave, 0 ≤ p ∧ p ≤ 127 := by
  rw [voiceTriad_eq]
  have hr : 0 ≤ (triadPitchClasses c).root ∧ (triadPitchClasses c).root < 12 := by
    simp only [triadPitchClasses]; exact pitchClassAt_range _ _
  intro p hp
  cases c.orient <;> simp at hp <;> omega

/-! ## tonnetz-state.ts: the octave clamp -/

-- src/tonnetz-state.ts:25-26
structure State where
  cursor : Cursor
  octave : Int

-- src/tonnetz-state.ts:25-26   cursor = {0,0,"up"}; octave = 4
def init : State := { cursor := ⟨0, 0, .up⟩, octave := 4 }

-- src/tonnetz-state.ts:58
def apply (s : State) (t : Transform) : State := { s with cursor := transform s.cursor t }

-- src/tonnetz-state.ts:63
def step (s : State) (l : LatticeStep) : State := { s with cursor := translate s.cursor l }

-- src/tonnetz-state.ts:68   octave = Math.max(0, Math.min(8, octave + delta))
def nudgeOctave (s : State) (delta : Int) : State :=
  { s with octave := max 0 (min 8 (s.octave + delta)) }

-- src/tonnetz-state.ts:73
def home (s : State) : State := { s with cursor := ⟨0, 0, .up⟩ }

-- src/tonnetz-state.ts:36   const next = voiceTriad(cursor, octave) — the pitches pressed
def trigger (s : State) : List Int := voiceTriad s.cursor s.octave

/-- Every state the module can be in: the initial one, and any reached from it
    by the exported functions that write the state. -/
inductive Reachable : State → Prop
  | init : Reachable init
  | apply {s} (t : Transform) : Reachable s → Reachable (apply s t)
  | step {s} (l : LatticeStep) : Reachable s → Reachable (step s l)
  | nudgeOctave {s} (delta : Int) : Reachable s → Reachable (nudgeOctave s delta)
  | home {s} : Reachable s → Reachable (home s)

/-- tonnetz-state.ts:68: the clamp keeps the octave in 0..8 through any
    sequence of operations, whatever `delta` is. -/
theorem octave_in_range {s : State} (h : Reachable s) : 0 ≤ s.octave ∧ s.octave ≤ 8 := by
  induction h with
  | init => decide
  | apply t _ ih => exact ih
  | step l _ ih => exact ih
  | nudgeOctave d _ _ => simp only [nudgeOctave]; omega
  | home _ ih => exact ih

/-- types.ts:9 "MIDI note number, 0–127": wherever the cursor has wandered and
    whatever the octave was nudged to, every pitch `trigger` presses is a
    valid MIDI note. -/
theorem trigger_presses_valid_midi {s : State} (h : Reachable s) :
    ∀ p ∈ trigger s, 0 ≤ p ∧ p ≤ 127 :=
  voiceTriad_midi_range s.cursor s.octave (octave_in_range h).1 (octave_in_range h).2

end Harmonicland.Tonnetz
