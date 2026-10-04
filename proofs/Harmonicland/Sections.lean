/-!
# Sections — `src/sections.ts` and `src/section-store.ts`

A score broken into named runs of bars, kept for later; and the round trip
through storage.

## What the model is

A line-by-line translation of `idOf`, `inOrder`, `sectionOf`, `add`,
`retarget`, `rename`, `remove`, `find`, `chunk`, `addAll`, `parse`
(sections.ts) and of `save`/`load` (section-store.ts:23-40).

* A bar index (`BarRange.from`, `.to`) is `Int`; a trim (`fromBeat`, `toBeat`)
  is `Option Rat`, `none` being absent/`undefined`.
* THE ID. `idOf` (sections.ts:40) builds a string. The model's id is the tuple
  the string is built from, `(from, fromBeat?, to, toBeat?)`. Whether the
  STRING is injective is a statement about how JavaScript prints numbers and
  is not proved here; see the report (it is, on what `parse` admits).
* THE SORT. `inOrder`'s comparator (sections.ts:67-69) is translated term by
  term, `||` and `Infinity - Infinity = NaN` included (`JsNum`).
  `Array.prototype.sort` treats a `NaN` from its comparator as `+0`
  (ECMA-262, SortCompare) and is stable; it is `List.mergeSort` on "the
  comparator is not positive".
* `name.trim()` is a parameter `trim` of the model; the two facts used about
  it (`trim "" = ""`, `trim (trim s) = trim s`) are stated where they are used.
* `parse` reads untrusted JSON. A value read from it is a `JV`: absent, a
  finite number, or anything else (`null`, a string, an object, ...). An array
  element is an `Entry`: its `range` if `d?.range` is truthy, and its `name`
  if `typeof d.name === "string"`.
* Storage: `JSON.parse(JSON.stringify(x))` is taken to return finite numbers
  and strings exactly, and to drop absent keys — `encode` below. The
  `localStorage` failures section-store.ts guards against are left out.

## What the model leaves out

* Floating-point rounding, `NaN`/`Infinity`/non-integer bar indices handed to
  `add`/`retarget`/`chunk` directly (`parse` rejects them; no caller makes them).
* `describeBars`, `labelOf`, `beatNo` (string formatting) and `keyForBytes`
  (a hash): no theorem here speaks about them.
* Names Lean reserves: `from` is `from_`.
-/

namespace Harmonicland.Sections

theorem ifPos {α : Sort _} {c : Prop} [Decidable c] {a b : α} (h : c) :
    (if c then a else b) = a := by simp [h]

theorem ifNeg {α : Sort _} {c : Prop} [Decidable c] {a b : α} (h : ¬ c) :
    (if c then a else b) = b := by simp [h]

/-- src/types.ts:125 -/
structure BarRange where
  from_ : Int
  to : Int
  fromBeat : Option Rat := none
  toBeat : Option Rat := none
  deriving DecidableEq, Repr

/-- What `idOf`'s string is built from. -/
abbrev Id := Int × Option Rat × Int × Option Rat

/-- src/sections.ts:40 — as the tuple (see the header). -/
def idOf (r : BarRange) : Id := (r.from_, r.fromBeat, r.to, r.toBeat)

/-- src/sections.ts:30 -/
structure Section where
  id : Id
  range : BarRange
  name : String
  deriving DecidableEq, Repr

/-- The value of a JavaScript arithmetic expression: a finite number (an
    integer difference of bars, or a rational difference of beats), an
    infinity, or `NaN`. -/
inductive JsNum where
  | int (i : Int)
  | rat (q : Rat)
  | posInf
  | negInf
  | nan
  deriving DecidableEq, Repr

/-- `x || rest` for a bar difference: 0 is falsy. -/
def orElseI (x : Int) (rest : JsNum) : JsNum := if x = 0 then rest else .int x

/-- `x || rest` for a beat difference. -/
def orElseR (x : Rat) (rest : JsNum) : JsNum := if x = 0 then rest else .rat x

/-- `(a.range.toBeat ?? Infinity) - (b.range.toBeat ?? Infinity)` (sections.ts:69). -/
def toBeatDiff : Option Rat → Option Rat → JsNum
  | some x, some y => .rat (x - y)
  | none, some _ => .posInf
  | some _, none => .negInf
  | none, none => .nan

/-- src/sections.ts:67-69 — the comparator handed to `sort`. -/
def comparator (a b : Section) : JsNum :=
  orElseI (a.range.from_ - b.range.from_)
    (orElseR (a.range.fromBeat.getD 0 - b.range.fromBeat.getD 0)
      (orElseI (a.range.to - b.range.to)
        (toBeatDiff a.range.toBeat b.range.toBeat)))

/-- What `sort` makes of the comparator's value: `a` stays before `b` unless
    it is positive; `NaN` counts as `+0`. -/
def le (a b : Section) : Bool :=
  match comparator a b with
  | .int i => decide (i ≤ 0)
  | .rat q => decide (q ≤ 0)
  | .posInf => false
  | .negInf => true
  | .nan => true

/-- src/sections.ts:66 -/
def inOrder (list : List Section) : List Section := list.mergeSort le

/-- src/sections.ts:108 — `find` for a range that is not `null`. -/
def find (list : List Section) (range : BarRange) : Option Section :=
  list.find? (fun s => s.id == idOf range)

section Ops
variable (trim : String → String)

/-- src/sections.ts:73 — the copy drops nothing the model's `BarRange` has. -/
def sectionOf (range : BarRange) (name : String) : Section :=
  { id := idOf range, range := range, name := trim name }

/-- src/sections.ts:84 -/
def add (list : List Section) (range : BarRange) (name : String := "") : List Section :=
  let s := sectionOf trim range name
  if list.any (fun x => x.id == s.id) then list
  else inOrder (list ++ [s])

/-- src/sections.ts:93 -/
def retarget (list : List Section) (id : Id) (range : BarRange) : List Section :=
  match list.find? (fun x => x.id == id) with
  | none => list
  | some s =>
    if (find list range).isSome then list
    else inOrder (list.filter (fun x => x.id != id) ++ [sectionOf trim range s.name])

