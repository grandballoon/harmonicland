import { describe, it, expect } from "vitest";
import { StaffBars } from "./staff-bars";
import { Core } from "../core";
import { makeSteps } from "../steps";
import type { Barline, Hand, RawNote } from "../types";

/* The page's LAYOUT and GLYPHS — what engrave.ts derived, put on a staff.
   Every note value, rest and beam is a fact tested in engrave.test.ts;
   here the questions are where things land and what they are drawn as. */

const n = (pitch: number, onset: number, duration: number, hand: Hand = "upper"): RawNote =>
  ({ pitch, onset, duration, hand });

/** Four bars of 4/4 at 120bpm in D major, one idea per bar: quarters,
 *  eighths, halves, a whole — and a C3 whole note under each. */
const bars: Barline[] = [{ at: 0, fifths: 2 }, 2, 4, 6, 8];
const four = Core.makeScore([
  n(62, 0, 0.5), n(64, 0.5, 0.5), n(66, 1, 0.5), n(67, 1.5, 0.5),
  n(69, 2, 0.25), n(71, 2.25, 0.25), n(73, 2.5, 0.25), n(74, 2.75, 0.25), n(74, 3, 1),
  n(74, 4, 1), n(73, 5, 1),
  n(74, 6, 2),
  n(48, 0, 2, "lower"), n(48, 2, 2, "lower"), n(48, 4, 2, "lower"), n(48, 6, 2, "lower"),
], bars);

const G = "g";
const opts = { glowId: G, range: null, current: null, hand: "both" as const, showOther: true };
const W = 900;
const H = 220;
const count = (svg: string, re: RegExp): number => (svg.match(re) ?? []).length;

describe("layout", () => {
  it("places the focus bars left to right, edge to edge", () => {
    const { placed } = StaffBars.layout(W, four, { from: 1, to: 2 }, four.notes);
    const focus = placed.filter((p) => !p.context);
    expect(focus.map((p) => p.eb.bar.index)).toEqual([1, 2]);
    expect(focus[1].x0).toBe(focus[0].x1);
    expect(focus[1].x1).toBeLessThanOrEqual(W);
  });

  it("gives every column an x inside its bar, in order", () => {
    const { placed } = StaffBars.layout(W, four, { from: 0, to: 0 }, four.notes);
    const p = placed.find((q) => q.eb.bar.index === 0)!;
    expect(p.colX).toHaveLength(4);
    expect([...p.colX]).toEqual([...p.colX].sort((a, b) => a - b));
    expect(p.colX[0]).toBeGreaterThan(p.x0);
    expect(p.colX[3]).toBeLessThan(p.x1);
  });

  it("clips the neighbouring bars to a margin either side", () => {
    const { placed } = StaffBars.layout(W, four, { from: 1, to: 1 }, four.notes);
    expect(placed.map((p) => [p.eb.bar.index, p.context])).toEqual([[0, true], [1, false], [2, true]]);
    const [prev, focus, next] = placed;
    expect(prev.visible[1]).toBe(focus.x0);
    expect(prev.visible[1] - prev.visible[0]).toBeLessThan(prev.x1 - prev.x0); // torn, not whole
    expect(next.visible[0]).toBe(focus.x1);
  });

  it("has no context at either end of the piece", () => {
    expect(StaffBars.layout(W, four, { from: 0, to: 0 }, four.notes).placed.map((p) => p.eb.bar.index)).toEqual([0, 1]);
    expect(StaffBars.layout(W, four, { from: 3, to: 3 }, four.notes).placed.map((p) => p.eb.bar.index)).toEqual([2, 3]);
  });

  it("spaces by rhythm, not by the clock: a bar of eighths is wider than a bar with one whole note", () => {
    const { placed } = StaffBars.layout(W, four, { from: 1, to: 3 }, four.notes);
    const width = (i: number) => placed.find((p) => p.eb.bar.index === i)!;
    const eighths = width(1);
    const whole = width(3);
    expect(eighths.x1 - eighths.x0).toBeGreaterThan(whole.x1 - whole.x0);
    // ...but not eight times wider, the way a time axis would have it
    expect(eighths.x1 - eighths.x0).toBeLessThan(4 * (whole.x1 - whole.x0));
  });
});

