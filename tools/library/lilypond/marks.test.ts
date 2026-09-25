import { describe, expect, it } from "vitest";
import { articulationMark, markupMeaning, noteType, rehearsalLetters } from "./marks.ts";

describe("articulationMark", () => {
  it("maps LilyPond's names onto MusicXML's", () => {
    expect(articulationMark("staccato", undefined)).toEqual({ kind: "articulation", name: "staccato", placement: undefined });
    expect(articulationMark("marcato", "1")).toEqual({ kind: "articulation", name: "strong-accent", placement: "above" });
    expect(articulationMark("prall", undefined)).toMatchObject({ kind: "ornament", name: "inverted-mordent" });
    expect(articulationMark("trill", undefined)).toMatchObject({ kind: "ornament", name: "trill-mark" });
  });

  it("gives compound ornaments their long form and approach or departure", () => {
    expect(articulationMark("upprall", undefined)).toMatchObject({ name: "inverted-mordent", long: true, approach: "below" });
    expect(articulationMark("prallup", undefined)).toMatchObject({ name: "inverted-mordent", long: true, departure: "above" });
    expect(articulationMark("downmordent", undefined)).toMatchObject({ name: "mordent", long: true, approach: "above" });
    expect(articulationMark("prallprall", undefined)).toMatchObject({ name: "inverted-mordent", long: true });
  });

  it("inverts a fermata placed below", () => {
    expect(articulationMark("fermata", "-1")).toEqual({ kind: "fermata", shape: "normal", inverted: true });
    expect(articulationMark("shortfermata", undefined)).toEqual({ kind: "fermata", shape: "angled", inverted: false });
  });

  it("refuses a name it does not know rather than dropping it", () => {
    expect(() => articulationMark("snappizzicatissimo", undefined)).toThrow(/no MusicXML mark/);
  });
});

describe("markupMeaning", () => {
  const tree = (cmd: string, arg: unknown) => ({ cmd, args: [arg] });

  it("reads plain and styled text", () => {
    expect(markupMeaning("dolce")).toEqual({ kind: "text", text: "dolce", italic: false, bold: false });
    expect(markupMeaning({ text: "dolce", tree: tree("italic-markup", "dolce") })).toEqual({
      kind: "text", text: "dolce", italic: true, bold: false,
    });
  });

  it("recognizes a dynamic written as markup", () => {
    expect(markupMeaning({ text: "sf", tree: tree("dynamic-markup", "sf") })).toEqual({ kind: "dynamic", value: "sf" });
  });

  it("recognizes segno and coda glyphs", () => {
    expect(markupMeaning({ text: "", tree: tree("musicglyph-markup", "scripts.segno") })).toEqual({ kind: "segno" });
    expect(markupMeaning({ text: "", tree: tree("musicglyph-markup", "scripts.coda") })).toEqual({ kind: "coda" });
  });

  it("reads accidental glyphs as their characters", () => {
    const m = markupMeaning({ text: "", tree: { cmd: "concat-markup", args: [["poco ", { cmd: "flat-markup", args: [] }]] } });
    expect(m).toMatchObject({ kind: "text", text: "poco ♭" });
  });

  it("treats an empty markup as no text", () => {
    expect(markupMeaning([])).toMatchObject({ kind: "text", text: "" });
  });

  it("refuses a markup command it cannot render", () => {
    expect(() => markupMeaning({ text: "x", tree: tree("postscript-markup", "x") })).toThrow(/no text rendering/);
  });
});

describe("rehearsalLetters", () => {
  it("skips I, as LilyPond's default does, then doubles", () => {
    expect([1, 8, 9, 25, 26].map(rehearsalLetters)).toEqual(["A", "H", "J", "Z", "AA"]);
  });
});

describe("noteType", () => {
  it("names LilyPond duration logs", () => {
    expect([-1, 0, 2, 3, 5].map(noteType)).toEqual(["breve", "whole", "quarter", "eighth", "32nd"]);
    expect(() => noteType(11)).toThrow();
  });
});
