import { describe, it, expect } from "vitest";
import { spell, posFromMiddleC, nameOf } from "./staff-std";

const posOf = (pitch: number, sp?: Parameters<typeof spell>[1]) =>
  posFromMiddleC(spell(pitch, sp));

describe("grand-staff rows", () => {
  it("anchors middle C at position 0 and puts the staff lines where engraving does", () => {
    expect(posOf(60)).toBe(0); // middle C
    expect(posOf(64)).toBe(2); // E4, bottom treble line
    expect(posOf(77)).toBe(10); // F5, top treble line
    expect(posOf(43)).toBe(-10); // G2, bottom bass line
    expect(posOf(57)).toBe(-2); // A3, top bass line
  });

  it("positions by letter, not by pitch: C♯ and D♭ share a pitch but not a row", () => {
    expect(posOf(61, { letter: "C", acc: "#" })).toBe(0);
    expect(posOf(61, { letter: "D", acc: "b" })).toBe(1);
  });

  it("follows octave-boundary spellings across the boundary", () => {
    expect(posOf(60, { letter: "B", acc: "#" })).toBe(-1); // B♯3, below middle C
    expect(posOf(59, { letter: "C", acc: "b" })).toBe(0); // C♭4, on middle C
  });
});

describe("bare pitches (a live key press)", () => {
  it("spells black keys as sharps, so they sit on the natural's row", () => {
    expect(spell(61)).toEqual({ letter: "C", acc: "#", octave: 4 });
    expect(posOf(61)).toBe(posOf(60)); // C♯4 shares middle C's row
  });

  it("reads out the note name a player would say", () => {
    expect(nameOf(spell(60))).toBe("C4");
    expect(nameOf(spell(61))).toBe("C♯4");
    expect(nameOf(spell(21))).toBe("A0");
    expect(nameOf(spell(108))).toBe("C8");
  });
});