/-- src/sections.ts:99 -/
def rename (list : List Section) (id : Id) (name : String) : List Section :=
  list.map (fun s => if s.id == id then { s with name := trim name } else s)

/-- src/sections.ts:103 -/
def remove (list : List Section) (id : Id) : List Section :=
  list.filter (fun s => s.id != id)

/-- src/sections.ts:122 -/
def addAll (list : List Section) (ranges : List BarRange) : List Section :=
  ranges.foldl (fun acc r => add trim acc r) list

end Ops

/-- src/sections.ts:117 — the loop, from `from`. -/
def chunkLoop (n : Int) (hn : 1 ≤ n) (bars from_ : Int) : List BarRange :=
  if from_ < bars then
    { from_ := from_, to := min (from_ + n) bars - 1 } :: chunkLoop n hn bars (from_ + n)
  else []
termination_by (bars - from_).toNat
decreasing_by omega

/-- src/sections.ts:114 — `bars` an integer (its caller passes
    `score.bars.length`), `size` any finite number. -/
def chunk (bars : Int) (size : Rat) : List BarRange :=
  chunkLoop (max 1 size.floor) (by omega) bars 0

/-! ### `parse` and the store -/

/-- A value read out of parsed JSON where a number is hoped for. -/
inductive JV where
  /-- the key is absent: `undefined` -/
  | undef
  /-- a finite number -/
  | num (q : Rat)
  /-- anything else: `null`, a string, a boolean, an object, an array -/
  | other
  deriving DecidableEq, Repr

/-- `d.range`, when it is truthy. -/
structure RawRange where
  from_ : JV
  to : JV
  fromBeat : JV
  toBeat : JV
  deriving DecidableEq, Repr

/-- One element of the array `parse` is handed. `range = none`: `d?.range` is
    falsy (`d` is `null`, not an object, or has no range). `name = none`:
    `typeof d.name !== "string"`. -/
structure Entry where
  range : Option RawRange
  name : Option String
  deriving DecidableEq, Repr

/-- src/sections.ts:130 — `isBar`, returning the bar. -/
def isBar : JV → Option Int
  | .num q => if q.den = 1 ∧ 0 ≤ q.num then some q.num else none
  | _ => none

/-- src/sections.ts:131 — `isTrim`, returning the trim (`some none`: absent). -/
def isTrim : JV → Option (Option Rat)
  | .undef => some none
  | .num q => if 0 < q then some (some q) else none
  | .other => none

/-- src/sections.ts:134-136 — one turn of the loop. -/
def parseStep (trim : String → String) (list : List Section) (d : Entry) : List Section :=
  match d.range with
  | none => list
  | some r =>
    match isBar r.from_, isBar r.to, isTrim r.fromBeat, isTrim r.toBeat with
    | some f, some t, some fb, some tb =>
      if f > t then list
      else add trim list { from_ := f, to := t, fromBeat := fb, toBeat := tb } (d.name.getD "")
    | _, _, _, _ => list

/-- src/sections.ts:128 — `data` an array. (Anything else is `[]`,
    sections.ts:129.) Total: there is no input on which it fails. -/
def parse (trim : String → String) (data : List Entry) : List Section :=
  data.foldl (parseStep trim) []

/-- An absent trim is an absent key. -/
def optJV : Option Rat → JV
  | none => .undef
  | some q => .num q

/-- src/section-store.ts:36 — `{ range, name }` through `JSON.stringify` and
    back through `JSON.parse`. -/
def encode (s : Section) : Entry :=
  { range := some { from_ := .num s.range.from_, to := .num s.range.to,
                    fromBeat := optJV s.range.fromBeat, toBeat := optJV s.range.toBeat },
    name := some s.name }

/-- src/section-store.ts:23-36 — `load` after `save`, storage working. (An
    empty list removes the key, and a missing key loads as `[]`: the same as
    `parse []`.) -/
def loadAfterSave (trim : String → String) (sections : List Section) : List Section :=
  parse trim (sections.map encode)

/-! ## The comparator is a consistent ordering (sections.ts:65-69) -/

/-- `toBeat ?? Infinity`, compared. -/
def tbLe : Option Rat → Option Rat → Prop
  | some x, some y => x ≤ y
  | none, some _ => False
  | some _, none => True
  | none, none => True

/-- sections.ts:65 "By where a section starts, then where it ends — trims
    included": the lexicographic order on
    `(from, fromBeat ?? 0, to, toBeat ?? Infinity)`. -/
def keyLe (a b : BarRange) : Prop :=
  a.from_ < b.from_ ∨ (a.from_ = b.from_ ∧
    (a.fromBeat.getD 0 < b.fromBeat.getD 0 ∨ (a.fromBeat.getD 0 = b.fromBeat.getD 0 ∧
      (a.to < b.to ∨ (a.to = b.to ∧ tbLe a.toBeat b.toBeat)))))

/-- sections.ts:65-69: the comparator, `NaN` and all, IS that lexicographic
    order. The `Infinity - Infinity = NaN` of two absent `toBeat`s arises only
    when the other three keys are equal, where `sort` reads it as "equal" —
    which is what the order says. -/
