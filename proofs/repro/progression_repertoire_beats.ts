// Dumps the `beats` of every Change in the real REPERTOIRE as the Lean literal
// `REPERTOIRE_BEATS` used by proofs/Harmonicland/Progression.lean, and checks
// the two facts that file proves about it. Re-run and diff against the Lean
// file to confirm the table is still what the source says.
import { REPERTOIRE } from "/Users/lukesovernconley/Code/harmonicland/src/harmony/repertoire";

console.log("def REPERTOIRE_BEATS : List (List Nat) := [");
console.log(REPERTOIRE.map((p) => `  [${p.changes.map((c) => c.beats).join(", ")}]`).join(",\n"));
console.log("]");
const all = REPERTOIRE.flatMap((p) => p.changes.map((c) => c.beats));
console.log(`-- ${REPERTOIRE.length} progressions, ${all.length} changes; ids in order: ${REPERTOIRE.map((p) => p.id).join(" ")}`);
console.log(`-- every beats is a positive integer: ${all.every((b) => Number.isInteger(b) && b > 0)} (min ${Math.min(...all)}, max ${Math.max(...all)})`);
console.log(`-- every progression's total is a whole number of 4-beat bars: ${REPERTOIRE.every((p) => p.changes.reduce((s, c) => s + c.beats, 0) % 4 === 0)}`);
console.log(`-- home roots: ${[...new Set(REPERTOIRE.map((p) => p.home.root))]}; change key roots all in 0..11: ${REPERTOIRE.every((p) => p.changes.every((c) => Number.isInteger(c.key.root) && c.key.root >= 0 && c.key.root <= 11))}`);
