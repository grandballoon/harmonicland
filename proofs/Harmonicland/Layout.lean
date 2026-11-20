/-
LAYOUT — the pure geometry the views promise about each other:
  src/outputs/scroll.ts          (one scroll speed for the staff and the roll)
  src/outputs/staff-std.ts:123   (a notehead's x)
  src/outputs/piano-roll.ts      (a falling bar's y; the tape; the keyboard's `layout`,
                                  `lane` and their inverse `pitchAt`)
  src/outputs/combo.ts           (`layout`: the two bands)
  src/outputs/staff-piano.ts     (`keysBandH`, `rollBandH`)
  src/outputs/isolated-keys.ts   (`placement`)

Translation notes
* Pixels and seconds are `Rat`; pitches, key indices and a viewport's height (a DOM
  `clientHeight`, always an integer) are `Int`/`Nat`.
* `Math.round x` is `⌊x + 1/2⌋`, `Math.floor` is `Rat.floor`, `Math.min`/`Math.max` are
  `rmin`/`rmax` (or `min`/`max` on integers).
* `whiteIdx.get(p)!` is a `Map` lookup that is `undefined` for a pitch not in the map; it
  is an `Option`, and so are `lane` and `pitchAt`.
* A keyboard SPAN (src/pitch.ts:74) is two pitches. The keyboard theorems take the one
  thing `KeySpan` documents — "Both ends are WHITE keys", `WhiteEnds` — as their
  hypothesis, and hold for every such span, on the 88 keys or off them. That `spanOf`
  really returns one is Pitch.lean's subject (it does not for notes wholly outside the
  88: its `FAILS_spanOf_clamped_*`), not this file's.
* Concrete evaluations use `decide +kernel`. Nothing here uses `native_decide`.

