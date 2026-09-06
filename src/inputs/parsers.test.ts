import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { MidiIn } from "./midi";
import { MusicxmlIn } from "./musicxml";
import { LilyIn } from "./lily";

// sample files live at the project root, where the test runner starts
const sample = (name: string) => readFileSync(join(process.cwd(), name), "utf8");

/* ---- MIDI ----------------------------------------------------------
   Hand-build the smallest valid SMF: one track, division 480 ticks/quarter,
   default tempo (120bpm => a quarter note = 0.5s). One C4 (60) note that is
   on at tick 0 and off at tick 480.  Bytes are written out long-hand so the
   test doubles as a spec of what MidiIn must read. */
function tinyMidi(): ArrayBuffer {
  const bytes = [
    // ---- header chunk ----
    0x4d, 0x54, 0x68, 0x64, // "MThd"
    0x00, 0x00, 0x00, 0x06, // header length = 6
    0x00, 0x00, // format 0
    0x00, 0x01, // 1 track
    0x01, 0xe0, // division = 480 ticks/quarter
    // ---- track chunk ----
    0x4d, 0x54, 0x72, 0x6b, // "MTrk"
    0x00, 0x00, 0x00, 0x0d, // track length = 13 bytes
    0x00, 0x90, 0x3c, 0x64, // dt 0:   note on,  pitch 60, vel 100
    0x83, 0x60, 0x80, 0x3c, 0x00, // dt 480: note off, pitch 60, vel 0
    0x00, 0xff, 0x2f, 0x00, // dt 0:   end of track
  ];
  return new Uint8Array(bytes).buffer;
}

describe("MidiIn", () => {
  it("reads one note with correct pitch and tempo-resolved duration", () => {
    const score = MidiIn.parse(tinyMidi());
    expect(score.notes).toHaveLength(1);
    expect(score.notes[0].pitch).toBe(60);
    expect(score.notes[0].onset).toBeCloseTo(0, 6);
    expect(score.notes[0].duration).toBeCloseTo(0.5, 6); // 480 ticks @ 120bpm
    expect(score.duration).toBeCloseTo(0.5, 6);
  });

  it("assigns the default (sharp) spelling — MIDI carries no spelling", () => {
    const score = MidiIn.parse(tinyMidi());
    expect(score.notes[0].spelling).toEqual({ letter: "C", acc: "" });
  });

  it("states no staff — MIDI has no notion of one", () => {
    const score = MidiIn.parse(tinyMidi());
    expect(score.notes.every((n) => n.staff === undefined)).toBe(true);
  });

  it("rejects non-MIDI bytes", () => {
    const junk = new Uint8Array([1, 2, 3, 4]).buffer;
    expect(() => MidiIn.parse(junk)).toThrow(/MThd/);
  });
});

/* ---- MusicXML ------------------------------------------------------ */
const XML = `<?xml version="1.0"?>
<score-partwise>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note>
      <note><pitch><step>D</step><alter>-1</alter><octave>4</octave></pitch><duration>1</duration></note>
    </measure>
  </part>
</score-partwise>`;

describe("MusicxmlIn", () => {
  it("resolves pitch from step/alter/octave and seconds from divisions+tempo", () => {
    const score = MusicxmlIn.parse(XML);
    expect(score.notes.map((n) => n.pitch)).toEqual([60, 61]); // C4, Db4
    expect(score.notes[0].onset).toBeCloseTo(0, 6);
    expect(score.notes[1].onset).toBeCloseTo(0.5, 6); // 1 div @120bpm = 0.5s
  });

  it("carries the stated spelling — Db is spelled D-flat, NOT C-sharp", () => {
    const score = MusicxmlIn.parse(XML);
    expect(score.notes[1].spelling).toEqual({ letter: "D", acc: "b" });
  });

  it("rejects timewise scores", () => {
    expect(() => MusicxmlIn.parse("<score-timewise></score-timewise>")).toThrow(/partwise/);
  });
});

/* A pickup bar, a two-voice bar written with <backup>, and a second part —
   the three things that make measure timing non-obvious. @120bpm with
   divisions=1, one division = one quarter = 0.5s. */
