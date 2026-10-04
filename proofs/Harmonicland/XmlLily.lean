/-
XML_LILY — the numeric cores of the two text parsers,
  src/inputs/musicxml.ts   (the seconds cursor, <backup>/<forward>, <chord>, tempo and
                            divisions, the barline posts, joinTies)
  src/inputs/lily.ts       (dotted durations, the relative-octave rule, \key -> fifths,
                            the tempo/meter state across simultaneous voices, ties, the
                            fence-post loop that lays the barlines)

What is modelled is the arithmetic the parsers do once the text has been read: an XML
element or a LilyPond token arrives here as a constructor carrying the numbers the
parser's `parseFloat`/regex took from it. String handling, the DOM, dynamics and the pedal
are not modelled (the last two are Dynamics.lean and PedalMarks.lean).

Translation notes
* Seconds, divisions, beats per minute and quarters are `Rat`; pitches, octaves, fifths
  and diatonic steps are `Int`.
* `Math.round x` is `⌊x + 1/2⌋`; `Math.max`/`Math.min` are `rmax`/`rmin`.
* `Array.prototype.sort` is stable and is `stableSort`, an insertion sort the kernel can
  evaluate (see Engrave.lean for why not `List.mergeSort`).
* A mutated object shared between two arrays (a tied note in `out` and in `open`) is a
  record with an `id`, updated by id wherever it sits.
* A loop that always ends is a recursive function Lean has checked; the one that need not
  — LilyPond's fence-post loop — is `fenceLoop`, indexed by a step budget, `none` when the
  budget runs out with the guard still true.
* Concrete evaluations use `decide +kernel`. Nothing here uses `native_decide`.

Left out: floating point; NaN; and Infinity, with ONE exception stated where it is used —
`Ext`, a number that may be +Infinity, for the single question of what `makeBars`'s loop
does when a parser hands it an infinite duration. In the `Rat` model a division by zero
would be 0 rather than Infinity, so every theorem that divides says which divisor it
needs non-zero, and the two divisors the parsers guard (`divisions`, a tempo of 0) are
shown to be guarded.
-/
namespace Harmonicland.XmlLily

def rmax (a b : Rat) : Rat := if a ≥ b then a else b
def rmin (a b : Rat) : Rat := if a ≤ b then a else b

theorem le_rmax_left (a b : Rat) : a ≤ rmax a b := by unfold rmax; grind
theorem le_rmax_right (a b : Rat) : b ≤ rmax a b := by unfold rmax; grind

def insertStable {α : Type} (le : α → α → Bool) (x : α) : List α → List α
  | [] => [x]
  | y :: t => if le x y then x :: y :: t else y :: insertStable le x t

/-- `xs.sort(cmp)` with `le a b := cmp(a, b) <= 0`. -/
def stableSort {α : Type} (le : α → α → Bool) : List α → List α
  | [] => []
  | x :: t => insertStable le x (stableSort le t)

/-! # MusicXML (src/inputs/musicxml.ts)

## The seconds cursor (musicxml.ts:88-196) -/

/-- A child of `<measure>`, as the `switch` of musicxml.ts:105 reads it. -/
inductive El where
  /-- `<attributes>`: its `<divisions>`, `none` when absent or not a number (line 107). -/
  | attributes (divisions : Option Rat)
  /-- `<sound>` or `<direction>`: the `tempo` it carries, `none` when absent or NaN (119). -/
  | sound (tempo : Option Rat)
  /-- `<backup>` with its `<duration>` in divisions (138). -/
  | backup (duration : Rat)
  /-- `<forward>` with its `<duration>` (141). -/
  | forward (duration : Rat)
  /-- `<note>` that is not a grace note: `<duration>`, whether it has `<chord/>`, and its
      MIDI pitch (`none` for a rest) (143-191). -/
  | note (duration : Rat) (chord : Bool) (pitch : Option Int)

/-- A pitched note as it leaves the measure loop (musicxml.ts:180-190). -/
structure XNote where
  pitch : Int
  onset : Rat
  /-- `Math.max(0.02, durSec)`. -/
  duration : Rat
  /-- `onset + durSec`, the exact end. -/
  end_ : Rat
  deriving DecidableEq, Repr

/-- The part's mutable state (musicxml.ts:88-92). -/
structure PSt where
  divisions : Rat
  tempo : Rat
  cursor : Rat
  lastOnset : Rat
  notes : List XNote
  deriving DecidableEq, Repr

-- src/inputs/musicxml.ts:95
def secPerDiv (s : PSt) : Rat := 60 / s.tempo / s.divisions

/-- One case of the `switch` (musicxml.ts:105-193). -/
def elStep (s : PSt) : El → PSt
  | .attributes d =>
    match d with
    | some d => if d > 0 then { s with divisions := d } else s                     -- 108
    | none => s
  | .sound t =>
    match t with
    | some bpm => if bpm ≠ 0 then { s with tempo := bpm } else s                   -- 120
    | none => s
  | .backup d => { s with cursor := rmax 0 (s.cursor - d * secPerDiv s) }          -- 138
  | .forward d => { s with cursor := s.cursor + d * secPerDiv s }                  -- 141
  | .note d chord pitch =>
    let durSec := d * secPerDiv s                                                  -- 145
    let onset := if chord then s.lastOnset else s.cursor                           -- 150
    let s1 := if chord then s
              else { s with lastOnset := s.cursor, cursor := s.cursor + durSec }   -- 151-154
    match pitch with
    | none => s1                                                                   -- 157
    | some p =>
      { s1 with notes := s1.notes ++
          [{ pitch := p, onset, duration := rmax (1 / 50) durSec, end_ := onset + durSec }] }

/-- The `for (const el of measure.children)` loop with its `reached` (musicxml.ts:102-195):
    `reached` is raised to the cursor before each child, and the cursor to `reached`
    after the last. -/
def measureLoop : Rat → PSt → List El → PSt
  | reached, s, [] => { s with cursor := rmax reached s.cursor }                   -- 195
  | reached, s, el :: rest => measureLoop (rmax reached s.cursor) (elStep s el) rest  -- 104

def measure (s : PSt) (els : List El) : PSt := measureLoop s.cursor s els

/-- A part: the post laid at each measure's start, then the closing post
    (musicxml.ts:97-101, 203). Returns the barline instants and the final state. -/
def part : PSt → List (List El) → List Rat × PSt
  | s, [] => ([s.cursor], s)
  | s, m :: rest =>
    let r := part (measure s m) rest
    (s.cursor :: r.1, r.2)

/-- The state a part starts in: `divisions = 1`, `tempo = initialTempo`, everything else 0
    (musicxml.ts:88-91). -/
def start (initialTempo : Rat) : PSt :=
  { divisions := 1, tempo := initialTempo, cursor := 0, lastOnset := 0, notes := [] }

/-- The tests of src/inputs/parsers.test.ts:158, 210, 305, as a check on the model:
    two quarters at divisions 1 are at 0 and 0.5 s; an eighth pickup then a measure of two
    quarters has posts 0, 0.25, 1.25; and a measure whose last stream backed up still
    starts the next at the barline. -/
theorem musicxml_tests :
    ((part (start 120) [[.attributes (some 1), .note 1 false (some 60), .note 1 false (some 61)]]).2.notes.map
        (fun n => (n.pitch, n.onset, n.duration))) = [(60, 0, 1 / 2), (61, 1 / 2, 1 / 2)] ∧
    (part (start 120) [[.attributes (some 2), .note 1 false (some 67)],
        [.note 2 false (some 72), .note 2 false (some 76)]]).1 = [0, 1 / 4, 5 / 4] ∧
    (part (start 120) [[.attributes (some 1), .note 2 false (some 60), .backup 2, .sound none],
        [.note 2 false (some 62)]]).1 = [0, 1, 2] := by
  decide +kernel

