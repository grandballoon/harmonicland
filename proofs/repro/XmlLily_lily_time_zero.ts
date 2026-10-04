// Repro for FAILS_fence_loop_terminates (proofs/Harmonicland/XmlLily.lean).
// Claim under test: LilyIn.parse returns or throws for every text.
import { LilyIn } from "/Users/lukesovernconley/Code/harmonicland/src/inputs/lily";
import { guarded, isChild } from "./_parsers_env";

const src = "{ \\time 0/4 c4 }";
if (!isChild()) console.log("input :", src);
guarded(import.meta.url, "LilyIn.parse", () => {
  const s = LilyIn.parse(src);
  return { notes: s.notes.length, bars: s.bars.length };
});
if (!isChild()) console.log("claim : parse returns a Score or throws");
