import Harmonicland.Core

/-!
# Clock — `src/clock.ts`

The transport: play, pause, seek, the playback loop folded into `now()`, and
`ahead()`, which tells the scheduler what the next stretch of wall time plays.

## What the model is

The closure's mutable variables (`playing`, `base`, `startedAt`, `range`) are
the record `Clock`; each method is a function from a state to a state or a
value. The two things the methods read from outside — `performance.now()`
and `getDuration()` — are passed in as `ms` and `d`.

* `ahead`'s `for (;;)` loop (clock.ts:123-135) is the recursive `aheadGo`. In
  place of the integer `lap` it carries what the loop computes from it: `runIn`
  (`lap < 0`, true only on the first turn) and `lapStart` (`b + lap * len`).
* JavaScript's `%` is `jsMod`: the remainder that takes the dividend's sign.

## What the model leaves out

Floating point; the `requestAnimationFrame` loop and the subscriber sets
(`onFrame`, `onChange`, `stop`), which hold no arithmetic.
-/

namespace Harmonicland

/-- The closure state of `makeClock` — clock.ts:36-39. -/
structure Clock where
  playing : Bool
  /-- seconds accumulated before the current play span -/
  base : Rat
  /-- `performance.now()` when the current span began, in ms -/
  startedAt : Rat
  /-- the playback loop, clamped -/
  range : Option TimeRange
  deriving Repr

/-- src/types.ts:219 -/
structure Stretch where
  start : Rat
  end_ : Rat
  time : Rat
  until_ : Rat
  jump : Bool
  deriving Repr, DecidableEq

/-- A new clock — clock.ts:36-39. -/
def Clock.init : Clock := { playing := false, base := 0, startedAt := 0, range := none }

/-- clock.ts:43 -/
def outside (t : Rat) (r : TimeRange) : Bool := decide (t < r.start) || decide (t ≥ r.end_)

/-- clock.ts:49 -/
def unfolded (c : Clock) (ms : Rat) : Rat := c.base + (ms - c.startedAt) / 1000

/-- clock.ts:51 -/
def looping (c : Clock) : Bool :=
  match c.range with
  | some r => decide (c.base < r.end_)
  | none => false

/-- JavaScript `x % m`: `x - m * trunc(x / m)`. -/
def jsMod (x m : Rat) : Rat :=
  x - m * (if x / m < 0 then ((x / m).ceil : Rat) else ((x / m).floor : Rat))

/-- clock.ts:52-55 -/
def fold (c : Clock) (u : Rat) : Rat :=
  match c.range with
  | some r =>
    if ¬ looping c ∨ u < r.end_ then u
    else r.start + jsMod (u - r.start) (r.end_ - r.start)
  | none => u

/-- clock.ts:57-60 -/
def now (c : Clock) (ms : Rat) : Rat :=
  if ¬ c.playing then c.base else fold c (unfolded c ms)

/-- clock.ts:61-64 -/
def heard (c : Clock) (ms lag : Rat) : Rat :=
  if ¬ c.playing then c.base else fold c (max c.base (unfolded c (ms - lag * 1000)))

/-- clock.ts:65-72 -/
def play (c : Clock) (ms d : Rat) : Clock :=
  if c.playing then c
  else
    let base :=
      match c.range with
      | some r => if outside c.base r then r.start else if c.base ≥ d then 0 else c.base
      | none => if c.base ≥ d then 0 else c.base
    { c with base, playing := true, startedAt := ms }

/-- clock.ts:73-78 -/
def pause (c : Clock) (ms : Rat) : Clock :=
  if ¬ c.playing then c else { c with base := now c ms, playing := false }

/-- clock.ts:79-83 -/
def seek (c : Clock) (ms d t : Rat) : Clock :=
  { c with base := max 0 (min t d), startedAt := ms }

/-- clock.ts:88-90 — the loop as it will be accepted. -/
def clampLoop (r : Option TimeRange) (d : Rat) : Option TimeRange :=
  match r with
  | some r =>
    let start := max 0 r.start
    let end_ := min r.end_ d
    if end_ > start then some { start, end_ } else none
  | none => none