Left out: floating point, SVG markup, the DOM (`getBoundingClientRect`, client offsets —
`pitchAt` is modelled from the point already in the keyboard's local coordinates),
`Infinity` (`placement` asks for the keyboard's height in an infinitely tall region; the
`Math.min(x, Infinity)` there is `x`). Not modelled: range-marks.ts — its stated claims
(a trimmed end "midway" between two columns, the "nearest" place, the "shortest" mark)
are the definitions of the functions that compute them, on x-coordinates produced by
engravers outside this slice — and the page/tape geometry of staff-piano.ts, which is
StaffBars' and StaffScore's.
-/
namespace Harmonicland.Layout

def rmax (a b : Rat) : Rat := if a ≥ b then a else b
def rmin (a b : Rat) : Rat := if a ≤ b then a else b

/-- `Math.round`: halves round up. -/
def jsRound (x : Rat) : Int := (x + 1 / 2).floor

theorem floor_eq {x : Rat} {n : Int} (h1 : (n : Rat) ≤ x) (h2 : x < ((n + 1 : Int) : Rat)) :
    x.floor = n := by
  have a : n ≤ x.floor := Rat.le_floor_iff.mpr h1
  have b : x.floor < n + 1 := Rat.floor_lt_iff.mpr h2
  omega

theorem le_div_iff' {a b c : Rat} (hc : 0 < c) : a ≤ b / c ↔ a * c ≤ b := by
  rw [← Rat.not_lt, ← Rat.not_lt, Rat.div_lt_iff hc]

theorem div_le_iff' {a d c : Rat} (hd : 0 < d) : a / d ≤ c ↔ a ≤ c * d := by
  rw [← Rat.not_lt, ← Rat.not_lt, Rat.lt_div_iff hd]

/-! ## One scroll speed (src/outputs/scroll.ts) -/

-- src/outputs/scroll.ts:14, 16
def PPS : Rat := 120
def PLAYHEAD_X : Rat := 18 / 100

-- src/outputs/staff-std.ts:112, 123   x = playX + (n.onset - t) * PPS
def staffX (W t onset : Rat) : Rat := W * PLAYHEAD_X + (onset - t) * PPS

-- src/outputs/piano-roll.ts:144   bottom = strikeY - (n.onset - t) * PPS
def rollBottom (strikeY t onset : Rat) : Rat := strikeY - (onset - t) * PPS

-- src/outputs/piano-roll.ts:145   top = bottom - n.duration * PPS
def rollTop (strikeY t onset duration : Rat) : Rat := rollBottom strikeY t onset - duration * PPS

/-- CLAIM (src/outputs/scroll.ts:5-10 "a note crosses the staff playhead exactly as its bar
    reaches the keyboard's strike line … With one owner it holds by construction"): the
    notehead is on the playhead at exactly the times the bar's leading edge is on the
    strike line — and that time is the note's onset. -/
theorem crosses_playhead_as_bar_strikes (W strikeY t onset : Rat) :
    (staffX W t onset = W * PLAYHEAD_X ↔ rollBottom strikeY t onset = strikeY) ∧
    (staffX W t onset = W * PLAYHEAD_X ↔ t = onset) := by
  unfold staffX rollBottom PPS
  constructor <;> constructor <;> intro h <;> grind

/-- …and the two move at one speed: over any stretch of time the notehead travels left
    exactly as far as the bar falls. -/
theorem staff_and_roll_move_together (W strikeY t₁ t₂ onset : Rat) :
    staffX W t₁ onset - staffX W t₂ onset
      = -(rollBottom strikeY t₁ onset - rollBottom strikeY t₂ onset) := by
  unfold staffX rollBottom; grind

/-- CLAIM (src/outputs/piano-roll.ts:5-6 "the key lights up at the instant the note's leading
    edge reaches the strike line"): a note is sounding (`activeAt`, core.ts:216:
    `t >= onset && t < onset + duration`) exactly while its bar straddles the strike line
    — leading edge on or past it, trailing edge not yet there. -/
theorem lit_while_bar_on_strike_line (strikeY t onset duration : Rat) :
    (t ≥ onset ∧ t < onset + duration) ↔
      (strikeY ≤ rollBottom strikeY t onset ∧ rollTop strikeY t onset duration < strikeY) := by
  unfold rollTop rollBottom PPS
  constructor <;> intro h <;> constructor <;> grind

/-! ## The roll as a tape (src/outputs/piano-roll.ts:254-267) -/

-- piano-roll.ts:263   pos: (d - t) * PPS
def tapePos (d t : Rat) : Rat := (d - t) * PPS

-- piano-roll.ts:258, 265   seek: (pos) => clamp(d - pos / PPS)
def tapeSeek (d pos : Rat) : Rat := rmax 0 (rmin d (d - pos / PPS))

/-- CLAIM (src/outputs/piano-roll.test.ts:150 "stands the start of the piece at the bottom,
    its end at the top"; :165 "stops at either end of the piece"): the tape's position is
    `d · PPS` at the start and 0 at the end; seeking to where the tape stands returns the
    time it stands at; and a seek never leaves the piece. -/
theorem tape_ends_and_round_trip (d t pos : Rat) (hd : 0 ≤ d) (ht : 0 ≤ t ∧ t ≤ d) :
    tapePos d 0 = d * PPS ∧ tapePos d d = 0 ∧
    tapeSeek d (tapePos d t) = t ∧
    (0 ≤ tapeSeek d pos ∧ tapeSeek d pos ≤ d) := by
  unfold tapePos tapeSeek rmax rmin PPS
  refine ⟨by grind, by grind, ?_, ?_⟩ <;> grind

/-- CLAIM (src/outputs/piano-roll.ts:248-251 "Scrolling moves the notes exactly as far as the
    scroller moves its content"; piano-roll.test.ts:156 "pixel for pixel with the fall"):
    between two tape positions inside the piece, every bar moves down by exactly the
    distance the position fell. -/
theorem tape_pixel_for_pixel (d strikeY onset p₁ p₂ : Rat)
    (h₁ : 0 ≤ p₁ ∧ p₁ ≤ d * PPS) (h₂ : 0 ≤ p₂ ∧ p₂ ≤ d * PPS) :
    rollBottom strikeY (tapeSeek d p₁) onset - rollBottom strikeY (tapeSeek d p₂) onset
      = p₂ - p₁ := by
  unfold rollBottom tapeSeek rmax rmin PPS at *
  grind

/-! ## Bands (src/outputs/combo.ts:20-25, src/outputs/staff-piano.ts:62-64) -/

/-- `Math.round(H * 0.5)` for an integer height. -/
theorem round_half (H : Int) : jsRound ((H : Rat) * (1 / 2)) = (H + 1) / 2 := by
  unfold jsRound
  apply floor_eq
  · have h : 2 * ((H + 1) / 2) ≤ H + 1 := by omega
    have h' : ((2 * ((H + 1) / 2) : Int) : Rat) ≤ ((H + 1 : Int) : Rat) :=
      Rat.intCast_le_intCast.mpr h
    simp only [Rat.intCast_mul, Rat.intCast_add] at h'
    have e2 : ((2 : Int) : Rat) = 2 := rfl
    have e1 : ((1 : Int) : Rat) = 1 := rfl
    rw [e2, e1] at h'; grind
  · have h : H + 1 < 2 * ((H + 1) / 2 + 1) := by omega
    have h' : ((H + 1 : Int) : Rat) < ((2 * ((H + 1) / 2 + 1) : Int) : Rat) :=
      Rat.intCast_lt_intCast.mpr h
    simp only [Rat.intCast_mul, Rat.intCast_add] at h' ⊢
    have e2 : ((2 : Int) : Rat) = 2 := rfl
    have e1 : ((1 : Int) : Rat) = 1 := rfl
    rw [e2, e1] at h'; rw [e1]; grind

/-- `Math.round(H * 0.4)` for an integer height. -/
theorem round_two_fifths (H : Int) : jsRound ((H : Rat) * (4 / 10)) = (4 * H + 5) / 10 := by
  unfold jsRound
  apply floor_eq
  · have h : 10 * ((4 * H + 5) / 10) ≤ 4 * H + 5 := by omega
    have h' : ((10 * ((4 * H + 5) / 10) : Int) : Rat) ≤ ((4 * H + 5 : Int) : Rat) :=
      Rat.intCast_le_intCast.mpr h
    simp only [Rat.intCast_mul, Rat.intCast_add] at h'
    have e10 : ((10 : Int) : Rat) = 10 := rfl
    have e4 : ((4 : Int) : Rat) = 4 := rfl
    have e5 : ((5 : Int) : Rat) = 5 := rfl
    rw [e10, e4, e5] at h'; grind
  · have h : 4 * H + 5 < 10 * ((4 * H + 5) / 10 + 1) := by omega
    have h' : ((4 * H + 5 : Int) : Rat) < ((10 * ((4 * H + 5) / 10 + 1) : Int) : Rat) :=
      Rat.intCast_lt_intCast.mpr h
    simp only [Rat.intCast_mul, Rat.intCast_add] at h' ⊢
    have e10 : ((10 : Int) : Rat) = 10 := rfl
    have e4 : ((4 : Int) : Rat) = 4 := rfl
    have e5 : ((5 : Int) : Rat) = 5 := rfl
    have e1 : ((1 : Int) : Rat) = 1 := rfl
    rw [e10, e4, e5, e1] at h'; rw [e1]; grind

-- src/outputs/combo.ts:20
def ROLL_H : Int := 120
-- src/outputs/piano-roll.ts:19
def KEYB : Int := 96

-- src/outputs/combo.ts:22   rollH, and topH = H - rollH
def comboRollH (H : Int) : Int := min ROLL_H (jsRound ((H : Rat) * (1 / 2)))
def comboTopH (H : Int) : Int := H - comboRollH H

/-- CLAIM (src/outputs/combo.ts:16-19 "The piano roll keeps a fixed-height band at the bottom
    … the Tonnetz takes ALL the height above it … Fixed — so resizing the window grows
    the Tonnetz, never the roll — but capped on short viewports"): for every viewport
    height the two bands are both inside the viewport and together are all of it, the
    roll is never taller than 120 or than half the height (rounded), and from 239 px up
    it is 120 exactly. -/
theorem combo_bands (H : Int) (h : 0 ≤ H) :
    0 ≤ comboRollH H ∧ comboRollH H ≤ H ∧ 0 ≤ comboTopH H ∧
    comboTopH H + comboRollH H = H ∧ comboRollH H ≤ 120 ∧
    2 * comboRollH H ≤ H + 1 ∧ (239 ≤ H → comboRollH H = 120) := by
  unfold comboTopH comboRollH ROLL_H
  rw [round_half]
  omega

-- src/outputs/staff-piano.ts:62
def keysBandH (H : Int) : Int := min KEYB (jsRound ((H : Rat) * (1 / 2)))

-- src/outputs/staff-piano.ts:63
def rollBandH (H : Int) : Int :=
  min (min (max (KEYB + 40) (jsRound ((H : Rat) * (4 / 10)))) 280) (jsRound ((H : Rat) * (1 / 2)))

/-- CLAIM (src/outputs/staff-piano.test.ts:19 "keys band is exactly the keyboard, yielding
    only on short viewports"; staff-piano.ts:59 "Keys: exactly the keyboard"): the band is
    96 px from a height of 191 up, is never more than half the height (rounded), and
    never leaves the viewport. -/
theorem keys_band (H : Int) (h : 0 ≤ H) :
    (191 ≤ H → keysBandH H = 96) ∧ keysBandH H ≤ 96 ∧ 2 * keysBandH H ≤ H + 1 ∧
    0 ≤ keysBandH H ∧ keysBandH H ≤ H := by
  unfold keysBandH KEYB
  rw [round_half]
  omega

/-- CLAIM (src/outputs/staff-piano.ts:60-61 "Roll: enough fall room to read approaching notes,
    capped so the staff keeps the lion's share; both yield to very short viewports";
    staff-piano.test.ts:24 "roll band adds fall room but the staff keeps the majority"):
    the roll band is at most 280 px and at most half the height rounded UP — so the staff
    above it is never more than one pixel shorter than the band, and is at least as tall
    whenever the height is even or at least 272. (At an odd height below 272 the band is
    the taller by one pixel: 101 to the staff's 100 at 201.) -/
theorem roll_band (H : Int) (h : 0 ≤ H) :
    0 ≤ rollBandH H ∧ rollBandH H ≤ H ∧ rollBandH H ≤ 280 ∧ 2 * rollBandH H ≤ H + 1 ∧
    ((H % 2 = 0 ∨ 272 ≤ H) → rollBandH H ≤ H - rollBandH H) ∧
    (272 ≤ H → 136 ≤ rollBandH H) := by
  unfold rollBandH KEYB
  rw [round_half, round_two_fifths]
  omega

/-- The tests of src/outputs/staff-piano.test.ts:19-30, as a check on the model. -/
theorem band_tests :
    keysBandH 600 = 96 ∧ keysBandH 100 = 50 ∧ rollBandH 600 = 240 ∧ rollBandH 900 = 280 ∧
    rollBandH 300 = 136 ∧ rollBandH 200 = 100 ∧ rollBandH 201 = 101 := by
  decide +kernel

/-! ## The keyboard (src/pitch.ts:25-31, 86-90; src/outputs/piano-roll.ts:194-241) -/

-- src/pitch.ts:25
def semi (p : Int) : Int := Int.tmod (Int.tmod p 12 + 12) 12

-- src/pitch.ts:27, 31
def isWhite (p : Int) : Bool := !([1, 3, 6, 8, 10].contains (semi p))

-- src/pitch.ts:77
structure Span where
  lo : Int
  hi : Int

/-- Every key of the span, low to high: `for (let p = s.lo; p <= s.hi; p++)`. -/
def keysIn (s : Span) : List Int :=
  (List.range (s.hi - s.lo + 1).toNat).map (fun (k : Nat) => s.lo + (k : Int))

-- src/pitch.ts:86
def whitesIn (s : Span) : List Int := (keysIn s).filter isWhite

/-- The black keys in the order `pitchAt` and `markup` scan them (piano-roll.ts:172, 233). -/
def blacksIn (s : Span) : List Int := (keysIn s).filter (fun p => !isWhite p)

-- src/pitch.ts:83
def FULL_SPAN : Span := ⟨21, 108⟩

/-- CLAIM (src/outputs/piano-roll.ts:20-22 "How many white keys the full keyboard has"): 52,
    with 36 black keys: the 88. -/
theorem full_keyboard : (whitesIn FULL_SPAN).length = 52 ∧ (blacksIn FULL_SPAN).length = 36 := by
  decide +kernel

/-- `whiteIdx.get(p)` (piano-roll.ts:197): the index of `p` among the span's white keys,
    `none` (JS `undefined`) if it is not one of them. -/
def whiteIdx (ws : List Int) (p : Int) : Option Nat := ws.idxOf? p

/-- A span as `KeySpan` documents it (src/pitch.ts:74-76): "Both ends are WHITE keys". -/
def WhiteEnds (s : Span) : Prop := isWhite s.lo = true ∧ isWhite s.hi = true ∧ s.lo ≤ s.hi

theorem semi_eq_emod (p : Int) : semi p = p % 12 := by
  unfold semi
  have h1 := Int.lt_tmod_of_pos p (b := 12) (by decide)
  have h2 := Int.tmod_lt_of_pos p (b := 12) (by decide)
  rw [Int.tmod_eq_emod_of_nonneg (by omega)]
  have h3 : Int.tmod p 12 = p - 12 * p.tdiv 12 := Int.tmod_def p 12
  omega

theorem isWhite_iff (p : Int) :
    isWhite p = true ↔ (p % 12 ≠ 1 ∧ p % 12 ≠ 3 ∧ p % 12 ≠ 6 ∧ p % 12 ≠ 8 ∧ p % 12 ≠ 10) := by
  unfold isWhite
  rw [semi_eq_emod]
  simp

/-- CLAIM (src/outputs/piano-roll.ts:203-205 "black sits on the lower white key's right edge
    — pitch-1 is always white for our 5 blacks"): and so is pitch+1. -/
theorem black_between_whites (p : Int) (h : isWhite p = false) :
    isWhite (p - 1) = true ∧ isWhite (p + 1) = true := by
  have hb : ¬ (isWhite p = true) := by simp [h]
  rw [isWhite_iff] at hb
  rw [isWhite_iff, isWhite_iff]
  omega

theorem mem_keysIn (s : Span) (x : Int) : x ∈ keysIn s ↔ s.lo ≤ x ∧ x ≤ s.hi := by
  unfold keysIn
  simp only [List.mem_map, List.mem_range]
  constructor
  · rintro ⟨k, hk, rfl⟩; omega
  · intro h; exact ⟨(x - s.lo).toNat, by omega, by omega⟩

theorem keysIn_sorted (s : Span) : (keysIn s).Pairwise (· < ·) := by
  unfold keysIn
  rw [List.pairwise_map]
  exact List.Pairwise.imp (fun h => by omega) List.pairwise_lt_range

theorem whitesIn_sorted (s : Span) : (whitesIn s).Pairwise (· < ·) :=
  List.Pairwise.filter _ (keysIn_sorted s)

theorem mem_whitesIn (s : Span) (x : Int) :
    x ∈ whitesIn s ↔ (s.lo ≤ x ∧ x ≤ s.hi) ∧ isWhite x = true := by
  unfold whitesIn; rw [List.mem_filter, mem_keysIn]

theorem mem_blacksIn (s : Span) (x : Int) :
    x ∈ blacksIn s ↔ (s.lo ≤ x ∧ x ≤ s.hi) ∧ isWhite x = false := by
  unfold blacksIn; rw [List.mem_filter, mem_keysIn]; simp

/-- In a strictly ascending list a key's `Map` index is its place in the list
    (`new Map(whites.map((p, i) => [p, i]))`, piano-roll.ts:197). -/
theorem whiteIdx_getElem (ws : List Int) (hs : ws.Pairwise (· < ·)) (i : Nat) (hi : i < ws.length) :
    whiteIdx ws ws[i] = some i := by
  unfold whiteIdx
  rw [List.idxOf?_eq_some_iff]
  refine ⟨hi, rfl, ?_⟩
  intro j hj
  have := List.pairwise_iff_getElem.mp hs j i (by omega) hi hj
  omega

/-- Place in the list follows pitch: a lower white key has a lower index. -/
theorem idx_lt_of_lt (ws : List Int) (hs : ws.Pairwise (· < ·)) (i j : Nat)
    (hi : i < ws.length) (hj : j < ws.length) (h : ws[i] < ws[j]) : i < j := by
  apply Decidable.byContradiction
  intro hc
  by_cases he : i = j
  · subst he; omega
  · have := List.pairwise_iff_getElem.mp hs j i hj hi (by omega)
    omega

/-- CLAIM (src/pitch.ts:74-76): a span with white ends has a white key. -/
theorem whitesIn_nonempty (s : Span) (h : WhiteEnds s) : 1 ≤ (whitesIn s).length := by
  have : s.lo ∈ whitesIn s := (mem_whitesIn s s.lo).mpr ⟨⟨by omega, h.2.2⟩, h.1⟩
  cases hw : whitesIn s with
  | nil => rw [hw] at this; simp at this
  | cons a t => simp

/-- The key's place on the page: `{ x, w }` (piano-roll.ts:206-213), `none` when the `Map`
    has no entry (JS would compute `NaN`). `ww` is the white-key width, and the black
    key's width is `ww * 0.62`. -/
def lane (ws : List Int) (ww : Rat) (p : Int) : Option (Rat × Rat) :=
  if isWhite p then (whiteIdx ws p).map (fun (i : Nat) => ((i : Rat) * ww, ww))
  else (whiteIdx ws (p - 1)).map
    (fun (i : Nat) => (((i : Rat) + 1) * ww - ww * (62 / 100) / 2, ww * (62 / 100)))

/-- CLAIM (src/outputs/piano-roll.test.ts:181 "draws only the span's keys, edge to edge";
    piano-roll.ts:190-191 "its white keys share the whole width"): the `i`-th white key of
    the span is drawn from `i·ww` to `(i+1)·ww`, so consecutive white keys abut, the first
    begins at 0 and — since `ww = W / n` — the last ends at `W`. -/
theorem white_keys_tile (s : Span) (W : Rat) (h : WhiteEnds s) :
    let ws := whitesIn s
    let ww := W / (ws.length : Rat)
    (∀ (i : Nat) (hi : i < ws.length), lane ws ww ws[i] = some ((i : Rat) * ww, ww)) ∧
    (ws.length : Rat) * ww = W := by
  intro ws ww
  refine ⟨?_, ?_⟩
  · intro i hi
    have hw : isWhite ws[i] = true := ((mem_whitesIn s ws[i]).mp (List.getElem_mem hi)).2
    unfold lane
    simp only [hw, ↓reduceIte, whiteIdx_getElem ws (whitesIn_sorted s) i hi]
    rfl
  · have hn := whitesIn_nonempty s h
    have hn' : ((1 : Nat) : Rat) ≤ ((whitesIn s).length : Rat) := Rat.natCast_le_natCast.mpr hn
    have h1 : ((1 : Nat) : Rat) = 1 := by decide +kernel
    have hne : ((whitesIn s).length : Rat) ≠ 0 := by grind
    show ((whitesIn s).length : Rat) * (W / ((whitesIn s).length : Rat)) = W
    rw [Rat.mul_comm, Rat.div_mul_cancel hne]

/-- Where a black key is: centred on the right edge of the white key below it, which is
    in the span and has another white key above it in the span. -/
theorem black_lane (s : Span) (ww : Rat) (h : WhiteEnds s) (p : Int) (hp : p ∈ blacksIn s) :
    ∃ (i : Nat) (hi : i + 1 < (whitesIn s).length),
      (whitesIn s)[i] = p - 1 ∧ (whitesIn s)[i + 1] = p + 1 ∧
      lane (whitesIn s) ww p = some (((i : Rat) + 1) * ww - ww * (62 / 100) / 2, ww * (62 / 100)) := by
  obtain ⟨hr, hb⟩ := (mem_blacksIn s p).mp hp
  obtain ⟨hl, hu⟩ := black_between_whites p hb
  have hlo : s.lo ≠ p := fun e => by have := h.1; rw [e, hb] at this; exact absurd this (by simp)
  have hhi : s.hi ≠ p := fun e => by have := h.2.1; rw [e, hb] at this; exact absurd this (by simp)
  have hm1 : p - 1 ∈ whitesIn s := (mem_whitesIn s _).mpr ⟨⟨by omega, by omega⟩, hl⟩
  have hp1 : p + 1 ∈ whitesIn s := (mem_whitesIn s _).mpr ⟨⟨by omega, by omega⟩, hu⟩
  obtain ⟨i, hi, hei⟩ := List.getElem_of_mem hm1
  obtain ⟨j, hj, hej⟩ := List.getElem_of_mem hp1
  have hs := whitesIn_sorted s
  have hij : i < j := idx_lt_of_lt _ hs i j hi hj (by omega)
  -- nothing of the list lies strictly between p-1 and p+1, so j is i+1
  have hj' : j = i + 1 := by
    apply Decidable.byContradiction
    intro hc
    have h1 := List.pairwise_iff_getElem.mp hs i (i + 1) hi (by omega) (by omega)
    have h2 := List.pairwise_iff_getElem.mp hs (i + 1) j (by omega) hj (by omega)
    have hmem : (whitesIn s)[i + 1] ∈ whitesIn s := List.getElem_mem (by omega)
    have hw := ((mem_whitesIn s _).mp hmem).2
    have : (whitesIn s)[i + 1] = p := by omega
    rw [this, hb] at hw
    exact absurd hw (by simp)
  subst hj'
  refine ⟨i, hj, hei, hej, ?_⟩
  unfold lane
  simp only [hb, Bool.false_eq_true, ↓reduceIte, ← hei, whiteIdx_getElem _ hs i hi]
  rfl

/-- CLAIM (src/outputs/piano-roll.test.ts:203 "draws no black key hanging off either end";
    pitch.ts:75): every key of a white-ended span — white or black — is drawn inside the
    region, `0 ≤ x` and `x + w ≤ W`. -/
theorem every_key_in_bounds (s : Span) (W : Rat) (h : WhiteEnds s) (hW : 0 < W) (p : Int)
    (hp : s.lo ≤ p ∧ p ≤ s.hi) :
    ∃ x w, lane (whitesIn s) (W / ((whitesIn s).length : Rat)) p = some (x, w) ∧
      0 ≤ x ∧ 0 < w ∧ x + w ≤ W := by
  obtain ⟨htile, hsum⟩ := white_keys_tile s W h
  have hn := whitesIn_nonempty s h
  have hn' : ((1 : Nat) : Rat) ≤ ((whitesIn s).length : Rat) := Rat.natCast_le_natCast.mpr hn
  have h1 : ((1 : Nat) : Rat) = 1 := by decide +kernel
  have hww : 0 < W / ((whitesIn s).length : Rat) := (Rat.lt_div_iff (by grind)).mpr (by grind)
  generalize W / ((whitesIn s).length : Rat) = ww at htile hsum hww ⊢
  cases hw : isWhite p with
  | true =>
    obtain ⟨i, hi, hei⟩ := List.getElem_of_mem ((mem_whitesIn s p).mpr ⟨hp, hw⟩)
    refine ⟨(i : Rat) * ww, ww, by rw [← hei]; exact htile i hi, ?_, hww, ?_⟩
    · exact Rat.mul_nonneg Rat.natCast_nonneg (Rat.le_of_lt hww)
    · have hi' : ((i + 1 : Nat) : Rat) ≤ ((whitesIn s).length : Rat) :=
        Rat.natCast_le_natCast.mpr (by omega)
      rw [Rat.natCast_add, h1] at hi'
      have := Rat.mul_le_mul_of_nonneg_right hi' (Rat.le_of_lt hww)
      grind
  | false =>
    obtain ⟨i, hi, _, _, hl⟩ := black_lane s ww h p ((mem_blacksIn s p).mpr ⟨hp, hw⟩)
    refine ⟨_, _, hl, ?_, by grind, ?_⟩
    · have := Rat.mul_nonneg (@Rat.natCast_nonneg i) (Rat.le_of_lt hww)
      grind
    · have hi' : ((i + 2 : Nat) : Rat) ≤ ((whitesIn s).length : Rat) :=
        Rat.natCast_le_natCast.mpr (by omega)
      have h2 : ((2 : Nat) : Rat) = 2 := by decide +kernel
      rw [Rat.natCast_add, h2] at hi'
      have := Rat.mul_le_mul_of_nonneg_right hi' (Rat.le_of_lt hww)
      grind

/-- CLAIM (the caller's question "every key in a span gets a distinct … position"): no two
    keys of a white-ended span are drawn in the same place. -/
theorem keys_have_distinct_lanes (s : Span) (ww : Rat) (h : WhiteEnds s) (hww : 0 < ww)
    (p q : Int) (hp : s.lo ≤ p ∧ p ≤ s.hi) (hq : s.lo ≤ q ∧ q ≤ s.hi)
    (he : lane (whitesIn s) ww p = lane (whitesIn s) ww q) : p = q := by
  have hs := whitesIn_sorted s
  have white : ∀ r, s.lo ≤ r ∧ r ≤ s.hi → isWhite r = true →
      ∃ (i : Nat) (hi : i < (whitesIn s).length), (whitesIn s)[i] = r ∧
        lane (whitesIn s) ww r = some ((i : Rat) * ww, ww) := by
    intro r hr hw
    obtain ⟨i, hi, hei⟩ := List.getElem_of_mem ((mem_whitesIn s r).mpr ⟨hr, hw⟩)
    refine ⟨i, hi, hei, ?_⟩
    subst hei
    unfold lane
    simp only [hw, ↓reduceIte, whiteIdx_getElem _ hs i hi]; rfl
  have cast_inj : ∀ (i j : Nat), (i : Rat) * ww = (j : Rat) * ww → i = j := by
    intro i j e
    apply Decidable.byContradiction
    intro hne
    rcases Nat.lt_or_gt_of_ne hne with hlt | hlt
    · have := Rat.mul_lt_mul_of_pos_right (Rat.natCast_lt_natCast.mpr hlt) hww; grind
    · have := Rat.mul_lt_mul_of_pos_right (Rat.natCast_lt_natCast.mpr hlt) hww; grind
  cases hwp : isWhite p <;> cases hwq : isWhite q
  · obtain ⟨i, hi, hpi, _, hlp⟩ := black_lane s ww h p ((mem_blacksIn s p).mpr ⟨hp, hwp⟩)
    obtain ⟨j, hj, hqj, _, hlq⟩ := black_lane s ww h q ((mem_blacksIn s q).mpr ⟨hq, hwq⟩)
    rw [hlp, hlq] at he
    simp only [Option.some.injEq, Prod.mk.injEq] at he
    have : i = j := cast_inj i j (by grind)
    subst this; omega
  · obtain ⟨i, hi, hpi, _, hlp⟩ := black_lane s ww h p ((mem_blacksIn s p).mpr ⟨hp, hwp⟩)
    obtain ⟨j, hj, hqj, hlq⟩ := white q hq hwq
    rw [hlp, hlq] at he
    simp only [Option.some.injEq, Prod.mk.injEq] at he
    grind
  · obtain ⟨i, hi, hpi, hlp⟩ := white p hp hwp
    obtain ⟨j, hj, hqj, _, hlq⟩ := black_lane s ww h q ((mem_blacksIn s q).mpr ⟨hq, hwq⟩)
    rw [hlp, hlq] at he
    simp only [Option.some.injEq, Prod.mk.injEq] at he
    grind
  · obtain ⟨i, hi, hpi, hlp⟩ := white p hp hwp
    obtain ⟨j, hj, hqj, hlq⟩ := white q hq hwq
    rw [hlp, hlq] at he
    simp only [Option.some.injEq, Prod.mk.injEq] at he
    have : i = j := cast_inj i j he.1
    subst this; omega

/-! ### The keyboard's height, and the hit-test (piano-roll.ts:194-241) -/

/-- `whitesIn(FULL_SPAN).length`, piano-roll.ts:22. -/
def FULL_WHITES : Rat := 52

-- src/outputs/piano-roll.ts:200   Math.min((KEYB * FULL_WHITES) / whites.length, H)
def keyH (s : Span) (H : Rat) : Rat :=
  rmin ((KEYB : Rat) * FULL_WHITES / ((whitesIn s).length : Rat)) H

-- src/outputs/piano-roll.ts:201-202
def strikeY (s : Span) (H : Rat) : Rat := H - keyH s H
def blackH (s : Span) (H : Rat) : Rat := keyH s H * (62 / 100)

/-- CLAIM (src/outputs/piano-roll.ts:181-188 "KEYB is the PREFERRED height … A region shorter
    than KEYB therefore yields a squat but fully functional keyboard — strikeY stays inside
    the band"; piano-roll.test.ts:38 "keeps the strike line inside the band"; :73 "keeps
    the keyboard at its preferred height"): for every span with a white key and every
    band height, the strike line is inside the band and the black keys are no taller than
    the white; and on all 88 keys the keyboard is 96 px tall whenever the band is. -/
theorem strike_line_in_band (s : Span) (H : Rat) (h : WhiteEnds s) (hH : 0 ≤ H) :
    0 ≤ strikeY s H ∧ strikeY s H ≤ H ∧ 0 ≤ blackH s H ∧ strikeY s H + blackH s H ≤ H ∧
    (96 ≤ H → keyH FULL_SPAN H = 96) := by
  have hn := whitesIn_nonempty s h
  have hn' : ((1 : Nat) : Rat) ≤ ((whitesIn s).length : Rat) := Rat.natCast_le_natCast.mpr hn
  have h1 : ((1 : Nat) : Rat) = 1 := by decide +kernel
  have hK : 0 < (KEYB : Rat) * FULL_WHITES / ((whitesIn s).length : Rat) :=
    (Rat.lt_div_iff (by grind)).mpr (by
      have : (0 : Rat) < (KEYB : Rat) * FULL_WHITES := by decide +kernel
      grind)
  have hfull : (KEYB : Rat) * FULL_WHITES / ((whitesIn FULL_SPAN).length : Rat) = 96 := by
    decide +kernel
  unfold strikeY blackH keyH rmin
  rw [hfull]
  generalize (KEYB : Rat) * FULL_WHITES / ((whitesIn s).length : Rat) = K at hK
  refine ⟨?_, ?_, ?_, ?_, ?_⟩ <;> grind

/-- `pitchAt` (piano-roll.ts:222-241), from the point `(x, y)` already in the keyboard
    region's own coordinates, in a region `W` wide and `H` tall. -/
def pitchAt (s : Span) (W H x y : Rat) : Option Int :=
  let ws := whitesIn s
  let ww := W / (ws.length : Rat)
  if y < strikeY s H ∨ y > H then none                                             -- 230
  else
    let hit : Option Int :=
      if y ≤ strikeY s H + blackH s H then                                         -- 231
        (blacksIn s).find? (fun p =>
          match lane ws ww p with
          | some (bx, w) => decide (x ≥ bx ∧ x ≤ bx + w)                           -- 236
          | none => false)
      else none
    match hit with
    | some p => some p
    | none =>                                                                      -- 239-240
      ws[(max 0 (min ((ws.length : Int) - 1) (x / ww).floor)).toNat]?

/-- CLAIM (src/outputs/piano-roll.ts:103-104 "keyboard layout + its inverse hit-test both come
    from one place … so the keys drawn below are exactly the ones hit-tested"; :217 "the
    inverse of lane()"; piano-roll.test.ts:49 "discriminates white keys horizontally"; :66
    "maps every y in the band to a key"): a point on the keyboard over the `i`-th white
    key's lane — left edge included, right edge excluded — is that white key, provided no
    black key is drawn over it there: it is below the black keys' band, or within the
    band but in no black key's lane. -/
theorem pitchAt_white (s : Span) (W H x y : Rat) (h : WhiteEnds s) (hW : 0 < W)
    (hy : strikeY s H ≤ y ∧ y ≤ H)
    (hfree : strikeY s H + blackH s H < y ∨
      ∀ p ∈ blacksIn s, ∀ bx w, lane (whitesIn s) (W / ((whitesIn s).length : Rat)) p = some (bx, w) →
        ¬ (bx ≤ x ∧ x ≤ bx + w))
    (i : Nat) (hi : i < (whitesIn s).length)
    (hx : (i : Rat) * (W / ((whitesIn s).length : Rat)) ≤ x ∧
          x < ((i : Rat) + 1) * (W / ((whitesIn s).length : Rat))) :
    pitchAt s W H x y = some (whitesIn s)[i] := by
  have hn := whitesIn_nonempty s h
  have hn' : ((1 : Nat) : Rat) ≤ ((whitesIn s).length : Rat) := Rat.natCast_le_natCast.mpr hn
  have h1 : ((1 : Nat) : Rat) = 1 := by decide +kernel
  have hww : 0 < W / ((whitesIn s).length : Rat) := (Rat.lt_div_iff (by grind)).mpr (by grind)
  unfold pitchAt
  simp only
  generalize W / ((whitesIn s).length : Rat) = ww at hx hww hfree ⊢
  have hfl : (x / ww).floor = (i : Int) := by
    apply floor_eq
    · rw [Rat.intCast_natCast]; exact (le_div_iff' hww).mpr hx.1
    · rw [Rat.intCast_add, Rat.intCast_natCast]
      have e1 : ((1 : Int) : Rat) = 1 := rfl
      rw [e1]; exact (Rat.div_lt_iff hww).mpr hx.2
  have hc1 : ¬ (y < strikeY s H ∨ y > H) := by grind
  have hidx : (max 0 (min (((whitesIn s).length : Int) - 1) (i : Int))).toNat = i := by omega
  have hnone : (if y ≤ strikeY s H + blackH s H then
        (blacksIn s).find? (fun p =>
          match lane (whitesIn s) ww p with
          | some (bx, w) => decide (x ≥ bx ∧ x ≤ bx + w)
          | none => false)
      else none) = none := by
    split
    · rename_i hband
      rcases hfree with hlow | hfree
      · grind
      · rw [List.find?_eq_none]
        intro p hp
        cases hl : lane (whitesIn s) ww p with
        | none => simp
        | some bw =>
          obtain ⟨bx, w⟩ := bw
          have := hfree p hp bx w hl
          simp only [decide_eq_true_eq]
          exact this
    · rfl
  simp only [hc1, ↓reduceIte, hnone, hfl, hidx]
  exact List.getElem?_eq_getElem hi

/-- CLAIM (src/outputs/piano-roll.ts:217-219 "the inverse of lane(): which key sits under a …
    point? Black keys are drawn on top in the upper band, so test them first";
    piano-roll.test.ts:57 "still reaches black keys in the upper part of the band"; :123
    "agrees with pitchAt about where a key is"): in the black keys' band, a point within
    a black key's lane — both edges included — is that black key, and no other. -/
theorem pitchAt_black (s : Span) (W H x y : Rat) (h : WhiteEnds s) (hW : 0 < W)
    (hy : strikeY s H ≤ y ∧ y ≤ strikeY s H + blackH s H ∧ y ≤ H)
    (p : Int) (hp : p ∈ blacksIn s) (bx w : Rat)
    (hl : lane (whitesIn s) (W / ((whitesIn s).length : Rat)) p = some (bx, w))
    (hx : bx ≤ x ∧ x ≤ bx + w) :
    pitchAt s W H x y = some p := by
  have hn := whitesIn_nonempty s h
  have hn' : ((1 : Nat) : Rat) ≤ ((whitesIn s).length : Rat) := Rat.natCast_le_natCast.mpr hn
  have h1 : ((1 : Nat) : Rat) = 1 := by decide +kernel
  have hww : 0 < W / ((whitesIn s).length : Rat) := (Rat.lt_div_iff (by grind)).mpr (by grind)
  unfold pitchAt
  simp only
  generalize W / ((whitesIn s).length : Rat) = ww at hl hww ⊢
  have hc1 : ¬ (y < strikeY s H ∨ y > H) := by grind
  simp only [hc1, hy.2.1, ↓reduceIte]
  cases hfind : (blacksIn s).find? (fun p =>
      match lane (whitesIn s) ww p with
      | some (bx, w) => decide (x ≥ bx ∧ x ≤ bx + w)
      | none => false) with
  | none =>
    have := (List.find?_eq_none.mp hfind) p hp
    rw [hl] at this
    simp only [decide_eq_true_eq] at this
    exact absurd ⟨hx.1, hx.2⟩ this
  | some q =>
    have hq : q ∈ blacksIn s := List.mem_of_find?_eq_some hfind
    have hpred := List.find?_some hfind
    obtain ⟨i, hi, hpi, _, hlp⟩ := black_lane s ww h p hp
    obtain ⟨j, hj, hqj, _, hlq⟩ := black_lane s ww h q hq
    rw [hlq] at hpred
    simp only [decide_eq_true_eq] at hpred
    rw [hlp] at hl
    simp only [Option.some.injEq, Prod.mk.injEq] at hl
    obtain ⟨rfl, rfl⟩ := hl
    -- two black lanes that share a point are one lane
    have hij : i = j := by
      apply Decidable.byContradiction
      intro hne
      rcases Nat.lt_or_gt_of_ne hne with hlt | hlt
      · have hc : ((i + 1 : Nat) : Rat) ≤ (j : Rat) := Rat.natCast_le_natCast.mpr (by omega)
        rw [Rat.natCast_add, h1] at hc
        have := Rat.mul_le_mul_of_nonneg_right hc (Rat.le_of_lt hww)
        grind
      · have hc : ((j + 1 : Nat) : Rat) ≤ (i : Rat) := Rat.natCast_le_natCast.mpr (by omega)
        rw [Rat.natCast_add, h1] at hc
        have := Rat.mul_le_mul_of_nonneg_right hc (Rat.le_of_lt hww)
        grind
    subst hij
    have : q = p := by omega
    rw [this]

/-! ## The isolated keyboard's place on the stage (src/outputs/isolated-keys.ts:74-87) -/

-- src/outputs/isolated-keys.ts:44
def GUTTER : Rat := 24

/-- `placement` (isolated-keys.ts:78-87): `(x, y, w, h)`, or `none` when the stage has no
    room. `tall` is `PianoRoll.geometry(availW, Infinity, span).keyH`: the keyboard's
    height in a region with no ceiling, `KEYB * FULL_WHITES / n`. -/
def placement (s : Span) (W H : Rat) : Option (Rat × Rat × Rat × Rat) :=
  let availW := W - 2 * GUTTER
  let availH := H - 2 * GUTTER
  if availW ≤ 0 ∨ availH ≤ 0 then none
  else
    let tall := (KEYB : Rat) * FULL_WHITES / ((whitesIn s).length : Rat)
    let scale := rmin 1 (availH / tall)
    let w := availW * scale
    let h := tall * scale
    some ((W - w) / 2, (H - h) / 2, w, h)

/-- CLAIM (src/outputs/isolated-keys.ts:43 "Clear space kept round the keyboard, so it never
    touches the window"; :74-77 "across the whole width inside the gutters, as tall as
    PianoRoll stands keys that wide — or, when the stage is too short for that, narrowed
    until they fit, keeping their shape. Centred both ways"; isolated-keys.test.ts:96,
    110): the keyboard has positive size, keeps a gutter of 24 px on every side, is
    centred both ways, and has the shape of the full-width keyboard (`w : h` is
    `availW : tall`). -/
theorem placement_inside_stage (s : Span) (W H x y w h : Rat) (hs : WhiteEnds s)
    (hp : placement s W H = some (x, y, w, h)) :
    0 < w ∧ 0 < h ∧
    GUTTER ≤ x ∧ x + w ≤ W - GUTTER ∧ GUTTER ≤ y ∧ y + h ≤ H - GUTTER ∧
    x + w / 2 = W / 2 ∧ y + h / 2 = H / 2 ∧
    w * ((KEYB : Rat) * FULL_WHITES / ((whitesIn s).length : Rat)) = h * (W - 2 * GUTTER) := by
  have hn := whitesIn_nonempty s hs
  have hn' : ((1 : Nat) : Rat) ≤ ((whitesIn s).length : Rat) := Rat.natCast_le_natCast.mpr hn
  have h1 : ((1 : Nat) : Rat) = 1 := by decide +kernel
  have hK : 0 < (KEYB : Rat) * FULL_WHITES / ((whitesIn s).length : Rat) :=
    (Rat.lt_div_iff (by grind)).mpr (by
      have : (0 : Rat) < (KEYB : Rat) * FULL_WHITES := by decide +kernel
      grind)
  unfold placement at hp
  simp only at hp
  generalize (KEYB : Rat) * FULL_WHITES / ((whitesIn s).length : Rat) = tall at hp hK ⊢
  unfold GUTTER at *
  split at hp
  · exact absurd hp (by simp)
  · rename_i hroom
    simp only [Option.some.injEq, Prod.mk.injEq] at hp
    obtain ⟨rfl, rfl, rfl, rfl⟩ := hp
    have haw : 0 < W - 2 * 24 := by grind
    have hah : 0 < H - 2 * 24 := by grind
    generalize hawd : W - 2 * 24 = aw at haw ⊢
    generalize hahd : H - 2 * 24 = ah at hah ⊢
    -- the scale is in (0, 1], and scaled by it the keyboard is no taller than the room
    have hq : 0 < ah / tall := (Rat.lt_div_iff hK).mpr (by grind)
    have hsc : 0 < rmin 1 (ah / tall) ∧ rmin 1 (ah / tall) ≤ 1 ∧ tall * rmin 1 (ah / tall) ≤ ah := by
      unfold rmin
      split
      · rename_i hle
        have := (le_div_iff' hK).mp hle
        refine ⟨by grind, by grind, by grind⟩
      · have e : tall * (ah / tall) = ah := by
          rw [Rat.mul_comm, Rat.div_mul_cancel (by grind)]
        refine ⟨hq, by grind, by grind⟩
    generalize rmin 1 (ah / tall) = sc at hsc ⊢
    have hw1 : aw * sc ≤ aw := by
      have := Rat.mul_le_mul_of_nonneg_left hsc.2.1 (Rat.le_of_lt haw)
      grind
    have hw0 : 0 < aw * sc := Rat.mul_pos haw hsc.1
    have hh0 : 0 < tall * sc := Rat.mul_pos hK hsc.1
    refine ⟨hw0, hh0, ?_, ?_, ?_, ?_, ?_, ?_, ?_⟩ <;> grind

end Harmonicland.Layout
