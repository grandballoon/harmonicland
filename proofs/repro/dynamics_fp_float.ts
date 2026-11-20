// OBSERVATION outside the Lean model (floating point), beside fp_accented_xor_piano
// (proofs/Harmonicland/Dynamics.lean). In exact arithmetic a note at t >= a is EITHER the
// fp's accented note OR already hears its "p" (src/inputs/dynamics.ts:91-92). In doubles the
// three rounded expressions (a + SAME_TIME * 2, t + SAME_TIME, Math.abs(a - t)) can disagree
// at the boundary t ~ a + 1e-6. With ff (112) in force and an fp at `a`:
//   127 = accented, p not yet in force (as documented)      49 = unaccented, p in force (as documented)
//    96 = accented AND p in force (overlap)                 112 = neither: unaccented, still ff (gap)
import { makeDynamics } from "/Users/lukesovernconley/Code/harmonicland/src/inputs/dynamics";

const buf = new DataView(new ArrayBuffer(8));
const next = (x: number, k: number): number => {
  buf.setFloat64(0, x);
  buf.setBigInt64(0, buf.getBigInt64(0) + BigInt(k));
  return buf.getFloat64(0);
};
let overlap = 0, gap = 0, tried = 0;
const shown: string[] = [];
for (const a of [0.5, 1, 2, 3.75, 10, 60, 61.3, 127.9, 300, 1000, 3600]) {
  const d = makeDynamics();
  d.mark("ff", 0);
  d.mark("fp", a);
  const edge = a + 1e-6;
  for (let k = -200; k <= 200; k++) {
    const t = next(edge, k);
    const v = d.velocityAt(t);
    tried++;
    if (v === 96) { overlap++; if (shown.length < 3) shown.push(`a=${a} t=${t} -> 96 (accented AND p in force)`); }
    if (v === 112) { gap++; if (shown.length < 6) shown.push(`a=${a} t=${t} -> 112 (neither)`); }
  }
}
console.log(`tried ${tried} doubles within 200 ulps of a + 1e-6: overlap ${overlap}, gap ${gap}`);
for (const s of shown) console.log("  " + s);
