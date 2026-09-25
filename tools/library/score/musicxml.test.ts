import { describe, expect, it } from "vitest";
import { MusicxmlIn } from "../../../src/inputs/musicxml.ts";
import { Fraction } from "./fraction.ts";
import type { Direction, Item, Measure, NoteGroup, NoteMark, Score, Step } from "./model.ts";
import { toMusicXml } from "./musicxml.ts";

const f = (n: number, d = 1) => new Fraction(n, d);

function note(offset: Fraction, duration: Fraction, step: Step, opts: Partial<NoteGroup> & { marks?: NoteMark[] } = {}): NoteGroup {
  const types: Record<string, NoteGroup["type"]> = { "1/4": "quarter", "1/2": "half", "1/8": "eighth", "1/12": "eighth", "3/4": "half" };
  return {
    kind: "group", offset, voice: 1, staff: 1, duration,
    type: types[duration.toString()] ?? "quarter", dots: duration.eq(f(3, 4)) ? 1 : 0,
    tuplets: [], beams: [], notes: [{ step, alter: 0, octave: 4, staff: opts.staff ?? 1, marks: [] }],
    ...opts, marks: opts.marks ?? [],
  };
}

function measure(number: string, start: Fraction, items: Item[], length = f(3, 4)): Measure {
  return { number, implicit: false, start, length, attributes: null, items };
}

function score(measures: Measure[]): Score {
  return { encodingNotes: [], staves: 2, measures };
}

const onsets = (xml: string) => MusicxmlIn.parse(xml).notes.map((n) => [n.pitch, n.onset]);

describe("toMusicXml", () => {
  it("joins voices with <backup> so every note lands where the model says", () => {
    const xml = toMusicXml(score([
      measure("1", f(0), [
        note(f(0), f(1, 2), "C"), note(f(1, 2), f(1, 4), "D"),
        note(f(0), f(3, 4), "E", { voice: 5, staff: 2 }),
      ]),
    ]));
    expect(xml).toContain("<backup>");
    // 120 bpm: a quarter is 0.5 s
    expect(onsets(xml)).toEqual([[60, 0], [64, 0], [62, 1]]);
  });

  it("chooses divisions that make triplets whole numbers", () => {
    const t = f(1, 12);
    const xml = toMusicXml(score([
      measure("1", f(0), [note(f(0), t, "C"), note(t, t, "D"), note(f(2, 12), t, "E"), note(f(1, 4), f(1, 2), "F")]),
    ]));
    expect(xml).toContain("<divisions>3</divisions>");
    expect(onsets(xml).map(([, t]) => +(t as number).toFixed(6))).toEqual([0, 0.166667, 0.333333, 0.5]);
  });

  it("ends every measure at its barline, even when a voiceless stream came last", () => {
    const words: Direction = { kind: "direction", offset: f(0), staff: 1, content: [{ kind: "words", text: "dolce" }] };
    const xml = toMusicXml(score([
      measure("1", f(0), [note(f(0), f(1, 4), "C"), words]),
      measure("2", f(3, 4), [note(f(0), f(1, 4), "D")]),
    ]));
    // the second measure starts after a full 3/4 bar: 1.5 s
    expect(onsets(xml)).toEqual([[60, 0], [62, 1.5]]);
  });

  it("numbers spanners so a reader pairing them in document order pairs them right", () => {
    // Voice 5 slurs beats 1–2; voice 1 slurs beat 3 into the next bar.
    // In time the two never overlap, but voice 1 is written first, so the
    // second slur must not reuse the first one's number.
    const start = (id: number): NoteMark => ({ kind: "slur", type: "start", id });
    const stop = (id: number): NoteMark => ({ kind: "slur", type: "stop", id });
    const xml = toMusicXml(score([
      measure("1", f(0), [
        note(f(1, 2), f(1, 4), "C", { marks: [start(2)] }),
        note(f(0), f(1, 4), "E", { voice: 5, staff: 2, marks: [start(1)] }),
        note(f(1, 4), f(1, 2), "F", { voice: 5, staff: 2, marks: [stop(1)] }),
      ]),
      measure("2", f(3, 4), [note(f(0), f(1, 4), "D", { marks: [stop(2)] })]),
    ]));
    const seen = [...xml.matchAll(/<slur type="(start|stop)" number="(\d+)"/g)].map((m) => `${m[1]} ${m[2]}`);
    expect(seen).toEqual(["start 1", "start 2", "stop 2", "stop 1"]);
  });

  it("gives a slur starting where another stops a number of its own", () => {
    const xml = toMusicXml(score([
      measure("1", f(0), [
        note(f(0), f(1, 4), "C", { marks: [{ kind: "slur", type: "start", id: 1 }] }),
        note(f(1, 4), f(1, 4), "D", { marks: [{ kind: "slur", type: "stop", id: 1 }, { kind: "slur", type: "start", id: 2 }] }),
        note(f(1, 2), f(1, 4), "E", { marks: [{ kind: "slur", type: "stop", id: 2 }] }),
      ]),
    ]));
    const seen = [...xml.matchAll(/<slur type="(start|stop)" number="(\d+)"/g)].map((m) => `${m[1]} ${m[2]}`);
    expect(seen).toEqual(["start 1", "stop 1", "start 2", "stop 2"]);
  });

  it("refuses a spanner that stops before it starts in document order", () => {
    expect(() => toMusicXml(score([
      measure("1", f(0), [
        note(f(1, 2), f(1, 4), "C", { marks: [{ kind: "slur", type: "stop", id: 1 }] }),
        note(f(0), f(1, 4), "E", { voice: 5, staff: 2, marks: [{ kind: "slur", type: "start", id: 1 }] }),
      ]),
    ]))).toThrow(/stops before it starts/);
  });

  it("writes grace notes without a duration, before the note they lead to", () => {
    const grace = note(f(1, 4), f(0), "B", { type: "eighth", grace: { slash: true, order: f(-1, 8) } });
    const xml = toMusicXml(score([measure("1", f(0), [note(f(1, 4), f(1, 2), "C"), grace, note(f(0), f(1, 4), "D")])]));
    const order = [...xml.matchAll(/<step>(\w)<\/step>/g)].map((m) => m[1]);
    expect(order).toEqual(["D", "B", "C"]);
    expect(xml).toContain('<grace slash="yes"/>');
    // the app skips graces: the main notes keep their places
    expect(onsets(xml)).toEqual([[62, 0], [60, 0.5]]);
  });
});
