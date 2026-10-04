// Repro for FAILS_makeBars_loop_ends_on_infinite_duration (proofs/Harmonicland/XmlLily.lean).
// Claim under test: MusicxmlIn.parse returns or throws for every document.
import { dom, guarded, isChild } from "./_parsers_env";
dom();
const { MusicxmlIn } = await import("/Users/lukesovernconley/Code/harmonicland/src/inputs/musicxml");

// One measure: a whole note C, and an E in the same chord whose <duration> is "Infinity"
// (parseFloat reads it, as it reads "1e999"). The chord note does not move the cursor, so
// the barline posts are [0, 2] while the note - and so the score - lasts for ever.
const xml = `<?xml version="1.0"?><score-partwise><part id="P1"><measure number="1">
  <attributes><divisions>1</divisions></attributes>
  <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration></note>
  <note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>Infinity</duration></note>
</measure></part></score-partwise>`;
if (!isChild()) console.log("input : a C whole note with a <chord/> E whose <duration> is Infinity");
guarded(import.meta.url, "MusicxmlIn.parse", () => {
  const s = MusicxmlIn.parse(xml);
  return { notes: s.notes.length, bars: s.bars.length, duration: String(s.duration) };
});
if (!isChild()) console.log("claim : parse returns a Score or throws");
