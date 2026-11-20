// Repro for FAILS_voices_meet_on_the_beat (proofs/Harmonicland/XmlLily.lean).
// Claim (src/inputs/musicxml.ts:55 "tempo is a property of time, not of a part"): notes
// written on the same beat of a measure sound together.
import { dom } from "./_parsers_env";
dom();
const { MusicxmlIn } = await import("/Users/lukesovernconley/Code/harmonicland/src/inputs/musicxml");

const n = (step: string, staff: number) =>
  `<note><pitch><step>${step}</step><octave>${staff === 1 ? 5 : 3}</octave></pitch><duration>1</duration><voice>${staff}</voice><staff>${staff}</staff></note>`;
// One 4/4 measure of a two-staff part. Staff 1: four quarters, with a tempo mark
// (120 -> 60) between the second and the third. <backup> four quarters. Staff 2: four quarters.
const xml = `<?xml version="1.0"?><score-partwise><part id="P1"><measure number="1">
  <attributes><divisions>1</divisions><staves>2</staves></attributes>
  <direction><sound tempo="120"/></direction>
  ${n("C", 1)}${n("D", 1)}
  <direction><sound tempo="60"/></direction>
  ${n("E", 1)}${n("F", 1)}
  <backup><duration>4</duration></backup>
  ${n("C", 2)}${n("D", 2)}${n("E", 2)}${n("F", 2)}
</measure></part></score-partwise>`;
const s = MusicxmlIn.parse(xml);
const of = (hand: string) => s.notes.filter((x) => x.hand === hand).map((x) => x.onset);
console.log("input : staff 1 = q q [tempo 120->60] q q ; backup 4 ; staff 2 = q q q q");
console.log("actual: upper-staff onsets", JSON.stringify(of("upper")), " lower-staff onsets", JSON.stringify(of("lower")),
  " bars", JSON.stringify(s.bars.map((b) => [b.start, b.end])));
console.log("claim : beat k of each staff at the same second: both [0, 0.5, 1, 2], one bar [0, 3]");
console.log(JSON.stringify(of("upper")) === JSON.stringify(of("lower")) ? "CLAIM HOLDS" : "CLAIM FAILS");
