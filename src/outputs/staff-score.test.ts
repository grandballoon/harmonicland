import { describe, it, expect } from "vitest";
import { StaffScore, SYS_H, PAPER_W, PAPER_H } from "./staff-score";
import { Core } from "../core";
import { makeSteps } from "../steps";
import type { Barline, RawNote, Score } from "../types";

/* The whole piece as sheet music: which bars land on which line, which
   lines on which sheet, where the sheets sit, and what is drawn at a given
   scroll. How a bar itself is engraved is staff-bars.test.ts's business. */

const n = (pitch: number, onset: number, duration: number, hand: "upper" | "lower" = "upper"): RawNote =>
  ({ pitch, onset, duration, hand });

/** A D major scale, so a piece in two sharps prints no accidental of its own. */
const D_MAJOR = [62, 64, 66, 67, 69, 71, 73, 74];

/** `count` bars of 4/4 at a second a bar, four quarters over a whole note. */
const piece = (count: number, first: Barline = 0): Score => {
  const notes: RawNote[] = [];
  const bars: Barline[] = [first];
  for (let b = 0; b < count; b++) {
    for (let q = 0; q < 4; q++) notes.push(n(D_MAJOR[(b + q) % 8], b + q / 4, 0.25));
    notes.push(n(50, b, 1, "lower"));
    bars.push(b + 1);
  }
  return Core.makeScore(notes, bars);
};

const opts = { glowId: "g", range: null, current: null, hand: "both" as const, showOther: true };
/** The built-in engraver's layout: Verovio is never loaded in this file,
 *  so the sheets are the built-in flow's. verovio.test.ts sets them the
 *  other way. */
const lay = (W: number, s: Score) => {
  const L = StaffScore.layout(W, s, "both", true);
  if (L.engine !== "built-in") throw new Error("expected the built-in engraver");
  return L;
};
const lines = (W: number, s: Score) => lay(W, s).sheets.flatMap((sh) => sh.systems);
const count = (svg: string, re: RegExp): number => (svg.match(re) ?? []).length;
const TREBLE = /\u{1D11E}/gu;
const SHEET = /<rect x="0" y="0" width="880"/g;
/** Tall enough to see every sheet of a short piece at once. */
const ALL = 100_000;

describe("flow", () => {
  it("sets every bar exactly once, in order, line after line", () => {
    const bars = lines(1200, piece(40)).flatMap((sys) => sys.line.placed.map((p) => p.eb.bar.index));
    expect(bars).toEqual([...Array(40).keys()]);
    for (const sys of lines(1200, piece(40))) expect(sys.line.placed.every((p) => !p.context)).toBe(true);
    for (const sys of lines(1200, piece(40))) expect(sys.line.view).toBeNull();
  });

  it("breaks lines by the paper, not the window", () => {
    const s = piece(40);
    expect(lines(1000, s).map((l) => [l.from, l.to])).toEqual(lines(2400, s).map((l) => [l.from, l.to]));
  });

  it("justifies every line but a short last one to the width", () => {
    const ls = lines(1200, piece(9));
    expect(ls.length).toBeGreaterThan(1);
    const ends = ls.map((sys) => sys.line.placed[sys.line.placed.length - 1].x1);
    for (const e of ends.slice(0, -1)) expect(e).toBeCloseTo(ends[0], 3);
    expect(ends[ends.length - 1]).toBeLessThanOrEqual(ends[0] + 1e-6);
  });
});

describe("paper", () => {
  it("is a portrait sheet in A4's proportions", () => {
    expect(PAPER_H / PAPER_W).toBeCloseTo(Math.SQRT2, 2);
  });

  it("draws the music at one size in any window wide enough for a sheet", () => {
    expect(lay(1000, piece(40)).k).toBe(1);
    expect(lay(2400, piece(40)).k).toBe(1);
  });

  it("centres the sheets in a wide window", () => {
    const L = lay(2000, piece(4));
    expect(L.x).toBeCloseTo((2000 - PAPER_W) / 2, 6);
  });

  it("shows a whole sheet, smaller, in a window narrower than one", () => {
    const L = lay(500, piece(4));
    expect(L.k).toBeLessThan(1);
    expect(L.x).toBeGreaterThanOrEqual(0);
    expect(L.x + PAPER_W * L.k).toBeLessThanOrEqual(500);
  });

  it("puts a long piece on more sheets, stacked down the page", () => {
    const L = lay(1200, piece(80));
    expect(L.sheets.length).toBeGreaterThan(1);
    for (let i = 1; i < L.sheets.length; i++)
      expect(L.sheets[i].top).toBeGreaterThanOrEqual(L.sheets[i - 1].top + PAPER_H);
    expect(L.height).toBeGreaterThan(L.sheets[L.sheets.length - 1].top + PAPER_H);
  });

  it("keeps every line inside its sheet, and spreads a full sheet to its foot", () => {
    const L = lay(1200, piece(80));
    for (const sh of L.sheets)
      for (const sys of sh.systems) expect(sys.y + SYS_H).toBeLessThanOrEqual(PAPER_H);
    const full = L.sheets[0].systems;
    const last = L.sheets[L.sheets.length - 1].systems;
    expect(full[1].y - full[0].y).toBeGreaterThan(SYS_H);
    if (last.length > 1) expect(last[1].y - last[0].y).toBe(SYS_H);
  });

  it("numbers the sheets when there is more than one", () => {
    const svg = StaffScore.markup(1200, ALL, 0, piece(80), opts);
    const sheets = lay(1200, piece(80)).sheets.length;
    expect(count(svg, SHEET)).toBe(sheets);
    expect(svg).toContain(`>${sheets}</text>`);
  });
});

