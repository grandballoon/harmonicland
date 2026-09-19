import { describe, it, expect, beforeAll } from "vitest";
import { Core } from "../core";
import { makeSteps } from "../steps";
import { engrave } from "./engrave";
import { headId, headPrefix, toMei } from "./mei";
import { Verovio, type PageSpec } from "./verovio";
import { StaffScore, PAPER_W, PAPER_H } from "./staff-score";
import type { Barline, RawNote, Score } from "../types";

/* The engine itself, run for real: what verovio.ts reads back off the
   pages it sets, and the whole score drawn on those pages. The built-in
   flow the sheets fall back to is staff-score.test.ts's, where the engine
   is never loaded. */

const n = (pitch: number, onset: number, duration: number, hand: "upper" | "lower" = "upper"): RawNote =>
  ({ pitch, onset, duration, hand });

/** `count` bars of 4/4 at a second a bar: four quarters over a held bass. */
const piece = (count: number, first: Barline = 0): Score => {
  const notes: RawNote[] = [];
  const bars: Barline[] = [first];
  for (let b = 0; b < count; b++) {
    for (let q = 0; q < 4; q++) notes.push(n(62 + ((b + q) % 8), b + q / 4, 0.25));
    notes.push(n(50, b, 1, "lower"));
    bars.push(b + 1);
  }
  return Core.makeScore(notes, bars);
};

const SPEC: PageSpec = { width: 880, height: 1244, margin: { top: 40, bottom: 56, left: 36, right: 36 }, space: 14 };
const pagesOf = (s: Score) => Verovio.engrave(toMei(engrave(s.notes, s.bars, 0, s.bars.length - 1), "both"), SPEC)!;
const opts = { glowId: "g", range: null, current: null, hand: "both" as const, showOther: true };
const count = (svg: string, re: RegExp): number => (svg.match(re) ?? []).length;
const ALL = 100_000;

beforeAll(async () => {
  expect(await Verovio.load()).toBe(true);
}, 60_000);

