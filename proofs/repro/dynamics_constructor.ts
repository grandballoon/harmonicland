// FAILS_mark_ignores_words_that_are_not_dynamics (proofs/Harmonicland/Dynamics.lean)
// Claim (src/inputs/dynamics.ts:47-48): mark returns "False if it is not a dynamic this
// reader knows, so the caller can ignore it"; dynamics.test.ts:37 "ignores words that are not dynamics".
import { makeDynamics } from "/Users/lukesovernconley/Code/harmonicland/src/inputs/dynamics";
import { LilyIn } from "/Users/lukesovernconley/Code/harmonicland/src/inputs/lily";

const d = makeDynamics();
const known = d.mark("constructor", 0);
const v = d.velocityAt(0);
console.log('input: mark("constructor", 0); velocityAt(0)');
console.log("  claim : mark returns false, velocityAt(0) is undefined (no level recorded)");
console.log("  actual: mark returned", known, "; velocityAt(0) is a", typeof v, "->", String(v).slice(0, 40));
d.mark("sfz", 1);
console.log('then mark("sfz", 1); velocityAt(1) (accented) ->', d.velocityAt(1), "(claim: 96..127)");

const d2 = makeDynamics();
console.log('mark("__proto__", 0) ->', d2.mark("__proto__", 0), "; typeof velocityAt(0):", typeof d2.velocityAt(0));

// Reachability: the LilyPond reader hands every unknown \command to mark (src/inputs/lily.ts:333).
const src = "{ c'4\\constructor d'4 e'4 f'4 }";
console.log("\nLilyPond source:", src);
try {
  const score = LilyIn.parse(src);
  console.log("  claim : the unknown directive is ignored; no note carries a velocity");
  console.log("  actual velocities:", score.notes.map((n) => typeof n.velocity === "function" ? "[Function " + (n.velocity as { name: string }).name + "]" : n.velocity));
} catch (e) {
  console.log("  parse threw:", (e as Error).message);
}
