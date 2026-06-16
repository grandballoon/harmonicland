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
