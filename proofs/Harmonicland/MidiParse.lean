/-
MIDI_PARSE — a model of the numeric and data-structure logic of src/inputs/midi.ts:
the variable-length reader, one pass of the track loop, the barline fence posts laid from
the meter map, the tick -> seconds integration, and the pairing of note-ons with note-offs.

Translation notes
* The file is a `List Nat` of bytes. `dv.getUint8(p)` THROWS a RangeError outside the
  buffer (it does not return `undefined`), so every read is an `Option`: `none` is the
  throw, and `parse` throwing is a clean failure, not one of the failures below.
* `p` is an `Int`: the code adds a decoded length to it, and that length can be negative.
* `<<` and `|` on a JS number are 32-bit: `v` in `readVarLen` is a `BitVec 32` read back
  signed (`toInt`), and `1 << n` shifts by `n mod 32`.
* Ticks are `Int` while a track is read and `Rat` once barlines are laid (a bar may be a
  fractional number of ticks long); seconds are `Rat`.
* A loop that always ends is a recursive function Lean has checked the termination of.
  The one loop that need not end — the track loop — is `trackLoop`, indexed by a step
  budget, whose answer `stillRunning` means the budget ran out with the loop's guard
  still true.
* The one place the model answers "not a finite number" is `advance`, where `division`
  is the divisor: `none` there is JS's NaN or ±Infinity.
* Concrete evaluations use `decide +kernel`. Nothing here uses `native_decide`.

Left out: floating-point rounding, the header's chunk-length arithmetic (`u32`/`u16`),
strings. `pedalRanges` (src/inputs/pedal.ts), which `parse` hands its CC64 marks to, is
modelled in PedalMarks.lean and not repeated here; `makeScore`/`makeBars` are in Core.lean.
The hand assignment of midi.ts:217-218 is by construction (the lowest stream is "upper",
every other "lower") and is not restated.
-/
namespace Harmonicland.MidiParse

/-! ## Bytes (src/inputs/midi.ts:33-67) -/

abbrev Bytes := List Nat

/-- `dv.getUint8(p)`: `none` is the RangeError thrown outside the buffer. -/
def getU8 (b : Bytes) (p : Int) : Option Nat :=
  if 0 ≤ p then b[p.toNat]? else none

theorem getU8_bounds {b : Bytes} {p : Int} {x : Nat} (h : getU8 b p = some x) :
    0 ≤ p ∧ p < b.length := by
  unfold getU8 at h
  split at h
  · have := (List.getElem?_eq_some_iff.mp h).1
    omega
  · exact absurd h (by simp)

/-- The `do … while (b & 0x80)` loop of `readVarLen` (midi.ts:59-67), with `v` the
    32-bit integer JS's `<<` and `|` make it. Returns the value and the new `p`. Lean
    accepts it with the termination proof below: every pass reads one more byte of a
    finite buffer, and reading past the end throws. -/
def readVarLenLoop (b : Bytes) (p : Int) (v : BitVec 32) : Option (Int × Int) :=
  match _h : getU8 b p with
  | none => none
  | some byte =>
    let v' : BitVec 32 := (v <<< 7) ||| BitVec.ofNat 32 (byte &&& 0x7f)
    if byte &&& 0x80 ≠ 0 then readVarLenLoop b (p + 1) v' else some (v'.toInt, p + 1)
termination_by (b.length - p.toNat)
decreasing_by
  have := getU8_bounds _h
  omega

-- src/inputs/midi.ts:59
def readVarLen (b : Bytes) (p : Int) : Option (Int × Int) := readVarLenLoop b p 0

/-- The deltas of src/inputs/parsers.test.ts:31-34, as a check on the model: `60` is 96
    ticks and `83 60` is 480. -/
theorem readVarLen_tests :
    readVarLen [0x60] 0 = some (96, 1) ∧ readVarLen [0x83, 0x60] 0 = some (480, 2) ∧
    readVarLen [0x8f, 0x00] 0 = some (1920, 2) ∧ readVarLen [0x83] 0 = none := by
  decide +kernel

