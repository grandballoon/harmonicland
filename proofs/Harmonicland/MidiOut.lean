/-!
# MidiOut — `src/outputs/midi-out.ts`, and the voice registry of `src/outputs/audio.ts`

An `Output` (src/types.ts:190-213) has two paths "that never touch each
other": the SCORE path (`strike` / `advance` / `flush`), driven ahead of time
by the scheduler, and the LIVE path (`liveOn` / `liveOff`), driven by the
user's hands. This file models the MIDI port's Output in full and the
built-in piano's bookkeeping of which voice belongs to which path.

## What the model is

* `MO` is one port's closure state (midi-out.ts:106-107): `sent`, `held`, and
  — standing for the synth on the other end — `wire`, every message handed to
  `port.send`, OLDEST FIRST, each with the timestamp it was sent with.
* A message records which path sent it (`Path`). That tag is a ghost: the
  bytes are the same (`bytes`), which is the point of several results below.
* `performance.now()` is an argument (`now`) of the transitions that read it.
* `advance`'s first loop (midi-out.ts:125-129) sends and marks each due entry
  in order; it is written here as "the due entries' note-offs, in order" and
  "every due entry marked", which is that loop with no state carried between
  its turns. Its second loop (line 132), a backwards `splice`, is a filter.
* WHAT A SYNTH DOES WITH THE WIRE. Results about a note being "answered" use
  only this: a note-off for key `p`, sent after a note-on for key `p` and
  stamped no earlier, ends it. Results named `…_touch…`/`…live_alone…` use
  MIDI 1.0's reading that a key is one note: a note-off for key `p` on the
  channel releases key `p`, whoever pressed it (every message here is on
  channel 1, midi-out.ts:35). A synth that instead stacks a voice per note-on
  and pops one per note-off would not show those failures; hardware pianos
  and most soft synths do not stack.

## What the model leaves out

* Floating point; `NaN`. Times are `Rat`, pitches and velocities `Int`.
* `Math.exp`: `resumedVelocity`'s decay factor `exp(-offset / 1.5)` is an
  argument (`e`).
* The port itself: a real `MIDIOutput.send` throws on a data byte above 127
  and midi-out.ts:111-115 swallows the throw; here every message reaches the
  wire, as with the fake port of midi-out.test.ts.
* Port discovery, permissions, `outputs` (one Output per port), `latency()`.
* For audio.ts: samples, gains, the room, the two clocks, and every time
  constant. Only the registry (`voices`, `live`) and who is silenced by what.
* Names Lean reserves: `at` is `time`.
-/

namespace Harmonicland.MidiOut

abbrev Pitch := Int

/-! ## The wire -/

/-- Which path sent a message. A ghost: it is not on the wire. -/
inductive Path where
  | score | live
  deriving DecidableEq, Repr

/-- One `port.send(bytes, stamp)`. `stamp = none` is "now" (the argument
    omitted). -/
inductive Msg where
  | on (pitch : Pitch) (vel : Int) (stamp : Option Rat) (path : Path)
  | off (pitch : Pitch) (stamp : Option Rat) (path : Path)
  | cc (controller value : Int) (stamp : Option Rat)
  deriving DecidableEq, Repr

/-- midi-out.ts:41-47 — `encode` and `control`: the three bytes. -/
def bytes : Msg → List Int
  | .on pitch vel _ _ => [0x90, pitch, vel]
  | .off pitch _ _ => [0x80, pitch, 0]
  | .cc controller value _ => [0xb0, controller, value]

/-! ## The state -/

/-- src/types.ts:172-188, the fields midi-out reads (`damp` is ignored,
    midi-out.ts:26). -/
structure Strike where
  pitch : Pitch
  velocity : Int
  time : Rat
  off : Option Rat
  offset : Option Rat
  deriving DecidableEq, Repr

/-- midi-out.ts:91-97 -/
structure Sent where
  pitch : Pitch
  time : Rat
  off : Option Rat
  offSent : Bool
  deriving DecidableEq, Repr

/-- midi-out.ts:106-107, and the wire. -/
structure MO where
  /-- "score notes struck and not yet known to be over" -/
  sent : List Sent
  /-- "live keys down" -/
  held : List Pitch
  /-- everything handed to `port.send`, oldest first -/
  wire : List Msg
  deriving DecidableEq, Repr

def init : MO := { sent := [], held := [], wire := [] }

/-- midi-out.ts:109-116 — `send`. -/
def send (m : MO) (msg : Msg) : MO := { m with wire := m.wire ++ [msg] }

/-! ## `resumedVelocity` — midi-out.ts:52-53 -/

/-- `Math.round` -/
def jsRound (x : Rat) : Int := (x + 1 / 2).floor

/-- midi-out.ts:52-53, with `e` standing for `Math.exp(-offset / 1.5)`. -/
def resumedVelocity (e : Rat) (velocity : Int) : Int :=
  max 1 (jsRound (velocity * max (35 / 100) e))

/-- midi-out.ts:119 — `s.offset ? resumedVelocity(s.velocity, s.offset) :
    s.velocity`. `decay o` is `Math.exp(-o / 1.5)`. -/
def velOf (decay : Rat → Rat) (s : Strike) : Int :=
  match s.offset with
  | some o => if o ≠ 0 then resumedVelocity (decay o) s.velocity else s.velocity
  | none => s.velocity

/-! ## The Output — midi-out.ts:118-165 -/

section Output
variable (decay : Rat → Rat)

/-- midi-out.ts:118-122 -/
def strike (m : MO) (s : Strike) : MO :=
  let m := send m (.on s.pitch (velOf decay s) (some s.time) .score)
  { m with sent := m.sent ++ [{ pitch := s.pitch, time := s.time, off := s.off, offSent := false }] }

end Output

/-- midi-out.ts:126 — the entries `advance(until)` does NOT skip. -/
def due (upTo : Rat) (n : Sent) : Bool :=
  !(n.offSent || (match n.off with | none => true | some o => decide (o > upTo)))

/-- midi-out.ts:132 — `sent[i].offSent && sent[i].off! <= now`. -/
def over (now : Rat) (n : Sent) : Bool :=
  n.offSent && (match n.off with | some o => decide (o ≤ now) | none => false)

/-- midi-out.ts:124-133 -/
def advance (m : MO) (upTo now : Rat) : MO :=
  let msgs := (m.sent.filter (due upTo)).map (fun n => Msg.off n.pitch n.off .score)
  let sent1 := m.sent.map (fun n => if due upTo n then { n with offSent := true } else n)
  { m with wire := m.wire ++ msgs, sent := sent1.filter (fun n => !over now n) }