const XML_BARS = `<?xml version="1.0"?>
<score-partwise>
  <part id="P1">
    <measure number="0">
      <attributes><divisions>1</divisions></attributes>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration></note>
    </measure>
    <measure number="1">
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration></note>
      <backup><duration>4</duration></backup>
      <note><pitch><step>E</step><octave>3</octave></pitch><duration>4</duration></note>
    </measure>
    <measure number="2">
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration></note>
    </measure>
  </part>
  <part id="P2">
    <measure number="0">
      <attributes><divisions>1</divisions></attributes>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>1</duration></note>
    </measure>
  </part>
</score-partwise>`;

describe("MusicxmlIn bar grid", () => {
  it("times each barline, measuring a short pickup honestly", () => {
    const { bars } = MusicxmlIn.parse(XML_BARS);
    expect(bars.map((b) => b.time)).toEqual([0, 0.5, 2.5]); // pickup is one quarter
  });

  it("labels bars with the numbers the score prints, pickup included", () => {
    const { bars } = MusicxmlIn.parse(XML_BARS);
    expect(bars.map((b) => b.label)).toEqual(["0", "1", "2"]);
  });

  it("takes the grid from the first part only — every part shares one", () => {
    const { bars } = MusicxmlIn.parse(XML_BARS);
    expect(bars).toHaveLength(3); // not 4: P2's lone measure adds nothing
  });

  it("does not let a <backup> inside a bar shorten the next barline", () => {
    const score = MusicxmlIn.parse(XML_BARS);
    // both voices of bar 1 start at the barline and run a full 4 divisions
    expect(score.notes.filter((n) => n.onset === 0.5)).toHaveLength(2);
    expect(score.duration).toBeCloseTo(4.5, 6); // bar 2 starts at 2.5 + 2s
  });

  it("falls back to positional numbering when a measure states none", () => {
    const unnumbered = XML_BARS.replace(/ number="\d+"/g, "");
    const { bars } = MusicxmlIn.parse(unnumbered);
    expect(bars.map((b) => b.label)).toEqual(["1", "2", "3"]);
  });

  it("leaves bars empty for formats that carry no measures", () => {
    expect(MidiIn.parse(tinyMidi()).bars).toEqual([]);
    expect(LilyIn.parse(`\\relative c' { c4 d8 e f }`).bars).toEqual([]);
  });
});

/* Two staves in one part, with a voice written ACROSS them: the G3 is the
   left hand's pitch but the right hand's staff. That is the case a pitch
   split gets wrong and <staff> gets right, which is the whole reason the
   field exists. @120bpm with divisions=1, one division = 0.5s. */
const XML_STAVES = `<?xml version="1.0"?>
<score-partwise>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><staves>2</staves></attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><staff>1</staff></note>
      <backup><duration>4</duration></backup>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>2</duration><staff>2</staff></note>
      <note><pitch><step>G</step><octave>3</octave></pitch><duration>2</duration><staff>1</staff></note>
    </measure>
  </part>
</score-partwise>`;

describe("MusicxmlIn staves", () => {
  it("carries <staff> onto the note it is written on", () => {
    const { notes } = MusicxmlIn.parse(XML_STAVES);
    expect(notes.map((n) => [n.pitch, n.staff])).toEqual([
      [72, 1], // C5, upper
      [48, 2], // C3, lower
      [55, 1], // G3 — LOW, and still the upper staff
    ]);
  });

  it("reads the staff per note, never inferring it from pitch", () => {
    const { notes } = MusicxmlIn.parse(XML_STAVES);
    const g3 = notes.find((n) => n.pitch === 55)!;
    const c3 = notes.find((n) => n.pitch === 48)!;
    expect(g3.staff).toBe(1);
    expect(c3.staff).toBe(2);
    expect(g3.pitch).toBeGreaterThan(c3.pitch); // a split at any threshold
    expect(g3.staff).not.toBe(c3.staff); //   would have to agree with itself
  });

  it("leaves staff absent — not undefined-valued — when the part states none", () => {
    const { notes } = MusicxmlIn.parse(XML);
    for (const n of notes) expect("staff" in n).toBe(false);
  });

  it("leaves staff undefined for formats that state no staves", () => {
    expect(MidiIn.parse(tinyMidi()).notes.every((n) => n.staff === undefined)).toBe(true);
    expect(
      LilyIn.parse(`\\relative c' { c4 d8 e f }`).notes.every((n) => n.staff === undefined),
    ).toBe(true);
  });
});

