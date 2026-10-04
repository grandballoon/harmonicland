/-!
# Mic — `src/mic/window.ts`, `gate.ts`, `note-tracker.ts`, `settings.ts`, `transcriber.ts`

Microphone audio in, note events out: the ring of recent samples and the
window the model reads; which frames a run commits; the noise gate; the
per-key note tracker; and the option values the settings can produce.

## What the model is

* **StreamWindow** (window.ts:50-86). `written` is a `Nat`. The ring is a
  function from index to sample; `x & (CAPACITY - 1)` on a non-negative integer
  is `x % CAPACITY`. `push` writes one sample at a time, which is the sequence
  of writes the loop at window.ts:55-58 makes. A ghost `hist` — every sample
  ever pushed — is carried beside the state so theorems can say which sample a
  ring slot holds; the code has no such field.
* **Transcriber** (transcriber.ts:103-138). Only what decides WHICH frames reach
  the tracker: `committed`, and for each model run the `written` its snapshot
  was taken at and the `lookahead` in force when it commits (it is read after
  the `await`, transcriber.ts:127, so `setOptions` may have changed it).
  Promises, `busy`, `failed`, the sinks and the stats are left out.
* **NoiseGate** (gate.ts:40-75). Levels are `Rat` dB; `-Infinity` (digital
  silence) is the explicit `none`.
* **NoteTracker** (note-tracker.ts:56-122). One key's five typed-array cells
  are the record `Key`; the loop body is `keyStep`. A typed-array store wraps:
  `Uint8Array` keeps `x % 256`, `Uint16Array` keeps `x % 65536`. Activations
  and thresholds are `Rat`.

## What the model leaves out

* Floating-point rounding, `NaN`. In particular `lastOnset` is a
  `Float32Array` (note-tracker.ts:60): the code compares the float32-rounded
  previous onset with a float64 threshold; the model compares exact values.
  (The model's own outputs are float32, for which the rounding is the identity.)
* Non-integer `confirmFrames`/`minHoldFrames`/`releaseFrames`/`holdFrames`.
* The model itself (`Infer`), `frameLevelDb`, the worklet, the worker protocol,
  storage of settings.
* Names Lean reserves: `open` is `open_`.
-/

namespace Harmonicland.Mic

theorem ifPos {α : Sort _} {c : Prop} [Decidable c] {a b : α} (h : c) :
    (if c then a else b) = a := by simp [h]

theorem ifNeg {α : Sort _} {c : Prop} [Decidable c] {a b : α} (h : ¬ c) :
    (if c then a else b) = b := by simp [h]

/-! ## Geometry — src/mic/window.ts:27-41 -/

/-- src/mic/window.ts:27 -/
def SAMPLE_RATE : Int := 22050
/-- src/mic/window.ts:28 -/
def FRAME_HOP : Int := 256
/-- src/mic/window.ts:29 — `SAMPLE_RATE * 2 - FRAME_HOP`. -/
def WINDOW_SAMPLES : Int := 43844
/-- src/mic/window.ts:30 -/
def WINDOW_FRAMES : Int := 172
/-- src/mic/window.ts:41 — `1 << 16`. -/
def CAPACITY : Nat := 65536
/-- src/mic/window.ts:32 -/
def LOWEST_PITCH : Int := 21

/-- window.ts:29: the literal is the expression. -/
theorem window_samples_def : WINDOW_SAMPLES = SAMPLE_RATE * 2 - FRAME_HOP := by decide

/-- window.ts:13-14 "Frame f of a window starting at sample S describes the
    audio at sample S + f·FRAME_HOP": every one of the window's frames
    describes a sample inside the window. -/
theorem every_frame_inside_window (f : Int) (h0 : 0 ≤ f) (h1 : f < WINDOW_FRAMES) :
    f * FRAME_HOP < WINDOW_SAMPLES := by
  unfold WINDOW_FRAMES at h1; unfold FRAME_HOP WINDOW_SAMPLES; omega

/-! ## StreamWindow — src/mic/window.ts:50-86 -/

/-- src/mic/window.ts:50-52, plus the ghost `hist`. -/
structure StreamWindow where
  ring : Nat → Rat
  written : Nat
  hist : List Rat

/-- `new StreamWindow()`. -/
def StreamWindow.empty : StreamWindow := { ring := fun _ => 0, written := 0, hist := [] }

/-- src/mic/window.ts:56 — one turn of `push`'s loop, with its share of line 58. -/
def push1 (w : StreamWindow) (x : Rat) : StreamWindow :=
  { ring := fun j => if j = w.written % CAPACITY then x else w.ring j,
    written := w.written + 1,
    hist := w.hist ++ [x] }

/-- src/mic/window.ts:54 -/
def push (w : StreamWindow) (chunk : List Rat) : StreamWindow := chunk.foldl push1 w

/-- src/mic/window.ts:68 — `Math.floor((written - WINDOW_SAMPLES) / FRAME_HOP) * FRAME_HOP`. -/
def startOf (written : Nat) : Int := ((written : Int) - WINDOW_SAMPLES) / FRAME_HOP * FRAME_HOP

/-- src/mic/window.ts:78 / :73 — the window's frame 0 as an absolute frame. -/
def startFrameOf (written : Nat) : Int := ((written : Int) - WINDOW_SAMPLES) / FRAME_HOP

/-- src/mic/window.ts:69-72 — sample `i` of a window starting at `start`, read
    out of `ring`: silence before sample 0. -/
def readAt (ring : Nat → Rat) (start : Int) (i : Nat) : Rat :=
  if (i : Int) < max 0 (-start) then 0 else ring ((start + i).toNat % CAPACITY)

/-- src/mic/window.ts:67 — `snapshot().samples[i]`, for `i < WINDOW_SAMPLES`. -/
def snapshotSample (w : StreamWindow) (i : Nat) : Rat := readAt w.ring (startOf w.written) i

/-- src/mic/window.ts:77 -/
def settledThrough (written : Nat) (lookahead : Int) : Int :=
  startFrameOf written + WINDOW_FRAMES - 1 - lookahead

/-- The ring holds the last `CAPACITY` samples pushed, each in its slot. -/
def RingOK (w : StreamWindow) : Prop :=
  w.written = w.hist.length
  ∧ ∀ j, j < w.written → w.written ≤ j + CAPACITY → w.hist[j]? = some (w.ring (j % CAPACITY))

theorem ringOK_empty : RingOK StreamWindow.empty := by
  refine ⟨rfl, ?_⟩
  intro j hj
  simp [StreamWindow.empty] at hj

theorem ringOK_push1 (w : StreamWindow) (x : Rat) (h : RingOK w) : RingOK (push1 w x) := by
  obtain ⟨hlen, hring⟩ := h
  refine ⟨by simp [push1, hlen], ?_⟩
  intro j hj hcap
  simp only [push1] at hj hcap ⊢
  by_cases hjw : j = w.written
  · subst hjw
    simp [hlen]
  · have hlt : j < w.written := by omega
    have hne : j % CAPACITY ≠ w.written % CAPACITY := by unfold CAPACITY at *; omega
    rw [ifNeg hne, List.getElem?_append_left (by omega)]
    exact hring j hlt (by omega)

theorem ringOK_push (w : StreamWindow) (chunk : List Rat) (h : RingOK w) : RingOK (push w chunk) := by
  unfold push
  induction chunk generalizing w with
  | nil => exact h
  | cons x rest ih => exact ih _ (ringOK_push1 w x h)

theorem push_written (w : StreamWindow) (chunk : List Rat) :
    (push w chunk).written = w.written + chunk.length := by
  unfold push
  induction chunk generalizing w with
  | nil => rfl
  | cons x rest ih => simp only [List.foldl_cons, List.length_cons]; rw [ih]; simp [push1]; omega

theorem push_hist (w : StreamWindow) (chunk : List Rat) : (push w chunk).hist = w.hist ++ chunk := by
  unfold push
  induction chunk generalizing w with
  | nil => simp
  | cons x rest ih => simp only [List.foldl_cons]; rw [ih]; simp [push1]

/-- window.ts:14-15 "Windows always start on a multiple of FRAME_HOP", and
    `snapshot`'s `startFrame` (window.ts:73) is the whole number
    `settledThrough` recomputes (window.ts:78). -/
theorem snapshot_aligned (written : Nat) :
    startOf written % FRAME_HOP = 0 ∧ startOf written / FRAME_HOP = startFrameOf written := by
  unfold startOf startFrameOf FRAME_HOP
  omega

/-- window.ts:66 "The newest frame-aligned window that lies wholly inside what
    has arrived": its last sample has arrived, and one frame later would not
    fit. -/
theorem snapshot_inside_and_newest (written : Nat) :
    startOf written + WINDOW_SAMPLES ≤ written
    ∧ (written : Int) < startOf written + FRAME_HOP + WINDOW_SAMPLES := by
  unfold startOf FRAME_HOP WINDOW_SAMPLES
  omega

/-- window.ts:44 "Exactly WINDOW_SAMPLES of audio, silence-padded before
    sample 0" and window.ts:38-40 the CAPACITY comment ("never overwrites a
    sample a snapshot still needs"): every sample of a snapshot is the sample
    of the stream at that absolute position — the ring has not lost it — or
    silence where the position is before the stream began. -/
theorem snapshot_reads_the_stream (w : StreamWindow) (h : RingOK w) (i : Nat)
    (hi : (i : Int) < WINDOW_SAMPLES) :
    (startOf w.written + i < 0 → snapshotSample w i = 0)
    ∧ (0 ≤ startOf w.written + i →
        w.hist[(startOf w.written + i).toNat]? = some (snapshotSample w i)) := by
  obtain ⟨hlen, hring⟩ := h
  have hin := snapshot_inside_and_newest w.written
  unfold snapshotSample readAt
  constructor
  · intro hneg
    rw [ifPos (by omega)]
  · intro hpos
    rw [ifNeg (by omega)]
    apply hring
    · omega
    · unfold WINDOW_SAMPLES FRAME_HOP CAPACITY at *; omega

/-- window.ts:38-40 "audio that arrives while the model is busy (up to ~1 s
    of it) never overwrites a sample a snapshot still needs": after up to
    21437 more samples (0.97 s) are pushed, the ring still holds every sample
    of the window a snapshot started at. (`snapshot` copies the window out
    before the model runs, so the code does not in fact depend on this.) -/