describe("the engine", () => {
  it("sets nothing for an empty document", () => {
    expect(Verovio.engrave("", SPEC)).toEqual([]);
  });

  it("sets every bar exactly once, in order, line after line, page after page", () => {
    const bars = pagesOf(piece(40)).flatMap((p) => p.systems.flatMap((s) => s.bars.map((b) => b.index)));
    expect(bars).toEqual([...Array(40).keys()]);
  });

  it("sizes each page to the paper it was asked for", () => {
    for (const p of pagesOf(piece(40))) expect(p.svg).toMatch(/^<svg\b[^>]*width="880" height="1244"/);
  });

  it("keeps every line inside the page's margins", () => {
    for (const p of pagesOf(piece(40)))
      for (const s of p.systems) {
        expect(s.top).toBeGreaterThanOrEqual(SPEC.margin.top - 1);
        expect(s.bottom).toBeLessThanOrEqual(SPEC.height - SPEC.margin.bottom + 1);
        expect(s.bars[0].x0).toBeGreaterThanOrEqual(SPEC.margin.left - 1);
        expect(s.bars[s.bars.length - 1].x1).toBeLessThanOrEqual(SPEC.width - SPEC.margin.right + 1);
      }
  });

  it("sets the staff at the size asked for", () => {
    // a grand staff is two five-line staves: eight spaces, plus the gap
    const s = pagesOf(piece(4))[0].systems[0];
    expect(s.bottom - s.top).toBeGreaterThan(8 * SPEC.space);
    expect(s.bottom - s.top).toBeLessThan(20 * SPEC.space);
  });

  it("finds every note's attack by the id mei.ts gave it, on the bar it is in", () => {
    const s = piece(12);
    const pages = pagesOf(s);
    for (const note of s.notes) {
      const found = pages.flatMap((p) => {
        const h = p.heads.get(headId(note.id, 0));
        return h ? [{ h, sys: p.systems[h.system] }] : [];
      });
      expect(found).toHaveLength(1);
      const { h, sys } = found[0];
      const bar = sys.bars.find((b) => h.x >= b.x0 && h.x < b.x1)!;
      expect(bar.index).toBe(Core.barAt(s, note.onset).index);
      expect(h.y).toBeGreaterThan(sys.top - 4 * SPEC.space);
      expect(h.y).toBeLessThan(sys.bottom + 4 * SPEC.space);
    }
  });

  it("sets the same score to the same pages", () => {
    expect(pagesOf(piece(12)).map((p) => p.svg)).toEqual(pagesOf(piece(12)).map((p) => p.svg));
  });

  it("gives each page its own ids, so two pages on screen share none", () => {
    const pages = pagesOf(piece(40));
    const ids = pages.flatMap((p) => [...p.svg.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
    expect(new Set(ids).size).toBe(ids.length);
    // and every glyph a page uses is one it defines
    for (const p of pages) {
      const own = new Set([...p.svg.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
      for (const [, ref] of p.svg.matchAll(/\bhref="#([^"]+)"/g)) expect(own.has(ref)).toBe(true);
    }
  });
});

describe("the whole score on Verovio's pages", () => {
  const lay = (W: number, s: Score) => {
    const L = StaffScore.layout(W, s, "both", true);
    if (L.engine !== "verovio") throw new Error("expected Verovio");
    return L;
  };

  it("sets the sheets with Verovio once it is loaded", () => {
    expect(StaffScore.layout(1200, piece(4), "both", true).engine).toBe("verovio");
    expect(StaffScore.markup(1200, ALL, 0, piece(4), opts)).toContain('<g class="vrv"><svg');
  });

  it("stacks the pages as sheets of the one paper", () => {
    const L = lay(1200, piece(80));
    expect(L.sheets.length).toBeGreaterThan(1);
    expect(L.k).toBe(1);
    for (let i = 1; i < L.sheets.length; i++)
      expect(L.sheets[i].top).toBeGreaterThanOrEqual(L.sheets[i - 1].top + PAPER_H);
    expect(L.x).toBeCloseTo((1200 - PAPER_W) / 2, 6);
  });

  it("does not re-set the piece for a new window width", () => {
    const s = piece(12);
    expect(lay(1000, s).sheets[0].page).toBe(lay(1600, s).sheets[0].page);
  });

  it("re-sets it for the hand being practised, dimming the other", () => {
    const s = piece(4);
    const both = StaffScore.markup(1200, ALL, 0, s, opts);
    const upper = StaffScore.markup(1200, ALL, 0, s, { ...opts, hand: "upper" });
    expect(both).not.toContain("lower other");
    expect(upper).toContain('class="note lower other"');
    expect(upper).toContain('class="note upper"');
  });

  it("hit-tests the bar drawn under a point, and nothing in the margin", () => {
    const s = piece(40);
    const L = lay(1200, s);
    const sheet = L.sheets[1];
    const sys = sheet.systems[1];
    const bar = sys.bars[1];
    const x = L.x + ((bar.x0 + bar.x1) / 2) * L.k;
    const y = sheet.top + (sys.y + sys.h / 2) * L.k;
    expect(StaffScore.barAt(1200, s, "both", true, x, y)).toBe(bar.index);
    expect(StaffScore.barAt(1200, s, "both", true, L.x + 5, y)).toBeNull();
  });

  it("names where each bar's line is, for the scroller", () => {
    const s = piece(40);
    const L = lay(1200, s);
    const sheet = L.sheets[1];
    const sys = sheet.systems[0];
    const [top, bottom] = StaffScore.lineSpan(1200, s, "both", true, sys.to)!;
    expect(top).toBeCloseTo(sheet.top + sys.y, 6);
    expect(bottom).toBeCloseTo(sheet.top + sys.y + sys.h, 6);
    expect(StaffScore.contentHeight(1200, s, "both", true)).toBe(L.height);
  });

  it("lights the current step's heads and rules through its column", () => {
    const s = piece(12);
    const { steps } = makeSteps(s, "both");
    const step = steps[steps.length - 1];
    const svg = StaffScore.markup(1200, ALL, 0, s, { ...opts, current: step });
    for (const note of step.attack) expect(svg).toContain(`g[id^="${headPrefix(note.id)}"]>g.notehead`);
    expect(svg).toContain("color:var(--note-lit);filter:url(#g)");
    expect(count(svg, /stroke="var\(--playhead\)"/g)).toBe(1);
    // the rule stands at the struck head
    const L = lay(1200, s);
    const head = L.sheets.flatMap((sh) => [sh.page.heads.get(headId(step.attack[0].id, 0))]).find(Boolean)!;
    expect(svg).toContain(`<line x1="${head.x}"`);
  });

  it("lights nothing with no step", () => {
    const svg = StaffScore.markup(1200, ALL, 0, piece(12), opts);
    expect(svg).not.toContain("--note-lit");
    expect(svg).not.toContain("--playhead");
  });

  it("lays the isolated bars on a panel, under the page", () => {
    const svg = StaffScore.markup(1200, ALL, 0, piece(12), { ...opts, range: { from: 1, to: 2 } });
    const panel = svg.indexOf('fill="var(--panel)"');
    expect(panel).toBeGreaterThan(0);
    expect(panel).toBeLessThan(svg.indexOf('<g class="vrv">'));
  });

  it("draws only the sheets in view", () => {
    const s = piece(80);
    const L = lay(1200, s);
    expect(count(StaffScore.markup(1200, 600, 0, s, opts), /<g class="vrv">/g)).toBe(1);
    expect(count(StaffScore.markup(1200, ALL, 0, s, opts), /<g class="vrv">/g)).toBe(L.sheets.length);
  });

  it("is deterministic", () => {
    const s = piece(40);
    expect(StaffScore.markup(1200, 700, 300, s, opts)).toBe(StaffScore.markup(1200, 700, 300, s, opts));
  });
});
