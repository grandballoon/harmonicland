/-!
# Reconcile — the diff-reconcile pattern

Three modules hold LiveKeys voices and bring them into line with a wanted set
of pitches by the same few lines:

* `src/perf-state.ts:99-113` — `PerfState.trigger`, and `release` at 117-120;
* `src/tonnetz-state.ts:35-47` — `TonnetzState.trigger`, and `release` at 49-52;
* `src/practice-state.ts:253-267` — `reconcileOther`.

"release the notes we no longer want, press the ones we now do, leave common
tones be" (perf-state.ts:99-100).

## What the model is

* `reconcile` is that loop pair, translated once: the three sources differ
  only in the names of their locals and in where the wanted pitches come from.
* LiveKeys is modelled by its INTERFACE, as `LiveKeys.lean` proves it behaves:
  `press` hands back a handle that was not live before and makes exactly that
  handle live (`LiveKeys.live_press`, `press_fresh`); `release` makes exactly
  that handle dead and is a no-op on a dead one (`live_release`,
  `release_dead`); `releaseAll` leaves none live (`releaseAll_invalidates`).
  So `LK.live` is the list of live handles, and `LK.calls` is a log of every
  `LiveKeys.press` / `LiveKeys.release` call made, newest first — that log is
  what "presses/releases nothing" and "no re-attack" are statements about.
* The wanted pitches are an arbitrary `List Int`, in the order the source
  iterates them: `v.notes` (perf-state.ts:109), `next` (tonnetz-state.ts:44),
  or the elements of the `want` Set (practice-state.ts:262, which cannot hold
  a pitch twice).
* The end of the file models just enough of `computeVoicing`
  (src/harmony/perfecto.ts:184-224) and `voiceTriad`
  (src/harmony/tonnetz-lattice.ts:95-101) to answer whether the wanted list
  can name one pitch twice, and `cycleMode` / `cycleInversion` / the octave
  clamps of perf-state.ts and tonnetz-state.ts.

## What the model leaves out

* Sound: whether a pitch is heard is `LiveKeys.lean`'s refcount.
* `onPress` listeners called from inside `LiveKeys.press`. The only one in the
  codebase is the practice cursor's (practice-state.ts:372), which touches no
  state of PerfState or TonnetzState; `PracticeCursor.lean` handles it for
  `reconcileOther`.
* `previousVoicing` and the voice-leading search of `computeVoicing`: the
  wanted list is taken as given. (`repro/reconcile_duplicate_voicing.ts`
  checks by enumeration that a second `trigger()` under voice-leading computes
  the same notes.)
* `Array.prototype.sort((x, y) => x - y)` on integers is modelled as insertion
  sort: any correct ascending sort of integers returns the same array.
-/

namespace Harmonicland.Reconcile

/-! ## LiveKeys, by its interface -/

/-- src/live-keys.ts:51 — a handle: an identity and the pitch it sounds. -/
structure Voice where
  id : Nat
  pitch : Int
  deriving DecidableEq, Repr

/-- A call into LiveKeys that this module made. -/
inductive Call where
  | press (v : Voice)
  | release (v : Voice)
  deriving DecidableEq, Repr

structure LK where
  /-- the handles LiveKeys holds -/
  live : List Voice
  /-- the identity the next press will have -/
  nextId : Nat
  /-- every press / release call, newest first -/
  calls : List Call

/-- `LiveKeys.press(p)` — live-keys.ts:81. -/
def LK.press (lk : LK) (p : Int) : LK × Voice :=
  let v : Voice := { id := lk.nextId, pitch := p }
  ({ live := lk.live ++ [v], nextId := lk.nextId + 1, calls := .press v :: lk.calls }, v)

/-- `LiveKeys.release(v)` — live-keys.ts:97. -/
def LK.release (lk : LK) (v : Voice) : LK :=
  { lk with live := lk.live.filter (fun w => decide (w ≠ v)), calls := .release v :: lk.calls }

/-- `LiveKeys.isLive(v)` — live-keys.ts:105. -/
def LK.isLive (lk : LK) (v : Voice) : Bool := decide (v ∈ lk.live)

/-- `LiveKeys.releaseAll()`, called by somebody else — live-keys.ts:107. -/
def LK.releaseAll (lk : LK) : LK := { lk with live := [] }

/-- `LiveKeys.held()` — live-keys.ts:111. -/
def LK.held (lk : LK) : List Int := lk.live.map (·.pitch)

/-! ## The pattern -/

/-- perf-state.ts:104-107 / tonnetz-state.ts:39-42 / practice-state.ts:257-260,
    one turn of the first loop: `if (next.has(held.pitch)) kept.push(held);
    else LiveKeys.release(held);` -/
def keepOrRelease (want : List Int) (acc : LK × List Voice) (held : Voice) : LK × List Voice :=
  if held.pitch ∈ want then (acc.1, acc.2 ++ [held]) else (acc.1.release held, acc.2)

/-- perf-state.ts:109 / tonnetz-state.ts:44 / practice-state.ts:262, one turn
    of the second loop: `if (!keptPitches.has(p)) kept.push(LiveKeys.press(p));`
    `keptPitches` was built BEFORE this loop and is not added to by it. -/