theorem late_audio_keeps_the_window (w : StreamWindow) (h : RingOK w) (more : List Rat)
    (hmore : more.length ≤ 21437) (i : Nat) (hi : (i : Int) < WINDOW_SAMPLES) :
    readAt (push w more).ring (startOf w.written) i = snapshotSample w i := by
  have h' := ringOK_push w more h
  obtain ⟨hlen, hring⟩ := h
  obtain ⟨hlen', hring'⟩ := h'
  have hin := snapshot_inside_and_newest w.written
  have hw := push_written w more
  unfold snapshotSample readAt
  by_cases hneg : (i : Int) < max 0 (-startOf w.written)
  · rw [ifPos hneg, ifPos hneg]
  · rw [ifNeg hneg, ifNeg hneg]
    have hj : (startOf w.written + i).toNat < w.written := by
      unfold WINDOW_SAMPLES at *; omega
    have a := hring (startOf w.written + i).toNat hj
      (by unfold WINDOW_SAMPLES FRAME_HOP CAPACITY at *; omega)
    have b := hring' (startOf w.written + i).toNat (by omega)
      (by unfold WINDOW_SAMPLES FRAME_HOP CAPACITY at *; omega)
    rw [push_hist, List.getElem?_append_left (by omega), a] at b
    exact (Option.some.inj b).symm

/-- window.ts:76 "The last absolute frame a snapshot taken now could settle":
    `settledThrough` is the `through` a run on a snapshot taken now computes
    (transcriber.ts:127). -/
theorem settledThrough_is_snapshot_through (written : Nat) (lookahead : Int) :
    settledThrough written lookahead
      = startOf written / FRAME_HOP + WINDOW_FRAMES - 1 - lookahead := by
  unfold settledThrough
  rw [(snapshot_aligned written).2]

/-! ## Transcriber: which frames are committed — src/mic/transcriber.ts:103-138 -/

/-- `for (let abs = a; abs <= b; abs++)`: the values of `abs`, in order. -/
def interval (a b : Int) : List Int := (List.range (b + 1 - a).toNat).map (fun (k : Nat) => a + (k : Int))

theorem mem_interval (a b x : Int) : x ∈ interval a b ↔ a ≤ x ∧ x ≤ b := by
  simp only [interval, List.mem_map, List.mem_range]
  constructor
  · rintro ⟨k, hk, rfl⟩; omega
  · intro h; exact ⟨(x - a).toNat, by omega, by omega⟩

theorem interval_increasing (a b : Int) : (interval a b).Pairwise (fun x y => x < y) := by
  unfold interval
  rw [List.pairwise_map]
  exact List.Pairwise.imp (by intro x y h; omega) List.pairwise_lt_range

/-- One model run, as far as committing goes. -/
structure Run where
  /-- `window.written` when the run's snapshot is taken (transcriber.ts:120) -/
  written : Nat
  /-- `opts.lookahead` when the run commits (transcriber.ts:127) -/
  lookahead : Int

/-- src/mic/transcriber.ts:119-138 — `step`: the new `committed`, and the
    absolute frames handed to the gate and the tracker, in order. -/
def step (committed : Int) (r : Run) : Int × List Int :=
  let startFrame := startFrameOf r.written
  let through := startFrame + WINDOW_FRAMES - 1 - r.lookahead
  (max committed through, interval (max (max (committed + 1) startFrame) 0) through)

/-- Run after run, from `committed`: the final `committed` and every frame
    handed to the tracker, in the order handed. -/
def runs (committed : Int) : List Run → Int × List Int
  | [] => (committed, [])
  | r :: rest => ((runs (step committed r).1 rest).1, (step committed r).2 ++ (runs (step committed r).1 rest).2)

/-- src/mic/transcriber.ts:103 — `ready()`. -/
def ready (written : Nat) (lookahead minHopFrames committed : Int) : Bool :=
  decide (settledThrough written lookahead - committed ≥ minHopFrames)

/-- transcriber.ts:133 — the window row a committed frame is read from
    (`f = abs - startFrame`) is one of the window's `WINDOW_FRAMES` rows,
    whenever the lookahead is not negative. -/
theorem committed_frame_is_a_window_row (committed : Int) (r : Run) (h : 0 ≤ r.lookahead) :
    ∀ abs ∈ (step committed r).2,
      0 ≤ abs - startFrameOf r.written ∧ abs - startFrameOf r.written < WINDOW_FRAMES := by
  intro abs habs
  simp only [step, mem_interval] at habs
  unfold WINDOW_FRAMES at *
  omega

/-- window.ts:16 "each absolute frame is committed exactly once" — the half
    that HOLDS, for any runs at all (slow, fast, lookahead changed between
    them): no frame is handed to the tracker twice or out of order. The frames
    come strictly increasing, each after everything committed before, none
    before frame 0. -/
theorem no_frame_committed_twice (committed : Int) (rs : List Run) :
    committed ≤ (runs committed rs).1
    ∧ (∀ f ∈ (runs committed rs).2, committed < f ∧ 0 ≤ f ∧ f ≤ (runs committed rs).1)
    ∧ (runs committed rs).2.Pairwise (fun x y => x < y) := by
  induction rs generalizing committed with
  | nil => simp [runs]
  | cons r rest ih =>
    obtain ⟨h1, h2, h3⟩ := ih (step committed r).1
    have hstep : committed ≤ (step committed r).1 := by simp only [step]; omega
    have hmem : ∀ f ∈ (step committed r).2,
        committed < f ∧ 0 ≤ f ∧ f ≤ (step committed r).1 := by
      intro f hf
      simp only [step, mem_interval] at hf ⊢
      omega
    simp only [runs]
    refine ⟨by omega, ?_, ?_⟩
    · intro f hf
      rw [List.mem_append] at hf
      rcases hf with hf | hf
      · have := hmem f hf; omega
      · have := h2 f hf; omega
    · rw [List.pairwise_append]
      refine ⟨by simp only [step]; exact interval_increasing _ _, h3, ?_⟩
      intro a ha b hb
      have := hmem a ha
      have := h2 b hb
      omega

/-- No run leaves a gap: its window starts no later than the frame after the
    last one committed. -/
def NoGaps (committed : Int) : List Run → Prop
  | [] => True
  | r :: rest => startFrameOf r.written ≤ committed + 1 ∧ NoGaps (step committed r).1 rest

/-- window.ts:16 "each absolute frame is committed exactly once" and
    transcriber.ts:16-17 "each run settles everything that has arrived" —
    the other half HOLDS ONLY UNDER A HYPOTHESIS the code does not enforce:
    no run's window starts past the frame after the last one committed
    (`NoGaps`). Then every frame up to the final `committed` was handed to the
    tracker (and, by `no_frame_committed_twice`, once). -/
