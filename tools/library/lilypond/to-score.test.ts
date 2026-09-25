/* The whole LilyPond path on one small score (fixtures/features.ly), from
   LilyPond's recorded reading of it to MusicXML verified against its own
   performance — without needing LilyPond installed. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Direction, Measure, NoteGroup, NoteMark } from "../score/model.ts";
import { toMusicXml } from "../score/musicxml.ts";
import { verify } from "../verify.ts";
import { readDump } from "./dump.ts";
import { toScore } from "./to-score.ts";

const fixture = (name: string) => join(import.meta.dirname, "fixtures", name);
const [dump] = readDump(fixture("features.dump.jsonl"));
const { score, warnings } = toScore(dump, { encodingNotes: [] });
const bar = (number: string): Measure => score.measures.find((m) => m.number === number)!;
const groups = (m: Measure) => m.items.filter((it): it is NoteGroup => it.kind === "group");
const directions = (m: Measure) => m.items.filter((it): it is Direction => it.kind === "direction");
const marks = (g: NoteGroup): NoteMark[] => [...g.marks, ...g.notes.flatMap((n) => n.marks)];

describe("toScore on features.ly", () => {
  it("plays exactly what LilyPond plays, pitch for pitch and hand for hand", () => {
    const semis = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
    const graces = score.measures.flatMap((m) =>
      groups(m).filter((g) => g.grace).flatMap((g) => g.notes.map((n) => 12 * (n.octave + 1) + semis[n.step] + n.alter)));
    const result = verify(toMusicXml(score), {
      byVoice: readFileSync(fixture("features.by-voice.midi")),
      byStaff: readFileSync(fixture("features.by-staff.midi")),
    }, graces);
    expect(result.problems).toEqual([]);
    expect(result.graces).toBe(1);
  });

  it("reads bars from LilyPond's own measure positions: a pickup, then counted bars", () => {
    expect(score.measures.map((m) => m.number)).toEqual(["0", "1", "2", "3", "4", "5", "6", "7"]);
    expect(bar("0")).toMatchObject({ implicit: true });
    expect(bar("0").length.toString()).toBe("1/4");
    expect(bar("0").attributes).toMatchObject({ time: { beats: 3, beatType: 4 }, keys: [{ fifths: 1, mode: "major" }] });
  });

  it("carries repeats and endings as printed", () => {
    expect(bar("1").left).toEqual({ style: "heavy-light", repeat: "forward" });
    expect(bar("4").left?.ending).toEqual({ number: "1", type: "start", text: "1." });
    expect(bar("4").right).toMatchObject({ repeat: "backward", ending: { number: "1", type: "stop" } });
    expect(bar("5").right?.ending).toEqual({ number: "2", type: "discontinue" });
    expect(bar("7").right).toEqual({ style: "light-heavy" });
  });

  it("puts a chord's fingerings on their notes and its staccato on the chord", () => {
    const chord = groups(bar("1"))[0];
    expect(chord.notes.map((n) => n.marks)).toEqual([
      [{ kind: "fingering", text: "1" }], [{ kind: "fingering", text: "3" }], [{ kind: "fingering", text: "5" }],
    ]);
    expect(chord.marks).toEqual([{ kind: "articulation", name: "staccato" }]);
  });

  it("slashes an acciaccatura and slurs it to its note", () => {
    const [grace, main] = groups(bar("1")).filter((g) => g.offset.toString() === "1/4");
    expect(grace.grace?.slash).toBe(true);
    const start = grace.marks.find((m) => m.kind === "slur")!;
    expect(main.marks).toContainEqual({ kind: "slur", type: "stop", id: (start as { id: number }).id });
  });

  it("brackets a triplet and ties over the barline", () => {
    const [first, , last, held] = groups(bar("2"));
    expect(first.timeModification).toEqual({ actual: 3, normal: 2 });
    expect(first.tuplets).toEqual([{ type: "start", number: 1, actual: 3, normal: 2 }]);
    expect(last.tuplets).toEqual([{ type: "stop", number: 1 }]);
    expect(held.notes[0].tie).toEqual({ start: true, stop: false });
    expect(groups(bar("3"))[0].notes[0].tie).toEqual({ start: false, stop: true });
  });

  it("closes a hairpin where it ends, and leaves out a hidden one", () => {
    expect(directions(bar("2")).map((d) => d.content)).toContainEqual([{ kind: "wedge", type: "crescendo", id: 3 }]);
    expect(directions(bar("3")).map((d) => d.content)).toContainEqual([{ kind: "wedge", type: "stop", id: 3 }]);
    expect(directions(bar("7")).flatMap((d) => d.content)).toEqual([]);
  });

  it("reads a pedal released and pressed at once as a change", () => {
    const pedals = directions(bar("1")).flatMap((d) => d.content).map((c) => c.kind === "pedal" && c.type);
    expect(pedals).toEqual(["start", "change", "stop"]);
  });

  it("changes clef mid-bar, before the note it applies to", () => {
    const clef = bar("3").items.find((it) => it.kind === "clef")!;
    expect(clef).toMatchObject({ staff: 2, clef: { sign: "G", line: 2 } });
    expect(clef.offset.toString()).toBe("1/2");
    expect(bar("4").attributes?.clefs).toEqual([{ staff: 2, sign: "F", line: 4 }]);
  });

  it("marks an ottava as written an octave below where it sounds", () => {
    const [on, off] = directions(bar("5")).flatMap((d) => d.content);
    expect(on).toMatchObject({ kind: "octave-shift", type: "down", size: 8 });
    expect(off).toMatchObject({ kind: "octave-shift", type: "stop" });
  });

  it("keeps a cross-staff note in its voice, on the other staff", () => {
    const crossing = groups(bar("6")).find((g) => g.voice === 5 && g.notes[0].staff === 1)!;
    expect(crossing.notes[0]).toMatchObject({ step: "G", octave: 5 });
  });

  it("reads a tweaked \"2~3\" as a finger substitution on the note held through it", () => {
    const held = groups(bar("6")).find((g) => g.voice === 1)!;
    expect(marks(held)).toEqual([
      { kind: "fingering", text: "2", placement: "above" },
      { kind: "fingering", text: "3", placement: "above", substitution: true },
    ]);
    expect(warnings).toEqual(["fingering-event on a spacer placed on the note held through it (line 23:23)"]);
  });

  it("writes tempo as both text and playback", () => {
    const tempo = directions(bar("0")).find((d) => d.tempo !== undefined)!;
    expect(tempo.tempo).toBe(72);
    expect(tempo.content).toContainEqual({ kind: "metronome", beatUnit: "quarter", dots: 0, perMinute: "72", hidden: false });
  });
});