describe("panning", () => {
  it("rests on the focus, and slides the rest of the piece through the window", () => {
    const focus = { from: 0, to: 0 };
    const { range, focus: sight } = StaffBars.panSpan(W, four, focus, "both", true);
    expect(range[0]).toBe(0); // nothing before the first bar
    expect(range[1]).toBeGreaterThan(0);
    expect(sight[0]).toBeLessThanOrEqual(0);
    expect(sight[1]).toBeGreaterThanOrEqual(0);
    const bars = (pan: number) => StaffBars.layout(W, four, focus, four.notes, pan).placed.map((p) => p.eb.bar.index);
    expect(bars(0)).toEqual([0, 1]);
    expect(bars(range[1])).toContain(3);
    expect(bars(range[1])).not.toContain(0);
  });

  it("tears every bar at the window, wherever it is panned to", () => {
    const page = StaffBars.layout(W, four, { from: 1, to: 1 }, four.notes, 150);
    const [L, R] = page.view!;
    for (const p of page.placed) {
      expect(p.visible[0]).toBeGreaterThanOrEqual(L);
      expect(p.visible[1]).toBeLessThanOrEqual(R);
    }
  });
});

describe("timeline", () => {
  const focus = { from: 1, to: 1 };
  const tl = StaffBars.timeline(W, four, focus, "both", true);
  const strip = StaffBars.layout(W, four, focus, four.notes, 0).placed;

  it("puts each instant on its column", () => {
    const bar1 = strip.find((p) => p.eb.bar.index === 1)!;
    bar1.eb.columns.forEach((c, i) => {
      expect(tl.xOf(c.t)).toBeCloseTo(bar1.colX[i]);
      expect(tl.timeAt(bar1.colX[i])).toBeCloseTo(c.t);
    });
  });

  it("runs both ways, rising, across the whole piece", () => {
    let last = -Infinity;
    for (let t = 0; t <= four.duration; t += 0.1) {
      const x = tl.xOf(t);
      expect(x).toBeGreaterThan(last);
      expect(tl.timeAt(x)).toBeCloseTo(t);
      last = x;
    }
  });

  it("stops at the ends of the piece", () => {
    expect(tl.timeAt(-1e6)).toBe(0);
    expect(tl.timeAt(1e6)).toBe(four.duration);
  });

  it("names the window the strip is seen through", () => {
    expect(tl.view).toEqual(StaffBars.layout(W, four, focus, four.notes, 0).view);
  });
});

describe("hit-testing", () => {
  it("names the bar under x by what is visible there", () => {
    const seen: (number | null)[] = [];
    for (let x = 0; x < W; x += 4) {
      const b = StaffBars.barAt(W, four, { from: 1, to: 1 }, x);
      if (seen[seen.length - 1] !== b) seen.push(b);
    }
    // clef and signatures, the torn end of bar 1, bar 2, the start of bar 3, the margin
    expect(seen).toEqual([null, 0, 1, 2, null]);
  });

  it("agrees with a page that leaves the other hand off", () => {
    // a different note set is a different spacing — the left hand's
    // off-beat eighths add columns — so the hit-test must use the same
    const score = Core.makeScore([
      n(72, 0, 1), n(72, 1, 1), n(48, 0.5, 0.25, "lower"), n(50, 1.5, 0.25, "lower"), n(72, 2, 2), n(72, 4, 2),
    ], [0, 2, 4, 6]);
    const focus = { from: 0, to: 0 };
    const full = StaffBars.layout(W, score, focus, score.notes).placed[0];
    const upperOnly = StaffBars.layout(W, score, focus, score.notes.filter((x) => x.hand === "upper")).placed[0];
    expect(full.colX).toHaveLength(6); // 0, ½ (an eighth's worth), 1, 1½, and the rests' columns... see engrave
    expect(upperOnly.colX).toHaveLength(2);
    expect(StaffBars.barAt(W, score, focus, full.x1 - 1, "upper", false)).toBe(0);
    expect(StaffBars.barAt(W, score, focus, full.x1 + 1, "upper", false)).toBe(1);
  });
});