/-- clock.ts:87-101 -/
def setLoop (c : Clock) (ms d : Rat) (r : Option TimeRange) : Clock :=
  let next := clampLoop r d
  if next = c.range then c
  else
    let base := now c ms
    let base' :=
      match next with
      | some n => if c.playing ∧ outside base n then n.start else base
      | none => base
    { c with base := base', startedAt := ms, range := next }

/-- clock.ts:151-153, the part of `tick` that changes the state. -/
def tick (c : Clock) (ms d : Rat) : Clock :=
  if c.playing ∧ now c ms ≥ d then pause c ms else c

/-- clock.ts:110 -/
def wallOf (c : Clock) (u : Rat) : Rat := c.startedAt + (u - c.base) * 1000

/-- clock.ts:123-135, one turn of the loop and the turns after it. `a`, `b`
    are the loop's edges, `u1` the window's end, `lapStart` is `b + lap * len`
    and `runIn` is `lap < 0`.

    The guard `0 < b - a` is not in the source: there the loop always has
    positive length (`inv_setLoop`), and without it this would not terminate. -/
def aheadGo (c : Clock) (a b u1 : Rat) (runIn : Bool) (lapStart u : Rat) (jump : Bool) : List Stretch :=
  let len := b - a
  let next := lapStart + len
  let stop := min u1 next
  let start := if runIn then u else if jump then a else a + (u - lapStart)
  let here : List Stretch :=
    if stop - u ≥ EPS then [{ start, end_ := start + (stop - u), time := wallOf c u, until_ := b, jump }] else []
  if _h : stop < next ∨ next ≥ u1 ∨ ¬ 0 < len then here
  else here ++ aheadGo c a b u1 false next next true
termination_by ((u1 - (lapStart + (b - a))) / (b - a)).ceil.toNat
decreasing_by
  have hlen : 0 < b - a := by grind
  have _hnext : lapStart + (b - a) < u1 := by grind
  have hne : b - a ≠ 0 := by grind
  have e : (u1 - (lapStart + (b - a) + (b - a))) / (b - a) = (u1 - (lapStart + (b - a))) / (b - a) - 1 := by
    have : u1 - (lapStart + (b - a) + (b - a)) = (u1 - (lapStart + (b - a))) + -(b - a) := by grind
    rw [this, Rat.div_def, Rat.add_mul, ← Rat.div_def, Rat.neg_mul, Rat.mul_inv_cancel _ hne]
    grind
  rw [e, Rat.ceil_sub_one]
  have hpos : 0 < (u1 - (lapStart + (b - a))) / (b - a) := by
    rw [Rat.div_def]; exact Rat.mul_pos (by grind) (Rat.inv_pos.mpr hlen)
  have : 0 < ((u1 - (lapStart + (b - a))) / (b - a)).ceil := by
    have := @Rat.le_ceil ((u1 - (lapStart + (b - a))) / (b - a))
    have h0 : (0 : Rat) < (((u1 - (lapStart + (b - a))) / (b - a)).ceil : Rat) := by grind
    exact Rat.intCast_pos.mp h0
  omega

/-- clock.ts:111-115 — the stretch when no loop is being gone round. -/
def aheadStraight (c : Clock) (d u0 u1 : Rat) : List Stretch :=
  let end_ := min u1 d
  if u0 < end_ then [{ start := u0, end_, time := wallOf c u0, until_ := d, jump := false }] else []

/-- clock.ts:106-137 -/
def ahead (c : Clock) (d fromMs toMs : Rat) : List Stretch :=
  if ¬ c.playing ∨ toMs ≤ fromMs then []
  else
    let u0 := unfolded c (max fromMs c.startedAt)
    let u1 := unfolded c toMs
    match c.range with
    | none => aheadStraight c d u0 u1
    | some r =>
      if ¬ looping c then aheadStraight c d u0 u1
      else
        let len := r.end_ - r.start
        let runIn : Bool := decide (u0 < r.end_ - EPS)
        let lap : Int := if runIn then -1 else ((u0 - r.end_ + EPS) / len).floor
        let lapStart := r.end_ + lap * len
        let jump : Bool := decide (lap ≥ 0) && decide (u0 - lapStart < EPS)
        aheadGo c r.start r.end_ u1 runIn lapStart u0 jump

/-! # Theorems

## The invariant

> "An empty or out-of-score range is clamped, and one with nothing left is
> null." — types.ts:252
-/

/-- What every clock state satisfies, for a score `d` seconds long. -/
structure ClockInv (c : Clock) (d : Rat) : Prop where
  range : ∀ r, c.range = some r → 0 ≤ r.start ∧ r.start < r.end_ ∧ r.end_ ≤ d
  base : 0 ≤ c.base

theorem jsMod_bounds (x m : Rat) (hx : 0 ≤ x) (hm : 0 < m) : 0 ≤ jsMod x m ∧ jsMod x m < m := by
  unfold jsMod
  have hq : ¬ x / m < 0 := by
    rw [Rat.div_lt_iff hm]; grind
  simp only [hq, ite_false]
  have h1 : ((x / m).floor : Rat) ≤ x / m := Rat.floor_le _
  have h2 : x / m < ((x / m).floor : Rat) + 1 := by
    have := Rat.lt_floor_add_one (x / m)
    rw [Rat.intCast_add] at this
    exact this
  have h1' : ((x / m).floor : Rat) * m ≤ x := by
    apply Rat.not_lt.mp; intro h
    have := (Rat.div_lt_iff hm).mpr h; grind
  have h2' : x < (((x / m).floor : Rat) + 1) * m := (Rat.div_lt_iff hm).mp h2
  constructor <;> grind

theorem fold_of_lt (c : Clock) (r : TimeRange) (hr : c.range = some r) (u : Rat) (hu : u < r.end_) :
    fold c u = u := by
  unfold fold; simp [hr, hu]

theorem fold_of_ge (c : Clock) (r : TimeRange) (hr : c.range = some r) (hl : looping c = true) (u : Rat)
    (hu : ¬ u < r.end_) : fold c u = r.start + jsMod (u - r.start) (r.end_ - r.start) := by
  unfold fold; simp [hr, hl, hu]

/-- **Holds.** `fold` leaves time before the loop's end alone and brings
    anything at or past it back inside `[start, end)`. -/
theorem fold_bounds (c : Clock) (d : Rat) (hinv : ClockInv c d) (r : TimeRange) (hr : c.range = some r)
    (hl : looping c = true) (u : Rat) :
    fold c u < r.end_ ∧ (r.end_ ≤ u → r.start ≤ fold c u) ∧ (u < r.end_ → fold c u = u) := by
  obtain ⟨_, hlt, _⟩ := hinv.range r hr
  by_cases hu : u < r.end_
  · rw [fold_of_lt c r hr u hu]
    exact ⟨hu, fun h => by grind, fun _ => rfl⟩
  · rw [fold_of_ge c r hr hl u hu]
    have := jsMod_bounds (u - r.start) (r.end_ - r.start) (by grind) (by grind)
    exact ⟨by grind, fun _ => by grind, fun h => absurd h hu⟩

/-- At the instant a span begins, the time is its `base`. -/
theorem now_at_start (c : Clock) : now c c.startedAt = c.base := by
  unfold now
  split
  · rfl
  · have hz : unfolded c c.startedAt = c.base := by
      unfold unfolded
      have : c.startedAt - c.startedAt = 0 := by grind
      rw [this, Rat.div_def, Rat.zero_mul, Rat.add_zero]
    rw [hz]
    unfold fold
    cases hr : c.range with
    | none => rfl
    | some r =>
      simp only
      by_cases hb : c.base < r.end_
      · simp [hb]
      · simp [looping, hr, hb]

/-- **Holds.** "no frame ever observes a time past the loop's end"
    (types.ts:251), for a play span that began before that end — the "one
    rule" of clock.ts:16. -/
theorem now_in_loop (c : Clock) (d : Rat) (hinv : ClockInv c d) (r : TimeRange) (hr : c.range = some r)
    (hp : c.playing = true) (hl : looping c = true) (ms : Rat) : now c ms < r.end_ := by
  unfold now
  simp only [hp, not_true_eq_false, ite_false]
  exact (fold_bounds c d hinv r hr hl _).1

/-- **Holds.** "there is no instant at which the loop is not honoured"
    (clock.ts:14): once the span has reached the loop's end, `now()` is inside
    `[start, end)`. -/
theorem now_wrapped (c : Clock) (d : Rat) (hinv : ClockInv c d) (r : TimeRange) (hr : c.range = some r)
    (hp : c.playing = true) (hl : looping c = true) (ms : Rat) (hpast : r.end_ ≤ unfolded c ms) :
    r.start ≤ now c ms ∧ now c ms < r.end_ := by
  unfold now
  simp only [hp, not_true_eq_false, ite_false]
  have := fold_bounds c d hinv r hr hl (unfolded c ms)
  exact ⟨this.2.1 hpast, this.1⟩

theorem now_nonneg (c : Clock) (d : Rat) (hinv : ClockInv c d) (ms : Rat) (hms : c.startedAt ≤ ms) :
    0 ≤ now c ms := by
  have hb := hinv.base
  have hu : c.base ≤ unfolded c ms := by
    unfold unfolded
    have : 0 ≤ (ms - c.startedAt) / 1000 := by
      rw [Rat.div_def]; exact Rat.mul_nonneg (by grind) (by decide +kernel)
    grind
  unfold now
  split
  · exact hb
  · unfold fold
    cases hr : c.range with
    | none => simp only; grind
    | some r =>
      obtain ⟨h0, hlt, _⟩ := hinv.range r hr
      simp only
      split
      · grind
      · rename_i hcond
        have hge : ¬ unfolded c ms < r.end_ := fun h => hcond (Or.inr h)
        have := jsMod_bounds (unfolded c ms - r.start) (r.end_ - r.start) (by grind) (by grind)
        grind

theorem inv_init (d : Rat) : ClockInv Clock.init d := ⟨by simp [Clock.init], Rat.le_refl⟩

/-- **Holds.** `play` keeps the invariant. -/
theorem inv_play (c : Clock) (d ms : Rat) (hinv : ClockInv c d) : ClockInv (play c ms d) d := by
  unfold play
  split
  · exact hinv
  · refine ⟨hinv.range, ?_⟩
    have hb := hinv.base
    simp only
    cases hr : c.range with
    | none => simp only; split <;> grind
    | some r =>
      have := hinv.range r hr
      simp only; split
      · exact this.1
      · split <;> grind

/-- **Holds.** `pause` keeps the invariant (called no earlier than the span began). -/
theorem inv_pause (c : Clock) (d ms : Rat) (hinv : ClockInv c d) (hms : c.startedAt ≤ ms) :
    ClockInv (pause c ms) d := by
  unfold pause
  split
  · exact hinv
  · exact ⟨hinv.range, now_nonneg c d hinv ms hms⟩

/-- **Holds.** `seek` keeps the invariant: it "IS scrubbing" to a time
    clamped into the piece (clock.ts:80). -/
theorem inv_seek (c : Clock) (d ms t : Rat) (hinv : ClockInv c d) : ClockInv (seek c ms d t) d :=
  ⟨hinv.range, by simp only [seek]; grind⟩

theorem clampLoop_ok (r : Option TimeRange) (d : Rat) (n : TimeRange) (h : clampLoop r d = some n) :
    0 ≤ n.start ∧ n.start < n.end_ ∧ n.end_ ≤ d := by
  unfold clampLoop at h
  split at h
  · simp only at h
    split at h
    · cases h; simp only; grind
    · cases h
  · cases h

/-- **Holds.** `setLoop` keeps the invariant: the loop it accepts is "clamped,
    and one with nothing left is null" (types.ts:252). -/
theorem inv_setLoop (c : Clock) (d ms : Rat) (r : Option TimeRange) (hinv : ClockInv c d)
    (hms : c.startedAt ≤ ms) : ClockInv (setLoop c ms d r) d := by
  unfold setLoop
  simp only
  split
  · exact hinv
  · refine ⟨fun n hn => clampLoop_ok r d n hn, ?_⟩
    have hnow := now_nonneg c d hinv ms hms
    simp only
    cases hn : clampLoop r d with
    | none => exact hnow
    | some n =>
      have := clampLoop_ok r d n hn
      simp only; split <;> grind

/-! ## play and setLoop

> "play() from outside the loop enters it at `start`" — types.ts:250
> "play() always starts inside the loop, so a loop plays round and round"
> — clock.ts:17
-/

/-- **Holds.** After `play()` with a loop set, the span starts inside the loop
    — so it loops. -/
theorem play_enters_loop (c : Clock) (d ms : Rat) (hinv : ClockInv c d) (r : TimeRange)
    (hr : c.range = some r) (hp : c.playing = false) :
    r.start ≤ (play c ms d).base ∧ (play c ms d).base < r.end_ ∧ looping (play c ms d) = true := by
  have hrng := hinv.range r hr
  have hb : r.start ≤ (play c ms d).base ∧ (play c ms d).base < r.end_ := by
    unfold play
    simp only [hp, Bool.false_eq_true, ite_false, hr]
    by_cases ho : outside c.base r = true
    · simp only [ho, ite_true]; grind
    · simp only [ho, Bool.false_eq_true, ite_false]
      simp only [outside, Bool.or_eq_true, decide_eq_true_eq, not_or] at ho
      have h1 : r.start ≤ c.base := Rat.not_lt.mp ho.1
      have h2 : c.base < r.end_ := Rat.not_le.mp ho.2
      have : ¬ c.base ≥ d := by grind
      simp only [this, ite_false]
      exact ⟨h1, h2⟩
  refine ⟨hb.1, hb.2, ?_⟩
  have hr' : (play c ms d).range = some r := by
    unfold play; simp only [hp, Bool.false_eq_true, ite_false]; exact hr
  simp only [looping, hr', decide_eq_true_eq]; exact hb.2

/-- **Holds.** "restart from top if at end" (clock.ts:68): with no loop,
    `play()` at or past the end starts from 0. -/
theorem play_restarts (c : Clock) (d ms : Rat) (hr : c.range = none) (hp : c.playing = false)
    (hend : d ≤ c.base) : (play c ms d).base = 0 := by
  unfold play
  simp only [hp, Bool.false_eq_true, ite_false, hr]
  have : c.base ≥ d := hend
  simp [this]

/-- **Holds.** "the same loop again is no change — and must not be one"
    (clock.ts:91): the state is untouched. -/
theorem setLoop_same (c : Clock) (ms d : Rat) (r : Option TimeRange) (h : clampLoop r d = c.range) :
    setLoop c ms d r = c := by
  unfold setLoop; simp [h]

/-- What `setLoop` does when the loop really changes — clock.ts:96-99. -/
theorem setLoop_changed (c : Clock) (ms d : Rat) (r : Option TimeRange) (hne : clampLoop r d ≠ c.range) :
    (setLoop c ms d r).startedAt = ms ∧ (setLoop c ms d r).range = clampLoop r d ∧
      (setLoop c ms d r).playing = c.playing ∧
      (setLoop c ms d r).base =
        (match clampLoop r d with
          | some n => if c.playing ∧ outside (now c ms) n then n.start else now c ms
          | none => now c ms) := by
  unfold setLoop
  simp only [hne, ite_false]
  cases clampLoop r d <;> simp

/-- **Holds.** A loop set while playing is one the span is inside: it "plays
    round and round" from then on. -/
theorem setLoop_loops (c : Clock) (d ms : Rat) (r : Option TimeRange) (n : TimeRange)
    (hp : c.playing = true) (hn : clampLoop r d = some n) (hne : clampLoop r d ≠ c.range) :
    looping (setLoop c ms d r) = true := by
  have hrng := clampLoop_ok r d n hn
  obtain ⟨_, h2, _, h4⟩ := setLoop_changed c ms d r hne
  rw [hn] at h2 h4
  simp only [looping, h2, decide_eq_true_eq, h4, hp, true_and]
  by_cases ho : outside (now c ms) n = true
  · simp only [ho, ite_true]; exact hrng.2.1
  · simp only [ho, Bool.false_eq_true, ite_false]
    simp only [outside, Bool.or_eq_true, decide_eq_true_eq, not_or] at ho
    exact Rat.not_le.mp ho.2

/-- **Holds.** "re-anchor first, so a wrap the OLD loop already took is kept"
    (clock.ts:94): changing the loop does not move the present, unless the
    present is outside the new loop while playing. -/
theorem setLoop_keeps_now (c : Clock) (d ms : Rat) (r : Option TimeRange)
    (hstay : ∀ n, clampLoop r d = some n → c.playing = true → outside (now c ms) n = false) :
    now (setLoop c ms d r) ms = now c ms := by
  by_cases hne : clampLoop r d = c.range
  · rw [setLoop_same c ms d r hne]
  · obtain ⟨h1, _, _, h4⟩ := setLoop_changed c ms d r hne
    have := now_at_start (setLoop c ms d r)
    rw [h1] at this
    rw [this, h4]
    cases hn : clampLoop r d with
    | none => rfl
    | some n =>
      simp only
      by_cases hp : c.playing = true
      · simp [hp, hstay n hn hp]
      · simp [hp]

/-! ## ahead

> "The score time the wall window [fromMs, toMs) will play, as Stretches:
> more than one only where the loop wraps inside it, none while paused."
> — types.ts:261
> "THE WINDOWS are contiguous and half-open in wall time, so every note is
> struck exactly once per pass without any bookkeeping of which were."
> — scheduler.ts:18
-/

/-- A score time `o` falls in one of these stretches — so a note that begins
    at `o` is struck by the window that returned them (scheduler.ts:110). -/
def Covers (l : List Stretch) (o : Rat) : Prop := ∃ s ∈ l, s.start ≤ o ∧ o < s.end_

/-- **Holds.** "none while paused". -/
theorem ahead_paused (c : Clock) (d fromMs toMs : Rat) (hp : c.playing = false) : ahead c d fromMs toMs = [] := by
  unfold ahead; simp [hp]

theorem unfolded_mono (c : Clock) (w w' : Rat) (h : w ≤ w') : unfolded c w ≤ unfolded c w' := by
  unfold unfolded
  have : (w - c.startedAt) / 1000 ≤ (w' - c.startedAt) / 1000 := by
    rw [Rat.div_def, Rat.div_def]
    exact Rat.mul_le_mul_of_nonneg_right (by grind) (by decide +kernel)
  grind

theorem covers_straight (c : Clock) (d u0 u1 o : Rat) :
    Covers (aheadStraight c d u0 u1) o ↔ u0 ≤ o ∧ o < u1 ∧ o < d := by
  unfold Covers aheadStraight
  simp only
  split
  · simp only [List.mem_singleton, exists_eq_left]; grind
  · simp only [List.not_mem_nil, false_and, exists_false, false_iff]; grind

/-- `ahead` when no loop is being gone round. -/
theorem ahead_straight (c : Clock) (d w w' : Rat) (hp : c.playing = true) (hl : looping c = false)
    (hs : c.startedAt ≤ w) (hw : w < w') :
    ahead c d w w' = aheadStraight c d (unfolded c w) (unfolded c w') := by
  unfold ahead
  have h1 : ¬ (¬ c.playing = true ∨ w' ≤ w) := by grind
  have h2 : max w c.startedAt = w := by grind
  simp only [h1, ite_false, h2]
  cases hr : c.range with
  | none => rfl
  | some r => simp [hl]

/-- **Holds.** With no loop, contiguous windows strike "every note … exactly
    once": a score time is covered by the two windows `[w0, w1)`, `[w1, w2)`
    together exactly when the one window `[w0, w2)` covers it, and never by
    both. -/
theorem ahead_straight_exactly_once (c : Clock) (d w0 w1 w2 o : Rat) (hp : c.playing = true)
    (hl : looping c = false) (hs : c.startedAt ≤ w0) (h01 : w0 < w1) (h12 : w1 < w2) :
    (Covers (ahead c d w0 w2) o ↔ Covers (ahead c d w0 w1) o ∨ Covers (ahead c d w1 w2) o) ∧
      ¬ (Covers (ahead c d w0 w1) o ∧ Covers (ahead c d w1 w2) o) := by
  rw [ahead_straight c d w0 w2 hp hl hs (by grind), ahead_straight c d w0 w1 hp hl hs h01,
    ahead_straight c d w1 w2 hp hl (by grind) h12]
  simp only [covers_straight]
  have := unfolded_mono c w0 w1 (by grind)
  have := unfolded_mono c w1 w2 (by grind)
  constructor <;> grind

/-- **Holds.** With no loop, a stretch says truly when its notes sound: the
    wall time of score time `o`, read off any stretch, is the clock's own. -/
theorem ahead_straight_wall (c : Clock) (d w w' : Rat) (hp : c.playing = true) (hl : looping c = false)
    (hs : c.startedAt ≤ w) (hw : w < w') (s : Stretch) (hmem : s ∈ ahead c d w w') (o : Rat) :
    s.time + (o - s.start) * 1000 = wallOf c o := by
  rw [ahead_straight c d w w' hp hl hs hw] at hmem
  unfold aheadStraight at hmem
  simp only at hmem
  split at hmem
  · simp only [List.mem_singleton] at hmem
    subst hmem
    simp only [wallOf]; grind
  · cases hmem

/-- Every stretch of a lap after the window's first begins at the loop's
    start, flagged as a jump, and lies inside the loop. -/
theorem aheadGo_later (c : Clock) (a b u1 : Rat) (u : Rat) :
    ∀ s ∈ aheadGo c a b u1 false u u true,
      s.start = a ∧ EPS ≤ s.end_ - s.start ∧ s.end_ ≤ b ∧ s.until_ = b ∧ s.jump = true := by
  have key : ∀ (runIn : Bool) (lapStart u : Rat) (jump : Bool),
      runIn = false → lapStart = u → jump = true →
      ∀ s ∈ aheadGo c a b u1 runIn lapStart u jump,
        s.start = a ∧ EPS ≤ s.end_ - s.start ∧ s.end_ ≤ b ∧ s.until_ = b ∧ s.jump = true := by
    intro runIn lapStart u jump
    induction runIn, lapStart, u, jump using aheadGo.induct c a b u1 with
    | case1 runIn lapStart u jump len next stop h =>
      intro e1 e2 e3 s hs; subst e1 e2 e3
      rw [aheadGo] at hs
      have h' : min u1 (lapStart + (b - a)) < lapStart + (b - a) ∨ lapStart + (b - a) ≥ u1 ∨ ¬ 0 < b - a := h
      simp only [h', dite_true] at hs
      split at hs
      · simp only [List.mem_singleton] at hs; subst hs
        simp only [Bool.false_eq_true, ite_false, ite_true]
        refine ⟨?_, ?_, ?_, ?_, ?_⟩ <;> first | trivial | rfl | grind | (intro h; simp at h) | (intro _; grind) | (intro _; rfl)
      · cases hs
    | case2 runIn lapStart u jump len next stop h ih =>
      intro e1 e2 e3 s hs; subst e1 e2 e3
      rw [aheadGo] at hs
      have h' : ¬ (min u1 (lapStart + (b - a)) < lapStart + (b - a) ∨ lapStart + (b - a) ≥ u1 ∨ ¬ 0 < b - a) := h
      simp only [h', dite_false] at hs
      rcases List.mem_append.mp hs with hs | hs
      · split at hs
        · simp only [List.mem_singleton] at hs; subst hs
          simp only [Bool.false_eq_true, ite_false, ite_true]
          refine ⟨?_, ?_, ?_, ?_, ?_⟩ <;> first | trivial | rfl | grind | (intro h; simp at h) | (intro _; grind) | (intro _; rfl)
        · cases hs
      · exact ih rfl rfl rfl s hs
  exact key false u u true rfl rfl rfl

/-- The first turn of the loop: the stretch it may push, then the later laps. -/
theorem aheadGo_first (c : Clock) (a b u1 : Rat) (runIn : Bool) (lapStart u : Rat) (jump : Bool)
    (s : Stretch) (hs : s ∈ aheadGo c a b u1 runIn lapStart u jump) :
    (s = { start := if runIn then u else if jump then a else a + (u - lapStart),
           end_ := (if runIn then u else if jump then a else a + (u - lapStart)) +
             (min u1 (lapStart + (b - a)) - u),
           time := wallOf c u, until_ := b, jump := jump } ∧
        min u1 (lapStart + (b - a)) - u ≥ EPS) ∨
      s ∈ aheadGo c a b u1 false (lapStart + (b - a)) (lapStart + (b - a)) true := by
  rw [aheadGo] at hs
  split at hs
  · split at hs
    · simp only [List.mem_singleton] at hs; left; exact ⟨hs, by assumption⟩
    · cases hs
  · rcases List.mem_append.mp hs with hs | hs
    · split at hs
      · simp only [List.mem_singleton] at hs; left; exact ⟨hs, by assumption⟩
      · cases hs
    · right; exact hs

/-- The lap a window opens in — clock.ts:119 — brackets its opening time. -/
theorem lap_bracket (x len : Rat) (hlen : 0 < len) :
    ((x / len).floor : Rat) * len ≤ x ∧ x < ((x / len).floor : Rat) * len + len := by
  have h1 : ((x / len).floor : Rat) ≤ x / len := Rat.floor_le _
  have h2 : x / len < ((x / len).floor : Rat) + 1 := by
    have := Rat.lt_floor_add_one (x / len)
    rw [Rat.intCast_add] at this
    exact this
  have h1' : ((x / len).floor : Rat) * len ≤ x := by
    apply Rat.not_lt.mp; intro h
    have := (Rat.div_lt_iff hlen).mpr h; grind
  have h2' : x < (((x / len).floor : Rat) + 1) * len := (Rat.div_lt_iff hlen).mp h2
  exact ⟨h1', by grind⟩

/-- clock.ts:119 — the lap a window opens in, as its start `b + lap * len`. -/
def lapOf (r : TimeRange) (u0 : Rat) : Int :=
  if (decide (u0 < r.end_ - EPS) : Bool) then -1 else ((u0 - r.end_ + EPS) / (r.end_ - r.start)).floor

/-- `ahead` while a loop is being gone round — clock.ts:116-136. -/
theorem ahead_looping (c : Clock) (d : Rat) (r : TimeRange) (hr : c.range = some r) (hl : looping c = true)
    (hp : c.playing = true) (fromMs toMs : Rat) (hw : fromMs < toMs) :
    ahead c d fromMs toMs =
      aheadGo c r.start r.end_ (unfolded c toMs)
        (decide (unfolded c (max fromMs c.startedAt) < r.end_ - EPS))
        (r.end_ + (lapOf r (unfolded c (max fromMs c.startedAt)) : Rat) * (r.end_ - r.start))
        (unfolded c (max fromMs c.startedAt))
        (decide (lapOf r (unfolded c (max fromMs c.startedAt)) ≥ 0) &&
          decide (unfolded c (max fromMs c.startedAt) -
            (r.end_ + (lapOf r (unfolded c (max fromMs c.startedAt)) : Rat) * (r.end_ - r.start)) < EPS)) := by
  unfold ahead
  have h1 : ¬ toMs ≤ fromMs := Rat.not_le.mpr hw
  simp only [hp, not_true_eq_false, false_or, h1, ite_false, hr, hl]
  rfl

/-- Where the window's opening lap begins, relative to its opening time `u0`. -/
theorem lapOf_spec (r : TimeRange) (hlen : 0 < r.end_ - r.start) (u0 : Rat) :
    (u0 < r.end_ - EPS → lapOf r u0 = -1 ∧ r.end_ + (lapOf r u0 : Rat) * (r.end_ - r.start) = r.start) ∧
      (¬ u0 < r.end_ - EPS → 0 ≤ lapOf r u0 ∧
        r.end_ + (lapOf r u0 : Rat) * (r.end_ - r.start) ≤ u0 + EPS ∧
        u0 + EPS < r.end_ + (lapOf r u0 : Rat) * (r.end_ - r.start) + (r.end_ - r.start)) := by
  refine ⟨?_, ?_⟩
  · intro h
    have e : lapOf r u0 = -1 := by simp [lapOf, h]
    refine ⟨e, ?_⟩
    rw [e, show ((-1 : Int) : Rat) = -1 from rfl]; grind
  · intro h
    have e : lapOf r u0 = ((u0 - r.end_ + EPS) / (r.end_ - r.start)).floor := by simp [lapOf, h]
    have hb := lap_bracket (u0 - r.end_ + EPS) (r.end_ - r.start) hlen
    rw [← e] at hb
    have hx : 0 ≤ u0 - r.end_ + EPS := by have := Rat.not_lt.mp h; grind
    refine ⟨?_, by grind, by grind⟩
    -- a negative lap would start more than a loop's length before `u0`
    apply Int.not_lt.mp
    intro hneg
    have hc : (lapOf r u0 : Rat) ≤ ((-1 : Int) : Rat) := Rat.intCast_le_intCast.mpr (by omega)
    rw [show ((-1 : Int) : Rat) = -1 from rfl] at hc
    have := Rat.mul_le_mul_of_nonneg_right hc (Rat.le_of_lt hlen)
    grind

/-- The stretch the first turn of the loop pushes, from where its lap begins. -/
theorem first_stretch (a b u1 u0 lapStart : Rat) (runIn jump : Bool)
    (hrun : runIn = true → lapStart = a ∧ jump = false)
    (hnot : runIn = false → lapStart ≤ u0 + EPS ∧ u0 + EPS < lapStart + (b - a) ∧
      (jump = true → u0 - lapStart < EPS) ∧ (jump = false → EPS ≤ u0 - lapStart))
    (hge : min u1 (lapStart + (b - a)) - u0 ≥ EPS) :
    EPS ≤ ((if runIn then u0 else if jump then a else a + (u0 - lapStart)) +
        (min u1 (lapStart + (b - a)) - u0)) - (if runIn then u0 else if jump then a else a + (u0 - lapStart)) ∧
      (if runIn then u0 else if jump then a else a + (u0 - lapStart)) + (min u1 (lapStart + (b - a)) - u0) ≤ b + EPS ∧
      (jump = false →
        (if runIn then u0 else if jump then a else a + (u0 - lapStart)) + (min u1 (lapStart + (b - a)) - u0) ≤ b) ∧
      (jump = true → (if runIn then u0 else if jump then a else a + (u0 - lapStart)) = a) := by
  have heps := EPS_pos
  cases runIn <;> cases jump <;> simp only [Bool.false_eq_true, ite_false, ite_true] <;>
    (refine ⟨?_, ?_, ?_, ?_⟩ <;> first | grind | (intro h; first | cases h | rfl | grind))

/-- **Holds.** While going round a loop, every stretch `ahead` returns is at
    least `EPS` long, names the loop's end as its `until`, begins at the
    loop's start when it is a jump, and ends no more than `EPS` past the
    loop's end — and not past it at all unless it is a jump. -/
theorem ahead_loop_stretches (c : Clock) (d : Rat) (hinv : ClockInv c d) (r : TimeRange)
    (hr : c.range = some r) (hl : looping c = true) (fromMs toMs : Rat) :
    ∀ s ∈ ahead c d fromMs toMs,
      EPS ≤ s.end_ - s.start ∧ s.until_ = r.end_ ∧ s.end_ ≤ r.end_ + EPS ∧
        (s.jump = false → s.end_ ≤ r.end_) ∧ (s.jump = true → s.start = r.start) := by
  obtain ⟨_, hlt, _⟩ := hinv.range r hr
  have hlen : 0 < r.end_ - r.start := by grind
  have heps := EPS_pos
  intro s hs
  by_cases hgo : c.playing = true ∧ fromMs < toMs
  · rw [ahead_looping c d r hr hl hgo.1 fromMs toMs hgo.2] at hs
    generalize unfolded c (max fromMs c.startedAt) = u0 at hs
    obtain ⟨hA, hB⟩ := lapOf_spec r hlen u0
    generalize hLS : r.end_ + (lapOf r u0 : Rat) * (r.end_ - r.start) = lapStart at hs hA hB
    rcases aheadGo_first _ _ _ _ _ _ _ _ s hs with ⟨e, hge⟩ | hlater
    · have hf := first_stretch r.start r.end_ (unfolded c toMs) u0 lapStart
        (decide (u0 < r.end_ - EPS)) (decide (lapOf r u0 ≥ 0) && decide (u0 - lapStart < EPS))
        (by
          intro h
          have h' : u0 < r.end_ - EPS := by simpa using h
          obtain ⟨e1, e2⟩ := hA h'
          refine ⟨e2, ?_⟩
          simp [e1])
        (by
          intro h
          have h' : ¬ u0 < r.end_ - EPS := by simpa using h
          obtain ⟨e1, e2, e3⟩ := hB h'
          refine ⟨e2, e3, ?_, ?_⟩
          · intro hj; simp only [Bool.and_eq_true, decide_eq_true_eq] at hj; exact hj.2
          · intro hj
            simp only [e1, decide_true, Bool.true_and, decide_eq_false_iff_not] at hj
            exact Rat.not_lt.mp hj)
        hge
      subst e
      exact ⟨hf.1, rfl, hf.2.1, hf.2.2.1, hf.2.2.2⟩
    · have := aheadGo_later c r.start r.end_ _ _ s hlater
      refine ⟨this.2.1, this.2.2.2.1, by grind, fun _ => this.2.2.1, fun _ => this.1⟩
  · have : ahead c d fromMs toMs = [] := by
      unfold ahead
      have : ¬ c.playing = true ∨ toMs ≤ fromMs := by grind
      simp only [this, ite_true]
    rw [this] at hs; cases hs

/-! ### Where `ahead` fails at a loop's wrap

`ahead` treats a window that opens within `EPS` of a lap's start as opening
ON it (clock.ts:119-122). The stretch it then returns begins at the loop's
start but is as long as the window, so it is up to `EPS` out of step with the
windows either side of it. -/

/-- A window that stops before its lap's wrap is one turn of the loop. -/
theorem aheadGo_one (c : Clock) (a b u1 : Rat) (runIn : Bool) (lapStart u : Rat) (jump : Bool)
    (h : min u1 (lapStart + (b - a)) < lapStart + (b - a)) :
    aheadGo c a b u1 runIn lapStart u jump =
      if min u1 (lapStart + (b - a)) - u ≥ EPS then
        [{ start := if runIn then u else if jump then a else a + (u - lapStart),
           end_ := (if runIn then u else if jump then a else a + (u - lapStart)) +
             (min u1 (lapStart + (b - a)) - u),
           time := wallOf c u, until_ := b, jump := jump }]
      else [] := by
  rw [aheadGo]; simp [h]

/-- The first turn's stretch is in the result whenever it is long enough. -/
theorem aheadGo_first_mem (c : Clock) (a b u1 : Rat) (runIn : Bool) (lapStart u : Rat) (jump : Bool)
    (h : min u1 (lapStart + (b - a)) - u ≥ EPS) :
    ({ start := if runIn then u else if jump then a else a + (u - lapStart),
       end_ := (if runIn then u else if jump then a else a + (u - lapStart)) +
         (min u1 (lapStart + (b - a)) - u),
       time := wallOf c u, until_ := b, jump := jump } : Stretch) ∈
      aheadGo c a b u1 runIn lapStart u jump := by
  rw [aheadGo]
  simp only [h, ite_true]
  split <;> simp

/-- A loop one second long, playing from 0 since wall time 0. -/
def loopClock : Clock := { playing := true, base := 0, startedAt := 0, range := some ⟨0, 1⟩ }

theorem loopClock_inv : ClockInv loopClock 10 :=
  ⟨by intro r hr; cases hr; decide +kernel, by decide +kernel⟩

/-- A loop of 50ms — shorter than the scheduler's 100ms look-ahead. -/
def shortClock : Clock := { playing := true, base := 0, startedAt := 0, range := some ⟨0, 1 / 20⟩ }

theorem shortClock_inv : ClockInv shortClock 10 :=
  ⟨by intro r hr; cases hr; decide +kernel, by decide +kernel⟩

/-- **Fails:** a `Stretch` is score time "[start, end)" that "runs linearly
    from `start` until `until` — the loop's end" (types.ts:215-218), so it
    should end by `until`. A window that opens half a microsecond before a
    wrap and reaches past the next one returns a stretch that begins at the
    loop's start and ends half a microsecond PAST the loop's end.
    Repro: `repro/clock_stretch_past_until.ts`. -/
theorem FAILS_ahead_end_le_until :
    ¬ ∀ (c : Clock) (d : Rat), ClockInv c d → ∀ fromMs toMs : Rat,
        ∀ s ∈ ahead c d fromMs toMs, s.end_ ≤ s.until_ := by
  intro h
  have hmem := aheadGo_first_mem shortClock 0 (1 / 20) (unfolded shortClock (1999995 / 10000))
    (decide (unfolded shortClock (max (999995 / 10000) shortClock.startedAt) < (1 : Rat) / 20 - EPS))
    ((1 : Rat) / 20 + (lapOf ⟨0, 1 / 20⟩ (unfolded shortClock (max (999995 / 10000) shortClock.startedAt)) : Rat) *
      ((1 : Rat) / 20 - 0))
    (unfolded shortClock (max (999995 / 10000) shortClock.startedAt))
    (decide (lapOf ⟨0, 1 / 20⟩ (unfolded shortClock (max (999995 / 10000) shortClock.startedAt)) ≥ 0) &&
      decide (unfolded shortClock (max (999995 / 10000) shortClock.startedAt) -
        ((1 : Rat) / 20 + (lapOf ⟨0, 1 / 20⟩ (unfolded shortClock (max (999995 / 10000) shortClock.startedAt)) : Rat) *
          ((1 : Rat) / 20 - 0)) < EPS))
    (by decide +kernel)
  have := h shortClock 10 shortClock_inv (999995 / 10000) (1999995 / 10000) _
    (by rw [ahead_looping shortClock 10 ⟨0, 1 / 20⟩ rfl (by decide +kernel) rfl _ _ (by decide +kernel)]
        exact hmem)
  exact absurd this (by decide +kernel)

/-- When a window's stretch strikes the note at score time `o` — scheduler.ts:97. -/
def strikeWall (s : Stretch) (o : Rat) : Rat := s.time + (o - s.start) * 1000

/-- The window `[999.9995ms, 1100ms)` on `loopClock`: it opens half a
    microsecond before the first wrap. -/
theorem loopClock_windowB :
    ahead loopClock 10 (9999995 / 10000) 1100 =
      [{ start := 0, end_ := 1000005 / 10000000, time := 9999995 / 10000, until_ := 1, jump := true }] := by
  rw [ahead_looping loopClock 10 ⟨0, 1⟩ rfl (by decide +kernel) rfl _ _ (by decide +kernel)]
  rw [aheadGo_one _ _ _ _ _ _ _ _ (by decide +kernel)]
  decide +kernel

/-- The window after it, `[1100ms, 1200ms)`. -/
theorem loopClock_windowC :
    ahead loopClock 10 1100 1200 =
      [{ start := 1 / 10, end_ := 2 / 10, time := 1100, until_ := 1, jump := false }] := by
  rw [ahead_looping loopClock 10 ⟨0, 1⟩ rfl (by decide +kernel) rfl _ _ (by decide +kernel)]
  rw [aheadGo_one _ _ _ _ _ _ _ _ (by decide +kernel)]
  decide +kernel

/-- The window before it, `[900ms, 999.9995ms)`. -/
theorem loopClock_windowA :
    ahead loopClock 10 900 (9999995 / 10000) =
      [{ start := 9 / 10, end_ := 9999995 / 10000000, time := 900, until_ := 1, jump := false }] := by
  rw [ahead_looping loopClock 10 ⟨0, 1⟩ rfl (by decide +kernel) rfl _ _ (by decide +kernel)]
  rw [aheadGo_one _ _ _ _ _ _ _ _ (by decide +kernel)]
  decide +kernel

/-- **Fails:** "every note is struck exactly once per pass" (scheduler.ts:19).
    Two contiguous windows both cover score time 0.1000002 of the same lap: a
    note that begins there is struck by each, half a microsecond apart.
    Repro: `repro/clock_wrap_double_strike.ts`. -/
theorem FAILS_ahead_struck_once :
    ¬ ∀ (c : Clock) (d : Rat), ClockInv c d → ∀ (w0 w1 w2 o : Rat), c.startedAt ≤ w0 → w0 < w1 → w1 < w2 →
        ∀ s1 ∈ ahead c d w0 w1, ∀ s2 ∈ ahead c d w1 w2,
          s1.start ≤ o → o < s1.end_ → s2.start ≤ o → o < s2.end_ →
          1 ≤ absR (strikeWall s1 o - strikeWall s2 o) := by
  intro h
  have := h loopClock 10 loopClock_inv (9999995 / 10000) 1100 1200 (1000002 / 10000000)
    (by decide +kernel) (by decide +kernel) (by decide +kernel)
    _ (by rw [loopClock_windowB]; exact List.mem_singleton.mpr rfl)
    _ (by rw [loopClock_windowC]; exact List.mem_singleton.mpr rfl)
    (by decide +kernel) (by decide +kernel) (by decide +kernel) (by decide +kernel)
  exact absurd this (by decide +kernel)

/-- **Fails:** likewise a note can be struck by neither. The playhead passes
    score time 0.9999997 at wall time 999.9997ms, inside the windows
    `[900, 999.9995)` and `[999.9995, 1100)` — and neither covers it.
    Repro: `repro/clock_wrap_double_strike.ts`. -/
theorem FAILS_ahead_struck_at_all :
    ¬ ∀ (c : Clock) (d : Rat), ClockInv c d → ∀ (w0 w1 w2 o : Rat) (r : TimeRange), c.range = some r →
        c.startedAt ≤ w0 → w0 < w1 → w1 < w2 →
        unfolded c w0 ≤ o → o < unfolded c w2 → o < r.end_ →
        Covers (ahead c d w0 w1) o ∨ Covers (ahead c d w1 w2) o := by
  intro h
  have := h loopClock 10 loopClock_inv 900 (9999995 / 10000) 1100 (9999997 / 10000000) ⟨0, 1⟩ rfl
    (by decide +kernel) (by decide +kernel) (by decide +kernel)
    (by decide +kernel) (by decide +kernel) (by decide +kernel)
  rw [loopClock_windowA, loopClock_windowB] at this
  simp only [Covers, List.mem_singleton, exists_eq_left] at this
  exact absurd this (by decide +kernel)

end Harmonicland