/* ---- LilyPond ------------------------------------------------------ */
describe("LilyIn", () => {
  it("parses relative octaves, durations, and the inherit-previous-duration rule", () => {
    const score = LilyIn.parse(`\\relative c' { c4 d8 e f }`);
    expect(score.notes.map((n) => n.pitch)).toEqual([60, 62, 64, 65]);
    // c4 = 0.5s @120; d8/e/f = 0.25s each (e and f inherit the 8th)
    expect(score.notes.map((n) => +n.duration.toFixed(3))).toEqual([0.5, 0.25, 0.25, 0.25]);
    expect(score.duration).toBeCloseTo(1.25, 6);
  });

  it("carries Dutch-name spellings — cis is C#, des is Db (same pitch, different spelling)", () => {
    const score = LilyIn.parse(`\\relative c' { cis des }`);
    expect(score.notes).toHaveLength(2);
    expect(score.notes[0].spelling).toEqual({ letter: "C", acc: "#" });
    expect(score.notes[1].spelling).toEqual({ letter: "D", acc: "b" });
  });

  it("merges tied notes into one sustained note", () => {
    const score = LilyIn.parse(`\\relative c' { c4 ~ c4 }`);
    expect(score.notes).toHaveLength(1);
    expect(score.notes[0].duration).toBeCloseTo(1.0, 6); // two quarters tied = 1s
  });
});

/* ---- real committed sample files (end-to-end regression) ----------
   These exercise far more of each parser than the minimal fixtures above:
   chords, ties, backup/forward, real spellings, multiple parts/voices. */
describe("sample files parse end to end", () => {
  it("sample-flats.musicxml yields notes, sorted, with flats preserved", () => {
    const score = MusicxmlIn.parse(sample("sample-flats.musicxml"));
    expect(score.notes.length).toBeGreaterThan(0);
    expect(score.duration).toBeGreaterThan(0);
    // onsets are non-decreasing (makeScore sorts)
    for (let i = 1; i < score.notes.length; i++)
      expect(score.notes[i].onset).toBeGreaterThanOrEqual(score.notes[i - 1].onset);
    // the file is named for its flats — at least one should survive as a flat
    expect(score.notes.some((n) => n.spelling.acc === "b")).toBe(true);
  });

  it("sample-flats.musicxml yields a bar grid on the beat (3 bars of 4/4 @96bpm)", () => {
    const score = MusicxmlIn.parse(sample("sample-flats.musicxml"));
    // 4 quarters at 96bpm = 2.5s per bar; the last bar's end IS the duration
    expect(score.bars.map((b) => b.time)).toEqual([0, 2.5, 5]);
    expect(score.duration).toBeCloseTo(7.5, 6);
  });

  it("sample-chromatic.musicxml parses without throwing", () => {
    const score = MusicxmlIn.parse(sample("sample-chromatic.musicxml"));
    expect(score.notes.length).toBeGreaterThan(0);
  });

  // A converter that merges its warnings into stdout (python-ly does) produces
  // a file that *looks* like MusicXML but has plain text before the <?xml.
  // That has to fail loudly — silently skipping to the first tag would let a
  // half-written export through as if it were sound.
  it("rejects MusicXML with converter noise before the XML declaration", () => {
    const junk = "Warning: MarkupCommand not implemented!\nUnknown command: \\sustainOn\n";
    expect(() => MusicxmlIn.parse(junk + sample("sample-flats.musicxml"))).toThrow(/XML/i);
  });

  it("sample-lily.ly yields notes, sorted, with flats preserved", () => {
    const score = LilyIn.parse(sample("sample-lily.ly"));
    expect(score.notes.length).toBeGreaterThan(0);
    expect(score.duration).toBeGreaterThan(0);
    for (let i = 1; i < score.notes.length; i++)
      expect(score.notes[i].onset).toBeGreaterThanOrEqual(score.notes[i - 1].onset);
    expect(score.notes.some((n) => n.spelling.acc === "b")).toBe(true);
  });
});

