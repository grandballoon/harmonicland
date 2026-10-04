/-
  PROGRESSION — a model of `src/harmony/progression.ts`: changeRootPc, the
  numeral index of homeNumeral, transposeTo, keySignature, inRegister, realize,
  entryAt, entryAfter; and the `beats` data of `src/harmony/repertoire.ts`.

  Self-contained: Lean core only, nothing imported from the project. Because of
  that, the part of `src/harmony/perfecto.ts` that `voicingOf` calls is
  translated here a second time (section "perfecto.ts, as progression.ts uses
  it"), identically to `Perfecto.lean`.
  Check with `lean proofs/Harmonicland/Progression.lean`.

  TRANSLATION NOTES
  * Seconds and beats are `Rat`; pitches, pitch classes, fifths are `Int`;
    indices and `cycles` are `Nat`.
  * JS `%` is truncated remainder (`Int.tmod`, here `jsMod`).
  * `Math.round(x)` is `floor(x + 1/2)` on an exact rational (`jsRound`): JS
    rounds a half toward +∞, and so does this. `jsRound_div_twelve` proves what
    that is for `d / 12`.
  * `Math.min(...v.notes)` is `jsMin`; `jsMin [] = 0` stands for JS `Infinity`
    and is never reached (`voicingOf_ne_nil`).
  * `voicingOf` calls `computeVoicing` with `voiceLeading: false` and
    `previousVoicing: null`, so only that path (perfecto.ts:223) is translated,
    as `computeVoicingPlain`. `Perfecto.lean`'s `computeVoicing_plain` proves
    the full function takes it.
  * `realize`'s two nested `for` loops are structural recursions
    (`cyclesLoop`, `changesLoop`) threading the mutable `notes`, `entries`, `t`
    as an explicit state record.
  * The barline loop `for (let b = 0; b < t || at.length === 0; b += barSec)`
    is NOT guaranteed to terminate, so it cannot be a total Lean function. It
    is `barLoop`, which takes a number of iterations it is allowed (`fuel`) and
    returns `none` if the loop has not exited by then. "The loop terminates"
    is the statement `∃ fuel, barLoop … = some …`; "it never terminates" is
    `∀ fuel, barLoop … = none`. `realize` inherits the `fuel` argument.
  * A `Change`'s optional `inversion` is an `Option`; `label` and all other
    strings are left out.

  LEFT OUT
    Floating point (so `t += dur` is exact here; in the source the same float
    is written to `until` and to the next `at`, so contiguity is exact there
    too, but `duration` and barline times carry rounding this model does not);
    NaN/Infinity; non-integer `cycles`; every display string (homeNumeral's
    text, changeName, changeColor…); changePitchClasses; `Chart`'s name/about.
-/

namespace Harmonicland.Progression

/-! ## JavaScript primitives -/

/-- JS `a % b` on integers: truncated remainder. -/
def jsMod (a b : Int) : Int := a.tmod b

/-- JS `xs.sort((x, y) => x - y)` on integers. -/
def jsSort (l : List Int) : List Int := l.mergeSort (fun a b => decide (a ≤ b))

/-- JS `Math.floor(a / n)` for non-negative integers. -/
def jsFloorDiv (a n : Nat) : Int := ((a : Rat) / (n : Rat)).floor

/-- JS `Math.round`: nearest integer, a half going UP. -/
def jsRound (x : Rat) : Int := (x + 1 / 2).floor

/-- JS `Math.min(...xs)` for a non-empty list (see the header for `[]`). -/
def jsMin : List Int → Int
  | [] => 0
  | x :: xs => xs.foldl min x

/-! ## perfecto.ts, as progression.ts uses it -/

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

-- src/harmony/perfecto.ts:66
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

-- src/harmony/perfecto.ts:190
def build (chordRoot : Int) (ivls : List Int) (octaveShift : Int) : List Int :=
  jsSort (ivls.map (fun i => chordRoot + i + octaveShift * 12))

-- src/harmony/perfecto.ts:196
def bumpFirst : List Int → List Int
  | a :: rest => (a + 12) :: rest
  | [] => []

-- src/harmony/perfecto.ts:197
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

-- src/harmony/perfecto.ts:184-188, 223 (the path taken when voiceLeading is false)
def computeVoicingPlain (key : Key) (degree : Degree) (mode : JoystickMode)
    (direction : JoystickDirection) (inversion : Inversion) (octave : Int) : List Int :=
  let degreeOffset := degreeOffsetOf key degree
  let intervals := chordIntervals key degree mode direction
  let chordRoot := key.root + (octave + 1) * 12 + degreeOffset
  applyInversion (build chordRoot intervals 0) inversion

/-! ## Translation: progression.ts -/

-- src/harmony/progression.ts:71
structure Change where
  key : Key
  degree : Degree
  mode : JoystickMode
  direction : JoystickDirection
  inversion : Option Inversion
  beats : Rat

-- src/harmony/progression.ts:97
structure Progression where
  home : Key
  changes : List Change

-- src/harmony/progression.ts:115
structure ChartEntry where
  at_ : Rat
  until_ : Rat
  index : Nat

-- src/types.ts:24
inductive Hand | upper | lower
  deriving DecidableEq, Repr

-- src/types.ts:159
structure RawNote where
  pitch : Int
  onset : Rat
  duration : Rat
  hand : Hand

-- src/types.ts:106 (the object form realize emits)
structure Barline where
  at_ : Rat
  beats : Rat
  unit : Nat
  fifths : Int

-- src/harmony/progression.ts:137
def changeRootPc (c : Change) : Int :=
  jsMod (jsMod (c.key.root + degreeOffsetOf c.key c.degree) 12 + 12) 12

-- src/harmony/progression.ts:190   the index into NUMERALS
def numeralIndex (home : Key) (c : Change) : Int :=
  jsMod (changeRootPc c - home.root + 12) 12

-- src/harmony/progression.ts:199
def shiftKey (k : Key) (by_ : Int) : Key :=
  { k with root := jsMod (jsMod (k.root + by_) 12 + 12) 12 }

-- src/harmony/progression.ts:205
def transposeTo (p : Progression) (root : Int) : Progression :=
  let by_ := jsMod (jsMod (root - p.home.root) 12 + 12) 12
  if by_ = 0 then p
  else
    { p with home := shiftKey p.home by_,
             changes := p.changes.map (fun c => { c with key := shiftKey c.key by_ }) }

-- src/harmony/progression.ts:219
structure RealizeOpts where
  octave : Int
  bass : Bool
  beatSec : Rat
  cycles : Nat
  beatsPerBar : Rat

-- src/harmony/progression.ts:245
def BASS_DROP : Int := 2

-- src/harmony/progression.ts:247
def DEFAULTS : RealizeOpts :=
  { octave := 4, bass := true, beatSec := 1 / 2, cycles := 4, beatsPerBar := 4 }

-- src/harmony/progression.ts:265
def SCALE_SHIFT : ScaleType → Int
  | .major => 0 | .lydian => 1 | .mixolydian => -1 | .dorian => -2
  | .naturalMinor => -3 | .harmonicMinor => -3 | .melodicMinor => -3
  | .majorPentatonic => 0 | .minorPentatonic => -3 | .blues => -3

-- src/harmony/progression.ts:274
def keySignature (k : Key) : Int :=
  let major := jsMod (jsMod (k.root * 7) 12 + 12) 12
  let f := (if major > 6 then major - 12 else major) + SCALE_SHIFT k.scale
  if f > 7 then f - 12 else if f < -7 then f + 12 else f

-- src/harmony/progression.ts:289
def voicingOf (c : Change) (octave : Int) : List Int :=
  computeVoicingPlain c.key c.degree c.mode c.direction (c.inversion.getD .root) octave

-- src/harmony/progression.ts:314
def inRegister (notes : List Int) (anchor : Int) : List Int :=
  let shift := jsRound (((anchor - jsMin notes : Int) : Rat) / 12) * 12
  if shift = 0 then notes else notes.map (fun n => n + shift)

/-- The mutable locals of `realize`'s first loop (progression.ts:330-332). -/
structure RState where
  notes : List RawNote
  entries : List ChartEntry
  t : Rat

-- src/harmony/progression.ts:338   inRegister(voicingOf(c, octave), anchor), anchor = (octave + 1) * 12
def chordNotes (c : Change) (octave : Int) : List Int :=
  inRegister (voicingOf c octave) ((octave + 1) * 12)

-- src/harmony/progression.ts:342   changeRootPc(c) + (octave - BASS_DROP + 1) * 12
def bassPitch (c : Change) (octave : Int) : Int :=
  changeRootPc c + (octave - BASS_DROP + 1) * 12

-- src/harmony/progression.ts:336-346   the body of the inner loop
def changeStep (o : RealizeOpts) (c : Change) (i : Nat) (s : RState) : RState :=
  let dur := c.beats * o.beatSec
  let v := chordNotes c o.octave
  let notes := s.notes ++ v.map (fun pitch =>
    ({ pitch := pitch, onset := s.t, duration := dur, hand := .upper } : RawNote))
  let notes :=
    if o.bass then
      notes ++ [({ pitch := bassPitch c o.octave, onset := s.t, duration := dur, hand := .lower } : RawNote)]
    else notes
  { notes := notes
    entries := s.entries ++ [{ at_ := s.t, until_ := s.t + dur, index := i }]
    t := s.t + dur }

-- src/harmony/progression.ts:335   for (let i = 0; i < p.changes.length; i++)
def changesLoop (o : RealizeOpts) : List Change → Nat → RState → RState
  | [], _, s => s
  | c :: cs, i, s => changesLoop o cs (i + 1) (changeStep o c i s)

-- src/harmony/progression.ts:334   for (let cycle = 0; cycle < cycles; cycle++)
def cyclesLoop (o : RealizeOpts) (changes : List Change) : Nat → RState → RState
  | 0, s => s
  | n + 1, s => cyclesLoop o changes n (changesLoop o changes 0 s)

-- src/harmony/progression.ts:354   for (let b = 0; b < t || at.length === 0; b += barSec) at.push(b);
-- `none`: still looping after `fuel` iterations.
def barLoop (t barSec : Rat) : Nat → Rat → List Rat → Option (List Rat)
  | 0, _, _ => none
  | fuel + 1, b, at_ =>
    if b < t ∨ at_.length = 0 then barLoop t barSec fuel (b + barSec) (at_ ++ [b]) else some at_

-- src/harmony/progression.ts:251
structure Realized where
  notes : List RawNote
  entries : List ChartEntry
  duration : Rat
  barlines : List Barline

/-- The state after the note loops (progression.ts:334-348). Always defined. -/
def realizeNotes (p : Progression) (o : RealizeOpts) : RState :=
  cyclesLoop o p.changes o.cycles { notes := [], entries := [], t := 0 }

-- src/harmony/progression.ts:327
def realize (fuel : Nat) (p : Progression) (o : RealizeOpts) : Option Realized :=
  let s := realizeNotes p o
  let barSec := o.beatsPerBar * o.beatSec
  match barLoop s.t barSec fuel 0 [] with
  | none => none
  | some at_ =>
    -- at.push(at[at.length - 1] + barSec); `at` is never empty here
    let at_ := at_ ++ [at_.getLastD 0 + barSec]
    let fifths := keySignature p.home
    some { notes := s.notes, entries := s.entries, duration := s.t
           barlines := at_.map (fun b => { at_ := b, beats := o.beatsPerBar, unit := 4, fifths := fifths }) }

-- src/harmony/progression.ts:375   (e) => t >= e.at && t < e.until
def covers (t : Rat) (e : ChartEntry) : Bool := decide (e.at_ ≤ t) && decide (t < e.until_)

-- src/harmony/progression.ts:374
def entryAt (entries : List ChartEntry) (t : Rat) : Option ChartEntry :=
  entries.find? (covers t)

-- src/harmony/progression.ts:380   i >= 0 ? entries[i + 1] ?? null : null
def entryAfter (entries : List ChartEntry) (t : Rat) : Option ChartEntry :=
  match entries.findIdx? (covers t) with
  | some i => entries[i + 1]?
  | none => none

/-- A `Key` whose root is a pitch class, as the TypeScript enum `PitchClass`
    (perfecto.ts:26) promises. -/
def ValidKey (k : Key) : Prop := 0 ≤ k.root ∧ k.root < 12

/-! ## Arithmetic lemmas -/

theorem jsMod_double (x : Int) : jsMod (jsMod x 12 + 12) 12 = x % 12 := by
  unfold jsMod
  rw [Int.tmod_eq_emod, Int.tmod_eq_emod]
  split <;> split <;> omega

theorem jsMod_nonneg (x : Int) (h : 0 ≤ x) : jsMod x 12 = x % 12 :=
  Int.tmod_eq_emod_of_nonneg h

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

/-- `Math.round(d / 12)` for an integer `d`: halves go up. -/
theorem jsRound_div_twelve (d : Int) : jsRound ((d : Rat) / 12) = (d + 6) / 12 := by
  have e : (d : Rat) / 12 + 1 / 2 = ((d + 6 : Int) : Rat) / 12 := by
    simp only [Rat.intCast_add]; grind
  rw [jsRound, e, floor_div_twelve]

/-! ## jsMin -/

theorem foldl_min_spec (zs : List Int) (acc : Int) :
    zs.foldl min acc ≤ acc ∧ (∀ z ∈ zs, zs.foldl min acc ≤ z) ∧
      (zs.foldl min acc = acc ∨ zs.foldl min acc ∈ zs) := by
  induction zs generalizing acc with
  | nil => simp
  | cons w ws ih =>
    simp only [List.foldl]
    have i := ih (min acc w)
    refine ⟨by omega, ?_, ?_⟩
    · intro z hz
      rcases List.mem_cons.mp hz with rfl | hz
      · omega
      · exact i.2.1 z hz
    · rcases i.2.2 with e | m
      · by_cases hw : acc ≤ w
        · left; rw [e]; omega
        · right; rw [e]; simp; omega
      · right; exact List.mem_cons_of_mem _ m

/-- `Math.min(...xs)` of a non-empty list is its least element. -/
theorem jsMin_spec (l : List Int) (h : l ≠ []) : jsMin l ∈ l ∧ ∀ x ∈ l, jsMin l ≤ x := by
  match l, h with
  | y :: ys, _ =>
    have s := foldl_min_spec ys y
    simp only [jsMin]
    constructor
    · rcases s.2.2 with e | m
      · rw [e]; simp
      · exact List.mem_cons_of_mem _ m
    · intro x hx
      rcases List.mem_cons.mp hx with rfl | hx
      · exact s.1
      · exact s.2.1 x hx

/-! ## inRegister -/

/-- progression.ts:303 "Whole octaves only, so the chord itself is untouched:
    this chooses a REGISTER, it never chooses notes." Every note moves by the
    same multiple of 12. -/
theorem inRegister_whole_octaves (notes : List Int) (anchor : Int) :
    ∃ k : Int, inRegister notes anchor = notes.map (fun n => n + 12 * k) := by
  simp only [inRegister]
  split
  · exact ⟨0, by simp⟩
  · exact ⟨jsRound (((anchor - jsMin notes : Int) : Rat) / 12), by
      apply List.map_congr_left; intro n _; omega⟩

/-- The exact octave count: `Math.round((anchor − min) / 12)`, halves up. -/
theorem inRegister_eq (notes : List Int) (anchor : Int) :
    inRegister notes anchor = notes.map (fun n => n + 12 * ((anchor - jsMin notes + 6) / 12)) := by
  simp only [inRegister, jsRound_div_twelve]
  split
  · rename_i h
    have : (anchor - jsMin notes + 6) / 12 = 0 := by omega
    simp [this]
  · apply List.map_congr_left; intro n _; omega

/-- progression.ts:301 "Slide a voicing by whole octaves so its lowest note
    sits as close to the anchor tonic as an octave allows — within a tritone
    either side."

    For a non-empty voicing the lowest note lands in `(anchor − 6, anchor + 6]`:
    never more than a tritone away, and the tie (exactly a tritone) goes UP,
    which is `Math.round`'s half-up rule. -/
theorem inRegister_within_tritone (notes : List Int) (anchor : Int) (h : notes ≠ []) :
    anchor - 6 < jsMin (inRegister notes anchor) ∧ jsMin (inRegister notes anchor) ≤ anchor + 6 := by
  rw [inRegister_eq]
  generalize hk : (anchor - jsMin notes + 6) / 12 = k
  have hne : notes.map (fun n => n + 12 * k) ≠ [] := by simpa using h
  have s := jsMin_spec notes h
  have s' := jsMin_spec _ hne
  obtain ⟨q, hq, hqe⟩ := List.mem_map.mp s'.1
  have h1 := s'.2 (jsMin notes + 12 * k) (List.mem_map.mpr ⟨_, s.1, rfl⟩)
  have h2 := s.2 q hq
  omega

/-- No note of the slid voicing is below `anchor − 5`. -/
theorem inRegister_all_above (notes : List Int) (anchor : Int) (h : notes ≠ []) :
    ∀ p ∈ inRegister notes anchor, anchor - 6 < p := by
  have hne : inRegister notes anchor ≠ [] := by
    obtain ⟨k, hk⟩ := inRegister_whole_octaves notes anchor
    rw [hk]; simpa using h
  intro p hp
  have := (jsMin_spec _ hne).2 p hp
  have := (inRegister_within_tritone notes anchor h).1
  omega

/-! ## The voicing is never empty, so `Math.min(...v.notes)` is never `Infinity` -/

theorem jsSort_length (l : List Int) : (jsSort l).length = l.length := List.length_mergeSort l

theorem bumpFirst_length (l : List Int) : (bumpFirst l).length = l.length := by
  cases l <;> rfl

theorem bumpSecond_length (l : List Int) : (bumpSecond l).length = l.length := by
  match l with
  | [] => rfl
  | [_] => rfl
  | _ :: _ :: _ => rfl

theorem applyInversion_length (l : List Int) (inv : Inversion) :
    (applyInversion l inv).length = l.length := by
  simp only [applyInversion]
  split
  · rfl
  · cases inv <;> simp [jsSort_length, bumpFirst_length, bumpSecond_length]

theorem chordIntervals_length (key : Key) (d : Degree) (m : JoystickMode) (dir : JoystickDirection) :
    3 ≤ (chordIntervals key d m dir).length := by
  simp only [chordIntervals]
  split
  · cases m <;> cases dir <;> decide
  · split
    · cases m <;> cases dir <;> decide
    · cases m <;> cases dir <;> decide

theorem voicingOf_length (c : Change) (octave : Int) : 3 ≤ (voicingOf c octave).length := by
  simp only [voicingOf, computeVoicingPlain, applyInversion_length, build, jsSort_length,
    List.length_map]
  exact chordIntervals_length _ _ _ _

theorem voicingOf_ne_nil (c : Change) (octave : Int) : voicingOf c octave ≠ [] := by
  intro h
  have := voicingOf_length c octave
  rw [h] at this
  simp at this

/-! ## The bass and the chord -/

theorem changeRootPc_range (c : Change) : 0 ≤ changeRootPc c ∧ changeRootPc c < 12 := by
  simp only [changeRootPc, jsMod_double]; omega

/-- progression.test.ts:131 "puts the bass on the chord root": the bass note's
    pitch class is the change's root. -/
theorem bass_is_chord_root (c : Change) (octave : Int) :
    (bassPitch c octave) % 12 = changeRootPc c := by
  have := changeRootPc_range c
  simp only [bassPitch, BASS_DROP]; omega

/-- progression.ts:239 "Two octaves clears that with room to spare";
    progression.test.ts:116 "splits the hands: the voicing above, the root
    below … clear of each other in every realization, not merely usually".

    For EVERY change (any key, degree, coloration, inversion) and every
    register, the bass is at least 8 semitones below every note of the chord.
    The test checks this for the repertoire; this is all inputs. -/
theorem bass_clear_of_chord (c : Change) (octave : Int) :
    ∀ p ∈ chordNotes c octave, bassPitch c octave + 8 ≤ p := by
  intro p hp
  have h := inRegister_all_above _ ((octave + 1) * 12) (voicingOf_ne_nil c octave) p hp
  have := changeRootPc_range c
  simp only [bassPitch, BASS_DROP]; omega

/-! ### Sorting, for evaluating concrete voicings -/

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

theorem jsSort_eq_isort (l : List Int) : jsSort l = isort l := by
  apply List.Perm.eq_of_pairwise (le := fun a b : Int => a ≤ b)
  · intro a b _ _ h1 h2; omega
  · have h := List.pairwise_mergeSort (le := fun a b : Int => decide (a ≤ b))
      (by intro a b c; simp; omega) (by intro a b; simp; omega) l
    simpa [jsSort] using h
  · exact isort_sorted l
  · exact (List.mergeSort_perm l _).trans (isort_perm l).symm

/-- progression.ts:239 "at one octave the bass could land inside the chord it
    is meant to be under, and the two hands would fight for a key": V in C
    major at the default register is voiced G3–B3–D4 (55, 59, 62), and a bass
    one octave under the anchor would be that same G3. -/
theorem one_octave_drop_collides :
    let c : Change :=
      { key := ⟨0, .major⟩, degree := .d5, mode := JoystickMode.default, direction := .center,
        inversion := none, beats := 4 }
    chordNotes c 4 = [55, 59, 62] ∧ changeRootPc c + (4 - 1 + 1) * 12 = 55 := by
  simp only [chordNotes, inRegister_eq, voicingOf, computeVoicingPlain, build, applyInversion,
    jsSort_eq_isort, chordIntervals, degreeQuality, degreeOffsetOf, changeRootPc, jsMin]
  decide +kernel

/-! ## keySignature -/

/-- progression.ts:271 "The key signature for a Key, in fifths": always
    between seven flats and seven sharps, for any root (even one outside
    0..11) and any scale. -/
theorem keySignature_range (k : Key) : -7 ≤ keySignature k ∧ keySignature k ≤ 7 := by
  obtain ⟨root, s⟩ := k
  simp only [keySignature, jsMod_double]
  cases s <;> simp only [SCALE_SHIFT] <;> (repeat' split) <;> omega

/-- progression.ts:275 "the major key on this pitch class: C=0, G=1 ... walking
    by fifths": the twelve major keys, C C♯ D … B. -/
theorem keySignature_major_table :
    (List.range 12).map (fun r : Nat => keySignature ⟨(r : Int), .major⟩)
      = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5] := by
  decide

/-- Correctness against the circle of fifths: the major key with `f` sharps
    (flats if negative) has tonic `7·f mod 12`, so its pitch classes are those
    of the major scale built there. -/
def signaturePcs (f : Int) : List Int :=
  (SCALE_INTERVALS .major).map (fun i => (7 * f + i) % 12)

def keyPcs (k : Key) : List Int :=
  (SCALE_INTERVALS k.scale).map (fun i => (k.root + i) % 12)

def IsDiatonicMode (s : ScaleType) : Prop :=
  s = .major ∨ s = .naturalMinor ∨ s = .dorian ∨ s = .mixolydian ∨ s = .lydian

/-- progression.ts:261 "A minor and C major share one, D dorian is C major's,
    G mixolydian is C major's" — in all twelve transpositions and for lydian
    too: for each of the five diatonic modes, the signature `keySignature`
    returns is the one whose notes are exactly the notes of that key. -/
theorem keySignature_correct (r : Fin 12) (s : ScaleType) (h : IsDiatonicMode s) :
    (∀ x ∈ keyPcs ⟨r.val, s⟩, x ∈ signaturePcs (keySignature ⟨r.val, s⟩)) ∧
    (∀ x ∈ signaturePcs (keySignature ⟨r.val, s⟩), x ∈ keyPcs ⟨r.val, s⟩) := by
  revert r
  rcases h with rfl | rfl | rfl | rfl | rfl <;> decide

/-- progression.ts:263 "The scales with no classical signature — pentatonic,
    blues — take their parent's", and the harmonic and melodic minors take
    the natural minor's. -/
theorem keySignature_parents (root : Int) :
    keySignature ⟨root, .majorPentatonic⟩ = keySignature ⟨root, .major⟩ ∧
    keySignature ⟨root, .minorPentatonic⟩ = keySignature ⟨root, .naturalMinor⟩ ∧
    keySignature ⟨root, .blues⟩ = keySignature ⟨root, .naturalMinor⟩ ∧
    keySignature ⟨root, .harmonicMinor⟩ = keySignature ⟨root, .naturalMinor⟩ ∧
    keySignature ⟨root, .melodicMinor⟩ = keySignature ⟨root, .naturalMinor⟩ :=
  ⟨rfl, rfl, rfl, rfl, rfl⟩

/-- progression.ts:271 "an enharmonic tonic takes the side of the circle with
    fewer accidentals" — true for the major scale (and major pentatonic): no
    major key gets more than six. -/
theorem keySignature_major_fewest (r : Fin 12) :
    -6 ≤ keySignature ⟨r.val, .major⟩ ∧ keySignature ⟨r.val, .major⟩ ≤ 6 := by
  revert r; decide

/-- FAILS: progression.ts:272 "(G♭, six flats, over F♯'s six sharps only by the
    tie-break below)". For pitch class 6 in major the code returns +6 — F♯
    major, six SHARPS — because the tie-break is `major > 6 ? major - 12 :
    major` and 6 is not greater than 6.
    Repro: `proofs/repro/progression_keySignature.ts`. -/