def pressMissing (keptPitches : List Int) (acc : LK × List Voice) (p : Int) : LK × List Voice :=
  if p ∈ keptPitches then acc else ((acc.1.press p).1, acc.2 ++ [(acc.1.press p).2])

/-- perf-state.ts:102-110 / tonnetz-state.ts:36-45 / practice-state.ts:256-263.
    `sounding` is the module's handle list, `want` the pitches in iteration
    order. Returns LiveKeys and the new handle list (`kept`). -/
def reconcile (lk : LK) (sounding : List Voice) (want : List Int) : LK × List Voice :=
  let r1 := (sounding.filter lk.isLive).foldl (keepOrRelease want) (lk, [])
  want.foldl (pressMissing (r1.2.map (·.pitch))) r1

/-- The module: its handles, and the LiveKeys it shares with everyone. -/
structure St where
  lk : LK
  sounding : List Voice

/-- perf-state.ts:74 / tonnetz-state.ts:31 / practice-state.ts:234 —
    `sounding.filter(LiveKeys.isLive)`. -/
def liveVoices (s : St) : List Voice := s.sounding.filter s.lk.isLive

/-- perf-state.ts:101-113 / tonnetz-state.ts:35-47. -/
def trigger (s : St) (want : List Int) : St :=
  { lk := (reconcile s.lk s.sounding want).1, sounding := (reconcile s.lk s.sounding want).2 }

/-- perf-state.ts:117-120 / tonnetz-state.ts:49-52 — `for (const held of
    sounding) LiveKeys.release(held); sounding = [];` -/
def release (s : St) : St :=
  { lk := s.sounding.foldl LK.release s.lk, sounding := [] }

/-- perf-state.ts:124 / tonnetz-state.ts:54. -/
def isSounding (s : St) : Bool := (liveVoices s).length > 0

/-- perf-state.ts:146 `snapshot().sounding`. -/
def snapshotSounding (s : St) : List Int := (liveVoices s).map (·.pitch)

/-! ## The two loops in closed form -/

/-- `for (const v of R) LiveKeys.release(v)`. -/
def releaseList (lk : LK) (R : List Voice) : LK := R.foldl LK.release lk

/-- `for (const p of P) out.push(LiveKeys.press(p))`. -/
def pressList : LK → List Int → LK × List Voice
  | lk, [] => (lk, [])
  | lk, p :: ps => ((pressList (lk.press p).1 ps).1, (lk.press p).2 :: (pressList (lk.press p).1 ps).2)

theorem loop1 (want : List Int) (L : List Voice) :
    ∀ (lk : LK) (kept : List Voice),
      L.foldl (keepOrRelease want) (lk, kept) =
        (releaseList lk (L.filter (fun h => decide (h.pitch ∉ want))),
         kept ++ L.filter (fun h => decide (h.pitch ∈ want))) := by
  induction L with
  | nil => intro lk kept; simp [releaseList]
  | cons h L ih =>
    intro lk kept
    by_cases hw : h.pitch ∈ want
    · simp [List.foldl_cons, keepOrRelease, hw, ih, List.filter, List.append_assoc]
    · simp [List.foldl_cons, keepOrRelease, hw, ih, List.filter, releaseList]

theorem loop2 (K : List Int) (W : List Int) :
    ∀ (lk : LK) (kept : List Voice),
      W.foldl (pressMissing K) (lk, kept) =
        ((pressList lk (W.filter (fun p => decide (p ∉ K)))).1,
         kept ++ (pressList lk (W.filter (fun p => decide (p ∉ K)))).2) := by
  induction W with
  | nil => intro lk kept; simp [pressList]
  | cons p W ih =>
    intro lk kept
    by_cases hk : p ∈ K
    · simp [List.foldl_cons, pressMissing, hk, ih, List.filter]
    · simp [List.foldl_cons, pressMissing, hk, ih, List.filter, pressList, List.append_assoc]

theorem releaseList_live (R : List Voice) :
    ∀ lk : LK, (releaseList lk R).live = lk.live.filter (fun v => decide (v ∉ R)) := by
  induction R with
  | nil =>
    intro lk
    simp only [releaseList, List.foldl_nil]
    exact (List.filter_eq_self.2 (by simp)).symm
  | cons r R ih =>
    intro lk
    have := ih (lk.release r)
    simp only [releaseList, List.foldl_cons] at this ⊢
    rw [this]
    simp only [LK.release, List.filter_filter]
    congr 1
    funext v
    by_cases h1 : v = r <;> by_cases h2 : v ∈ R <;> simp [h1, h2]

theorem releaseList_nextId (R : List Voice) : ∀ lk : LK, (releaseList lk R).nextId = lk.nextId := by
  induction R with
  | nil => intro lk; rfl
  | cons r R ih => intro lk; simpa [releaseList, LK.release] using ih (lk.release r)

theorem releaseList_calls (R : List Voice) :
    ∀ lk : LK, (releaseList lk R).calls = (R.map Call.release).reverse ++ lk.calls := by
  induction R with
  | nil => intro lk; simp [releaseList]
  | cons r R ih =>
    intro lk
    have := ih (lk.release r)
    simp only [releaseList, List.foldl_cons] at this ⊢
    rw [this]; simp [LK.release]

