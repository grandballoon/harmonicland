// Repro for FAILS_onsets_from_start (proofs/Harmonicland/XmlLily.lean).
// Claim (src/types.ts:54): a note's onset is "seconds from start" - never negative.
import { dom } from "./_parsers_env";
dom();
const { MusicxmlIn } = await import("/Users/lukesovernconley/Code/harmonicland/src/inputs/musicxml");

const n = (step: string, dur: string) =>
  `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>${dur}</duration></note>`;
const wrap = (body: string) =>
  `<?xml version="1.0"?><score-partwise><part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes>${body}</measure></part></score-partwise>`;
const show = (label: string, xml: string) => {
  const s = MusicxmlIn.parse(xml);
  console.log(`input : ${label}`);
  console.log("actual:", JSON.stringify(s.notes.map((x) => ({ pitch: x.pitch, onset: x.onset, duration: x.duration }))),
    " score.duration =", s.duration, " bars", JSON.stringify(s.bars.map((b) => [b.start, b.end])));
  return s.notes.every((x) => x.onset >= 0);
};
const a = show('<sound tempo="-60"/> then C (1 division), D (1 division)', wrap(`<sound tempo="-60"/>${n("C", "1")}${n("D", "1")}`));
const b = show("C with <duration>-4</duration>, then D (1 division)", wrap(`${n("C", "-4")}${n("D", "1")}`));
console.log("claim : every onset >= 0");
console.log(a && b ? "CLAIM HOLDS" : "CLAIM FAILS");
