import { describe, it, expect } from "vitest";
import { Core } from "../core";
import { engrave } from "./engrave";
import { barOfMeasureId, headId, measureId, toMei } from "./mei";
import type { Barline, Hand, NoteId, RawNote, Score } from "../types";
import type { HandFilter } from "../steps";

/* mei.ts writes down what engrave.ts decided, in the vocabulary Verovio
   reads. These are facts about the document — its ids, classes, layers,
   containers and signatures — read back with a DOM parser; whether
   Verovio sets it well is verovio.test.ts's business. */

const n = (pitch: number, onset: number, duration: number, hand?: Hand): RawNote =>
  ({ pitch, onset, duration, ...(hand && { hand }) });

/** Bars of 4/4 at 120bpm: a quarter is half a second, a bar two. */
const bars44: Barline[] = [0, 2, 4, 6, 8];
const scoreOf = (raw: RawNote[], barlines: Barline[] = bars44): Score => Core.makeScore(raw, barlines);

const meiOf = (s: Score, hand: HandFilter = "both"): Document =>
  new DOMParser().parseFromString(
    toMei(engrave(s.notes, s.bars, 0, s.bars.length - 1), hand), "application/xml");

const all = (doc: Document, sel: string): Element[] => [...doc.querySelectorAll(sel)];
const xmlId = (e: Element): string | null => e.getAttribute("xml:id");
/** A measure by the bar it holds. */
const measure = (doc: Document, bar: number): Element =>
  all(doc, "measure").find((m) => xmlId(m) === measureId(bar))!;
const idOf = (s: Score, pitch: number): NoteId => s.notes.find((x) => x.pitch === pitch)!.id;

/** How many quarters a layer takes: its values, two-thirds for any inside
 *  a tuplet. Every layer of a full bar must take exactly the bar. */
function layerQuarters(layer: Element): number {
  let q = 0;
  for (const e of all(layer.ownerDocument, "*")) {
    if (!layer.contains(e) || e === layer) continue;
    const dur = e.getAttribute("dur");
    if (!dur || e.parentElement?.localName === "chord") continue;
    const dots = Number(e.getAttribute("dots") ?? 0);
    const tuplet = e.closest("tuplet") !== null && layer.contains(e.closest("tuplet"));
    q += (4 / Number(dur)) * (dots ? 1.5 : 1) * (tuplet ? 2 / 3 : 1);
  }
  return q;
}

describe("the document", () => {
  it("parses as MEI, one measure per bar, the last closing the piece", () => {
    const doc = meiOf(scoreOf([n(60, 0, 8)]));
    expect(doc.querySelector("parsererror")).toBeNull();
    expect(doc.documentElement.localName).toBe("mei");
    const measures = all(doc, "measure");
    expect(measures.map(xmlId)).toEqual(["b0", "b1", "b2", "b3"]);
    expect(measures.map((m) => m.getAttribute("n"))).toEqual(["1", "2", "3", "4"]);
    expect(measures.map((m) => m.getAttribute("right"))).toEqual([null, null, null, "end"]);
  });

  it("names a measure by its bar, and reads the name back", () => {
    expect(measureId(12)).toBe("b12");
    expect(barOfMeasureId("b12")).toBe(12);
    expect(barOfMeasureId("n12h0")).toBeNull();
  });

  it("is empty for no bars", () => {
    expect(toMei([], "both")).toBe("");
  });

  it("opens a treble and a bass staff under a brace", () => {
    const doc = meiOf(scoreOf([n(60, 0, 2)]));
    expect(doc.querySelector("staffGrp")?.getAttribute("symbol")).toBe("brace");
    expect(all(doc, "staffDef clef").map((c) => `${c.getAttribute("shape")}${c.getAttribute("line")}`)).toEqual(["G2", "F4"]);
  });
});