theorem pressList_pitches (P : List Int) : ∀ lk : LK, (pressList lk P).2.map (·.pitch) = P := by
  induction P with
  | nil => intro lk; rfl
  | cons p P ih => intro lk; simp [pressList, ih, LK.press]

theorem pressList_live (P : List Int) :
    ∀ lk : LK, (pressList lk P).1.live = lk.live ++ (pressList lk P).2 := by
  induction P with
  | nil => intro lk; simp [pressList]
  | cons p P ih => intro lk; simp [pressList, ih, LK.press]

theorem pressList_fresh (P : List Int) :
    ∀ lk : LK, ∀ v ∈ (pressList lk P).2, lk.nextId ≤ v.id := by
  induction P with
  | nil => intro lk v hv; simp [pressList] at hv
  | cons p P ih =>
    intro lk v hv
    simp only [pressList, List.mem_cons] at hv
    rcases hv with rfl | hv
    · simp [LK.press]
    · have := ih _ v hv
      simp [LK.press] at this; omega

theorem pressList_nextId (P : List Int) :
    ∀ lk : LK, lk.nextId ≤ (pressList lk P).1.nextId := by
  induction P with
  | nil => intro lk; simp [pressList]
  | cons p P ih =>
    intro lk
    have := ih (lk.press p).1
    simp only [pressList]
    simp only [LK.press] at this ⊢; omega

theorem pressList_calls (P : List Int) :
    ∀ lk : LK, (pressList lk P).1.calls = ((pressList lk P).2.map Call.press).reverse ++ lk.calls := by
  induction P with
  | nil => intro lk; simp [pressList]
  | cons p P ih => intro lk; simp [pressList, ih, LK.press]

/-! ## What one `trigger` does, exactly -/

/-- The handles kept: live, and on a wanted pitch. -/
def keptOf (s : St) (want : List Int) : List Voice :=
  (liveVoices s).filter (fun h => decide (h.pitch ∈ want))

/-- The handles released: live, and on a pitch no longer wanted. -/
def releasedOf (s : St) (want : List Int) : List Voice :=
  (liveVoices s).filter (fun h => decide (h.pitch ∉ want))

/-- The pitches pressed, in order: wanted, and not among the kept. -/
def missingOf (s : St) (want : List Int) : List Int :=
  want.filter (fun p => decide (p ∉ (keptOf s want).map (·.pitch)))

/-- The handles those presses return. -/
def pressedOf (s : St) (want : List Int) : List Voice :=
  (pressList (releaseList s.lk (releasedOf s want)) (missingOf s want)).2

theorem trigger_spec (s : St) (want : List Int) :
    (trigger s want).sounding = keptOf s want ++ pressedOf s want ∧
    (trigger s want).lk = (pressList (releaseList s.lk (releasedOf s want)) (missingOf s want)).1 := by
  simp [trigger, reconcile, loop1, loop2, keptOf, releasedOf, missingOf, pressedOf, liveVoices]

/-- Handles came from `press`: their identities are below the next one. -/
def Good (s : St) : Prop :=
  (∀ v ∈ s.lk.live, v.id < s.lk.nextId) ∧ (∀ v ∈ s.sounding, v.id < s.lk.nextId)

theorem mem_liveVoices (s : St) (v : Voice) : v ∈ liveVoices s ↔ (v ∈ s.sounding ∧ v ∈ s.lk.live) := by
  simp [liveVoices, LK.isLive]

theorem pressedOf_pitches (s : St) (want : List Int) :
    (pressedOf s want).map (·.pitch) = missingOf s want := pressList_pitches _ _

theorem trigger_live (s : St) (want : List Int) (v : Voice) :
    v ∈ (trigger s want).lk.live ↔
      ((v ∈ s.lk.live ∧ v ∉ releasedOf s want) ∨ v ∈ pressedOf s want) := by
  rw [(trigger_spec s want).2, pressList_live, releaseList_live]
  simp [pressedOf]

/-- Everything `trigger` leaves in `sounding` is live. -/
theorem trigger_all_live (s : St) (want : List Int) :
    ∀ v ∈ (trigger s want).sounding, v ∈ (trigger s want).lk.live := by
  intro v hv
  rw [(trigger_spec s want).1] at hv
  rw [trigger_live]
  rcases List.mem_append.1 hv with h | h
  · left
    simp only [keptOf, List.mem_filter, mem_liveVoices, decide_eq_true_eq] at h
    refine ⟨h.1.2, ?_⟩
    simp only [releasedOf, List.mem_filter, decide_eq_true_eq]
    exact fun hc => hc.2 h.2
  · exact Or.inr h

/-- Everything `trigger` leaves in `sounding` is on a wanted pitch. -/
theorem trigger_pitch_wanted (s : St) (want : List Int) :
    ∀ v ∈ (trigger s want).sounding, v.pitch ∈ want := by
  intro v hv
  rw [(trigger_spec s want).1] at hv
  rcases List.mem_append.1 hv with h | h
  · simp only [keptOf, List.mem_filter, decide_eq_true_eq] at h; exact h.2
  · have : v.pitch ∈ (pressedOf s want).map (·.pitch) := List.mem_map.2 ⟨v, h, rfl⟩
    rw [pressedOf_pitches] at this
    simp only [missingOf, List.mem_filter] at this; exact this.1