theorem every_frame_committed_if_no_gaps (committed : Int) (rs : List Run)
    (h0 : -1 ≤ committed) (hg : NoGaps committed rs) :
    ∀ f, committed < f → f ≤ (runs committed rs).1 → f ∈ (runs committed rs).2 := by
  induction rs generalizing committed with
  | nil => intro f h1 h2; simp only [runs] at h2; omega
  | cons r rest ih =>
    obtain ⟨hgap, hrest⟩ := hg
    intro f h1 h2
    simp only [runs] at h2 ⊢
    rw [List.mem_append]
    by_cases hf : f ≤ (step committed r).1
    · left
      simp only [step, mem_interval] at hf ⊢
      omega
    · right
      exact ih (step committed r).1 (by simp only [step]; omega) hrest f (by omega) h2

/-- When the hypothesis holds: with the lookahead unchanged, a run leaves no
    gap after the one before it if at most `WINDOW_FRAMES - lookahead` frames
    of audio (164 frames, 1.90 s, at the default lookahead of 8) arrived
    between the two snapshots. -/
theorem no_gap_if_runs_are_close (w w' : Nat) (lookahead committed : Int)
    (hc : startFrameOf w + WINDOW_FRAMES - 1 - lookahead ≤ committed)
    (hw : (w' : Int) ≤ w + (WINDOW_FRAMES - lookahead) * FRAME_HOP) :
    startFrameOf w' ≤ committed + 1 := by
  unfold startFrameOf WINDOW_FRAMES FRAME_HOP WINDOW_SAMPLES at *
  omega

/-- FAILS without it. window.ts:16 "each absolute frame is committed exactly
    once"; transcriber.ts:16-17 "neither ever builds a backlog: each run
    settles everything that has arrived". Two runs at the default lookahead,
    the second snapshot taken 200 frames (2.3 s) of audio after the first: the
    first commits frames 0..163, the second 200..363, and frames 164..199 are
    never handed to the tracker — by `no_frame_committed_twice` no later run
    can go back for them. (transcriber.ts:131 says as much: "a machine too
    slow to keep up skips frames rather than queueing them".)
    Repro: proofs/repro/mic_skipped_frames.ts. -/
theorem FAILS_each_frame_committed_exactly_once :
    let rs : List Run := [⟨43844, 8⟩, ⟨43844 + 200 * 256, 8⟩]
    (runs (-1) rs).1 = 363
    ∧ (∀ f, 164 ≤ f → f ≤ 199 → f ∉ (runs (-1) rs).2)
    ∧ (∀ f, 0 ≤ f → f ≤ 163 → f ∈ (runs (-1) rs).2) := by
  have s1 : startFrameOf 43844 = 0 := by decide
  have s2 : startFrameOf (43844 + 200 * 256) = 200 := by decide
  simp only [runs, step, s1, s2, List.mem_append, mem_interval, WINDOW_FRAMES, List.append_nil]
  refine ⟨by omega, ?_, ?_⟩
  · intro f h1 h2; omega
  · intro f h1 h2; omega

/-- transcriber.ts:16-17, the part that holds: a run whose lookahead is the
    one `ready()` saw commits through everything `settledThrough` promised
    for the audio its snapshot saw. -/
theorem run_settles_its_snapshot (committed : Int) (r : Run) :
    settledThrough r.written r.lookahead ≤ (step committed r).1 := by
  simp only [step, settledThrough]; omega

/-! ## NoiseGate — src/mic/gate.ts -/

/-- src/mic/gate.ts:18 -/
structure GateOptions where
  marginDb : Rat
  hysteresisDb : Rat
  riseDbPerSecond : Rat
  holdFrames : Int

/-- src/mic/gate.ts:29 -/
def DEFAULT_GATE : GateOptions :=
  { marginDb := 6, hysteresisDb := 3, riseDbPerSecond := 1 / 2, holdFrames := 8 }

/-- src/mic/window.ts:36 — `FRAME_HOP / SAMPLE_RATE`. -/
def FRAME_SECONDS : Rat := 256 / 22050

/-- src/mic/gate.ts:38 -/
def FLOOR_MIN_DB : Rat := -100

/-- src/mic/gate.ts:41-43 -/
structure Gate where
  floor : Option Rat
  open_ : Bool
  hold : Int

/-- `new NoiseGate(opts)` / `reset()` (gate.ts:70). -/
def Gate.fresh : Gate := { floor := none, open_ := false, hold := 0 }

/-- src/mic/gate.ts:49 — `Math.max(FLOOR_MIN_DB, levelDb)`; `none` is `-Infinity`. -/
def clampLevel : Option Rat → Rat
  | none => FLOOR_MIN_DB
  | some x => max FLOOR_MIN_DB x

/-- src/mic/gate.ts:51-52 -/
def newFloor (o : GateOptions) (floor : Option Rat) (level : Rat) : Rat :=
  match floor with
  | none => level
  | some f => if level < f then level else min level (f + o.riseDbPerSecond * FRAME_SECONDS)

/-- src/mic/gate.ts:48-63 — `frame`: the new state and the verdict. -/
def Gate.frame (o : GateOptions) (g : Gate) (levelDb : Option Rat) : Gate × Bool :=
  let level := clampLevel levelDb
  let floor := newFloor o g.floor level
  let opensAt := floor + o.marginDb
  if level ≥ opensAt then
    ({ floor := some floor, open_ := true, hold := o.holdFrames }, true)
  else if g.open_ = true ∧ level < opensAt - o.hysteresisDb then
    if g.hold > 0 then ({ floor := some floor, open_ := g.open_, hold := g.hold - 1 }, g.open_)
    else ({ floor := some floor, open_ := false, hold := g.hold }, false)
  else ({ floor := some floor, open_ := g.open_, hold := g.hold }, g.open_)

/-- src/mic/gate.ts:66 -/
def Gate.floorDb (g : Gate) : Rat := g.floor.getD FLOOR_MIN_DB

theorem frame_floor (o : GateOptions) (g : Gate) (x : Option Rat) :
    (g.frame o x).1.floor = some (newFloor o g.floor (clampLevel x)) := by
  unfold Gate.frame
  simp only
  split
  · rfl
  · split
    · split <;> rfl
    · rfl

/-- The verdict returned is the state's `open` (gate.ts:62). -/
theorem frame_returns_open (o : GateOptions) (g : Gate) (x : Option Rat) :
    (g.frame o x).2 = (g.frame o x).1.open_ := by
  unfold Gate.frame
  simp only
  split
  · rfl
  · split
    · split <;> rfl
    · rfl

theorem clampLevel_ge (x : Option Rat) : FLOOR_MIN_DB ≤ clampLevel x := by
  unfold clampLevel
  cases x with
  | none => exact Rat.le_refl
  | some v => simp only; grind

/-- gate.ts:10 "The gate follows the NOISE FLOOR": after every frame the floor
    is at or below that frame's level. -/
theorem floor_le_level (o : GateOptions) (floor : Option Rat) (level : Rat) :
    newFloor o floor level ≤ level := by
  unfold newFloor
  cases floor with
  | none => exact Rat.le_refl
  | some f => simp only; split <;> grind

/-- gate.ts:10-11 "it drops to any quieter frame at once". -/
theorem floor_drops_at_once (o : GateOptions) (f level : Rat) (h : level < f) :
    newFloor o (some f) level = level := by
  simp [newFloor, h]

/-- gate.ts:11 "and creeps up slowly, so held chords cannot drag it up to meet
    them": one frame raises the floor by at most `riseDbPerSecond` times a
    frame's seconds, however loud the frame — HOLDS ONLY UNDER the hypothesis
    `riseDbPerSecond >= 0` (true of `DEFAULT_GATE`, the only options used). -/
theorem floor_creeps (o : GateOptions) (f level : Rat) (hr : 0 ≤ o.riseDbPerSecond) :
    newFloor o (some f) level ≤ f + o.riseDbPerSecond * FRAME_SECONDS := by
  have : 0 ≤ o.riseDbPerSecond * FRAME_SECONDS := by unfold FRAME_SECONDS; grind
  unfold newFloor
  simp only
  split <;> grind

/-- gate.ts:36-38 "clamp so the floor stays a number": the floor is never
    below `FLOOR_MIN_DB` — HOLDS ONLY UNDER the same hypothesis,
    `riseDbPerSecond >= 0`. -/
theorem floor_ge_min (o : GateOptions) (floor : Option Rat) (x : Option Rat)
    (hr : 0 ≤ o.riseDbPerSecond) (hf : ∀ f, floor = some f → FLOOR_MIN_DB ≤ f) :
    FLOOR_MIN_DB ≤ newFloor o floor (clampLevel x) := by
  have hl := clampLevel_ge x
  have : 0 ≤ o.riseDbPerSecond * FRAME_SECONDS := by unfold FRAME_SECONDS; grind
  unfold newFloor
  cases floor with
  | none => exact hl
  | some f =>
    have := hf f rfl
    simp only
    split <;> grind

/-- FAILS without it: with a negative `riseDbPerSecond` the floor sinks below
    `FLOOR_MIN_DB` on a second frame of digital silence. `GateOptions` is any
    four numbers (gate.ts:18-27). Repro: proofs/repro/mic_gate_floor.ts. -/
theorem FAILS_floor_ge_min_with_negative_rise :
    let o : GateOptions := { DEFAULT_GATE with riseDbPerSecond := -10 }
    newFloor o (some (newFloor o none (clampLevel none))) (clampLevel none) < FLOOR_MIN_DB := by
  decide +kernel

/-- gate.ts:12-13 "A frame is open when it stands `marginDb` above the floor". -/
theorem opens_above_margin (o : GateOptions) (g : Gate) (x : Option Rat)
    (h : clampLevel x ≥ newFloor o g.floor (clampLevel x) + o.marginDb) :
    g.frame o x = ({ floor := some (newFloor o g.floor (clampLevel x)), open_ := true,
                     hold := o.holdFrames }, true) := by
  unfold Gate.frame
  simp only
  rw [ifPos h]

/-- A shut gate opens ONLY for such a frame. -/
theorem shut_stays_shut_below_margin (o : GateOptions) (g : Gate) (x : Option Rat)
    (hs : g.open_ = false)
    (h : ¬ clampLevel x ≥ newFloor o g.floor (clampLevel x) + o.marginDb) :
    (g.frame o x).2 = false := by
  unfold Gate.frame
  simp only
  rw [ifNeg h]
  simp [hs]

/-- Feed the same level `n` times. -/
def feedSame (o : GateOptions) (g : Gate) (x : Option Rat) : Nat → Gate
  | 0 => g
  | n + 1 => feedSame o (g.frame o x).1 x n

/-- mic.test.ts:64 "stays shut on a steady noise floor, whatever its level" /
    gate.ts:4-5 "so silence stays silent": a steady level never opens a fresh
    gate, however long it lasts — given `marginDb > 0` and
    `riseDbPerSecond >= 0`. -/
theorem steady_noise_stays_shut (o : GateOptions) (x : Option Rat)
    (hm : 0 < o.marginDb) (hr : 0 ≤ o.riseDbPerSecond) (n : Nat) :
    (feedSame o Gate.fresh x n).open_ = false
    ∧ ((feedSame o Gate.fresh x n).frame o x).2 = false := by
  have hrise : 0 ≤ o.riseDbPerSecond * FRAME_SECONDS := by unfold FRAME_SECONDS; grind
  have key : ∀ (n : Nat) (g : Gate), g.open_ = false →
      (g.floor = none ∨ g.floor = some (clampLevel x)) →
      (feedSame o g x n).open_ = false
      ∧ ((feedSame o g x n).floor = none ∨ (feedSame o g x n).floor = some (clampLevel x)) := by
    intro n
    induction n with
    | zero => intro g h1 h2; exact ⟨h1, h2⟩
    | succ n ih =>
      intro g h1 h2
      have hfl : newFloor o g.floor (clampLevel x) = clampLevel x := by
        rcases h2 with h2 | h2 <;> rw [h2] <;> simp only [newFloor]
        split <;> grind
      have hno : ¬ clampLevel x ≥ newFloor o g.floor (clampLevel x) + o.marginDb := by
        rw [hfl]; grind
      apply ih
      · rw [← frame_returns_open]; exact shut_stays_shut_below_margin o g x h1 hno
      · right; rw [frame_floor, hfl]
  obtain ⟨h1, h2⟩ := key n Gate.fresh rfl (Or.inl rfl)
  refine ⟨h1, ?_⟩
  apply shut_stays_shut_below_margin o _ x h1
  have hfl : newFloor o (feedSame o Gate.fresh x n).floor (clampLevel x) = clampLevel x := by
    rcases h2 with h2 | h2 <;> rw [h2] <;> simp only [newFloor]
    split <;> grind
  rw [hfl]; grind

/-- gate.ts:13-14 "Hysteresis ... keep[s] a decaying note from chattering the
    gate at its threshold": an open gate stays open, its hold untouched, for a
    frame that has not fallen `hysteresisDb` below the opening level. -/
theorem hysteresis_keeps_open (o : GateOptions) (g : Gate) (x : Option Rat)
    (ho : g.open_ = true)
    (h : ¬ clampLevel x < newFloor o g.floor (clampLevel x) + o.marginDb - o.hysteresisDb) :
    (g.frame o x).2 = true := by
  unfold Gate.frame
  simp only
  split
  · rfl
  · rw [ifNeg (by intro hc; exact h hc.2)]
    exact ho

/-- gate.ts:25 "Frames the gate stays open after the level falls below the
    close level": an open gate with `k` frames of hold left is still open after
    one more frame, whatever its level, with at least `k - 1` left. -/
theorem hold_one_frame (o : GateOptions) (g : Gate) (x : Option Rat) (k : Int)
    (ho : g.open_ = true) (hk : 1 ≤ k) (hh : k ≤ g.hold) (hmax : k ≤ o.holdFrames) :
    (g.frame o x).1.open_ = true ∧ k - 1 ≤ (g.frame o x).1.hold := by
  unfold Gate.frame
  simp only
  split
  · exact ⟨rfl, by simp only; omega⟩
  · split
    · rw [ifPos (by omega)]
      exact ⟨ho, by simp only; omega⟩
    · exact ⟨ho, by simp only; omega⟩

/-- Feed a list of levels; the verdicts. -/
def feed (o : GateOptions) (g : Gate) : List (Option Rat) → Gate × List Bool
  | [] => (g, [])
  | x :: rest => ((feed o (g.frame o x).1 rest).1, (g.frame o x).2 :: (feed o (g.frame o x).1 rest).2)

/-- gate.ts:13-14, 25 / mic.test.ts:71 "opens for playing above the floor, and
    holds through a short dip": after a frame that opens the gate, the next
    `holdFrames` frames are open whatever their level. -/
theorem holds_for_holdFrames (o : GateOptions) (g : Gate) (xs : List (Option Rat))
    (ho : g.open_ = true) (hh : (xs.length : Int) ≤ g.hold) (hmax : (xs.length : Int) ≤ o.holdFrames) :
    ∀ v ∈ (feed o g xs).2, v = true := by
  induction xs generalizing g with
  | nil => simp [feed]
  | cons x rest ih =>
    simp only [List.length_cons] at hh hmax
    have h1 := hold_one_frame o g x (rest.length + 1) ho (by omega) (by omega) (by omega)
    intro v hv
    simp only [feed, List.mem_cons] at hv
    rcases hv with hv | hv
    · rw [hv, frame_returns_open]; exact h1.1
    · exact ih (g.frame o x).1 h1.1 (by omega) (by omega) v hv

/-- ... and it closes once the hold is used up: an open gate with no hold
    left shuts on a frame below the close level. -/
theorem closes_when_hold_spent (o : GateOptions) (g : Gate) (x : Option Rat)
    (hh : g.hold ≤ 0)
    (h : clampLevel x < newFloor o g.floor (clampLevel x) + o.marginDb - o.hysteresisDb)
    (hy : 0 ≤ o.hysteresisDb) :
    (g.frame o x).2 = false := by
  unfold Gate.frame
  simp only
  rw [ifNeg (by grind)]
  by_cases ho : g.open_ = true
  · rw [ifPos ⟨ho, h⟩, ifNeg (by omega)]
  · rw [ifNeg (by intro hc; exact ho hc.1)]
    simpa using ho

/-- mic.test.ts:80 "drops to a quieter floor at once but rises slowly under a
    held chord" and mic.test.ts:71 "opens for playing above the floor, and
    holds through a short dip", run through the model. -/
theorem gate_tests :
    let o := DEFAULT_GATE
    let g2 := ((Gate.fresh.frame o (some (-40))).1.frame o (some (-70))).1
    let g3 := feedSame o g2 (some (-30)) 86
    let h1 := feedSame o Gate.fresh (some (-60)) 50
    let h2 := (h1.frame o (some (-53)))
    let h3 := (h2.1.frame o (some (-60)))
    let h4 := feedSame o h3.1 (some (-60)) 8
    g2.floorDb = -70 ∧ g3.floorDb < -69 ∧ (g3.frame o (some (-30))).2 = true
    ∧ h2.2 = true ∧ h3.2 = true ∧ (h4.frame o (some (-60))).2 = false
    ∧ (Gate.fresh.frame o none).1.floorDb = -100 := by
  decide +kernel

/-! ## NoteTracker — src/mic/note-tracker.ts -/

/-- src/mic/note-tracker.ts:29 -/
structure TrackerOptions where
  onsetThreshold : Rat
  confirmThreshold : Rat
  confirmFrames : Nat
  frameThreshold : Rat
  minHoldFrames : Nat
  releaseFrames : Nat
  deriving DecidableEq, Repr

/-- src/mic/note-tracker.ts:42 -/
def DEFAULT_TRACKER : TrackerOptions :=
  { onsetThreshold := 1 / 2, confirmThreshold := 1 / 2, confirmFrames := 3,
    frameThreshold := 3 / 10, minHoldFrames := 4, releaseFrames := 4 }

/-- A store into a `Uint8Array` cell. -/
def u8 (x : Nat) : Nat := x % 256
/-- A store into a `Uint16Array` cell. -/
def u16 (x : Nat) : Nat := x % 65536

/-- src/mic/note-tracker.ts:51 — an event's kind (its pitch is the key's). -/
inductive Kind where
  | on | off
  deriving DecidableEq, Repr

/-- One key's cells of the five typed arrays (note-tracker.ts:57-61). -/
structure Key where
  down : Bool
  age : Nat
  quiet : Nat
  lastOnset : Rat
  pending : Nat
  deriving DecidableEq, Repr

/-- A new tracker's key: typed arrays start zeroed. -/
def Key.fresh : Key := { down := false, age := 0, quiet := 0, lastOnset := 0, pending := 0 }

/-- src/mic/note-tracker.ts:116-121 — `start`. -/
def start (k : Key) : Key := { k with down := true, age := 0, quiet := 0 }

/-- src/mic/note-tracker.ts:75 — `pending[i]` after an onset that rises
    through the threshold re-arms it. -/
def armed (o : TrackerOptions) (k : Key) (onset : Rat) : Nat :=
  if onset ≥ o.onsetThreshold ∧ k.lastOnset < o.onsetThreshold then u8 o.confirmFrames
  else k.pending

/-- src/mic/note-tracker.ts:78 — `struck`. -/
def struckB (o : TrackerOptions) (pending1 : Nat) (frame : Rat) : Bool :=
  decide (pending1 > 0 ∧ frame ≥ o.confirmThreshold)

/-- src/mic/note-tracker.ts:79-80 -/
def pendingAfter (struck : Bool) (pending1 : Nat) : Nat :=
  if struck then 0 else if pending1 > 0 then pending1 - 1 else pending1

/-- src/mic/note-tracker.ts:87 — `if (this.age[i] < 0xffff) this.age[i]++`. -/
def ageUp (age : Nat) : Nat := if age < 65535 then age + 1 else age

/-- src/mic/note-tracker.ts:88 — `held`, from the cell before line 87. -/
def heldB (o : TrackerOptions) (age : Nat) : Bool := decide (ageUp age ≥ o.minHoldFrames)

/-- src/mic/note-tracker.ts:94-95 — `quiet[i]` after this frame. -/
def quietUp (o : TrackerOptions) (quiet : Nat) (frame : Rat) : Nat :=
  if frame ≥ o.frameThreshold then 0 else u16 (quiet + 1)

/-- src/mic/note-tracker.ts:83-99 — the second half of the loop body: the
    key's edges, given this frame's `struck` and (gated) frame activation. -/
def keyEdge (o : TrackerOptions) (k1 : Key) (struck : Bool) (frame : Rat) : Key × List Kind :=
  if k1.down = false then
    if struck = true then (start k1, [.on]) else (k1, [])
  else if struck = true ∧ heldB o k1.age = true then
    (start { k1 with age := ageUp k1.age }, [.off, .on])
  else if heldB o k1.age = true ∧ quietUp o k1.quiet frame ≥ o.releaseFrames then
    ({ k1 with age := ageUp k1.age, quiet := quietUp o k1.quiet frame, down := false }, [.off])
  else ({ k1 with age := ageUp k1.age, quiet := quietUp o k1.quiet frame }, [])

/-- src/mic/note-tracker.ts:74, 77 — `open ? x : 0`. -/
def gated (open_ : Bool) (v : Rat) : Rat := if open_ then v else 0

/-- src/mic/note-tracker.ts:74-78 — this frame's `struck` for a key. -/
def struckOf (o : TrackerOptions) (k : Key) (onsetIn frameIn : Rat) (open_ : Bool) : Bool :=
  struckB o (armed o k (gated open_ onsetIn)) (gated open_ frameIn)

/-- src/mic/note-tracker.ts:74-80 — the first half of the loop body: the key
    with `lastOnset` and `pending` brought up to this frame. -/
def base (o : TrackerOptions) (k : Key) (onsetIn frameIn : Rat) (open_ : Bool) : Key :=
  { k with lastOnset := gated open_ onsetIn,
           pending := pendingAfter (struckOf o k onsetIn frameIn open_) (armed o k (gated open_ onsetIn)) }

/-- src/mic/note-tracker.ts:73-99 — the loop body for one key: its new cells
    and the events pushed for it, in order. -/
def keyStep (o : TrackerOptions) (k : Key) (onsetIn frameIn : Rat) (open_ : Bool) : Key × List Kind :=
  keyEdge o (base o k onsetIn frameIn open_) (struckOf o k onsetIn frameIn open_) (gated open_ frameIn)

/-- One key through a run of frames `(onset, frame, open)`: its final cells
    and every event for it, in order. -/
def keyRun (o : TrackerOptions) (k : Key) : List (Rat × Rat × Bool) → Key × List Kind
  | [] => (k, [])
  | x :: rest =>
    ((keyRun o (keyStep o k x.1 x.2.1 x.2.2).1 rest).1,
     (keyStep o k x.1 x.2.1 x.2.2).2 ++ (keyRun o (keyStep o k x.1 x.2.1 x.2.2).1 rest).2)

/-- src/mic/note-tracker.ts:105-114 — `releaseAll`, for one key. -/
def keyRelease (k : Key) : Key × List Kind :=
  ({ k with down := false, lastOnset := 0, pending := 0 }, if k.down then [.off] else [])

/-- src/mic/note-tracker.ts:105-114 — `releaseAll`: the keys, lowest first;
    events carry the pitch `LOWEST_PITCH + i`. -/
def releaseAll (keys : List Key) : List Key × List (Kind × Int) :=
  (keys.map (fun k => (keyRelease k).1),
   (keys.zipIdx.filter (fun p => p.1.down)).map (fun p => (Kind.off, LOWEST_PITCH + (p.2 : Int))))

/-! ### The five things a frame can do to a key -/

theorem edge_up_idle (o : TrackerOptions) (k1 : Key) (frame : Rat) (hd : k1.down = false) :
    keyEdge o k1 false frame = (k1, []) := by
  simp [keyEdge, hd]

theorem edge_up_struck (o : TrackerOptions) (k1 : Key) (frame : Rat) (hd : k1.down = false) :
    keyEdge o k1 true frame = (start k1, [.on]) := by
  simp [keyEdge, hd]

theorem edge_restrike (o : TrackerOptions) (k1 : Key) (frame : Rat) (hd : k1.down = true)
    (hh : heldB o k1.age = true) :
    keyEdge o k1 true frame = (start { k1 with age := ageUp k1.age }, [.off, .on]) := by
  simp [keyEdge, hd, hh]

theorem edge_release (o : TrackerOptions) (k1 : Key) (struck : Bool) (frame : Rat)
    (hd : k1.down = true) (hs : ¬ (struck = true ∧ heldB o k1.age = true))
    (hr : heldB o k1.age = true ∧ quietUp o k1.quiet frame ≥ o.releaseFrames) :
    keyEdge o k1 struck frame
      = ({ k1 with age := ageUp k1.age, quiet := quietUp o k1.quiet frame, down := false }, [.off]) := by
  unfold keyEdge
  rw [ifNeg (by simp [hd]), ifNeg hs, ifPos hr]

theorem edge_stay (o : TrackerOptions) (k1 : Key) (struck : Bool) (frame : Rat)
    (hd : k1.down = true) (hs : ¬ (struck = true ∧ heldB o k1.age = true))
    (hr : ¬ (heldB o k1.age = true ∧ quietUp o k1.quiet frame ≥ o.releaseFrames)) :
    keyEdge o k1 struck frame
      = ({ k1 with age := ageUp k1.age, quiet := quietUp o k1.quiet frame }, []) := by
  unfold keyEdge
  rw [ifNeg (by simp [hd]), ifNeg hs, ifNeg hr]

/-! ### Events alternate -/

/-- The one legal reading of a key's events from a state: `on` only while up,
    `off` only while down. `some d`: legal, ending down (`d`) or up. -/
def alt : Bool → List Kind → Option Bool
  | d, [] => some d
  | false, .on :: rest => alt true rest
  | true, .off :: rest => alt false rest
  | _, _ => none

theorem alt_append (d d' : Bool) (xs ys : List Kind) (h : alt d xs = some d') :
    alt d (xs ++ ys) = alt d' ys := by
  induction xs generalizing d with
  | nil => simp [alt] at h; subst h; rfl
  | cons x rest ih =>
    cases d <;> cases x <;> simp [alt] at h ⊢ <;> exact ih _ h

theorem keyEdge_alt (o : TrackerOptions) (k1 : Key) (struck : Bool) (frame : Rat) (d : Bool)
    (hd : k1.down = d) :
    alt d (keyEdge o k1 struck frame).2 = some (keyEdge o k1 struck frame).1.down := by
  subst hd
  cases hd : k1.down
  · cases struck
    · rw [edge_up_idle o k1 frame hd]; simp [alt, hd]
    · rw [edge_up_struck o k1 frame hd]; simp [alt, start]
  · by_cases hs : struck = true ∧ heldB o k1.age = true
    · rw [hs.1, edge_restrike o k1 frame hd hs.2]; simp [alt, start]
    · by_cases hr : heldB o k1.age = true ∧ quietUp o k1.quiet frame ≥ o.releaseFrames
      · rw [edge_release o k1 struck frame hd hs hr]; simp [alt]
      · rw [edge_stay o k1 struck frame hd hs hr]; simp [alt, hd]

/-- One frame's events for a key are legal from its `down`, and leave `down`
    as the events say: nothing, `on`, `off`, or `off` then `on`. -/
theorem keyStep_alt (o : TrackerOptions) (k : Key) (x y : Rat) (g : Bool) :
    alt k.down (keyStep o k x y g).2 = some (keyStep o k x y g).1.down :=
  keyEdge_alt o (base o k x y g) _ _ k.down rfl

/-- note-tracker.ts:1-2, 51-54: for each key the events strictly alternate —
    whatever the activations, the gate and the options — and the key's `down`
    cell agrees with them. From a fresh tracker the first is an `on`. -/
theorem events_alternate (o : TrackerOptions) (k : Key) (xs : List (Rat × Rat × Bool)) :
    alt k.down (keyRun o k xs).2 = some (keyRun o k xs).1.down := by
  induction xs generalizing k with
  | nil => simp [keyRun, alt]
  | cons x rest ih =>
    simp only [keyRun]
    rw [alt_append _ _ _ _ (keyStep_alt o k x.1 x.2.1 x.2.2)]
    exact ih _

/-! ### "A closed noise gate is treated as silence" (note-tracker.ts:23) -/

/-- note-tracker.ts:23 "A closed noise gate is treated as silence for every
    key": a frame through a closed gate is, for the tracker, a frame of zero
    activations through an open one. -/
theorem closed_gate_is_silence (o : TrackerOptions) (k : Key) (x y : Rat) :
    keyStep o k x y false = keyStep o k 0 0 true := by
  simp [keyStep, base, struckOf, gated]

theorem keyEdge_no_strike (o : TrackerOptions) (k1 : Key) (frame : Rat) :
    Kind.on ∉ (keyEdge o k1 false frame).2 := by
  cases hd : k1.down
  · rw [edge_up_idle o k1 frame hd]; simp
  · have hs : ¬ (false = true ∧ heldB o k1.age = true) := by simp
    by_cases hr : heldB o k1.age = true ∧ quietUp o k1.quiet frame ≥ o.releaseFrames
    · rw [edge_release o k1 false frame hd hs hr]; simp
    · rw [edge_stay o k1 false frame hd hs hr]; simp

/-- mic.test.ts:139 "hears nothing through a closed gate": no key goes down
    while the gate is closed — given a confirm threshold above zero. -/
theorem no_on_through_closed_gate (o : TrackerOptions) (k : Key) (x y : Rat)
    (hc : 0 < o.confirmThreshold) : Kind.on ∉ (keyStep o k x y false).2 := by
  have hs : struckOf o k x y false = false := by
    have : ¬ ((0 : Rat) ≥ o.confirmThreshold) := by grind
    simp [struckOf, struckB, gated, this]
  unfold keyStep
  rw [hs]
  exact keyEdge_no_strike o _ _

/-! ### "never before it has been down for `minHoldFrames`" (note-tracker.ts:17-19) -/

theorem ageUp_le (age : Nat) : ageUp age ≤ age + 1 ∧ ageUp age ≤ max age 65535 := by
  unfold ageUp; split <;> omega

theorem keyEdge_before_min_hold (o : TrackerOptions) (k1 : Key) (struck : Bool) (frame : Rat)
    (hd : k1.down = true) (ha : k1.age + 1 < o.minHoldFrames) :
    (keyEdge o k1 struck frame).2 = [] ∧ (keyEdge o k1 struck frame).1.down = true
    ∧ (keyEdge o k1 struck frame).1.age ≤ k1.age + 1 := by
  have hheld : heldB o k1.age = false := by
    have := (ageUp_le k1.age).1
    simp only [heldB, decide_eq_false_iff_not]; omega
  rw [edge_stay o k1 struck frame hd (by simp [hheld]) (by simp [hheld])]
  exact ⟨rfl, hd, (ageUp_le k1.age).1⟩

/-- While a key has been down for fewer than `minHoldFrames` frames, a frame
    produces no event for it and leaves it down. -/
theorem no_event_before_min_hold (o : TrackerOptions) (k : Key) (x y : Rat) (g : Bool)
    (hd : k.down = true) (ha : k.age + 1 < o.minHoldFrames) :
    (keyStep o k x y g).2 = [] ∧ (keyStep o k x y g).1.down = true
    ∧ (keyStep o k x y g).1.age ≤ k.age + 1 :=
  keyEdge_before_min_hold o (base o k x y g) _ _ hd ha

/-- note-tracker.ts:17-19 "It comes up ... never before it has been down for
    `minHoldFrames`": after a key goes down (`age = 0`), the next
    `minHoldFrames - 1` frames produce no event for it at all — no `off`, and
    no off-then-on either. The first frame that can lift it is the
    `minHoldFrames`-th. (Typed-array saturation only makes it later.) -/
theorem never_up_before_min_hold (o : TrackerOptions) (k : Key) (xs : List (Rat × Rat × Bool))
    (hd : k.down = true) (ha : k.age + xs.length < o.minHoldFrames) :
    (keyRun o k xs).2 = [] ∧ (keyRun o k xs).1.down = true := by
  induction xs generalizing k with
  | nil => simp [keyRun, hd]
  | cons x rest ih =>
    simp only [List.length_cons] at ha
    obtain ⟨h1, h2, h3⟩ := no_event_before_min_hold o k x.1 x.2.1 x.2.2 hd (by omega)
    obtain ⟨h4, h5⟩ := ih (keyStep o k x.1 x.2.1 x.2.2).1 h2 (by omega)
    simp only [keyRun, h1, h4, List.append_nil]
    exact ⟨trivial, h5⟩

/-- note-tracker.ts:20-22 "A fresh onset on a key that is already down is a
    RE-STRIKE: it is reported as off-then-on" / mic.test.ts:124 — HOLDS ONLY
    UNDER A HYPOTHESIS: the key has been down for `minHoldFrames`
    (note-tracker.ts:88-89, `struck && held`). `hs` says this frame confirms a
    strike (note-tracker.ts:75-78). -/
theorem restrike_is_off_then_on (o : TrackerOptions) (k : Key) (x y : Rat)
    (hd : k.down = true) (hs : struckOf o k x y true = true)
    (hheld : heldB o k.age = true) :
    (keyStep o k x y true).2 = [.off, .on] := by
  unfold keyStep
  rw [hs, edge_restrike o (base o k x y true) _ hd hheld]

/-- FAILS without it. note-tracker.ts:20-22: a fresh, confirmed onset on a key
    that went down two frames ago produces NO event, and is not kept for
    later (`pending` is back to 0): the re-strike is lost. Default options.
    Repro: proofs/repro/mic_restrike_lost.ts. -/
theorem FAILS_restrike_reported_within_min_hold :
    let o := DEFAULT_TRACKER
    let k1 := (keyStep o Key.fresh (9 / 10) (8 / 10) true)     -- struck: on
    let k2 := (keyStep o k1.1 0 (8 / 10) true)                 -- onset falls back
    let k3 := (keyStep o k2.1 (9 / 10) (8 / 10) true)          -- struck again
    k1.2 = [.on] ∧ k2.2 = [] ∧ struckOf o k2.1 (9 / 10) (8 / 10) true = true
    ∧ k3.2 = [] ∧ k3.1.pending = 0 := by
  decide +kernel

/-! ### Release (note-tracker.ts:17-18) and the typed-array counters -/

/-- Option values the typed arrays can hold: `pending` is a `Uint8Array`,
    `age` and `quiet` are `Uint16Array`s. -/
def InRange (o : TrackerOptions) : Prop :=
  o.confirmFrames ≤ 255 ∧ o.minHoldFrames ≤ 65535 ∧ o.releaseFrames ≤ 65535

/-- What the cells satisfy while a key is down, under `InRange`: `quiet` has
    not outrun `age`, and has room for one more. -/
def KeyOK (k : Key) : Prop :=
  k.down = true → k.quiet ≤ k.age ∧ k.age ≤ 65535 ∧ k.quiet < 65535

theorem keyOK_fresh : KeyOK Key.fresh := by
  intro h; simp [Key.fresh] at h

theorem keyOK_edge (o : TrackerOptions) (k1 : Key) (struck : Bool) (frame : Rat)
    (hr : InRange o) (hk : KeyOK k1) : KeyOK (keyEdge o k1 struck frame).1 := by
  obtain ⟨_, hr2, hr3⟩ := hr
  cases hd : k1.down
  · cases struck
    · rw [edge_up_idle o k1 frame hd]; exact hk
    · rw [edge_up_struck o k1 frame hd]; intro _; simp only [start]; omega
  · obtain ⟨hq, ha, hlt⟩ := hk hd
    by_cases hs : struck = true ∧ heldB o k1.age = true
    · rw [hs.1, edge_restrike o k1 frame hd hs.2]; intro _; simp only [start]; omega
    · by_cases hrel : heldB o k1.age = true ∧ quietUp o k1.quiet frame ≥ o.releaseFrames
      · rw [edge_release o k1 struck frame hd hs hrel]; intro h; simp at h
      · rw [edge_stay o k1 struck frame hd hs hrel]
        intro _
        have hq1 : quietUp o k1.quiet frame ≤ k1.quiet + 1 := by
          unfold quietUp u16; split <;> omega
        have hage : (k1.age < 65535 → ageUp k1.age = k1.age + 1)
            ∧ (¬ k1.age < 65535 → ageUp k1.age = k1.age) := by
          unfold ageUp; split <;> omega
        have hstay : ¬ ageUp k1.age ≥ o.minHoldFrames ∨ ¬ quietUp o k1.quiet frame ≥ o.releaseFrames := by
          simp only [heldB, decide_eq_true_eq] at hrel
          omega
        simp only
        by_cases hsat : k1.age < 65535
        · have := hage.1 hsat; omega
        · have := hage.2 hsat; omega

/-- `KeyOK` is kept by every frame — under `InRange`. -/
theorem keyOK_step (o : TrackerOptions) (k : Key) (x y : Rat) (g : Bool)
    (hr : InRange o) (hk : KeyOK k) : KeyOK (keyStep o k x y g).1 :=
  keyOK_edge o (base o k x y g) _ _ hr hk

/-- The `quiet` counter never wraps: its increment (note-tracker.ts:95) always
    fits a `Uint16Array` cell, on every frame of any run from a new tracker —
    HOLDS ONLY UNDER `InRange` (through `keyOK_step`), which the code does not
    enforce (`TrackerOptions` is any numbers) but `settings.ts` satisfies
    (`settings_in_range`). -/
theorem quiet_never_wraps (k : Key) (hk : KeyOK k) (hd : k.down = true) :
    u16 (k.quiet + 1) = k.quiet + 1 := by
  obtain ⟨hq, ha, hlt⟩ := hk hd
  unfold u16
  omega

/-- note-tracker.ts:17-18 "It comes up once its frame activation has stayed
    below the frame threshold for `releaseFrames` frames in a row": a held key
    whose quiet count reaches `releaseFrames` on a frame that neither sounds
    nor re-strikes comes up on that frame — under `InRange` (through
    `quiet_never_wraps`). -/
theorem releases_after_releaseFrames (o : TrackerOptions) (k : Key) (x y : Rat) (g : Bool)
    (hk : KeyOK k) (hd : k.down = true)
    (hheld : heldB o k.age = true)
    (hquiet : ¬ gated g y ≥ o.frameThreshold)
    (hnostrike : ¬ gated g y ≥ o.confirmThreshold)
    (hcount : k.quiet + 1 ≥ o.releaseFrames) :
    (keyStep o k x y g).2 = [.off] ∧ (keyStep o k x y g).1.down = false := by
  have hw := quiet_never_wraps k hk hd
  have hs : struckOf o k x y g = false := by simp [struckOf, struckB, hnostrike]
  have hqu : quietUp o k.quiet (gated g y) = k.quiet + 1 := by
    unfold quietUp; rw [ifNeg hquiet, hw]
  unfold keyStep
  rw [hs, edge_release o (base o k x y g) false _ hd (by simp)
    ⟨hheld, by show quietUp o k.quiet (gated g y) ≥ _; rw [hqu]; exact hcount⟩]
  exact ⟨rfl, rfl⟩

/-- FAILS without `InRange` (1): `confirmFrames = 256` is stored into a
    `Uint8Array` as 0, so no strike is ever pending and the clearest possible
    note — onset 1, frame 1 — never lights its key.
    Repro: proofs/repro/mic_counter_wrap.ts. -/
theorem FAILS_confirm_window_when_confirmFrames_is_256 :
    let o := { DEFAULT_TRACKER with confirmFrames := 256 }
    (keyStep o Key.fresh 1 1 true).2 = [] ∧ (keyStep o Key.fresh 1 1 true).1.pending = 0 := by
  decide +kernel

/-- FAILS without `InRange` (2): with `releaseFrames` over 65535 a key that is
    down never comes up by falling quiet — the `Uint16Array` `quiet` cell
    wraps to 0 before it can reach the mark. Whatever the frames, it stays
    down. Repro: proofs/repro/mic_counter_wrap.ts. -/
theorem FAILS_release_when_releaseFrames_over_65535 (o : TrackerOptions) (k : Key)
    (x y : Rat) (g : Bool) (hbig : 65535 < o.releaseFrames) (hd : k.down = true) :
    (keyStep o k x y g).1.down = true := by
  have hq : ∀ q f, ¬ quietUp o q f ≥ o.releaseFrames := by
    intro q f; unfold quietUp u16; split <;> omega
  unfold keyStep
  generalize struckOf o k x y g = s
  generalize hb : base o k x y g = b
  have hbd : b.down = true := by rw [← hb]; exact hd
  cases s
  · rw [edge_stay o b false _ hbd (by simp) (fun hc => hq _ _ hc.2)]; exact hbd
  · by_cases hh : heldB o b.age = true
    · rw [edge_restrike o b _ hbd hh]; rfl
    · rw [edge_stay o b true _ hbd (fun hc => hh hc.2) (fun hc => hq _ _ hc.2)]; exact hbd

/-- FAILS without `InRange` (3): with `minHoldFrames` over 65535 the
    saturating `age` cell (note-tracker.ts:87) never reaches it, so a key that
    is down never comes up and is never re-struck: no event at all. -/
theorem FAILS_release_when_minHoldFrames_over_65535 (o : TrackerOptions) (k : Key)
    (x y : Rat) (g : Bool) (hbig : 65535 < o.minHoldFrames) (hd : k.down = true)
    (ha : k.age ≤ 65535) :
    (keyStep o k x y g).2 = [] ∧ (keyStep o k x y g).1.down = true
    ∧ (keyStep o k x y g).1.age ≤ 65535 := by
  have hheld : heldB o k.age = false := by
    have := (ageUp_le k.age).2
    simp only [heldB, decide_eq_false_iff_not]; omega
  unfold keyStep
  rw [edge_stay o (base o k x y g) _ _ hd (by simp [base, hheld]) (by simp [base, hheld])]
  exact ⟨rfl, hd, by have := (ageUp_le k.age).2; show ageUp k.age ≤ 65535; omega⟩

/-! ### The test file's tracker cases, run through the model (mic.test.ts:97-142) -/

/-- mic.test.ts:101 "lights a key on a confirmed strike and lifts it after the
    debounce": strike, ten sounding frames, then `releaseFrames` silent ones. -/
theorem tracker_test_strike_and_lift :
    (keyRun DEFAULT_TRACKER Key.fresh
      ([(9 / 10, 8 / 10, true)] ++ List.replicate 10 (0, 8 / 10, true)
        ++ List.replicate 4 (0, 0, true))).2 = [.on, .off]
    ∧ (keyRun DEFAULT_TRACKER Key.fresh
      ([(9 / 10, 8 / 10, true)] ++ List.replicate 10 (0, 8 / 10, true)
        ++ List.replicate 3 (0, 0, true))).2 = [.on] := by
  decide +kernel

/-- mic.test.ts:110 "ignores an overtone", :118 "waits a few frames for the
    frame activation to confirm a strike", :124 "reports a re-strike of a held
    key as off-then-on", :139 "hears nothing through a closed gate". -/
theorem tracker_tests :
    (keyRun DEFAULT_TRACKER Key.fresh
      ([(79 / 100, 35 / 100, true)] ++ List.replicate 5 (0, 35 / 100, true))).2 = []
    ∧ (keyRun DEFAULT_TRACKER Key.fresh [(9 / 10, 2 / 10, true), (0, 8 / 10, true)]).2 = [.on]
    ∧ (keyRun DEFAULT_TRACKER Key.fresh
      ([(9 / 10, 8 / 10, true)] ++ List.replicate 4 (0, 8 / 10, true)
        ++ [(9 / 10, 8 / 10, true)])).2 = [.on, .off, .on]
    ∧ (keyRun DEFAULT_TRACKER Key.fresh [(9 / 10, 8 / 10, false)]).2 = [] := by
  decide +kernel

/-! ### `releaseAll` (note-tracker.ts:104-114) -/

/-- note-tracker.ts:104 "Lift every key that is down": afterwards no key is
    down. -/
theorem releaseAll_leaves_no_key_down (keys : List Key) :
    ∀ k ∈ (releaseAll keys).1, k.down = false := by
  intro k hk
  simp only [releaseAll, List.mem_map] at hk
  obtain ⟨k0, _, rfl⟩ := hk
  rfl

/-- ... one `off` for each key that was down, lowest first, and none for a key
    that was up. -/
theorem releaseAll_events (keys : List Key) (i : Nat) :
    (Kind.off, LOWEST_PITCH + (i : Int)) ∈ (releaseAll keys).2 ↔ ∃ k, keys[i]? = some k ∧ k.down = true := by
  simp only [releaseAll, List.mem_map, List.mem_filter, Prod.mk.injEq, true_and]
  constructor
  · rintro ⟨⟨k, j⟩, ⟨hm, hd⟩, hj⟩
    have : j = i := by simp only at hj; omega
    subst this
    exact ⟨k, (List.mem_zipIdx_iff_getElem?.mp hm), hd⟩
  · rintro ⟨k, hk, hd⟩
    exact ⟨(k, i), ⟨List.mem_zipIdx_iff_getElem?.mpr hk, hd⟩, rfl⟩

/-- mic.test.ts:144 "releases every held key at once": a second `releaseAll`
    has nothing to lift. -/
theorem releaseAll_twice (keys : List Key) : (releaseAll (releaseAll keys).1).2 = [] := by
  simp only [releaseAll, List.map_eq_nil_iff, List.filter_eq_nil_iff]
  intro p hp
  have := List.mem_zipIdx_iff_getElem?.mp hp
  have hm : p.1 ∈ keys.map (fun k => (keyRelease k).1) := List.mem_of_getElem? this
  obtain ⟨k0, _, he⟩ := List.mem_map.mp hm
  rw [← he]
  simp [keyRelease]

/-! ## The option values the settings produce — src/mic/settings.ts -/

/-- src/mic/settings.ts:61 — `trackerOptions`. -/
def trackerOptions (sensitivity : Rat) : TrackerOptions :=
  let s := min 1 (max 0 sensitivity)
  { DEFAULT_TRACKER with
    onsetThreshold := 7 / 10 - 4 / 10 * s,
    confirmThreshold := 6 / 10 - 16 / 100 * s }

/-- src/mic/settings.ts:47 — `LOOKAHEAD`'s three values. -/
def LOOKAHEAD : List Int := [5, 8, 14]

/-- settings.ts:65-66 "0.7 … 0.3", "0.6 … 0.44" and settings.ts:59-60 "The
    confirm threshold stays above the ~0.4 that overtones reach even at full
    sensitivity" / mic.test.ts:209 — for every sensitivity, in range or not. -/
theorem trackerOptions_thresholds (sensitivity : Rat) :
    let o := trackerOptions sensitivity
    3 / 10 ≤ o.onsetThreshold ∧ o.onsetThreshold ≤ 7 / 10
    ∧ 44 / 100 ≤ o.confirmThreshold ∧ o.confirmThreshold ≤ 6 / 10
    ∧ 4 / 10 < o.confirmThreshold := by
  simp only [trackerOptions]
  grind

/-- settings.ts:58-59 "Sensitivity moves the two strike thresholds together,
    around the defaults at 0.5" / mic.test.ts:211 — the half that HOLDS: at
    sensitivity 0.5 the onset threshold is `DEFAULT_TRACKER`'s, and so are the
    three frame counts and the frame threshold. -/
theorem trackerOptions_default_onset :
    (trackerOptions (1 / 2)).onsetThreshold = DEFAULT_TRACKER.onsetThreshold
    ∧ (trackerOptions (1 / 2)).confirmFrames = DEFAULT_TRACKER.confirmFrames
    ∧ (trackerOptions (1 / 2)).frameThreshold = DEFAULT_TRACKER.frameThreshold
    ∧ (trackerOptions (1 / 2)).minHoldFrames = DEFAULT_TRACKER.minHoldFrames
    ∧ (trackerOptions (1 / 2)).releaseFrames = DEFAULT_TRACKER.releaseFrames := by
  have h : min (1 : Rat) (max 0 (1 / 2)) = 1 / 2 := by grind
  simp only [trackerOptions, DEFAULT_TRACKER, h, and_true]
  grind

/-- FAILS. settings.ts:58-59 "around the defaults at 0.5": at sensitivity 0.5
    the confirm threshold is `0.6 - 0.16 * 0.5 = 0.52`, not `DEFAULT_TRACKER`'s
    0.5 (note-tracker.ts:44). The two thresholds do not pass through the
    defaults together. Repro: proofs/repro/mic_settings_default.ts. -/
theorem FAILS_trackerOptions_default_confirm :
    (trackerOptions (1 / 2)).confirmThreshold = 52 / 100
    ∧ (trackerOptions (1 / 2)).confirmThreshold ≠ DEFAULT_TRACKER.confirmThreshold := by
  have h : min (1 : Rat) (max 0 (1 / 2)) = 1 / 2 := by grind
  simp only [trackerOptions, DEFAULT_TRACKER, h]
  constructor <;> grind

/-- No option value the settings can produce makes a typed-array counter
    wrap: the three frame counts are always the defaults (3, 4, 4). -/
theorem settings_in_range (sensitivity : Rat) : InRange (trackerOptions sensitivity) := by
  simp [InRange, trackerOptions, DEFAULT_TRACKER]

/-- Every lookahead the settings can produce keeps a committed frame inside
    the window (`committed_frame_is_a_window_row`) and leaves frames to commit. -/
theorem lookahead_in_window : ∀ l ∈ LOOKAHEAD, 0 ≤ l ∧ l < WINDOW_FRAMES := by decide

/-- The gate options in use (`DEFAULT_GATE`, transcriber.ts:45) satisfy the
    hypotheses of the gate theorems. -/
theorem default_gate_ok :
    0 < DEFAULT_GATE.marginDb ∧ 0 ≤ DEFAULT_GATE.riseDbPerSecond
    ∧ 0 ≤ DEFAULT_GATE.hysteresisDb ∧ 0 ≤ DEFAULT_GATE.holdFrames := by
  decide +kernel

end Harmonicland.Mic