theorem FAILS_keySignature_Gflat_wins_tie :
    keySignature ⟨6, .major⟩ = 6 ∧ keySignature ⟨6, .major⟩ ≠ -6 := by decide

/-- FAILS: progression.ts:271 "an enharmonic tonic takes the side of the circle
    with fewer accidentals", outside the major scale. Three tonics get SEVEN
    accidentals where the enharmonic spelling has five:
      G♯/A♭ minor (natural, harmonic, melodic, minor pentatonic, blues): −7
        (A♭ minor, 7 flats; G♯ minor has 5 sharps),
      C♯/D♭ dorian: −7 (D♭ dorian, 7 flats; C♯ dorian has 5 sharps),
      F♯/G♭ lydian: +7 (F♯ lydian, 7 sharps; G♭ lydian has 5 flats).
    Repro: `proofs/repro/progression_keySignature.ts`. -/
theorem FAILS_keySignature_fewer_accidentals :
    keySignature ⟨8, .naturalMinor⟩ = -7 ∧ keySignature ⟨1, .dorian⟩ = -7 ∧
    keySignature ⟨6, .lydian⟩ = 7 ∧
    ¬ (∀ (r : Fin 12) (s : ScaleType), -6 ≤ keySignature ⟨r.val, s⟩ ∧ keySignature ⟨r.val, s⟩ ≤ 6) := by
  refine ⟨by decide, by decide, by decide, ?_⟩
  intro h
  exact absurd (h ⟨6, by decide⟩ .lydian).2 (by decide)

