// Repro for Progression.lean: FAILS_keySignature_Gflat_wins_tie and
// FAILS_keySignature_fewer_accidentals.
// Claim (progression.ts:271-273): "Chosen by pitch class, so an enharmonic
// tonic takes the side of the circle with fewer accidentals (G♭, six flats,
// over F♯'s six sharps only by the tie-break below)."
import { keySignature, transposeTo, realize } from "/Users/lukesovernconley/Code/harmonicland/src/harmony/progression";
import { progressionById } from "/Users/lukesovernconley/Code/harmonicland/src/harmony/repertoire";
import { PITCH_NAMES, type ScaleType } from "/Users/lukesovernconley/Code/harmonicland/src/harmony/perfecto";

const show = (root: number, scale: ScaleType, claim: string): void => {
  const f = keySignature({ root, scale });
  const other = f > 0 ? f - 12 : f + 12;
  console.log(`keySignature({root: ${root} (${PITCH_NAMES[root]}), scale: "${scale}"}) = ${f}` +
    `   enharmonic alternative: ${other}   claim: ${claim}`);
};
show(6, "major", "-6 (G♭, six flats, wins the tie)");
show(8, "naturalMinor", "the side with fewer accidentals, i.e. +5");
show(8, "harmonicMinor", "the side with fewer accidentals, i.e. +5");
show(1, "dorian", "the side with fewer accidentals, i.e. +5");
show(6, "lydian", "the side with fewer accidentals, i.e. -5");
console.log("-- control --");
show(1, "major", "-5 (D♭ rather than C♯'s seven sharps)");
show(3, "naturalMinor", "-6 or +6 (a tie)");

console.log("-- through the real caller path (main.ts:784-785: transposeTo then realize) --");
for (const [id, root] of [["aeolian", 8], ["blues-minor", 8], ["dorian-vamp", 1], ["lydian", 6], ["four-chords", 6]] as const) {
  const p = transposeTo(progressionById(id)!, root);
  const b = realize(p).barlines[0];
  console.log(`"${id}" with the key picker on ${PITCH_NAMES[root]}: home = ${JSON.stringify(p.home)}, barlines[0] = ${JSON.stringify(b)}`);
}