theorem le_iff (a b : Section) : le a b = true ↔ keyLe a.range b.range := by
  unfold le comparator orElseI orElseR keyLe
  cases ha : a.range.toBeat <;> cases hb : b.range.toBeat <;>
    simp only [toBeatDiff, tbLe] <;> (repeat' split) <;> simp_all <;> grind

theorem keyLe_trans (a b c : BarRange) : keyLe a b → keyLe b c → keyLe a c := by
  unfold keyLe
  cases a.toBeat <;> cases b.toBeat <;> cases c.toBeat <;> simp only [tbLe] <;> grind

theorem keyLe_total (a b : BarRange) : keyLe a b ∨ keyLe b a := by
  unfold keyLe
  cases a.toBeat <;> cases b.toBeat <;> simp only [tbLe] <;> grind

/-- The comparator is transitive ... -/
theorem le_trans' (a b c : Section) : le a b = true → le b c = true → le a c = true := by
  simp only [le_iff]; exact keyLe_trans _ _ _

/-- ... and total: a consistent comparator, so `sort` has one right answer. -/
theorem le_total' (a b : Section) : (le a b || le b a) = true := by
  simp only [Bool.or_eq_true, le_iff]; exact keyLe_total _ _

/-- A trim the app can produce: not zero. (`parse` admits only trims `> 0`,
    sections.ts:131; `Core.normalizeRange` drops a head `<= BEAT_EPS`.) -/
def NoZeroHead (r : BarRange) : Prop := r.fromBeat ≠ some 0

/-- The comparator ties only a range with itself — HOLDS ONLY UNDER A
    HYPOTHESIS `add`/`retarget` do not enforce: neither range has
    `fromBeat: 0`, which `fromBeat ?? 0` cannot tell from an absent one. -/
theorem tie_iff_same_id (a b : BarRange) (ha : NoZeroHead a) (hb : NoZeroHead b)
    (h1 : keyLe a b) (h2 : keyLe b a) : idOf a = idOf b := by
  unfold keyLe at h1 h2
  unfold NoZeroHead at ha hb
  unfold idOf
  cases hfa : a.fromBeat <;> cases hfb : b.fromBeat <;>
    cases hta : a.toBeat <;> cases htb : b.toBeat <;>
    simp_all [tbLe] <;> grind

/-! ## The invariants of decision 3 (sections.ts:22-26) -/

/-- sections.ts:22 "Its id IS its range, trims included". -/
def WF (l : List Section) : Prop := ∀ s ∈ l, s.id = idOf s.range

/-- sections.ts:31 "unique within a list". -/
def Unique (l : List Section) : Prop := l.Pairwise (fun a b => a.id ≠ b.id)

/-- sections.ts:24 "a list is always in score order". -/
def Sorted (l : List Section) : Prop := l.Pairwise (fun a b => le a b = true)

def Inv (l : List Section) : Prop := WF l ∧ Unique l ∧ Sorted l

theorem inv_nil : Inv [] := by simp [Inv, WF, Unique, Sorted]

theorem inOrder_perm (l : List Section) : (inOrder l).Perm l := List.mergeSort_perm _ _

theorem inOrder_sorted (l : List Section) : Sorted (inOrder l) :=
  List.pairwise_mergeSort le_trans' le_total' l

theorem inOrder_unique (l : List Section) (h : Unique l) : Unique (inOrder l) :=
  ((inOrder_perm l).pairwise_iff (fun h => Ne.symm h)).mpr h

theorem inOrder_wf (l : List Section) (h : WF l) : WF (inOrder l) :=
  fun s hs => h s ((inOrder_perm l).mem_iff.mp hs)

/-- Sorting a list already in order changes nothing. -/
theorem inOrder_of_sorted (l : List Section) (h : Sorted l) : inOrder l = l :=
  List.mergeSort_of_pairwise h

section Proofs
variable (trim : String → String)

/-! ### `add` (sections.ts:82-88) -/

theorem any_id_iff (l : List Section) (i : Id) :
    l.any (fun x => x.id == i) = true ↔ ∃ x ∈ l, x.id = i := by
  simp [List.any_eq_true]

/-- `add` keeps decision 3's three invariants. -/
theorem add_inv (l : List Section) (r : BarRange) (name : String) (h : Inv l) :
    Inv (add trim l r name) := by
  obtain ⟨hw, hu, hs⟩ := h
  unfold add
  simp only
  split
  · exact ⟨hw, hu, hs⟩
  · rename_i hany
    have hnot : ∀ x ∈ l, x.id ≠ (sectionOf trim r name).id := by
      intro x hx he
      exact hany ((any_id_iff l _).mpr ⟨x, hx, he⟩)
    refine ⟨inOrder_wf _ ?_, inOrder_unique _ ?_, inOrder_sorted _⟩
    · intro s hs'
      rw [List.mem_append] at hs'
      rcases hs' with hs' | hs'
      · exact hw s hs'
      · simp at hs'; subst hs'; rfl
    · unfold Unique
      rw [List.pairwise_append]
      refine ⟨hu, by simp, ?_⟩
      intro a ha b hb
      simp at hb; subst hb
      exact hnot a ha

/-- sections.ts:82-83 "Add `range`, unless a section of exactly those bars
    exists (decision 3), in which case the list comes back unchanged" /
    sections.test.ts:13. -/
theorem add_unchanged_when_present (l : List Section) (r : BarRange) (name : String)
    (h : ∃ x ∈ l, x.id = idOf r) : add trim l r name = l := by
  unfold add
  simp only
  rw [ifPos]
  exact (any_id_iff l _).mpr h

/-- After `add`, a section of exactly those bars is in the list (the panel's
    `Sections.find(list, selection)!`, sections-panel.ts:183, relies on it). -/
theorem add_present (l : List Section) (r : BarRange) (name : String) :
    ∃ x ∈ add trim l r name, x.id = idOf r := by
  unfold add
  simp only
  split
  · rename_i hany
    exact (any_id_iff l _).mp hany
  · refine ⟨sectionOf trim r name, ?_, rfl⟩
    exact (inOrder_perm _).mem_iff.mpr (by simp)

/-- sections.ts:22-24 "saving bars 3–8 again finds the section already there
    rather than growing a twin": `add` is idempotent, whatever the names. -/
theorem add_idempotent (l : List Section) (r : BarRange) (name name' : String) :
    add trim (add trim l r name) r name' = add trim l r name :=
  add_unchanged_when_present trim _ r name' (add_present trim l r name)

/-- `add` loses nothing: every section already there is still there, as named. -/
theorem add_keeps (l : List Section) (r : BarRange) (name : String) :
    ∀ s ∈ l, s ∈ add trim l r name := by
  intro s hs
  unfold add
  simp only
  split
  · exact hs
  · exact (inOrder_perm _).mem_iff.mpr (by simp [hs])

/-- `find` returns a section with the id asked for. -/
theorem find_some (l : List Section) (r : BarRange) (s : Section) (h : find l r = some s) :
    s ∈ l ∧ s.id = idOf r := by
  unfold find at h
  exact ⟨List.mem_of_find?_eq_some h, by simpa using List.find?_some h⟩

theorem find_none (l : List Section) (r : BarRange) (h : find l r = none) :
    ∀ x ∈ l, x.id ≠ idOf r := by
  unfold find at h
  intro x hx
  simpa using List.find?_eq_none.mp h x hx

/-! ### `retarget` (sections.ts:90-97) -/

/-- sections.ts:91-92 "Unchanged when `id` is gone ..." -/
theorem retarget_unchanged_when_gone (l : List Section) (id : Id) (r : BarRange)
    (h : ∀ x ∈ l, x.id ≠ id) : retarget trim l id r = l := by
  unfold retarget
  have : l.find? (fun x => x.id == id) = none := by
    rw [List.find?_eq_none]
    intro x hx
    simpa using h x hx
  rw [this]

/-- sections.ts:91-92 "... or `range` is already another section (decision 3)"
    — or is this very section. -/
theorem retarget_unchanged_when_taken (l : List Section) (id : Id) (r : BarRange)
    (h : ∃ x ∈ l, x.id = idOf r) : retarget trim l id r = l := by
  unfold retarget
  split
  · rfl
  · have : (find l r).isSome = true := by
      cases hf : find l r with
      | some s => rfl
      | none =>
        obtain ⟨x, hx, he⟩ := h
        exact absurd he (find_none l r hf x hx)
    rw [ifPos this]

/-- `retarget` keeps decision 3's three invariants (sections.ts:92 "two
    sections would otherwise share one id"). -/
theorem retarget_inv (l : List Section) (id : Id) (r : BarRange) (h : Inv l) :
    Inv (retarget trim l id r) := by
  obtain ⟨hw, hu, hs⟩ := h
  unfold retarget
  split
  · exact ⟨hw, hu, hs⟩
  · rename_i s hfind
    split
    · exact ⟨hw, hu, hs⟩
    · rename_i hnone
      have hnone' : find l r = none := by
        cases hf : find l r with
        | none => rfl
        | some x => simp [hf] at hnone
      have hnot := find_none l r hnone'
      refine ⟨inOrder_wf _ ?_, inOrder_unique _ ?_, inOrder_sorted _⟩
      · intro x hx
        rw [List.mem_append] at hx
        rcases hx with hx | hx
        · exact hw x (List.mem_filter.mp hx).1
        · simp at hx; subst hx; rfl
      · unfold Unique
        rw [List.pairwise_append]
        refine ⟨List.Pairwise.filter _ hu, by simp, ?_⟩
        intro a ha b hb
        simp at hb; subst hb
        exact hnot a (List.mem_filter.mp ha).1

/-- sections.ts:90 "Move section `id` to `range`, name and all" /
    sections.test.ts:70 "moves it to new bars, keeping its name": when it
    moves, the old id is gone and the new one is there under the old name
    (`trim` of it — the same, for a name already trimmed). -/
theorem retarget_moves (l : List Section) (id : Id) (r : BarRange) (s : Section)
    (hs : l.find? (fun x => x.id == id) = some s) (hfree : ∀ x ∈ l, x.id ≠ idOf r) :
    (∀ x ∈ retarget trim l id r, x.id ≠ id ∨ x = sectionOf trim r s.name)
    ∧ sectionOf trim r s.name ∈ retarget trim l id r
    ∧ (∀ x ∈ l, x.id ≠ id → x ∈ retarget trim l id r) := by
  have hf : find l r = none := by
    unfold find
    rw [List.find?_eq_none]
    intro x hx
    simpa using hfree x hx
  have he : retarget trim l id r
      = inOrder (l.filter (fun x => x.id != id) ++ [sectionOf trim r s.name]) := by
    unfold retarget
    rw [hs]
    simp [hf]
  rw [he]
  refine ⟨?_, ?_, ?_⟩
  · intro x hx
    have hx' := (inOrder_perm _).mem_iff.mp hx
    rw [List.mem_append] at hx'
    rcases hx' with hx' | hx'
    · left; simpa using (List.mem_filter.mp hx').2
    · right; simpa using hx'
  · exact (inOrder_perm _).mem_iff.mpr (by simp)
  · intro x hx hne
    exact (inOrder_perm _).mem_iff.mpr (by simp [hx, hne])

/-! ### `rename` and `remove` (sections.ts:99-105) -/

theorem rename_ids (l : List Section) (id : Id) (name : String) :
    (rename trim l id name).map (fun s => (s.id, s.range))
      = l.map (fun s => (s.id, s.range)) := by
  unfold rename
  rw [List.map_map]
  apply List.map_congr_left
  intro s _
  simp only [Function.comp]
  split <;> rfl

/-- sections.ts:31 "stable across renames": `rename` changes no id and no
    range, and keeps decision 3's invariants. -/
theorem rename_inv (l : List Section) (id : Id) (name : String) (h : Inv l) :
    Inv (rename trim l id name) := by
  obtain ⟨hw, hu, hs⟩ := h
  unfold rename
  refine ⟨?_, ?_, ?_⟩
  · intro s hs'
    obtain ⟨x, hx, he⟩ := List.mem_map.mp hs'
    subst he
    split <;> exact hw x hx
  · unfold Unique
    rw [List.pairwise_map]
    refine List.Pairwise.imp ?_ hu
    intro a b hab
    split <;> split <;> exact hab
  · unfold Sorted
    rw [List.pairwise_map]
    refine List.Pairwise.imp ?_ hs
    intro a b hab
    have key : ∀ x y : Section, x.range = a.range → y.range = b.range → le x y = true := by
      intro x y hx hy
      rw [le_iff, hx, hy, ← le_iff]; exact hab
    apply key <;> (split <;> rfl)

/-- sections.ts:34-35 "renaming a section to nothing un-names it" /
    sections.test.ts:25: the renamed section's name is `trim name`, which is
    empty when the name given trims to nothing. -/
theorem rename_sets_name (l : List Section) (id : Id) (name : String) :
    ∀ s ∈ rename trim l id name, s.id = id → s.name = trim name := by
  intro s hs hid
  unfold rename at hs
  obtain ⟨x, hx, he⟩ := List.mem_map.mp hs
  subst he
  split
  · rfl
  · rename_i hne
    split at hid
    · rename_i h; exact absurd h hne
    · simp [hid] at hne

/-- `remove` keeps decision 3's invariants ... -/
theorem remove_inv (l : List Section) (id : Id) (h : Inv l) : Inv (remove l id) := by
  obtain ⟨hw, hu, hs⟩ := h
  unfold remove
  exact ⟨fun s hs' => hw s (List.mem_filter.mp hs').1, List.Pairwise.filter _ hu,
    List.Pairwise.filter _ hs⟩

/-- ... and removes: no section with that id is left (sections.test.ts:33),
    and every other section stays. -/
theorem remove_removes (l : List Section) (id : Id) :
    (∀ s ∈ remove l id, s.id ≠ id) ∧ (∀ s ∈ l, s.id ≠ id → s ∈ remove l id) := by
  unfold remove
  constructor
  · intro s hs; simpa using (List.mem_filter.mp hs).2
  · intro s hs hne; exact List.mem_filter.mpr ⟨hs, by simpa using hne⟩

/-! ### `addAll` (sections.ts:121-123) -/

theorem addAll_inv (l : List Section) (ranges : List BarRange) (h : Inv l) :
    Inv (addAll trim l ranges) := by
  unfold addAll
  induction ranges generalizing l with
  | nil => exact h
  | cons r rest ih => exact ih _ (add_inv trim l r "" h)

/-- sections.ts:121 "Every section in `ranges` added to `list`, existing ones
    left as named" / sections.test.ts:92. -/
theorem addAll_keeps (l : List Section) (ranges : List BarRange) :
    ∀ s ∈ l, s ∈ addAll trim l ranges := by
  unfold addAll
  induction ranges generalizing l with
  | nil => intro s hs; exact hs
  | cons r rest ih =>
    intro s hs
    exact ih _ s (add_keeps trim l r "" s hs)

/-! ### `parse` (sections.ts:125-139) -/

/-- What `parse`'s guards admit (sections.ts:135). -/
def Valid (r : BarRange) : Prop :=
  0 ≤ r.from_ ∧ r.from_ ≤ r.to ∧ (∀ q, r.fromBeat = some q → 0 < q) ∧ (∀ q, r.toBeat = some q → 0 < q)

theorem isBar_some (v : JV) (i : Int) (h : isBar v = some i) : 0 ≤ i := by
  unfold isBar at h
  split at h
  · split at h
    · rename_i hc; simp at h; subst h; exact hc.2
    · simp at h
  · simp at h

theorem isTrim_some (v : JV) (o : Option Rat) (h : isTrim v = some o) : ∀ q, o = some q → 0 < q := by
  unfold isTrim at h
  split at h
  · simp at h; subst h; simp
  · split at h
    · rename_i hc; simp at h; subst h; intro q hq; simp at hq; subst hq; exact hc
    · simp at h
  · simp at h

/-- One turn of `parse`'s loop either leaves the list or `add`s a range that
    passed the guards. -/
theorem parseStep_cases (l : List Section) (d : Entry) :
    parseStep trim l d = l
    ∨ ∃ r name, Valid r ∧ parseStep trim l d = add trim l r name := by
  unfold parseStep
  split
  · exact Or.inl rfl
  · split
    · rename_i f t fb tb hf ht hfb htb
      split
      · exact Or.inl rfl
      · rename_i hle
        refine Or.inr ⟨_, _, ⟨isBar_some _ _ hf, by simpa using hle, ?_, ?_⟩, rfl⟩
        · exact isTrim_some _ _ hfb
        · exact isTrim_some _ _ htb
    · exact Or.inl rfl

/-- Every section in the list has a range `parse` would admit. -/
def AllValid (l : List Section) : Prop := ∀ s ∈ l, Valid s.range

theorem add_allValid (l : List Section) (r : BarRange) (name : String)
    (h : AllValid l) (hr : Valid r) : AllValid (add trim l r name) := by
  intro s hs
  unfold add at hs
  simp only at hs
  split at hs
  · exact h s hs
  · have hs' := (inOrder_perm _).mem_iff.mp hs
    rw [List.mem_append] at hs'
    rcases hs' with hs' | hs'
    · exact h s hs'
    · simp at hs'; subst hs'; exact hr

/-- sections.ts:125-127 "What does not parse is dropped, not thrown":
    whatever array it is handed, `parse` returns (it is a total function), the
    list it returns satisfies decision 3's invariants, and every section in it
    passed the guards (sections.test.ts:105). -/
theorem parse_inv (data : List Entry) :
    Inv (parse trim data) ∧ AllValid (parse trim data) := by
  unfold parse
  have gen : ∀ (data : List Entry) (l : List Section), Inv l → AllValid l →
      Inv (data.foldl (parseStep trim) l) ∧ AllValid (data.foldl (parseStep trim) l) := by
    intro data
    induction data with
    | nil => intro l h1 h2; exact ⟨h1, h2⟩
    | cons d rest ih =>
      intro l h1 h2
      simp only [List.foldl_cons]
      rcases parseStep_cases trim l d with he | ⟨r, name, hv, he⟩
      · rw [he]; exact ih l h1 h2
      · rw [he]; exact ih _ (add_inv trim l r name h1) (add_allValid trim l r name h2 hv)
  exact gen data [] inv_nil (by simp [AllValid])

/-- "one bad entry must not cost the learner every other section"
    (sections.ts:127): an entry that does not parse changes nothing. -/
theorem parse_drops_bad (l : List Section) (name : Option String) :
    parseStep trim l { range := none, name := name } = l := rfl

/-! ### The store round trip (section-store.ts:23-40) -/

/-- Names as the operations leave them: already trimmed. -/
def Trimmed (l : List Section) : Prop := ∀ s ∈ l, trim s.name = s.name

theorem isBar_num (i : Int) (h : 0 ≤ i) : isBar (.num (i : Rat)) = some i := by
  simp [isBar, h]

theorem isTrim_optJV (o : Option Rat) (h : ∀ q, o = some q → 0 < q) :
    isTrim (optJV o) = some o := by
  cases o with
  | none => rfl
  | some q => simp [optJV, isTrim, h q rfl]

/-- A saved, valid, trimmed section read back onto the sections before it. -/
theorem parseStep_encode (pre : List Section) (s : Section)
    (hinv : Inv (pre ++ [s])) (hv : Valid s.range) (ht : trim s.name = s.name) :
    parseStep trim pre (encode s) = pre ++ [s] := by
  obtain ⟨hw, hu, hs⟩ := hinv
  obtain ⟨h0, hle, hfb, htb⟩ := hv
  have hsec : sectionOf trim s.range s.name = s := by
    have hid := hw s (by simp)
    cases s with
    | mk id range name =>
      simp only [sectionOf] at *
      rw [ht, hid]
  have hnot : ¬ pre.any (fun x => x.id == (sectionOf trim s.range s.name).id) = true := by
    rw [hsec, any_id_iff]
    rintro ⟨x, hx, he⟩
    unfold Unique at hu
    rw [List.pairwise_append] at hu
    exact hu.2.2 x hx s (by simp) he
  unfold parseStep encode
  simp only [isBar_num _ h0, isBar_num _ (Int.le_trans h0 hle), isTrim_optJV _ hfb,
    isTrim_optJV _ htb, Option.getD_some]
  rw [ifNeg (by omega)]
  have hr : BarRange.mk s.range.from_ s.range.to s.range.fromBeat s.range.toBeat = s.range := rfl
  rw [hr]
  unfold add
  simp only
  rw [ifNeg hnot, hsec]
  exact inOrder_of_sorted _ hs

theorem inv_prefix (pre post : List Section) (h : Inv (pre ++ post)) : Inv pre := by
  obtain ⟨hw, hu, hs⟩ := h
  refine ⟨fun s hs' => hw s (by simp [hs']), ?_, ?_⟩
  · exact (List.pairwise_append.mp hu).1
  · exact (List.pairwise_append.mp hs).1