/-! ## transposeTo -/

/-- progression.test.ts:78 "is a no-op in its own key, and returns the same
    value". -/
theorem transposeTo_own_key (p : Progression) : transposeTo p p.home.root = p := by
  have h0 : jsMod (jsMod (p.home.root - p.home.root) 12 + 12) 12 = 0 := by
    rw [jsMod_double]; omega
  simp only [transposeTo, h0, ↓reduceIte]

/-- progression.ts:201 "The same structure in another key": the new home is
    the requested root, same scale. -/
theorem transposeTo_home (p : Progression) (root : Int) (hr : 0 ≤ root ∧ root < 12)
    (hh : ValidKey p.home) :
    (transposeTo p root).home = ⟨root, p.home.scale⟩ := by
  obtain ⟨⟨hroot, hscale⟩, changes⟩ := p
  simp only [ValidKey] at hh
  simp only [transposeTo, jsMod_double]
  split
  · rename_i h
    have : hroot = root := by omega
    simp [this]
  · simp only [shiftKey, jsMod_double, Key.mk.injEq, and_true]; omega

/-- progression.ts:201 "Every change moves by the interval the HOME moved by —
    including the ones that named a foreign key"; progression.test.ts:72.
    Each change keeps its scale, degree, coloration, inversion and length, and
    its key root moves by exactly `root − home.root` (mod 12).

    Hypothesis: the change keys are pitch classes, as the `PitchClass` type
    says (and as every change in repertoire.ts is). -/
