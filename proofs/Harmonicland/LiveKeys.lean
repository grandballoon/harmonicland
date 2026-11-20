/-!
# LiveKeys — `src/live-keys.ts` together with `src/outputs/sound.ts`

"Which keys are physically sounding right now": the live voices, refcounted
per pitch, and the switchboard (`Sound`) that forwards the first audible press
and the last audible release of a pitch to exactly one `Output`.

## What the model is

One state record (`State`) holding both modules' mutable state, and one
transition per exported function, translated line by line.

* `voices: Map<Pitch, Set<Voice>>` (live-keys.ts:55) is an association list in
  insertion order, `List (Pitch × List Voice)`, with `Map.get/set/delete/keys`
  as `mget/mset/mdel/mkeys`. A `Set<Voice>` is a `List Voice`; `Set.add` and
  `Set.delete` are translated with their "already there / not there" tests.
* A `Voice` is an object whose identity IS the handle. Identity is modelled as
  a unique `id`, allocated from `State.nextId` (a ghost counter standing for
  `{ pitch }` creating a fresh object). `silent: WeakSet<Voice>` is decided at
  creation and never changed, so it is a field of the voice.
* `Sound`'s `live: Map<Pitch, number>` is the same association list; `active`
  is an output's index.
* An `Output` is a RECORDER: `State.log o` is everything output `o` has been
  told on the live path, newest first. `isOn` reads a log as "told on, without
  a later off (or detach)". `Clean` says a log never turns on what is on nor
  off what is off.

## Re-entrancy (live-keys.ts:88-91)

`press` notifies its `onPress` listeners synchronously, as its LAST act: every
write to `voices` and every call into `Sound` is finished before the first
listener runs, and nothing but `return v` follows the loop. A listener that
calls `press` / `release` / `releaseAll` / `Sound.use` from inside the callback
therefore runs those transitions from a state `press` has already completed,
and the whole nested execution is a SEQUENCE of the transitions below. That is
what `Reach` is: the states any interleaving, re-entrant or not, can produce.
The listeners themselves hold no state of this module and are not modelled.

## What the model leaves out

* The audio device, Web MIDI, the DOM: an `Output` is only what it was told.
  (`MidiOut.lean` models what a MIDI port does with it.)
* The score path of `Sound` (`strike/advance/pedal/flush`): pure forwarding to
  `active`, no state of its own. `offset`/`latency()` likewise.