/-- section-store.ts:13-16 / sections.test.ts:62, 100 "round-trips through
    JSON": what `save` wrote, `load` reads back unchanged — HOLDS ONLY UNDER A
    HYPOTHESIS `add` and `retarget` do not enforce: every range in the list is
    one `parse` admits (`AllValid`: bars `0 <= from <= to`, trims `> 0`). The
    list must also satisfy decision 3's invariants and have trimmed names,
    which the operations do maintain (`add_inv`, ..., `add_trimmed`, ...). -/
theorem load_save_roundtrip (l : List Section)
    (hinv : Inv l) (hv : AllValid l) (ht : Trimmed trim l) :
    loadAfterSave trim l = l := by
  unfold loadAfterSave parse
  have gen : ∀ (post pre : List Section), Inv (pre ++ post) → AllValid post → Trimmed trim post →
      (post.map encode).foldl (parseStep trim) pre = pre ++ post := by
    intro post
    induction post with
    | nil => intro pre _ _ _; simp
    | cons s rest ih =>
      intro pre hinv hv ht
      simp only [List.map_cons, List.foldl_cons]
      have hinv' : Inv ((pre ++ [s]) ++ rest) := by simpa using hinv
      rw [parseStep_encode trim pre s (inv_prefix _ _ hinv') (hv s (by simp)) (ht s (by simp))]
      rw [ih (pre ++ [s]) hinv' (fun x hx => hv x (by simp [hx])) (fun x hx => ht x (by simp [hx]))]
      simp
  simpa using gen l [] (by simpa using hinv) hv ht

/-- FAILS without it. `add` takes any range (sections.ts:84 checks nothing),
    `save` writes it, and `load` — through `parse` — drops it: a section of
    bars `from: 3, to: 1` is saved and never comes back.
    Repro: proofs/repro/sections_roundtrip.ts. -/
theorem FAILS_load_save_roundtrip_unvalidated_range :
    let l := add trim [] { from_ := 3, to := 1 }
    l ≠ [] ∧ loadAfterSave trim l = [] := by
  have hl : add trim [] { from_ := 3, to := 1 } = [sectionOf trim { from_ := 3, to := 1 } ""] := by
    simp [add, inOrder]
  simp only [hl]
  refine ⟨by simp, ?_⟩
  simp [loadAfterSave, parse, parseStep, encode, sectionOf, isBar, isTrim, optJV]

/-- The same for a trim `parse` rejects (`fromBeat: 0`, sections.ts:131). -/
theorem FAILS_load_save_roundtrip_zero_trim :
    let l := add trim [] { from_ := 1, to := 2, fromBeat := some 0 }
    l ≠ [] ∧ loadAfterSave trim l = [] := by
  have hl : add trim [] { from_ := 1, to := 2, fromBeat := some 0 }
      = [sectionOf trim { from_ := 1, to := 2, fromBeat := some 0 } ""] := by
    simp [add, inOrder]
  simp only [hl]
  refine ⟨by simp, ?_⟩
  simp [loadAfterSave, parse, parseStep, encode, sectionOf, isBar, isTrim, optJV]

/-! ### Names stay trimmed (what the round trip needs of them) -/

theorem add_trimmed (htrim : ∀ s, trim (trim s) = trim s)
    (l : List Section) (r : BarRange) (name : String) (h : Trimmed trim l) :
    Trimmed trim (add trim l r name) := by
  intro s hs
  unfold add at hs
  simp only at hs
  split at hs
  · exact h s hs
  · have hs' := (inOrder_perm _).mem_iff.mp hs
    rw [List.mem_append] at hs'
    rcases hs' with hs' | hs'
    · exact h s hs'
    · simp at hs'; subst hs'; exact htrim name

theorem rename_trimmed (htrim : ∀ s, trim (trim s) = trim s)
    (l : List Section) (id : Id) (name : String) (h : Trimmed trim l) :
    Trimmed trim (rename trim l id name) := by
  intro s hs
  unfold rename at hs
  obtain ⟨x, hx, he⟩ := List.mem_map.mp hs
  subst he
  split
  · exact htrim name
  · exact h x hx

theorem remove_trimmed (l : List Section) (id : Id) (h : Trimmed trim l) :
    Trimmed trim (remove l id) :=
  fun s hs => h s (List.mem_filter.mp hs).1

theorem retarget_trimmed (htrim : ∀ s, trim (trim s) = trim s)
    (l : List Section) (id : Id) (r : BarRange) (h : Trimmed trim l) :
    Trimmed trim (retarget trim l id r) := by
  intro s hs
  unfold retarget at hs
  split at hs
  · exact h s hs
  · split at hs
    · exact h s hs
    · have hs' := (inOrder_perm _).mem_iff.mp hs
      rw [List.mem_append] at hs'
      rcases hs' with hs' | hs'
      · exact h s (List.mem_filter.mp hs').1
      · simp at hs'; subst hs'; exact htrim _

/-! ### Score order, "whatever order they were saved in" (sections.test.ts:8) -/

/-- Two lists of the same sections, both satisfying decision 3's invariants
    and with no `fromBeat: 0`, are the same list: the order is the score's,
    not the saving's. HOLDS ONLY UNDER that hypothesis (`tie_iff_same_id`). -/
theorem order_is_canonical (l₁ l₂ : List Section) (h1 : Inv l₁) (h2 : Inv l₂)
    (hz1 : ∀ s ∈ l₁, NoZeroHead s.range)
    (hp : l₁.Perm l₂) : l₁ = l₂ := by
  refine List.Perm.eq_of_pairwise (le := fun a b => le a b = true) ?_ h1.2.2 h2.2.2 hp
  intro a b ha hb hab hba
  have hb1 : b ∈ l₁ := hp.mem_iff.mpr hb
  have hid : a.id = b.id := by
    rw [h1.1 a ha, h1.1 b hb1]
    exact tie_iff_same_id _ _ (hz1 a ha) (hz1 b hb1) ((le_iff a b).mp hab) ((le_iff b a).mp hba)
  -- unique ids: two members with one id are one member
  rcases List.mem_iff_append.mp ha with ⟨p, q, hpq⟩
  by_cases hab' : a = b
  · exact hab'
  · exfalso
    have hu := h1.2.1
    unfold Unique at hu
    rw [hpq] at hu hb1
    rw [List.pairwise_append] at hu
    simp only [List.mem_append, List.mem_cons] at hb1
    rcases hb1 with hb1 | hb1 | hb1
    · exact hu.2.2 b hb1 a (by simp) hid.symm
    · exact hab' hb1.symm
    · exact (List.pairwise_cons.mp hu.2.1).1 b hb1 hid

/-- FAILS without it. sections.test.ts:8 "keeps the list in score order,
    whatever order they were saved in": bars 2–3 and bars 2–3 trimmed to start
    at beat 0 tie under the comparator (`fromBeat ?? 0`, then
    `Infinity - Infinity = NaN`, read by `sort` as equal), so the list keeps
    them in the order they were saved. Repro: proofs/repro/sections_order.ts. -/
theorem FAILS_order_whatever_order_saved :
    let A : BarRange := { from_ := 1, to := 2 }
    let B : BarRange := { from_ := 1, to := 2, fromBeat := some 0 }
    comparator (sectionOf trim A "") (sectionOf trim B "") = .nan
    ∧ add trim (add trim [] A) B = [sectionOf trim A "", sectionOf trim B ""]
    ∧ add trim (add trim [] B) A = [sectionOf trim B "", sectionOf trim A ""] := by
  refine ⟨?_, ?_, ?_⟩ <;>
    simp +decide [add, inOrder, sectionOf, idOf, List.mergeSort,
      List.MergeSort.Internal.splitInTwo, le, comparator, orElseI, orElseR, toBeatDiff,
      Rat.sub_self]

set_option linter.unusedSimpArgs false in
/-- sections.test.ts:8 "keeps the list in score order, whatever order they
    were saved in" and :48 "are their own sections, apart from the whole bars
    around them", run through the model: the ids come out in the order the
    tests expect (`0-1, 0-3, 8-11` and `2-7@2, 2-7, 2@1-7`). -/
theorem order_tests :
    (add trim (add trim (add trim [] ⟨8, 11, none, none⟩) ⟨0, 3, none, none⟩) ⟨0, 1, none, none⟩).map (·.id)
      = [(0, none, 1, none), (0, none, 3, none), (8, none, 11, none)]
    ∧ (add trim (add trim (add trim [] ⟨2, 7, none, none⟩) ⟨2, 7, some 1, none⟩)
        ⟨2, 7, none, some 2⟩).map (·.id)
      = [(2, none, 7, some 2), (2, none, 7, none), (2, some 1, 7, none)] := by
  have e1 : (0 : Rat) - 1 = -1 := by grind
  have e2 : (1 : Rat) - 0 = 1 := by grind
  constructor <;>
    simp +decide [add, inOrder, sectionOf, idOf, List.mergeSort,
      List.MergeSort.Internal.splitInTwo, List.merge, le, comparator, orElseI, orElseR, toBeatDiff,
      Rat.sub_self, e1, e2]

end Proofs

/-! ## `chunk` (sections.ts:111-119) -/

/-- Every run `chunk` cuts: starts at or after `from`, a whole number of runs
    along; is untrimmed; and is `n` bars, or is the last and shorter. -/
theorem chunkLoop_mem (n : Int) (hn : 1 ≤ n) (bars from_ : Int) :
    ∀ r ∈ chunkLoop n hn bars from_,
      (∃ k : Int, 0 ≤ k ∧ r.from_ = from_ + k * n)
      ∧ r.from_ ≤ r.to ∧ r.to ≤ bars - 1
      ∧ r.fromBeat = none ∧ r.toBeat = none
      ∧ (r.to - r.from_ + 1 = n ∨ (r.to = bars - 1 ∧ r.to - r.from_ + 1 < n)) := by
  intro r hr
  rw [chunkLoop] at hr
  split at hr
  · rename_i hlt
    rw [List.mem_cons] at hr
    rcases hr with hr | hr
    · subst hr
      refine ⟨⟨0, by omega, by simp⟩, by simp only; omega, by simp only; omega, rfl, rfl, ?_⟩
      simp only
      omega
    · obtain ⟨⟨k, hk, hke⟩, h2, h3, h4, h5, h6⟩ := chunkLoop_mem n hn bars (from_ + n) r hr
      refine ⟨⟨k + 1, by omega, ?_⟩, h2, h3, h4, h5, h6⟩
      rw [hke, Int.add_mul]; omega
  · simp at hr
termination_by (bars - from_).toNat
decreasing_by omega

/-- How many of the runs contain bar `b`: one if `b` is a bar from `from` on,
    none otherwise. -/
theorem chunkLoop_count (n : Int) (hn : 1 ≤ n) (bars from_ b : Int) :
    ((chunkLoop n hn bars from_).filter (fun r => decide (r.from_ ≤ b ∧ b ≤ r.to))).length
      = if from_ ≤ b ∧ b < bars then 1 else 0 := by
  rw [chunkLoop]
  split
  · rename_i hlt
    have ih := chunkLoop_count n hn bars (from_ + n) b
    rw [List.filter_cons]
    split
    · rename_i hin
      simp only [decide_eq_true_eq] at hin
      rw [List.length_cons, ih]
      rw [ifNeg (by omega), ifPos (by omega)]
    · rename_i hin
      simp only [decide_eq_true_eq] at hin
      rw [ih]
      by_cases hb : from_ ≤ b ∧ b < bars
      · rw [ifPos hb, ifPos (by omega)]
      · rw [ifNeg hb, ifNeg (by omega)]
  · rw [List.filter_nil, List.length_nil, ifNeg (by omega)]
termination_by (bars - from_).toNat
decreasing_by omega

/-- The runs come out in score order, none overlapping the next. -/
theorem chunkLoop_ordered (n : Int) (hn : 1 ≤ n) (bars from_ : Int) :
    (chunkLoop n hn bars from_).Pairwise (fun r s => r.to < s.from_) := by
  rw [chunkLoop]
  split
  · rename_i hlt
    rw [List.pairwise_cons]
    refine ⟨?_, chunkLoop_ordered n hn bars (from_ + n)⟩
    intro s hs
    obtain ⟨⟨k, hk, hke⟩, _⟩ := chunkLoop_mem n hn bars (from_ + n) s hs
    have : 0 ≤ k * n := Int.mul_nonneg hk (by omega)
    simp only
    omega
  · exact List.Pairwise.nil
termination_by (bars - from_).toNat
decreasing_by omega

/-- The run size `chunk` uses: `Math.max(1, Math.floor(size))`. -/
def runSize (size : Rat) : Int := max 1 size.floor

/-- sections.ts:111 "`bars` bars cut into runs of `size`, the last one short
    if it must": the runs are a PARTITION of bars `0 .. bars-1` — every bar of
    the piece is in exactly one run, and no run reaches outside the piece. -/
theorem chunk_partition (bars : Int) (size : Rat) (b : Int) :
    ((chunk bars size).filter (fun r => decide (r.from_ ≤ b ∧ b ≤ r.to))).length
      = if 0 ≤ b ∧ b < bars then 1 else 0 :=
  chunkLoop_count _ _ bars 0 b

/-- sections.ts:111 "runs of `size`, the last one short if it must": every
    run starts on a multiple of the run size, is whole bars, and is exactly
    the run size long — except that the last may be shorter. -/
theorem chunk_runs (bars : Int) (size : Rat) :
    ∀ r ∈ chunk bars size,
      (∃ k : Int, 0 ≤ k ∧ r.from_ = k * runSize size)
      ∧ 0 ≤ r.from_ ∧ r.from_ ≤ r.to ∧ r.to ≤ bars - 1
      ∧ r.fromBeat = none ∧ r.toBeat = none
      ∧ (r.to - r.from_ + 1 = runSize size
          ∨ (r.to = bars - 1 ∧ r.to - r.from_ + 1 < runSize size)) := by
  intro r hr
  obtain ⟨⟨k, hk, hke⟩, h2, h3, h4, h5, h6⟩ := chunkLoop_mem _ _ bars 0 r hr
  have hn : 1 ≤ runSize size := by unfold runSize; omega
  have : 0 ≤ k * runSize size := Int.mul_nonneg hk (by omega)
  refine ⟨⟨k, hk, by simpa [runSize] using hke⟩, ?_, h2, h3, h4, h5, h6⟩
  have hke' : r.from_ = k * runSize size := by simpa [runSize] using hke
  omega

/-- The runs are in score order and disjoint. -/
theorem chunk_ordered (bars : Int) (size : Rat) :
    (chunk bars size).Pairwise (fun r s => r.to < s.from_) :=
  chunkLoop_ordered _ _ bars 0

/-- sections.test.ts:88 "treats a size below one as one bar" — zero and
    negative sizes included. -/
theorem chunk_size_below_one (bars : Int) (size : Rat) (h : size < 1) :
    ∀ r ∈ chunk bars size, r.from_ = r.to := by
  intro r hr
  obtain ⟨_, _, h2, _, _, _, h6⟩ := chunk_runs bars size r hr
  have hf : size.floor < 1 := Rat.floor_lt_iff.mpr (by simpa using h)
  have : runSize size = 1 := by unfold runSize; omega
  omega

/-- A size that is not a whole number cuts runs of its floor
    (`Math.floor(size)`, sections.ts:115). -/
theorem chunk_floor (bars : Int) (size : Rat) : chunk bars size = chunk bars (size.floor : Rat) := by
  unfold chunk
  simp [Rat.floor_intCast]

/-- No bars, no runs. -/
theorem chunk_no_bars (bars : Int) (size : Rat) (h : bars ≤ 0) : chunk bars size = [] := by
  unfold chunk
  rw [chunkLoop, ifNeg (by omega)]

/-- Every run `chunk` cuts is a range `parse` admits, so a split survives the
    store (sections-panel.ts:194, with `load_save_roundtrip`). -/
theorem chunk_valid (bars : Int) (size : Rat) : ∀ r ∈ chunk bars size, Valid r := by
  intro r hr
  obtain ⟨_, h1, h2, _, h4, h5, _⟩ := chunk_runs bars size r hr
  exact ⟨h1, h2, by simp [h4], by simp [h5]⟩

/-- sections.test.ts:84 "cuts runs of the given size, the last one short". -/
theorem chunk_test : chunk 10 4 = [⟨0, 3, none, none⟩, ⟨4, 7, none, none⟩, ⟨8, 9, none, none⟩] := by
  decide +kernel

/-- sections.test.ts:88 -/
theorem chunk_test_zero : chunk 2 0 = [⟨0, 0, none, none⟩, ⟨1, 1, none, none⟩] := by
  decide +kernel

end Harmonicland.Sections