/-- midi-out.ts:137 — `(n.off ?? Infinity) > now`. -/
def stillOn (now : Rat) (n : Sent) : Bool :=
  match n.off with | none => true | some o => decide (o > now)

/-- midi-out.ts:135-140 -/
def flush (m : MO) (now : Rat) : MO :=
  { m with
    wire := m.wire ++
      (m.sent.filter (stillOn now)).map (fun n => Msg.off n.pitch (some (max now n.time)) .score)
      ++ [Msg.cc 64 0 none],
    sent := [] }

/-- midi-out.ts:145 -/
def pedal (m : MO) (down : Bool) (time : Rat) : MO :=
  send m (.cc 64 (if down then 127 else 0) (some time))

/-- midi-out.ts:148-152 -/
def liveOn (m : MO) (pitch : Pitch) (velocity : Int) : MO :=
  if pitch ∈ m.held then m
  else send { m with held := m.held ++ [pitch] } (.on pitch velocity none .live)

/-- midi-out.ts:153-156 -/
def liveOff (m : MO) (pitch : Pitch) : MO :=
  if pitch ∈ m.held then
    send { m with held := m.held.filter (fun q => decide (q ≠ pitch)) } (.off pitch none .live)
  else m

/-- midi-out.ts:159-164 -/
def detach (m : MO) (now : Rat) : MO :=
  let m := flush m now
  { m with wire := m.wire ++ m.held.map (fun p => Msg.off p none .live) ++ [Msg.cc 123 0 none],
           held := [] }

/-! ## "No stuck notes" -/

/-- Is there, among these messages, a score note-off for key `p` stamped at
    or after `a`? -/
def hasOff (l : List Msg) (p : Pitch) (a : Rat) : Bool :=
  l.any (fun msg => match msg with
    | .off q (some t) .score => decide (q = p) && decide (a ≤ t)
    | _ => false)

/-- The score note-ons on the wire that nothing sent after them has ended:
    each as (key, the time it sounds). -/
def openOns : List Msg → List (Pitch × Rat)
  | [] => []
  | .on p _ (some a) .score :: rest =>
    (if hasOff rest p a then [] else [(p, a)]) ++ openOns rest
  | _ :: rest => openOns rest

/-- Every score note-on on the wire is matched by a note-off for its key,
    sent after it and stamped no earlier: the synth is left with no score
    note sounding. -/
def Answered (wire : List Msg) : Prop := openOns wire = []

instance (wire : List Msg) : Decidable (Answered wire) := by unfold Answered; exact inferInstance

theorem hasOff_append (l1 l2 : List Msg) (p : Pitch) (a : Rat) :
    hasOff (l1 ++ l2) p a = (hasOff l1 p a || hasOff l2 p a) := by
  simp [hasOff]

theorem hasOff_of_mem {l : List Msg} {p : Pitch} {a t : Rat}
    (hm : Msg.off p (some t) .score ∈ l) (h : a ≤ t) : hasOff l p a = true := by
  unfold hasOff
  rw [List.any_eq_true]
  exact ⟨_, hm, by simp [h]⟩

/-- An on still open after more messages are appended was open before and is
    not ended by the new messages — or is one of the new messages. -/
