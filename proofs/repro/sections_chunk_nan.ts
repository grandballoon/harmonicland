// OBSERVATION outside the Lean model (NaN / non-integer inputs), beside chunk_partition
// (proofs/Harmonicland/Sections.lean). The model takes `size` finite and `bars` an integer.
import { chunk } from "/Users/lukesovernconley/Code/harmonicland/src/sections";
console.log("chunk(5, NaN)  =", JSON.stringify(chunk(5, NaN)), " <- one range, to: NaN (JSON prints null)");
console.log("chunk(5, NaN)[0].to =", chunk(5, NaN)[0].to);
console.log("chunk(2.5, 1)  =", JSON.stringify(chunk(2.5, 1)), " <- last range has from 2 > to 1.5");
console.log("chunk(5, Infinity) =", JSON.stringify(chunk(5, Infinity)));
console.log("chunk(5, 2.9)  =", JSON.stringify(chunk(5, 2.9)), " (floor: runs of 2; chunk_floor)");
console.log("chunk(5, -3)   =", JSON.stringify(chunk(5, -3)), " (one bar each; chunk_size_below_one)");
console.log("The one caller (sections-panel.ts:192-194) passes parseInt(...) guarded by Number.isFinite && >= 1, and score.bars.length.");
