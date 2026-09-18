/* ====================================================================
   STAFF_SCORE — the whole piece as sheet music. Where staff-bars.ts opens
   the page to the bars being worked on, this sets EVERY bar, flowed into
   lines (systems) on portrait sheets of paper stacked one under another,
   the way a printed score is: each line opens with the clef and key, only
   the first also states the time, and the piece ends on a final barline.

   It owns only the FLOW — which bars go on which line, which lines on
   which sheet, and where the sheets sit. Each line is placed and drawn by
   staff-bars.ts (`placeLine`, `drawLine`), so a bar on this page and the
   same bar on the single-line page are the same drawing, at the same size.

   Four decisions:

   1. PAPER. A sheet is a fixed portrait page in A4's proportions, and the
      music on it is drawn at one fixed size. The window never reshapes the
      sheet or resizes the notes to fit more in: a longer piece is more
      sheets, and the reader scrolls. The one exception is a window
      narrower than a sheet, which shows the sheet whole, smaller — the
      way a document viewer fits a page to a phone — rather than cutting
      off the ends of the lines.

   2. LINE BREAKS. Greedy: bars go on a line while their natural widths,
      loosened by LOOSE, still fit; then the line is justified to the
      width. The last line is stretched no further than LOOSE, so a short
      final line is spaced like the others instead of pulled across.

   3. SHEETS. As many lines as fit between the margins. A full sheet
      spreads them to its foot, as an engraver does; the last sheet keeps
      them at their natural spacing from the top.

   4. SCROLLING is a number handed in, not a thing this module does. The
      caller owns the scroll position (a native scroller, in the app) and
      this draws the sheets at that offset, skipping the ones out of view —
      so it stays a pure function, and a long piece costs no more per frame
      than a short one.

   The layout is memoized because it engraves the whole piece and the view
   redraws every frame; the memo is a cache, never a source of truth.
   ==================================================================== */
import { StaffBars, type LineOpts, type PageLayout } from "./staff-bars";
import { engrave } from "./engrave";
import { text } from "./defs";
import type { HandFilter } from "../steps";
import type { Bar, Score } from "../types";

/** One line's height: the grand staff with two ledger lines each way, its
 *  bar numbers above, and air before the next line. */
export const SYS_H = 224;
/** A sheet, in the music's own units: A4's proportions. */
export const PAPER_W = 880;
export const PAPER_H = Math.round(PAPER_W * Math.SQRT2);
const MARGIN_X = 36;
const MARGIN_TOP = 40;
/** The foot holds the page number. */
const MARGIN_FOOT = 56;
/** Space between sheets, and above the first and below the last. */
const GAP = 24;
/** The least room either side of a sheet in a narrow window. */
const GUTTER = 12;
/** How loosely a line is packed, and the most a short last line stretches. */
const LOOSE = 1.3;
const LINE_W = PAPER_W - 2 * MARGIN_X;
const PER_SHEET = Math.max(1, Math.floor((PAPER_H - MARGIN_TOP - MARGIN_FOOT) / SYS_H));

export interface System {
  /** First and last bar on the line, inclusive. */
  readonly from: number;
  readonly to: number;
  readonly line: PageLayout;
  /** The line's top on its sheet, in the sheet's units. */
  readonly y: number;
}

export interface Sheet {
  /** The sheet's top in the scrolling content, in pixels. */
  readonly top: number;
  readonly systems: readonly System[];
}

export interface ScoreLayout {
  /** Pixels per sheet unit: 1, unless the window is narrower than a sheet. */
  readonly k: number;
  /** The sheets' left edge, in pixels. */
  readonly x: number;
  readonly sheets: readonly Sheet[];
  /** Everything that scrolls, top to bottom, in pixels. */
  readonly height: number;
}

/** Does the line starting at bar `i` state the time? The first line does,
 *  and so does any line whose first bar changes the meter. */
const opensWithTime = (bars: readonly Bar[], i: number): boolean =>
  i === 0 || bars[i].beats !== bars[i - 1].beats || bars[i].unit !== bars[i - 1].unit;

/** Decision 2: the bars of each line, as [from, to] inclusive. */
function breakLines(W: number, bars: readonly Bar[], widths: readonly number[]): [number, number][] {
  const lines: [number, number][] = [];
  let from = 0;
  let used = 0;
  let room = StaffBars.roomFor(W, bars[0], true);
  for (let i = 0; i < widths.length; i++) {
    if (i > from && used + widths[i] > room) {
      lines.push([from, i - 1]);
      from = i;
      used = 0;
      room = StaffBars.roomFor(W, bars[i], opensWithTime(bars, i));
    }
    used += widths[i];
  }
  lines.push([from, widths.length - 1]);
  return lines;
}

