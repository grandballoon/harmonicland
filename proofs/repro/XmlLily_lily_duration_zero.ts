// An observation outside the Lean model (it needs Infinity): a note written with the
// duration 0 - "c0" - is 4/0 quarters long (src/inputs/lily.ts:70), the piece's end is
// Infinity, and the fence-post loop of lily.ts:356 runs until memory is gone.
import { LilyIn } from "/Users/lukesovernconley/Code/harmonicland/src/inputs/lily";
import { guarded, isChild } from "./_parsers_env";

const src = "{ c0 }";
if (!isChild()) console.log("input :", src);
guarded(import.meta.url, "LilyIn.parse", () => {
  const s = LilyIn.parse(src);
  return { notes: s.notes.length, bars: s.bars.length };
});
if (!isChild()) console.log("expect: parse returns a Score or throws");