* `NaN` as a pitch: pitches are `Int`.
* Listener bookkeeping (`pressSubs`, `onPress`'s unsubscribe): no claim here
  turns on who is subscribed, only on when listeners run.
-/

namespace Harmonicland.LiveKeys

abbrev Pitch := Int

/-! ## A JavaScript `Map<Pitch, β>` -/

section Map
variable {β : Type}

/-- `Map.prototype.get` -/
def mget : List (Pitch × β) → Pitch → Option β
  | [], _ => none
  | (k, b) :: m, p => if k = p then some b else mget m p

/-- `Map.prototype.set`: replace in place, or append a new key. -/
def mset : List (Pitch × β) → Pitch → β → List (Pitch × β)
  | [], p, b => [(p, b)]
  | (k, b0) :: m, p, b => if k = p then (k, b) :: m else (k, b0) :: mset m p b

/-- `Map.prototype.delete` -/
def mdel (m : List (Pitch × β)) (p : Pitch) : List (Pitch × β) :=
  m.filter (fun e => decide (e.1 ≠ p))

/-- `Map.prototype.keys` -/
def mkeys (m : List (Pitch × β)) : List Pitch := m.map (·.1)

theorem mget_mset (m : List (Pitch × β)) (p q : Pitch) (b : β) :
    mget (mset m p b) q = if p = q then some b else mget m q := by
  induction m with
  | nil => simp [mset, mget]
  | cons e m ih =>
    obtain ⟨k, b0⟩ := e
    by_cases hk : k = p
    · subst hk; simp [mset, mget]; split <;> simp_all
    · simp [mset, hk, mget, ih]; split <;> split <;> simp_all

theorem mget_mdel (m : List (Pitch × β)) (p q : Pitch) :
    mget (mdel m p) q = if p = q then none else mget m q := by
  induction m with
  | nil => simp [mdel, mget]
  | cons e m ih =>
    obtain ⟨k, b0⟩ := e
    unfold mdel at ih ⊢
    by_cases hk : k = p
    · subst hk; simp [List.filter, mget]; split <;> simp_all
    · simp [List.filter, hk, mget]; split <;> split <;> simp_all

theorem mem_mkeys (m : List (Pitch × β)) (p : Pitch) :
    p ∈ mkeys m ↔ (mget m p).isSome = true := by
  induction m with
  | nil => simp [mkeys, mget]
  | cons e m ih =>
    obtain ⟨k, b0⟩ := e
    unfold mkeys at ih ⊢
    by_cases hk : k = p
    · simp [mget, hk]
    · simp [mget, hk, ih]; intro h; exact absurd h.symm hk

theorem mkeys_mset (m : List (Pitch × β)) (p : Pitch) (b : β) :
    mkeys (mset m p b) = if (mget m p).isSome then mkeys m else mkeys m ++ [p] := by
  induction m with
  | nil => simp [mset, mget, mkeys]
  | cons e m ih =>
    obtain ⟨k, b0⟩ := e
    unfold mkeys at ih ⊢
    by_cases hk : k = p
    · simp [mset, mget, hk]
    · simp [mset, mget, hk, ih]; split <;> simp

theorem mkeys_mdel (m : List (Pitch × β)) (p : Pitch) :
    mkeys (mdel m p) = (mkeys m).filter (fun k => decide (k ≠ p)) := by
  simp [mkeys, mdel, List.filter_map, Function.comp_def]

theorem eq_nil_of_mget_none (m : List (Pitch × β)) (h : ∀ p, mget m p = none) : m = [] := by
  cases m with
  | nil => rfl
  | cons e m => obtain ⟨k, b⟩ := e; have := h k; simp [mget] at this

end Map

/-! ## The state -/

/-- src/live-keys.ts:51 — a single live press; identity is the handle. `id`
    stands for object identity, `silent` for membership of the `silent`
    WeakSet (live-keys.ts:56), fixed when the voice is made (line 83). -/
structure Voice where
  id : Nat
  pitch : Pitch
  silent : Bool
  deriving DecidableEq, Repr

/-- What an `Output` (src/types.ts:194) is told on the live path. -/
inductive Ev where
  | on (p : Pitch) (velocity : Int)
  | off (p : Pitch)
  | detach
  deriving DecidableEq, Repr

/-- Has this output been told `p` is on, with no later off or detach?
    The log is newest first. -/
def isOn : List Ev → Pitch → Bool
  | [], _ => false
  | .on q _ :: l, p => if q = p then true else isOn l p
  | .off q :: l, p => if q = p then false else isOn l p
  | .detach :: _, _ => false

/-- A log with no redundant message: never `on` for a pitch already on, never
    `off` for a pitch that is not. -/
def Clean : List Ev → Prop
  | [] => True
  | .on q _ :: l => isOn l q = false ∧ Clean l
  | .off q :: l => isOn l q = true ∧ Clean l
  | .detach :: l => Clean l

/-- live-keys.ts:55-56 and sound.ts:20-22, in one record. -/
structure State where
  /-- live-keys.ts:55 `voices` -/
  voices : List (Pitch × List Voice)
  /-- ghost: the identity the next `{ pitch }` object will have -/
  nextId : Nat
  /-- sound.ts:20 `active` -/
  active : Nat
  /-- sound.ts:22 `live` -/
  live : List (Pitch × Int)
  /-- what each output has been told, newest first -/
  log : Nat → List Ev

/-- Module load: no voices, the built-in piano (output 0) active, nothing told. -/
def init : State :=
  { voices := [], nextId := 0, active := 0, live := [], log := fun _ => [] }

/-- Call a live-path method of output `o`. -/
def tell (s : State) (o : Nat) (e : Ev) : State :=
  { s with log := fun i => if i = o then e :: s.log o else s.log i }

/-! ## `Sound` — src/outputs/sound.ts -/

/-- src/outputs/sound.ts:48-52 -/
def Sound.liveOn (s : State) (pitch : Pitch) (velocity : Int) : State :=
  if (mget s.live pitch).isSome then s
  else tell { s with live := mset s.live pitch velocity } s.active (.on pitch velocity)

/-- src/outputs/sound.ts:53-56 -/
def Sound.liveOff (s : State) (pitch : Pitch) : State :=
  if (mget s.live pitch).isSome then
    tell { s with live := mdel s.live pitch } s.active (.off pitch)
  else s

/-- src/outputs/sound.ts:25-31 -/
def Sound.use (s : State) (o : Nat) : State :=
  if o = s.active then s
  else
    let s1 := (mkeys s.live).foldl (fun s p => tell s s.active (.off p)) s
    let s2 := tell s1 s1.active .detach
    let s3 := { s2 with active := o }
    s3.live.foldl (fun s e => tell s o (.on e.1 e.2)) s3

@[simp] theorem liveOn_voices (s : State) (p : Pitch) (v : Int) :
    (Sound.liveOn s p v).voices = s.voices := by
  unfold Sound.liveOn; split <;> simp [tell]

@[simp] theorem liveOn_nextId (s : State) (p : Pitch) (v : Int) :
    (Sound.liveOn s p v).nextId = s.nextId := by
  unfold Sound.liveOn; split <;> simp [tell]

@[simp] theorem liveOff_voices (s : State) (p : Pitch) :
    (Sound.liveOff s p).voices = s.voices := by
  unfold Sound.liveOff; split <;> simp [tell]

@[simp] theorem liveOff_nextId (s : State) (p : Pitch) :
    (Sound.liveOff s p).nextId = s.nextId := by
  unfold Sound.liveOff; split <;> simp [tell]

/-! ## `LiveKeys` — src/live-keys.ts -/

/-- src/perform.ts:34 -/
def DEFAULT_VELOCITY : Int := 80

/-- src/live-keys.ts:64-67 — does any voice other than `except` sound this pitch? -/
def audibleOn (m : List (Pitch × List Voice)) (pitch : Pitch) (except : Voice) : Bool :=
  ((mget m pitch).getD []).any (fun v => decide (v ≠ except) && !v.silent)

/-- src/live-keys.ts:85-87 — `let set = voices.get(pitch); if (!set)
    voices.set(pitch, (set = new Set())); set.add(v);` -/
def addVoice (m : List (Pitch × List Voice)) (pitch : Pitch) (v : Voice) :
    List (Pitch × List Voice) :=
  let m1 := match mget m pitch with
    | some _ => m
    | none => mset m pitch []
  let set := (mget m1 pitch).getD []
  mset m1 pitch (if v ∈ set then set else set ++ [v])

/-- src/live-keys.ts:82 — `const v: Voice = { pitch }`, a fresh identity. -/
def newVoice (s : State) (pitch : Pitch) (quiet : Bool) : Voice :=
  { id := s.nextId, pitch := pitch, silent := quiet }

/-- src/live-keys.ts:83-84 — `if (quiet) silent.add(v); else if
    (!audibleOn(pitch, v)) Sound.liveOn(pitch, DEFAULT_VELOCITY);` -/
def pressSound (s : State) (pitch : Pitch) (v : Voice) : State :=
  if v.silent then s
  else if !audibleOn s.voices pitch v then Sound.liveOn s pitch DEFAULT_VELOCITY
  else s

/-- src/live-keys.ts:81-93, up to the listener loop (see the header). Returns
    the new state and the handle. -/
def press (s : State) (pitch : Pitch) (quiet : Bool) : State × Voice :=
  let v := newVoice s pitch quiet
  let s := { s with nextId := s.nextId + 1 }
  let s := pressSound s pitch v
  ({ s with voices := addVoice s.voices pitch v }, v)

/-- src/live-keys.ts:99-100, the map's half of a successful release:
    `set.delete(v)`, then `if (set.size === 0) voices.delete(v.pitch)`. -/
def removeVoice (m : List (Pitch × List Voice)) (v : Voice) (set : List Voice) :
    List (Pitch × List Voice) :=
  let set' := set.erase v
  let m := mset m v.pitch set'
  if set'.length = 0 then mdel m v.pitch else m

/-- src/live-keys.ts:97-102 -/
def release (s : State) (v : Voice) : State :=
  match mget s.voices v.pitch with
  | none => s
  | some set =>
    if v ∈ set then
      let s := { s with voices := removeVoice s.voices v set }
      if !v.silent && !audibleOn s.voices v.pitch v then Sound.liveOff s v.pitch else s
    else s

/-- src/live-keys.ts:105 -/
def isLive (s : State) (v : Voice) : Bool :=
  match mget s.voices v.pitch with
  | some set => decide (v ∈ set)
  | none => false

/-- src/live-keys.ts:107-109. `[...voices.values()]` is the Set objects there
    at the start; each one's `[...set]` is read when the outer loop reaches
    it. A Set object is found again through its key. -/
def releaseAll (s : State) : State :=
  (mkeys s.voices).foldl (fun s p => ((mget s.voices p).getD []).foldl release s) s

/-- src/live-keys.ts:111 -/
def held (s : State) : List Pitch := mkeys s.voices

/-! ## What the claims are about -/

/-- A handle LiveKeys still holds. -/
def Live (s : State) (v : Voice) : Prop :=
  ∃ S, mget s.voices v.pitch = some S ∧ v ∈ S

/-- "at least one live non-silent voice" on `p`. -/
def Audible (s : State) (p : Pitch) : Prop :=
  ∃ v, Live s v ∧ v.pitch = p ∧ v.silent = false

/-- The `voices` map is well formed: no empty Set is left under a key, a Set
    holds a voice once, a voice sits under its own pitch, and its identity was
    handed out by `press`. -/
def WF (s : State) : Prop :=
  ∀ p S, mget s.voices p = some S →
    S ≠ [] ∧ S.Nodup ∧ ∀ v ∈ S, v.pitch = p ∧ v.id < s.nextId

/-- `Sound`'s own invariant: its `live` map and what the outputs were told
    agree, only the active output has anything on, and no message was
    redundant. -/
structure SInv (s : State) : Prop where
  liveNodup : (mkeys s.live).Nodup
  on_iff : ∀ p, isOn (s.log s.active) p = true ↔ (mget s.live p).isSome = true
  clean : ∀ o, Clean (s.log o)
  others : ∀ o, o ≠ s.active → ∀ p, isOn (s.log o) p = false

/-- The whole invariant. -/
structure Inv (s : State) : Prop where
  wf : WF s
  sound : SInv s
  live_iff : ∀ p, (mget s.live p).isSome = true ↔ Audible s p

/-! ## `Sound` keeps its invariant -/

theorem SInv_liveOn {s : State} (h : SInv s) (pitch : Pitch) (velocity : Int) :
    SInv (Sound.liveOn s pitch velocity) := by
  unfold Sound.liveOn
  split
  · exact h
  · rename_i hp
    have hp' : mget s.live pitch = none := by
      cases hm : mget s.live pitch <;> simp_all
    refine ⟨?_, ?_, ?_, ?_⟩
    · simp only [tell, mkeys_mset, hp']
      have : pitch ∉ mkeys s.live := by rw [mem_mkeys]; simp [hp']
      have := h.liveNodup
      simp [List.nodup_append]
      refine ⟨this, ?_⟩
      intro a ha hb; subst hb; contradiction
    · intro p
      simp only [tell, mget_mset, ite_true, isOn]
      have := h.on_iff p
      by_cases hq : pitch = p <;> simp [hq, this]
    · intro o
      simp only [tell]
      by_cases ho : o = s.active
      · subst ho
        simp only [ite_true, Clean]
        refine ⟨?_, h.clean _⟩
        have := h.on_iff pitch
        cases hb : isOn (s.log s.active) pitch <;> simp_all
      · simp [ho]; exact h.clean o
    · intro o ho p
      have ho' : o ≠ s.active := ho
      simp only [tell, ho', ite_false]
      exact h.others o ho' p

theorem SInv_liveOff {s : State} (h : SInv s) (pitch : Pitch) :
    SInv (Sound.liveOff s pitch) := by
  unfold Sound.liveOff
  split
  · rename_i hp
    refine ⟨?_, ?_, ?_, ?_⟩
    · simp only [tell, mkeys_mdel]
      exact List.Pairwise.filter _ h.liveNodup
    · intro p
      simp only [tell, mget_mdel, ite_true, isOn]
      have := h.on_iff p
      by_cases hq : pitch = p <;> simp [hq, this]
    · intro o
      simp only [tell]
      by_cases ho : o = s.active
      · subst ho
        simp only [ite_true, Clean]
        exact ⟨(h.on_iff pitch).2 hp, h.clean _⟩
      · simp [ho]; exact h.clean o
    · intro o ho p
      have ho' : o ≠ s.active := ho
      simp only [tell, ho', ite_false]
      exact h.others o ho' p
  · exact h

/-- The loop of sound.ts:27: `for (const p of live.keys()) active.liveOff(p)`. -/
private theorem offs_fold (K : List Pitch) :
    ∀ s : State, K.Nodup → (∀ o, Clean (s.log o)) →
      (∀ p ∈ K, isOn (s.log s.active) p = true) →
      let s' := K.foldl (fun s p => tell s s.active (.off p)) s
      s'.voices = s.voices ∧ s'.live = s.live ∧ s'.active = s.active ∧ s'.nextId = s.nextId ∧
        (∀ o, Clean (s'.log o)) ∧ (∀ o, o ≠ s.active → s'.log o = s.log o) := by
  induction K with
  | nil => intro s _ hc _; simp [hc]
  | cons k K ih =>
    intro s hnd hc hon
    have hk : k ∉ K := (List.nodup_cons.1 hnd).1
    have hK : K.Nodup := (List.nodup_cons.1 hnd).2
    simp only [List.foldl_cons]
    have h1 := ih (tell s s.active (.off k)) hK
      (by
        intro o; simp only [tell]
        by_cases ho : o = s.active
        · subst ho; simp only [ite_true, Clean]; exact ⟨hon k (by simp), hc _⟩
        · simp [ho]; exact hc o)
      (by
        intro p hp
        have hne : k ≠ p := by intro h; subst h; exact hk hp
        simp only [tell, ite_true, isOn, hne, ite_false]
        exact hon p (by simp [hp]))
    obtain ⟨a, b, c, d, e, f⟩ := h1
    refine ⟨a, b, c, d, e, ?_⟩
    intro o ho
    rw [f o ho]; simp [tell, ho]

/-- The loop of sound.ts:30: `for (const [p, v] of live) o.liveOn(p, v)`. -/
private theorem ons_fold (o : Nat) (M : List (Pitch × Int)) :
    ∀ s : State, (mkeys M).Nodup → (∀ i, Clean (s.log i)) →
      (∀ p ∈ mkeys M, isOn (s.log o) p = false) →
      let s' := M.foldl (fun s e => tell s o (.on e.1 e.2)) s
      s'.voices = s.voices ∧ s'.live = s.live ∧ s'.active = s.active ∧ s'.nextId = s.nextId ∧
        (∀ i, Clean (s'.log i)) ∧ (∀ i, i ≠ o → s'.log i = s.log i) ∧
        (∀ p, isOn (s'.log o) p = true ↔ (p ∈ mkeys M ∨ isOn (s.log o) p = true)) := by
  induction M with
  | nil => intro s _ hc _; simp [hc, mkeys]
  | cons e M ih =>
    obtain ⟨k, vel⟩ := e
    intro s hnd hc hoff
    have hnd' : k ∉ mkeys M ∧ (mkeys M).Nodup := by
      simpa [mkeys, List.nodup_cons] using hnd
    simp only [List.foldl_cons]
    have h1 := ih (tell s o (.on k vel)) hnd'.2
      (by
        intro i; simp only [tell]
        by_cases hi : i = o
        · subst hi; simp only [ite_true, Clean]; exact ⟨hoff k (by simp [mkeys]), hc _⟩
        · simp [hi]; exact hc i)
      (by
        intro p hp
        have hne : k ≠ p := by intro h; subst h; exact hnd'.1 hp
        simp only [tell, ite_true, isOn, hne, ite_false]
        exact hoff p (by simp [mkeys] at hp ⊢; exact Or.inr hp))
    obtain ⟨a, b, c, d, e, f, g⟩ := h1
    refine ⟨a, b, c, d, e, ?_, ?_⟩
    · intro i hi; rw [f i hi]; simp [tell, hi]
    · intro p
      rw [g p]
      simp only [tell, ite_true, isOn, mkeys, List.map_cons, List.mem_cons]
      by_cases hkp : k = p
      · subst hkp; simp
      · have : p ≠ k := fun h => hkp h.symm
        simp [hkp, this]

/-- What `Sound.use` leaves behind, in full. -/
theorem use_spec {s : State} (h : SInv s) (o : Nat) :
    let s' := Sound.use s o
    s'.voices = s.voices ∧ s'.live = s.live ∧ s'.nextId = s.nextId ∧ s'.active = o ∧ SInv s' := by
  unfold Sound.use
  split
  · rename_i ho; subst ho; exact ⟨rfl, rfl, rfl, rfl, h⟩
  · rename_i ho
    have hoffs := offs_fold (mkeys s.live) s h.liveNodup h.clean
      (fun p hp => (h.on_iff p).2 ((mem_mkeys _ _).1 hp))
    generalize (mkeys s.live).foldl (fun s p => tell s s.active (.off p)) s = s1 at hoffs ⊢
    obtain ⟨a1, b1, c1, d1, e1, f1⟩ := hoffs
    -- after detach, and with `o` made active
    let s3 : State := { (tell s1 s1.active .detach) with active := o }
    have hs3log : ∀ i, s3.log i = if i = s.active then Ev.detach :: s1.log s.active else s1.log i := by
      intro i; simp [s3, tell, c1]
    have hclean3 : ∀ i, Clean (s3.log i) := by
      intro i; rw [hs3log]; split
      · simp only [Clean]; exact e1 _
      · exact e1 i
    have hoff3 : ∀ p ∈ mkeys s3.live, isOn (s3.log o) p = false := by
      intro p _
      rw [hs3log]; simp only [ho, ite_false]
      rw [f1 o ho]; exact h.others o ho p
    have hlive3 : s3.live = s.live := by simp [s3, tell, b1]
    have hons := ons_fold o s3.live s3 (by rw [hlive3]; exact h.liveNodup) hclean3 hoff3
    show let s' := s3.live.foldl (fun s e => tell s o (.on e.1 e.2)) s3; _
    generalize s3.live.foldl (fun s e => tell s o (.on e.1 e.2)) s3 = s4 at hons ⊢
    obtain ⟨a4, b4, c4, d4, e4, f4, g4⟩ := hons
    have hact : s4.active = o := by rw [c4]
    refine ⟨?_, ?_, ?_, hact, ?_, ?_, ?_, ?_⟩
    · rw [a4]; simp [s3, tell, a1]
    · rw [b4, hlive3]
    · rw [d4]; simp [s3, tell, d1]
    · rw [b4, hlive3]; exact h.liveNodup
    · intro p
      rw [hact, g4 p, b4, hlive3, ← mem_mkeys]
      have : isOn (s3.log o) p = false := by
        rw [hs3log]; simp only [ho, ite_false]; rw [f1 o ho]; exact h.others o ho p
      simp [this]
    · exact e4
    · intro i hi p
      rw [hact] at hi
      rw [f4 i hi, hs3log]
      split
      · simp [isOn]
      · rename_i hia
        rw [f1 i hia]; exact h.others i hia p

/-! ## Reading the `voices` map -/

theorem isLive_iff (s : State) (v : Voice) : isLive s v = true ↔ Live s v := by
  unfold isLive Live
  cases h : mget s.voices v.pitch <;> simp

theorem mem_held_iff {s : State} (hwf : WF s) (p : Pitch) :
    p ∈ held s ↔ ∃ v, Live s v ∧ v.pitch = p := by
  unfold held; rw [mem_mkeys]
  constructor
  · intro h
    cases hm : mget s.voices p with
    | none => simp [hm] at h
    | some S =>
      obtain ⟨hne, _, hall⟩ := hwf p S hm
      cases S with
      | nil => exact absurd rfl hne
      | cons v S =>
        have hv := (hall v (by simp)).1
        exact ⟨v, ⟨v :: S, by rw [hv]; exact hm, by simp⟩, hv⟩
  · rintro ⟨v, ⟨S, hS, _⟩, rfl⟩
    simp [hS]

theorem audibleOn_iff {s : State} (hwf : WF s) (p : Pitch) (ex : Voice) :
    audibleOn s.voices p ex = true ↔ ∃ v, Live s v ∧ v.pitch = p ∧ v ≠ ex ∧ v.silent = false := by
  unfold audibleOn
  rw [List.any_eq_true]
  constructor
  · rintro ⟨v, hv, hc⟩
    cases hm : mget s.voices p with
    | none => simp [hm] at hv
    | some S =>
      simp [hm] at hv
      have hp := ((hwf p S hm).2.2 v hv).1
      simp at hc
      exact ⟨v, ⟨S, by rw [hp]; exact hm, hv⟩, hp, hc.1, hc.2⟩
  · rintro ⟨v, ⟨S, hS, hv⟩, rfl, hne, hsil⟩
    exact ⟨v, by simp [hS, hv], by simp [hne, hsil]⟩

theorem mget_addVoice (m : List (Pitch × List Voice)) (pitch q : Pitch) (v : Voice) :
    mget (addVoice m pitch v) q =
      if pitch = q then
        some (if v ∈ (mget m pitch).getD [] then (mget m pitch).getD []
              else (mget m pitch).getD [] ++ [v])
      else mget m q := by
  unfold addVoice
  cases hm : mget m pitch with
  | none =>
    simp only [mget_mset, ite_true, Option.getD_some, Option.getD_none]
    by_cases hq : pitch = q <;> simp [hq]
  | some S =>
    simp only [hm, mget_mset, Option.getD_some]

/-! ## Small frame facts -/

/-- The Set under a pitch, empty when there is none (`voices.get(pitch) ?? []`). -/
def bucket (s : State) (p : Pitch) : List Voice := (mget s.voices p).getD []

theorem live_iff_bucket (s : State) (v : Voice) : Live s v ↔ v ∈ bucket s v.pitch := by
  unfold Live bucket; cases mget s.voices v.pitch <;> simp

theorem bucket_nodup {s : State} (hwf : WF s) (p : Pitch) : (bucket s p).Nodup := by
  unfold bucket
  cases hm : mget s.voices p with
  | none => simp
  | some S => simpa using (hwf p S hm).2.1

theorem SInv_congr {s s' : State} (hl : s'.live = s.live) (hg : s'.log = s.log)
    (ha : s'.active = s.active) (h : SInv s) : SInv s' := by
  refine ⟨?_, ?_, ?_, ?_⟩
  · rw [hl]; exact h.liveNodup
  · intro p; rw [hg, ha, hl]; exact h.on_iff p
  · intro o; rw [hg]; exact h.clean o
  · intro o ho p; rw [hg]; rw [ha] at ho; exact h.others o ho p

theorem WF_congr {s s' : State} (hv : s'.voices = s.voices) (hn : s'.nextId = s.nextId)
    (h : WF s) : WF s' := by
  intro p S hS; rw [hv] at hS; rw [hn]; exact h p S hS

theorem Audible_congr {s s' : State} (hv : s'.voices = s.voices) (p : Pitch) :
    Audible s' p ↔ Audible s p := by
  unfold Audible Live; rw [hv]

theorem liveOn_live_isSome (s : State) (pitch : Pitch) (vel : Int) (p : Pitch) :
    (mget (Sound.liveOn s pitch vel).live p).isSome = true ↔
      (p = pitch ∨ (mget s.live p).isSome = true) := by
  unfold Sound.liveOn
  split
  · rename_i h
    constructor
    · exact Or.inr
    · rintro (rfl | h') <;> assumption
  · simp only [tell, mget_mset]
    by_cases hq : pitch = p
    · simp [hq]
    · have : p ≠ pitch := fun e => hq e.symm
      simp [hq, this]

theorem liveOff_live_isSome (s : State) (pitch : Pitch) (p : Pitch) :
    (mget (Sound.liveOff s pitch).live p).isSome = true ↔
      (p ≠ pitch ∧ (mget s.live p).isSome = true) := by
  unfold Sound.liveOff
  split
  · simp only [tell, mget_mdel]
    by_cases hq : pitch = p
    · simp [hq]
    · have : p ≠ pitch := fun e => hq e.symm
      simp [hq, this]
  · rename_i h
    constructor
    · intro h'; exact ⟨fun e => h (e ▸ h'), h'⟩
    · exact fun h' => h'.2

@[simp] theorem pressSound_voices (s : State) (pitch : Pitch) (v : Voice) :
    (pressSound s pitch v).voices = s.voices := by
  unfold pressSound; split
  · rfl
  · split <;> simp

@[simp] theorem pressSound_nextId (s : State) (pitch : Pitch) (v : Voice) :
    (pressSound s pitch v).nextId = s.nextId := by
  unfold pressSound; split
  · rfl
  · split <;> simp

/-! ## `press` -/

section Press
variable {s : State} (pitch : Pitch) (quiet : Bool)

theorem press_handle : (press s pitch quiet).2 = newVoice s pitch quiet := rfl

theorem press_voices_eq :
    (press s pitch quiet).1.voices = addVoice s.voices pitch (newVoice s pitch quiet) := by
  simp [press]

theorem press_nextId : (press s pitch quiet).1.nextId = s.nextId + 1 := by
  simp [press]

/-- The handle `press` returns was not live before: identities are fresh. -/
theorem press_fresh (hwf : WF s) : ¬ Live s (newVoice s pitch quiet) := by
  rintro ⟨S, hS, hv⟩
  have := ((hwf _ S hS).2.2 _ hv).2
  simp [newVoice] at this

theorem bucket_press (hwf : WF s) (q : Pitch) :
    bucket (press s pitch quiet).1 q =
      if pitch = q then bucket s pitch ++ [newVoice s pitch quiet] else bucket s q := by
  have hnot : newVoice s pitch quiet ∉ (mget s.voices pitch).getD [] := by
    have := press_fresh pitch quiet hwf
    rw [live_iff_bucket] at this
    exact this
  unfold bucket
  rw [press_voices_eq, mget_addVoice]
  by_cases hq : pitch = q
  · subst hq; simp [hnot]
  · simp [hq]

/-- **live-keys.ts:48-50** "Two presses of the same pitch are two distinct
    voices", and what `press` does to the set of live handles: it adds exactly
    the one it returns. -/
theorem live_press (hwf : WF s) (w : Voice) :
    Live (press s pitch quiet).1 w ↔ (Live s w ∨ w = newVoice s pitch quiet) := by
  rw [live_iff_bucket, live_iff_bucket, bucket_press pitch quiet hwf]
  by_cases hq : pitch = w.pitch
  · simp [hq]
  · simp only [hq, ite_false]
    constructor
    · exact Or.inl
    · rintro (h | h)
      · exact h
      · exact absurd (by rw [h]; rfl) hq

theorem WF_press (hwf : WF s) : WF (press s pitch quiet).1 := by
  have hnot : newVoice s pitch quiet ∉ (mget s.voices pitch).getD [] := by
    have := press_fresh pitch quiet hwf
    rw [live_iff_bucket] at this
    exact this
  intro p S hS
  rw [press_voices_eq, mget_addVoice] at hS
  rw [press_nextId]
  by_cases hq : pitch = p
  · simp only [hq, ite_true, Option.some.injEq] at hS
    subst hq
    simp only [hnot, ite_false] at hS
    subst hS
    refine ⟨by simp, ?_, ?_⟩
    · rw [List.nodup_append]
      refine ⟨?_, by simp, ?_⟩
      · cases hm : mget s.voices pitch with
        | none => simp
        | some S0 => simpa using (hwf pitch S0 hm).2.1
      · intro a ha b hb; simp at hb; subst hb; intro e; subst e; exact hnot ha
    · intro v hv
      rcases List.mem_append.1 hv with h | h
      · cases hm : mget s.voices pitch with
        | none => simp [hm] at h
        | some S0 =>
          simp [hm] at h
          have := (hwf pitch S0 hm).2.2 v h
          exact ⟨this.1, Nat.lt_succ_of_lt this.2⟩
      · simp at h; subst h; simp [newVoice]
  · simp only [hq, ite_false] at hS
    obtain ⟨a, b, c⟩ := hwf p S hS
    exact ⟨a, b, fun v hv => ⟨(c v hv).1, Nat.lt_succ_of_lt (c v hv).2⟩⟩

theorem Inv_press (h : Inv s) : Inv (press s pitch quiet).1 := by
  have hwf' := WF_press pitch quiet h.wf
  have hlive := live_press pitch quiet h.wf
  have hfresh := press_fresh pitch quiet h.wf
  -- who is audible afterwards
  have haud : ∀ p, Audible (press s pitch quiet).1 p ↔
      (Audible s p ∨ (p = pitch ∧ quiet = false)) := by
    intro p; unfold Audible
    constructor
    · rintro ⟨w, hw, hp, hs⟩
      rcases (hlive w).1 hw with h1 | h1
      · exact Or.inl ⟨w, h1, hp, hs⟩
      · right; subst h1; simp [newVoice] at hp hs; exact ⟨hp.symm, hs⟩
    · rintro (⟨w, hw, hp, hs⟩ | ⟨rfl, hq⟩)
      · exact ⟨w, (hlive w).2 (Or.inl hw), hp, hs⟩
      · exact ⟨_, (hlive _).2 (Or.inr rfl), by simp [newVoice], by simp [newVoice, hq]⟩
  -- the state the sound half starts from, and what it leaves
  let sp : State := { s with nextId := s.nextId + 1 }
  have hsp : SInv sp := SInv_congr (s := s) (s' := sp) rfl rfl rfl h.sound
  have hwfsp : WF sp := fun p S hS =>
    let ⟨a, b, c⟩ := h.wf p S hS
    ⟨a, b, fun v hv => ⟨(c v hv).1, Nat.lt_succ_of_lt (c v hv).2⟩⟩
  have hLsp : ∀ w, Live sp w ↔ Live s w := fun w => Iff.rfl
  have hsnd : SInv (pressSound sp pitch (newVoice s pitch quiet)) ∧
      ∀ p, (mget (pressSound sp pitch (newVoice s pitch quiet)).live p).isSome = true ↔
        (Audible s p ∨ (p = pitch ∧ quiet = false)) := by
    unfold pressSound
    split
    · rename_i hsil
      have hq : quiet = true := hsil
      refine ⟨hsp, fun p => ?_⟩
      simp only [hq, Bool.true_eq_false, and_false, or_false]
      exact h.live_iff p
    · rename_i hsil
      have hq : quiet = false := by
        have : ¬ quiet = true := hsil
        simpa using this
      split
      · rename_i hna
        have hnone : ¬ Audible s pitch := by
          rintro ⟨w, hw, hp, hs⟩
          have : audibleOn sp.voices pitch (newVoice s pitch quiet) = true :=
            (audibleOn_iff hwfsp pitch _).2
              ⟨w, (hLsp w).2 hw, hp, fun e => hfresh (e ▸ hw), hs⟩
          simp [this] at hna
        refine ⟨SInv_liveOn hsp _ _, fun p => ?_⟩
        rw [liveOn_live_isSome]
        show (p = pitch ∨ (mget s.live p).isSome = true) ↔ _
        rw [h.live_iff p]
        constructor
        · rintro (rfl | h1)
          · exact Or.inr ⟨rfl, hq⟩
          · exact Or.inl h1
        · rintro (h1 | ⟨rfl, _⟩)
          · exact Or.inr h1
          · exact Or.inl rfl
      · rename_i hna
        have hal : Audible s pitch := by
          have : audibleOn sp.voices pitch (newVoice s pitch quiet) = true := by simpa using hna
          obtain ⟨w, hw, hp, _, hs⟩ := (audibleOn_iff hwfsp pitch _).1 this
          exact ⟨w, (hLsp w).1 hw, hp, hs⟩
        refine ⟨hsp, fun p => ?_⟩
        show (mget s.live p).isSome = true ↔ _
        rw [h.live_iff p]
        constructor
        · exact Or.inl
        · rintro (h1 | ⟨rfl, _⟩)
          · exact h1
          · exact hal
  exact ⟨hwf', SInv_congr (s := pressSound sp pitch (newVoice s pitch quiet))
    (s' := (press s pitch quiet).1) rfl rfl rfl hsnd.1, fun p => by rw [haud p]; exact hsnd.2 p⟩

end Press

/-! ## `release` -/

/-- **live-keys.ts:95-96** "idempotent: releasing a dead handle (one already
    lifted, or invalidated by releaseAll) does nothing". -/
theorem release_dead (s : State) (v : Voice) (h : ¬ Live s v) : release s v = s := by
  unfold release
  cases hm : mget s.voices v.pitch with
  | none => rfl
  | some S =>
    have : v ∉ S := fun hin => h ⟨S, hm, hin⟩
    simp [this]

theorem mget_removeVoice (m : List (Pitch × List Voice)) (v : Voice) (S : List Voice) (q : Pitch) :
    mget (removeVoice m v S) q =
      if v.pitch = q then (if S.erase v = [] then none else some (S.erase v)) else mget m q := by
  unfold removeVoice
  by_cases he : S.erase v = []
  · simp [he, mget_mdel, mget_mset]; split <;> simp_all
  · have : (S.erase v).length ≠ 0 := by simpa using he
    simp [this, he, mget_mset]

/-- A successful release, as the two steps it is. -/
private theorem release_live {s : State} {v : Voice} {S : List Voice}
    (hm : mget s.voices v.pitch = some S) (hv : v ∈ S) :
    release s v =
      if (!v.silent && !audibleOn (removeVoice s.voices v S) v.pitch v) = true then
        Sound.liveOff { s with voices := removeVoice s.voices v S } v.pitch
      else { s with voices := removeVoice s.voices v S } := by
  unfold release; simp [hm, hv]

private theorem release_voices_eq {s : State} {v : Voice} {S : List Voice}
    (hm : mget s.voices v.pitch = some S) (hv : v ∈ S) :
    (release s v).voices = removeVoice s.voices v S := by
  rw [release_live hm hv]; split <;> simp

private theorem release_nextId (s : State) (v : Voice) : (release s v).nextId = s.nextId := by
  by_cases hl : Live s v
  · obtain ⟨S, hm, hv⟩ := hl
    rw [release_live hm hv]; split <;> simp
  · rw [release_dead s v hl]

/-- Releasing takes `v` out of the Set under its pitch and touches no other. -/
theorem bucket_release (s : State) (v : Voice) (q : Pitch) :
    bucket (release s v) q = if v.pitch = q then (bucket s q).erase v else bucket s q := by
  by_cases hl : Live s v
  · obtain ⟨S, hm, hv⟩ := hl
    unfold bucket
    rw [release_voices_eq hm hv, mget_removeVoice]
    by_cases hq : v.pitch = q
    · subst hq
      by_cases he : S.erase v = [] <;> simp [he, hm]
    · simp [hq]
  · rw [release_dead s v hl]
    by_cases hq : v.pitch = q
    · subst hq
      rw [live_iff_bucket] at hl
      simp [List.erase_of_not_mem hl]
    · simp [hq]

/-- What `release` does to the set of live handles: it removes exactly `v`. -/
theorem live_release {s : State} (hwf : WF s) (v w : Voice) :
    Live (release s v) w ↔ (Live s w ∧ w ≠ v) := by
  rw [live_iff_bucket, live_iff_bucket, bucket_release]
  by_cases hq : v.pitch = w.pitch
  · simp only [hq, ite_true]
    rw [List.Nodup.mem_erase_iff (bucket_nodup hwf _)]
    exact And.comm
  · simp only [hq, ite_false]
    constructor
    · intro h; exact ⟨h, fun e => hq (e ▸ rfl)⟩
    · exact fun h => h.1

theorem WF_release {s : State} (hwf : WF s) (v : Voice) : WF (release s v) := by
  by_cases hl : Live s v
  · obtain ⟨S, hm, hv⟩ := hl
    obtain ⟨_, hnd, hall⟩ := hwf _ S hm
    intro p S' hS'
    rw [release_voices_eq hm hv, mget_removeVoice] at hS'
    rw [release_nextId]
    by_cases hq : v.pitch = p
    · simp only [hq, ite_true] at hS'
      by_cases he : S.erase v = []
      · simp [he] at hS'
      · simp [he] at hS'; subst hS'
        refine ⟨he, List.Nodup.erase _ hnd, ?_⟩
        intro u hu
        have := (List.Nodup.mem_erase_iff hnd).1 hu
        exact ⟨hq ▸ (hall u this.2).1, (hall u this.2).2⟩
    · simp only [hq, ite_false] at hS'
      exact hwf p S' hS'
  · rw [release_dead s v hl]; exact hwf

theorem Inv_release {s : State} (h : Inv s) (v : Voice) : Inv (release s v) := by
  by_cases hl : Live s v
  case neg => rw [release_dead s v hl]; exact h
  obtain ⟨S, hm, hv⟩ := hl
  have hwf' := WF_release h.wf v
  have hlive := live_release h.wf v
  have hveq := release_voices_eq hm hv
  -- the state between the two steps
  let s1 : State := { s with voices := removeVoice s.voices v S }
  have hs1 : SInv s1 := SInv_congr (s := s) (s' := s1) rfl rfl rfl h.sound
  have hwf1 : WF s1 := WF_congr (s := release s v) hveq.symm (release_nextId s v).symm hwf'
  have hL1 : ∀ w, Live s1 w ↔ (Live s w ∧ w ≠ v) := by
    intro w; rw [← hlive w]; unfold Live; rw [hveq]
  have haud1 : ∀ p, Audible s1 p ↔ ∃ w, Live s w ∧ w ≠ v ∧ w.pitch = p ∧ w.silent = false := by
    intro p; unfold Audible
    constructor
    · rintro ⟨w, hw, hp, hs⟩; exact ⟨w, ((hL1 w).1 hw).1, ((hL1 w).1 hw).2, hp, hs⟩
    · rintro ⟨w, hw, hne, hp, hs⟩; exact ⟨w, (hL1 w).2 ⟨hw, hne⟩, hp, hs⟩
  have hA : audibleOn s1.voices v.pitch v = true ↔ Audible s1 v.pitch := by
    rw [audibleOn_iff hwf1]; unfold Audible
    constructor
    · rintro ⟨w, hw, hp, _, hs⟩; exact ⟨w, hw, hp, hs⟩
    · rintro ⟨w, hw, hp, hs⟩; exact ⟨w, hw, hp, ((hL1 w).1 hw).2, hs⟩
  have hvlive : Live s v := ⟨S, hm, hv⟩
  rw [release_live hm hv]
  split
  · -- the last audible voice on its pitch: Sound is told
    rename_i hc
    have hc' : v.silent = false ∧ audibleOn s1.voices v.pitch v = false := by
      simpa using hc
    have hna : ¬ Audible s1 v.pitch := fun ha => by
      have := hA.2 ha; rw [hc'.2] at this; exact absurd this (by simp)
    refine ⟨WF_congr (s := s1) (liveOff_voices _ _) (liveOff_nextId _ _) hwf1,
      SInv_liveOff hs1 _, fun p => ?_⟩
    rw [liveOff_live_isSome, Audible_congr (s := s1) (liveOff_voices _ _)]
    show (p ≠ v.pitch ∧ (mget s.live p).isSome = true) ↔ _
    rw [h.live_iff p]
    constructor
    · rintro ⟨hne, w, hw, hp, hs⟩
      exact (haud1 p).2 ⟨w, hw, fun e => hne (by rw [← hp, e]), hp, hs⟩
    · intro ha
      refine ⟨fun e => hna (e ▸ ha), ?_⟩
      obtain ⟨w, hw, _, hp, hs⟩ := (haud1 p).1 ha
      exact ⟨w, hw, hp, hs⟩
  · -- silent, or another audible voice still holds the pitch
    rename_i hc
    refine ⟨hwf1, hs1, fun p => ?_⟩
    show (mget s.live p).isSome = true ↔ _
    rw [h.live_iff p, haud1 p]
    constructor
    · rintro ⟨w, hw, hp, hs⟩
      by_cases hwv : w = v
      · subst hwv
        have : audibleOn s1.voices w.pitch w = true := by
          cases hb : audibleOn s1.voices w.pitch w with
          | true => rfl
          | false =>
            have hb' : audibleOn (removeVoice s.voices w S) w.pitch w = false := hb
            exact absurd (by simp [hs, hb']) hc
        obtain ⟨u, hu, hne, hup, hus⟩ := (haud1 _).1 (hA.1 this)
        exact ⟨u, hu, hne, hup.trans hp, hus⟩
      · exact ⟨w, hw, hwv, hp, hs⟩
    · rintro ⟨w, hw, _, hp, hs⟩; exact ⟨w, hw, hp, hs⟩

/-! ## `releaseAll` -/

/-- Releasing only touches the Set under the released voice's own pitch. -/
private theorem release_other_bucket {s : State} (v : Voice) (q : Pitch)
    (hq : v.pitch ≠ q) : mget (release s v).voices q = mget s.voices q := by
  by_cases hl : Live s v
  · obtain ⟨S, hm, hv⟩ := hl
    rw [release_voices_eq hm hv, mget_removeVoice]; simp [hq]
  · rw [release_dead s v hl]

/-- The inner loop of live-keys.ts:108, over one Set's snapshot. -/
private theorem releaseSet_spec (k : Pitch) (L : List Voice) :
    ∀ s : State, Inv s → (∀ v ∈ L, v.pitch = k) →
      (∀ S, mget s.voices k = some S → ∀ v ∈ S, v ∈ L) →
      Inv (L.foldl release s) ∧ mget (L.foldl release s).voices k = none ∧
      ∀ q, q ≠ k → mget (L.foldl release s).voices q = mget s.voices q := by
  induction L with
  | nil =>
    intro s hinv _ hsub
    refine ⟨hinv, ?_, fun _ _ => rfl⟩
    cases hm : mget s.voices k with
    | none => simpa using hm
    | some S =>
      obtain ⟨hne, _, _⟩ := hinv.wf k S hm
      cases S with
      | nil => exact absurd rfl hne
      | cons v S => exact absurd (hsub _ hm v (by simp)) (by simp)
  | cons v L ih =>
    intro s hinv hk hsub
    simp only [List.foldl_cons]
    have hvk : v.pitch = k := hk v (by simp)
    have h1 := ih (release s v) (Inv_release hinv v) (fun u hu => hk u (by simp [hu]))
      (by
        intro S' hS' u hu
        have hlu : Live (release s v) u := by
          have hup := ((WF_release hinv.wf v _ S' hS').2.2 u hu).1
          exact ⟨S', by rw [hup]; exact hS', hu⟩
        obtain ⟨⟨S, hS, huS⟩, hne⟩ := (live_release hinv.wf v u).1 hlu
        have hup := ((WF_release hinv.wf v _ S' hS').2.2 u hu).1
        rw [hup] at hS
        have := hsub S hS u huS
        simp at this
        rcases this with rfl | h
        · exact absurd rfl hne
        · exact h)
    refine ⟨h1.1, h1.2.1, ?_⟩
    intro q hq
    rw [h1.2.2 q hq]
    exact release_other_bucket v q (by rw [hvk]; exact fun e => hq e.symm)

/-- The outer loop of live-keys.ts:108, over the keys there at the start. -/
private theorem releaseKeys_spec (K : List Pitch) :
    ∀ s : State, Inv s →
      let s' := K.foldl (fun s p => ((mget s.voices p).getD []).foldl release s) s
      Inv s' ∧ (∀ k ∈ K, mget s'.voices k = none) ∧
      (∀ q, mget s.voices q = none → mget s'.voices q = none) := by
  induction K with
  | nil => intro s h; exact ⟨h, by simp, fun _ h => h⟩
  | cons k K ih =>
    intro s hinv
    simp only [List.foldl_cons]
    have hset := releaseSet_spec k ((mget s.voices k).getD []) s hinv
      (by
        intro v hv
        cases hm : mget s.voices k with
        | none => simp [hm] at hv
        | some S => simp [hm] at hv; exact ((hinv.wf k S hm).2.2 v hv).1)
      (by intro S hS v hv; simp [hS, hv])
    generalize ((mget s.voices k).getD []).foldl release s = s1 at hset
    obtain ⟨hinv1, hk1, hframe⟩ := hset
    have h2 := ih s1 hinv1
    refine ⟨h2.1, ?_, ?_⟩
    · intro q hq
      simp at hq
      rcases hq with rfl | hq
      · exact h2.2.2 _ hk1
      · exact h2.2.1 q hq
    · intro q hq
      apply h2.2.2
      by_cases hqk : q = k
      · subst hqk; exact hk1
      · rw [hframe q hqk]; exact hq

theorem releaseAll_spec {s : State} (h : Inv s) :
    Inv (releaseAll s) ∧ (releaseAll s).voices = [] := by
  have := releaseKeys_spec (mkeys s.voices) s h
  refine ⟨this.1, eq_nil_of_mget_none _ ?_⟩
  intro p
  cases hm : mget s.voices p with
  | none => exact this.2.2 p hm
  | some S => exact this.2.1 p ((mem_mkeys _ _).2 (by simp [hm]))

/-! ## Every reachable state -/

/-- The states any sequence of calls can produce — including calls made by an
    `onPress` listener from inside `press` (see the header: `press` has
    finished with the state before it notifies). -/
inductive Reach : State → Prop where
  | init : Reach init
  | press {s} (pitch : Pitch) (quiet : Bool) : Reach s → Reach (press s pitch quiet).1
  | release {s} (v : Voice) : Reach s → Reach (release s v)
  | releaseAll {s} : Reach s → Reach (releaseAll s)
  | use {s} (o : Nat) : Reach s → Reach (Sound.use s o)

theorem Inv_init : Inv init := by
  refine ⟨?_, ⟨?_, ?_, ?_, ?_⟩, ?_⟩
  · intro p S h; simp [init, mget] at h
  · simp [init, mkeys]
  · intro p; simp [init, mget, isOn]
  · intro o; simp [init, Clean]
  · intro o _ p; simp [init, isOn]
  · intro p; simp only [init, mget, Option.isSome_none, Bool.false_eq_true, false_iff]
    rintro ⟨v, ⟨S, hS, _⟩, _⟩; simp [mget] at hS

theorem Inv_use {s : State} (h : Inv s) (o : Nat) : Inv (Sound.use s o) := by
  obtain ⟨hv, hl, hn, _, hs⟩ := use_spec h.sound o
  refine ⟨?_, hs, ?_⟩
  · intro p S hS; rw [hv] at hS; rw [hn]; exact h.wf p S hS
  · intro p; rw [hl, h.live_iff p]; unfold Audible Live; rw [hv]

/-- The invariant holds after ANY sequence of calls. -/
theorem Inv_of_Reach {s : State} (h : Reach s) : Inv s := by
  induction h with
  | init => exact Inv_init
  | press pitch quiet _ ih => exact Inv_press pitch quiet ih
  | release v _ ih => exact Inv_release ih v
  | releaseAll _ ih => exact (releaseAll_spec ih).1
  | use o _ ih => exact Inv_use ih o

/-! ## The claims -/

/-- **live-keys.ts:36** "The output follows the AUDIBLE voices only": after
    any sequence of press / release / releaseAll / Sound.use, the pitches the
    active Output has been told are on (liveOn without a later liveOff) are
    exactly the pitches with at least one live non-silent voice. -/
theorem output_follows_audible {s : State} (h : Reach s) (p : Pitch) :
    isOn (s.log s.active) p = true ↔ ∃ v, Live s v ∧ v.pitch = p ∧ v.silent = false := by
  have hi := Inv_of_Reach h
  rw [hi.sound.on_iff p, hi.live_iff p]; rfl

/-- **live-keys.test.ts:23** "sounds a pitch once however many voices hold it"
    and **sound.test.ts:32** "sounds a live key once however often it is asked":
    no output is ever told `on` for a pitch that is on, or `off` for one that
    is not. -/
theorem output_told_once {s : State} (h : Reach s) (o : Nat) : Clean (s.log o) :=
  (Inv_of_Reach h).sound.clean o

/-- **live-keys.ts:14-15** REFCOUNTING, "the key stops sounding only when the
    last one lifts": after a release the pitch is still on exactly when some
    OTHER live audible voice holds it. -/
theorem refcount_release {s : State} (h : Reach s) (v : Voice) (p : Pitch) :
    isOn ((release s v).log (release s v).active) p = true ↔
      ∃ w, Live s w ∧ w ≠ v ∧ w.pitch = p ∧ w.silent = false := by
  rw [output_follows_audible (Reach.release v h) p]
  have hl := live_release (Inv_of_Reach h).wf v
  constructor
  · rintro ⟨w, hw, hp, hs⟩; exact ⟨w, ((hl w).1 hw).1, ((hl w).1 hw).2, hp, hs⟩
  · rintro ⟨w, hw, hne, hp, hs⟩; exact ⟨w, (hl w).2 ⟨hw, hne⟩, hp, hs⟩

/-- **live-keys.ts:31-37** SILENT VOICES, "a pointer press on a key the mic is
    already holding still sounds", and the first-press half of refcounting:
    after a press the pitch is on exactly when it was, or this press is an
    audible one on it. -/
theorem refcount_press {s : State} (h : Reach s) (pitch : Pitch) (quiet : Bool) (p : Pitch) :
    isOn ((press s pitch quiet).1.log (press s pitch quiet).1.active) p = true ↔
      (isOn (s.log s.active) p = true ∨ (p = pitch ∧ quiet = false)) := by
  rw [output_follows_audible (Reach.press pitch quiet h) p, output_follows_audible h p]
  have hl := live_press pitch quiet (Inv_of_Reach h).wf
  constructor
  · rintro ⟨w, hw, hp, hs⟩
    rcases (hl w).1 hw with h1 | h1
    · exact Or.inl ⟨w, h1, hp, hs⟩
    · subst h1; simp [newVoice] at hp hs; exact Or.inr ⟨hp.symm, hs⟩
  · rintro (⟨w, hw, hp, hs⟩ | ⟨rfl, hq⟩)
    · exact ⟨w, (hl w).2 (Or.inl hw), hp, hs⟩
    · exact ⟨_, (hl _).2 (Or.inr rfl), by simp [newVoice], by simp [newVoice, hq]⟩

/-- **live-keys.ts:16-18** "releaseAll() from anywhere invalidates every
    outstanding handle", and with it the output: nothing is live, nothing is
    held, and the active output has been told every pitch is off. -/
theorem releaseAll_invalidates {s : State} (h : Reach s) :
    (∀ v, isLive (releaseAll s) v = false) ∧ held (releaseAll s) = [] ∧
      ∀ p, isOn ((releaseAll s).log (releaseAll s).active) p = false := by
  have hnil := (releaseAll_spec (Inv_of_Reach h)).2
  refine ⟨?_, ?_, ?_⟩
  · intro v; simp [isLive, hnil, mget]
  · simp [held, hnil, mkeys]
  · intro p
    cases hb : isOn ((releaseAll s).log (releaseAll s).active) p with
    | false => rfl
    | true =>
      obtain ⟨v, ⟨S, hS, _⟩, _⟩ := (output_follows_audible (Reach.releaseAll h) p).1 hb
      simp [hnil, mget] at hS

/-- **live-keys.ts:111 / 5** `held()` is exactly the pitches with a live
    voice, silent ones included ("A voice pressed with { silent: true } is
    held, glows"). -/
theorem held_iff {s : State} (h : Reach s) (p : Pitch) :
    p ∈ held s ↔ ∃ v, isLive s v = true ∧ v.pitch = p := by
  rw [mem_held_iff (Inv_of_Reach h).wf]
  constructor
  · rintro ⟨v, hv, hp⟩; exact ⟨v, (isLive_iff s v).2 hv, hp⟩
  · rintro ⟨v, hv, hp⟩; exact ⟨v, (isLive_iff s v).1 hv, hp⟩

/-- **live-keys.ts:88-89** "a listener that reads held() synchronously sees
    this press already in it" (test: "sees the press already in held()"): in
    the state the listeners are called from, the new handle is live and its
    pitch is held. -/
theorem press_visible_to_listeners {s : State} (h : Reach s) (pitch : Pitch) (quiet : Bool) :
    isLive (press s pitch quiet).1 (press s pitch quiet).2 = true ∧
      pitch ∈ held (press s pitch quiet).1 := by
  have hl : Live (press s pitch quiet).1 (press s pitch quiet).2 :=
    (live_press pitch quiet (Inv_of_Reach h).wf _).2 (Or.inr rfl)
  refine ⟨(isLive_iff _ _).2 hl, ?_⟩
  exact (mem_held_iff (Inv_of_Reach (Reach.press pitch quiet h)).wf pitch).2
    ⟨_, hl, rfl⟩

/-- **live-keys.test.ts:103** "distinguishes two voices on the same pitch":
    a press never hands back a handle that is already live. -/
theorem press_new_handle {s : State} (h : Reach s) (pitch : Pitch) (quiet : Bool) :
    isLive s (press s pitch quiet).2 = false := by
  cases hb : isLive s (press s pitch quiet).2 with
  | false => rfl
  | true => exact absurd ((isLive_iff _ _).1 hb) (press_fresh pitch quiet (Inv_of_Reach h).wf)

/-- **live-keys.test.ts:41** "ignores a double release of the same voice". -/
theorem release_idempotent {s : State} (h : Reach s) (v : Voice) :
    release (release s v) v = release s v := by
  apply release_dead
  intro hl
  exact ((live_release (Inv_of_Reach h).wf v v).1 hl).2 rfl

/-- **sound.ts:11-13** "Switching hands over what the user's hands are
    holding: the old output lets go of its live keys and the new one takes
    them up, so a chord held across the switch keeps sounding" — the new
    output is told on for exactly the audible pitches, and the handles are
    untouched. -/
theorem use_hands_over {s : State} (h : Reach s) (o : Nat) (p : Pitch) :
    (isOn ((Sound.use s o).log o) p = true ↔ ∃ v, Live s v ∧ v.pitch = p ∧ v.silent = false) ∧
      (∀ v, isLive (Sound.use s o) v = isLive s v) := by
  obtain ⟨hv, _, _, ha, _⟩ := use_spec (Inv_of_Reach h).sound o
  constructor
  · have := output_follows_audible (Reach.use o h) p
    rw [ha] at this
    rw [this]; unfold Live; rw [hv]
  · intro v; unfold isLive; rw [hv]

/-- **sound.ts:3-5** "there is one `active`, so the piano and a synth can
    never both sound a note": on the live path, after any sequence of calls,
    every output but the active one has been told all its keys are off. -/
theorem exclusive {s : State} (h : Reach s) (o : Nat) (ho : o ≠ s.active) (p : Pitch) :
    isOn (s.log o) p = false :=
  (Inv_of_Reach h).sound.others o ho p

end Harmonicland.LiveKeys
