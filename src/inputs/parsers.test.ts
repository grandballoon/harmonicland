import { readFileSync } from "node:fs";
import { join } from "node:path";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { describe, it, expect } from "vitest";
import { MidiIn } from "./midi";
import { MusicxmlIn } from "./musicxml";
import { LilyIn } from "./lily";
import { MxlIn } from "./mxl";

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

/** An SMF with one track holding exactly `events` (delta-times included),
 *  so a test can state a meta event long-hand and nothing else. */
function midiOf(events: number[]): ArrayBuffer {
  const track = [...events, 0x00, 0xff, 0x2f, 0x00];
  const bytes = [
    0x4d, 0x54, 0x68, 0x64, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00, 0x01, 0x01, 0xe0,
    0x4d, 0x54, 0x72, 0x6b, (track.length >>> 24) & 0xff, (track.length >>> 16) & 0xff,
    (track.length >>> 8) & 0xff, track.length & 0xff, ...track,
  ];
  return new Uint8Array(bytes).buffer;
}
const spans = (s: { bars: readonly { start: number; end: number }[] }) =>
  s.bars.map((b) => [+b.start.toFixed(6), +b.end.toFixed(6)]);

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

  it("rejects non-MIDI bytes", () => {
    const junk = new Uint8Array([1, 2, 3, 4]).buffer;
    expect(() => MidiIn.parse(junk)).toThrow(/MThd/);
  });

  it("records the source track as `stream` and resolves the hand from it", () => {
    const score = MidiIn.parse(tinyMidi());
    expect(score.notes[0].stream).toBe(1);
    // the lowest NOTE-BEARING track is the upper hand — a format-1 file's
    // track 1 is a tempo track and bears none, so the number alone can't say.
    expect(score.notes[0].hand).toBe("upper");
  });

  it("assumes 4/4 when the file states no meter, and runs the last bar full length", () => {
    // one quarter note in an unstated meter: a whole 4/4 bar of 2s at 120
    expect(spans(MidiIn.parse(tinyMidi()))).toEqual([[0, 2]]);
  });

  it("lays barlines from the time-signature meta event", () => {
    // 3/4, then a note four quarters long (1920 ticks): it crosses one bar
    // line at 1.5s and the second bar runs to 3.0 even though the note
    // stops at 2.0.
    const score = MidiIn.parse(midiOf([
      0x00, 0xff, 0x58, 0x04, 0x03, 0x02, 0x18, 0x08, // 3/4
      0x00, 0x90, 0x3c, 0x64,
      0x8f, 0x00, 0x80, 0x3c, 0x00, // dt 1920
    ]));
    expect(spans(score)).toEqual([[0, 1.5], [1.5, 3]]);
  });

  it("reads a compound meter's denominator as a power of two", () => {
    // 6/8 = three quarters a bar = 1.5s at 120
    const score = MidiIn.parse(midiOf([
      0x00, 0xff, 0x58, 0x04, 0x06, 0x03, 0x18, 0x08,
      0x00, 0x90, 0x3c, 0x64,
      0x83, 0x60, 0x80, 0x3c, 0x00, // dt 480
    ]));
    expect(spans(score)).toEqual([[0, 1.5]]);
  });

  it("times barlines through the tempo map, like the notes", () => {
    // 240bpm: a 4/4 bar is one second, and the quarter note a quarter of it
    const score = MidiIn.parse(midiOf([
      0x00, 0xff, 0x51, 0x03, 0x03, 0xd0, 0x90, // 250000 us/quarter
      0x00, 0x90, 0x3c, 0x64,
      0x83, 0x60, 0x80, 0x3c, 0x00,
    ]));
    expect(score.notes[0].duration).toBeCloseTo(0.25, 6);
    expect(spans(score)).toEqual([[0, 1]]);
  });

  it("changes bar length at a mid-piece meter change", () => {
    // one 4/4 bar (1920 ticks), then 2/4 from there: bars of 2s then 1s
    const score = MidiIn.parse(midiOf([
      0x00, 0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08,
      0x00, 0x90, 0x3c, 0x64,
      0x8f, 0x00, 0xff, 0x58, 0x04, 0x02, 0x02, 0x18, 0x08, // dt 1920: 2/4
      0x87, 0x40, 0x80, 0x3c, 0x00, // dt 960
    ]));
    expect(spans(score)).toEqual([[0, 2], [2, 3]]);
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

  it("lays a barline at each measure, the pickup as short as it is", () => {
    // an eighth-note pickup, then a measure of two quarters
    const score = MusicxmlIn.parse(`<score-partwise><part id="P1">
      <measure number="0" implicit="yes"><attributes><divisions>2</divisions></attributes>
        <note><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration></note></measure>
      <measure number="1">
        <note><pitch><step>C</step><octave>5</octave></pitch><duration>2</duration></note>
        <note><pitch><step>E</step><octave>5</octave></pitch><duration>2</duration></note></measure>
    </part></score-partwise>`);
    expect(spans(score)).toEqual([[0, 0.25], [0.25, 1.25]]);
  });

  it("takes its bars from the first part alone", () => {
    const part = (id: string) =>
      `<part id="${id}"><measure number="1"><attributes><divisions>1</divisions></attributes>
       <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note></measure></part>`;
    const score = MusicxmlIn.parse(`<score-partwise>${part("P1")}${part("P2")}</score-partwise>`);
    expect(spans(score)).toEqual([[0, 0.5]]);
  });

  it("maps a multi-staff part's <staff> to hands (1 = upper, rest = lower)", () => {
    const score = MusicxmlIn.parse(`<score-partwise><part id="P1"><measure number="1">
      <attributes><divisions>1</divisions></attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration><staff>1</staff></note>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>1</duration><staff>2</staff></note>
    </measure></part></score-partwise>`);
    expect(score.notes.map((n) => n.stream)).toEqual([1, 2]);
    expect(score.notes.map((n) => n.hand)).toEqual(["upper", "lower"]);
  });

  it("falls back to the part ordinal when notes have no <staff>", () => {
    const part = (id: string, step: string) =>
      `<part id="${id}"><measure number="1"><attributes><divisions>1</divisions></attributes>
       <note><pitch><step>${step}</step><octave>4</octave></pitch><duration>1</duration></note></measure></part>`;
    const score = MusicxmlIn.parse(`<score-partwise>${part("P1", "C")}${part("P2", "E")}</score-partwise>`);
    expect(new Set(score.notes.map((n) => n.stream))).toEqual(new Set([1, 2]));
    expect(score.notes.map((n) => n.hand)).toEqual(["upper", "lower"]);
  });

  /* The bug the per-part decision fixes: an SATB export where every part
     declares <staff>1</staff> used to collapse onto one hand, because the
     per-note fallback let the <staff> namespace and the part-ordinal
     namespace coexist inside a single score. The hand is now decided once
     per part, so parts without their own staves still split. */
  it("splits four single-staff parts by ordinal even when each declares <staff>1</staff>", () => {
    const part = (id: string, step: string, octave: number) =>
      `<part id="${id}"><measure number="1"><attributes><divisions>1</divisions></attributes>
       <note><pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>1</duration>
       <staff>1</staff></note></measure></part>`;
    const score = MusicxmlIn.parse(
      `<score-partwise>${part("P1", "C", 5)}${part("P2", "A", 4)}` +
      `${part("P3", "E", 4)}${part("P4", "C", 3)}</score-partwise>`);
    expect(score.notes.map((n) => n.stream)).toEqual([1, 2, 3, 4]);
    expect(score.notes.map((n) => n.hand)).toEqual(["upper", "lower", "lower", "lower"]);
  });
});