theorem transposeTo_changes (p : Progression) (root : Int)
    (hc : ∀ c ∈ p.changes, ValidKey c.key) :
    (transposeTo p root).changes =
      p.changes.map (fun c =>
        { c with key := ⟨(c.key.root + (root - p.home.root)) % 12, c.key.scale⟩ }) := by
  simp only [transposeTo, jsMod_double]
  split
  · rename_i h
    symm
    rw [List.map_congr_left (g := id)]
    · simp
    · intro c hcm
      have := hc c hcm
      simp only [ValidKey] at this
      obtain ⟨⟨r, s⟩, d, m, dir, inv, b⟩ := c
      simp only [id, Change.mk.injEq, Key.mk.injEq, and_true]
      simp only at this
      omega
  · apply List.map_congr_left
    intro c _
    simp only [shiftKey, jsMod_double, Change.mk.injEq, Key.mk.injEq, and_true]
    omega

/-- progression.test.ts:91 "wraps rather than running off the top of the pitch
    classes": after transposing, every change's key root is still 0..11. -/
theorem transposeTo_wraps (p : Progression) (root : Int)
    (hc : ∀ c ∈ p.changes, ValidKey c.key) :
    ∀ c ∈ (transposeTo p root).changes, ValidKey c.key := by
  rw [transposeTo_changes p root hc]
  intro c hcm
  obtain ⟨c0, _, rfl⟩ := List.mem_map.mp hcm
  simp only [ValidKey]; omega

