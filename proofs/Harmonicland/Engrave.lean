/-
ENGRAVE — a model of the pure logic in
  src/outputs/engrave.ts     (spelling in a key, printed accidentals, snap, valuesFor,
                              a note's span in a bar, the rest-splitting loop)
  src/outputs/staff-std.ts   (posOf / posFromMiddleC, ledgers)
  src/outputs/strays.ts      (ledgerPositions)
with the three leaf facts of src/pitch.ts they stand on (semi, octaveOf, octaveFor)
redeclared locally so the file is self-contained.

Translation notes
* A JS number that is a pitch, an octave, a staff position or a count of fifths is an
  `Int`; one that is seconds or quarters is a `Rat`.
* `Math.round x` is `⌊x + 1/2⌋` (JS rounds halves up), `Math.floor` is `Rat.floor`,
  `Math.abs` is `Rat.abs`, JS `%` is `Int.tmod`.
* `EPS = 1e-6` is the exact rational 1/1000000.
* A `while`/`for` loop is a recursive function whose termination Lean has checked
  (`termination_by`), so "the loop terminates for every input" is established by the
  definition being accepted.
* `Array.prototype.sort` is stable, and the output of a stable sort is fixed by its
  comparator, so it is modelled by `stableSort`, a stable insertion sort the kernel can
  evaluate (core's `List.mergeSort` is the same function but does not reduce under
  `decide`). `le a b` is "the comparator does not put `b` before `a`", `cmp(a, b) <= 0`.
* Concrete evaluations use `decide +kernel`: the kernel evaluates the model. Nothing here
  uses `native_decide`.

Left out: floating-point rounding (every time is an exact rational), NaN, Infinity, the
DOM, SVG strings. Not modelled from engrave.ts: columns, beams, and the merging of a
staff's head spans into gaps (lines 285-299) — the rest theorems are about ONE gap, and
the note theorems about ONE note, so "a staff's values add up to the bar" is established
per note and per gap, not assembled for a whole bar. `Bar.fifths` is an integer here; a MusicXML `<fifths>2.5</fifths>`
would be a non-integer and is outside the model.
-/
namespace Harmonicland.Engrave

/-! ## Pitch and spelling (src/types.ts:14-32, src/pitch.ts) -/

-- src/types.ts:14
inductive Letter where
  | C | D | E | F | G | A | B
  deriving DecidableEq, Repr

-- src/types.ts:18   "" | "#" | "b"
inductive Accidental where
  | none | sharp | flat
  deriving DecidableEq, Repr

-- src/types.ts:29
structure Spelling where
  letter : Letter
  acc : Accidental
  deriving DecidableEq, Repr

-- src/pitch.ts:48
structure Spelt where
  letter : Letter
  acc : Accidental
  octave : Int
  deriving DecidableEq, Repr

-- src/pitch.ts:25   ((p % 12) + 12) % 12, with JS's truncating %
def semi (p : Int) : Int := Int.tmod (Int.tmod p 12 + 12) 12

-- src/pitch.ts:41   Math.floor(p / 12) - 1
def octaveOf (p : Int) : Int := p / 12 - 1

-- src/pitch.ts:57
def octaveFor (pitch : Int) (sp : Spelling) : Int :=
  let oct := octaveOf pitch
  let oct := if sp.letter = .B ∧ sp.acc = .sharp then oct - 1 else oct
  let oct := if sp.letter = .C ∧ sp.acc = .flat then oct + 1 else oct
  oct

/-- What a letter means in semitones above C — `STEP_SEMI` (src/inputs/musicxml.ts:35),
    `SEMI` (src/inputs/lily.ts:27). The yardstick the spelling claims are measured by. -/
def letterSemi : Letter → Int
  | .C => 0 | .D => 2 | .E => 4 | .F => 5 | .G => 7 | .A => 9 | .B => 11

/-- What a single accidental does to a letter. -/
def alt : Accidental → Int
  | .none => 0 | .sharp => 1 | .flat => -1

/-- A written note (letter, accidental, the LETTER's octave) names MIDI pitch `pitch`:
    the same formula both text parsers use to go the other way
    (src/inputs/musicxml.ts:164, src/inputs/lily.ts:139). -/
def Denotes (s : Spelt) (pitch : Int) : Prop :=
  12 * (s.octave + 1) + letterSemi s.letter + alt s.acc = pitch

theorem semi_eq_emod (p : Int) : semi p = p % 12 := by
  unfold semi
  have h1 := Int.lt_tmod_of_pos p (b := 12) (by decide)
  have h2 := Int.tmod_lt_of_pos p (b := 12) (by decide)
  rw [Int.tmod_eq_emod_of_nonneg (by omega)]
  have h3 : Int.tmod p 12 = p - 12 * p.tdiv 12 := Int.tmod_def p 12
  omega

/-- src/pitch.ts:24 "Pitch class, 0–11, correct for negative pitches too." -/
theorem semi_range (p : Int) : 0 ≤ semi p ∧ semi p < 12 := by
  rw [semi_eq_emod]; omega

/-! ## Key signatures (src/outputs/engrave.ts:168-203) -/

-- src/outputs/engrave.ts:171
def SHARPS : List Letter := [.F, .C, .G, .D, .A, .E, .B]

-- src/outputs/engrave.ts:174
def keyAccidental (fifths : Int) (letter : Letter) : Accidental :=
  if fifths > 0 ∧ (SHARPS.idxOf letter : Int) < fifths then .sharp
  else if fifths < 0 ∧ (SHARPS.length : Int) - (SHARPS.idxOf letter : Int) ≤ -fifths then .flat
  else .none

-- src/outputs/engrave.ts:182
def SHARP_SP : List Spelling := [
  ⟨.C, .none⟩, ⟨.C, .sharp⟩, ⟨.D, .none⟩, ⟨.D, .sharp⟩,
  ⟨.E, .none⟩, ⟨.F, .none⟩, ⟨.F, .sharp⟩, ⟨.G, .none⟩,
  ⟨.G, .sharp⟩, ⟨.A, .none⟩, ⟨.A, .sharp⟩, ⟨.B, .none⟩]

-- src/outputs/engrave.ts:187
def FLAT_SP : List Spelling := [
  ⟨.C, .none⟩, ⟨.D, .flat⟩, ⟨.D, .none⟩, ⟨.E, .flat⟩,
  ⟨.E, .none⟩, ⟨.F, .none⟩, ⟨.G, .flat⟩, ⟨.G, .none⟩,
  ⟨.A, .flat⟩, ⟨.A, .none⟩, ⟨.B, .flat⟩, ⟨.B, .none⟩]

/-- `TABLE[pc]`. The default stands for JS `undefined`, which `semi_range` rules out. -/
def at12 (t : List Spelling) (pc : Int) : Spelling := t.getD pc.toNat ⟨.C, .none⟩

-- src/outputs/engrave.ts:200-201   the choice between the two candidates
def pick (fifths : Int) (sharp flat : Spelling) : Spelling :=
  ([sharp, flat].find? (fun c => c.acc ≠ .none ∧ keyAccidental fifths c.letter = c.acc)).getD
    (if fifths < 0 then flat else sharp)

-- src/outputs/engrave.ts:197
def spellIn (pitch fifths : Int) : Spelt :=
  let pc := semi pitch
  let sharp := at12 SHARP_SP pc
  let flat := at12 FLAT_SP pc
  let sp := pick fifths sharp flat
  { letter := sp.letter, acc := sp.acc, octave := octaveFor pitch sp }

theorem pick_cases (fifths : Int) (sharp flat : Spelling) :
    pick fifths sharp flat = sharp ∨ pick fifths sharp flat = flat := by
  unfold pick
  simp only [List.find?]
  split <;> (try split) <;> (try split) <;> simp

/-- Both table entries for a pitch denote that pitch once `octaveFor` gives the octave. -/
theorem table_denotes (pitch : Int) :
    Denotes ⟨(at12 SHARP_SP (semi pitch)).letter, (at12 SHARP_SP (semi pitch)).acc,
              octaveFor pitch (at12 SHARP_SP (semi pitch))⟩ pitch ∧
    Denotes ⟨(at12 FLAT_SP (semi pitch)).letter, (at12 FLAT_SP (semi pitch)).acc,
              octaveFor pitch (at12 FLAT_SP (semi pitch))⟩ pitch := by
  rw [semi_eq_emod]
  have h : pitch % 12 = 0 ∨ pitch % 12 = 1 ∨ pitch % 12 = 2 ∨ pitch % 12 = 3 ∨
      pitch % 12 = 4 ∨ pitch % 12 = 5 ∨ pitch % 12 = 6 ∨ pitch % 12 = 7 ∨
      pitch % 12 = 8 ∨ pitch % 12 = 9 ∨ pitch % 12 = 10 ∨ pitch % 12 = 11 := by omega
  rcases h with h | h | h | h | h | h | h | h | h | h | h | h <;>
    (rw [h]; simp [at12, SHARP_SP, FLAT_SP, Denotes, octaveFor, octaveOf, letterSemi, alt]; omega)

/-- CLAIM (src/outputs/engrave.ts:193 "How a bare pitch is written in a key"; pitch.ts:46
    "A note as it is written: letter, accidental, and the octave the LETTER is in"):
    the spelling `spellIn` returns really is a name for the pitch it was given — letter,
    accidental and octave together — for EVERY integer pitch and EVERY integer `fifths`,
    not only pitches 0..127 and key signatures −7..7. -/
theorem spellIn_denotes (pitch fifths : Int) : Denotes (spellIn pitch fifths) pitch := by
  have ht := table_denotes pitch
  unfold spellIn
  rcases pick_cases fifths (at12 SHARP_SP (semi pitch)) (at12 FLAT_SP (semi pitch)) with h | h
  · simp only [h]; exact ht.1
  · simp only [h]; exact ht.2

/-- CLAIM (src/outputs/engrave.ts:180 "a white key has only its own letter"): a white key
    is written as its own natural letter in every key, whatever the signature says. -/
theorem spellIn_white (pitch fifths : Int)
    (hw : semi pitch ∉ [1, 3, 6, 8, 10]) : (spellIn pitch fifths).acc = .none := by
  have hr := semi_range pitch
  have h : semi pitch = 0 ∨ semi pitch = 2 ∨ semi pitch = 4 ∨ semi pitch = 5 ∨
      semi pitch = 7 ∨ semi pitch = 9 ∨ semi pitch = 11 := by
    simp at hw; omega
  unfold spellIn
  rcases h with h | h | h | h | h | h | h <;>
    (rw [h]; simp [at12, SHARP_SP, FLAT_SP, pick, List.find?])

/-- Is `c` a spelling "the key signature already says"? (engrave.ts:200) -/
def InKey (fifths : Int) (c : Spelling) : Prop :=
  c.acc ≠ .none ∧ keyAccidental fifths c.letter = c.acc

instance (fifths : Int) (c : Spelling) : Decidable (InKey fifths c) := by
  unfold InKey; exact inferInstance

/-- CLAIM (src/outputs/engrave.ts:193-195 "the spelling the key signature already says when
    one of them does"): if either candidate is in the key, the one chosen is. -/
theorem pick_in_key (fifths : Int) (sharp flat : Spelling)
    (h : InKey fifths sharp ∨ InKey fifths flat) : InKey fifths (pick fifths sharp flat) := by
  unfold pick InKey at *
  simp only [List.find?]
  by_cases hs : sharp.acc ≠ .none ∧ keyAccidental fifths sharp.letter = sharp.acc
  · simp [hs]
  · have hf : flat.acc ≠ .none ∧ keyAccidental fifths flat.letter = flat.acc := by
      rcases h with h | h
      · exact absurd h hs
      · exact h
    simp [hs, hf]

/-- CLAIM (src/outputs/engrave.ts:195 "else a black key by the key's own side of the circle
    — sharps from C up, flats below"). -/
theorem pick_side (fifths : Int) (sharp flat : Spelling)
    (hs : ¬ InKey fifths sharp) (hf : ¬ InKey fifths flat) :
    pick fifths sharp flat = if fifths < 0 then flat else sharp := by
  unfold pick InKey at *
  simp only [List.find?]
  simp [hs, hf]

/-- The tests of src/outputs/engrave.test.ts:249-259, as a check on the model. -/
theorem spellIn_tests :
    spellIn 66 2 = ⟨.F, .sharp, 4⟩ ∧ spellIn 70 (-1) = ⟨.B, .flat, 4⟩ ∧
    spellIn 63 (-3) = ⟨.E, .flat, 4⟩ ∧ spellIn 61 0 = ⟨.C, .sharp, 4⟩ ∧
    spellIn 61 (-1) = ⟨.D, .flat, 4⟩ ∧ spellIn 65 2 = ⟨.F, .none, 4⟩ := by
  decide +kernel

/-- CLAIM (src/outputs/engrave.ts:170 "Sharps in the order they are written, F C G D A E B;
    flats the reverse"; engrave.test.ts:223 "reads the key signature round the circle"):
    for every real key signature, −7..7, exactly `|fifths|` letters are altered, all the
    same way, and they are the first `fifths` of F C G D A E B (the last `−fifths` for
    flats). -/
theorem keyAccidental_circle :
    ∀ f ∈ ([-7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7] : List Int),
      ∀ i ∈ [0, 1, 2, 3, 4, 5, 6],
        keyAccidental f (SHARPS.getD i .C) =
          (if 0 < f ∧ (i : Int) < f then Accidental.sharp
           else if f < 0 ∧ (7 : Int) - i ≤ -f then Accidental.flat else Accidental.none) := by
  decide +kernel

/-- What `keyAccidental` does past the circle: `|fifths| ≥ 7` is all seven letters altered,
    so a `fifths` of 8 (LilyPond `\key gis \major`, src/inputs/lily.ts:317) or 100 (a MIDI
    key-signature byte, src/inputs/midi.ts:106) reads as 7. Total, never an error. -/
theorem keyAccidental_saturates (f : Int) (l : Letter) :
    (7 ≤ f → keyAccidental f l = .sharp) ∧ (f ≤ -7 → keyAccidental f l = .flat) := by
  have hi : 0 ≤ (SHARPS.idxOf l : Int) ∧ (SHARPS.idxOf l : Int) ≤ 6 := by cases l <;> decide
  have hl : (SHARPS.length : Int) = 7 := by decide
  unfold keyAccidental
  rw [hl]
  constructor
  · intro h
    split
    · rfl
    · exfalso; omega
  · intro h
    split
    · exfalso; omega
    · split
      · rfl
      · exfalso; omega

/-! ## Octaves and staff positions (src/pitch.ts:54-62, src/outputs/staff-std.ts:28-47) -/

-- src/outputs/staff-std.ts:28
def LETTER : Letter → Int
  | .C => 0 | .D => 1 | .E => 2 | .F => 3 | .G => 4 | .A => 5 | .B => 6

-- src/outputs/staff-std.ts:41
def C4_STEP : Int := LETTER .C + 7 * 4

-- src/outputs/staff-std.ts:47
def posOf (s : Spelt) : Int := LETTER s.letter + 7 * s.octave - C4_STEP

/-- How a parser collapses an alteration to one glyph (src/inputs/musicxml.ts:167,
    src/inputs/lily.ts:140): `alter > 0 ? "#" : alter < 0 ? "b" : ""`. -/
def accOf (alter : Int) : Accidental :=
  if alter > 0 then .sharp else if alter < 0 then .flat else .none

/-- CLAIM (src/pitch.ts:54 "Octave for a spelling. B♯ and C♭ cross the octave boundary: B♯3
    is the same key as C4, and C♭4 the same as B3. Handled simply — double accidentals
    collapse to one glyph anyway."): for a note written with letter `l` in octave `o` and
    altered by up to a double sharp or flat, `octaveFor` recovers `o` from the MIDI pitch
    the parsers compute (musicxml.ts:164, lily.ts:139). So the notehead goes on the line
    the source wrote it on.

    HYPOTHESIS the code does not enforce: `|alter| ≤ 2`. See `FAILS_octaveFor_triple`. -/
theorem octaveFor_written (l : Letter) (o alter : Int) (h : -2 ≤ alter ∧ alter ≤ 2) :
    octaveFor (12 * (o + 1) + letterSemi l + alter) ⟨l, accOf alter⟩ = o := by
  have ha : alter = -2 ∨ alter = -1 ∨ alter = 0 ∨ alter = 1 ∨ alter = 2 := by omega
  rcases ha with rfl | rfl | rfl | rfl | rfl <;> cases l <;>
    simp [octaveFor, octaveOf, letterSemi, accOf] <;> omega

/-- …and so `posOf` puts it on the written letter's row. -/
theorem posOf_written (l : Letter) (o alter : Int) (h : -2 ≤ alter ∧ alter ≤ 2) :
    posOf ⟨l, accOf alter, octaveFor (12 * (o + 1) + letterSemi l + alter) ⟨l, accOf alter⟩⟩
      = LETTER l + 7 * (o - 4) := by
  rw [octaveFor_written l o alter h]
  simp [posOf, C4_STEP, LETTER]; omega

/-- FAILS without the hypothesis: A with a triple sharp in octave 4 is MIDI 72; `octaveFor`
    answers 5, so the head is drawn an octave (7 positions) above where it was written.
    Reachable only from a MusicXML `<alter>3</alter>` or a LilyPond `aisisis`, which real
    notation does not use. Repro: proofs/repro/Engrave_octaveFor_triple.ts -/
theorem FAILS_octaveFor_triple :
    ¬ (∀ (l : Letter) (o alter : Int),
        octaveFor (12 * (o + 1) + letterSemi l + alter) ⟨l, accOf alter⟩ = o) := by
  intro h
  have := h .A 4 3
  revert this
  decide +kernel

/-- CLAIM (src/outputs/staff-std.ts:8-12 "anchored at middle C = position 0. treble lines
    E4 G4 B4 D5 F5 -> +2 +4 +6 +8 +10; bass lines G2 B2 D3 F3 A3 -> -10 -8 -6 -4 -2"). -/
theorem posOf_staff_lines :
    posOf ⟨.C, .none, 4⟩ = 0 ∧
    [posOf ⟨.E, .none, 4⟩, posOf ⟨.G, .none, 4⟩, posOf ⟨.B, .none, 4⟩,
     posOf ⟨.D, .none, 5⟩, posOf ⟨.F, .none, 5⟩] = [2, 4, 6, 8, 10] ∧
    [posOf ⟨.G, .none, 2⟩, posOf ⟨.B, .none, 2⟩, posOf ⟨.D, .none, 3⟩,
     posOf ⟨.F, .none, 3⟩, posOf ⟨.A, .none, 3⟩] = [-10, -8, -6, -4, -2] := by
  decide +kernel

/-- CLAIM (src/outputs/staff-std.ts:5 "C# and Db are the same key but sit on different
    rows"; pitch.ts:54 "B♯3 is the same key as C4"): the same MIDI pitch, spelled two ways,
    is one row apart, and B♯ sits BELOW the C it sounds as. -/
theorem posOf_enharmonic (pitch : Int) :
    -- C♯ and D♭ of any octave
    (semi pitch = 1 →
      posOf ⟨.D, .flat, octaveFor pitch ⟨.D, .flat⟩⟩ =
        posOf ⟨.C, .sharp, octaveFor pitch ⟨.C, .sharp⟩⟩ + 1) ∧
    -- B♯ and C of any octave
    (semi pitch = 0 →
      posOf ⟨.B, .sharp, octaveFor pitch ⟨.B, .sharp⟩⟩ =
        posOf ⟨.C, .none, octaveFor pitch ⟨.C, .none⟩⟩ - 1) := by
  simp [posOf, octaveFor, octaveOf, LETTER, C4_STEP]; omega

/-- A stray is drawn where a score note of the same spelling would be: `straysAt`
    (src/outputs/strays.ts:58-59) takes `posOf (spellIn pitch fifths)`, and by
    `spellIn_denotes` that spelling's letter and octave name the pitch. Stated as: two
    pitches a whole octave apart are spelled seven positions apart in every key. -/
theorem spellIn_octave_up (pitch fifths : Int) :
    posOf (spellIn (pitch + 12) fifths) = posOf (spellIn pitch fifths) + 7 := by
  have hs : semi (pitch + 12) = semi pitch := by
    rw [semi_eq_emod, semi_eq_emod]; omega
  unfold spellIn
  rw [hs]
  simp only [posOf, octaveFor, octaveOf]
  have : (pitch + 12) / 12 = pitch / 12 + 1 := by omega
  rw [this]
  split <;> split <;> omega

/-! ## staffOf (src/outputs/engrave.ts:127) -/

inductive Staff where
  | treble | bass
  deriving DecidableEq, Repr

inductive Hand where
  | upper | lower
  deriving DecidableEq, Repr

-- src/outputs/engrave.ts:127
def staffOf (hand : Option Hand) (pitch : Int) : Staff :=
  if hand = some .lower then .bass
  else if hand = some .upper then .treble
  else if pitch < 60 then .bass else .treble

/-- CLAIM (src/outputs/engrave.ts:41 "The parser's hand when it gave one; otherwise middle C
    and up goes on the treble staff"). -/
theorem staffOf_spec (hand : Option Hand) (pitch : Int) :
    (hand = some .lower → staffOf hand pitch = .bass) ∧
    (hand = some .upper → staffOf hand pitch = .treble) ∧
    (hand = none → (staffOf hand pitch = .treble ↔ 60 ≤ pitch)) := by
  refine ⟨?_, ?_, ?_⟩
  · intro h; simp [staffOf, h]
  · intro h; simp [staffOf, h]
  · intro h; subst h; simp only [staffOf]
    by_cases hp : pitch < 60 <;> simp [hp] <;> omega

/-! ## A stable sort -/

def insertStable {α : Type} (le : α → α → Bool) (x : α) : List α → List α
  | [] => [x]
  | y :: t => if le x y then x :: y :: t else y :: insertStable le x t

/-- `xs.sort(cmp)` with `le a b := cmp(a, b) <= 0`. -/
def stableSort {α : Type} (le : α → α → Bool) : List α → List α
  | [] => []
  | x :: t => insertStable le x (stableSort le t)

/-! ## Printed accidentals (src/outputs/engrave.ts:205-218 and 262-273)

A head, as far as the accidental rule can see it: where it is, how it is spelled, and the
two things `engraveBar` and `printedAt` sort by. -/

structure Head where
  /-- Quarters from the start of the bar. -/
  q : Rat
  pitch : Int
  staff : Staff
  /-- `valueKey` (engrave.ts:222), any injective code for the note value. -/
  value : Nat
  letter : Letter
  /-- The LETTER's octave: `spell(h.note).octave`. -/
  octave : Int
  acc : Accidental
  tiedFrom : Bool
  deriving DecidableEq, Repr

/-- The printed accidental: "" | "#" | "b" | "n" (engrave.ts:60). -/
inductive Printed where
  | nothing | sharp | flat | natural
  deriving DecidableEq, Repr

-- `sp.acc || "n"` (engrave.ts:217, 272)
def orNatural : Accidental → Printed
  | .none => .natural | .sharp => .sharp | .flat => .flat

/-- What is in force for `(letter, octave)` after the heads `hs`, in that order, starting
    from what the key signature says: the loop of engrave.ts:213-216, and the
    `inForce` map of engrave.ts:265-270 read back for one key. -/
def implied (k0 : Accidental) (letter : Letter) (octave : Int) : List Head → Accidental
  | [] => k0
  | h :: t => implied (if h.letter = letter ∧ h.octave = octave then h.acc else k0) letter octave t

-- engrave.ts:217, 271-272   `sp.acc === implied ? "" : sp.acc || "n"`
def printedGiven (imp acc : Accidental) : Printed :=
  if acc = imp then .nothing else orNatural acc

-- engrave.ts:260   heads.sort((a, b) => a.q - b.q || a.note.pitch - b.note.pitch)
def leHead (a b : Head) : Bool := a.q < b.q || (a.q == b.q && a.pitch ≤ b.pitch)
def engraveOrder (heads : List Head) : List Head := stableSort leHead heads

def EPS : Rat := 1 / 1000000

/-- The accidental `engraveBar` prints on a head spelled `(letter, octave, acc)` that is
    not tied over and sorts after every head at or before `q` (engrave.ts:266-273): what
    the heads so far, in `engraveBar`'s own order, leave in force. -/
def engravePrints (fifths : Int) (heads : List Head) (q : Rat)
    (letter : Letter) (octave : Int) (acc : Accidental) : Printed :=
  printedGiven
    (implied (keyAccidental fifths letter) letter octave
      ((engraveOrder heads).filter (fun h => h.q ≤ q + EPS)))
    acc

/-- A chord: one staff, instant and value (engrave.ts:78). -/
structure Chord where
  staff : Staff
  q : Rat
  value : Nat
  heads : List Head
  deriving Repr

-- engrave.ts:328-334   the Map keyed `${staff}|${q}|${valueKey}`, in insertion order
def addToChords (cs : List Chord) (h : Head) : List Chord :=
  if cs.any (fun c => c.staff = h.staff ∧ c.q = h.q ∧ c.value = h.value) then
    cs.map (fun c => if c.staff = h.staff ∧ c.q = h.q ∧ c.value = h.value
      then { c with heads := c.heads ++ [h] } else c)
  else cs ++ [{ staff := h.staff, q := h.q, value := h.value, heads := [h] }]

-- engrave.ts:339   chords.sort((a, b) => a.q - b.q || (same staff ? 0 : treble first))
def leChord (a b : Chord) : Bool :=
  a.q < b.q || (a.q == b.q && (a.staff = b.staff || a.staff = .treble))

-- engrave.ts:335-339   (each chord's heads sorted by pitch, the chords by time and staff)
def chordsOf (printed : List Head) : List Chord :=
  stableSort leChord
    ((printed.foldl addToChords []).map
      (fun c => { c with heads := stableSort (fun a b => a.pitch ≤ b.pitch) c.heads }))

-- engrave.ts:210-218
def printedAt (fifths : Int) (chords : List Chord) (q : Rat)
    (letter : Letter) (octave : Int) (acc : Accidental) : Printed :=
  let before := stableSort (fun a b => a.q ≤ b.q)
    ((chords.flatMap (·.heads)).filter (fun h => h.q ≤ q + EPS))
  printedGiven (implied (keyAccidental fifths letter) letter octave before) acc

/-- Where `implied` gets its answer: nothing matched and the key stands, or it is the
    accidental of a matching head that no matching head comes after in time. -/
theorem implied_spec (letter : Letter) (octave : Int) :
    ∀ (l : List Head) (k0 : Accidental), l.Pairwise (fun a b => a.q ≤ b.q) →
      ((∀ h ∈ l, ¬ (h.letter = letter ∧ h.octave = octave)) ∧ implied k0 letter octave l = k0) ∨
      (∃ h ∈ l, (h.letter = letter ∧ h.octave = octave) ∧ implied k0 letter octave l = h.acc ∧
        ∀ g ∈ l, (g.letter = letter ∧ g.octave = octave) → g.q ≤ h.q) := by
  intro l
  induction l with
  | nil => intro k0 _; left; simp [implied]
  | cons a t ih =>
    intro k0 hs
    rw [List.pairwise_cons] at hs
    simp only [implied]
    rcases ih (if a.letter = letter ∧ a.octave = octave then a.acc else k0) hs.2 with ⟨hn, he⟩ | ⟨h, hm, hk, he, hl⟩
    · by_cases ha : a.letter = letter ∧ a.octave = octave
      · right
        refine ⟨a, by simp, ha, by rw [he]; simp [ha], ?_⟩
        intro g hg hgm
        rcases List.mem_cons.mp hg with rfl | hg
        · exact Rat.le_refl
        · exact absurd hgm (hn g hg)
      · left
        refine ⟨?_, by rw [he]; simp [ha]⟩
        intro g hg
        rcases List.mem_cons.mp hg with rfl | hg
        · exact ha
        · exact hn g hg
    · right
      refine ⟨h, List.mem_cons_of_mem _ hm, hk, he, ?_⟩
      intro g hg hgm
      rcases List.mem_cons.mp hg with rfl | hg
      · exact hs.1 h hm
      · exact hl g hg hgm

/-- CLAIM (src/outputs/engrave.ts:205-209, of `printedAt`: "The rule `engraveBar` prints by,
    asked of one head that is not in the bar"): whatever two orders the same heads are
    walked in — `engraveBar` walks them by time then pitch, `printedAt` by time then
    staff then chord — the accidental left in force for a letter and octave is the same.

    HYPOTHESES: (1) the two lists hold the same heads and each is in order of time, which
    is true of the code by construction (grouping into chords and sorting only reorder);
    (2) `NoClash` — no two heads at one instant write the same letter in the same octave
    with different accidentals. The code does not enforce (2): see
    `FAILS_printedAt_is_engraveBars_rule`. -/
theorem implied_order_independent (letter : Letter) (octave : Int) (k0 : Accidental)
    (l₁ l₂ : List Head)
    (hmem : ∀ h, h ∈ l₁ ↔ h ∈ l₂)
    (hs₁ : l₁.Pairwise (fun a b => a.q ≤ b.q)) (hs₂ : l₂.Pairwise (fun a b => a.q ≤ b.q))
    (NoClash : ∀ a ∈ l₁, ∀ b ∈ l₁, a.q = b.q → a.letter = b.letter → a.octave = b.octave →
      a.acc = b.acc) :
    implied k0 letter octave l₁ = implied k0 letter octave l₂ := by
  rcases implied_spec letter octave l₁ k0 hs₁ with ⟨hn₁, he₁⟩ | ⟨h₁, hm₁, hk₁, he₁, hl₁⟩ <;>
  rcases implied_spec letter octave l₂ k0 hs₂ with ⟨hn₂, he₂⟩ | ⟨h₂, hm₂, hk₂, he₂, hl₂⟩
  · rw [he₁, he₂]
  · exact absurd hk₂ (hn₁ h₂ ((hmem h₂).mpr hm₂))
  · exact absurd hk₁ (hn₂ h₁ ((hmem h₁).mp hm₁))
  · rw [he₁, he₂]
    have hq : h₁.q = h₂.q :=
      Rat.le_antisymm (hl₂ h₁ ((hmem h₁).mp hm₁) hk₁) (hl₁ h₂ ((hmem h₂).mpr hm₂) hk₂)
    exact NoClash h₁ hm₁ h₂ ((hmem h₂).mpr hm₂) hq (hk₁.1.trans hk₂.1.symm)
      (hk₁.2.trans hk₂.2.symm)

/-- The bar of proofs/repro/Engrave_printedAt.ts: at the first instant the left hand
    strikes C4 and the right hand C♯4 (a quarter each, 4/4, no key signature); a third
    note, E4, is struck a quarter later. -/
def clashHeads : List Head := [
  { q := 0, pitch := 60, staff := .bass, value := 4, letter := .C, octave := 4, acc := .none, tiedFrom := false },
  { q := 0, pitch := 61, staff := .treble, value := 4, letter := .C, octave := 4, acc := .sharp, tiedFrom := false },
  { q := 1, pitch := 64, staff := .treble, value := 4, letter := .E, octave := 4, acc := .none, tiedFrom := false }]

/-- FAILS: `printedAt` is not the rule `engraveBar` prints by. In `clashHeads`, a C♮4 at
    the second quarter is printed WITH a natural by `engraveBar` (its own order ends the
    first instant on the C♯) and WITHOUT one by `printedAt` (treble before bass ends it
    on the C♮). So a stray C♮4 there is drawn with no accidental beside a C♯ still in
    force. Repro: proofs/repro/Engrave_printedAt.ts -/
theorem FAILS_printedAt_is_engraveBars_rule :
    ¬ (∀ (fifths : Int) (heads : List Head) (q : Rat) (l : Letter) (o : Int) (a : Accidental),
        printedAt fifths (chordsOf (engraveOrder heads)) q l o a
          = engravePrints fifths heads q l o a) := by
  intro h
  have h1 := h 0 clashHeads 1 .C 4 .none
  have h2 : printedAt 0 (chordsOf (engraveOrder clashHeads)) 1 .C 4 .none = .nothing := by
    decide +kernel
  have h3 : engravePrints 0 clashHeads 1 .C 4 .none = .natural := by decide +kernel
  rw [h2, h3] at h1
  exact absurd h1 (by decide)

/-- The test of src/outputs/engrave.test.ts:261 ("prints what the key and the bar so far do
    not already say"), as a check on the model: D major, one F♮4 at the third quarter. -/
theorem printedAt_test :
    let f : Head := { q := 2, pitch := 65, staff := .treble, value := 8, letter := .F,
                      octave := 4, acc := .none, tiedFrom := false }
    printedAt 2 (chordsOf (engraveOrder [f])) 0 .F 4 .none = .natural ∧
    printedAt 2 (chordsOf (engraveOrder [f])) 2 .F 4 .none = .nothing ∧
    printedAt 2 (chordsOf (engraveOrder [f])) 2 .F 4 .sharp = .sharp := by
  decide +kernel

/-! ## Quantization and note values (src/outputs/engrave.ts:116-166) -/

-- src/outputs/engrave.ts:48   base: 1|2|4|8|16|32, dots: 0|1
structure Value where
  base : Nat
  dots : Nat
  triplet : Bool
  deriving DecidableEq, Repr

-- src/outputs/engrave.ts:119
def quartersOf (x : Value) : Rat :=
  (4 / (x.base : Rat)) * (if x.dots ≠ 0 then 3 / 2 else 1) * (if x.triplet then 2 / 3 else 1)

-- src/outputs/engrave.ts:130
def v (base : Nat) (dots : Nat := 0) (triplet : Bool := false) : Value := ⟨base, dots, triplet⟩

-- src/outputs/engrave.ts:134
def STRAIGHT : List Value :=
  [v 1, v 2 1, v 2, v 4 1, v 4, v 8 1, v 8, v 16 1, v 16, v 32]
-- src/outputs/engrave.ts:137
def TRIPLET : List Value := [v 4 0 true, v 8 0 true, v 16 0 true]

/-- `Math.round`: halves round up. -/
def jsRound (x : Rat) : Int := (x + 1 / 2).floor

-- src/outputs/engrave.ts:143
def snap (q : Rat) : Rat :=
  let straight : Rat := (jsRound (q * 8) : Rat) / 8
  let triplet : Rat := (jsRound (q * 6) : Rat) / 6
  if (straight - q).abs ≤ (triplet - q).abs + EPS then straight else triplet

-- src/outputs/engrave.ts:149
def onStraightGrid (q : Rat) : Bool := (q * 8 - (jsRound (q * 8) : Rat)).abs < EPS

/-- `onStraightGrid(len) ? STRAIGHT : TRIPLET` (engrave.ts:158). -/
def pool (straight : Bool) : List Value := if straight then STRAIGHT else TRIPLET

theorem pool_ge (b : Bool) : ∀ x ∈ pool b, 1 / 8 ≤ quartersOf x := by
  cases b <;> decide +kernel

/-- The `while (rem > EPS)` loop of `valuesFor` (engrave.ts:159-164). Lean accepts the
    definition only with the termination proof below it, so the loop ends for every
    length: each pass takes at least a thirty-second off `rem`. -/
def valuesLoop (straight : Bool) (rem : Rat) (out : List Value) : List Value :=
  if _h : rem > EPS then
    match _hf : (pool straight).find? (fun x => quartersOf x ≤ rem + EPS) with
    | none => out
    | some next => valuesLoop straight (rem - quartersOf next) (out ++ [next])
  else out
termination_by ((rem * 8).floor + 2).toNat
decreasing_by
  have hq := pool_ge straight next (List.mem_of_find?_eq_some _hf)
  have h1 : ((rem - quartersOf next) * 8).floor ≤ (rem * 8 - 1).floor :=
    Rat.floor_monotone (by grind)
  have h2 : (rem * 8 - 1).floor = (rem * 8).floor - 1 := Rat.floor_sub_one
  have h3 : (0 : Int) ≤ (rem * 8).floor := Rat.le_floor_iff.mpr (by simp [EPS] at _h ⊢; grind)
  omega

-- src/outputs/engrave.ts:155
def valuesFor (len : Rat) : List Value := valuesLoop (onStraightGrid len) len []

/-- The length a run of tied values adds up to, in quarters. -/
def total : List Value → Rat
  | [] => 0
  | x :: t => quartersOf x + total t

theorem total_append (a b : List Value) : total (a ++ b) = total a + total b := by
  induction a with
  | nil => simp [total, Rat.zero_add]
  | cons x t ih => simp [total, ih]; grind

theorem jsRound_int (n : Int) : jsRound (n : Rat) = n := by
  unfold jsRound
  have h : ((n : Rat) + 1 / 2) = 1 / 2 + (n : Rat) := by grind
  rw [h, Rat.floor_add_intCast]
  have : (1 / 2 : Rat).floor = 0 := by decide +kernel
  omega

theorem abs_zero' : (0 : Rat).abs = 0 := by decide +kernel

/-- CLAIM (src/outputs/engrave.test.ts:24-48 "names the straight values", "dots a value and
    a half", "ties what one value cannot say, largest first", "writes a triplet length in
    triplet values"): the model gives the values the tests expect. -/
theorem valuesFor_tests :
    valuesFor 4 = [v 1] ∧ valuesFor 2 = [v 2] ∧ valuesFor 1 = [v 4] ∧
    valuesFor (1 / 2) = [v 8] ∧ valuesFor (1 / 4) = [v 16] ∧ valuesFor (1 / 8) = [v 32] ∧
    valuesFor 3 = [v 2 1] ∧ valuesFor (3 / 2) = [v 4 1] ∧ valuesFor (3 / 4) = [v 8 1] ∧
    valuesFor (5 / 4) = [v 4, v 16] ∧ valuesFor (5 / 2) = [v 2, v 8] ∧
    valuesFor (7 / 2) = [v 2 1, v 8] ∧
    valuesFor (1 / 3) = [v 8 0 true] ∧ valuesFor (2 / 3) = [v 4 0 true] := by
  decide +kernel

/-- CLAIM (src/outputs/engrave.test.ts:50 "snaps to the nearer of the straight and triplet
    grids"). -/
theorem snap_tests :
    snap (94 / 100) = 1 ∧ snap (26 / 100) = 1 / 4 ∧ snap (17 / 100) = 1 / 6 ∧
    snap (34 / 100) = 1 / 3 := by
  decide +kernel

/-- CLAIM (src/outputs/engrave.ts:17 "A note's start and length are snapped to the nearest
    thirty-second or triplet sixteenth of the bar's quarter"): the result is on one of the
    two grids. -/
theorem snap_on_a_grid (q : Rat) :
    (∃ n : Int, snap q = (n : Rat) / 8) ∨ (∃ n : Int, snap q = (n : Rat) / 6) := by
  unfold snap
  simp only
  split
  · exact Or.inl ⟨_, rfl⟩
  · exact Or.inr ⟨_, rfl⟩

/-- …and it is near: never more than a sixty-fourth note (1/16 of a quarter) away. -/
theorem snap_near (q : Rat) : (snap q - q).abs ≤ 1 / 16 := by
  have h1 := Rat.floor_le (q * 8 + 1 / 2)
  have h2 := Rat.lt_floor_add_one (q * 8 + 1 / 2)
  rw [Rat.intCast_add] at h2
  unfold snap jsRound
  simp only [Rat.abs, EPS] at *
  grind

/-- CLAIM (src/outputs/engrave.ts:18 "MusicXML and LilyPond durations land exactly"), for an
    instant already on the thirty-second grid. -/
theorem snap_straight (k : Int) : snap ((k : Rat) / 8) = (k : Rat) / 8 := by
  have h : (k : Rat) / 8 * 8 = (k : Rat) := by grind
  have hz : ((k : Rat) / 8 - (k : Rat) / 8) = 0 := by grind
  unfold snap
  simp only [h, jsRound_int, hz, abs_zero']
  have := @Rat.abs_nonneg ((jsRound ((k : Rat) / 8 * 6) : Rat) / 6 - (k : Rat) / 8)
  split
  · rfl
  · rename_i hc; exfalso; apply hc; simp only [EPS]; grind

/-- …and for one on the triplet-sixteenth grid. -/
theorem snap_triplet (k : Int) : snap ((k : Rat) / 6) = (k : Rat) / 6 := by
  have h : (k : Rat) / 6 * 6 = (k : Rat) := by grind
  have hz : ((k : Rat) / 6 - (k : Rat) / 6) = 0 := by grind
  unfold snap
  simp only [h, jsRound_int, hz, abs_zero']
  split
  · rename_i hc
    -- the straight candidate was taken: it is within EPS of k/6, so it IS k/6
    generalize jsRound ((k : Rat) / 6 * 8) = n at hc ⊢
    have hlt : ((3 * n - 4 * k : Int) : Rat) < ((1 : Int) : Rat) := by
      simp only [Rat.intCast_sub, Rat.intCast_mul, Rat.abs, EPS] at hc ⊢
      grind
    have hgt : (((-1 : Int)) : Rat) < ((3 * n - 4 * k : Int) : Rat) := by
      simp only [Rat.intCast_sub, Rat.intCast_mul, Rat.abs, EPS] at hc ⊢
      grind
    have e : 3 * n = 4 * k := by
      have a := Rat.intCast_lt_intCast.mp hlt
      have b := Rat.intCast_lt_intCast.mp hgt
      omega
    have e' : (3 : Rat) * (n : Rat) = 4 * (k : Rat) := by
      have : ((3 * n : Int) : Rat) = ((4 * k : Int) : Rat) := by rw [e]
      simpa [Rat.intCast_mul] using this
    grind
  · rfl

/-! ### What `valuesFor` promises -/

theorem straight_units : ∀ x ∈ STRAIGHT,
    1 ≤ (quartersOf x * 8).floor.toNat ∧
      quartersOf x = (((quartersOf x * 8).floor.toNat : Nat) : Rat) / 8 := by
  decide +kernel

theorem triplet_units : ∀ x ∈ TRIPLET,
    1 ≤ (quartersOf x * 6).floor.toNat ∧
      quartersOf x = (((quartersOf x * 6).floor.toNat : Nat) : Rat) / 6 := by
  decide +kernel

theorem div_le_iff' {a d c : Rat} (hd : 0 < d) : a / d ≤ c ↔ a ≤ c * d := by
  rw [← Rat.not_lt, ← Rat.not_lt, Rat.lt_div_iff hd]

theorem nat_le_of_units {m j : Nat} {d : Rat} (hd : 0 < d) (hd' : d ≤ 8)
    (h : (m : Rat) / d ≤ (j : Rat) / d + EPS) : m ≤ j := by
  apply Decidable.byContradiction
  intro hc
  have h1 : j + 1 ≤ m := by omega
  have h2 : ((j + 1 : Nat) : Rat) ≤ (m : Rat) := Rat.natCast_le_natCast.mpr h1
  rw [Rat.natCast_add] at h2
  have h3 : (m : Rat) ≤ (j : Rat) + EPS * d := by
    have := (div_le_iff' hd).mp h
    have e : ((j : Rat) / d + EPS) * d = (j : Rat) / d * d + EPS * d := by grind
    rw [e, Rat.div_mul_cancel (by grind)] at this
    exact this
  have h4 : EPS * d ≤ EPS * 8 := Rat.mul_le_mul_of_nonneg_left hd' (by decide +kernel)
  simp only [EPS] at h3 h4
  have : ((1 : Nat) : Rat) = 1 := by decide +kernel
  grind

/-- The loop on the straight pool, started on the thirty-second grid, says the whole
    length: what it adds to `out` totals exactly `j/8`. -/
theorem valuesLoop_straight_exact : ∀ (j : Nat) (out : List Value),
    total (valuesLoop true ((j : Rat) / 8) out) = total out + (j : Rat) / 8 := by
  intro j
  induction j using Nat.strongRecOn with
  | _ j ih =>
    intro out
    rw [valuesLoop]
    split
    · rename_i hrem
      have hj : 1 ≤ j := by
        apply Decidable.byContradiction
        intro hc
        have : j = 0 := by omega
        subst this
        revert hrem
        decide +kernel
      split
      · rename_i hnone
        have h32 := (List.find?_eq_none.mp hnone) (v 32) (by decide)
        exfalso
        apply h32
        have h1 : ((1 : Nat) : Rat) ≤ (j : Rat) := Rat.natCast_le_natCast.mpr hj
        have h2 : quartersOf (v 32) = 1 / 8 := by decide +kernel
        have h3 : ((1 : Nat) : Rat) = 1 := by decide +kernel
        simp only [h2, EPS, decide_eq_true_eq]
        grind
      · rename_i next hsome
        have hmem : next ∈ STRAIGHT := List.mem_of_find?_eq_some hsome
        have hp := List.find?_some hsome
        simp only [decide_eq_true_eq] at hp
        obtain ⟨hm1, hmq⟩ := straight_units next hmem
        generalize (quartersOf next * 8).floor.toNat = m at hm1 hmq
        rw [hmq] at hp ⊢
        have hmj : m ≤ j := nat_le_of_units (by decide +kernel) (by decide +kernel) hp
        obtain ⟨r, rfl⟩ := Nat.exists_eq_add_of_le hmj
        have e : ((m + r : Nat) : Rat) / 8 - (m : Rat) / 8 = (r : Rat) / 8 := by
          rw [Rat.natCast_add]; grind
        rw [e, ih r (by omega), total_append]
        simp only [total, hmq, Rat.natCast_add]
        grind
    · rename_i hrem
      have hj : j = 0 := by
        apply Decidable.byContradiction
        intro hc
        have h1 : ((1 : Nat) : Rat) ≤ (j : Rat) := Rat.natCast_le_natCast.mpr (by omega)
        have h3 : ((1 : Nat) : Rat) = 1 := by decide +kernel
        apply hrem
        simp only [EPS]
        grind
      subst hj
      have : ((0 : Nat) : Rat) / 8 = 0 := by decide +kernel
      rw [this]; grind

/-- The same on the triplet pool, started on the triplet-sixteenth grid. -/
theorem valuesLoop_triplet_exact : ∀ (j : Nat) (out : List Value),
    total (valuesLoop false ((j : Rat) / 6) out) = total out + (j : Rat) / 6 := by
  intro j
  induction j using Nat.strongRecOn with
  | _ j ih =>
    intro out
    rw [valuesLoop]
    split
    · rename_i hrem
      have hj : 1 ≤ j := by
        apply Decidable.byContradiction
        intro hc
        have : j = 0 := by omega
        subst this
        revert hrem
        decide +kernel
      split
      · rename_i hnone
        have h16 := (List.find?_eq_none.mp hnone) (v 16 0 true) (by decide)
        exfalso
        apply h16
        have h1 : ((1 : Nat) : Rat) ≤ (j : Rat) := Rat.natCast_le_natCast.mpr hj
        have h2 : quartersOf (v 16 0 true) = 1 / 6 := by decide +kernel
        have h3 : ((1 : Nat) : Rat) = 1 := by decide +kernel
        simp only [h2, EPS, decide_eq_true_eq]
        grind
      · rename_i next hsome
        have hmem : next ∈ TRIPLET := List.mem_of_find?_eq_some hsome
        have hp := List.find?_some hsome
        simp only [decide_eq_true_eq] at hp
        obtain ⟨hm1, hmq⟩ := triplet_units next hmem
        generalize (quartersOf next * 6).floor.toNat = m at hm1 hmq
        rw [hmq] at hp ⊢
        have hmj : m ≤ j := nat_le_of_units (by decide +kernel) (by decide +kernel) hp
        obtain ⟨r, rfl⟩ := Nat.exists_eq_add_of_le hmj
        have e : ((m + r : Nat) : Rat) / 6 - (m : Rat) / 6 = (r : Rat) / 6 := by
          rw [Rat.natCast_add]; grind
        rw [e, ih r (by omega), total_append]
        simp only [total, hmq, Rat.natCast_add]
        grind
    · rename_i hrem
      have hj : j = 0 := by
        apply Decidable.byContradiction
        intro hc
        have h1 : ((1 : Nat) : Rat) ≤ (j : Rat) := Rat.natCast_le_natCast.mpr (by omega)
        have h3 : ((1 : Nat) : Rat) = 1 := by decide +kernel
        apply hrem
        simp only [EPS]
        grind
      subst hj
      have : ((0 : Nat) : Rat) / 6 = 0 := by decide +kernel
      rw [this]; grind

theorem onStraightGrid_eighths (j : Nat) : onStraightGrid ((j : Rat) / 8) = true := by
  have h : (j : Rat) / 8 * 8 = ((j : Int) : Rat) := by
    rw [Rat.intCast_natCast]; grind
  unfold onStraightGrid
  rw [h, jsRound_int]
  have hz : (((j : Int) : Rat) - ((j : Int) : Rat)) = 0 := by grind
  rw [hz]
  decide +kernel

/-- CLAIM (src/outputs/engrave.ts:22-26 "A length that is not one value is the largest that
    fits, then the largest that fits the remainder, tied … always readable and always
    right"): a length on the thirty-second grid is written in values that add up to
    exactly that length. -/
theorem valuesFor_exact_straight (j : Nat) : total (valuesFor ((j : Rat) / 8)) = (j : Rat) / 8 := by
  unfold valuesFor
  rw [onStraightGrid_eighths, valuesLoop_straight_exact]
  simp only [total]; grind

/-- CLAIM (src/outputs/engrave.ts:151-152 "A length on the triplet grid is written in triplet
    values alone"): a length on the triplet-sixteenth grid is written in values that add
    up to exactly that length — whichever pool `onStraightGrid` picks for it. -/
theorem valuesFor_exact_triplet (j : Nat) : total (valuesFor ((j : Rat) / 6)) = (j : Rat) / 6 := by
  unfold valuesFor
  cases hg : onStraightGrid ((j : Rat) / 6)
  · rw [valuesLoop_triplet_exact]; simp only [total]; grind
  · -- on both grids at once: j/6 is n/8 for the integer n = round(j/6 * 8)
    unfold onStraightGrid at hg
    simp only [decide_eq_true_eq] at hg
    generalize hn : jsRound ((j : Rat) / 6 * 8) = n at hg
    have hlt : ((4 * (j : Int) - 3 * n : Int) : Rat) < ((1 : Int) : Rat) := by
      simp only [Rat.intCast_sub, Rat.intCast_mul, Rat.intCast_natCast, Rat.abs, EPS] at hg ⊢
      grind
    have hgt : ((-1 : Int) : Rat) < ((4 * (j : Int) - 3 * n : Int) : Rat) := by
      simp only [Rat.intCast_sub, Rat.intCast_mul, Rat.intCast_natCast, Rat.abs, EPS] at hg ⊢
      grind
    have e : 4 * (j : Int) = 3 * n := by
      have a := Rat.intCast_lt_intCast.mp hlt
      have b := Rat.intCast_lt_intCast.mp hgt
      omega
    have hn0 : 0 ≤ n := by omega
    obtain ⟨k, rfl⟩ := Int.eq_ofNat_of_zero_le hn0
    have e' : (j : Rat) / 6 = (k : Rat) / 8 := by
      have : ((4 * (j : Int) : Int) : Rat) = ((3 * (k : Int) : Int) : Rat) := by rw [e]
      simp only [Rat.intCast_mul, Rat.intCast_natCast] at this
      grind
    rw [e', valuesLoop_straight_exact]; simp only [total]; grind

/-- CLAIM (src/outputs/engrave.ts:132-133 "Every value a length may be written as … Double
    dots are not offered"): every value `valuesFor` returns is one of the thirteen
    drawable ones. -/
theorem valuesLoop_drawable (b : Bool) (rem : Rat) (out : List Value) :
    ∀ x ∈ valuesLoop b rem out, x ∈ out ∨ x ∈ STRAIGHT ∨ x ∈ TRIPLET := by
  fun_induction valuesLoop b rem out with
  | case1 rem out _ _ => intro x hx; exact Or.inl hx
  | case2 rem out _ next hf ih =>
    intro x hx
    rcases ih x hx with h | h
    · rcases List.mem_append.mp h with h | h
      · exact Or.inl h
      · right
        have hm : next ∈ pool b := List.mem_of_find?_eq_some hf
        simp only [List.mem_singleton] at h
        subst h
        cases b
        · exact Or.inr hm
        · exact Or.inl hm
    · exact Or.inr h
  | case3 rem out _ => intro x hx; exact Or.inl hx

theorem valuesFor_drawable (len : Rat) : ∀ x ∈ valuesFor len, x ∈ STRAIGHT ∨ x ∈ TRIPLET := by
  intro x hx
  rcases valuesLoop_drawable _ _ _ x hx with h | h
  · simp at h
  · exact h

/-- CLAIM ("always right", engrave.ts:26, the half that holds for every length): the values
    never say MORE than the length, beyond the comparison's own tolerance. -/
theorem valuesLoop_no_overshoot (b : Bool) (rem : Rat) (out : List Value) (h : -EPS ≤ rem) :
    total (valuesLoop b rem out) ≤ total out + rem + EPS := by
  fun_induction valuesLoop b rem out with
  | case1 rem out hr _ => simp only [EPS] at *; grind
  | case2 rem out hr next hf ih =>
    have hp := List.find?_some hf
    simp only [decide_eq_true_eq] at hp
    have := ih (by simp only [EPS] at *; grind)
    rw [total_append] at this
    simp only [total] at this
    grind
  | case3 rem out hr => simp only [EPS] at *; grind

theorem valuesFor_no_overshoot (len : Rat) (h : 0 ≤ len) : total (valuesFor len) ≤ len + EPS := by
  have := valuesLoop_no_overshoot (onStraightGrid len) len [] (by simp only [EPS]; grind)
  simp only [total] at this
  unfold valuesFor
  grind

/-- The comment at engrave.ts:152-154 says a length on neither grid "drops what it cannot
    say". This is how much: a length that is a multiple of 1/24 of a quarter but of neither
    1/8 nor 1/6 — the difference of a straight instant and a triplet one — loses its
    remainder, and a short one loses everything. Stated as the failure of "always right".
    Repro: proofs/repro/Engrave_valuesFor_always_right.ts -/
theorem FAILS_valuesFor_always_right :
    ¬ (∀ len : Rat, 0 ≤ len → total (valuesFor len) = len) := by
  intro h
  have := h (5 / 24) (by decide +kernel)
  revert this
  decide +kernel

/-! ### One note in one bar (src/outputs/engrave.ts:226-249) -/

-- src/types.ts:81
structure Bar where
  start : Rat
  end_ : Rat
  beats : Int
  unit : Int
  fifths : Int

-- src/outputs/engrave.ts:116
def quartersPerBar (b : Bar) : Rat := ((b.beats * 4 : Int) : Rat) / (b.unit : Rat)

def rmax (a b : Rat) : Rat := if a ≥ b then a else b
def rmin (a b : Rat) : Rat := if a ≤ b then a else b

-- src/outputs/engrave.ts:232
def toQ (bar : Bar) (quarters quarterSec t : Rat) : Rat :=
  rmax 0 (rmin quarters (snap ((t - bar.start) / quarterSec)))

/-- Lines 237-248 for one note: `none` is `continue` (the note is not in this bar), else
    the quarters `(sQ, eQ)` its heads are cut from. -/
def noteSpan (bar : Bar) (onset duration : Rat) : Option (Rat × Rat) :=
  let quarters := quartersPerBar bar
  let quarterSec := (bar.end_ - bar.start) / quarters
  let slack := quarterSec / 16
  let end_ := onset + duration
  let beginsHere : Bool := onset ≥ bar.start - slack ∧ onset < bar.end_ - slack
  let tiedFrom : Bool := onset < bar.start - slack ∧ end_ > bar.start + slack
  if !beginsHere && !tiedFrom then none
  else
    let tiedTo : Bool := end_ > bar.end_ + slack
    let sQ := if tiedFrom then 0 else toQ bar quarters quarterSec onset
    let eQ := if tiedTo then quarters else toQ bar quarters quarterSec end_
    if sQ ≥ quarters then none
    else
      let eQ := if eQ ≤ sQ then rmin quarters (sQ + 1 / 8) else eQ
      some (sQ, eQ)

/-- Line 249: the values of the note's heads in this bar, in order. -/
def noteValues (bar : Bar) (onset duration : Rat) : Option (List Value) :=
  (noteSpan bar onset duration).map (fun se => valuesFor (se.2 - se.1))

theorem toQ_range (bar : Bar) (quarters quarterSec t : Rat) :
    0 ≤ toQ bar quarters quarterSec t ∧ (0 ≤ quarters → toQ bar quarters quarterSec t ≤ quarters) := by
  unfold toQ rmax rmin
  grind

/-- CLAIM (src/outputs/engrave.ts:248 "too short to say: a thirty-second"): a note that is in
    the bar always has a span of positive length inside the bar. -/
theorem noteSpan_positive (bar : Bar) (onset duration s e : Rat)
    (h : noteSpan bar onset duration = some (s, e)) :
    0 ≤ s ∧ s < e ∧ e ≤ quartersPerBar bar := by
  have hS := toQ_range bar (quartersPerBar bar)
    ((bar.end_ - bar.start) / quartersPerBar bar) onset
  have hE := toQ_range bar (quartersPerBar bar)
    ((bar.end_ - bar.start) / quartersPerBar bar) (onset + duration)
  unfold noteSpan at h
  simp only at h
  generalize toQ bar (quartersPerBar bar) ((bar.end_ - bar.start) / quartersPerBar bar) onset = S at h hS
  generalize toQ bar (quartersPerBar bar) ((bar.end_ - bar.start) / quartersPerBar bar)
    (onset + duration) = E at h hE
  generalize quartersPerBar bar = Q at h hS hE ⊢
  unfold rmin at h
  grind

/-- One bar of 4/4 at 120: two seconds, a quarter each half second. -/
def bar44 : Bar := { start := 0, end_ := 2, beats := 4, unit := 4, fifths := 0 }

/-- The test of engrave.test.ts:107, as a check on the model: a 0.02 s note at the barline is
    written as a thirty-second. -/
theorem noteValues_test : noteValues bar44 0 (2 / 100) = some [v 32] := by decide +kernel

/-- CLAIM (src/outputs/engrave.test.ts:107 "writes a note too short to quantize as a
    thirty-second, not nothing"; engrave.ts:248): every note in the bar is written as at
    least one head. HOLDS when both ends of its span are on the thirty-second grid… -/
theorem straight_span_has_a_head (i j : Nat) (h : i < j) :
    valuesFor ((j : Rat) / 8 - (i : Rat) / 8) ≠ [] ∧
      total (valuesFor ((j : Rat) / 8 - (i : Rat) / 8)) = (j : Rat) / 8 - (i : Rat) / 8 := by
  obtain ⟨r, rfl⟩ := Nat.exists_eq_add_of_lt h
  have e : ((i + r + 1 : Nat) : Rat) / 8 - (i : Rat) / 8 = ((r + 1 : Nat) : Rat) / 8 := by
    simp only [Rat.natCast_add]; grind
  rw [e]
  have ht := valuesFor_exact_straight (r + 1)
  refine ⟨?_, ht⟩
  intro hnil
  rw [hnil] at ht
  simp only [total, Rat.natCast_add] at ht
  have h0 : (0 : Rat) ≤ (r : Rat) := Rat.natCast_nonneg
  have h1 : ((1 : Nat) : Rat) = 1 := by decide +kernel
  grind

/-- …and when both are on the triplet-sixteenth grid. -/
theorem triplet_span_has_a_head (i j : Nat) (h : i < j) :
    valuesFor ((j : Rat) / 6 - (i : Rat) / 6) ≠ [] ∧
      total (valuesFor ((j : Rat) / 6 - (i : Rat) / 6)) = (j : Rat) / 6 - (i : Rat) / 6 := by
  obtain ⟨r, rfl⟩ := Nat.exists_eq_add_of_lt h
  have e : ((i + r + 1 : Nat) : Rat) / 6 - (i : Rat) / 6 = ((r + 1 : Nat) : Rat) / 6 := by
    simp only [Rat.natCast_add]; grind
  rw [e]
  have ht := valuesFor_exact_triplet (r + 1)
  refine ⟨?_, ht⟩
  intro hnil
  rw [hnil] at ht
  simp only [total, Rat.natCast_add] at ht
  have h0 : (0 : Rat) ≤ (r : Rat) := Rat.natCast_nonneg
  have h1 : ((1 : Nat) : Rat) = 1 := by decide +kernel
  grind

/-- FAILS without that hypothesis, which `snap` does not enforce (it snaps each END to
    whichever grid is nearer, independently): a note from a triplet sixteenth (q = 1/6) to
    the sixteenth after the beat (q = 1/4) — onset 1/12 s, 1/24 s long, in a 4/4 bar at
    120 — has a span of 1/12 quarter. That is on neither grid, the triplet pool's
    smallest value is 1/6, and `valuesFor` returns nothing: the note has no head, and the
    page shows a rest where it sounds. Repro: proofs/repro/Engrave_note_without_head.ts -/
theorem FAILS_every_note_in_the_bar_has_a_head :
    ¬ (∀ (bar : Bar) (onset duration : Rat) (vals : List Value),
        noteValues bar onset duration = some vals → vals ≠ []) := by
  intro h
  have h1 : noteValues bar44 (1 / 12) (1 / 24) = some [] := by decide +kernel
  exact h bar44 (1 / 12) (1 / 24) [] h1 rfl

/-! ### Rests: the gaps, split at the beat (src/outputs/engrave.ts:124-125, 300-313) -/

-- src/outputs/engrave.ts:124
def beatOf (b : Bar) : Rat :=
  if b.unit = 8 ∧ Int.tmod b.beats 3 = 0 then 3 / 2 else if b.unit = 2 then 2 else 1

theorem beatOf_pos (b : Bar) : 0 < beatOf b := by
  unfold beatOf; split
  · decide +kernel
  · split <;> decide +kernel

theorem le_div_iff' {a b c : Rat} (hc : 0 < c) : a ≤ b / c ↔ a * c ≤ b := by
  rw [← Rat.not_lt, ← Rat.not_lt, Rat.div_lt_iff hc]

theorem floor_EPS : EPS.floor = 0 := by decide +kernel

/-- The `while (p < b - EPS)` loop of engrave.ts:302-312, for one gap ending at `b`: the
    pieces `[p, e)` it cuts the gap into. Accepted by Lean with the termination proof
    below it: every pass but the last lands `p` on the next multiple of the beat. The
    beat must be positive, which `beatOf_pos` shows it always is. -/
def restPieces (beat : Rat) (hb : 0 < beat) (b : Rat) (p : Rat) : List (Rat × Rat) :=
  if _h : p < b - EPS then
    let nextBeat : Rat := (((p / beat + EPS).floor + 1 : Int) : Rat) * beat
    let e := rmin b nextBeat
    (p, e) :: restPieces beat hb b e
  else []
termination_by 2 * ((b / beat + EPS).floor - (p / beat + EPS).floor).toNat
  + (if p < b - EPS then 1 else 0)
decreasing_by
  have hne : beat ≠ 0 := by grind
  have hE : (0 : Rat) < EPS := by decide +kernel
  unfold rmin
  split
  · -- the last piece: it ends at b
    have h0 : ¬ (b < b - EPS) := by grind
    simp only [h0, ite_false]
    omega
  · rename_i hlt
    generalize (p / beat + EPS).floor = f at hlt ⊢
    have hnb : ((f + 1 : Int) : Rat) * beat / beat + EPS = EPS + ((f + 1 : Int) : Rat) := by
      rw [Rat.mul_div_cancel hne]; grind
    have hfl : (((f + 1 : Int) : Rat) * beat / beat + EPS).floor = f + 1 := by
      rw [hnb, Rat.floor_add_intCast, floor_EPS]; omega
    have hF : f + 1 ≤ (b / beat + EPS).floor := by
      apply Rat.le_floor_iff.mpr
      have : ((f + 1 : Int) : Rat) ≤ b / beat := (le_div_iff' hb).mpr (by grind)
      grind
    rw [hfl]
    split <;> omega

/-- Quarters laid end to end from `q` (engrave.ts:306-310). -/
def lay (q : Rat) : List Value → List (Rat × Value)
  | [] => []
  | x :: t => (q, x) :: lay (q + quartersOf x) t

/-- The rests written into the gap `[a, b)` of a staff (engrave.ts:300-313). -/
def restsIn (beat : Rat) (hb : 0 < beat) (a b : Rat) : List (Rat × Value) :=
  (restPieces beat hb b a).flatMap (fun pe => lay pe.1 (valuesFor (snap (pe.2 - pe.1))))

/-- How many quarters a list of rests says. -/
def restTotal (rs : List (Rat × Value)) : Rat := total (rs.map (·.2))

theorem lay_values (q : Rat) (vs : List Value) : (lay q vs).map (·.2) = vs := by
  induction vs generalizing q with
  | nil => rfl
  | cons x t ih => simp [lay, ih]

theorem restTotal_append (a b : List (Rat × Value)) :
    restTotal (a ++ b) = restTotal a + restTotal b := by
  simp [restTotal, total_append]

/-- CLAIM (src/outputs/engrave.ts:28 "split first at the beat so a rest never straddles
    one"; engrave.test.ts:122): every piece lies inside one beat — it starts at or after
    a beat (to within the loop's own EPS) and ends at or before the next. -/
theorem restPieces_within_beat (beat : Rat) (hb : 0 < beat) (b p : Rat) :
    ∀ pe ∈ restPieces beat hb b p, ∃ n : Int,
      (n : Rat) * beat ≤ pe.1 + EPS * beat ∧ pe.2 ≤ ((n + 1 : Int) : Rat) * beat := by
  fun_induction restPieces beat hb b p with
  | case1 p hp nextBeat e ih =>
    intro pe hpe
    rcases List.mem_cons.mp hpe with rfl | hpe
    · refine ⟨(p / beat + EPS).floor, ?_, ?_⟩
      · have h1 := Rat.floor_le (p / beat + EPS)
        have h2 : ((p / beat + EPS).floor : Rat) - EPS ≤ p / beat := by grind
        have h3 := (le_div_iff' hb).mp h2
        grind
      · show e ≤ _
        simp only [e, rmin]
        split <;> grind
    · exact ih pe hpe
  | case2 p hp => intro pe hpe; simp at hpe

/-- CLAIM (src/outputs/engrave.ts:28 "RESTS. The gaps in a staff are filled"; engrave.test.ts
    117-127 "fills the gaps between notes", "rests to the end of the bar"): the rests
    written into a gap add up to exactly the gap.

    HYPOTHESIS the code does not enforce: both ends of the gap are on the thirty-second
    grid (and the beat is a whole number of thirty-seconds, which `beatOf`'s 1, 3/2 and
    2 are). See `FAILS_rests_fill_the_gap`. -/
theorem rests_fill_the_gap (c : Nat) (hc : 1 ≤ c) (hb : 0 < (c : Rat) / 8) :
    ∀ (n i j : Nat), j - i = n → i ≤ j →
      restTotal (restsIn ((c : Rat) / 8) hb ((i : Rat) / 8) ((j : Rat) / 8))
        = (j : Rat) / 8 - (i : Rat) / 8 := by
  intro n
  induction n using Nat.strongRecOn with
  | _ n ih =>
    intro i j hn hij
    have hE : (0 : Rat) < EPS := by decide +kernel
    unfold restsIn
    rw [restPieces]
    split
    · rename_i hgap
      have hij' : i < j := by
        apply Decidable.byContradiction
        intro hc'
        have : i = j := by omega
        subst this
        grind
      simp only [List.flatMap_cons, restTotal_append]
      generalize hf : ((i : Rat) / 8 / ((c : Rat) / 8) + EPS).floor = f
      -- the beat count is not negative, so the next beat is a whole number of 32nds
      have hf0 : 0 ≤ f := by
        rw [← hf]
        apply Rat.le_floor_iff.mpr
        have h0 : (0 : Rat) ≤ (i : Rat) / 8 / ((c : Rat) / 8) :=
          (le_div_iff' hb).mpr (by have := @Rat.natCast_nonneg i; grind)
        have : ((0 : Int) : Rat) = 0 := rfl
        grind
      obtain ⟨g, hg⟩ := Int.eq_ofNat_of_zero_le (show 0 ≤ (f + 1) * (c : Int) from
        Int.mul_nonneg (by omega) (by omega))
      have hnb : ((f + 1 : Int) : Rat) * ((c : Rat) / 8) = (g : Rat) / 8 := by
        have : (((f + 1) * (c : Int) : Int) : Rat) = ((g : Int) : Rat) := by rw [hg]
        simp only [Rat.intCast_mul, Rat.intCast_natCast] at this
        grind
      -- and it is past where the piece starts
      have hig : i < g := by
        have h1 := Rat.lt_floor_add_one ((i : Rat) / 8 / ((c : Rat) / 8) + EPS)
        rw [hf] at h1
        have h2 : (i : Rat) / 8 / ((c : Rat) / 8) < ((f + 1 : Int) : Rat) := by grind
        have h3 := (Rat.div_lt_iff hb).mp h2
        rw [hnb] at h3
        exact Rat.natCast_lt_natCast.mp (by grind)
      rw [hnb]
      unfold rmin
      split
      · -- the piece runs to the end of the gap
        rename_i hle
        have hlast : restPieces ((c : Rat) / 8) hb ((j : Rat) / 8) ((j : Rat) / 8) = [] := by
          rw [restPieces]; split
          · grind
          · rfl
        simp only [hlast, List.flatMap_nil, restTotal, lay_values, List.map_nil, total]
        obtain ⟨r, rfl⟩ := Nat.exists_eq_add_of_le hij
        have e : ((i + r : Nat) : Rat) / 8 - (i : Rat) / 8 = ((r : Int) : Rat) / 8 := by
          rw [Rat.natCast_add, Rat.intCast_natCast]; grind
        rw [e, snap_straight, Rat.intCast_natCast, valuesFor_exact_straight]
        grind
      · -- the piece ends on the beat, and the rest of the gap is a shorter gap
        rename_i hnle
        have hgj : g < j := Rat.natCast_lt_natCast.mp (by grind)
        have hrest := ih (j - g) (by omega) g j rfl (by omega)
        unfold restsIn at hrest
        rw [hrest]
        simp only [restTotal, lay_values]
        obtain ⟨r, rfl⟩ := Nat.exists_eq_add_of_lt hig
        have e : ((i + r + 1 : Nat) : Rat) / 8 - (i : Rat) / 8 = (((r + 1 : Nat) : Int) : Rat) / 8 := by
          rw [Rat.intCast_natCast]; simp only [Rat.natCast_add]; grind
        rw [e, snap_straight, Rat.intCast_natCast, valuesFor_exact_straight]
        simp only [Rat.natCast_add]
        grind
    · rename_i hgap
      have : i = j := by
        apply Decidable.byContradiction
        intro hc'
        have h1 : i + 1 ≤ j := by omega
        have h2 : ((i + 1 : Nat) : Rat) ≤ (j : Rat) := Rat.natCast_le_natCast.mpr h1
        rw [Rat.natCast_add] at h2
        have h3 : ((1 : Nat) : Rat) = 1 := by decide +kernel
        apply hgap
        simp only [EPS]
        grind
      subst this
      simp only [List.flatMap_nil, restTotal, List.map_nil, total]
      grind

/-- The tests of src/outputs/engrave.test.ts:117-143, as a check on the model: the gap
    between a quarter and the fourth beat is two quarter rests; a gap across a beat is
    split there; and in 6/8 the beat is the dotted quarter. -/
theorem restsIn_tests :
    restsIn 1 (by decide +kernel) 1 3 = [(1, v 4), (2, v 4)] ∧
    restsIn 1 (by decide +kernel) (1 / 2) (3 / 2) = [(1 / 2, v 8), (1, v 8)] ∧
    restsIn 1 (by decide +kernel) 2 4 = [(2, v 4), (3, v 4)] ∧
    restsIn (3 / 2) (by decide +kernel) (1 / 2) 3 = [(1 / 2, v 4), (3 / 2, v 4 1)] := by
  decide +kernel

/-- FAILS without that hypothesis, which `snap` does not enforce: a gap from a triplet
    sixteenth (q = 1/6) to q = 5/8, in a meter whose beat is the quarter. It is 11/24 of
    a quarter long; `snap` rounds that UP to 1/2 and the gap is given an eighth rest,
    which runs 1/24 of a quarter past the head that ends the gap.
    Repro: proofs/repro/Engrave_rest_overruns_gap.ts -/
theorem FAILS_rests_fill_the_gap :
    ¬ (∀ (beat : Rat) (hb : 0 < beat) (a b : Rat), a ≤ b →
        restTotal (restsIn beat hb a b) = b - a) := by
  intro h
  have h1 := h 1 (by decide +kernel) (1 / 6) (5 / 8) (by decide +kernel)
  have h2 : restsIn 1 (by decide +kernel) (1 / 6) (5 / 8) = [(1 / 6, v 8)] := by decide +kernel
  rw [h2] at h1
  revert h1
  decide +kernel

/-! ## Ledger lines (src/outputs/strays.ts:67-76, src/outputs/staff-std.ts:133-151) -/

/-- `for (let p = start; p <= pos; p += 2) out.push(p)`. -/
def up (pos : Int) (p : Int) : List Int :=
  if p ≤ pos then p :: up pos (p + 2) else []
termination_by (pos - p + 1).toNat
decreasing_by omega

/-- `for (let p = start; p >= pos; p -= 2) out.push(p)`. -/
def down (pos : Int) (p : Int) : List Int :=
  if p ≥ pos then p :: down pos (p - 2) else []
termination_by (p - pos + 1).toNat
decreasing_by omega

-- src/outputs/strays.ts:70
def ledgerPositions (pos : Int) (staff : Staff) : List Int :=
  let lohi : Int × Int := if staff = .treble then (2, 10) else (-10, -2)
  up pos (lohi.2 + 2) ++ down pos (lohi.1 - 2)

-- src/outputs/staff-std.ts:137   the positions `line(p)` is called with
def ledgers (pos : Int) : List Int :=
  (if pos = 0 ∨ pos = 1 ∨ pos = -1 then (if pos = 0 then [0] else []) else [])
    ++ up pos 12 ++ down pos (-12)

theorem mem_up (pos : Int) (s : Int) (x : Int) :
    x ∈ up pos s ↔ s ≤ x ∧ x ≤ pos ∧ (x - s) % 2 = 0 := by
  fun_induction up pos s with
  | case1 p hp ih => simp only [List.mem_cons, ih]; omega
  | case2 p hp => simp only [List.not_mem_nil, false_iff]; omega

theorem mem_down (pos : Int) (s : Int) (x : Int) :
    x ∈ down pos s ↔ pos ≤ x ∧ x ≤ s ∧ (s - x) % 2 = 0 := by
  fun_induction down pos s with
  | case1 p hp ih => simp only [List.mem_cons, ih]; omega
  | case2 p hp => simp only [List.not_mem_nil, false_iff]; omega

/-- CLAIM (src/outputs/strays.ts:67-69 "The ledger lines a head at `pos` needs on one staff
    standing alone — treble lines at 2..10, bass at -10..-2 — as positions"): the list is
    exactly the LINE positions (even) that are outside the staff and between it and the
    head, the head's own line included. -/
theorem ledgerPositions_exact (pos : Int) (staff : Staff) (x : Int) :
    x ∈ ledgerPositions pos staff ↔
      x % 2 = 0 ∧
        (if staff = .treble then (10 < x ∧ x ≤ pos) ∨ (pos ≤ x ∧ x < 2)
         else (-2 < x ∧ x ≤ pos) ∨ (pos ≤ x ∧ x < -10)) := by
  unfold ledgerPositions
  cases staff <;> simp only [List.mem_append, mem_up, mem_down] <;> simp <;> omega

/-- The test of src/outputs/strays.test.ts:50, as a check on the model. -/
theorem ledgerPositions_tests :
    ledgerPositions 14 .treble = [12, 14] ∧ ledgerPositions (-1) .treble = [0] ∧
    ledgerPositions 0 .bass = [0] ∧ ledgerPositions (-13) .bass = [-12] ∧
    ledgerPositions 6 .treble = [] := by
  decide +kernel

/-- CLAIM (src/outputs/staff-std.ts:133-136 "any line-position (even) that's outside a staff
    and between the note and the nearest staff. Covers the middle-C region (-1..+1) and
    the far reaches beyond +10 / below -10"): on the grand staff the ledger lines drawn are
    middle C's own for a head on it, and the even positions from ±12 out to the head. -/
theorem ledgers_exact (pos : Int) (x : Int) :
    x ∈ ledgers pos ↔
      (x = 0 ∧ pos = 0) ∨ (x % 2 = 0 ∧ ((12 ≤ x ∧ x ≤ pos) ∨ (pos ≤ x ∧ x ≤ -12))) := by
  unfold ledgers
  simp only [List.mem_append, mem_up, mem_down]
  by_cases h0 : pos = 0
  · subst h0; simp; omega
  · by_cases h1 : pos = 1 ∨ pos = -1
    · rcases h1 with rfl | rfl <;> simp <;> omega
    · simp [h0]; omega

/-- A head in the space just above or below middle C draws no ledger line, and the two
    renderers agree about every head outside both staves' reach: the grand staff's
    ledgers above the treble staff are the lone treble staff's (strays.ts:69 "The built-in
    grand staff is one continuous run and asks staff-std.ts instead"). -/
theorem ledgers_agree_above (pos : Int) (h : 2 ≤ pos) :
    ledgers pos = ledgerPositions pos .treble := by
  unfold ledgers ledgerPositions
  have h1 : ¬ (pos = 0 ∨ pos = 1 ∨ pos = -1) := by omega
  have h2 : down pos (-12) = [] := by rw [down]; simp; omega
  have h3 : down pos 0 = [] := by rw [down]; simp; omega
  simp [h1, h2, h3]

/-- The same failure on music as it is WRITTEN, not played: six triplet thirty-seconds on
    one beat (a sextuplet of 32nds, each 1/12 of a quarter — 1/24 s in `bar44`). Their
    ends snap alternately to the two grids, and the second, third, fourth and fifth are
    left with spans of 1/24 or 1/12 of a quarter: four of the six notes get no head.
    (Second case of proofs/repro/Engrave_note_without_head.ts.) -/
theorem triplet_thirty_seconds_lose_four :
    ([0, 1, 2, 3, 4, 5] : List Rat).map (fun k => noteValues bar44 (k / 24) (1 / 24))
      = [some [v 32], some [], some [], some [], some [], some [v 32]] := by
  decide +kernel

end Harmonicland.Engrave
