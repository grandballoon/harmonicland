# Conventions for the Lean models

Each file under `Harmonicland/` models one or more TypeScript modules from `../src`.
Lean cannot read TypeScript, so every model is a hand translation, and a proof is only as good as that translation.
These rules keep the translation honest and checkable.

## Translation

- Translate line by line, keeping the TypeScript's names, and cite the source above every definition: `-- src/core.ts:129`.
- Model a JavaScript `number` used as time, beats or pixels as `Rat` (exact rationals), and one used as an index, count, pitch or velocity as `Int` or `Nat`.
- State what the model leaves out in the file's header: floating-point rounding, `NaN`, `Infinity`, the DOM, audio devices, wall-clock time.
- Model mutable module state as an explicit state record and each exported function as a transition on it.
- Do not simplify the code while translating it.
  A model that is "obviously equivalent" to the source is a second program, and the proof is then about the wrong one.

## Claims

- Every theorem states a claim the codebase itself makes: a doc comment, a header comment, a type's documentation, a test's name, or an invariant a caller visibly relies on.
- Quote the claim and its location in the theorem's doc comment.
- Do not invent properties the code never promises and then report that they fail.

## Outcomes

A claim ends in exactly one of three states, and the theorem's name says which.

- **Holds.**
  An ordinary `theorem`, proved without `sorry`.
- **Holds only under a hypothesis the code does not enforce.**
  Prove it with the hypothesis, name the hypothesis in the doc comment, and add a `FAILS_` theorem showing a counterexample without it.
- **Fails.**
  A theorem named `FAILS_<what>` that proves the negation of the claim from a concrete counterexample.

Every `FAILS_` theorem has a matching script in `repro/` that runs the real TypeScript on the same counterexample and prints what happens, so a failure is shown twice: once in the model and once in the code.
A counterexample that does not reproduce in the real code is a modelling error, and the model is fixed.

## Proof hygiene

- No `sorry`, no `axiom`, no `unsafe`, no `partial def` for anything a theorem talks about.
- Prefer `decide` to `native_decide`; where `native_decide` is unavoidable, say so beside it.
- Lean core only: the toolchain is pinned in `lean-toolchain` and there are no dependencies.