theorem degreeOffsetOf_root_independent (r r' : Int) (s : ScaleType) (d : Degree) :
    degreeOffsetOf ⟨r, s⟩ d = degreeOffsetOf ⟨r', s⟩ d := rfl

/-- progression.ts:201 "keeps a modulating progression's internal relationships
    intact"; progression.test.ts:74 "the STRUCTURE is unchanged" and :250 "keeps
    those numbers in all twelve keys".

    The numeral a change is given against home (the index into NUMERALS,
    progression.ts:190) is the same before and after transposing, for every
    change, for any target root. Chord quality depends only on scale and
    degree, which do not change at all (`transposeTo_changes`). -/
theorem transposeTo_preserves_numerals (p : Progression) (root : Int)
    (hr : 0 ≤ root ∧ root < 12) (hh : ValidKey p.home)
    (hc : ∀ c ∈ p.changes, ValidKey c.key) :
    (transposeTo p root).changes.map (numeralIndex (transposeTo p root).home)
      = p.changes.map (numeralIndex p.home) := by
  rw [transposeTo_home p root hr hh, transposeTo_changes p root hc, List.map_map]
  apply List.map_congr_left
  intro c hcm
  have hv := hc c hcm
  simp only [ValidKey] at hv hh
  obtain ⟨⟨r, s⟩, d, m, dir, inv, b⟩ := c
  simp only [Function.comp, numeralIndex, changeRootPc, jsMod_double]
  rw [degreeOffsetOf_root_independent _ r]
  generalize degreeOffsetOf ⟨r, s⟩ d = off
  simp only at hv
  rw [jsMod_nonneg _ (by omega), jsMod_nonneg _ (by omega)]
  omega

/-- progression.ts:190: the index into the twelve-entry `NUMERALS` table is
    always 0..11 when home is a pitch class. -/
theorem numeralIndex_in_bounds (home : Key) (c : Change) (hh : ValidKey home) :
    0 ≤ numeralIndex home c ∧ numeralIndex home c < 12 := by
  have := changeRootPc_range c
  simp only [ValidKey] at hh
  simp only [numeralIndex]
  rw [jsMod_nonneg _ (by omega)]
  omega

/-! ## realize: the note loops -/

/-- Entries laid end to end from `a` to `b`: each begins exactly where the one
    before ended. -/
def Contig : Rat → List ChartEntry → Rat → Prop
  | a, [], b => a = b
  | a, e :: es, b => e.at_ = a ∧ Contig e.until_ es b

theorem Contig_snoc (a b c : Rat) (es : List ChartEntry) (i : Nat) (h : Contig a es b) :
    Contig a (es ++ [{ at_ := b, until_ := c, index := i }]) c := by
  induction es generalizing a with
  | nil => simp only [Contig] at h; subst h; simp [Contig]
  | cons e es ih => exact ⟨h.1, ih _ h.2⟩

theorem Contig_append (a b : Rat) (xs ys : List ChartEntry) :
    Contig a (xs ++ ys) b ↔ ∃ m, Contig a xs m ∧ Contig m ys b := by
  induction xs generalizing a with
  | nil =>
    constructor
    · intro h; exact ⟨a, rfl, h⟩
    · rintro ⟨m, h1, h2⟩; simp only [Contig] at h1; subst h1; exact h2
  | cons e es ih =>
    simp only [List.cons_append, Contig, ih]
    constructor
    · rintro ⟨h1, m, h2, h3⟩; exact ⟨m, ⟨h1, h2⟩, h3⟩
    · rintro ⟨m, ⟨h1, h2⟩, h3⟩; exact ⟨h1, m, h2, h3⟩

/-- What the loops keep true of `(notes, entries, t)`. -/
def Inv (s : RState) : Prop :=
  Contig 0 s.entries s.t ∧
  ∀ n ∈ s.notes, ∃ e ∈ s.entries, n.onset = e.at_ ∧ n.onset + n.duration = e.until_

theorem changeStep_inv (o : RealizeOpts) (c : Change) (i : Nat) (s : RState) (h : Inv s) :
    Inv (changeStep o c i s) := by
  obtain ⟨hc, hn⟩ := h
  refine ⟨Contig_snoc _ _ _ _ _ hc, ?_⟩
  intro n hmem
  have old : ∀ n ∈ s.notes, ∃ e ∈ s.entries ++ [({ at_ := s.t, until_ := s.t + c.beats * o.beatSec, index := i } : ChartEntry)],
      n.onset = e.at_ ∧ n.onset + n.duration = e.until_ := by
    intro n hn'
    obtain ⟨e, he, h1, h2⟩ := hn n hn'
    exact ⟨e, List.mem_append_left _ he, h1, h2⟩
  have new : ∀ n : RawNote, n.onset = s.t → n.duration = c.beats * o.beatSec →
      ∃ e ∈ s.entries ++ [({ at_ := s.t, until_ := s.t + c.beats * o.beatSec, index := i } : ChartEntry)],
      n.onset = e.at_ ∧ n.onset + n.duration = e.until_ := by
    intro n h1 h2
    exact ⟨_, List.mem_append_right _ (List.mem_singleton.mpr rfl), h1, by rw [h1, h2]⟩
  simp only [changeStep] at hmem ⊢
  split at hmem
  · rcases List.mem_append.mp hmem with hm | hm
    · rcases List.mem_append.mp hm with hm | hm
      · exact old n hm
      · obtain ⟨q, _, rfl⟩ := List.mem_map.mp hm
        exact new _ rfl rfl
    · rw [List.mem_singleton] at hm; subst hm
      exact new _ rfl rfl
  · rcases List.mem_append.mp hmem with hm | hm
    · exact old n hm
    · obtain ⟨q, _, rfl⟩ := List.mem_map.mp hm
      exact new _ rfl rfl

theorem changesLoop_inv (o : RealizeOpts) (cs : List Change) (i : Nat) (s : RState) (h : Inv s) :
    Inv (changesLoop o cs i s) := by
  induction cs generalizing i s with
  | nil => exact h
  | cons c cs ih => exact ih _ _ (changeStep_inv o c i s h)

theorem cyclesLoop_inv (o : RealizeOpts) (cs : List Change) (n : Nat) (s : RState) (h : Inv s) :
    Inv (cyclesLoop o cs n s) := by
  induction n generalizing s with
  | zero => exact h
  | succ n ih => exact ih _ (changesLoop_inv o cs 0 s h)

theorem realizeNotes_inv (p : Progression) (o : RealizeOpts) : Inv (realizeNotes p o) :=
  cyclesLoop_inv o p.changes o.cycles _ ⟨rfl, by intro n hn; simp at hn⟩

/-- progression.test.ts:101 "lays the changes end to end, each ending where the
    next begins" and `one.duration` is the last `until`: the entries run
    contiguously from 0 to the piece's duration. Holds for EVERY input —
    including zero or negative `beats` and `beatSec`. -/
theorem entries_contiguous (p : Progression) (o : RealizeOpts) :
    Contig 0 (realizeNotes p o).entries (realizeNotes p o).t :=
  (realizeNotes_inv p o).1

/-- progression.ts:321 "Each change's notes end exactly where the next change's
    begin": every note starts at its change's `at` and ends at its `until`,
    and (by `entries_contiguous`) that `until` is the next change's `at`. -/
theorem notes_fill_their_change (p : Progression) (o : RealizeOpts) :
    ∀ n ∈ (realizeNotes p o).notes, ∃ e ∈ (realizeNotes p o).entries,
      n.onset = e.at_ ∧ n.onset + n.duration = e.until_ :=
  (realizeNotes_inv p o).2

/-! ### Entry count and indices -/

theorem changeStep_entries (o : RealizeOpts) (c : Change) (i : Nat) (s : RState) :
    (changeStep o c i s).entries = s.entries ++ [{ at_ := s.t, until_ := s.t + c.beats * o.beatSec, index := i }] :=
  rfl

theorem changesLoop_entries (o : RealizeOpts) (cs : List Change) (i : Nat) (s : RState) :
    (changesLoop o cs i s).entries.length = s.entries.length + cs.length ∧
    ∀ e ∈ (changesLoop o cs i s).entries, e ∈ s.entries ∨ (i ≤ e.index ∧ e.index < i + cs.length) := by
  induction cs generalizing i s with
  | nil => exact ⟨by simp [changesLoop], fun e he => Or.inl he⟩
  | cons c cs ih =>
    have h := ih (i + 1) (changeStep o c i s)
    simp only [changesLoop, List.length_cons]
    rw [changeStep_entries] at h
    refine ⟨by rw [h.1]; simp; omega, ?_⟩
    intro e he
    rcases h.2 e he with hm | hm
    · rcases List.mem_append.mp hm with hm | hm
      · exact Or.inl hm
      · rw [List.mem_singleton] at hm; subst hm; right; simp
    · right; omega

theorem cyclesLoop_entries (o : RealizeOpts) (cs : List Change) (n : Nat) (s : RState) :
    (cyclesLoop o cs n s).entries.length = s.entries.length + n * cs.length ∧
    ∀ e ∈ (cyclesLoop o cs n s).entries, e ∈ s.entries ∨ e.index < cs.length := by
  induction n generalizing s with
  | zero => exact ⟨by simp [cyclesLoop], fun e he => Or.inl he⟩
  | succ n ih =>
    have h := ih (changesLoop o cs 0 s)
    have hc := changesLoop_entries o cs 0 s
    simp only [cyclesLoop]
    refine ⟨by rw [h.1, hc.1, Nat.succ_mul]; omega, ?_⟩
    intro e he
    rcases h.2 e he with hm | hm
    · rcases hc.2 e hm with hm | hm
      · exact Or.inl hm
      · right; omega
    · exact Or.inr hm

/-- progression.test.ts:138 "repeats the cycle without repeating the changes":
    `cycles × changes.length` entries; and progression.ts:385 `changeOf` =
    `chart.changes[e.index]` never indexes out of bounds. -/
theorem entries_count_and_indices (p : Progression) (o : RealizeOpts) :
    (realizeNotes p o).entries.length = o.cycles * p.changes.length ∧
    ∀ e ∈ (realizeNotes p o).entries, e.index < p.changes.length := by
  have h := cyclesLoop_entries o p.changes o.cycles { notes := [], entries := [], t := 0 }
  refine ⟨by simpa [realizeNotes] using h.1, ?_⟩
  intro e he
  rcases h.2 e he with hm | hm
  · simp at hm
  · exact hm

/-! ### Positive lengths -/

theorem changesLoop_pos (o : RealizeOpts) (cs : List Change) (i : Nat) (s : RState)
    (hb : 0 < o.beatSec) (hc : ∀ c ∈ cs, 0 < c.beats) (hs : ∀ e ∈ s.entries, e.at_ < e.until_) :
    ∀ e ∈ (changesLoop o cs i s).entries, e.at_ < e.until_ := by
  induction cs generalizing i s with
  | nil => exact hs
  | cons c cs ih =>
    apply ih (i + 1) (changeStep o c i s) (fun c' h' => hc c' (List.mem_cons_of_mem _ h'))
    intro e he
    rw [changeStep_entries] at he
    rcases List.mem_append.mp he with hm | hm
    · exact hs e hm
    · rw [List.mem_singleton] at hm; subst hm
      have := Rat.mul_pos (hc c (List.mem_cons_self ..)) hb
      simp only
      grind

theorem cyclesLoop_pos (o : RealizeOpts) (cs : List Change) (n : Nat) (s : RState)
    (hb : 0 < o.beatSec) (hc : ∀ c ∈ cs, 0 < c.beats) (hs : ∀ e ∈ s.entries, e.at_ < e.until_) :
    ∀ e ∈ (cyclesLoop o cs n s).entries, e.at_ < e.until_ := by
  induction n generalizing s with
  | zero => exact hs
  | succ n ih => exact ih _ (changesLoop_pos o cs 0 s hb hc hs)

/-- HOLDS ONLY UNDER HYPOTHESES THE CODE DOES NOT ENFORCE: `beatSec > 0` and
    every change's `beats > 0`. Then every chart entry has positive length.
    (True of the one real caller: `realize(p)` at main.ts:785 uses the default
    `beatSec` 0.5, and `repertoire_beats_positive` below covers the data.) -/
theorem entries_positive (p : Progression) (o : RealizeOpts)
    (hb : 0 < o.beatSec) (hc : ∀ c ∈ p.changes, 0 < c.beats) :
    ∀ e ∈ (realizeNotes p o).entries, e.at_ < e.until_ :=
  cyclesLoop_pos o p.changes o.cycles _ hb hc (by intro e he; simp at he)

/-! ## The repertoire's `beats` -/

/-- Every `beats` in `REPERTOIRE` (repertoire.ts:370), one list per
    progression in source order. Dumped from the real module by
    `proofs/repro/progression_repertoire_beats.ts`, which prints this literal. -/