/-- Every successful read moves `p` forward and stays inside the buffer. -/
theorem readVarLenLoop_advances (b : Bytes) (p : Int) (v : BitVec 32) (x p' : Int)
    (h : readVarLenLoop b p v = some (x, p')) : p < p' ∧ 0 ≤ p ∧ p' ≤ b.length := by
  fun_induction readVarLenLoop b p v with
  | case1 p v hn => exact absurd h (by simp)
  | case2 p v byte hs v' hc ih =>
    have := getU8_bounds hs
    have := ih h
    omega
  | case3 p v byte hs v' hc =>
    have := getU8_bounds hs
    simp only [Option.some.injEq, Prod.mk.injEq] at h
    omega

theorem readVarLen_advances (b : Bytes) (p x p' : Int) (h : readVarLen b p = some (x, p')) :
    p < p' ∧ 0 ≤ p ∧ p' ≤ b.length :=
  readVarLenLoop_advances b p 0 x p' h

/-- FAILS: a variable-length quantity is not always a length. Five bytes overflow the
    32-bit `v`, and `8F FF FF FF 78` decodes to −8. (The SMF format allows at most four
    bytes; the reader does not count them.) `parse` then adds −8 to `p` (midi.ts:108,
    112) or to `tick` (midi.ts:79). Repro: proofs/repro/MidiParse_varlen_negative.ts -/
theorem FAILS_readVarLen_nonneg :
    ¬ (∀ (b : Bytes) (p x p' : Int), readVarLen b p = some (x, p') → 0 ≤ x) := by
  intro h
  have h1 : readVarLen [0x8f, 0xff, 0xff, 0xff, 0x78] 0 = some (-8, 5) := by decide +kernel
  have := h _ _ _ _ h1
  omega

/-! ### A well-formed quantity is a length -/

theorem varlen_acc (v : BitVec 32) (byte B : Nat) (h : v.toNat < B) (hB : B * 128 ≤ 268435456) :
    ((v <<< 7) ||| BitVec.ofNat 32 (byte &&& 0x7f)).toNat < B * 128 := by
  have hb : byte &&& 0x7f < 2 ^ 7 := by
    have := @Nat.and_le_right byte 0x7f
    omega
  rw [BitVec.toNat_or, BitVec.toNat_shiftLeft, BitVec.toNat_ofNat]
  have h1 : v.toNat <<< 7 % 2 ^ 32 = v.toNat <<< 7 := by
    apply Nat.mod_eq_of_lt; rw [Nat.shiftLeft_eq]; omega
  have h2 : (byte &&& 0x7f) % 2 ^ 32 = byte &&& 0x7f := by
    apply Nat.mod_eq_of_lt; omega
  rw [h1, h2, ← Nat.shiftLeft_add_eq_or_of_lt hb, Nat.shiftLeft_eq]
  omega

theorem toInt_small (v : BitVec 32) (h : v.toNat < 268435456) :
    0 ≤ v.toInt ∧ v.toInt < 268435456 := by
  rw [BitVec.toInt_eq_toNat_cond]
  split <;> omega

/-- One lemma per byte already read: with `v < B` and room for the bytes still allowed,
    the quantity comes out in `[0, 2^28)`. -/
theorem varlen_from (B : Nat) (left : Int) (hB : B * 128 ≤ 268435456)
    (next : ∀ (b : Bytes) (p : Int) (v : BitVec 32) (x p' : Int),
      readVarLenLoop b p v = some (x, p') → v.toNat < B * 128 → p' - p ≤ left - 1 →
        0 ≤ x ∧ x < 268435456)
    (b : Bytes) (p : Int) (v : BitVec 32) (x p' : Int)
    (h : readVarLenLoop b p v = some (x, p')) (hv : v.toNat < B) (hp : p' - p ≤ left) :
    0 ≤ x ∧ x < 268435456 := by
  rw [readVarLenLoop] at h
  split at h
  · exact absurd h (by simp)
  · rename_i byte hs
    have hacc := varlen_acc v byte B hv hB
    dsimp only at h
    split at h
    · exact next b (p + 1) _ x p' h hacc (by omega)
    · simp only [Option.some.injEq, Prod.mk.injEq] at h
      obtain ⟨rfl, _⟩ := h
      exact toInt_small _ (by omega)

/-- CLAIM (midi.ts:3 "variable-length deltas"): a variable-length quantity of at most four
    bytes — all the SMF format allows — decodes to a number in `[0, 2^28)`. So a file
    whose quantities are all that short satisfies `NonNegLens`, and the reader's loop
    ends on it (`trackLoop_terminates`). -/
theorem four_byte_varlen (b : Bytes) (p x p' : Int)
    (h : readVarLen b p = some (x, p')) (hlen : p' - p ≤ 4) : 0 ≤ x ∧ x < 268435456 := by
  refine varlen_from 1 4 (by omega) ?_ b p 0 x p' h (by decide) hlen
  intro b p v x p' h hv hp
  refine varlen_from 128 3 (by omega) ?_ b p v x p' h (by omega) (by omega)
  intro b p v x p' h hv hp
  refine varlen_from 16384 2 (by omega) ?_ b p v x p' h (by omega) (by omega)
  intro b p v x p' h hv hp
  refine varlen_from 2097152 1 (by omega) ?_ b p v x p' h (by omega) (by omega)
  intro b p v x p' h hv hp
  have := readVarLenLoop_advances b p v x p' h
  omega

/-! ## One pass of the track loop (src/inputs/midi.ts:78-135) -/

inductive Kind where
  | tempo | meter | key | on | off | pedal
  deriving DecidableEq, Repr

-- src/inputs/midi.ts:14   (the fields a kind does not use are left at 0)
structure TrackEvent where
  tick : Int
  kind : Kind
  pitch : Nat := 0
  vel : Nat := 0
  usPerQ : Nat := 0
  beats : Nat := 0
  unit : Int := 0
  fifths : Int := 0
  track : Nat := 0
  down : Bool := false
  deriving DecidableEq, Repr

/-- The mutable state of the loop: `p`, `tick`, `running`, and `events`. -/
structure St where
  p : Int
  tick : Int
  running : Nat
  events : List TrackEvent
  deriving DecidableEq, Repr

/-- `1 << n` on a byte `n`: a 32-bit shift by `n mod 32` (midi.ts:101). -/
def shl1 (n : Nat) : Int := ((1 : BitVec 32) <<< (n % 32)).toInt

/-- `dv.getInt8(p)` from the unsigned byte (midi.ts:106). -/
def toInt8 (k : Nat) : Int := if k ≥ 128 then (k : Int) - 256 else k

/-- The body of `while (p < end)` (midi.ts:79-134) for track index `t`; `none` is a
    thrown RangeError. -/
def step (b : Bytes) (t : Nat) (s : St) : Option St :=
  match readVarLen b s.p with                                   -- 79
  | none => none
  | some (delta, p) =>
    let tick := s.tick + delta
    match getU8 b p with                                        -- 80
    | none => none
    | some status0 =>
      let status := if status0 &&& 0x80 ≠ 0 then status0 else s.running   -- 81-86
      let p := if status0 &&& 0x80 ≠ 0 then p + 1 else p
      let running := if status0 &&& 0x80 ≠ 0 then status0 else s.running
      let hi := status &&& 0xf0                                 -- 87
      if status = 0xff then                                     -- 88: meta
        match getU8 b p with                                    -- 90
        | none => none
        | some type =>
          match readVarLen b (p + 1) with                       -- 91
          | none => none
          | some (mlen, p) =>
            if type = 0x51 then                                 -- 92
              match getU8 b p, getU8 b (p + 1), getU8 b (p + 2) with
              | some b0, some b1, some b2 =>
                let usPerQ := (b0 <<< 16) ||| (b1 <<< 8) ||| b2
                some { p := p + mlen, tick, running,
                       events := s.events ++ [{ tick, kind := .tempo, usPerQ }] }
              | _, _, _ => none
            else if type = 0x58 ∧ mlen ≥ 2 then                 -- 96
              match getU8 b p, getU8 b (p + 1) with
              | some num, some sh =>
                let den := shl1 sh
                some { p := p + mlen, tick, running,
                       events := if num > 0 then
                           s.events ++ [{ tick, kind := .meter, beats := num, unit := den }]
                         else s.events }
              | _, _ => none
            else if type = 0x59 ∧ mlen ≥ 1 then                 -- 103
              match getU8 b p with
              | some k =>
                some { p := p + mlen, tick, running,
                       events := s.events ++ [{ tick, kind := .key, fifths := toInt8 k }] }
              | none => none
            else some { p := p + mlen, tick, running, events := s.events }   -- 108
      else if status = 0xf0 ∨ status = 0xf7 then                -- 109: sysex
        match readVarLen b p with
        | none => none
        | some (slen, p) => some { p := p + slen, tick, running, events := s.events }
      else if hi = 0x90 then                                    -- 113: note on
        match getU8 b p, getU8 b (p + 1) with
        | some pitch, some vel =>
          some { p := p + 2, tick, running,
                 events := s.events ++
                   [{ tick, kind := if vel > 0 then .on else .off, pitch, vel, track := t + 1 }] }
        | _, _ => none
      else if hi = 0x80 then                                    -- 118: note off
        match getU8 b p, getU8 b (p + 1) with
        | some pitch, some _ =>
          some { p := p + 2, tick, running,
                 events := s.events ++ [{ tick, kind := .off, pitch, track := t + 1 }] }
        | _, _ => none
      else if hi = 0xb0 then                                    -- 123: control change
        match getU8 b p, getU8 b (p + 1) with
        | some controller, some value =>
          some { p := p + 2, tick, running,
                 events := if controller = 64 then
                     s.events ++ [{ tick, kind := .pedal, down := decide (value ≥ 64) }]
                   else s.events }
        | _, _ => none
      else if hi = 0xa0 ∨ hi = 0xe0 then                        -- 128
        some { p := p + 2, tick, running, events := s.events }
      else if hi = 0xc0 ∨ hi = 0xd0 then                        -- 130
        some { p := p + 1, tick, running, events := s.events }
      else some { p := p + 1, tick, running, events := s.events }   -- 133

/-- What became of `while (p < end) { … }` after at most `fuel` passes. -/
inductive Outcome where
  /-- The guard went false: the loop is over, in this state. -/
  | done (s : St)
  /-- A read went outside the buffer: `parse` throws a RangeError. -/
  | threw
  /-- `fuel` passes were made and the guard is still true. -/
  | stillRunning
  deriving DecidableEq, Repr

-- src/inputs/midi.ts:78
def trackLoop (b : Bytes) (t : Nat) (end_ : Int) : Nat → St → Outcome
  | 0, s => if s.p < end_ then .stillRunning else .done s
  | fuel + 1, s =>
    if s.p < end_ then
      match step b t s with
      | none => .threw
      | some s' => trackLoop b t end_ fuel s'
    else .done s

/-- A complete, 38-byte Standard MIDI File: the header (one track, 480 ticks a quarter),
    and a track whose first event is a text meta event (`FF 01`) with the five-byte
    length `8F FF FF FF 78`, then one note. The file of
    proofs/repro/MidiParse_track_loop_hangs.ts. -/
def hangFile : Bytes := [
  0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xe0,
  0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, 16,
  0x00, 0xff, 0x01, 0x8f, 0xff, 0xff, 0xff, 0x78,
  0x00, 0x90, 60, 100, 0x60, 0x80, 60, 0]

/-- The state after the first pass: back at the start of the track, in running status FF. -/
def hangState : St := { p := 22, tick := 0, running := 0xff, events := [] }

theorem hang_first_pass :
    step hangFile 0 { p := 22, tick := 0, running := 0, events := [] } = some hangState := by
  decide +kernel

theorem hang_fixed_point : step hangFile 0 hangState = some hangState := by decide +kernel

/-- FAILS (the caller's question: does the reader return or throw for every file?): on
    `hangFile` the track loop never ends. The meta event's length decodes to −8, `p += mlen`
    (midi.ts:108) puts `p` back at the start of the same event, and every later pass is
    the same pass: for every budget, the loop is still running. `parse` neither returns
    nor throws. Repro: proofs/repro/MidiParse_track_loop_hangs.ts -/
theorem FAILS_track_loop_terminates :
    ¬ (∀ (b : Bytes) (t : Nat) (end_ : Int) (s : St),
        ∃ fuel, trackLoop b t end_ fuel s ≠ .stillRunning) := by
  intro h
  obtain ⟨fuel, hf⟩ := h hangFile 0 38 { p := 22, tick := 0, running := 0, events := [] }
  have hstuck : ∀ n, trackLoop hangFile 0 38 n hangState = .stillRunning := by
    intro n
    induction n with
    | zero => decide +kernel
    | succ n ih =>
      have hp : hangState.p < 38 := by decide +kernel
      simp only [trackLoop, hp, ite_true, hang_fixed_point, ih]
  apply hf
  cases fuel with
  | zero => decide +kernel
  | succ n =>
    have hp : ({ p := 22, tick := 0, running := 0, events := [] } : St).p < 38 := by decide +kernel
    simp only [trackLoop, hp, ite_true, hang_first_pass, hstuck]

/-- Every length this file's reader will ever decode is a length. True of a well-formed
    SMF, whose variable-length quantities are at most four bytes (`four_byte_varlen`
    below); not checked by `parse`. -/
def NonNegLens (b : Bytes) : Prop :=
  ∀ (p x p' : Int), readVarLen b p = some (x, p') → 0 ≤ x

/-- With lengths that are lengths, every pass of the track loop reads forward: it
    consumes at least two bytes that are inside the buffer. -/
theorem step_advances (b : Bytes) (t : Nat) (s s' : St) (hl : NonNegLens b)
    (h : step b t s = some s') : s.p + 2 ≤ s'.p ∧ 0 ≤ s.p ∧ s.p + 2 ≤ b.length := by
  unfold step at h
  split at h
  · exact absurd h (by simp)
  · rename_i delta p1 hd
    have hd' := readVarLen_advances b s.p delta p1 hd
    split at h
    · exact absurd h (by simp)
    · rename_i status0 hs0
      have hb0 := getU8_bounds hs0
      dsimp only at h
      generalize hp2 : (if status0 &&& 0x80 ≠ 0 then p1 + 1 else p1) = p2 at h
      have hp2' : p1 ≤ p2 := by subst hp2; split <;> omega
      generalize (if status0 &&& 0x80 ≠ 0 then status0 else s.running) = status at h
      split at h
      · -- meta
        split at h
        · exact absurd h (by simp)
        · split at h
          · exact absurd h (by simp)
          · rename_i mlen p3 hm
            have hm' := readVarLen_advances b _ mlen p3 hm
            have hm0 := hl _ _ _ hm
            repeat' split at h
            all_goals (cases h <;> (dsimp only; omega))
      · split at h
        · -- sysex
          split at h
          · exact absurd h (by simp)
          · rename_i slen p3 hsl
            have hsl' := readVarLen_advances b _ slen p3 hsl
            have hsl0 := hl _ _ _ hsl
            cases h; dsimp only; omega
        · repeat' split at h
          all_goals (cases h <;> (dsimp only; omega))

/-- CLAIM (the caller's question, the half that holds): under `NonNegLens` the track loop
    ends for every file, every track bound and every starting state — by returning or by
    throwing — within one pass per two bytes of the buffer. -/
theorem trackLoop_terminates (b : Bytes) (t : Nat) (end_ : Int) (hl : NonNegLens b) :
    ∀ (fuel : Nat) (s : St), ((b.length : Int) - s.p).toNat < fuel →
      trackLoop b t end_ fuel s ≠ .stillRunning := by
  intro fuel
  induction fuel with
  | zero => intro s h; omega
  | succ n ih =>
    intro s h
    unfold trackLoop
    split
    · split
      · simp
      · rename_i s' hs
        have := step_advances b t s s' hl hs
        exact ih s' (by omega)
    · simp

/-! ## Barlines from the meter map (src/inputs/midi.ts:139-167) -/

/-- A `meter` event: where it stands, and the time signature. -/
structure Meter where
  tick : Rat
  beats : Int
  unit : Int

/-- A `bar` event (midi.ts:161). -/
structure BarEv where
  tick : Rat
  beats : Int
  unit : Int
  fifths : Int
  deriving DecidableEq, Repr

-- src/inputs/midi.ts:159   ((beats * 4) / unit) * division
def barTicksOf (division : Int) (m : Meter) : Rat :=
  ((m.beats * 4 : Int) : Rat) / (m.unit : Rat) * (division : Rat)

-- src/inputs/midi.ts:150
def keyAt (keys : List (Rat × Int)) (tick : Rat) : Int :=
  keys.foldl (fun f k => if k.1 ≤ tick then k.2 else f) 0

/-- `for (; t < until; t += barTicks) events.push(bar(t))` (midi.ts:163): the ticks pushed,
    and `t` as the loop leaves it. Lean accepts it with the termination proof below:
    `barTicks > 0` is what line 160's `if (barTicks <= 0) continue` guarantees. -/
def barLoop (until_ barTicks : Rat) (hb : 0 < barTicks) (t : Rat) : List Rat × Rat :=
  if _h : t < until_ then
    let r := barLoop until_ barTicks hb (t + barTicks)
    (t :: r.1, r.2)
  else ([], t)
termination_by ((until_ - t) / barTicks).ceil.toNat
decreasing_by
  have hne : barTicks ≠ 0 := by grind
  have e : (until_ - (t + barTicks)) / barTicks = (until_ - t) / barTicks - 1 := by
    have := Rat.mul_inv_cancel barTicks hne
    simp only [Rat.div_def]
    grind
  have hpos : (0 : Rat) < (until_ - t) / barTicks := (Rat.lt_div_iff hb).mpr (by grind)
  have h1 : (0 : Int) < ((until_ - t) / barTicks).ceil := Rat.lt_ceil_iff.mpr (by simpa using hpos)
  rw [e, Rat.ceil_sub_one]
  omega

theorem barLoop_spec (until_ barTicks : Rat) (hb : 0 < barTicks) (t : Rat) :
    (∀ x ∈ (barLoop until_ barTicks hb t).1, t ≤ x ∧ x < until_ ∧ x < (barLoop until_ barTicks hb t).2) ∧
    (barLoop until_ barTicks hb t).1.Pairwise (· < ·) ∧
    (t < until_ → until_ ≤ (barLoop until_ barTicks hb t).2 ∧
      (barLoop until_ barTicks hb t).2 < until_ + barTicks) ∧
    (¬ t < until_ → (barLoop until_ barTicks hb t).2 = t) ∧
    (barLoop until_ barTicks hb t).2 = t + ((barLoop until_ barTicks hb t).1.length : Rat) * barTicks := by
  fun_induction barLoop until_ barTicks hb t with
  | case1 t ht r ih =>
    obtain ⟨h1, h2, h3, h4, h5⟩ := ih
    refine ⟨?_, ?_, ?_, ?_, ?_⟩
    · intro x hx
      rcases List.mem_cons.mp hx with rfl | hx
      · refine ⟨Rat.le_refl, ht, ?_⟩
        show x < r.2
        by_cases hc : x + barTicks < until_
        · have := (h3 hc).1; grind
        · have := h4 hc; grind
      · have := h1 x hx
        exact ⟨by grind, this.2.1, this.2.2⟩
    · rw [List.pairwise_cons]
      refine ⟨?_, h2⟩
      intro x hx
      have := h1 x hx
      grind
    · intro _
      show until_ ≤ r.2 ∧ r.2 < until_ + barTicks
      by_cases hc : t + barTicks < until_
      · have := h3 hc; grind
      · have := h4 hc; grind
    · intro hn; exact absurd ht hn
    · show r.2 = t + (((t :: r.1).length : Nat) : Rat) * barTicks
      rw [h5, List.length_cons, Rat.natCast_add]
      have : ((1 : Nat) : Rat) = 1 := by decide +kernel
      grind
  | case2 t ht =>
    refine ⟨by simp, by simp, fun h => absurd h ht, fun _ => rfl, ?_⟩
    simp only [List.length_nil]
    have : ((0 : Nat) : Rat) = 0 := by decide +kernel
    grind

/-- The posts one meter lays down (the body of the `for i` loop, midi.ts:156-166): from
    its own tick up to the next meter's, or — for the last — up to `endTick` and then
    one closing post. `nxt` is `none` for the last meter. -/
def segment (division : Int) (keys : List (Rat × Int)) (endTick : Rat) (m : Meter)
    (nxt : Option Rat) : List BarEv :=
  if h : barTicksOf division m ≤ 0 then []                       -- 160
  else
    let r := barLoop (nxt.getD endTick) (barTicksOf division m) (Rat.not_le.mp h) m.tick
    let ticks := if nxt.isNone then r.1 ++ [r.2] else r.1        -- 166
    ticks.map (fun t => { tick := t, beats := m.beats, unit := m.unit, fifths := keyAt keys t })

-- src/inputs/midi.ts:155
def metersLoop (division : Int) (keys : List (Rat × Int)) (endTick : Rat) :
    List Meter → List BarEv
  | [] => []
  | [m] => segment division keys endTick m none
  | m :: m2 :: rest =>
    segment division keys endTick m (some m2.tick) ++
      metersLoop division keys endTick (m2 :: rest)

/-- The tests of src/inputs/parsers.test.ts:100-155, as a check on the model, in ticks at
    480 a quarter: 3/4 with the last event at 1920 gives posts 0, 1440, 2880; and 4/4 then
    2/4 from tick 1920 with the last event at 2880 gives 0, 1920, 2880. -/
theorem metersLoop_tests :
    (metersLoop 480 [] 1920 [⟨0, 3, 4⟩]).map (·.tick) = [0, 1440, 2880] ∧
    (metersLoop 480 [] 2880 [⟨0, 4, 4⟩, ⟨1920, 2, 4⟩]).map (·.tick) = [0, 1920, 2880] ∧
    (metersLoop 480 [] 480 [⟨0, 6, 8⟩]).map (·.tick) = [0, 1440] := by
  decide +kernel

theorem segment_spec (division : Int) (keys : List (Rat × Int)) (endTick : Rat) (m : Meter)
    (nxt : Option Rat) :
    ((segment division keys endTick m nxt).map (·.tick)).Pairwise (· < ·) ∧
    (∀ e ∈ segment division keys endTick m nxt, m.tick ≤ e.tick) ∧
    (∀ n, nxt = some n → ∀ e ∈ segment division keys endTick m nxt, e.tick < n) := by
  unfold segment
  split
  · simp
  · rename_i hbt
    have hs := barLoop_spec (nxt.getD endTick) (barTicksOf division m) (Rat.not_le.mp hbt) m.tick
    obtain ⟨h1, h2, h3, h4, h5⟩ := hs
    cases nxt with
    | none =>
      simp only [Option.isNone_none, ite_true, List.map_map, Option.getD_none] at *
      refine ⟨?_, ?_, ?_⟩
      · have : (List.map ((fun x : BarEv => x.tick) ∘ fun t =>
            ({ tick := t, beats := m.beats, unit := m.unit, fifths := keyAt keys t } : BarEv))
            ((barLoop endTick (barTicksOf division m) (Rat.not_le.mp hbt) m.tick).1 ++
              [(barLoop endTick (barTicksOf division m) (Rat.not_le.mp hbt) m.tick).2]))
            = (barLoop endTick (barTicksOf division m) (Rat.not_le.mp hbt) m.tick).1 ++
              [(barLoop endTick (barTicksOf division m) (Rat.not_le.mp hbt) m.tick).2] := by
          simp [Function.comp_def]
        rw [this, List.pairwise_append]
        refine ⟨h2, by simp, ?_⟩
        intro a ha b hb
        simp only [List.mem_singleton] at hb
        subst hb
        exact (h1 a ha).2.2
      · intro e he
        simp only [List.mem_map, List.mem_append, List.mem_singleton] at he
        obtain ⟨t, ht, rfl⟩ := he
        rcases ht with ht | rfl
        · exact (h1 t ht).1
        · show m.tick ≤ (barLoop endTick (barTicksOf division m) (Rat.not_le.mp hbt) m.tick).2
          by_cases hc : m.tick < endTick
          · have := (h3 hc).1; grind
          · rw [h4 hc]; exact Rat.le_refl
      · intro n hn; exact absurd hn (by simp)
    | some n =>
      simp only [Option.isNone_some, Bool.false_eq_true, ite_false, List.map_map,
        Option.getD_some] at *
      refine ⟨?_, ?_, ?_⟩
      · have : (List.map ((fun x : BarEv => x.tick) ∘ fun t =>
            ({ tick := t, beats := m.beats, unit := m.unit, fifths := keyAt keys t } : BarEv))
            (barLoop n (barTicksOf division m) (Rat.not_le.mp hbt) m.tick).1)
            = (barLoop n (barTicksOf division m) (Rat.not_le.mp hbt) m.tick).1 := by
          simp [Function.comp_def]
        rw [this]; exact h2
      · intro e he
        simp only [List.mem_map] at he
        obtain ⟨t, ht, rfl⟩ := he
        exact (h1 t ht).1
      · intro n' hn' e he
        simp only [Option.some.injEq] at hn'
        subst hn'
        simp only [List.mem_map] at he
        obtain ⟨t, ht, rfl⟩ := he
        exact (h1 t ht).2.1

/-- CLAIM (src/core.ts:21-23, what `makeScore` is told it is given: "FENCE POSTS: the start of
    every bar plus the end of the last one"; midi.ts:139 "Barlines are laid down in TICKS
    first, from the meter map"): the bar events come out in strictly increasing tick order
    — no duplicate, none out of place — whenever the meter events are in tick order,
    which the stable sort of midi.ts:144 makes them. -/
theorem metersLoop_sorted (division : Int) (keys : List (Rat × Int)) (endTick : Rat) :
    ∀ (ms : List Meter), ms.Pairwise (fun a b => a.tick ≤ b.tick) →
      ((metersLoop division keys endTick ms).map (·.tick)).Pairwise (· < ·) ∧
      (∀ m ∈ ms.head?, ∀ e ∈ metersLoop division keys endTick ms, m.tick ≤ e.tick) := by
  intro ms
  induction ms with
  | nil => intro _; simp [metersLoop]
  | cons m rest ih =>
    intro hs
    cases rest with
    | nil =>
      have := segment_spec division keys endTick m none
      simp only [metersLoop, List.head?_cons, Option.mem_def, Option.some.injEq]
      exact ⟨this.1, fun m' hm' e he => hm' ▸ this.2.1 e he⟩
    | cons m2 rest =>
      rw [List.pairwise_cons] at hs
      have hseg := segment_spec division keys endTick m (some m2.tick)
      obtain ⟨ih1, ih2⟩ := ih hs.2
      have hm2 : m.tick ≤ m2.tick := hs.1 m2 (by simp)
      simp only [metersLoop, List.map_append, List.head?_cons, Option.mem_def,
        Option.some.injEq]
      refine ⟨?_, ?_⟩
      · rw [List.pairwise_append]
        refine ⟨hseg.1, ih1, ?_⟩
        intro a ha b hb
        simp only [List.mem_map] at ha hb
        obtain ⟨ea, hea, rfl⟩ := ha
        obtain ⟨eb, heb, rfl⟩ := hb
        have h1 := hseg.2.2 m2.tick rfl ea hea
        have h2 := ih2 m2 (by simp) eb heb
        grind
      · intro m' hm' e he
        subst hm'
        rcases List.mem_append.mp he with he | he
        · exact hseg.2.1 e he
        · have := ih2 m2 (by simp) e he
          grind

/-- CLAIM (src/inputs/midi.ts:164-165 "the closing post: the end of the final bar, which runs
    its full length past the last note-off rather than stopping at it";
    parsers.test.ts:95 "runs the last bar full length"): the last meter's last post is at
    or past `endTick`, less than one bar past it, and a whole number of that meter's bars
    from where the meter began. -/
theorem closing_post_covers (endTick barTicks : Rat) (hb : 0 < barTicks) (t : Rat) :
    endTick ≤ (barLoop endTick barTicks hb t).2 ∧
    (t < endTick → (barLoop endTick barTicks hb t).2 < endTick + barTicks) ∧
    (barLoop endTick barTicks hb t).2
      = t + ((barLoop endTick barTicks hb t).1.length : Rat) * barTicks := by
  obtain ⟨_, _, h3, h4, h5⟩ := barLoop_spec endTick barTicks hb t
  refine ⟨?_, fun h => (h3 h).2, h5⟩
  by_cases hc : t < endTick
  · exact (h3 hc).1
  · rw [h4 hc]; exact Rat.not_lt.mp hc

/-- A finding with no stated claim against it (the caller's question: can a malformed file
    make the reader run away?): the number of bar events is the piece's length over the
    bar's, and nothing bounds the bar from below. A time-signature event whose
    denominator byte is 30 — a `1/2^30` meter — makes a bar 15/8388608 of a tick at 480
    ticks a quarter, so one quarter note is 2^28 bars: a 39-byte file asks for 268 million
    bar events, each then walked by `keyAt` and sorted. The loop does end; the process
    runs out of memory first. Repro: proofs/repro/MidiParse_tiny_file_many_bars.ts -/
theorem tiny_file_many_bars :
    268435456 ≤ (barLoop 480 (barTicksOf 480 ⟨0, 1, shl1 30⟩) (by decide +kernel) 0).1.length := by
  have h := closing_post_covers 480 (barTicksOf 480 ⟨0, 1, shl1 30⟩) (by decide +kernel) 0
  have hbt : barTicksOf 480 ⟨0, 1, shl1 30⟩ = 15 / 8388608 := by decide +kernel
  generalize (barLoop 480 (barTicksOf 480 ⟨0, 1, shl1 30⟩) (by decide +kernel) 0).2 = e at h
  generalize (barLoop 480 (barTicksOf 480 ⟨0, 1, shl1 30⟩) (by decide +kernel) 0).1.length = n at h ⊢
  rw [hbt] at h
  have h2 : ((268435456 : Nat) : Rat) ≤ (n : Rat) := by
    have : ((268435456 : Nat) : Rat) = 268435456 := by decide +kernel
    grind
  exact Rat.natCast_le_natCast.mp h2

/-- `1 << 31` is negative and `1 << 32` is 1: a denominator byte of 31 makes the meter's
    `unit` −2^31 (so `barTicks <= 0` and the meter lays no bars at all, midi.ts:160), and
    a byte of 32 or more wraps round. -/
theorem shl1_wraps : shl1 31 = -2147483648 ∧ shl1 32 = 1 ∧ shl1 2 = 4 ∧ shl1 3 = 8 := by
  decide +kernel

/-! ## Ticks to seconds (src/inputs/midi.ts:171-185) -/

/-- The header's one check on `division` (midi.ts:57): `division & 0x8000` must be 0. -/
def headerAccepts (division : Nat) : Bool := division &&& 0x8000 = 0

/-- `seconds += ((ev.tick - lastTick) * usPerQ) / division / 1e6` (midi.ts:184). `none` is
    "not a finite number": dividing by a `division` of 0 gives NaN or ±Infinity, and no
    later addition brings that back. -/
def advance (division : Int) (usPerQ : Nat) (lastTick tick : Rat) : Option Rat → Option Rat
  | none => none
  | some seconds =>
    if division = 0 then none
    else some (seconds + (tick - lastTick) * (usPerQ : Rat) / (division : Rat) / 1000000)

/-- An event as the integration sees it: its tick, and the tempo it sets if it is a
    `tempo` event. -/
structure Ev where
  tick : Rat
  tempo : Option Nat

/-- The second each event of the sorted stream lands on (the `for (const ev of events)`
    loop, midi.ts:183-187), for a `division` that is not 0. -/
def times (division : Int) : Nat → Rat → Rat → List Ev → List Rat
  | _, _, _, [] => []
  | usPerQ, lastTick, seconds, ev :: rest =>
    let seconds' := seconds + (ev.tick - lastTick) * (usPerQ : Rat) / (division : Rat) / 1000000
    seconds' :: times division (ev.tempo.getD usPerQ) ev.tick seconds' rest

theorem advance_eq (division : Int) (h : division ≠ 0) (usPerQ : Nat) (lastTick tick s : Rat) :
    advance division usPerQ lastTick tick (some s)
      = some (s + (tick - lastTick) * (usPerQ : Rat) / (division : Rat) / 1000000) := by
  simp [advance, h]

/-- FAILS (the caller's question: can a file produce NaN times?): a header whose
    `division` is 0 passes the reader's one check, and then no event has a finite time.
    Every note's onset and duration, and the score's duration, are NaN.
    Repro: proofs/repro/MidiParse_division_zero.ts -/
theorem FAILS_times_are_finite :
    ¬ (∀ (division : Nat), headerAccepts division = true →
        ∀ (usPerQ : Nat) (lastTick tick s : Rat),
          (advance (division : Int) usPerQ lastTick tick (some s)).isSome = true) := by
  intro h
  have := h 0 (by decide) 500000 0 0 0
  revert this
  decide +kernel

theorem increment_nonneg (division : Int) (hd : 0 < division) (usPerQ : Nat) (lastTick tick : Rat)
    (h : lastTick ≤ tick) :
    0 ≤ (tick - lastTick) * (usPerQ : Rat) / (division : Rat) / 1000000 := by
  have h1 : (0 : Rat) ≤ (tick - lastTick) * (usPerQ : Rat) :=
    Rat.mul_nonneg (by grind) Rat.natCast_nonneg
  have hd' : (0 : Rat) < (division : Rat) := Rat.intCast_pos.mpr hd
  have h2 : (0 : Rat) ≤ (tick - lastTick) * (usPerQ : Rat) / (division : Rat) := by
    rw [Rat.div_def]
    exact Rat.mul_nonneg h1 (Rat.le_of_lt (Rat.inv_pos.mpr hd'))
  grind

/-- CLAIM (src/inputs/midi.ts:176 "We need monotonic integration"): with a positive
    `division`, events in tick order land on seconds in order — whatever the tempo map
    does, a tempo of 0 µs a quarter included — and never before where the integration
    started. So onsets are not negative and a note-off is not before its note-on.

    HYPOTHESES: `division > 0` (the header check lets 0 through — `FAILS_times_are_finite`)
    and ticks that do not decrease from `lastTick` (a five-byte delta can make the first
    tick negative — `FAILS_readVarLen_nonneg`). -/
theorem times_monotone (division : Int) (hd : 0 < division) :
    ∀ (evs : List Ev) (usPerQ : Nat) (lastTick seconds : Rat),
      evs.Pairwise (fun a b => a.tick ≤ b.tick) → (∀ e ∈ evs, lastTick ≤ e.tick) →
        (times division usPerQ lastTick seconds evs).Pairwise (· ≤ ·) ∧
        (∀ x ∈ times division usPerQ lastTick seconds evs, seconds ≤ x) := by
  intro evs
  induction evs with
  | nil => intro _ _ _ _ _; simp [times]
  | cons ev rest ih =>
    intro usPerQ lastTick seconds hs hl
    rw [List.pairwise_cons] at hs
    have hinc := increment_nonneg division hd usPerQ lastTick ev.tick (hl ev (by simp))
    obtain ⟨ih1, ih2⟩ := ih (ev.tempo.getD usPerQ) ev.tick
      (seconds + (ev.tick - lastTick) * (usPerQ : Rat) / (division : Rat) / 1000000) hs.2 hs.1
    simp only [times]
    refine ⟨?_, ?_⟩
    · rw [List.pairwise_cons]; exact ⟨ih2, ih1⟩
    · intro x hx
      rcases List.mem_cons.mp hx with rfl | hx
      · grind
      · have := ih2 x hx; grind

/-- Events standing on `lastTick` itself land on `seconds` itself. -/
theorem times_same_tick (division : Int) :
    ∀ (evs : List Ev) (usPerQ : Nat) (lastTick seconds : Rat),
      evs.Pairwise (fun a b => a.tick ≤ b.tick) → (∀ e ∈ evs, lastTick ≤ e.tick) →
        ∀ ex ∈ evs.zip (times division usPerQ lastTick seconds evs),
          ex.1.tick = lastTick → ex.2 = seconds := by
  intro evs
  induction evs with
  | nil => intro _ _ _ _ _ ex hex; simp [times] at hex
  | cons ev rest ih =>
    intro usPerQ lastTick seconds hs hl ex hex heq
    rw [List.pairwise_cons] at hs
    simp only [times, List.zip_cons_cons, List.mem_cons] at hex
    rcases hex with rfl | hex
    · simp only at heq ⊢
      rw [heq]
      have : (lastTick - lastTick) = 0 := by grind
      rw [this]
      simp only [Rat.zero_mul, Rat.div_def]
      grind
    · -- ev is sandwiched between lastTick and ex, which stand on one tick
      have hmem : ex.1 ∈ rest := (List.of_mem_zip hex).1
      have h1 := hs.1 ex.1 hmem
      have h2 := hl ev (by simp)
      have hev : ev.tick = lastTick := by grind
      have := ih (ev.tempo.getD usPerQ) ev.tick
        (seconds + (ev.tick - lastTick) * (usPerQ : Rat) / (division : Rat) / 1000000)
        hs.2 hs.1 ex hex (by grind)
      rw [this, hev]
      have : (lastTick - lastTick) = 0 := by grind
      rw [this]
      simp only [Rat.zero_mul, Rat.div_def]
      grind

/-- CLAIM (src/inputs/midi.ts:139-142 "Barlines … ride through the same tempo integration as
    the notes below — so a barline and the note on it land on the same second by
    construction, never by two conversions agreeing"): any two events of the sorted
    stream on one tick land on one second — a bar event and a note-on, or a note on
    either side of a tempo change at that tick (the time is continuous across it). -/
theorem same_tick_same_second (division : Int) :
    ∀ (evs : List Ev) (usPerQ : Nat) (lastTick seconds : Rat),
      evs.Pairwise (fun a b => a.tick ≤ b.tick) → (∀ e ∈ evs, lastTick ≤ e.tick) →
        (evs.zip (times division usPerQ lastTick seconds evs)).Pairwise
          (fun a b => a.1.tick = b.1.tick → a.2 = b.2) := by
  intro evs
  induction evs with
  | nil => intro _ _ _ _ _; simp [times]
  | cons ev rest ih =>
    intro usPerQ lastTick seconds hs hl
    rw [List.pairwise_cons] at hs
    simp only [times, List.zip_cons_cons]
    rw [List.pairwise_cons]
    refine ⟨?_, ih _ _ _ hs.2 hs.1⟩
    intro ex hex heq
    exact (times_same_tick division rest _ ev.tick _ hs.2 hs.1 ex hex heq.symm).symm

/-! ## Pairing note-ons with note-offs (src/inputs/midi.ts:178-207) -/

-- src/types.ts:159   (the fields midi.ts fills)
structure Raw where
  pitch : Nat
  onset : Rat
  duration : Rat
  velocity : Nat
  stream : Nat
  deriving DecidableEq, Repr

inductive NoteEv where
  | on (track pitch vel : Nat)
  | off (track pitch : Nat)
  deriving DecidableEq, Repr

/-- The `open` Map (midi.ts:180): key -> the note-ons waiting, in insertion order. -/
abbrev OpenMap := List (Nat × List (Rat × Nat))

-- src/inputs/midi.ts:194   (ev.track << 7) | ev.pitch
def keyOf (track pitch : Nat) : Nat := (track <<< 7) ||| pitch

def openGet (m : OpenMap) (key : Nat) : Option (List (Rat × Nat)) :=
  (m.find? (fun e => e.1 = key)).map (·.2)

def openSet (m : OpenMap) (key : Nat) (stack : List (Rat × Nat)) : OpenMap :=
  if m.any (fun e => e.1 = key) then m.map (fun e => if e.1 = key then (key, stack) else e)
  else m ++ [(key, stack)]

-- src/inputs/midi.ts:192-203
def pairStep (st : OpenMap × List Raw) (seconds : Rat) : NoteEv → OpenMap × List Raw
  | .on track pitch vel =>
    let key := keyOf track pitch
    let stack := (openGet st.1 key).getD []                       -- 195
    (openSet st.1 key (stack ++ [(seconds, vel)]), st.2)          -- 196: push
  | .off track pitch =>
    match openGet st.1 (keyOf track pitch) with
    | some ((onset, velocity) :: restStack) =>                    -- 200: stack.shift()
      (openSet st.1 (keyOf track pitch) restStack,
       st.2 ++ [{ pitch, onset,
                  duration := if (1 / 50 : Rat) ≥ seconds - onset then 1 / 50 else seconds - onset,
                  velocity, stream := track }])
    | _ => st

-- src/inputs/midi.ts:206-207   "close any hung notes at end"
def closeHung (m : OpenMap) : List Raw :=
  m.flatMap (fun e => e.2.map (fun ov =>
    { pitch := e.1 &&& 0x7f, onset := ov.1, duration := 1 / 4, velocity := ov.2, stream := e.1 >>> 7 }))

def pairNotes (evs : List (Rat × NoteEv)) : List Raw :=
  let st := evs.foldl (fun st e => pairStep st e.1 e.2) ([], [])
  st.2 ++ closeHung st.1

/-- FAILS: the comment at midi.ts:193 says "stack note-ons of same key; pair LIFO on next
    off", and the code does `stack.shift()` — first in, first out. Two overlapping
    note-ons of one key, then one note-off: LIFO would close the SECOND note-on; the
    code closes the first. Repro: proofs/repro/MidiParse_pairs_fifo.ts -/
theorem FAILS_pairs_LIFO :
    ¬ (∀ (a b c : Rat), a < b → b < c →
        ((pairNotes [(a, .on 1 60 100), (b, .on 1 60 50), (c, .off 1 60)]).head?.map (·.onset))
          = some b) := by
  intro h
  have := h 0 (1 / 2) 1 (by decide +kernel) (by decide +kernel)
  revert this
  decide +kernel

/-- What the code does instead, on the file of the repro: two overlapping C4s struck at 0
    and 0.5 s and released at 1 and 1.5 s come out as two notes of one second each, the
    first note-off closing the first note-on. -/
theorem pairs_FIFO :
    pairNotes [(0, .on 1 60 100), (1 / 2, .on 1 60 50), (1, .off 1 60), (3 / 2, .off 1 60)]
      = [⟨60, 0, 1, 100, 1⟩, ⟨60, 1 / 2, 1, 50, 1⟩] := by
  decide +kernel

theorem pairStep_durations (st : OpenMap × List Raw) (seconds : Rat) (ev : NoteEv)
    (h : ∀ n ∈ st.2, 0 < n.duration) : ∀ n ∈ (pairStep st seconds ev).2, 0 < n.duration := by
  cases ev with
  | on track pitch vel => exact h
  | off track pitch =>
    simp only [pairStep]
    split
    · intro n hn
      rcases List.mem_append.mp hn with hn | hn
      · exact h n hn
      · simp only [List.mem_singleton] at hn
        subst hn
        dsimp only
        split <;> grind
    · exact h

/-- CLAIM (src/inputs/midi.ts:201 `Math.max(0.02, seconds - onset)`, :207 `duration: 0.25`):
    every note `parse` hands to `makeScore` has a positive duration, whatever order the
    note-ons and note-offs arrive in — a note-off at its note-on's own instant, or before
    it, still makes a 20 ms note. -/
theorem pairNotes_durations_positive (evs : List (Rat × NoteEv)) :
    ∀ n ∈ pairNotes evs, 0 < n.duration := by
  have hfold : ∀ (l : List (Rat × NoteEv)) (st : OpenMap × List Raw),
      (∀ n ∈ st.2, 0 < n.duration) →
        ∀ n ∈ (l.foldl (fun st e => pairStep st e.1 e.2) st).2, 0 < n.duration := by
    intro l
    induction l with
    | nil => intro st h; exact h
    | cons e t ih => intro st h; exact ih _ (pairStep_durations st e.1 e.2 h)
  intro n hn
  unfold pairNotes at hn
  rcases List.mem_append.mp hn with hn | hn
  · exact hfold evs ([], []) (by simp) n hn
  · unfold closeHung at hn
    simp only [List.mem_flatMap, List.mem_map] at hn
    obtain ⟨e, _, ov, _, rfl⟩ := hn
    show (0 : Rat) < 1 / 4
    decide +kernel

/-- CLAIM (src/inputs/midi.ts:178-179 "pair on/off within a track … keyed track<<7|pitch", read
    back at :207 as `pitch: key & 0x7f, stream: key >> 7`): the key holds the track and
    the pitch apart.

    HYPOTHESIS the code does not enforce: `pitch < 128`. A data byte with its top bit set
    is a pitch of 128..255 as far as `u8()` is concerned. See `FAILS_key_unpacks`. -/
theorem key_unpacks (track pitch : Nat) (h : pitch < 128) :
    keyOf track pitch &&& 0x7f = pitch ∧ keyOf track pitch >>> 7 = track := by
  unfold keyOf
  have hp : pitch < 2 ^ 7 := by omega
  rw [← Nat.shiftLeft_add_eq_or_of_lt hp, Nat.shiftLeft_eq]
  have h1 : (0x7f : Nat) = 2 ^ 7 - 1 := by decide
  rw [h1, Nat.and_two_pow_sub_one_eq_mod, Nat.shiftRight_eq_div_pow]
  omega

/-- FAILS without it: a "pitch" byte of 200 on track 1 has the key of pitch 72 on track 1.
    A note-off for 72 closes the note-on for 200, and a note-on for 200 never closed comes
    out as pitch 72. Reachable only from a malformed file.
    Repro: proofs/repro/MidiParse_pitch_over_127.ts -/
theorem FAILS_key_unpacks :
    ¬ (∀ (track pitch : Nat), pitch < 256 →
        keyOf track pitch &&& 0x7f = pitch ∧ keyOf track pitch >>> 7 = track) := by
  intro h
  have := h 1 200 (by decide)
  revert this
  decide +kernel

end Harmonicland.MidiParse
