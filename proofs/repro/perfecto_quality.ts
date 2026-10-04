// Repro for Perfecto.lean: FAILS_base_cell_is_diatonic_on_minor_III and
// FAILS_quality_correct_for_pentatonic.
// Claims: perfecto.ts:12 "The diatonic 3rd/5th above the root decide
// major/minor/dim"; perfecto.ts:143 "Honors the same short-scale octave-wrap
// as the voicing math, so it's correct for pentatonic/blues too."
import {
  SCALE_INTERVALS, PITCH_NAMES, degreeOffsetOf, degreeQuality, degreeNumeral, chordIntervals,
  chordName, computeVoicing, type Degree, type Key, type ScaleType,
} from "/Users/lukesovernconley/Code/harmonicland/src/harmony/perfecto";

function show(scale: ScaleType, degree: Degree): void {
  const key: Key = { root: 0, scale };
  const sc = SCALE_INTERVALS[scale], n = sc.length, i = degree - 1;
  const at = (k: number): number => sc[k % n] + Math.floor(k / n) * 12;
  const stacked = [0, at(i + 2) - at(i), at(i + 4) - at(i)];
  const sounded = chordIntervals(key, degree, "default", "center");
  const notes = computeVoicing({
    key, degree, joystickMode: "default", joystickDirection: "center",
    inversion: "root", octave: 4, voiceLeading: false,
  }).notes;
  const off = degreeOffsetOf(key, degree);
  const outside = sounded.map((x) => (off + x) % 12).filter((pc) => !sc.includes(pc));
  console.log(`C ${scale}, degree ${degree}: scale = [${sc}]`);
  console.log(`  triad the scale stacks on it (semitones above its root): [${stacked}]`);
  console.log(`  degreeQuality = "${degreeQuality(key, degree)}", numeral "${degreeNumeral(key, degree)}", name "${chordName(key, degree, "default", "center")}"`);
  console.log(`  base cell sounds [${sounded}] -> notes [${notes}] (${notes.map((p) => PITCH_NAMES[p % 12]).join(" ")})`);
  console.log(`  claim: the sounded triad is the stacked one. actual: ${JSON.stringify(sounded) === JSON.stringify(stacked) ? "same" : "DIFFERENT"}; pitch classes sounded that are NOT in the scale: [${outside}]`);
}

show("harmonicMinor", 3);
show("melodicMinor", 3);
show("minorPentatonic", 1);
show("blues", 1);
console.log("-- control --");
show("major", 1);
show("naturalMinor", 1);