def REPERTOIRE_BEATS : List (List Nat) := [
  [8, 4, 4, 4, 4, 4, 4, 8],
  [8, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4],
  [4, 4],
  [4, 4],
  [4, 4],
  [4, 4, 8],
  [4, 4, 8],
  [4, 4, 4, 4],
  [4, 4, 4, 4],
  [4, 4, 4, 4],
  [4, 4, 4, 4],
  [4, 4, 4, 4, 4, 4, 4, 4],
  [4, 4, 4, 4],
  [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4],
  [4, 4, 4, 4, 4, 4, 4, 4],
  [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4],
  [4, 4, 4, 2, 2, 4, 4, 4, 4, 4, 4, 4, 4],
  [4, 4, 8],
  [4, 4, 8],
  [4, 4, 4, 4],
  [2, 2, 2, 2, 2, 2, 2, 2],
  [4, 4, 8],
  [4, 4, 4, 4],
  [2, 2, 2, 2, 4, 2, 2],
  [2, 2, 2, 2, 2, 2, 2, 2, 4, 4, 4, 4],
  [8, 8],
  [4, 4, 4, 4],
  [4, 4, 4, 4],
  [4, 4, 4, 4],
  [8, 8],
  [8, 8],
  [4, 4, 4, 4, 4, 4, 4, 4],
  [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
  [4, 4, 4, 4, 4, 4],
  [4, 4, 4, 4, 4],
  [4, 4, 4, 4],
  [4, 4, 4, 4, 4, 4, 4, 4, 4],
  [4, 4, 4, 4, 4, 4, 4, 4, 4],
  [4, 4, 4, 4, 4, 4, 4, 4, 4],
  [4, 4, 4, 4],
  [4, 4, 4, 4],
  [4, 4, 4, 4]
]

/-- What `realize` needs of the data: every change in the repertoire lasts a
    positive number of beats, and no progression is empty. -/
theorem repertoire_beats_positive :
    REPERTOIRE_BEATS.length = 42 ∧
    ∀ bs ∈ REPERTOIRE_BEATS, bs ≠ [] ∧ ∀ b ∈ bs, 0 < b := by
  decide

/-- repertoire.ts:7/progression.ts:233 "The repertoire is written in common
    time, so a bar is four beats": every progression is a whole number of
    four-beat bars, so each cycle starts on a barline. -/
theorem repertoire_whole_bars : ∀ bs ∈ REPERTOIRE_BEATS, bs.sum % 4 = 0 := by
  decide

/-! ## realize: the barline loop -/

/-- The bar starts the loop has pushed after `n` iterations: 0, barSec, …,
    (n−1)·barSec. -/
def barStarts (barSec : Rat) (n : Nat) : List Rat :=
  (List.range n).map (fun k : Nat => (k : Rat) * barSec)

theorem barStarts_succ (barSec : Rat) (n : Nat) :
    barStarts barSec (n + 1) = barStarts barSec n ++ [(n : Rat) * barSec] := by
  simp [barStarts, List.range_succ]

theorem natCast_succ_mul (n : Nat) (x : Rat) : ((n + 1 : Nat) : Rat) * x = (n : Rat) * x + x := by
  rw [Rat.natCast_add]; simp; grind

/-- From the state after `n ≥ 1` iterations, if `n + m` bars are enough to
    reach `t`, the loop exits, having pushed `n'` bar starts where `n'` is the
    FIRST count (from `n`) with `n'·barSec ≥ t`. -/
theorem barLoop_exits (t barSec : Rat) (m : Nat) :
    ∀ n : Nat, 1 ≤ n → t ≤ ((n + m : Nat) : Rat) * barSec →
      ∃ fuel n', n ≤ n' ∧
        barLoop t barSec fuel ((n : Rat) * barSec) (barStarts barSec n) = some (barStarts barSec n') ∧
        t ≤ (n' : Rat) * barSec ∧ (n' = n ∨ ((n' - 1 : Nat) : Rat) * barSec < t) := by
  induction m with
  | zero =>
    intro n hn ht
    refine ⟨1, n, Nat.le_refl _, ?_, by simpa using ht, Or.inl rfl⟩
    have h1 : ¬ ((n : Rat) * barSec < t) := by simp at ht; grind
    have h2 : ¬ ((barStarts barSec n).length = 0) := by simp [barStarts]; omega
    simp [barLoop, h1, h2]
  | succ m ih =>
    intro n hn ht
    by_cases hlt : (n : Rat) * barSec < t
    · have ht' : t ≤ ((n + 1 + m : Nat) : Rat) * barSec := by
        have : n + 1 + m = n + (m + 1) := by omega
        rw [this]; exact ht
      obtain ⟨fuel, n', hn', hloop, hcov, htight⟩ := ih (n + 1) (by omega) ht'
      refine ⟨fuel + 1, n', by omega, ?_, hcov, ?_⟩
      · simp only [barLoop, hlt, true_or, ite_true]
        rw [← natCast_succ_mul, ← barStarts_succ]
        exact hloop
      · right
        rcases htight with e | h
        · subst e; simpa using hlt
        · exact h
    · refine ⟨1, n, Nat.le_refl _, ?_, by grind, Or.inl rfl⟩
      have h2 : ¬ ((barStarts barSec n).length = 0) := by simp [barStarts]; omega
      simp [barLoop, hlt, h2]

/-- The rationals are Archimedean: some whole number of bars reaches `t`. -/
theorem exists_bars_reaching (t barSec : Rat) (h : 0 < barSec) :
    ∃ m : Nat, t ≤ ((1 + m : Nat) : Rat) * barSec := by
  refine ⟨(t / barSec).ceil.toNat, ?_⟩
  have h1 : t / barSec ≤ ((t / barSec).ceil : Rat) := Rat.le_ceil
  have h2 : ((t / barSec).ceil : Rat) ≤ (((t / barSec).ceil.toNat : Int) : Rat) :=
    Rat.intCast_le_intCast.mpr (by omega)
  have h3 : t / barSec ≤ ((1 + (t / barSec).ceil.toNat : Nat) : Rat) := by
    rw [Rat.natCast_add]
    have : (((t / barSec).ceil.toNat : Int) : Rat) = (((t / barSec).ceil.toNat : Nat) : Rat) := rfl
    simp only [this] at h2
    simp
    grind
  have h4 := Rat.mul_le_mul_of_nonneg_right h3 (Rat.le_of_lt h)
  rwa [Rat.div_mul_cancel (Rat.ne_of_gt h)] at h4

/-- progression.ts:350-355, for a positive bar length: the loop terminates,
    and what it has collected (before the final push) is `0, barSec, …,
    (n−1)·barSec` for the first `n ≥ 1` with `n·barSec ≥ t`. -/
theorem barLoop_terminates (t barSec : Rat) (h : 0 < barSec) :
    ∃ fuel n, 1 ≤ n ∧ barLoop t barSec fuel 0 [] = some (barStarts barSec n) ∧
      t ≤ (n : Rat) * barSec ∧ (n = 1 ∨ ((n - 1 : Nat) : Rat) * barSec < t) := by
  obtain ⟨m, hm⟩ := exists_bars_reaching t barSec h
  obtain ⟨fuel, n, hn, hloop, hcov, htight⟩ := barLoop_exits t barSec m 1 (Nat.le_refl _) hm
  refine ⟨fuel + 1, n, hn, ?_, hcov, ?_⟩
  · have e1 : barStarts barSec 1 = [0] := by simp [barStarts]
    have e2 : ((1 : Nat) : Rat) * barSec = 0 + barSec := by simp [Rat.zero_add]
    simp only [barLoop, List.length_nil, or_true, ite_true, List.nil_append]
    rw [e1, e2] at hloop
    exact hloop
  · rcases htight with e | h'
    · exact Or.inl e
    · exact Or.inr h'

theorem barStarts_getLastD (barSec : Rat) (n : Nat) (hn : 1 ≤ n) :
    (barStarts barSec n).getLastD 0 + barSec = (n : Rat) * barSec := by
  obtain ⟨k, rfl⟩ : ∃ k, n = k + 1 := ⟨n - 1, by omega⟩
  rw [barStarts_succ, natCast_succ_mul]
  simp

/-- HOLDS ONLY UNDER A HYPOTHESIS THE CODE DOES NOT ENFORCE:
    `beatsPerBar * beatSec > 0`.

    progression.ts:255 "Bar boundaries in seconds, fence-post style";
    progression.ts:350 "bars on the beat grid, regardless of where the changes
    fall". With a positive bar length `realize` returns, and its barlines are
    exactly `0, barSec, 2·barSec, …, n·barSec` where `n ≥ 1` is the smallest
    count with `n·barSec ≥ duration`: they start at 0, are evenly spaced one
    bar apart, the last is at or after the end of the piece, and no bar starts
    at or after the end (except bar 0 of an empty piece). Each carries the
    meter and the home key's signature (progression.ts:257). -/
theorem realize_barlines (p : Progression) (o : RealizeOpts)
    (h : 0 < o.beatsPerBar * o.beatSec) :
    ∃ fuel r n, realize fuel p o = some r ∧ 1 ≤ n ∧
      r.notes = (realizeNotes p o).notes ∧ r.entries = (realizeNotes p o).entries ∧
      r.duration = (realizeNotes p o).t ∧
      r.barlines = (barStarts (o.beatsPerBar * o.beatSec) (n + 1)).map
        (fun b => { at_ := b, beats := o.beatsPerBar, unit := 4, fifths := keySignature p.home }) ∧
      r.duration ≤ (n : Rat) * (o.beatsPerBar * o.beatSec) ∧
      (n = 1 ∨ ((n - 1 : Nat) : Rat) * (o.beatsPerBar * o.beatSec) < r.duration) := by
  obtain ⟨fuel, n, hn, hloop, hcov, htight⟩ :=
    barLoop_terminates (realizeNotes p o).t (o.beatsPerBar * o.beatSec) h
  refine ⟨fuel,
    { notes := (realizeNotes p o).notes, entries := (realizeNotes p o).entries,
      duration := (realizeNotes p o).t,
      barlines := (barStarts (o.beatsPerBar * o.beatSec) n ++
          [(barStarts (o.beatsPerBar * o.beatSec) n).getLastD 0 + o.beatsPerBar * o.beatSec]).map
        (fun b => { at_ := b, beats := o.beatsPerBar, unit := 4, fifths := keySignature p.home }) },
    n, ?_, hn, rfl, rfl, rfl, ?_, hcov, htight⟩
  · simp only [realize, hloop]
  · simp only
    rw [barStarts_getLastD _ n hn, ← barStarts_succ]

/-- The fence posts are strictly increasing when the bar length is positive. -/
theorem barStarts_strictly_increasing (barSec : Rat) (n : Nat) (h : 0 < barSec) :
    (barStarts barSec n).Pairwise (· < ·) := by
  simp only [barStarts, List.pairwise_map]
  apply List.Pairwise.imp _ (List.pairwise_lt_range (n := n))
  intro a b hab
  obtain ⟨d, rfl⟩ : ∃ d, b = a + (d + 1) := ⟨b - a - 1, by omega⟩
  have hd : (0 : Rat) < ((d + 1 : Nat) : Rat) := Rat.natCast_pos.mpr (by omega)
  have := Rat.mul_pos hd h
  rw [Rat.natCast_add, Rat.add_mul]
  grind

/-- FAILS: `realize` returns (progression.ts:327 `): Realized`), when the bar
    length is zero or negative and the piece has positive duration.

    `b` starts at 0 and never increases, so `b < t` stays true: the loop at
    progression.ts:354 never exits, pushing onto `at` forever. No amount of
    fuel suffices. Nothing checks `beatSec` or `beatsPerBar`.
    Repro: `proofs/repro/progression_realize_degenerate.ts`. -/
theorem barLoop_never_exits (t barSec : Rat) (hbar : barSec ≤ 0) (ht : 0 < t) :
    ∀ (fuel : Nat) (b : Rat) (at_ : List Rat), b ≤ 0 → barLoop t barSec fuel b at_ = none := by
  intro fuel
  induction fuel with
  | zero => intro b at_ _; rfl
  | succ fuel ih =>
    intro b at_ hb
    have hlt : b < t := by grind
    simp only [barLoop, hlt, true_or, ite_true]
    exact ih _ _ (by grind)

theorem FAILS_realize_terminates (p : Progression) (o : RealizeOpts)
    (hbar : o.beatsPerBar * o.beatSec ≤ 0) (ht : 0 < (realizeNotes p o).t) :
    ∀ fuel, realize fuel p o = none := by
  intro fuel
  simp only [realize, barLoop_never_exits _ _ hbar ht fuel 0 [] (Rat.le_refl)]

theorem changesLoop_t (o : RealizeOpts) (cs : List Change) (i : Nat) (s : RState) :
    (changesLoop o cs i s).t = s.t + (cs.map (fun c => c.beats * o.beatSec)).sum := by
  induction cs generalizing i s with
  | nil => simp [changesLoop, Rat.add_zero]
  | cons c cs ih =>
    simp only [changesLoop, ih, List.map_cons, List.sum_cons]
    show s.t + c.beats * o.beatSec + _ = _
    grind

/-- The concrete instance: one four-beat chord, every option at its default
    except `beatsPerBar: 0`. The piece lasts 8 seconds and `realize` never
    returns. -/
theorem FAILS_realize_terminates_beatsPerBar_zero :
    let p : Progression :=
      { home := ⟨0, .major⟩,
        changes := [{ key := ⟨0, .major⟩, degree := .d1, mode := JoystickMode.default,
                      direction := .center, inversion := none, beats := 4 }] }
    let o : RealizeOpts := { DEFAULTS with beatsPerBar := 0 }
    (realizeNotes p o).t = 8 ∧ ∀ fuel, realize fuel p o = none := by
  intro p o
  have ht : (realizeNotes p o).t = 8 := by
    simp only [realizeNotes, cyclesLoop, changesLoop_t, p, o, DEFAULTS]
    decide +kernel
  refine ⟨ht, FAILS_realize_terminates p o ?_ ?_⟩
  · show (0 : Rat) * (1 / 2) ≤ 0
    decide +kernel
  · rw [ht]; decide +kernel

/-- FAILS: "fence-post" barlines that increase (progression.ts:255), when
    `beatSec` is 0. The loop does exit (`t` is 0), but the two barlines it
    returns are both at 0 — a bar of zero length — and every note has zero
    duration. Repro: `proofs/repro/progression_realize_degenerate.ts`. -/
theorem FAILS_barlines_increasing_beatSec_zero :
    let p : Progression :=
      { home := ⟨0, .major⟩,
        changes := [{ key := ⟨0, .major⟩, degree := .d1, mode := JoystickMode.default,
                      direction := .center, inversion := none, beats := 4 }] }
    let o : RealizeOpts := { DEFAULTS with beatSec := 0 }
    (realize 2 p o).map (fun r => (r.duration, r.barlines.map (·.at_))) = some (0, [0, 0]) := by
  decide +kernel

/-! ## entryAt, entryAfter -/

/-- progression.ts:371 "The entry covering score time `t` … Half-open on the
    right": whatever `entryAt` returns is an entry of the chart with
    `at ≤ t < until`. No hypothesis. -/
theorem entryAt_covers (es : List ChartEntry) (t : Rat) (e : ChartEntry)
    (h : entryAt es t = some e) : e ∈ es ∧ e.at_ ≤ t ∧ t < e.until_ := by
  simp only [entryAt] at h
  have hm := List.mem_of_find?_eq_some h
  have hp := List.find?_some h
  simp only [covers, Bool.and_eq_true, decide_eq_true_eq] at hp
  exact ⟨hm, hp.1, hp.2⟩

theorem Contig_bounds (a b : Rat) (es : List ChartEntry) (h : Contig a es b)
    (hpos : ∀ e ∈ es, e.at_ ≤ e.until_) :
    a ≤ b ∧ ∀ e ∈ es, a ≤ e.at_ ∧ e.until_ ≤ b := by
  induction es generalizing a with
  | nil => simp only [Contig] at h; subst h; exact ⟨Rat.le_refl, by simp⟩
  | cons e es ih =>
    obtain ⟨h1, h2⟩ := h
    have he := hpos e (List.mem_cons_self ..)
    have i := ih _ h2 (fun x hx => hpos x (List.mem_cons_of_mem _ hx))
    refine ⟨by grind, ?_⟩
    intro x hx
    rcases List.mem_cons.mp hx with rfl | hx
    · exact ⟨by grind, by grind⟩
    · have := i.2 x hx
      exact ⟨by grind, this.2⟩

/-- progression.ts:371 "… or null past the end"; progression.test.ts:168 "has
    nothing to say past the end". Outside `[start, end)` there is no entry —
    in particular at `t = duration` exactly. (Needs only that no entry has
    negative length.) -/
theorem entryAt_none_outside (a b : Rat) (es : List ChartEntry) (t : Rat)
    (h : Contig a es b) (hpos : ∀ e ∈ es, e.at_ ≤ e.until_) (ht : t < a ∨ b ≤ t) :
    entryAt es t = none := by
  simp only [entryAt, List.find?_eq_none]
  intro e he
  have := (Contig_bounds a b es h hpos).2 e he
  simp only [covers, Bool.and_eq_true, decide_eq_true_eq]
  grind

/-- The entry that covers `t` is found, and it is the only one: everything
    before it has already ended. -/
theorem entryAt_append (a b : Rat) (pre post : List ChartEntry) (e : ChartEntry) (t : Rat)
    (h : Contig a (pre ++ e :: post) b) (hpos : ∀ x ∈ pre, x.at_ ≤ x.until_)
    (hc : e.at_ ≤ t ∧ t < e.until_) :
    entryAt (pre ++ e :: post) t = some e := by
  obtain ⟨m, h1, h2⟩ := (Contig_append a b pre (e :: post)).mp h
  have hm : e.at_ = m := h2.1
  have hb := (Contig_bounds a m pre h1 hpos).2
  simp only [entryAt, List.find?_append]
  have hnone : pre.find? (covers t) = none := by
    rw [List.find?_eq_none]
    intro x hx
    have := hb x hx
    simp only [covers, Bool.and_eq_true, decide_eq_true_eq]
    grind
  have hcov : covers t e = true := by
    simp only [covers, Bool.and_eq_true, decide_eq_true_eq]; exact hc
  simp [hnone, hcov]

/-- progression.ts:371 "The entry covering score time `t`": on a chart whose
    entries have positive length, every `t` in `[start, end)` has one. -/
theorem entryAt_total (a b : Rat) (es : List ChartEntry) (t : Rat)
    (h : Contig a es b) (hpos : ∀ e ∈ es, e.at_ < e.until_) (ht : a ≤ t ∧ t < b) :
    ∃ e, entryAt es t = some e := by
  induction es generalizing a with
  | nil => simp only [Contig] at h; subst h; grind
  | cons e es ih =>
    obtain ⟨h1, h2⟩ := h
    by_cases hlt : t < e.until_
    · refine ⟨e, ?_⟩
      have hcov : covers t e = true := by
        simp only [covers, Bool.and_eq_true, decide_eq_true_eq]; grind
      simp [entryAt, hcov]
    · obtain ⟨e', he'⟩ := ih _ h2 (fun x hx => hpos x (List.mem_cons_of_mem _ hx)) ⟨by grind, ht.2⟩
      refine ⟨e', ?_⟩
      have hcov : covers t e = false := by
        simp only [covers, Bool.and_eq_false_iff, decide_eq_false_iff_not]; right; exact hlt
      simp only [entryAt] at he' ⊢
      simp [hcov, he']

/-- The two together, for the chart `realize` actually builds (under the same
    two hypotheses as `entries_positive`): every instant of the piece is
    covered by exactly the entry `entryAt` returns, whose `index` is a valid
    index into `chart.changes`. -/
theorem realize_entryAt_total (p : Progression) (o : RealizeOpts)
    (hb : 0 < o.beatSec) (hc : ∀ c ∈ p.changes, 0 < c.beats) (t : Rat)
    (ht : 0 ≤ t ∧ t < (realizeNotes p o).t) :
    ∃ e, entryAt (realizeNotes p o).entries t = some e ∧ e.at_ ≤ t ∧ t < e.until_ ∧
      e.index < p.changes.length := by
  obtain ⟨e, he⟩ := entryAt_total 0 _ _ t (entries_contiguous p o) (entries_positive p o hb hc) ht
  have hcov := entryAt_covers _ _ _ he
  exact ⟨e, he, hcov.2.1, hcov.2.2, (entries_count_and_indices p o).2 e hcov.1⟩

/-- FAILS without `beats > 0`: "The entry covering score time `t`"
    (progression.ts:371). A change of zero beats gets a chart entry `[t, t)`
    that covers no instant, so `entryAt` can never return it: with the default
    options, a one-change progression of 0 beats has four entries, all
    `[0, 0)`, and `entryAt(chart, 0)` is null.
    Repro: `proofs/repro/progression_realize_degenerate.ts`. Not reachable
    from the repertoire (`repertoire_beats_positive`). -/
theorem FAILS_entries_positive_beats_zero :
    let p : Progression :=
      { home := ⟨0, .major⟩,
        changes := [{ key := ⟨0, .major⟩, degree := .d1, mode := JoystickMode.default,
                      direction := .center, inversion := none, beats := 0 }] }
    (realizeNotes p DEFAULTS).entries.map (fun e => (e.at_, e.until_))
        = [(0, 0), (0, 0), (0, 0), (0, 0)] ∧
      (entryAt (realizeNotes p DEFAULTS).entries 0).isNone = true := by
  decide +kernel

/-- progression.ts:372 "a chord that ends exactly at the next one's onset is
    not still sounding there"; progression.test.ts:165 "the boundary belongs to
    the next". At the instant one entry ends, `entryAt` returns the NEXT one. -/
theorem entryAt_boundary (a b : Rat) (pre post : List ChartEntry) (e₁ e₂ : ChartEntry)
    (h : Contig a (pre ++ e₁ :: e₂ :: post) b)
    (hpos : ∀ x ∈ pre ++ e₁ :: e₂ :: post, x.at_ < x.until_) :
    entryAt (pre ++ e₁ :: e₂ :: post) e₁.until_ = some e₂ := by
  have e : pre ++ e₁ :: e₂ :: post = (pre ++ [e₁]) ++ e₂ :: post := by simp
  rw [e] at h hpos ⊢
  obtain ⟨m, h1, h2⟩ := (Contig_append a b (pre ++ [e₁]) (e₂ :: post)).mp h
  obtain ⟨m', _, h4⟩ := (Contig_append a m pre [e₁]).mp h1
  have hm : e₁.until_ = m := h4.2
  have hat : e₂.at_ = m := h2.1
  apply entryAt_append a b _ _ _ _ h
  · intro x hx; exact Rat.le_of_lt (hpos x (List.mem_append_left _ hx))
  · have := hpos e₂ (by simp)
    grind

theorem findIdx_append (pre post : List ChartEntry) (e : ChartEntry) (q : ChartEntry → Bool)
    (hpre : ∀ x ∈ pre, q x = false) (he : q e = true) :
    (pre ++ e :: post).findIdx? q = some pre.length := by
  induction pre with
  | nil => simp [List.findIdx?_cons, he]
  | cons x xs ih =>
    have hx := hpre x (List.mem_cons_self ..)
    have i := ih (fun y hy => hpre y (List.mem_cons_of_mem _ hy))
    simp [List.findIdx?_cons, hx, i]

/-- progression.ts:378 "The entry after the one covering `t`. Null at the end":
    it is exactly the next entry in the list (which begins where the covering
    one ends), and `none` when the covering entry is the last.
    progression.test.ts:173, 180. -/
theorem entryAfter_next (a b : Rat) (pre post : List ChartEntry) (e : ChartEntry) (t : Rat)
    (h : Contig a (pre ++ e :: post) b) (hpos : ∀ x ∈ pre, x.at_ ≤ x.until_)
    (hc : e.at_ ≤ t ∧ t < e.until_) :
    entryAfter (pre ++ e :: post) t = post.head? ∧
    ∀ nxt, post.head? = some nxt → nxt.at_ = e.until_ := by
  obtain ⟨m, h1, h2⟩ := (Contig_append a b pre (e :: post)).mp h
  have hm : e.at_ = m := h2.1
  have hb := (Contig_bounds a m pre h1 hpos).2
  have hpre : ∀ x ∈ pre, covers t x = false := by
    intro x hx
    have := hb x hx
    simp only [covers, Bool.and_eq_false_iff, decide_eq_false_iff_not]
    right; grind
  have hcov : covers t e = true := by
    simp only [covers, Bool.and_eq_true, decide_eq_true_eq]; exact hc
  constructor
  · simp only [entryAfter, findIdx_append pre post e _ hpre hcov]
    cases post <;> simp
  · intro nxt hn
    cases post with
    | nil => simp at hn
    | cons x xs =>
      simp only [List.head?_cons, Option.some.injEq] at hn
      subst hn
      exact h2.2.1

/-- progression.test.ts:168: no entry covers `t` → `entryAfter` is null too. -/
theorem entryAfter_none (es : List ChartEntry) (t : Rat) (h : entryAt es t = none) :
    entryAfter es t = none := by
  simp only [entryAt, List.find?_eq_none] at h
  have : es.findIdx? (covers t) = none := by
    rw [List.findIdx?_eq_none_iff]
    intro x hx; simpa using h x hx
  simp [entryAfter, this]

end Harmonicland.Progression