/* ---- the Chopin prelude (a whole real piece) -----------------------
   scores/chopin_prelude_op28_no4.musicxml is generated from the LilyPond
   source by scores/build_chopin_prelude_op28_no4.py, and it is the one file
   here that exercises everything at once: a pickup bar, two staves, three
   voices, cross-staff writing, ties across a barline, grace notes, triplets,
   and 200 left-hand chords. The earlier python-ly export of it was broken in
   ways that only showed up as *music* — a barline-straddling chord read as
   extra onsets, voices of unequal length drifting the hands apart, a missing
   tempo — so these assertions are about the music, not the markup. */
describe("scores/chopin_prelude_op28_no4.musicxml", () => {
  const QUARTER = 60 / 56; // the score states Largo, quarter = 56
  const chopin = () => MusicxmlIn.parse(sample("scores/chopin_prelude_op28_no4.musicxml"));

  it("reads the stated Largo, not the 120bpm default", () => {
    const score = chopin();
    // pickup quarter, then 25 bars of 2/2; the last bar's whole note ends it
    expect(score.duration).toBeCloseTo(101 * QUARTER, 6);
  });

  it("lays 26 bars on a grid the pickup starts, none drifting", () => {
    const { bars } = chopin();
    expect(bars.map((b) => b.label)).toEqual(
      Array.from({ length: 26 }, (_, i) => String(i)),
    );
    expect(bars[0].time).toBeCloseTo(0, 6);
    for (let i = 1; i < bars.length; i++)
      expect(bars[i].time).toBeCloseTo((1 + 4 * (i - 1)) * QUARTER, 6);
  });

  it("strikes the left hand as chords — eight of three notes in bar 1", () => {
    const score = chopin();
    const bar1 = score.notes.filter(
      (n) => n.onset >= QUARTER - 1e-6 && n.onset < 5 * QUARTER - 1e-6 && n.pitch < 70,
    );
    const onsets = [...new Set(bar1.map((n) => n.onset.toFixed(6)))];
    expect(onsets).toHaveLength(8); // eighth notes, not 24 scattered strikes
    for (const at of onsets) {
      const chord = bar1.filter((n) => n.onset.toFixed(6) === at);
      expect(chord.map((n) => n.pitch).sort((a, b) => a - b)).toEqual([55, 59, 64]);
    }
  });

  it("sustains the melody over those chords, ties included", () => {
    const score = chopin();
    const at = (q: number, pitch: number) =>
      score.notes.find((n) => Math.abs(n.onset - q * QUARTER) < 1e-6 && n.pitch === pitch);
    // bar 1: B4 is a dotted half over the whole first three beats
    expect(at(1, 71)!.duration).toBeCloseTo(3 * QUARTER, 6);
    // bars 8-9: the G#4 is tied across the barline and must read as ONE note
    expect(at(32, 68)!.duration).toBeCloseTo(2 * QUARTER, 6);
    // ...and NOT as a second strike on the downbeat of bar 9
    expect(score.notes.filter((n) => n.pitch === 68 && n.onset > 32.5 * QUARTER
      && n.onset < 34 * QUARTER)).toHaveLength(0);
  });

  it("splits its 598 notes across the two printed staves", () => {
    const { notes } = chopin();
    const onStaff = (k: number) => notes.filter((n) => n.staff === k).length;
    // The file holds 607 <note> elements — 82 on staff 1, 525 on staff 2 —
    // of which 9 never become notes: 5 rests, 2 grace notes, and 2 tie-stops
    // that extend a note already emitted. What survives is 77 + 521 = 598,
    // matching the total asserted below.
    expect(onStaff(1)).toBe(77);
    expect(onStaff(2)).toBe(521);
    expect(onStaff(1) + onStaff(2)).toBe(notes.length);
    expect(notes.every((n) => n.staff !== undefined)).toBe(true);
  });

  it("puts every onset on the notated grid — the two hands never slip", () => {
    const score = chopin();
    // 16ths and eighth-triplets both divide into twelfths of a quarter; an
    // onset off that grid means a voice ran long or a <backup> overshot.
    for (const n of score.notes) {
      const twelfths = (n.onset / QUARTER) * 12;
      expect(Math.abs(twelfths - Math.round(twelfths))).toBeLessThan(1e-6);
    }
    expect(score.notes).toHaveLength(598);
  });
});