/-- Every wanted pitch has a handle in `sounding` after `trigger`. -/
theorem trigger_covers (s : St) (want : List Int) :
    ∀ p ∈ want, p ∈ (trigger s want).sounding.map (·.pitch) := by
  intro p hp
  rw [(trigger_spec s want).1, List.map_append, List.mem_append, pressedOf_pitches]
  by_cases hk : p ∈ (keptOf s want).map (·.pitch)
  · exact Or.inl hk
  · right; simp only [missingOf, List.mem_filter, decide_eq_true_eq]; exact ⟨hp, hk⟩

/-! ## The claims -/

/-- **perf-state.ts:101** "Idempotent — calling trigger() with no change
    presses/releases nothing"; **perf-state.test.ts:31**,
    **tonnetz-state.test.ts:52**. A second `trigger` for the same pitches
    leaves the module AND LiveKeys — its call log included — exactly as the
    first left them. Holds whatever `want` is, repeated pitches included. -/
theorem trigger_idempotent (s : St) (want : List Int) :
    trigger (trigger s want) want = trigger s want := by
  have hlive := trigger_all_live s want
  have hwant := trigger_pitch_wanted s want
  have hcov := trigger_covers s want
  generalize trigger s want = t at *
  have hL : liveVoices t = t.sounding := by
    unfold liveVoices
    rw [List.filter_eq_self]
    intro v hv; simp [LK.isLive, hlive v hv]
  have hkept : keptOf t want = t.sounding := by
    unfold keptOf; rw [hL, List.filter_eq_self]
    intro v hv; simp [hwant v hv]
  have hrel : releasedOf t want = [] := by
    unfold releasedOf; rw [hL, List.filter_eq_nil_iff]
    intro v hv; simp [hwant v hv]
  have hmiss : missingOf t want = [] := by
    unfold missingOf; rw [hkept, List.filter_eq_nil_iff]
    intro p hp; simp only [decide_eq_true_eq, Decidable.not_not]; exact hcov p hp
  obtain ⟨h1, h2⟩ := trigger_spec t want
  have hp : pressedOf t want = [] := by simp [pressedOf, hmiss, pressList]
  rw [hkept, hp, List.append_nil] at h1
  rw [hrel, hmiss] at h2
  simp only [releaseList, List.foldl_nil, pressList] at h2
  cases t; cases h : trigger _ want
  simp_all

/-- **perf-state.ts:11-13** "a re-trigger DIFFS (common tones stay down, no
    re-attack)"; **tonnetz-state.ts:7-9**; **practice-state.ts:30-31** "common
    tones between steps never re-attack". A live handle of ours on a pitch
    that is still wanted is kept — the same handle, still live. -/
theorem common_tone_kept (s : St) (want : List Int) (v : Voice)
    (hv : v ∈ liveVoices s) (hp : v.pitch ∈ want) :
    v ∈ (trigger s want).sounding ∧ v ∈ (trigger s want).lk.live := by
  have hk : v ∈ keptOf s want := by simp [keptOf, hv, hp]
  have hs : v ∈ (trigger s want).sounding := by
    rw [(trigger_spec s want).1]; exact List.mem_append.2 (Or.inl hk)
  exact ⟨hs, trigger_all_live s want v hs⟩

/-- The calls `trigger` makes into LiveKeys, newest first: its presses, and
    before them its releases. -/
theorem trigger_calls (s : St) (want : List Int) :
    (trigger s want).lk.calls =
      ((pressedOf s want).map Call.press).reverse ++
        (((releasedOf s want).map Call.release).reverse ++ s.lk.calls) := by
  rw [(trigger_spec s want).2, pressList_calls, releaseList_calls]; rfl

/-- **"no re-attack"**, at the wire: `trigger` presses only pitches that are
    wanted and that no live handle of ours was already on, and releases only
    live handles of ours on pitches no longer wanted. So for a common tone
    there is neither a release nor a press. -/
theorem trigger_calls_only_the_diff (s : St) (want : List Int) :
    (∀ v ∈ pressedOf s want, v.pitch ∈ want ∧ v.pitch ∉ (liveVoices s).map (·.pitch)) ∧
    (∀ v ∈ releasedOf s want, v ∈ liveVoices s ∧ v.pitch ∉ want) := by
  constructor
  · intro v hv
    have : v.pitch ∈ missingOf s want := by
      rw [← pressedOf_pitches]; exact List.mem_map.2 ⟨v, hv, rfl⟩
    simp only [missingOf, List.mem_filter, decide_eq_true_eq] at this
    refine ⟨this.1, ?_⟩
    intro hc
    obtain ⟨w, hw, hwp⟩ := List.mem_map.1 hc
    apply this.2
    exact List.mem_map.2 ⟨w, by simp [keptOf, hw, hwp, this.1], hwp⟩
  · intro v hv
    simpa [releasedOf] using hv

/-- Is this call a press of pitch `p`? -/
def isPressOf (p : Int) : Call → Bool
  | .press v => v.pitch == p
  | .release _ => false

/-- "One voice each": no two handles in `sounding` share a pitch. -/
def OneEach (s : St) : Prop := (s.sounding.map (·.pitch)).Nodup