/* ---- compressed MusicXML (.mxl = ZIP) ------------------------------
   Hand-build minimal archives, so the test doubles as a spec of what the
   ZIP reader must handle: local headers, central directory, EOCD, stored
   and deflated entries. Inflation is injected from node:zlib because Node
   18's DecompressionStream lacks "deflate-raw" (browsers have it). */
const nodeInflateRaw = async (d: Uint8Array) => new Uint8Array(inflateRawSync(d));

function tinyZip(files: { name: string; text: string; deflate?: boolean }[]): ArrayBuffer {
  const enc = new TextEncoder();
  const u16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
  const u32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
  const parts: Uint8Array[] = [];
  const central: number[] = [];
  let offset = 0;
  for (const f of files) {
    const name = [...enc.encode(f.name)];
    const raw = enc.encode(f.text);
    const data = f.deflate ? new Uint8Array(deflateRawSync(raw)) : raw;
    const method = f.deflate ? 8 : 0;
    // local file header: sig, version, flags, method, time, date, crc
    // (unchecked by the reader), sizes, name-/extra-length, name
    const local = new Uint8Array([
      ...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(method), ...u16(0), ...u16(0),
      ...u32(0), ...u32(data.length), ...u32(raw.length), ...u16(name.length), ...u16(0),
      ...name,
    ]);
    // central directory header: adds version-made-by, comment/disk/attr
    // fields (all zero here) and the local header's offset
    central.push(
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(method), ...u16(0), ...u16(0),
      ...u32(0), ...u32(data.length), ...u32(raw.length), ...u16(name.length), ...u16(0), ...u16(0),
      ...u16(0), ...u16(0), ...u32(0), ...u32(offset),
      ...name,
    );
    parts.push(local, data);
    offset += local.length + data.length;
  }
  parts.push(new Uint8Array([
    ...central,
    // EOCD: sig, disk numbers, entry counts, central dir size + offset, comment length
    ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length),
    ...u32(central.length), ...u32(offset), ...u16(0),
  ]));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let p = 0;
  for (const part of parts) { out.set(part, p); p += part.length; }
  return out.buffer;
}