function compute(W: number, score: Score, hand: HandFilter, showOther: boolean): ScoreLayout {
  const bars = score.bars;
  const ebs = engrave(StaffBars.visibleNotes(score, hand, showOther), bars, 0, bars.length - 1);
  const lines = breakLines(LINE_W, bars, ebs.map((eb) => StaffBars.naturalW(eb) * LOOSE));
  const placed = lines.map(([from, to], i) => ({
    from, to,
    line: StaffBars.placeLine(LINE_W, {
      bars: ebs.slice(from, to + 1),
      before: [],
      after: [],
      time: opensWithTime(bars, from),
      maxScale: i === lines.length - 1 ? LOOSE : Infinity,
      final: to === bars.length - 1,
    }),
  }));

  // decision 1: one size, unless the window cannot hold a sheet's width
  const k = Math.min(1, Math.max(0.1, (W - 2 * GUTTER) / PAPER_W));
  const x = (W - PAPER_W * k) / 2;

  // decision 3: fill each sheet; spread a full one to its foot
  const sheets: Sheet[] = [];
  const room = PAPER_H - MARGIN_TOP - MARGIN_FOOT;
  for (let i = 0; i < placed.length; i += PER_SHEET) {
    const on = placed.slice(i, i + PER_SHEET);
    const last = i + PER_SHEET >= placed.length;
    const spread = !last && on.length > 1 ? (room - on.length * SYS_H) / (on.length - 1) : 0;
    sheets.push({
      top: GAP + sheets.length * (PAPER_H * k + GAP),
      systems: on.map((s, j) => ({ ...s, y: MARGIN_TOP + j * (SYS_H + spread) })),
    });
  }
  return { k, x, sheets, height: GAP + sheets.length * (PAPER_H * k + GAP) };
}

let memo: { key: readonly unknown[]; value: ScoreLayout } | null = null;

/** The sheets for a region `W` wide, cut from the notes the page shows.
 *  The same arguments give the same layout — the one `markup` draws and
 *  `barAt` hit-tests. */
export function layout(W: number, score: Score, hand: HandFilter, showOther: boolean): ScoreLayout {
  const key = [W, score, hand, showOther];
  if (memo && memo.key.every((k, i) => k === key[i])) return memo.value;
  const value = compute(W, score, hand, showOther);
  memo = { key, value };
  return value;
}

/** The sheets in view of a window `H` tall scrolled to `scroll`, drawn in
 *  that window's own 0..H space. Sheets and lines out of view are skipped. */
export function markup(W: number, H: number, scroll: number, score: Score, o: LineOpts): string {
  if (!W || !H || score.bars.length === 0) return "";
  const L = layout(W, score, o.hand, o.showOther);
  let out = `<rect x="0" y="0" width="${W}" height="${H}" fill="var(--desk)"/>`;
  L.sheets.forEach((sheet, p) => {
    const top = sheet.top - scroll;
    if (top > H || top + PAPER_H * L.k < 0) return;
    out += `<g transform="translate(${L.x},${top}) scale(${L.k})">` +
      `<rect x="0" y="0" width="${PAPER_W}" height="${PAPER_H}" fill="var(--bg)" stroke="var(--line-acc)" stroke-width="1"/>`;
    for (const sys of sheet.systems) {
      const y = top + sys.y * L.k;
      if (y > H || y + SYS_H * L.k < 0) continue;
      out += `<g transform="translate(${MARGIN_X},${sys.y})">` + StaffBars.drawLine(SYS_H, sys.line, o) + `</g>`;
    }
    if (L.sheets.length > 1)
      out += text(PAPER_W / 2, PAPER_H - MARGIN_FOOT / 2, String(p + 1),
        { size: 12, weight: 600, fill: "var(--ink-dim)" });
    out += `</g>`;
  });
  return out;
}

/** The line a point in the scrolling content is on, with the point in that
 *  line's own units — or null in a gap, a margin, or off the sheets. */
function lineAt(L: ScoreLayout, x: number, y: number): { sys: System; lx: number } | null {
  for (const sheet of L.sheets) {
    const sy = (y - sheet.top) / L.k;
    if (sy < 0 || sy > PAPER_H) continue;
    const sys = sheet.systems.find((s) => sy >= s.y && sy < s.y + SYS_H);
    return sys ? { sys, lx: (x - L.x) / L.k - MARGIN_X } : null;
  }
  return null;
}

/** Which bar a point is over — `x` across the region, `y` down the
 *  scrolling content (window y plus the scroll) — or null off every bar. */
export function barAt(
  W: number, score: Score, hand: HandFilter, showOther: boolean, x: number, y: number,
): number | null {
  if (!W || score.bars.length === 0) return null;
  const hit = lineAt(layout(W, score, hand, showOther), x, y);
  if (!hit) return null;
  const p = hit.sys.line.placed.find((b) => hit.lx >= b.x0 && hit.lx < b.x1);
  return p ? p.eb.bar.index : null;
}

/** The top and bottom, in the scrolling content, of the line holding
 *  `bar` — what a scroller brings into view to follow the cursor. */
export function lineSpan(
  W: number, score: Score, hand: HandFilter, showOther: boolean, bar: number,
): [number, number] | null {
  if (!W || score.bars.length === 0) return null;
  const L = layout(W, score, hand, showOther);
  for (const sheet of L.sheets)
    for (const sys of sheet.systems)
      if (bar >= sys.from && bar <= sys.to)
        return [sheet.top + sys.y * L.k, sheet.top + (sys.y + SYS_H) * L.k];
  return null;
}

/** How tall the scrolling content is, in pixels. */
export const contentHeight = (W: number, score: Score, hand: HandFilter, showOther: boolean): number =>
  !W || score.bars.length === 0 ? 0 : layout(W, score, hand, showOther).height;

export const StaffScore = { markup, barAt, layout, lineSpan, contentHeight };
