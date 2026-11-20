// Repro for FAILS_printedAt_is_engraveBars_rule (proofs/Harmonicland/Engrave.lean).
// Claim (src/outputs/engrave.ts:205-209): printedAt is "the rule engraveBar prints by,
// asked of one head that is not in the bar".
import { Core } from "/Users/lukesovernconley/Code/harmonicland/src/core";
import { engraveBar, printedAt } from "/Users/lukesovernconley/Code/harmonicland/src/outputs/engrave";

const C = { letter: "C", acc: "" } as const;
const Cs = { letter: "C", acc: "#" } as const;
const first = [
  { pitch: 60, onset: 0, duration: 0.5, hand: "lower", spelling: C }, // left hand C4
  { pitch: 61, onset: 0, duration: 0.5, hand: "upper", spelling: Cs }, // right hand C#4
] as const;

// (a) the C natural IS in the bar, a quarter later: what engraveBar prints on it
const a = Core.makeScore([...first, { pitch: 60, onset: 0.5, duration: 0.5, hand: "upper", spelling: C }], [0, 2]);
const inBar = engraveBar(a.notes, a.bars[0]).chords.flatMap((c) => c.heads).find((h) => h.q === 1)!;

// (b) the same C natural is NOT in the bar (an E is there instead): what printedAt says
const b = Core.makeScore([...first, { pitch: 64, onset: 0.5, duration: 0.5, hand: "upper" }], [0, 2]);
const asked = printedAt(engraveBar(b.notes, b.bars[0]), 1, { letter: "C", acc: "", octave: 4 });

console.log("input : 4/4, no key signature; at q=0 left hand C4 (natural) with right hand C#4; then a C natural 4 at q=1");
console.log("actual: engraveBar prints", JSON.stringify(inBar.acc), "on the C natural; printedAt answers", JSON.stringify(asked));
console.log("claim : the two agree");
console.log(inBar.acc === asked ? "CLAIM HOLDS" : "CLAIM FAILS");