/-- The two divisors of `secPerDiv` stay usable. -/
def Usable (s : PSt) : Prop := 0 < s.divisions ∧ s.tempo ≠ 0

/-- CLAIM (src/inputs/musicxml.ts:108 `if (!Number.isNaN(d) && d > 0) divisions = d`, :120
    `if (bpm) tempo = bpm`, :58 `parseFloat(...) || 120`): a `<divisions>` of 0 or less and
    a tempo of 0 are ignored, so `secPerDiv` never divides by zero — no NaN or Infinity
    comes from either. -/
theorem elStep_usable (s : PSt) (el : El) (h : Usable s) : Usable (elStep s el) := by
  unfold Usable at *
  cases el with
  | attributes d =>
    cases d with
    | none => exact h
    | some d => simp only [elStep]; split <;> grind
  | sound t =>
    cases t with
    | none => exact h
    | some bpm => simp only [elStep]; split <;> grind
  | backup d => exact h
  | forward d => exact h
  | note d chord pitch =>
    cases pitch <;> cases chord <;> exact h

theorem measureLoop_usable : ∀ (els : List El) (reached : Rat) (s : PSt),
    Usable s → Usable (measureLoop reached s els) := by
  intro els
  induction els with
  | nil => intro reached s h; exact h
  | cons el rest ih => intro reached s h; exact ih _ _ (elStep_usable s el h)

theorem part_usable : ∀ (ms : List (List El)) (s : PSt), Usable s → Usable (part s ms).2 := by
  intro ms
  induction ms with
  | nil => intro s h; exact h
  | cons m rest ih => intro s h; exact ih _ (measureLoop_usable m _ s h)

/-- The cursor the loop ends on is at least `reached` and at least the cursor of every
    state the loop passes through. -/
theorem measureLoop_ge : ∀ (els : List El) (reached : Rat) (s : PSt),
    reached ≤ (measureLoop reached s els).cursor ∧ s.cursor ≤ (measureLoop reached s els).cursor := by
  intro els
  induction els with
  | nil =>
    intro reached s
    exact ⟨le_rmax_left _ _, le_rmax_right _ _⟩
  | cons el rest ih =>
    intro reached s
    have h := (ih (rmax reached s.cursor) (elStep s el)).1
    have h1 := le_rmax_left reached s.cursor
    have h2 := le_rmax_right reached s.cursor
    simp only [measureLoop]
    exact ⟨by grind, by grind⟩

