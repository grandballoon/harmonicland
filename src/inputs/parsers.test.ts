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

  it("records the source track as `staff` (piano exports split hands by track)", () => {
    expect(MidiIn.parse(tinyMidi()).notes[0].staff).toBe(1);
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

  it("carries <staff> per note (piano: 1 = right hand, 2 = left)", () => {
    const score = MusicxmlIn.parse(`<score-partwise><part id="P1"><measure number="1">
      <attributes><divisions>1</divisions></attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration><staff>1</staff></note>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>1</duration><staff>2</staff></note>
    </measure></part></score-partwise>`);
    expect(score.notes.map((n) => n.staff)).toEqual([1, 2]);
  });

  it("falls back to the part ordinal when notes have no <staff>", () => {
    const part = (id: string, step: string) =>
      `<part id="${id}"><measure number="1"><attributes><divisions>1</divisions></attributes>
       <note><pitch><step>${step}</step><octave>4</octave></pitch><duration>1</duration></note></measure></part>`;
    const score = MusicxmlIn.parse(`<score-partwise>${part("P1", "C")}${part("P2", "E")}</score-partwise>`);
    expect(new Set(score.notes.map((n) => n.staff))).toEqual(new Set([1, 2]));
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

  it("sample-lily.ly yields notes, sorted, with flats preserved", () => {
    const score = LilyIn.parse(sample("sample-lily.ly"));
    expect(score.notes.length).toBeGreaterThan(0);
    expect(score.duration).toBeGreaterThan(0);
    for (let i = 1; i < score.notes.length; i++)
      expect(score.notes[i].onset).toBeGreaterThanOrEqual(score.notes[i - 1].onset);
    expect(score.notes.some((n) => n.spelling.acc === "b")).toBe(true);
  });
});