theorem mem_openOns_append (w extra : List Msg) (p : Pitch) (a : Rat)
    (h : (p, a) ∈ openOns (w ++ extra)) :
    ((p, a) ∈ openOns w ∧ hasOff extra p a = false) ∨ (p, a) ∈ openOns extra := by
  induction w with
  | nil => right; simpa using h
  | cons msg w ih =>
    cases msg with
    | on q vel stamp path =>
      cases stamp with
      | none => simp only [List.cons_append, openOns] at h ⊢; exact ih h
      | some b =>
        cases path with
        | live => simp only [List.cons_append, openOns] at h ⊢; exact ih h
        | score =>
          simp only [List.cons_append, openOns, List.mem_append] at h ⊢
          rcases h with h | h
          · rw [hasOff_append] at h
            by_cases h1 : hasOff w q b = true
            · simp [h1] at h
            · by_cases h2 : hasOff extra q b = true
              · simp [h2] at h
              · have h1' : hasOff w q b = false := by simpa using h1
                have h2' : hasOff extra q b = false := by simpa using h2
                simp only [h1', h2', Bool.or_self, Bool.false_eq_true, ite_false,
                  List.mem_singleton, Prod.mk.injEq] at h
                obtain ⟨rfl, rfl⟩ := h
                left; exact ⟨Or.inl (by simp [h1']), h2'⟩
          · rcases ih h with ⟨h3, h4⟩ | h3
            · left; exact ⟨Or.inr h3, h4⟩
            · right; exact h3
    | off q stamp path => simp only [List.cons_append, openOns] at h ⊢; exact ih h
    | cc c v stamp => simp only [List.cons_append, openOns] at h ⊢; exact ih h

/-- Note-offs and control changes open nothing. -/
theorem openOns_offs (l : List Sent) (f : Sent → Msg)
    (hf : ∀ n, (∃ p t path, f n = Msg.off p t path)) : openOns (l.map f) = [] := by
  induction l with
  | nil => rfl
  | cons n l ih =>
    obtain ⟨p, t, path, h⟩ := hf n
    simp [openOns, h, ih]

/-- The bookkeeping invariant: every score note-on still open on the wire is
    remembered in `sent`, with its note-off not yet on its way; and every
    remembered note ends no earlier than it starts. -/
structure Inv (m : MO) : Prop where
  tracked : ∀ p a, (p, a) ∈ openOns m.wire →
    ∃ n ∈ m.sent, n.pitch = p ∧ n.time = a ∧ n.offSent = false
  ordered : ∀ n ∈ m.sent, ∀ o, n.off = some o → n.time ≤ o

theorem Inv_init : Inv init := ⟨by simp [init, openOns], by simp [init]⟩

/-- A strike whose key-up is not before its key-down. The scheduler only
    makes such strikes (scheduler.ts:79-91, 107, 112); midi-out does not check. -/
def WFStrike (s : Strike) : Prop := ∀ o, s.off = some o → s.time ≤ o

theorem Inv_strike (decay : Rat → Rat) {m : MO} (h : Inv m) (s : Strike) (hs : WFStrike s) :
    Inv (strike decay m s) := by
  constructor
  · intro p a hpa
    simp only [strike, send] at hpa ⊢
    rcases mem_openOns_append _ _ p a hpa with ⟨h1, _⟩ | h1
    · obtain ⟨n, hn, h2⟩ := h.tracked p a h1
      exact ⟨n, List.mem_append.2 (Or.inl hn), h2⟩
    · simp [openOns, hasOff] at h1
      exact ⟨⟨s.pitch, s.time, s.off, false⟩, List.mem_append.2 (Or.inr (by simp)),
        h1.1.symm, h1.2.symm, rfl⟩
  · intro n hn o ho
    simp only [strike, send, List.mem_append, List.mem_singleton] at hn
    rcases hn with hn | rfl
    · exact h.ordered n hn o ho
    · exact hs o ho

theorem due_iff (upTo : Rat) (n : Sent) :
    due upTo n = true ↔ (n.offSent = false ∧ ∃ o, n.off = some o ∧ o ≤ upTo) := by
  unfold due
  cases hoff : n.off with
  | none => simp
  | some o =>
    cases n.offSent <;> simp [Rat.not_lt]

theorem Inv_advance {m : MO} (h : Inv m) (upTo now : Rat) : Inv (advance m upTo now) := by
  constructor
  · intro p a hpa
    simp only [advance] at hpa ⊢
    rcases mem_openOns_append _ _ p a hpa with ⟨h1, h2⟩ | h1
    · obtain ⟨n, hn, hp, ha, hns⟩ := h.tracked p a h1
      by_cases hd : due upTo n = true
      · -- its note-off has just been sent: it is no longer open
        exfalso
        obtain ⟨_, o, ho, _⟩ := (due_iff upTo n).1 hd
        have hmem : Msg.off p (some o) .score ∈
            (m.sent.filter (due upTo)).map (fun n => Msg.off n.pitch n.off .score) :=
          List.mem_map.2 ⟨n, List.mem_filter.2 ⟨hn, hd⟩, by rw [hp, ho]⟩
        have := hasOff_of_mem (a := a) hmem (by rw [← ha]; exact h.ordered n hn o ho)
        rw [this] at h2; exact absurd h2 (by simp)
      · refine ⟨n, ?_, hp, ha, hns⟩
        rw [List.mem_filter]
        refine ⟨List.mem_map.2 ⟨n, hn, by simp [hd]⟩, ?_⟩
        simp [over, hns]
    · rw [openOns_offs _ _ (fun n => ⟨_, _, _, rfl⟩)] at h1
      exact absurd h1 (by simp)
  · intro n hn o ho
    simp only [advance, List.mem_filter, List.mem_map] at hn
    obtain ⟨⟨n0, hn0, rfl⟩, _⟩ := hn
    by_cases hd : due upTo n0 = true
    · simp only [hd, ite_true] at ho ⊢
      exact h.ordered n0 hn0 o ho
    · simp only [hd, Bool.false_eq_true, ite_false] at ho ⊢
      exact h.ordered n0 hn0 o ho

theorem openOns_snoc_cc (w : List Msg) (c v : Int) (stamp : Option Rat) (p : Pitch) (a : Rat)
    (h : (p, a) ∈ openOns (w ++ [Msg.cc c v stamp])) : (p, a) ∈ openOns w := by
  rcases mem_openOns_append _ _ p a h with ⟨h1, _⟩ | h1
  · exact h1
  · simp [openOns] at h1

/-- Has `advance` kept up with the wall clock? Every remembered note whose
    note-off has not been sent is still to end, as of `now`. -/
def KeptUp (m : MO) (now : Rat) : Prop :=
  ∀ n ∈ m.sent, n.offSent = false → ∀ o, n.off = some o → now < o

/-- **midi-out.ts:19-20** "flush() sends a note-off for every note it has
    struck"; **SPEC_playback.md:284** "Flush … sends note-off for every note
    it has sent a note-on for"; **types.ts:204** "Silence the score path —
    sounding notes and anything scheduled but not yet heard". HOLDS ONLY UNDER
    A HYPOTHESIS THE CODE DOES NOT ENFORCE: `advance` has kept up with the
    clock (`hk`) — no remembered note's end has gone by, in wall time, with
    its note-off still unsent. Then after `flush` no score note is left
    sounding and nothing is remembered. Without it:
    `FAILS_flush_ends_every_struck_note`. -/
theorem flush_no_stuck {m : MO} (h : Inv m) (now : Rat) (hk : KeptUp m now) :
    Answered (flush m now).wire ∧ (flush m now).sent = [] := by
  refine ⟨?_, rfl⟩
  unfold Answered
  cases hopen : openOns (flush m now).wire with
  | nil => rfl
  | cons pa rest =>
    exfalso
    obtain ⟨p, a⟩ := pa
    have hpa : (p, a) ∈ openOns (flush m now).wire := by rw [hopen]; simp
    simp only [flush] at hpa
    have hpa' := openOns_snoc_cc _ _ _ _ _ _ hpa
    rcases mem_openOns_append _ _ p a hpa' with ⟨h1, h2⟩ | h1
    · obtain ⟨n, hn, hp, ha, hns⟩ := h.tracked p a h1
      have hstill : stillOn now n = true := by
        unfold stillOn
        cases ho : n.off with
        | none => rfl
        | some o => simpa using hk n hn hns o ho
      have hmem : Msg.off p (some (max now n.time)) .score ∈
          (m.sent.filter (stillOn now)).map
            (fun n => Msg.off n.pitch (some (max now n.time)) .score) :=
        List.mem_map.2 ⟨n, List.mem_filter.2 ⟨hn, hstill⟩, by rw [hp]⟩
      have := hasOff_of_mem (a := a) hmem (by rw [← ha]; grind)
      rw [this] at h2; exact absurd h2 (by simp)
    · rw [openOns_offs _ _ (fun n => ⟨_, _, _, rfl⟩)] at h1
      exact absurd h1 (by simp)

theorem Inv_flush (m : MO) (now : Rat) (hk : KeptUp m now) (h : Inv m) : Inv (flush m now) := by
  have := (flush_no_stuck h now hk).1
  unfold Answered at this
  exact ⟨by intro p a hpa; rw [this] at hpa; simp at hpa, by simp [flush]⟩

/-- When the hypothesis holds: right after an `advance(until)`, for any `now`
    the window had already reached (the scheduler's `until` is `now + 100ms`,
    scheduler.ts:139-144). So a `flush` within the lookahead of the last tick
    leaves nothing sounding. -/
theorem keptUp_after_advance (m : MO) (upTo now0 now : Rat) (hle : now ≤ upTo) :
    KeptUp (advance m upTo now0) now := by
  intro n hn hns o ho
  simp only [advance, List.mem_filter, List.mem_map] at hn
  obtain ⟨⟨n0, hn0, rfl⟩, _⟩ := hn
  by_cases hd : due upTo n0 = true
  · simp [hd] at hns
  · simp only [hd, Bool.false_eq_true, ite_false] at hns ho
    have : ¬ (n0.offSent = false ∧ ∃ o, n0.off = some o ∧ o ≤ upTo) :=
      fun hc => hd ((due_iff upTo n0).2 hc)
    have h3 : ¬ o ≤ upTo := fun hc => this ⟨hns, o, ho, hc⟩
    have := Rat.not_le.1 h3
    grind

/-- Sending anything but a score note-on opens nothing. -/
theorem Inv_send {m : MO} (h : Inv m) (msg : Msg) (hmsg : openOns [msg] = []) :
    Inv (send m msg) := by
  refine ⟨?_, h.ordered⟩
  intro p a hpa
  simp only [send] at hpa
  rcases mem_openOns_append _ _ p a hpa with ⟨h1, _⟩ | h1
  · exact h.tracked p a h1
  · rw [hmsg] at h1; simp at h1

theorem Inv_held {m : MO} (h : Inv m) (held : List Pitch) : Inv { m with held := held } :=
  ⟨h.tracked, h.ordered⟩

theorem Inv_liveOn {m : MO} (h : Inv m) (p : Pitch) (v : Int) : Inv (liveOn m p v) := by
  unfold liveOn; split
  · exact h
  · exact Inv_send (Inv_held h _) _ rfl

theorem Inv_liveOff {m : MO} (h : Inv m) (p : Pitch) : Inv (liveOff m p) := by
  unfold liveOff; split
  · exact Inv_send (Inv_held h _) _ rfl
  · exact h

theorem Inv_pedal {m : MO} (h : Inv m) (down : Bool) (t : Rat) : Inv (pedal m down t) :=
  Inv_send h _ rfl

/-- Every state a port's Output can be driven into by well-formed strikes,
    provided each `flush` (and `detach`, which flushes) came while `advance`
    had kept up with the clock. -/
inductive Reach (decay : Rat → Rat) : MO → Prop where
  | init : Reach decay init
  | strike {m} (s : Strike) : Reach decay m → WFStrike s → Reach decay (strike decay m s)
  | advance {m} (upTo now : Rat) : Reach decay m → Reach decay (advance m upTo now)
  | flush {m} (now : Rat) : Reach decay m → KeptUp m now → Reach decay (flush m now)
  | pedal {m} (down : Bool) (t : Rat) : Reach decay m → Reach decay (pedal m down t)
  | liveOn {m} (p : Pitch) (v : Int) : Reach decay m → Reach decay (liveOn m p v)
  | liveOff {m} (p : Pitch) : Reach decay m → Reach decay (liveOff m p)

theorem Inv_of_Reach {decay : Rat → Rat} {m : MO} (h : Reach decay m) : Inv m := by
  induction h with
  | init => exact Inv_init
  | strike s _ hs ih => exact Inv_strike decay ih s hs
  | advance upTo now _ ih => exact Inv_advance ih upTo now
  | flush now _ hk ih => exact Inv_flush _ now hk ih
  | pedal down t _ ih => exact Inv_pedal ih down t
  | liveOn p v _ ih => exact Inv_liveOn ih p v
  | liveOff p _ ih => exact Inv_liveOff ih p

/-- **No stuck notes**, after any such sequence of calls: every score
    note-on ever sent has been answered by a note-off, or is still remembered
    in `sent` with its note-off owed — so the next `flush` that finds
    `advance` kept up (or the `advance` that reaches the note's end) ends it. -/
theorem no_stuck_notes {decay : Rat → Rat} {m : MO} (h : Reach decay m) (now : Rat)
    (hk : KeptUp m now) : Answered (flush m now).wire :=
  (flush_no_stuck (Inv_of_Reach h) now hk).1

/-- One strike, a tick that does not reach its end, then a long silence from
    the ticker, then `flush` — a seek, a pause, a new score. -/
def exLateFlush : MO :=
  flush (advance (strike (fun _ => 1) init ⟨60, 70, 1050, some 1500, none⟩) 1100 1000) 2000

/-- **FAILS — "flush() sends a note-off for every note it has struck"**
    (midi-out.ts:19-20; SPEC_playback.md:284; types.ts:204 "Silence the score
    path"). A note struck at 1050 to end at 1500; `advance(1100)` holds its
    note-off back, as designed; no further `advance` arrives before wall time
    2000, when `flush` runs. Line 137 tests `(n.off ?? Infinity) > now`,
    which is false — the note "should" be over — so no note-off is sent, and
    line 138 forgets the note. The wire holds its note-on and no note-off for
    key 60, ever: the synth is left sounding it.
    Repro: `repro/midi_out.ts`, section 1. -/
theorem FAILS_flush_ends_every_struck_note :
    exLateFlush.wire = [Msg.on 60 70 (some 1050) .score, Msg.cc 64 0 none] ∧
      ¬ Answered exLateFlush.wire ∧ exLateFlush.sent = [] := by
  decide

/-- **types.ts:196-198** "An Output that cannot recall what it sends (MIDI)
    holds anything later — a long note's note-off — until the scheduler's
    window reaches it"; **midi-out.ts:16-18**; test "holds the note-off back
    until the scheduler's window reaches it". `advance(until)` sends exactly
    the note-offs of the remembered notes that end by `until` and have not
    had one sent, each stamped with the note's own end — so nothing is sent
    stamped later than `until`, and every such note gets its off. -/
theorem advance_sends_exactly_the_due (m : MO) (upTo now : Rat) :
    ∃ pre, (advance m upTo now).wire = m.wire ++ pre ∧
      (∀ msg ∈ pre, ∃ p o, msg = Msg.off p (some o) .score ∧ o ≤ upTo) ∧
      (∀ n ∈ m.sent, n.offSent = false → ∀ o, n.off = some o → o ≤ upTo →
        Msg.off n.pitch (some o) .score ∈ pre) := by
  refine ⟨(m.sent.filter (due upTo)).map (fun n => Msg.off n.pitch n.off .score), rfl, ?_, ?_⟩
  · intro msg hmsg
    obtain ⟨n, hn, rfl⟩ := List.mem_map.1 hmsg
    obtain ⟨_, o, ho, hle⟩ := (due_iff upTo n).1 (List.mem_filter.1 hn).2
    exact ⟨n.pitch, o, by rw [ho], hle⟩
  · intro n hn hns o ho hle
    exact List.mem_map.2
      ⟨n, List.mem_filter.2 ⟨hn, (due_iff upTo n).2 ⟨hns, o, ho, hle⟩⟩, by rw [ho]⟩

/-- **midi-out.test.ts:70-80** "sent once": a second `advance` to the same
    window sends nothing more. -/
theorem advance_sends_once (m : MO) (upTo now now' : Rat) :
    (advance (advance m upTo now) upTo now').wire = (advance m upTo now).wire := by
  have hnone : (advance m upTo now).sent.filter (due upTo) = [] := by
    rw [List.filter_eq_nil_iff]
    intro n hn
    simp only [advance, List.mem_filter, List.mem_map] at hn
    obtain ⟨⟨n0, _, rfl⟩, _⟩ := hn
    by_cases hd : due upTo n0 = true
    · simp only [hd, ite_true]; simp [due]
    · simp only [hd, Bool.false_eq_true, ite_false]; exact fun h => h
  show (advance m upTo now).wire ++
      ((advance m upTo now).sent.filter (due upTo)).map _ = _
  rw [hnone]; simp

/-- **types.ts:178-179** a strike with no `off` is "held until the next
    flush" (test: "flush ends a held strike (a parked step) that has no off
    of its own"): no `advance`, however far, sends its note-off or forgets
    it; `flush` sends it, stamped now — or at the note's own time if that is
    still to come ("a note-on and note-off on one timestamp",
    midi-out.ts:21-22). -/
theorem no_off_held_until_flush (m : MO) (n : Sent) (hn : n ∈ m.sent) (hoff : n.off = none)
    (hns : n.offSent = false) (upTo now : Rat) :
    n ∈ (advance m upTo now).sent ∧
      Msg.off n.pitch (some (max now n.time)) .score ∈ (flush m now).wire := by
  have hd : due upTo n = false := by simp [due, hoff]
  constructor
  · simp only [advance, List.mem_filter, List.mem_map]
    exact ⟨⟨n, hn, by simp [hd]⟩, by simp [over, hns]⟩
  · simp only [flush, List.mem_append, List.mem_map, List.mem_filter]
    left; right
    exact ⟨n, ⟨hn, by simp [stillOn, hoff]⟩, rfl⟩

/-- A strike that ends (1040) before it begins (1090), and the tick's
    `advance(1100)`. -/
def exOffBeforeAt : MO :=
  advance (strike (fun _ => 1) init ⟨60, 70, 1090, some 1040, none⟩) 1100 1000

/-- **HYPOTHESIS `WFStrike` IS NEEDED.** A strike whose `off` is before its
    `at` gets its note-off stamped before its note-on; the synth hears the
    off first and the note is left sounding. The scheduler never makes one.
    Repro: `repro/midi_out.ts`, section 5. -/
theorem FAILS_strike_off_before_at :
    exOffBeforeAt.wire = [Msg.on 60 70 (some 1090) .score, Msg.off 60 (some 1040) .score] ∧
      ¬ Answered exOffBeforeAt.wire ∧ exOffBeforeAt.sent.all (·.offSent) = true := by
  decide

/-! ## The two paths -/

/-- **types.ts:204-205** `flush` "Leaves the live path alone", in the
    Output's own bookkeeping: the set of live keys down is untouched by
    everything on the score path. -/
theorem score_path_keeps_held (decay : Rat → Rat) (m : MO) (s : Strike) (upTo now : Rat) :
    (strike decay m s).held = m.held ∧ (advance m upTo now).held = m.held ∧
      (flush m now).held = m.held := ⟨rfl, rfl, rfl⟩

/-- …and the live path leaves the score path's bookkeeping alone. -/
theorem live_path_keeps_sent (m : MO) (p : Pitch) (v : Int) :
    (liveOn m p v).sent = m.sent ∧ (liveOff m p).sent = m.sent := by
  unfold liveOn liveOff send
  constructor <;> split <;> rfl

/-- The wire cannot tell the paths apart: a score note-off and a live
    note-off for one key are the same three bytes (midi-out.ts:41-44, one
    channel). -/
theorem off_bytes_same (p : Pitch) (t t' : Option Rat) :
    bytes (.off p t .score) = bytes (.off p t' .live) := rfl

/-- **types.ts:204-205 / midi-out.test.ts:123** "a live key survives a flush:
    the score path and the hands are separate" — HOLDS ONLY UNDER A
    HYPOTHESIS THE CODE DOES NOT ENFORCE: no remembered score note is on a key
    the user is holding (`hsep`). Then `flush` sends no note-off for any held
    key. Without it: `FAILS_flush_leaves_live_alone`. -/
theorem flush_spares_live (m : MO) (now : Rat) (hsep : ∀ n ∈ m.sent, n.pitch ∉ m.held) :
    ∃ pre, (flush m now).wire = m.wire ++ pre ∧
      ∀ p ∈ m.held, ∀ t path, Msg.off p t path ∉ pre := by
  refine ⟨(m.sent.filter (stillOn now)).map (fun n => Msg.off n.pitch (some (max now n.time)) .score)
      ++ [Msg.cc 64 0 none], by simp [flush], ?_⟩
  intro p hp t path hmem
  simp only [List.mem_append, List.mem_map, List.mem_filter, List.mem_singleton] at hmem
  rcases hmem with ⟨n, ⟨hn, _⟩, he⟩ | he
  · cases he; exact hsep n hn hp
  · cases he

/-- The last thing the wire says about key `p`: `some true` after a note-on,
    `some false` after a note-off. When the stamps are in send order — they
    are in every example below — this is the one-note-per-key synth's final
    state for the key. -/
def lastNote (wire : List Msg) (p : Pitch) : Option Bool :=
  wire.foldl (fun acc msg => match msg with
    | .on q vel _ _ => if q = p then some (decide (vel > 0)) else acc
    | .off q _ _ => if q = p then some false else acc
    | .cc _ _ _ => acc) none

/-- The user holds C4; the score strikes C4 (1050–5000); at 1200 the
    transport changes and `flush` runs; the user is still holding C4. -/
def exFlushLive : MO :=
  flush (strike (fun _ => 1) (liveOn init 60 90) ⟨60, 70, 1050, some 5000, none⟩) 1200

/-- **FAILS — `flush` "Leaves the live path alone"** (types.ts:204-205;
    midi-out.test.ts:123 "a live key survives a flush: the score path and the
    hands are separate"). With a live key and a score note on one pitch,
    `flush` sends that key's note-off. The Output still counts the key as
    held — so a repeated `liveOn` is ignored and nothing re-sounds it — while
    the last word the synth has for the key is "off".
    Repro: `repro/midi_out.ts`, section 3. -/
theorem FAILS_flush_leaves_live_alone :
    60 ∈ exFlushLive.held ∧ lastNote exFlushLive.wire 60 = some false ∧
      exFlushLive.wire =
        [Msg.on 60 90 none .live, Msg.on 60 70 (some 1050) .score,
         Msg.off 60 (some 1200) .score, Msg.cc 64 0 none] ∧
      liveOn exFlushLive 60 90 = exFlushLive := by
  decide

/-- (a) The user holds C4 while a score C4 (1050–1400) comes and goes.
    (b) A score C4 (1000–5000) is sounding; the user taps C4 and lets go. -/
def exTouchA : MO :=
  advance (strike (fun _ => 1) (liveOn init 60 90) ⟨60, 70, 1050, some 1400, none⟩) 1500 1000
def exTouchB : MO :=
  liveOff (liveOn (strike (fun _ => 1) init ⟨60, 70, 1000, some 5000, none⟩) 60 90) 60

/-- **FAILS — "Two paths that never touch each other"** (types.ts:190-193),
    on a MIDI port, whenever a live key and a score note share a pitch.
    (a) The score note's own note-off, sent by `advance`, releases the key
    the user is still holding. (b) The user's key-up releases the score note,
    which the Output still remembers as sounding until 5000.
    Repro: `repro/midi_out.ts`, section 4. -/
theorem FAILS_paths_never_touch :
    (60 ∈ exTouchA.held ∧ lastNote exTouchA.wire 60 = some false) ∧
    (exTouchB.sent = [⟨60, 1000, some 5000, false⟩] ∧ lastNote exTouchB.wire 60 = some false) := by
  decide

/-- C4 struck 1000–2000 and again 1500–3000, then `advance(2000)`. -/
def exOverlap : MO :=
  advance (strike (fun _ => 1) (strike (fun _ => 1) init
    ⟨60, 70, 1000, some 2000, none⟩) ⟨60, 70, 1500, some 3000, none⟩) 2000 1900

/-- **Noted — two score strikes of one pitch that overlap.** The first
    note's note-off (2000) lands inside the second (1500–3000) and, on a
    one-note-per-key synth, ends it a second early. midi-out does not guard
    against this; `perform()` is what keeps it from happening ("A note ends
    where the next note on its pitch begins", SPEC_playback.md:89-90). No
    note is left stuck. Run: `repro/midi_out.ts`, section 6. -/
theorem noted_overlap_first_off_cuts_second :
    exOverlap.wire = [Msg.on 60 70 (some 1000) .score, Msg.on 60 70 (some 1500) .score,
                      Msg.off 60 (some 2000) .score] ∧
      exOverlap.sent.filter (fun n => !n.offSent) = [⟨60, 1500, some 3000, false⟩] := by
  decide

/-- A C4 ending at 1090 has its note-off sent by the tick at 1000 (window to
    1100). At 1050 the user seeks: `flush`, and the scheduler at once drops
    into a C4 sounding at the new place (1050–3000). -/
def exStaleOff : MO :=
  strike (fun _ => 1)
    (flush (advance (strike (fun _ => 1) init ⟨60, 70, 1000, some 1090, none⟩) 1100 1000) 1050)
    ⟨60, 70, 1050, some 3000, none⟩

/-- **Noted — a note-off already on its way outlives a flush.** Nothing is
    sent further ahead than the window (`advance_sends_exactly_the_due`), but
    within the window a sent note-off cannot be recalled (midi-out.ts:15-16).
    Here the note-off stamped 1090 was sent before the seek; the note struck
    by the seek at 1050 on the same key is released by it 40 ms later, though
    the Output remembers that note as sounding until 3000 and will send
    nothing to restore it. No claim in the source promises otherwise —
    scheduler.ts:14-16 allows "a tenth of a second of notes already on their
    way" — but the audible effect is a dropped note, not a lingering one.
    Run: `repro/midi_out.ts`, section 9. -/
theorem noted_stale_off_outlives_flush :
    exStaleOff.wire =
      [Msg.on 60 70 (some 1000) .score, Msg.off 60 (some 1090) .score,
       Msg.off 60 (some 1050) .score, Msg.cc 64 0 none, Msg.on 60 70 (some 1050) .score] ∧
      exStaleOff.sent = [⟨60, 1050, some 3000, false⟩] := by
  decide

/-! ### The pedal across a flush -/

/-- When each sustain message takes effect, and what it sets: a stamped
    message at its stamp, an unstamped one when it was sent (`sentAt`). Every
    unstamped sustain message in the example below is the flush's own. -/
def sustainEffects (sentAt : Rat) (wire : List Msg) : List (Rat × Bool) :=
  wire.filterMap fun msg =>
    match msg with
    | .cc 64 value stamp => some (stamp.getD sentAt, decide (value > 0))
    | _ => none

/-- The synth's pedal once every message has taken effect: the setting of the
    latest, the later-sent winning a tie. `none` if it was never set. -/
def pedalAfter (effects : List (Rat × Bool)) : Option Bool :=
  (effects.foldl
    (fun (acc : Option (Rat × Bool)) e =>
      match acc with
      | none => some e
      | some a => if e.1 ≥ a.1 then some e else some a)
    none).map (·.2)

/-- The tick at wall time 1000 looks 100ms ahead and sends the pedal-down that
    stands at 1080 (scheduler.ts:134); at 1050 the user pauses, and `flush`
    runs (scheduler.ts:148). -/
def exPedalAhead : MO := flush (pedal init true 1080) 1050

/-- **Fails:** flush lifts the pedal because "what the pedal holds is part of
    what was playing" (midi-out.ts:139), and silences "anything scheduled but
    not yet heard" (types.ts:204). A pedal-down already sent with a stamp in
    the future takes effect AFTER the flush's sustain-off, which is unstamped
    and so immediate: the synth is left with its pedal down, and everything
    the user plays while paused rings on.
    Repro: `repro/midi_pedal_stuck_after_pause.ts`. -/
theorem FAILS_flush_lifts_pedal :
    exPedalAhead.wire = [Msg.cc 64 127 (some 1080), Msg.cc 64 0 none] ∧
      pedalAfter (sustainEffects 1050 exPedalAhead.wire) = some true := by
  decide +kernel

/-- **Holds only under a hypothesis the code does not enforce:** no sustain
    message is stamped later than the flush. Then the flush's sustain-off is
    the last word, and the pedal is up. -/
theorem flush_lifts_pedal (m : MO) (now : Rat)
    (hpast : ∀ e ∈ sustainEffects now m.wire, e.1 ≤ now) :
    pedalAfter (sustainEffects now (flush m now).wire) = some false := by
  have hw : sustainEffects now (flush m now).wire = sustainEffects now m.wire ++ [(now, false)] := by
    simp only [flush, sustainEffects, List.filterMap_append, List.filterMap_map]
    have : List.filterMap ((fun msg => match msg with
        | Msg.cc 64 value stamp => some (stamp.getD now, decide (value > 0))
        | _ => none) ∘ fun n => Msg.off n.pitch (some (max now n.time)) Path.score)
        (m.sent.filter (stillOn now)) = [] := by
      rw [List.filterMap_eq_nil_iff]; intro n _; rfl
    rw [this]; simp
  rw [hw]
  unfold pedalAfter
  rw [List.foldl_append]
  simp only [List.foldl_cons, List.foldl_nil]
  -- whatever the earlier messages left, it took effect no later than `now`
  have key : ∀ (l : List (Rat × Bool)) (acc : Option (Rat × Bool)),
      (∀ e ∈ l, e.1 ≤ now) → (∀ a, acc = some a → a.1 ≤ now) →
      ∀ a, l.foldl (fun (acc : Option (Rat × Bool)) e =>
          match acc with
          | none => some e
          | some a => if e.1 ≥ a.1 then some e else some a) acc = some a → a.1 ≤ now := by
    intro l
    induction l with
    | nil => intro acc _ hacc a ha; exact hacc a ha
    | cons e l ih =>
      intro acc hl hacc a ha
      simp only [List.foldl_cons] at ha
      refine ih _ (fun x hx => hl x (by simp [hx])) ?_ a ha
      intro b hb
      cases acc with
      | none => simp only [Option.some.injEq] at hb; rw [← hb]; exact hl e (by simp)
      | some a0 =>
        simp only at hb
        split at hb
        · simp only [Option.some.injEq] at hb; rw [← hb]; exact hl e (by simp)
        · simp only [Option.some.injEq] at hb; rw [← hb]; exact hacc a0 rfl
  cases hf : (sustainEffects now m.wire).foldl (fun (acc : Option (Rat × Bool)) e =>
      match acc with
      | none => some e
      | some a => if e.1 ≥ a.1 then some e else some a) none with
  | none => rfl
  | some a =>
    have := key _ none hpast (by intro a h; cases h) a hf
    simp only
    have hge : now ≥ a.1 := this
    simp [hge]

/-- **Noted — a pitch or velocity outside MIDI's range is passed through.**
    Whatever the strike says goes into the data bytes unclamped: pitch 128
    yields `[0x90, 128, vel]`, velocity 0 a note-on with velocity 0 (which
    MIDI reads as a note-off). On a real port `send` throws for a byte above
    127 and line 113 swallows it, so the note is silently not played — but
    still remembered in `sent`. Run: `repro/midi_out.ts`, section 7. -/
theorem noted_strike_bytes_unclamped (decay : Rat → Rat) (m : MO) (s : Strike) :
    ∃ msg, (strike decay m s).wire = m.wire ++ [msg] ∧
      bytes msg = [0x90, s.pitch, velOf decay s] ∧
      (strike decay m s).sent = m.sent ++ [⟨s.pitch, s.time, s.off, false⟩] :=
  ⟨_, rfl, rfl, rfl⟩

/-- **midi-out.test.ts:113** "sounds live keys at once, once each". -/
theorem live_once (m : MO) (p : Pitch) (v : Int) :
    liveOn (liveOn m p v) p v = liveOn m p v ∧ liveOff (liveOff m p) p = liveOff m p := by
  constructor
  · unfold liveOn
    by_cases h : p ∈ m.held
    · simp [h]
    · simp [h, send]
  · unfold liveOff
    by_cases h : p ∈ m.held
    · simp [h, send]
    · simp [h]

/-- **midi-out.ts:157-164 / types.ts:211-212** `detach`: "let go of
    everything". Under the same hypothesis as `flush_no_stuck`, after
    `detach` no score note is open, nothing is remembered on either path,
    every key that was held has been sent its note-off, and the last message
    is the panic (CC 123). -/
theorem detach_lets_go {m : MO} (h : Inv m) (now : Rat) (hk : KeptUp m now) :
    Answered (detach m now).wire ∧ (detach m now).sent = [] ∧ (detach m now).held = [] ∧
      (∀ p ∈ m.held, Msg.off p none .live ∈ (detach m now).wire) ∧
      (detach m now).wire.getLast? = some (Msg.cc 123 0 none) := by
  have hf := (flush_no_stuck h now hk).1
  refine ⟨?_, rfl, rfl, ?_, by simp [detach]⟩
  · unfold Answered at hf ⊢
    cases hopen : openOns (detach m now).wire with
    | nil => rfl
    | cons pa rest =>
      exfalso
      obtain ⟨p, a⟩ := pa
      have hpa : (p, a) ∈ openOns (detach m now).wire := by rw [hopen]; simp
      simp only [detach] at hpa
      have hpa' := openOns_snoc_cc _ _ _ _ _ _ hpa
      rcases mem_openOns_append _ _ p a hpa' with ⟨h1, _⟩ | h1
      · rw [hf] at h1; simp at h1
      · have : openOns ((flush m now).held.map (fun p => Msg.off p none .live)) = [] := by
          generalize (flush m now).held = l
          induction l with
          | nil => rfl
          | cons q l ih => simp [openOns, ih]
        rw [this] at h1; simp at h1
  · intro p hp
    simp only [detach, List.mem_append, List.mem_map]
    left; right
    exact ⟨p, hp, rfl⟩

/-! ## `resumedVelocity` -/

/-- **midi-out.ts:49-51** "down to a floor that still sounds on any synth"
    (test: "never 0, which would be a note-off") and **types.ts:174**
    "1–127": a resumed velocity is at least 1, and — HYPOTHESIS the code does
    not enforce — when the offset is not negative (so the decay factor `e` is
    at most 1) it is at most the note's own velocity, hence within 1–127
    whenever that is. -/
theorem resumedVelocity_range (e : Rat) (velocity : Int) (hv : 1 ≤ velocity) (he : e ≤ 1) :
    1 ≤ resumedVelocity e velocity ∧ resumedVelocity e velocity ≤ velocity := by
  unfold resumedVelocity jsRound
  have hf : max (35 / 100) e ≤ 1 := by grind
  have hv0 : (0 : Rat) ≤ (velocity : Rat) := by
    have : ((0 : Int) : Rat) ≤ (velocity : Rat) := Rat.intCast_le_intCast.2 (by omega)
    simpa using this
  have hx : (velocity : Rat) * max (35 / 100) e ≤ velocity := by
    have := Rat.mul_le_mul_of_nonneg_left hf hv0
    grind
  have hlt : ((velocity : Rat) * max (35 / 100) e + 1 / 2).floor < velocity + 1 := by
    rw [Rat.floor_lt_iff]
    have : ((velocity + 1 : Int) : Rat) = (velocity : Rat) + 1 := by simp
    rw [this]; grind
  omega

/-- **FAILS without it**: a negative offset makes the factor exceed 1 and the
    result exceed 127 — for a factor of 2 (offset ≈ −1.04 s) velocity 100
    becomes 200. The scheduler only ever passes a positive offset
    (scheduler.ts:90). Repro: `repro/midi_out.ts`, section 7. -/
theorem FAILS_resumedVelocity_range_negative_offset : resumedVelocity 2 100 = 200 := by
  unfold resumedVelocity jsRound
  have h1 : ((100 : Int) : Rat) * max (35 / 100) 2 + 1 / 2 = 200 + 1 / 2 := by
    have : max (35 / 100 : Rat) 2 = 2 := by grind
    rw [this]; simp; grind
  have h2 : ((200 : Rat) + 1 / 2).floor = 200 := by
    have hle : (200 : Int) ≤ ((200 : Rat) + 1 / 2).floor := by
      rw [Rat.le_floor_iff]; simp; grind
    have hlt : ((200 : Rat) + 1 / 2).floor < (201 : Int) := by
      rw [Rat.floor_lt_iff]; simp; grind
    omega
  rw [h1, h2]; rfl

/-! ## The built-in piano's registry — src/outputs/audio.ts -/

namespace Audio

/-- audio.ts:58-71, the fields the registry logic reads. `stop = none` is
    `Infinity`. `cut` records the last thing that silenced the voice. -/
structure Voice where
  id : Nat
  pitch : Pitch
  start : Rat
  stop : Option Rat
  /-- audio.ts:69-70 "On the score path, which flush() silences; else a live key's." -/
  score : Bool
  /-- ghost: has `fade` (a re-strike, a theft, a kill) been applied? -/
  faded : Bool
  deriving DecidableEq, Repr

structure AO where
  /-- audio.ts:81 `voices` -/
  voices : List Voice
  /-- audio.ts:82 `live`: pitch → the id of its voice -/
  live : List (Pitch × Nat)
  nextId : Nat
  deriving DecidableEq, Repr

/-- `v.stop <= when` (audio.ts:325), with `Infinity` never `≤`. -/
def stoppedBy (v : Voice) (when : Rat) : Bool :=
  match v.stop with | some s => decide (s ≤ when) | none => false

/-- audio.ts:346-358 — `fade(v, when, tc)`, as far as the registry sees it:
    the voice is marked silenced. -/
def fade (v : Voice) : Voice := { v with faded := true }

/-- audio.ts:322-328, the first loop of `makeRoomFor(pitch, when)`: "cut what
    it is still sounding" — every voice on this pitch that began earlier and
    has not stopped, WHICHEVER PATH it is on. (The voice-stealing half, lines
    329-331, is left out: it needs 96 voices.) -/
def makeRoomFor (a : AO) (pitch : Pitch) (when : Rat) : AO :=
  { a with voices := a.voices.map (fun v =>
      if !stoppedBy v when && decide (v.pitch = pitch) && decide (v.start < when)
      then fade v else v) }

/-- audio.ts:285-318 — `spawn(pitch, velocity, when, offset, score)`. -/
def spawn (a : AO) (pitch : Pitch) (when : Rat) (score : Bool) : AO × Nat :=
  let a := makeRoomFor a pitch when
  ({ a with voices := a.voices ++ [⟨a.nextId, pitch, when, none, score, false⟩],
            nextId := a.nextId + 1 }, a.nextId)

/-- audio.ts:375-383 — `strike(s)` (its damper scheduling omitted). -/
def strike (a : AO) (pitch : Pitch) (when : Rat) : AO := (spawn a pitch when true).1

/-- audio.ts:385-388 — `flush()`: `for (const v of voices) if (v.score) kill(v)`. -/
def flush (a : AO) : AO :=
  { a with voices := a.voices.map (fun v => if v.score then fade v else v) }

/-- audio.ts:398-402 — `liveOn(pitch, velocity)` at audio time `now`. -/
def liveOn (a : AO) (pitch : Pitch) (now : Rat) : AO :=
  if (a.live.find? (fun e => e.1 = pitch)).isSome then a
  else
    let r := spawn a pitch now false
    { r.1 with live := r.1.live ++ [(pitch, r.2)] }

/-- **types.ts:204-205** `flush` "Silence the score path … Leaves the live
    path alone" — HOLDS for the built-in piano: `flush` silences every score
    voice and changes no live voice and no entry of `live`. -/
theorem flush_only_score (a : AO) :
    (∀ v ∈ a.voices, v.score = false → v ∈ (flush a).voices) ∧
    (∀ v ∈ (flush a).voices, v.score = true → v.faded = true) ∧ (flush a).live = a.live := by
  refine ⟨?_, ?_, rfl⟩
  · intro v hv hs
    simp only [flush, List.mem_map]
    exact ⟨v, hv, by simp [hs]⟩
  · intro v hv hs
    simp only [flush, List.mem_map] at hv
    obtain ⟨w, _, rfl⟩ := hv
    by_cases hw : w.score = true
    · simp [hw, fade]
    · simp [hw] at hs ⊢

/-- The user presses and holds C4 at audio time 2; at 3 the score strikes C4. -/
def exShared : AO := strike (liveOn ⟨[], [], 0⟩ 60 2) 60 3

/-- **FAILS — "Two paths that never touch each other"** (types.ts:190-193)
    for the built-in piano too: a score strike on a key the user is holding
    cuts the user's voice (audio.ts:326 does not look at `v.score`), while
    `live` still maps the key to that silenced voice. audio.ts's own header
    says so on purpose — "VOICES are one registry, the score's and the user's
    hands' alike … striking a key that is still sounding cuts the earlier
    sound" (audio.ts:14-21; SPEC_playback.md:254-255) — so this is two
    documents disagreeing, and the code follows audio.ts.
    Repro: `repro/audio_shared_pitch.ts`. -/
theorem FAILS_audio_paths_never_touch :
    exShared.voices = [⟨0, 60, 2, none, false, true⟩, ⟨1, 60, 3, none, true, false⟩] ∧
      exShared.live = [(60, 0)] := by
  decide

end Audio

end Harmonicland.MidiOut