describe("signatures", () => {
  it("states the opening key and meter", () => {
    const doc = meiOf(scoreOf([n(62, 0, 2)], [{ at: 0, fifths: 2, beats: 3, unit: 4 }, 1.5]));
    const def = doc.querySelector("score > scoreDef")!;
    expect(def.querySelector("keySig")?.getAttribute("sig")).toBe("2s");
    expect(def.querySelector("meterSig")?.getAttribute("count")).toBe("3");
    expect(def.querySelector("meterSig")?.getAttribute("unit")).toBe("4");
  });

  it("changes the key before the bar it changes in, and only then", () => {
    const doc = meiOf(scoreOf([n(60, 0, 8)], [0, 2, { at: 4, fifths: -3 }, 6, 8]));
    const changes = all(doc, "section > scoreDef");
    expect(changes).toHaveLength(1);
    expect(changes[0].querySelector("keySig")?.getAttribute("sig")).toBe("3f");
    expect(changes[0].querySelector("meterSig")).toBeNull();
    expect(xmlId(changes[0].nextElementSibling!)).toBe("b2");
  });

  it("changes the meter without restating the key", () => {
    const doc = meiOf(scoreOf([n(60, 0, 7)], [0, 2, { at: 4, beats: 3, unit: 4 }, 5.5, 7]));
    const change = doc.querySelector("section > scoreDef")!;
    expect(change.querySelector("keySig")).toBeNull();
    expect(change.querySelector("meterSig")?.getAttribute("count")).toBe("3");
  });
});

describe("notes", () => {
  it("writes the spelling, and prints only the accidentals engrave.ts prints", () => {
    // F♯ twice in a bar: printed on the first, implied on the second
    const s = scoreOf([n(66, 0, 0.5), n(66, 0.5, 0.5)]);
    const [a, b] = all(meiOf(s), "note");
    expect([a.getAttribute("pname"), a.getAttribute("oct")]).toEqual(["f", "4"]);
    expect(a.getAttribute("accid")).toBe("s");
    expect(b.getAttribute("accid")).toBeNull();
    expect(b.getAttribute("accid.ges")).toBe("s");
  });

  it("gives every head an id from its note and its place in the tie", () => {
    // a whole note from beat 3 of bar 1: a half tied over to a half
    const s = scoreOf([n(67, 1, 2)]);
    const doc = meiOf(s);
    const id = idOf(s, 67);
    expect(all(doc, "note").map(xmlId)).toEqual([headId(id, 0), headId(id, 1)]);
    const tie = doc.querySelector("tie")!;
    expect(tie.getAttribute("startid")).toBe(`#${headId(id, 0)}`);
    expect(tie.getAttribute("endid")).toBe(`#${headId(id, 1)}`);
    // filed with the measure it starts in
    expect(xmlId(tie.parentElement!)).toBe("b0");
  });

  it("stacks heads struck together into one chord", () => {
    const doc = meiOf(scoreOf([n(60, 0, 1), n(64, 0, 1), n(67, 0, 1)]));
    const chord = doc.querySelector("chord")!;
    expect(chord.getAttribute("dur")).toBe("2");
    expect([...chord.children].map((c) => c.getAttribute("pname"))).toEqual(["c", "e", "g"]);
  });

  it("writes a staff with nothing in the bar as a measure rest", () => {
    const doc = meiOf(scoreOf([n(72, 0, 2)]));
    expect(measure(doc, 0).querySelectorAll('staff[n="2"] mRest')).toHaveLength(1);
  });
});