/-- CLAIM (src/inputs/musicxml.ts:16-18 "the next [measure] begins where the measure's
    furthest voice ended, wherever the last <backup> left the cursor";
    parsers.test.ts:305 "starts each measure at the barline even when the last stream
    backed up"): the next measure starts no earlier than this one started, and no earlier
    than the cursor stood after any prefix of this measure's children. -/
theorem measure_reaches_furthest (s : PSt) (pre post : List El) :
    s.cursor ≤ (measure s (pre ++ post)).cursor ∧
    (pre.foldl elStep s).cursor ≤ (measure s (pre ++ post)).cursor := by
  refine ⟨(measureLoop_ge _ _ _).1, ?_⟩
  unfold measure
  generalize s.cursor = reached
  induction pre generalizing reached s with
  | nil => exact (measureLoop_ge _ _ _).2
  | cons el rest ih => exact ih (elStep s el) (rmax reached s.cursor)

/-- CLAIM (src/core.ts:21-23, what `makeScore` is told it is given: "FENCE POSTS: the start of
    every bar plus the end of the last one"; musicxml.ts:16 "a barline at each one's start,
    and one at the end"): the posts a part hands over never go backwards, there is one
    more of them than there are measures, and the first is where the part began. No
    hypothesis: it holds for negative durations and negative tempi too. -/
theorem part_posts : ∀ (ms : List (List El)) (s : PSt),
    (part s ms).1.Pairwise (· ≤ ·) ∧ (part s ms).1.length = ms.length + 1 ∧
    (part s ms).1.head? = some s.cursor ∧ (∀ x ∈ (part s ms).1, s.cursor ≤ x) := by
  intro ms
  induction ms with
  | nil => intro s; simp [part]
  | cons m rest ih =>
    intro s
    obtain ⟨h1, h2, h3, h4⟩ := ih (measure s m)
    have hm : s.cursor ≤ (measure s m).cursor := (measureLoop_ge _ _ _).1
    simp only [part]
    refine ⟨?_, by simp [h2], by simp, ?_⟩
    · rw [List.pairwise_cons]
      exact ⟨fun x hx => by have := h4 x hx; grind, h1⟩
    · intro x hx
      rcases List.mem_cons.mp hx with rfl | hx
      · exact Rat.le_refl
      · have := h4 x hx; grind

/-- CLAIM (src/inputs/musicxml.ts:12 "<chord> — note shares the previous note's onset, no
    advance"): a chord note is struck where the previous note was and leaves the cursor
    alone — whatever its own `<duration>` says. -/
theorem chord_shares_onset (s : PSt) (d : Rat) (p : Int) :
    (elStep s (.note d true (some p))).cursor = s.cursor ∧
    (elStep s (.note d true (some p))).notes.getLast?.map (·.onset) = some s.lastOnset := by
  simp [elStep]

/-- CLAIM (src/inputs/musicxml.ts:13 "<backup>/<forward> — move the cursor (multi-voice /
    multi-staff)"): backing up by what a voice advanced returns the cursor to where the
    voice began — the next voice starts with the first.

    HYPOTHESIS the code does not enforce: no tempo (or divisions) change in between.
    See `FAILS_voices_meet_on_the_beat`. -/
theorem backup_returns (s : PSt) (ds : List Rat) (h0 : 0 ≤ s.cursor) :
    (elStep ((ds.map (fun d => El.note d false none)).foldl elStep s) (.backup ds.sum)).cursor
      = s.cursor := by
  have key : ∀ (ds : List Rat) (s : PSt),
      ((ds.map (fun d => El.note d false none)).foldl elStep s).cursor
        = s.cursor + ds.sum * secPerDiv s ∧
      secPerDiv ((ds.map (fun d => El.note d false none)).foldl elStep s) = secPerDiv s := by
    intro ds
    induction ds with
    | nil => intro s; simp [Rat.add_zero, Rat.zero_mul]
    | cons d rest ih =>
      intro s
      obtain ⟨h1, h2⟩ := ih (elStep s (.note d false none))
      simp only [List.map_cons, List.foldl_cons, List.sum_cons]
      rw [h1, h2]
      simp only [elStep, secPerDiv, Bool.false_eq_true, ite_false]
      grind
  obtain ⟨h1, h2⟩ := key ds s
  simp only [elStep, h1, h2, rmax]
  grind

/-- CLAIM (src/inputs/musicxml.ts:55 "tempo is a property of time, not of a part"): two
    notes written on the same beat of a measure — the third quarter of voice 1 and the
    third quarter of voice 2 — sound together.

    FAILS when the tempo changes inside the measure. Voice 1 is four quarters with a
    tempo mark between the second and third; a `<backup>` of four quarters; voice 2 is
    four quarters. The `<backup>` and all of voice 2 are timed at the NEW tempo, because
    `tempo` is the last mark met in document order, not the mark in force at that
    instant. At 120 then 60, voice 1's third quarter is at 1 s and voice 2's at 2 s.
    Repro: proofs/repro/XmlLily_musicxml_tempo_midmeasure.ts -/
theorem FAILS_voices_meet_on_the_beat :
    ¬ (∀ (t₁ t₂ : Rat), 0 < t₁ → 0 < t₂ →
        let q := El.note 1 false (some 60)
        let ns := (part (start t₁) [[q, q, .sound (some t₂), q, q, .backup 4, q, q, q, q]]).2.notes
        ns[2]?.map (·.onset) = ns[6]?.map (·.onset)) := by
  intro h
  have := h 120 60 (by decide +kernel) (by decide +kernel)
  revert this
  decide +kernel

/-- What the model says the repro's file comes out as: voice 1 at 0, 0.5, 1, 2 s and
    voice 2 at 0, 1, 2, 3 s, the bar four seconds long though voice 1 fills three. -/
theorem tempo_midmeasure_actual :
    let q := El.note 1 false (some 60)
    let r := part (start 120) [[q, q, .sound (some 60), q, q, .backup 4, q, q, q, q]]
    r.2.notes.map (·.onset) = [0, 1 / 2, 1, 2, 0, 1, 2, 3] ∧ r.1 = [0, 4] := by
  decide +kernel

/-- A well-formed child: no negative `<duration>`, no negative tempo. -/
def Good : El → Prop
  | .backup d => 0 ≤ d
  | .forward d => 0 ≤ d
  | .note d _ _ => 0 ≤ d
  | .sound (some bpm) => 0 ≤ bpm
  | _ => True

/-- Everything so far is at or after time 0, and time runs forwards. -/
def FromStart (s : PSt) : Prop :=
  0 ≤ s.cursor ∧ 0 ≤ s.lastOnset ∧ 0 < s.divisions ∧ 0 < s.tempo ∧ ∀ n ∈ s.notes, 0 ≤ n.onset

theorem secPerDiv_nonneg (s : PSt) (hd : 0 < s.divisions) (ht : 0 < s.tempo) : 0 ≤ secPerDiv s := by
  unfold secPerDiv
  rw [Rat.div_def, Rat.div_def]
  exact Rat.mul_nonneg (Rat.mul_nonneg (by decide +kernel) (Rat.le_of_lt (Rat.inv_pos.mpr ht)))
    (Rat.le_of_lt (Rat.inv_pos.mpr hd))

theorem elStep_fromStart (s : PSt) (el : El) (h : FromStart s) (hg : Good el) :
    FromStart (elStep s el) := by
  obtain ⟨h1, h2, h3, h4, h5⟩ := h
  have hspd := secPerDiv_nonneg s h3 h4
  unfold FromStart
  cases el with
  | attributes d =>
    cases d with
    | none => exact ⟨h1, h2, h3, h4, h5⟩
    | some d => simp only [elStep]; split <;> grind
  | sound t =>
    cases t with
    | none => exact ⟨h1, h2, h3, h4, h5⟩
    | some bpm =>
      simp only [Good] at hg
      simp only [elStep]; split <;> grind
  | backup d => simp only [elStep, rmax]; grind
  | forward d =>
    have := Rat.mul_nonneg hg hspd
    simp only [elStep]; grind
  | note d chord pitch =>
    have := Rat.mul_nonneg hg hspd
    cases pitch <;> cases chord <;> simp [elStep] <;> grind

theorem measureLoop_fromStart : ∀ (els : List El) (reached : Rat) (s : PSt),
    FromStart s → (∀ el ∈ els, Good el) → FromStart (measureLoop reached s els) := by
  intro els
  induction els with
  | nil =>
    intro reached s h _
    obtain ⟨h1, h2, h3, h4, h5⟩ := h
    have := le_rmax_right reached s.cursor
    exact ⟨by simp only [measureLoop]; grind, h2, h3, h4, h5⟩
  | cons el rest ih =>
    intro reached s h hg
    exact ih _ _ (elStep_fromStart s el h (hg el (by simp))) (fun e he => hg e (by simp [he]))

/-- CLAIM (src/types.ts:54 "onset: number; // seconds from start"; the `Math.max(0, …)` of
    musicxml.ts:138 keeps a `<backup>` from crossing the start): no note is struck before
    time 0.

    HYPOTHESES the code does not enforce: the tempo is never negative and no `<duration>`
    is negative (`Good`). See `FAILS_onsets_from_start`. -/
theorem onsets_from_start : ∀ (ms : List (List El)) (s : PSt),
    FromStart s → (∀ m ∈ ms, ∀ el ∈ m, Good el) → ∀ n ∈ (part s ms).2.notes, 0 ≤ n.onset := by
  intro ms
  induction ms with
  | nil => intro s h _; exact h.2.2.2.2
  | cons m rest ih =>
    intro s h hg
    exact ih _ (measureLoop_fromStart m _ s h (hg m (by simp))) (fun m' hm' => hg m' (by simp [hm']))

theorem start_fromStart (t : Rat) (h : 0 < t) : FromStart (start t) := by
  refine ⟨Rat.le_refl, Rat.le_refl, by show (0 : Rat) < 1; decide +kernel, h, ?_⟩
  intro n hn
  simp [start] at hn

/-- FAILS without them: `<sound tempo="-60"/>` is truthy, so it is taken; the first note
    then advances the cursor by −1 s and the second is struck at −1 s. A negative
    `<duration>` does the same. Reachable only from a file that says one of those.
    Repro: proofs/repro/XmlLily_musicxml_negative_onset.ts -/
theorem FAILS_onsets_from_start :
    ¬ (∀ (ms : List (List El)) (t : Rat), t ≠ 0 →
        ∀ n ∈ (part (start t) ms).2.notes, 0 ≤ n.onset) := by
  intro h
  have := h [[.attributes (some 1), .sound (some (-60)), .note 1 false (some 60),
    .note 1 false (some 62)]] 120 (by decide +kernel)
  revert this
  decide +kernel

/-! ## Ties (src/inputs/musicxml.ts:210-249) -/

/-- A `TiedNote` and the `RawNote` inside it (musicxml.ts:210-218), with an `id` standing
    for the object's identity: `joinTies` mutates a held note in place, and that one
    object sits in both `open` and `out`. -/
structure Tied where
  id : Nat
  pitch : Int
  onset : Rat
  /-- `note.duration`. -/
  duration : Rat
  /-- `end`: the exact end. -/
  end_ : Rat
  voice : Nat
  stream : Nat
  start : Bool
  stop : Bool
  deriving DecidableEq, Repr

-- src/inputs/musicxml.ts:221
def SAME_TIME : Rat := 1 / 1000000

/-- The body of `for (const t of byTime)` (musicxml.ts:232-247) on the pair
    `(open, out)`. -/
def joinStep (st : List Tied × List Tied) (t : Tied) : List Tied × List Tied :=
  let fall : List Tied × List Tied :=
    (if t.start then st.1 ++ [t] else st.1, st.2 ++ [t])                           -- 245-246
  if t.stop then
    let ends := st.1.filter (fun o => o.pitch = t.pitch ∧ (o.end_ - t.onset).abs < SAME_TIME)
    let held := (ends.find? (fun o => o.voice = t.voice)).orElse fun _ =>          -- 235
      (ends.find? (fun o => o.stream = t.stream)).orElse fun _ => ends.head?
    match held with
    | some held =>
      -- 237-240: held.end = t.end; held.note.duration = held.end - held.note.onset; …
      let inOpen (o : Tied) : Tied :=
        if o.id = held.id then { o with end_ := t.end_, duration := t.end_ - o.onset,
                                        voice := t.voice, stream := t.stream } else o
      let inOut (o : Tied) : Tied :=
        if o.id = held.id then { o with duration := t.end_ - o.onset } else o
      (if !t.start then st.1.filter (fun o => o.id ≠ held.id) else st.1.map inOpen,   -- 241
       st.2.map inOut)
    | none => fall
  else fall

-- src/inputs/musicxml.ts:228
def joinTies (tied : List Tied) : List Tied :=
  ((stableSort (fun a b => a.onset ≤ b.onset) tied).foldl joinStep ([], [])).2

/-- The tests of src/inputs/parsers.test.ts:274 ("joins a tie whose stop is written before
    its start") and :287 ("keeps two voices' simultaneous ties on one pitch apart"), as a
    check on the model. -/
theorem joinTies_tests :
    -- the stop (voice 1, beat 2) is written before the start (voice 2, beat 1)
    (joinTies [⟨0, 60, 1 / 2, 1 / 2, 1, 1, 1, false, true⟩,
               ⟨1, 60, 0, 1 / 2, 1 / 2, 2, 1, true, false⟩]).map
        (fun n => (n.pitch, n.onset, n.duration)) = [(60, 0, 1)] ∧
    -- voice 1: 1.5 s tied to 0.5 s; voice 5 on the other staff: 0.5 s tied to 1 s
    (joinTies [⟨0, 60, 0, 3 / 2, 3 / 2, 1, 1, true, false⟩,
               ⟨1, 60, 0, 1 / 2, 1 / 2, 5, 2, true, false⟩,
               ⟨2, 60, 1 / 2, 1, 3 / 2, 5, 2, false, true⟩,
               ⟨3, 60, 3 / 2, 1 / 2, 2, 1, 1, false, true⟩]).map
        (fun n => (n.onset, n.duration, n.stream)) = [(0, 2, 1), (0, 3 / 2, 2)] := by
  decide +kernel

/-- CLAIM (src/inputs/musicxml.ts:223-225 "Joins tied notes into single sustained notes. A
    tie-stop continues the open tie on its pitch that ends exactly where it begins"): a
    tie-start `a` and a tie-stop `b` of its pitch that begins where `a` ends come out as
    ONE note, struck where `a` was and lasting to `b`'s end — in whichever order the
    file wrote them. -/
theorem joinTies_pair (a b : Tied)
    (ha : a.start = true ∧ a.stop = false) (hb : b.start = false ∧ b.stop = true)
    (hp : a.pitch = b.pitch) (hmeet : b.onset = a.end_) (hlen : a.onset < b.onset) :
    joinTies [a, b] = [{ a with duration := b.end_ - a.onset }] ∧
    joinTies [b, a] = [{ a with duration := b.end_ - a.onset }] := by
  have hz : (a.end_ - b.onset).abs < SAME_TIME := by
    rw [hmeet]
    have : a.end_ - a.end_ = 0 := by grind
    rw [this]; decide +kernel
  have h1 : (decide (a.onset ≤ b.onset)) = true := by simp; grind
  have h2 : (decide (b.onset ≤ a.onset)) = false := by simp; grind
  constructor <;> by_cases hv : a.voice = b.voice <;> by_cases hs : a.stream = b.stream <;>
    simp [joinTies, stableSort, insertStable, joinStep, h1, h2, ha.1, ha.2, hb.1, hb.2, hp, hz,
      hv, hs]

/-- CLAIM (src/inputs/musicxml.ts:226-227 "A stop with no such tie is a note of its own"). -/
theorem joinTies_orphan_stop (b : Tied) : joinTies [b] = [b] := by
  simp only [joinTies, stableSort, insertStable, List.foldl_cons, List.foldl_nil, joinStep]
  cases b.stop <;> simp

/-! ## Infinity into `makeBars` (src/core.ts:105-106)

The one place this file steps outside `Rat`. `numOf` is `parseFloat`, and
`parseFloat("Infinity")` (or `"1e999"`) is Infinity. On a `<chord/>` note that duration
never reaches the cursor (`chord_shares_onset`), so the barline posts stay finite while
the note's own duration — and with it `makeScore`'s `duration` — is infinite. `makeBars`
then runs `while (posts[posts.length - 1].at < duration) posts.push(… at + last)`. -/

/-- A JS number that is finite or +Infinity. -/
inductive Ext where
  | fin (x : Rat)
  | inf

/-- `at < duration` for a finite `at`. -/
def Ext.above (duration : Ext) (at_ : Rat) : Bool :=
  match duration with
  | .fin d => at_ < d
  | .inf => true

/-- `while (posts[last].at < duration) posts.push({ … at: posts[last].at + last })`
    (core.ts:105-106), as the instant of the last post; `none` when `fuel` passes were
    not enough. -/
def extendPosts (last : Rat) (duration : Ext) : Nat → Rat → Option Rat
  | 0, at_ => if duration.above at_ then none else some at_
  | fuel + 1, at_ => if duration.above at_ then extendPosts last duration fuel (at_ + last) else some at_

/-- FAILS (the caller's question: would `makeBars`'s loop terminate with an infinite
    duration?): it would not. Every post is finite, a finite number is below Infinity, and
    the loop pushes posts until memory runs out. Reached from a MusicXML file with two
    measures' worth of posts and one `<chord/>` note whose `<duration>` is `Infinity`.
    Repro: proofs/repro/XmlLily_musicxml_infinite_duration.ts -/
theorem FAILS_makeBars_loop_ends_on_infinite_duration :
    ¬ (∀ (last at_ : Rat) (duration : Ext), 0 < last →
        ∃ fuel, (extendPosts last duration fuel at_).isSome = true) := by
  intro h
  obtain ⟨fuel, hf⟩ := h 2 2 .inf (by decide +kernel)
  have : ∀ (n : Nat) (a : Rat), extendPosts 2 .inf n a = none := by
    intro n
    induction n with
    | zero => intro a; rfl
    | succ n ih => intro a; simp [extendPosts, Ext.above, ih]
  rw [this] at hf
  exact absurd hf (by decide)

/-! # LilyPond (src/inputs/lily.ts)

## Durations (lily.ts:70) -/

-- src/inputs/lily.ts:70   (4 / n) * (2 - Math.pow(0.5, dots))
def dotted (n : Nat) (dots : Nat) : Rat := (4 / (n : Rat)) * (2 - (1 / 2 : Rat) ^ dots)

/-- CLAIM (src/inputs/lily.ts:8-9 "durations with dots"): an undotted `n` is `4/n` quarters,
    and each dot adds half of what the dot before it added. -/
theorem dotted_spec (n dots : Nat) :
    dotted n 0 = 4 / (n : Rat) ∧
    dotted n (dots + 1) = dotted n dots + (4 / (n : Rat)) * (1 / 2 : Rat) ^ (dots + 1) := by
  unfold dotted
  rw [Rat.pow_zero, Rat.pow_succ]
  constructor <;> grind

theorem dotted_tests :
    dotted 4 0 = 1 ∧ dotted 4 1 = 3 / 2 ∧ dotted 8 0 = 1 / 2 ∧ dotted 2 1 = 3 ∧
    dotted 8 2 = 7 / 8 ∧ dotted 1 0 = 4 := by
  decide +kernel

/-! ## Relative octaves (lily.ts:131-139) -/

/-- `Math.round`: halves round up. -/
def jsRound (x : Rat) : Int := (x + 1 / 2).floor

/-- lily.ts:133 `Math.round((st.refDia - s) / 7) + ap - co`: the octave of a note whose
    letter is diatonic step `s` (c = 0 … b = 6), after a reference at diatonic index
    `refDia` (28 is middle C), with `ap` apostrophes or `co` commas. -/
def relOctave (refDia s ap co : Int) : Int :=
  jsRound (((refDia - s : Int) : Rat) / 7) + ap - co

/-- CLAIM (src/inputs/lily.ts:133 "nearest, then marks"; LilyPond's own rule for
    `\relative`: with no octave mark a note is the one of its letter within a fourth of
    the note before it): the unmarked octave puts the note at most three diatonic steps
    from the reference, it is the ONLY octave that does, and each `'` or `,` then moves
    it one octave. -/
theorem relOctave_nearest (refDia s ap co : Int) :
    let o := relOctave refDia s 0 0
    (-3 ≤ s + 7 * o - refDia ∧ s + 7 * o - refDia ≤ 3) ∧
    (∀ o' : Int, -3 ≤ s + 7 * o' - refDia → s + 7 * o' - refDia ≤ 3 → o' = o) ∧
    relOctave refDia s ap co = o + ap - co := by
  have h1 := Rat.floor_le (((refDia - s : Int) : Rat) / 7 + 1 / 2)
  have h2 := Rat.lt_floor_add_one (((refDia - s : Int) : Rat) / 7 + 1 / 2)
  unfold relOctave jsRound
  generalize (((refDia - s : Int) : Rat) / 7 + 1 / 2).floor = n at h1 h2 ⊢
  have a1 : ((14 * n : Int) : Rat) ≤ ((2 * (refDia - s) + 7 : Int) : Rat) := by
    simp only [Rat.intCast_mul, Rat.intCast_add, Rat.intCast_sub] at h1 ⊢
    have e14 : ((14 : Int) : Rat) = 14 := rfl
    have e2 : ((2 : Int) : Rat) = 2 := rfl
    have e7 : ((7 : Int) : Rat) = 7 := rfl
    rw [e14, e2, e7]; grind
  have a2 : ((2 * (refDia - s) + 7 : Int) : Rat) < ((14 * n + 14 : Int) : Rat) := by
    simp only [Rat.intCast_mul, Rat.intCast_add, Rat.intCast_sub] at h2 ⊢
    have e14 : ((14 : Int) : Rat) = 14 := rfl
    have e2 : ((2 : Int) : Rat) = 2 := rfl
    have e7 : ((7 : Int) : Rat) = 7 := rfl
    have e1 : ((1 : Int) : Rat) = 1 := rfl
    rw [e14, e2, e7]; rw [e1] at h2; grind
  have b1 := Rat.intCast_le_intCast.mp a1
  have b2 := Rat.intCast_lt_intCast.mp a2
  refine ⟨by omega, ?_, by omega⟩
  intro o' h3 h4
  omega

/-- The test of src/inputs/parsers.test.ts:399, as a check on the model: after `\relative c'`
    (reference 28), the letters c d e f land on MIDI 60 62 64 65. -/
theorem relOctave_test :
    12 * (relOctave 28 0 0 0 + 1) + 0 = 60 ∧ 12 * (relOctave 28 1 0 0 + 1) + 2 = 62 ∧
    12 * (relOctave 29 2 0 0 + 1) + 4 = 64 ∧ 12 * (relOctave 30 3 0 0 + 1) + 5 = 65 ∧
    -- a seventh up by letter is a second DOWN by the nearest-octave rule: c' then b is B3
    12 * (relOctave 28 6 0 0 + 1) + 11 = 59 := by
  decide +kernel

/-! ## \key -> fifths (lily.ts:28-35, 310-321) -/

inductive Letter where
  | C | D | E | F | G | A | B
  deriving DecidableEq, Repr

inductive Mode where
  | major | ionian | minor | aeolian | dorian | mixolydian | lydian | phrygian | locrian
  deriving DecidableEq, Repr

-- src/inputs/lily.ts:30
def FIFTHS : Letter → Int
  | .F => -1 | .C => 0 | .G => 1 | .D => 2 | .A => 3 | .E => 4 | .B => 5

-- src/inputs/lily.ts:32
def MODE_SHIFT : Mode → Int
  | .major => 0 | .ionian => 0 | .minor => -3 | .aeolian => -3 | .dorian => -2
  | .mixolydian => -1 | .lydian => 1 | .phrygian => -4 | .locrian => -5

-- src/inputs/lily.ts:317
def keyFifths (tonic : Letter) (alter : Int) (mode : Mode) : Int :=
  FIFTHS tonic + 7 * alter + MODE_SHIFT mode

/-- What a key signature of `fifths` does to a letter, in semitones — `keyAccidental`
    (src/outputs/engrave.ts:171-178), the consumer of `Bar.fifths`, restated here so the
    file stands alone. -/
def keyAlt (fifths : Int) (letter : Letter) : Int :=
  let idx : Int := match letter with
    | .F => 0 | .C => 1 | .G => 2 | .D => 3 | .A => 4 | .E => 5 | .B => 6
  if fifths > 0 ∧ idx < fifths then 1
  else if fifths < 0 ∧ 7 - idx ≤ -fifths then -1
  else 0

def letterSemi : Letter → Int
  | .C => 0 | .D => 2 | .E => 4 | .F => 5 | .G => 7 | .A => 9 | .B => 11

def letters : List Letter := [.C, .D, .E, .F, .G, .A, .B]

def letterIdx : Letter → Nat
  | .C => 0 | .D => 1 | .E => 2 | .F => 3 | .G => 4 | .A => 5 | .B => 6

/-- The semitone steps of the seven-note scale on `tonic` that the signature `fifths`
    writes: each letter in turn, altered as the signature says. -/
def scaleSteps (fifths : Int) (tonic : Letter) : List Int :=
  (List.range 7).map fun k =>
    let lo := letters.getD ((letterIdx tonic + k) % 7) .C
    let hi := letters.getD ((letterIdx tonic + k + 1) % 7) .C
    ((letterSemi hi + keyAlt fifths hi) - (letterSemi lo + keyAlt fifths lo)) % 12

/-- The whole and half steps that define each mode. -/
def modeSteps : Mode → List Int
  | .major | .ionian => [2, 2, 1, 2, 2, 2, 1]
  | .dorian => [2, 1, 2, 2, 2, 1, 2]
  | .phrygian => [1, 2, 2, 2, 1, 2, 2]
  | .lydian => [2, 2, 2, 1, 2, 2, 1]
  | .mixolydian => [2, 2, 1, 2, 2, 1, 2]
  | .minor | .aeolian => [2, 1, 2, 2, 1, 2, 2]
  | .locrian => [1, 2, 2, 1, 2, 2, 2]

/-- CLAIM (src/inputs/lily.ts:28-31 "Each letter's place on the circle of fifths as a major
    key … A sharp on the tonic adds seven. How far each mode's signature sits from the
    major key on its tonic"): for every tonic (natural, sharp or flat) and every mode whose
    signature fits on the circle (`|fifths| ≤ 7`), the signature `\key` produces — read
    the way the engraver reads it — writes exactly that mode's scale on that tonic, and
    gives the tonic the accidental it was named with. -/
theorem keyFifths_is_the_scale :
    ∀ tonic ∈ letters, ∀ alter ∈ ([-1, 0, 1] : List Int),
      ∀ mode ∈ [Mode.major, .ionian, .minor, .aeolian, .dorian, .mixolydian, .lydian,
                .phrygian, .locrian],
        let f := keyFifths tonic alter mode
        (-7 ≤ f ∧ f ≤ 7) →
          scaleSteps f tonic = modeSteps mode ∧ keyAlt f tonic = alter := by
  decide +kernel

/-- `\key` can ask for more than the circle holds: `\key gis \major` is 8 and
    `\key fes \minor` is −11. `Bar.fifths` is then outside −7..7; `keyAccidental` reads it
    as 7 (Engrave.lean, `keyAccidental_saturates`), every letter altered once. -/
theorem keyFifths_off_the_circle :
    keyFifths .G 1 .major = 8 ∧ keyFifths .F (-1) .minor = -11 := by
  decide +kernel

/-! ## The parser's clock: tempo, meter and ties as state (lily.ts:72-116, 155-336) -/

-- src/inputs/lily.ts:89
structure LMeter where
  at_ : Rat
  barSec : Rat
  beats : Nat
  unit : Nat
  fifths : Int
  deriving DecidableEq, Repr

structure LNote where
  pitch : Int
  onset : Rat
  duration : Rat
  deriving DecidableEq, Repr

/-- `st`, `meters`, `partialSec`, `notes` and `tieOpen` (lily.ts:74-91): the parser's
    state, global to the whole parse. `tieOpen` maps a pitch to the index in `notes` of
    the note a `~` left open. -/
structure LSt where
  tempo : Rat
  beats : Nat
  unit : Nat
  fifths : Int
  meters : List LMeter
  partialSec : Rat
  notes : List LNote
  tieOpen : List (Int × Nat)
  deriving DecidableEq, Repr

-- src/inputs/lily.ts:82
def lilyStart : LSt :=
  { tempo := 120, beats := 4, unit := 4, fifths := 0, meters := [], partialSec := 0,
    notes := [], tieOpen := [] }

/-- One item of music, with what the tokens say already read off: a pitch as MIDI, a
    duration in quarters (`durQ`, after `dotted` and the inherit-previous rule). -/
inductive Item where
  /-- A note, and whether a `~` follows it. -/
  | note (pitch : Int) (durQ : Rat) (tie : Bool)
  | rest (durQ : Rat)
  /-- `< … >dur`, and whether a `~` follows it. -/
  | chord (pitches : List Int) (durQ : Rat) (tie : Bool)
  /-- `\tempo unit = bpm`. -/
  | tempo (unit bpm : Nat)
  /-- `\time beats/unit`. -/
  | time (beats unit : Nat)
  /-- `\key`, as the fifths `keyFifths` gives. -/
  | key (fifths : Int)
  /-- `\partial`, as quarters. -/
  | partial_ (durQ : Rat)

/-- Sequential music `{ … }`, or simultaneous music `<< {…} \\ {…} >>` whose voices are
    each a braced sequence. -/
inductive Music where
  | seq (items : List Item)
  | simul (voices : List (List Item))

-- src/inputs/lily.ts:84
def secPerQ (st : LSt) : Rat := 60 / st.tempo

-- src/inputs/lily.ts:97
def noteMeter (st : LSt) (t : Rat) : LSt :=
  { st with meters := st.meters ++
      [{ at_ := t, barSec := ((st.beats * 4 : Nat) : Rat) / (st.unit : Rat) * secPerQ st,
         beats := st.beats, unit := st.unit, fifths := st.fifths }] }

def modifyAt {α : Type} (f : α → α) : Nat → List α → List α
  | _, [] => []
  | 0, x :: t => f x :: t
  | n + 1, x :: t => x :: modifyAt f n t

-- src/inputs/lily.ts:104
def pushNote (st : LSt) (midi : Int) (onset durSec : Rat) (tieNext : Bool) : LSt :=
  match st.tieOpen.find? (fun e => e.1 = midi) with
  | some (_, idx) =>                                                              -- 105-110
    { st with
        notes := modifyAt (fun n => { n with duration := onset + durSec - n.onset }) idx st.notes
        tieOpen := if tieNext then st.tieOpen else st.tieOpen.filter (fun e => e.1 ≠ midi) }
  | none =>                                                                       -- 112-115
    { st with
        notes := st.notes ++ [{ pitch := midi, onset, duration := rmax (1 / 50) durSec }]
        tieOpen := if tieNext then st.tieOpen ++ [(midi, st.notes.length)] else st.tieOpen }

/-- `parseItem` / `parseChord` / `parseCommand` for one item at time `t0`: the new state
    and the time the item ends (lily.ts:160-336). -/
def itemStep (st : LSt) (t0 : Rat) : Item → LSt × Rat
  | .note pitch durQ tie =>
    (pushNote st pitch t0 (durQ * secPerQ st) tie, t0 + durQ * secPerQ st)        -- 178-185
  | .rest durQ => (st, t0 + durQ * secPerQ st)
  | .chord pitches durQ tie =>                                                    -- 225-230
    (pitches.foldl (fun st p => pushNote st p t0 (durQ * secPerQ st) tie) st,
     t0 + durQ * secPerQ st)
  | .tempo unit bpm =>                                                            -- 262-264
    (noteMeter { st with tempo := ((bpm * 4 : Nat) : Rat) / (unit : Rat) } t0, t0)
  | .time beats unit =>                                                           -- 273-277
    if unit > 0 then (noteMeter { st with beats := beats, unit := unit } t0, t0) else (st, t0)
  | .key fifths => (noteMeter { st with fifths := fifths } t0, t0)                -- 317-318
  | .partial_ durQ => ({ st with partialSec := durQ * secPerQ st }, t0)           -- 284

-- src/inputs/lily.ts:155   parseSeq
def runSeq (st : LSt) (t0 : Rat) (items : List Item) : LSt × Rat :=
  items.foldl (fun r it => itemStep r.1 r.2 it) (st, t0)

/-- `parseSeq` over braced music, and `parseSimul` (lily.ts:187-203): every voice starts
    at `t0` — with the state the voice before it left — and the block ends at the latest
    voice's end. -/
def runMusic (st : LSt) (t0 : Rat) : Music → LSt × Rat
  | .seq items => runSeq st t0 items
  | .simul voices =>
    voices.foldl (fun r v =>
      let e := runSeq r.1 t0 v
      (e.1, if e.2 > r.2 then e.2 else r.2)) (st, t0)

def runPiece (piece : List Music) : LSt :=
  (piece.foldl (fun r m => runMusic r.1 r.2 m) (lilyStart, 0)).1

-- src/inputs/lily.ts:92   (`secPerQ()` here is called AFTER the parse: the final tempo)
def meterAt (st : LSt) (t : Rat) : LMeter :=
  st.meters.foldl (fun m c => if c.at_ ≤ t then c else m)
    { at_ := 0, barSec := 4 * secPerQ st, beats := 4, unit := 4, fifths := 0 }

-- src/inputs/lily.ts:348
def endOf (st : LSt) : Rat := st.notes.foldl (fun m n => rmax m (n.onset + n.duration)) 0

/-- `while (t < end) { t += meterAt(t).barSec; barlines.push(post(t)); }` (lily.ts:356-359):
    the posts pushed, or `none` when `fuel` passes left the guard still true. -/
def fenceLoop (st : LSt) : Nat → Rat → Option (List Rat)
  | 0, t => if t < endOf st then none else some []
  | fuel + 1, t =>
    if t < endOf st then
      (fenceLoop st fuel (t + (meterAt st t).barSec)).map (fun ps => (t + (meterAt st t).barSec) :: ps)
    else some []

/-- The barline instants `parse` hands to `makeScore` (lily.ts:353-359). -/
def barlines (st : LSt) (fuel : Nat) : Option (List Rat) :=
  let t := if st.partialSec > 0 then st.partialSec else (meterAt st 0).barSec
  (fenceLoop st fuel t).map (fun ps => 0 :: t :: ps)

def c4 : Item := .note 60 1 false

/-- The tests of src/inputs/parsers.test.ts:437-457, as a check on the model: five quarters
    in an unstated meter; six in 3/4; `\tempo 4 = 60` then 2/4; and a quarter pickup. -/
theorem lily_barline_tests :
    barlines (runPiece [.seq [c4, c4, c4, c4, c4]]) 10 = some [0, 2, 4] ∧
    barlines (runPiece [.seq [.time 3 4, c4, c4, c4, c4, c4, c4]]) 10 = some [0, 3 / 2, 3] ∧
    barlines (runPiece [.seq [.tempo 4 60], .seq [.time 2 4, c4, c4, c4, c4]]) 10 = some [0, 2, 4] ∧
    barlines (runPiece [.seq [.partial_ 1, c4, c4, c4, c4, c4]]) 10 = some [0, 1 / 2, 5 / 2] := by
  decide +kernel

/-- CLAIM (src/inputs/lily.ts:18 "Barlines are laid down from \time and \partial at the tempo
    in force"; parsers.test.ts:442): in `{ c4 c c c \tempo 4 = 60 c c c c }` the first bar
    is four quarters at 120 — two seconds — and the second four quarters at 60: posts at
    0, 2 and 6.

    FAILS. No `\time`, `\key` or `\tempo` stands at time 0, so the first bar's length comes
    from `meterAt`'s default, `4 * secPerQ()`, and `secPerQ()` is evaluated after the
    parse, at the LAST tempo: the posts are 0, 4, 8, and the first barline falls in the
    middle of the second bar's music. Repro: proofs/repro/XmlLily_lily_default_tempo.ts -/
theorem FAILS_barlines_at_the_tempo_in_force :
    ¬ (barlines (runPiece [.seq [c4, c4, c4, c4, .tempo 4 60, c4, c4, c4, c4]]) 10
        = some [0, 2, 6]) := by
  decide +kernel

theorem default_tempo_actual :
    barlines (runPiece [.seq [c4, c4, c4, c4, .tempo 4 60, c4, c4, c4, c4]]) 10
      = some [0, 4, 8] ∧
    (runPiece [.seq [c4, c4, c4, c4, .tempo 4 60, c4, c4, c4, c4]]).notes.map (·.onset)
      = [0, 1 / 2, 1, 3 / 2, 2, 3, 4, 5] := by
  decide +kernel

/-- The piece of proofs/repro/XmlLily_lily_voices_tempo.ts:
    `<< { c''4 \tempo 4 = 60 c''4 } \\ { c4 c4 } >>`. -/
def twoVoicesTempo : List Music :=
  [.simul [[.note 72 1 false, .tempo 4 60, .note 72 1 false], [.note 48 1 false, .note 48 1 false]]]

/-- CLAIM (src/inputs/lily.ts:188 "each braced voice starts at t0"; src/inputs/dynamics.ts:6-12,
    the codebase's own statement of the hazard: a marking "is placed IN TIME, not on a
    note … right for music written voice by voice — a LilyPond right hand parsed in full
    before the left — where 'the last marking seen' would carry the end of one hand's
    … into the start of the other's"): two voices of a `<< >>` keep time together — the
    second quarter of each is struck at the same instant.

    FAILS for tempo, which is exactly "the last marking seen": `st.tempo` is one global,
    so the second voice is timed from its first note at whatever tempo the first voice
    ENDED on. Here the upper voice's second quarter is at 0.5 s and the lower's at 1 s.
    Repro: proofs/repro/XmlLily_lily_voices_tempo.ts -/
theorem FAILS_voices_keep_time_together :
    ¬ (((runPiece twoVoicesTempo).notes.filter (·.pitch = 72)).map (·.onset)
        = ((runPiece twoVoicesTempo).notes.filter (·.pitch = 48)).map (·.onset)) := by
  decide +kernel

theorem voices_tempo_actual :
    (runPiece twoVoicesTempo).notes.map (fun n => (n.pitch, n.onset, n.duration))
      = [(72, 0, 1 / 2), (72, 1 / 2, 1), (48, 0, 1), (48, 1, 1)] := by
  decide +kernel

/-- The piece of proofs/repro/XmlLily_lily_voices_meter.ts: an upper voice in G major that
    goes from 3/4 to 2/4 after one bar, and a lower voice that states only its key:
    `<< { \key g \major \time 3/4 c4 c c \time 2/4 c c } \\ { \key g \major c2. c2 } >>`. -/
def twoVoicesMeter : List Music :=
  [.simul [[.key 1, .time 3 4, c4, c4, c4, .time 2 4, c4, c4],
           [.key 1, .note 48 3 false, .note 48 2 false]]]

/-- CLAIM (src/inputs/lily.ts:86-88 "The meter map: from each of these instants, bars are
    `barSec` long"; :18 "Barlines are laid down from \time"): one 3/4 bar of 1.5 s, then
    one 2/4 bar of 1 s: posts at 0, 1.5 and 2.5.

    FAILS. `meterAt` takes the LAST entry in the order the entries were pushed — parse
    order, not time order — and the lower voice's `\key` at time 0 is pushed after the
    upper voice's `\time 2/4`, carrying the meter the upper voice ended in. From time 0
    on, every bar is 2/4: posts at 0, 1, 2, 3. Any `\key`, `\time` or `\tempo` at the
    head of a second voice does this whenever the first voice changed meter or tempo.
    Repro: proofs/repro/XmlLily_lily_voices_meter.ts -/
theorem FAILS_meter_map_is_in_time_order :
    ¬ (barlines (runPiece twoVoicesMeter) 10 = some [0, 3 / 2, 5 / 2]) := by
  decide +kernel

theorem voices_meter_actual :
    barlines (runPiece twoVoicesMeter) 10 = some [0, 1, 2, 3] ∧
    ((meterAt (runPiece twoVoicesMeter) 0).beats, (meterAt (runPiece twoVoicesMeter) 0).unit) = (2, 4) := by
  decide +kernel

/-- CLAIM (lily.ts:86-88), the half that holds: when the meter map IS in time order — as it
    is for music with no `<< >>`, whose items are met in time order — `meterAt` is the
    entry in force: no entry at or before `t` stands later than the one it returns. -/
theorem meterAt_in_force (st : LSt) (t : Rat)
    (hs : st.meters.Pairwise (fun a b => a.at_ ≤ b.at_)) :
    ∀ c ∈ st.meters, c.at_ ≤ t → c.at_ ≤ (meterAt st t).at_ ∧ (meterAt st t) ∈ st.meters := by
  have spec : ∀ (ms : List LMeter) (d : LMeter), ms.Pairwise (fun a b => a.at_ ≤ b.at_) →
      ((∀ c ∈ ms, ¬ c.at_ ≤ t) ∧ ms.foldl (fun m c => if c.at_ ≤ t then c else m) d = d) ∨
      (ms.foldl (fun m c => if c.at_ ≤ t then c else m) d ∈ ms ∧
        ∀ c ∈ ms, c.at_ ≤ t → c.at_ ≤ (ms.foldl (fun m c => if c.at_ ≤ t then c else m) d).at_) := by
    intro ms
    induction ms with
    | nil => intro d _; left; simp
    | cons a rest ih =>
      intro d hs
      rw [List.pairwise_cons] at hs
      simp only [List.foldl_cons]
      rcases ih (if a.at_ ≤ t then a else d) hs.2 with ⟨hn, he⟩ | ⟨hm, hl⟩
      · by_cases ha : a.at_ ≤ t
        · right
          rw [he]
          simp only [ha, ite_true]
          refine ⟨by simp, ?_⟩
          intro c hc hct
          rcases List.mem_cons.mp hc with rfl | hc
          · exact Rat.le_refl
          · exact absurd hct (hn c hc)
        · left
          rw [he]
          simp only [ha, ite_false]
          refine ⟨?_, trivial⟩
          intro c hc
          rcases List.mem_cons.mp hc with rfl | hc
          · exact ha
          · exact hn c hc
      · right
        refine ⟨List.mem_cons_of_mem _ hm, ?_⟩
        intro c hc hct
        rcases List.mem_cons.mp hc with rfl | hc
        · exact hs.1 _ hm
        · exact hl c hc hct
  intro c hc hct
  unfold meterAt
  rcases spec st.meters _ hs with ⟨hn, _⟩ | ⟨hm, hl⟩
  · exact absurd hct (hn c hc)
  · exact ⟨hl c hc hct, hm⟩

/-! ## Ties (lily.ts:104-116) -/

/-- CLAIM (src/inputs/lily.ts:10 "ties ~"; parsers.test.ts:414 "merges tied notes into one
    sustained note"): `c4 ~ c4` is one note a half note long (1 s at 120). -/
theorem lily_tie_test :
    (runPiece [.seq [.note 60 1 true, .note 60 1 false]]).notes = [⟨60, 0, 1⟩] := by
  decide +kernel

/-- The piece of proofs/repro/XmlLily_lily_tie_swallows.ts:
    `\relative c' { <c e>4~ <c g'>4 d4 e4 }` — a tied chord of which only the C is tied
    on (LilyPond ties the notes that match and leaves the E's tie hanging). -/
def tiedChord : List Music :=
  [.seq [.chord [60, 64] 1 true, .chord [60, 67] 1 false, .note 62 1 false, .note 64 1 false]]

/-- CLAIM (lily.ts:10 "ties ~", with the meaning the MusicXML reader gives a tie,
    musicxml.ts:224: it "continues the open tie on its pitch that ends exactly where it
    begins"): the E of the first chord is a quarter note; the E two beats later is a
    note of its own; five notes in all.

    FAILS. `tieOpen` is keyed by pitch alone and never checks where the next note of that
    pitch begins: the first E stays open across the second chord and the D, and the E
    two beats later is merged into it. Four notes, the first E lasting all four beats.
    Repro: proofs/repro/XmlLily_lily_tie_swallows.ts -/
theorem FAILS_tie_joins_only_the_next_note :
    ¬ ((runPiece tiedChord).notes.length = 5 ∧
       ((runPiece tiedChord).notes.filter (·.pitch = 64)).map (·.duration) = [1 / 2, 1 / 2]) := by
  decide +kernel

theorem tied_chord_actual :
    (runPiece tiedChord).notes
      = [⟨60, 0, 1⟩, ⟨64, 0, 2⟩, ⟨67, 1 / 2, 1 / 2⟩, ⟨62, 1, 1 / 2⟩] := by
  decide +kernel

/-! ## The fence-post loop (lily.ts:345-359) -/

/-- FAILS (the caller's question: does every loop end?): `{ \time 0/4 c4 }`. `\time` checks
    the denominator (`+m[2] > 0`) and not the numerator, so the bar is 0 quarters long,
    `t += meterAt(t).barSec` adds 0, and `while (t < end)` never ends: for every budget
    the loop is still running. `parse` neither returns nor throws.
    Repro: proofs/repro/XmlLily_lily_time_zero.ts -/
theorem FAILS_fence_loop_terminates :
    ¬ (∀ (piece : List Music), ∃ fuel, (barlines (runPiece piece) fuel).isSome = true) := by
  intro h
  obtain ⟨fuel, hf⟩ := h [.seq [.time 0 4, c4]]
  have hend : (0 : Rat) < endOf (runPiece [.seq [.time 0 4, c4]]) := by decide +kernel
  have hbar : (meterAt (runPiece [.seq [.time 0 4, c4]]) 0).barSec = 0 := by decide +kernel
  have hstuck : ∀ n, fenceLoop (runPiece [.seq [.time 0 4, c4]]) n 0 = none := by
    intro n
    induction n with
    | zero => simp [fenceLoop, hend]
    | succ n ih =>
      have e : (0 : Rat) + 0 = 0 := by decide +kernel
      simp [fenceLoop, hend, hbar, e, ih]
  have hp : ¬ ((runPiece [.seq [.time 0 4, c4]]).partialSec > 0) := by decide +kernel
  simp only [barlines, hp, ite_false, hbar, hstuck] at hf
  exact absurd hf (by decide)

/-- CLAIM (the caller's question, the half that holds): if every bar the meter map can
    answer with is at least `δ > 0` long, the loop ends, within `⌈(end − t)/δ⌉` passes.

    HYPOTHESIS the code does not enforce: no bar of length 0 — `\time 0/4` above, or a
    `\tempo 0 = 60`, whose tempo is infinite. -/
theorem fenceLoop_terminates (st : LSt) (δ : Rat) (hδ : 0 < δ)
    (hbar : ∀ t, δ ≤ (meterAt st t).barSec) :
    ∀ (fuel : Nat) (t : Rat), ((endOf st - t) / δ).ceil.toNat < fuel →
      (fenceLoop st fuel t).isSome = true := by
  intro fuel
  induction fuel with
  | zero => intro t h; omega
  | succ n ih =>
    intro t h
    unfold fenceLoop
    split
    · rename_i hlt
      have hne : δ ≠ 0 := by grind
      have hb := hbar t
      have hpos : (0 : Rat) < (endOf st - t) / δ := (Rat.lt_div_iff hδ).mpr (by grind)
      have h1 : (0 : Int) < ((endOf st - t) / δ).ceil := Rat.lt_ceil_iff.mpr (by simpa using hpos)
      have e : (endOf st - t) / δ - 1 = (endOf st - (t + δ)) / δ := by
        have := Rat.mul_inv_cancel δ hne
        simp only [Rat.div_def]
        grind
      have hmono : (endOf st - (t + (meterAt st t).barSec)) / δ ≤ (endOf st - (t + δ)) / δ := by
        rw [Rat.div_def, Rat.div_def]
        exact Rat.mul_le_mul_of_nonneg_right (by grind) (Rat.le_of_lt (Rat.inv_pos.mpr hδ))
      have h2 : ((endOf st - (t + (meterAt st t).barSec)) / δ).ceil ≤ ((endOf st - t) / δ).ceil - 1 := by
        rw [← Rat.ceil_sub_one, e]
        apply Rat.ceil_le_iff.mpr
        have := @Rat.le_ceil ((endOf st - (t + δ)) / δ)
        grind
      have := ih (t + (meterAt st t).barSec) (by omega)
      simp [this]
    · rfl

end Harmonicland.XmlLily