const CONTAINER = `<?xml version="1.0"?>
<container><rootfiles><rootfile full-path="score.musicxml"/></rootfiles></container>`;

describe("MxlIn", () => {
  it("extracts the rootfile the META-INF manifest names, deflated, and it parses", async () => {
    const mxl = tinyZip([
      { name: "mimetype", text: "application/vnd.recordare.musicxml" },
      { name: "META-INF/container.xml", text: CONTAINER, deflate: true },
      { name: "score.musicxml", text: XML, deflate: true },
    ]);
    const xml = await MxlIn.extract(mxl, nodeInflateRaw);
    const score = MusicxmlIn.parse(xml);
    expect(score.notes.map((n) => n.pitch)).toEqual([60, 61]);
  });

  it("falls back to the first non-META-INF *.xml when the manifest is absent", async () => {
    const mxl = tinyZip([{ name: "piece.xml", text: XML }]); // stored, no manifest
    expect(await MxlIn.extract(mxl, nodeInflateRaw)).toBe(XML);
  });

  it("rejects an archive with no MusicXML document", async () => {
    const mxl = tinyZip([{ name: "readme.txt", text: "hi" }]);
    await expect(MxlIn.extract(mxl, nodeInflateRaw)).rejects.toThrow(/No MusicXML/);
  });

  it("rejects non-ZIP bytes", async () => {
    await expect(MxlIn.extract(new Uint8Array(64).buffer)).rejects.toThrow(/ZIP/);
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

  it("assumes common time when no \\time is given", () => {
    // five quarters at 120: a 2s bar and the start of another
    expect(spans(LilyIn.parse(`\\relative c' { c4 d e f g }`))).toEqual([[0, 2], [2, 4]]);
  });

  it("lays barlines from \\time at the tempo in force", () => {
    expect(spans(LilyIn.parse(`\\relative c' { \\time 3/4 c4 d e f g a }`))).toEqual([[0, 1.5], [1.5, 3]]);
    expect(spans(LilyIn.parse(`\\tempo 4 = 60 \\relative c' { \\time 2/4 c4 d e f }`))).toEqual([[0, 2], [2, 4]]);
  });

  it("makes the first bar a pickup under \\partial", () => {
    expect(spans(LilyIn.parse(`\\relative c' { \\partial 4 c4 d e f g }`))).toEqual([[0, 0.5], [0.5, 2.5]]);
  });

  it("does not take bar checks for barlines", () => {
    // the `|` is an assertion the author may put anywhere or omit
    expect(spans(LilyIn.parse(`\\relative c' { \\time 2/4 c4 | d | e f }`))).toEqual([[0, 1], [1, 2]]);
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

  it("sample-chromatic.musicxml parses without throwing", () => {
    const score = MusicxmlIn.parse(sample("sample-chromatic.musicxml"));
    expect(score.notes.length).toBeGreaterThan(0);
  });

  it("every sample's bars start at 0, abut, and cover the piece", () => {
    const midi = readFileSync(join(process.cwd(), "scores/chopin_prelude_4.midi"));
    const scores = [
      MidiIn.parse(midi.buffer.slice(midi.byteOffset, midi.byteOffset + midi.byteLength)),
      MusicxmlIn.parse(sample("sample-flats.musicxml")),
      LilyIn.parse(sample("sample-lily.ly")),
    ];
    for (const s of scores) {
      expect(s.bars.length).toBeGreaterThan(1);
      expect(s.bars[0].start).toBe(0);
      for (let i = 1; i < s.bars.length; i++) expect(s.bars[i].start).toBe(s.bars[i - 1].end);
      expect(s.bars[s.bars.length - 1].end).toBeGreaterThanOrEqual(s.duration);
      expect(s.bars.map((b) => b.index)).toEqual(s.bars.map((_, i) => i));
    }
    // the Chopin prelude is 25 bars of 2/2 plus its held final chord
    expect(scores[0].bars).toHaveLength(26);
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