/-- **What a trigger leaves sounding** (perf-state.ts:99-100; the task's
    "after a trigger the module's live voices sound exactly the wanted
    pitches, one voice each"). HOLDS ONLY UNDER A HYPOTHESIS THE CODE DOES NOT
    ENFORCE for PerfState: `want` names no pitch twice (`hnd`). For
    `reconcileOther` the hypothesis is free (`want` is a JS Set); for
    `TonnetzState` it is `voiceTriad_nodup` below; for `PerfState` it is false
    — see `FAILS_one_voice_each` and `FAILS_computeVoicing_nodup`. -/
theorem trigger_exact (s : St) (want : List Int) (hnd : want.Nodup) (h1 : OneEach s) :
    OneEach (trigger s want) ∧
    (∀ p, p ∈ snapshotSounding (trigger s want) ↔ p ∈ want) ∧
    liveVoices (trigger s want) = (trigger s want).sounding := by
  have hlive := trigger_all_live s want
  have hL : liveVoices (trigger s want) = (trigger s want).sounding := by
    unfold liveVoices
    rw [List.filter_eq_self]
    intro v hv; simp [LK.isLive, hlive v hv]
  refine ⟨?_, ?_, hL⟩
  · unfold OneEach
    rw [(trigger_spec s want).1, List.map_append, pressedOf_pitches, List.nodup_append]
    refine ⟨?_, ?_, ?_⟩
    · have hsub : ((keptOf s want).map (·.pitch)).Sublist (s.sounding.map (·.pitch)) :=
        List.Sublist.map _ (List.Sublist.trans List.filter_sublist List.filter_sublist)
      exact hsub.nodup h1
    · exact (List.filter_sublist (l := want)).nodup hnd
    · intro a ha b hb e
      subst e
      simp only [missingOf, List.mem_filter, decide_eq_true_eq] at hb
      exact hb.2 ha
  · intro p
    unfold snapshotSounding
    rw [hL]
    constructor
    · intro hp
      obtain ⟨v, hv, rfl⟩ := List.mem_map.1 hp
      exact trigger_pitch_wanted s want v hv
    · exact trigger_covers s want p

/-- "One voice each" survives everything else that can happen: our own
    `release`, and any change to LiveKeys made by somebody else (which never
    touches `sounding`). So with duplicate-free wanted lists it holds after
    any sequence of calls. -/
theorem OneEach_release (s : St) : OneEach (release s) := by simp [OneEach, release]

theorem OneEach_external (s : St) (lk' : LK) (h : OneEach s) :
    OneEach { s with lk := lk' } := h

/-- …and then `snapshot().sounding` never lists a pitch twice. -/
theorem snapshot_nodup (s : St) (h : OneEach s) : (snapshotSounding s).Nodup :=
  (List.Sublist.map _ List.filter_sublist).nodup h

/-- From silence, one `trigger` for the notes `[69, 72, 74, 77, 77]`. -/
def dupExample : St :=
  trigger { lk := { live := [], nextId := 0, calls := [] }, sounding := [] } [69, 72, 74, 77, 77]

/-- **FAILS — "one voice each"** when the wanted list repeats a pitch
    (perf-state.ts:108-109: `keptPitches` is computed before the press loop
    and not updated inside it). From silence, `trigger` for the notes
    `[69, 72, 74, 77, 77]` — what `computeVoicing` returns for C major, ii,
    extended, down, second inversion, octave 4 — presses 77 twice and holds
    two voices on it; `snapshot().sounding` lists 77 twice.
    Repro: `repro/reconcile_duplicate_voicing.ts`, section 1. -/
theorem FAILS_one_voice_each :
    snapshotSounding dupExample = [69, 72, 74, 77, 77] ∧
      ¬ (dupExample.sounding.map (·.pitch)).Nodup ∧
      dupExample.lk.calls.filter (isPressOf 77) = [Call.press ⟨4, 77⟩, Call.press ⟨3, 77⟩] := by
  decide

/-- **perf-state.ts:12-13** "release() lifts precisely what we put down";
    **perf-state.test.ts:66** "lifts exactly its own chord and leaves another
    surface's note alone"; **tonnetz-state.test.ts:77**. After `release`
    nothing of ours is live, and a handle that is not ours is live exactly
    when it was. -/
theorem release_precise (s : St) (v : Voice) :
    v ∈ (release s).lk.live ↔ (v ∈ s.lk.live ∧ v ∉ s.sounding) := by
  have := releaseList_live s.sounding s.lk
  simp only [releaseList] at this
  simp [release, this]

theorem release_empties (s : St) : (release s).sounding = [] ∧ isSounding (release s) = false := by
  simp [release, isSounding, liveVoices]

/-- **perf-state.ts:13-16** "every read goes through liveVoices(), which drops
    any handle LiveKeys has since invalidated (a releaseAll on a view change,
    say). So there is no second copy of 'what is sounding' to fall out of
    sync with the first": whatever LiveKeys has become, every pitch the
    snapshot reports is one LiveKeys holds. -/
theorem snapshot_agrees_with_livekeys (s : St) (p : Int) (h : p ∈ snapshotSounding s) :
    p ∈ s.lk.held := by
  obtain ⟨v, hv, rfl⟩ := List.mem_map.1 h
  exact List.mem_map.2 ⟨v, ((mem_liveVoices s v).1 hv).2, rfl⟩

/-- **perf-state.test.ts:50** "reports not-sounding once its voices are
    invalidated" and **:57** "re-presses the WHOLE chord on the next trigger,
    not the diff"; **tonnetz-state.test.ts:104**. After a `releaseAll` from
    elsewhere the module reports silence, and the next `trigger` releases
    nothing and presses every wanted pitch, in order. -/
theorem after_releaseAll (s : St) (want : List Int) :
    let s' : St := { s with lk := s.lk.releaseAll }
    isSounding s' = false ∧ snapshotSounding s' = [] ∧
      releasedOf s' want = [] ∧ (pressedOf s' want).map (·.pitch) = want := by
  have hL : liveVoices { s with lk := s.lk.releaseAll } = [] := by
    simp [liveVoices, LK.isLive, LK.releaseAll]
  refine ⟨by simp [isSounding, hL], by simp [snapshotSounding, hL], by simp [releasedOf, hL], ?_⟩
  rw [pressedOf_pitches]
  simp [missingOf, keptOf, hL]

/-! ## Can the wanted list repeat a pitch? -/

/-- Insert into an ascending list. -/
def insertSorted (x : Int) : List Int → List Int
  | [] => [x]
  | y :: ys => if x ≤ y then x :: y :: ys else y :: insertSorted x ys

/-- `[...].sort((x, y) => x - y)` on integers. -/
def sortAsc : List Int → List Int
  | [] => []
  | x :: xs => insertSorted x (sortAsc xs)

/-- src/harmony/perfecto.ts:113 -/
inductive Inversion where
  | root | first | second
  deriving DecidableEq, Repr

/-- src/harmony/perfecto.ts:190-191 — `build(ivls, 0)`. -/
def build (chordRoot : Int) (ivls : List Int) : List Int :=
  sortAsc (ivls.map (fun i => chordRoot + i))

/-- src/harmony/perfecto.ts:193-199 — `applyInversion`. -/
def applyInversion (notes : List Int) (inv : Inversion) : List Int :=
  if notes.length < 2 then notes
  else
    match sortAsc notes, inv with
    | a :: rest, .first => sortAsc ((a + 12) :: rest)
    | a :: b :: rest, .second => sortAsc ((a + 12) :: (b + 12) :: rest)
    | r, _ => sortAsc r

/-- src/harmony/perfecto.ts:223 — `computeVoicing` without voice-leading:
    `applyInversion(build(intervals, 0), a.inversion)`. -/
def voicing (chordRoot : Int) (ivls : List Int) (inv : Inversion) : List Int :=
  applyInversion (build chordRoot ivls) inv

/-- Every interval list in `JOYSTICK_TABLES` — src/harmony/perfecto.ts:84-121
    — each written once. -/
def tableLists : List (List Int) :=
  [ [0, 4, 7], [0, 3, 7], [0, 3, 6],
    [0, 4, 7, 10], [0, 3, 7, 10], [0, 3, 6, 10],
    [0, 4, 7, 11],
    [0, 4, 7, 14], [0, 3, 7, 14], [0, 3, 6, 14],
    [0, 5, 7],
    [0, 4, 7, 9], [0, 2, 7], [0, 2, 6],
    [0, 4, 8], [0, 3, 8],
    [0, 4, 7, 10, 14], [0, 3, 7, 10, 14], [0, 3, 6, 10, 14],
    [0, 4, 7, 17], [0, 3, 7, 17], [0, 3, 6, 17],
    [0, 3, 7, 10, 17],
    [0, 4, 7, 10, 15], [0, 3, 7, 10, 15], [0, 3, 6, 10, 15],
    [0, 5, 7, 10],
    [0, 3, 7, 11],
    [0, 4, 7, 10, 14, 21],
    [0, 4, 7, 9, 14], [0, 3, 7, 9, 14], [0, 3, 6, 9, 14],
    [0, 4, 8, 10, 15],
    [0, 4, 7, 11, 14, 21],
    [0, 4, 7, 10, 13], [0, 3, 7, 10, 13], [0, 3, 6, 10, 13],
    [0, 4, 7, 11, 18] ]

/-- **FAILS — `computeVoicing` names each pitch once.** `Voicing.notes` is
    documented only as "MIDI note numbers, sorted ascending"
    (perfecto.ts:116), but `trigger`'s "one voice each" needs them distinct.
    The dom7♯9 cell on a minor degree, `[0, 3, 7, 10, 15]`
    (perfecto.ts:105, `extended.down.minor`), in second inversion lifts its
    third by an octave onto its ♯9: for C major, degree ii, octave 4 the
    chord root is 62 and the notes are `[69, 72, 74, 77, 77]`.
    Repro: `repro/reconcile_duplicate_voicing.ts`, sections 1 and 2. -/
theorem FAILS_computeVoicing_nodup :
    voicing 62 [0, 3, 7, 10, 15] .second = [69, 72, 74, 77, 77] ∧
      ¬ (voicing 62 [0, 3, 7, 10, 15] .second).Nodup := by
  decide

/-- …and that is the only way it happens: over every interval list in the
    joystick tables and every inversion, the notes are distinct except for
    the two lists of the `extended.down` cell (minor and diminished) in
    second inversion. Stated at chord root 0; `voicing_shift` carries it to
    every root. -/
theorem computeVoicing_nodup_except :
    ∀ l ∈ tableLists, ∀ inv : Inversion,
      (voicing 0 l inv).Nodup ↔
        ¬ (inv = .second ∧ (l = [0, 3, 7, 10, 15] ∨ l = [0, 3, 6, 10, 15])) := by
  have h : ∀ l ∈ tableLists, ∀ inv ∈ [Inversion.root, Inversion.first, Inversion.second],
      (voicing 0 l inv).Nodup ↔
        ¬ (inv = .second ∧ (l = [0, 3, 7, 10, 15] ∨ l = [0, 3, 6, 10, 15])) := by
    decide
  intro l hl inv
  exact h l hl inv (by cases inv <;> simp)

theorem insertSorted_map_add (c x : Int) (l : List Int) :
    insertSorted (c + x) (l.map (fun i => c + i)) = (insertSorted x l).map (fun i => c + i) := by
  induction l with
  | nil => rfl
  | cons y ys ih =>
    by_cases h : x ≤ y
    · have h' : c + x ≤ c + y := by omega
      simp [insertSorted, h, h']
    · have h' : ¬ c + x ≤ c + y := by omega
      simp [insertSorted, h, h', ih]

theorem sortAsc_map_add (c : Int) (l : List Int) :
    sortAsc (l.map (fun i => c + i)) = (sortAsc l).map (fun i => c + i) := by
  induction l with
  | nil => rfl
  | cons x xs ih => simp [sortAsc, ih, insertSorted_map_add]

/-- Moving the chord root moves every note with it: the voicing at root `c`
    is the voicing at root 0, transposed. So whether two notes coincide does
    not depend on the key, the degree or the octave. -/
theorem voicing_shift (c : Int) (l : List Int) (inv : Inversion) :
    voicing c l inv = (voicing 0 l inv).map (fun i => c + i) := by
  have hb : build c l = (build 0 l).map (fun i => c + i) := by
    unfold build
    rw [sortAsc_map_add, sortAsc_map_add]
    simp
  unfold voicing
  rw [hb]
  generalize build 0 l = n
  unfold applyInversion
  rw [List.length_map, sortAsc_map_add]
  split
  · rfl
  · cases hs : sortAsc n with
    | nil => cases inv <;> simp [sortAsc]
    | cons a rest =>
      cases inv with
      | root =>
        show sortAsc (List.map (fun i => c + i) (a :: rest)) =
          List.map (fun i => c + i) (sortAsc (a :: rest))
        rw [sortAsc_map_add]
      | first =>
        have : c + a + 12 = c + (a + 12) := by omega
        simp only [List.map_cons, this]
        rw [← List.map_cons (f := fun i => c + i), sortAsc_map_add]
      | second =>
        cases rest with
        | nil => simp [sortAsc, insertSorted]
        | cons b rest =>
          have h1 : c + a + 12 = c + (a + 12) := by omega
          have h2 : c + b + 12 = c + (b + 12) := by omega
          simp only [List.map_cons, h1, h2]
          rw [← List.map_cons (f := fun i => c + i), ← List.map_cons (f := fun i => c + i),
            sortAsc_map_add]

/-! ### `voiceTriad` — src/harmony/tonnetz-lattice.ts -/

/-- JavaScript's `%` on integers truncates toward zero: `Int.tmod`. -/
def jsMod (a b : Int) : Int := a.tmod b

/-- src/harmony/tonnetz-lattice.ts:25-26 — `pitchClassAt`. -/
def pitchClassAt (col row : Int) : Int := jsMod (jsMod (7 * col + 4 * row) 12 + 12) 12

/-- `((a % 12) + 12) % 12` in JavaScript is the mathematical residue. -/
theorem pc_eq (a : Int) : jsMod (jsMod a 12 + 12) 12 = a % 12 := by
  unfold jsMod
  have h1 := Int.mul_tdiv_add_tmod a 12
  have h2 := Int.lt_tmod_of_pos a (b := 12) (by decide)
  have h3 := Int.tmod_lt_of_pos a (b := 12) (by decide)
  rw [Int.tmod_eq_emod_of_nonneg (by omega)]
  omega

/-- src/harmony/tonnetz-lattice.ts:12-13 -/
structure Cursor where
  col : Int
  row : Int
  up : Bool

/-- src/harmony/tonnetz-lattice.ts:37-65 and 95-101 — `voiceTriad`, through
    `triadCells` and `triadPitchClasses`. -/
def voiceTriad (c : Cursor) (octave : Int) : List Int :=
  let rootPc := if c.up then pitchClassAt c.col c.row else pitchClassAt c.col (c.row + 1)
  let thirdPc := if c.up then pitchClassAt c.col (c.row + 1) else pitchClassAt (c.col + 1) c.row
  let fifthPc := if c.up then pitchClassAt (c.col + 1) c.row else pitchClassAt (c.col + 1) (c.row + 1)
  let rootMidi := (octave + 1) * 12 + rootPc
  let thirdMidi := rootMidi + jsMod (thirdPc - rootPc + 12) 12
  let fifthMidi := rootMidi + jsMod (fifthPc - rootPc + 12) 12
  sortAsc [rootMidi, thirdMidi, fifthMidi]

/-- **`voiceTriad` never repeats a pitch**, for every cursor and octave: the
    triad is root, root + 4 (or + 3), root + 7. So TonnetzState's wanted list
    satisfies the hypothesis of `trigger_exact`. -/
theorem voiceTriad_nodup (c : Cursor) (octave : Int) : (voiceTriad c octave).Nodup := by
  unfold voiceTriad pitchClassAt
  simp only [pc_eq]
  cases c.up
  · -- down: root, root + 3, root + 7
    have h3 : jsMod ((7 * (c.col + 1) + 4 * c.row) % 12 - (7 * c.col + 4 * (c.row + 1)) % 12 + 12) 12 = 3 := by
      unfold jsMod; rw [Int.tmod_eq_emod_of_nonneg (by omega)]; omega
    have h7 : jsMod ((7 * (c.col + 1) + 4 * (c.row + 1)) % 12 - (7 * c.col + 4 * (c.row + 1)) % 12 + 12) 12 = 7 := by
      unfold jsMod; rw [Int.tmod_eq_emod_of_nonneg (by omega)]; omega
    simp only [Bool.false_eq_true, ite_false, h3, h7]
    generalize (octave + 1) * 12 + (7 * c.col + 4 * (c.row + 1)) % 12 = r
    have a1 : r + 3 ≤ r + 7 := by omega
    have a2 : r ≤ r + 3 := by omega
    simp [sortAsc, insertSorted, a1, a2]
    omega
  · -- up: root, root + 4, root + 7
    have h4 : jsMod ((7 * c.col + 4 * (c.row + 1)) % 12 - (7 * c.col + 4 * c.row) % 12 + 12) 12 = 4 := by
      unfold jsMod; rw [Int.tmod_eq_emod_of_nonneg (by omega)]; omega
    have h7 : jsMod ((7 * (c.col + 1) + 4 * c.row) % 12 - (7 * c.col + 4 * c.row) % 12 + 12) 12 = 7 := by
      unfold jsMod; rw [Int.tmod_eq_emod_of_nonneg (by omega)]; omega
    simp only [ite_true, h4, h7]
    generalize (octave + 1) * 12 + (7 * c.col + 4 * c.row) % 12 = r
    have a1 : r + 4 ≤ r + 7 := by omega
    have a2 : r ≤ r + 4 := by omega
    simp [sortAsc, insertSorted, a1, a2]
    omega

/-! ## `cycleMode`, `cycleInversion`, and the octave -/

/-- perf-state.ts:136-143 — the index `(i + dir + MODES.length) % MODES.length`
    with `MODES.length = INVERSIONS.length = 3`. JavaScript `%`. -/
def cycleIndex (i dir : Int) : Int := jsMod (i + dir + 3) 3

/-- **`cycleMode` / `cycleInversion` wrap in both directions** for the steps
    every caller passes (`1` and `-1`: main.ts:1273-1274,
    gamepad-perfecto.ts:193-195): from any of the three positions the result
    is the neighbour, modulo 3. -/
theorem cycle_wraps (i dir : Int) (hi : 0 ≤ i ∧ i < 3) (hd : dir = 1 ∨ dir = -1) :
    cycleIndex i dir = (i + dir) % 3 ∧ 0 ≤ cycleIndex i dir ∧ cycleIndex i dir < 3 := by
  unfold cycleIndex jsMod
  rw [Int.tmod_eq_emod_of_nonneg (by omega)]
  omega

/-- The same, under the weakest hypothesis that makes it true: the step does
    not reach further back than one full turn. The code does not enforce it
    (`dir` is any number). -/
theorem cycle_wraps_of_ge (i dir : Int) (hd : -3 ≤ i + dir) :
    cycleIndex i dir = (i + dir) % 3 ∧ 0 ≤ cycleIndex i dir ∧ cycleIndex i dir < 3 := by
  unfold cycleIndex jsMod
  rw [Int.tmod_eq_emod_of_nonneg (by omega)]
  omega

/-- **FAILS without that hypothesis**: `cycleMode(-4)` from the first mode
    indexes `MODES[-1]`, which is `undefined`, where a wrap would give
    `MODES[2]`. No caller passes anything but ±1.
    Repro: `repro/reconcile_duplicate_voicing.ts`, section 5. -/
theorem FAILS_cycle_index_in_range_dir_neg4 :
    cycleIndex 0 (-4) = -1 ∧ (0 + -4 : Int) % 3 = 2 := by
  decide

/-- perf-state.ts:132 `setOctave` and tonnetz-state.ts:69 `nudgeOctave`:
    `Math.max(0, Math.min(8, oct))`. -/
def clampOctave (oct : Int) : Int := max 0 (min 8 oct)

/-- **The octave clamps** (tonnetz-state.test.ts:86, 91 "clamps to minimum 0",
    "clamps to maximum 8"): the result is always in 0..8, and is the argument
    itself when that already is. -/
theorem clampOctave_range (oct : Int) :
    0 ≤ clampOctave oct ∧ clampOctave oct ≤ 8 ∧ (0 ≤ oct ∧ oct ≤ 8 → clampOctave oct = oct) := by
  unfold clampOctave; omega

end Harmonicland.Reconcile
