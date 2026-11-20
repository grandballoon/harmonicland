import Harmonicland
import Lean

/-!
# Audit

Run with `lake env lean Audit.lean` (after `lake build`), or `./check.sh`.

Walks every theorem in the `Harmonicland` namespace — the ones written in the
source and the ones Lean generates from definitions — and lists any that rests
on an axiom other than Lean's three standard ones (`propext`,
`Classical.choice`, `Quot.sound`). A `sorry` would show up here as the axiom
`sorryAx`; `native_decide` as `Lean.ofReduceBool`.
-/

open Lean Elab Command in
elab "#audit" : command => do
  let env ← getEnv
  let standard : List Name := [``propext, ``Classical.choice, ``Quot.sound]
  let mut checked := 0
  let mut fails := 0
  let mut bad : Array (Name × Name) := #[]
  for (name, info) in env.constants.toList do
    unless (`Harmonicland).isPrefixOf name do continue
    unless info matches .thmInfo _ do continue
    checked := checked + 1
    if (name.toString.splitOn "FAILS_").length > 1 && !name.isInternalDetail then fails := fails + 1
    let axs ← liftCoreM (collectAxioms name)
    for a in axs do
      unless standard.contains a do bad := bad.push (name, a)
  if bad.isEmpty then
    logInfo s!"{checked} theorems checked ({fails} of them FAILS_ counterexamples): every one rests on propext, Classical.choice and Quot.sound alone"
  else
    logError s!"NON-STANDARD AXIOMS: {bad}"

#audit