describe("scrolling", () => {
  it("draws only the sheets in view", () => {
    const s = piece(80);
    const L = lay(1200, s);
    expect(count(StaffScore.markup(1200, 600, 0, s, opts), SHEET)).toBe(1);
    const second = L.sheets[1].top;
    const svg = StaffScore.markup(1200, 600, second + 10, s, opts);
    expect(count(svg, SHEET)).toBe(1);
    expect(svg).toContain(`translate(${L.x},-10)`);
  });

  it("hit-tests the content, so a scrolled point finds the bar drawn there", () => {
    const s = piece(80);
    const L = lay(1200, s);
    const sheet = L.sheets[1];
    const sys = sheet.systems[2];
    const bar = sys.line.placed[0];
    const x = L.x + (36 + (bar.x0 + bar.x1) / 2) * L.k;
    const y = sheet.top + (sys.y + SYS_H / 2) * L.k;
    expect(StaffScore.barAt(1200, s, "both", true, x, y)).toBe(bar.eb.bar.index);
  });

  it("names where the cursor's line is, so a scroller can follow it", () => {
    const s = piece(80);
    const L = lay(1200, s);
    const sys = L.sheets[1].systems[0];
    const [top, bottom] = StaffScore.lineSpan(1200, s, "both", true, sys.from)!;
    expect(top).toBeCloseTo(L.sheets[1].top + sys.y, 6);
    expect(bottom - top).toBeCloseTo(SYS_H, 6);
    expect(StaffScore.contentHeight(1200, s, "both", true)).toBe(L.height);
  });

  it("answers null in the margins and between the sheets", () => {
    const s = piece(4);
    const L = lay(1200, s);
    expect(StaffScore.barAt(1200, s, "both", true, 5, 100)).toBeNull();
    expect(StaffScore.barAt(1200, s, "both", true, 600, 5)).toBeNull();
    expect(StaffScore.barAt(1200, s, "both", true, 600, L.height + 50)).toBeNull();
  });
});

describe("what each line opens and closes with", () => {
  it("opens every line with the clef, and only the first with the time", () => {
    const s = piece(12);
    const svg = StaffScore.markup(1200, ALL, 0, s, opts);
    expect(lines(1200, s).length).toBeGreaterThan(1);
    expect(count(svg, TREBLE)).toBe(lines(1200, s).length);
    // the time signature is four size-24 numerals, two per staff
    expect(count(svg, /font-size="24"/g)).toBe(4);
  });

  it("restates the key on every line", () => {
    const s = piece(12, { at: 0, fifths: 2 });
    // two sharps on each of two staves, per line
    expect(count(StaffScore.markup(1200, ALL, 0, s, opts), />♯</g)).toBe(lines(1200, s).length * 4);
  });

  it("ends the piece on a final barline, once", () => {
    expect(count(StaffScore.markup(1200, ALL, 0, piece(40), opts), /<rect [^>]*width="4"/g)).toBe(1);
  });
});

describe("the cursor", () => {
  it("lights the current step on whichever line holds it", () => {
    const s = piece(12);
    const { steps } = makeSteps(s, "both");
    const svg = StaffScore.markup(1200, ALL, 0, s, { ...opts, current: steps[steps.length - 1] });
    expect(svg).toContain('stroke="var(--playhead)"');
    expect(count(svg, /fill="var\(--note-lit\)"/g)).toBeGreaterThan(0);
  });
});

describe("purity", () => {
  it("is deterministic", () => {
    const s = piece(40);
    expect(StaffScore.markup(1200, 700, 300, s, opts)).toBe(StaffScore.markup(1200, 700, 300, s, opts));
  });

  it("draws nothing for a degenerate region", () => {
    expect(StaffScore.markup(0, 900, 0, piece(4), opts)).toBe("");
  });
});