describe("classes", () => {
  const s = scoreOf([n(72, 0, 2, "upper"), n(48, 0, 2, "lower"), n(76, 2, 0.25, "upper"), n(77, 2.25, 0.25, "upper")]);

  it("names each note's hand", () => {
    const types = all(meiOf(s), "note").map((e) => e.getAttribute("type"));
    expect(new Set(types)).toEqual(new Set(["upper", "lower"]));
  });

  it("marks the hand not being practised as other", () => {
    const doc = meiOf(s, "upper");
    expect(all(doc, 'note[pname="c"][oct="3"]')[0].getAttribute("type")).toBe("lower other");
    expect(all(doc, 'note[pname="c"][oct="5"]')[0].getAttribute("type")).toBe("upper");
  });

  it("calls a note with no hand free", () => {
    expect(meiOf(scoreOf([n(72, 0, 2)])).querySelector("note")?.getAttribute("type")).toBe("free");
  });

  it("gives a beam and a tie the class of what they join", () => {
    expect(meiOf(s, "lower").querySelector("beam")?.getAttribute("type")).toBe("upper other");
    const tied = scoreOf([n(67, 1, 2, "lower")]);
    expect(meiOf(tied, "upper").querySelector("tie")?.getAttribute("type")).toBe("lower other");
  });
});

describe("layers", () => {
  it("keeps a held note and the notes moving over it in two layers, each a whole bar", () => {
    // a half note under two quarters, on the treble staff
    const s = scoreOf([n(64, 0, 1), n(72, 0, 0.5), n(74, 0.5, 0.5)]);
    const layers = [...measure(meiOf(s), 0).querySelectorAll('staff[n="1"] layer')];
    expect(layers).toHaveLength(2);
    for (const l of layers) expect(layerQuarters(l)).toBeCloseTo(4, 9);
    // the second layer's hole after the quarters is filled, invisibly
    expect(all(meiOf(s), "space").length).toBeGreaterThan(0);
  });

  it("puts rests in the first layer", () => {
    const s = scoreOf([n(72, 0.5, 0.5)]);
    const layer = meiOf(s).querySelector('measure staff[n="1"] layer')!;
    expect(layer.querySelector("rest")).not.toBeNull();
    expect(layerQuarters(layer)).toBeCloseTo(4, 9);
  });

  it("fills every layer of every bar of a busy passage exactly", () => {
    const raw: RawNote[] = [];
    for (let i = 0; i < 16; i++) raw.push(n(60 + (i % 7), i * 0.25, 0.25));
    raw.push(n(48, 0, 4), n(52, 1, 1), n(55, 3, 3.5));
    const doc = meiOf(scoreOf(raw));
    for (const l of all(doc, "layer")) if (!l.querySelector("mRest")) expect(layerQuarters(l)).toBeCloseTo(4, 9);
  });
});

describe("beams and triplets", () => {
  it("beams the eighths engrave.ts beams", () => {
    const s = scoreOf([n(72, 0, 0.25), n(74, 0.25, 0.25), n(76, 0.5, 0.5)]);
    const beam = meiOf(s).querySelector("beam")!;
    expect([...beam.children].map((c) => c.getAttribute("dur"))).toEqual(["8", "8"]);
  });

  it("brackets triplets three to a tuplet, around their beam", () => {
    // two beats of triplet eighths
    const third = 0.5 / 3;
    const raw = Array.from({ length: 6 }, (_, i) => n(72 + i, i * third, third));
    const doc = meiOf(scoreOf(raw));
    const tuplets = all(doc, "tuplet");
    expect(tuplets).toHaveLength(2);
    for (const t of tuplets) {
      expect([t.getAttribute("num"), t.getAttribute("numbase")]).toEqual(["3", "2"]);
      expect(t.querySelectorAll("note")).toHaveLength(3);
      expect(t.querySelector("beam")).not.toBeNull();
    }
    expect(layerQuarters(doc.querySelector('staff[n="1"] layer')!)).toBeCloseTo(4, 9);
  });

  it("brackets a triplet of quarters across two beats", () => {
    const third = 1 / 3;
    const raw = Array.from({ length: 3 }, (_, i) => n(72 + i, i * third, third));
    const doc = meiOf(scoreOf(raw));
    const t = doc.querySelector("tuplet")!;
    expect([...t.querySelectorAll("note")].map((e) => e.getAttribute("dur"))).toEqual(["4", "4", "4"]);
    expect(layerQuarters(doc.querySelector('staff[n="1"] layer')!)).toBeCloseTo(4, 9);
  });
});