describe("what is engraved", () => {
  const page = (from: number, to = from, over: Partial<typeof opts> = {}) =>
    StaffBars.markup(W, H, four, { ...opts, focus: { from, to }, ...over });

  it("opens with the key signature on both staves", () => {
    expect(count(page(0), /♯/g)).toBe(4); // two sharps, two staves
    const cMajor = Core.makeScore(four.notes.map((x) => ({ ...x })), [0, 2, 4, 6, 8]);
    expect(count(StaffBars.markup(W, H, cMajor, { ...opts, focus: { from: 0, to: 0 } }), /♯/g)).toBe(2); // F♯ and C♯ as accidentals... on the treble notes in bar 0 only
  });

  it("opens with the time signature", () => {
    expect(count(page(0), />4<\/text>/g)).toBe(4); // 4 over 4, twice
    const waltz = Core.makeScore([n(60, 0, 0.5)], [{ at: 0, beats: 3, unit: 4 }, 1.5]);
    const svg = StaffBars.markup(W, H, waltz, { ...opts, focus: { from: 0, to: 0 } });
    expect(count(svg, />3<\/text>/g)).toBe(2);
    expect(count(svg, />4<\/text>/g)).toBe(2);
  });

  it("numbers the bars, the focus in bold", () => {
    const svg = page(1);
    expect(svg).toContain('font-weight="700" fill="var(--ink)">2</text>');
    expect(svg).toContain('font-weight="500" fill="var(--ink-dim)">3</text>');
  });

  it("draws hollow heads for halves and wholes, filled for shorter", () => {
    // in the focus — the context bars either side have their own
    const hollow = (svg: string, hand: string) => count(svg, new RegExp(`<ellipse [^>]*fill="none" stroke="var\\(--page-${hand}\\)"`, "g"));
    const solid = (svg: string, hand: string) => count(svg, new RegExp(`<ellipse [^>]*fill="var\\(--page-${hand}\\)"`, "g"));
    expect([hollow(page(2), "r"), hollow(page(2), "l"), solid(page(2), "r")]).toEqual([2, 1, 0]);
    expect([hollow(page(3), "r"), hollow(page(3), "l"), solid(page(3), "r")]).toEqual([1, 1, 0]);
    expect([hollow(page(0), "r"), solid(page(0), "r")]).toEqual([0, 4]);
  });

  it("beams the eighths in twos and gives a lone eighth a flag", () => {
    expect(count(page(1), /<rect [^>]*height="4.5"/g)).toBe(2);
    const lone = Core.makeScore([n(60, 0, 0.25)], [0, 2]);
    const svg = StaffBars.markup(W, H, lone, { ...opts, focus: { from: 0, to: 0 } });
    expect(count(svg, /<path d="M[\d.]+,[\d.]+ C/g)).toBeGreaterThanOrEqual(1); // a flag
    expect(count(svg, /<rect [^>]*height="4.5"/g)).toBe(0);
  });

  it("stems every head shorter than a whole, and never a whole", () => {
    const stems = (svg: string, hand: string) =>
      count(svg, new RegExp(`<line [^>]*stroke="var\\(--page-${hand}\\)" stroke-width="1.6"`, "g"));
    expect([stems(page(3), "r"), stems(page(3), "l")]).toEqual([0, 0]); // two wholes
    expect([stems(page(2), "r"), stems(page(2), "l")]).toEqual([2, 0]); // two halves over a whole
    expect(stems(page(0), "r")).toBe(4); // four quarters
  });

  it("writes a whole rest on a staff with nothing in the bar", () => {
    const trebleOnly = Core.makeScore([n(60, 0, 2)], [0, 2]);
    const svg = StaffBars.markup(W, H, trebleOnly, { ...opts, focus: { from: 0, to: 0 } });
    expect(svg).toContain(`height="${7 * 0.85}" fill="var(--glyph)"`); // the whole-rest rectangle
  });

  it("ties a note across the barline, on both pages", () => {
    const across = Core.makeScore([n(60, 1.5, 1)], [0, 2, 4]);
    const svg = StaffBars.markup(W, H, across, { ...opts, focus: { from: 0, to: 1 } });
    expect(count(svg, /<path d="M[\d.-]+,[\d.-]+ Q/g)).toBe(1); // one tie, joining the two heads
    const firstOnly = StaffBars.markup(W, H, across, { ...opts, focus: { from: 0, to: 0 } });
    expect(count(firstOnly, /<path d="M[\d.-]+,[\d.-]+ Q/g)).toBe(1); // a tie to the torn next bar
  });

  it("ends the piece on a final barline, and the staff with it", () => {
    const FINAL = /<rect [^>]*width="4" [^>]*fill="var\(--grid-oct\)"/g;
    expect(count(page(3), FINAL)).toBe(1);
    expect(count(page(1), FINAL)).toBe(0);
    // with nothing torn off to the right, no staff line runs past the end
    const staffEnds = [...page(3).matchAll(/x2="([\d.]+)" y2="[\d.]+" stroke="var\(--staff-line\)"/g)].map((m) => +m[1]);
    expect(Math.max(...staffEnds)).toBeLessThan(W - 8);
  });

  it("is deterministic", () => {
    expect(page(1)).toBe(page(1));
  });

  it("draws nothing for a degenerate region", () => {
    expect(StaffBars.markup(0, H, four, { ...opts, focus: { from: 0, to: 0 } })).toBe("");
  });
});

describe("colour", () => {
  const { steps } = makeSteps(four, "both");
  const heads = (svg: string, fill: string) =>
    count(svg, new RegExp(`<ellipse [^>]*(?:fill|stroke)="${fill.replace(/[()]/g, "\\$&")}"`, "g"));

  it("lights the current step's heads in the strike gold and rules their column", () => {
    const svg = StaffBars.markup(W, H, four, { ...opts, focus: { from: 0, to: 0 }, current: steps[0] });
    expect(heads(svg, "var(--note-lit)")).toBe(2); // D4 and the C3 under it
    expect(svg).toContain(`filter="url(#${G})"`);
    expect(svg).toContain('stroke="var(--playhead)"');
  });

  describe("a key held that the step never asked for", () => {
    const at = (wrong: number[], current: (typeof steps)[number] | null = steps[0]) =>
      StaffBars.markup(W, H, four, { ...opts, focus: { from: 0, to: 0 }, current, wrong: new Set(wrong) });
    const ruleX = (svg: string) => +/<line x1="([\d.]+)"[^>]*stroke="var\(--playhead\)"/.exec(svg)![1];
    const reds = (svg: string) =>
      [...svg.matchAll(/<ellipse cx="([\d.-]+)" cy="([\d.-]+)"[^>]*fill="var\(--wrong\)"/g)].map((m) => [+m[1], +m[2]]);
    const midY = H / 2;

    it("is a red head in the step's column, where its pitch is written", () => {
      const svg = at([65]); // F4 against the D4 asked for, in D major
      const [[x, y]] = reds(svg);
      expect(x).toBe(ruleX(svg));
      expect(y).toBe(midY - 3 * 7); // F4 is three half-spaces over middle C
      expect(svg).toContain("♮"); // the key says F♯
    });

    it("steps aside from a head it would overprint", () => {
      const svg = at([64]); // E4, a second over D4
      const [[x]] = reds(svg);
      expect(x).toBeGreaterThan(ruleX(svg));
    });

    it("takes the grand staff's ledger lines", () => {
      const plain = at([]);
      const high = at([84]); // C6, two ledgers over the treble staff
      expect(count(high, /stroke="var\(--staff-line\)"/g) - count(plain, /stroke="var\(--staff-line\)"/g)).toBe(2);
    });

    it("is not drawn without a step to measure it by", () => {
      expect(reds(at([65], null))).toEqual([]);
      expect(reds(StaffBars.markup(W, H, four, { ...opts, focus: { from: 0, to: 0 }, wrong: new Set([65]) }))).toEqual([]);
    });
  });

  it("hues the focus by hand and the context in the page's context ink", () => {
    const svg = StaffBars.markup(W, H, four, { ...opts, focus: { from: 1, to: 1 } });
    expect(heads(svg, "var(--page-r)")).toBe(5);
    expect(heads(svg, "var(--page-l)")).toBe(1);
    expect(heads(svg, "var(--page-context)")).toBeGreaterThan(0);
  });

  it("inks the hand not being practised in the page's own token, and leaves it off when told", () => {
    const shown = StaffBars.markup(W, H, four, { ...opts, focus: { from: 0, to: 0 }, hand: "upper" });
    expect(heads(shown, "var(--page-l-dim)")).toBe(1);
    const hidden = StaffBars.markup(W, H, four, { ...opts, focus: { from: 0, to: 0 }, hand: "upper", showOther: false });
    expect(heads(hidden, "var(--page-l-dim)")).toBe(0);
  });

  it("sits the isolated bars on a panel", () => {
    expect(StaffBars.markup(W, H, four, { ...opts, focus: { from: 1, to: 2 }, range: { from: 1, to: 2 } }))
      .toContain('fill="var(--panel)"');
    expect(StaffBars.markup(W, H, four, { ...opts, focus: { from: 1, to: 2 } })).not.toContain('fill="var(--panel)"');
  });
});
