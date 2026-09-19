/* ====================================================================
   STAFF_SCORE — the whole piece as sheet music. Where staff-bars.ts opens
   the page to the bars being worked on, this sets EVERY bar, flowed into
   lines (systems) on portrait sheets of paper stacked one under another,
   the way a printed score is: each line opens with the clef and key, only
   the first also states the time, and the piece ends on a final barline.

   Five decisions:

   1. PAPER. A sheet is a fixed portrait page in A4's proportions, and the
      music on it is drawn at one fixed size. The window never reshapes the
      sheet or resizes the notes to fit more in: a longer piece is more
      sheets, and the reader scrolls. The one exception is a window
      narrower than a sheet, which shows the sheet whole, smaller — the
      way a document viewer fits a page to a phone — rather than cutting
      off the ends of the lines.

   2. ENGRAVER. The sheets are set by Verovio (verovio.ts), from the
      notation engrave.ts derives, written as MEI (mei.ts): the same notes,
      values, ties, beams and accidentals as every other page here, placed
      by a real engraving engine. The engine arrives asynchronously, so
      until it has — or if it cannot run — the sheets are set by the
      built-in engraver instead: each line placed and drawn by
      staff-bars.ts (`placeLine`, `drawLine`), the way the single-line page
      draws a bar. Both set the same paper at the same staff size, and
      everything outside the sheets — hit-testing, following the cursor,
      scrolling — asks the one engine-neutral layout, so it cannot tell
      which engine drew them.

   3. LINE BREAKS AND SHEETS are the engraver's. Verovio breaks and
      justifies by its own rules. The built-in flow is greedy: bars go on a
      line while their natural widths, loosened by LOOSE, still fit, and
      the line is justified to the width, except a short last line, which
      is stretched no further than LOOSE; as many lines as fit go on a
      sheet, a full sheet spread to its foot, the last one left at its
      natural spacing from the top.

   4. MARKS OVER THE MUSIC. On either engraver, the isolated range is a
      panel under the bars, the current step's heads are lit in the strike
      gold with a glow, and a playhead-coloured rule runs through the
      column it strikes. On Verovio's sheets the engraving is never
      re-set for any of that: the hands and the lit heads are a stylesheet
      over the classes and ids mei.ts gave them, and the rule and panel are
      placed from the geometry verovio.ts read off the page.

   5. SCROLLING is a number handed in, not a thing this module does. The
      caller owns the scroll position (a native scroller, in the app) and
      this draws the sheets at that offset, skipping the ones out of view —
      so it stays a pure function, and a long piece costs no more per frame
      than a short one.

   The layouts are memoized because they engrave the whole piece and the
   view redraws every frame; the memos are caches, never a source of truth.
   ==================================================================== */
import { StaffBars, type LineOpts, type PageLayout } from "./staff-bars";
import { HALF } from "./staff-std";
import { engrave, type EngravedBar } from "./engrave";
import { RangeMarks, gripsMarkup, panelMarkup, stopsOf, type End, type MarkBar } from "./range-marks";
import { headId, headPrefix, toMei } from "./mei";
import { Verovio, type PageSpec, type VrvPage } from "./verovio";
import { text } from "./defs";
import { soundingIn, type HandFilter } from "../steps";
import type { Bar, BarRange, Score } from "../types";

/** One built-in line's height: the grand staff with two ledger lines each
 *  way, its bar numbers above, and air before the next line. */
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
/** How loosely a built-in line is packed, and the most a short last line
 *  stretches. */
const LOOSE = 1.3;
const LINE_W = PAPER_W - 2 * MARGIN_X;
const PER_SHEET = Math.max(1, Math.floor((PAPER_H - MARGIN_TOP - MARGIN_FOOT) / SYS_H));
/** The distance between two staff lines — the size the music is set at. */
const SPACE = 2 * HALF;
/** How far past its outer staff lines a Verovio line reaches, for the
 *  panel, the rule, and what counts as on the line: two ledger lines. */
const REACH = 3 * SPACE;
/** How far under the window's top a followed line is brought to rest. */
const FOLLOW_AIR = 24;

/** The paper, for Verovio: decision 1's sheet, at decision 2's size. */
const SPEC: PageSpec = {
  width: PAPER_W,
  height: PAPER_H,
  margin: { top: MARGIN_TOP, bottom: MARGIN_FOOT, left: MARGIN_X, right: MARGIN_X },
  space: SPACE,
};

/** A bar on a line, in its sheet's units, with its struck instants placed
 *  — what the isolated range's panel and grips are drawn and hit-tested
 *  against (range-marks.ts). */
export interface BarSpan extends MarkBar {
  readonly index: number;
}

/** One line of music, whichever engraver set it, in its sheet's units. */
export interface System {
  /** First and last bar on the line, inclusive. */
  readonly from: number;
  readonly to: number;
  /** The line's top on its sheet, and how tall it stands. */
  readonly y: number;
  readonly h: number;
  readonly bars: readonly BarSpan[];
}

/** A line the built-in engraver set, with how it placed its bars. */
export interface BuiltInSystem extends System {
  readonly line: PageLayout;
}

export interface Sheet<S extends System = System> {
  /** The sheet's top in the scrolling content, in pixels. */
  readonly top: number;
  readonly systems: readonly S[];
}

export interface VerovioSheet extends Sheet {
  readonly page: VrvPage;
}

interface Paper {
  /** Pixels per sheet unit: 1, unless the window is narrower than a sheet. */
  readonly k: number;
  /** The sheets' left edge, in pixels. */
  readonly x: number;
  /** Everything that scrolls, top to bottom, in pixels. */
  readonly height: number;
}

export type ScoreLayout =
  | (Paper & { readonly engine: "built-in"; readonly sheets: readonly Sheet<BuiltInSystem>[] })
  | (Paper & { readonly engine: "verovio"; readonly sheets: readonly VerovioSheet[] });

/** Decision 1: one size, unless the window cannot hold a sheet's width. */
function paper(W: number, count: number): Paper & { tops: number[] } {
  const k = Math.min(1, Math.max(0.1, (W - 2 * GUTTER) / PAPER_W));
  const tops = Array.from({ length: count }, (_, i) => GAP + i * (PAPER_H * k + GAP));
  return { k, x: (W - PAPER_W * k) / 2, height: GAP + count * (PAPER_H * k + GAP), tops };
}

// --- the built-in engraver --------------------------------------------------

/** Does the line starting at bar `i` state the time? The first line does,
 *  and so does any line whose first bar changes the meter. */
const opensWithTime = (bars: readonly Bar[], i: number): boolean =>
  i === 0 || bars[i].beats !== bars[i - 1].beats || bars[i].unit !== bars[i - 1].unit;

/** Decision 3: the bars of each line, as [from, to] inclusive. */
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

function builtIn(W: number, score: Score, hand: HandFilter, showOther: boolean): ScoreLayout {
  const bars = score.bars;
  const ebs = engrave(StaffBars.visibleNotes(score, hand, showOther), bars, 0, bars.length - 1);
  const lines = breakLines(LINE_W, bars, ebs.map((eb) => StaffBars.naturalW(eb) * LOOSE));
  const placed = lines.map(([from, to], i) => {
    const line = StaffBars.placeLine(LINE_W, {
      bars: ebs.slice(from, to + 1),
      before: [],
      after: [],
      time: opensWithTime(bars, from),
      maxScale: i === lines.length - 1 ? LOOSE : Infinity,
      final: to === bars.length - 1,
    });
    const spans = StaffBars.marksOf(line).map((m) => ({
      ...m, index: m.bar.index, x0: MARGIN_X + m.x0, x1: MARGIN_X + m.x1,
      stops: m.stops.map((st) => ({ q: st.q, x: MARGIN_X + st.x })),
    }));
    return { from, to, line, bars: spans };
  });

  const count = Math.ceil(placed.length / PER_SHEET);
  const { tops, ...P } = paper(W, count);
  const room = PAPER_H - MARGIN_TOP - MARGIN_FOOT;
  const sheets = tops.map((top, s): Sheet<BuiltInSystem> => {
    const on = placed.slice(s * PER_SHEET, (s + 1) * PER_SHEET);
    const spread = s < count - 1 && on.length > 1 ? (room - on.length * SYS_H) / (on.length - 1) : 0;
    return { top, systems: on.map((sys, j) => ({ ...sys, y: MARGIN_TOP + j * (SYS_H + spread), h: SYS_H })) };
  });
  return { ...P, engine: "built-in", sheets };
}

// --- Verovio ------------------------------------------------------------------

interface Engraved {
  readonly pages: VrvPage[];
  /** The notation the pages were set from, one per bar: where each bar's
   *  struck instants are, for the range's marks. */
  readonly ebs: EngravedBar[];
}

let engraved: { key: readonly unknown[]; value: Engraved | null } | null = null;

/** The piece set by Verovio for the notes the page shows — independent of
 *  the window, so a resize never re-sets it. Null while the engine is not
 *  loaded, and when it set nothing. */
function verovioPages(score: Score, hand: HandFilter, showOther: boolean): Engraved | null {
  if (!Verovio.ready()) return null;
  const key = [score, hand, showOther];
  if (!engraved || !engraved.key.every((k, i) => k === key[i])) {
    const bars = score.bars;
    const ebs = engrave(StaffBars.visibleNotes(score, hand, showOther), bars, 0, bars.length - 1);
    const pages = Verovio.engrave(toMei(ebs, hand), SPEC);
    engraved = { key, value: pages && pages.length > 0 ? { pages, ebs } : null };
  }
  return engraved.value;
}

function verovio(W: number, { pages, ebs }: Engraved): ScoreLayout {
  const { tops, ...P } = paper(W, pages.length);
  const sheets = pages.map((page, i): VerovioSheet => ({
    top: tops[i],
    page,
    systems: page.systems.map((s, si) => ({
      from: s.bars[0].index,
      to: s.bars[s.bars.length - 1].index,
      y: s.top - REACH,
      h: s.bottom - s.top + 2 * REACH,
      // a struck instant is where Verovio set the first head of a note
      // struck then, on this line
      bars: s.bars.map((b) => ({
        ...b,
        bar: ebs[b.index].bar,
        stops: stopsOf(ebs[b.index], (h) => {
          const at = page.heads.get(headId(h.note.id, 0));
          return at && at.system === si ? at.x : undefined;
        }),
      })),
    })),
  }));
  return { ...P, engine: "verovio", sheets };
}

// --- the layout -----------------------------------------------------------------

let memo: { key: readonly unknown[]; value: ScoreLayout } | null = null;

/** The sheets for a region `W` wide, cut from the notes the page shows.
 *  The same arguments give the same layout — the one `markup` draws and
 *  `barAt` hit-tests — until the engine arrives and re-sets it. */
export function layout(W: number, score: Score, hand: HandFilter, showOther: boolean): ScoreLayout {
  const pages = verovioPages(score, hand, showOther);
  const key = [W, score, hand, showOther, pages];
  if (memo && memo.key.every((k, i) => k === key[i])) return memo.value;
  const value = pages ? verovio(W, pages) : builtIn(W, score, hand, showOther);
  memo = { key, value };
  return value;
}

// --- drawing ----------------------------------------------------------------------

/** Verovio's page in this app's colours. Its own stylesheet strokes every
 *  path in `currentColor`, so colour is set by `color`, part by part:
 *  furniture in the glyph ink, staff and ledger lines in the staff's,
 *  and each hand in its page token — dimmed when it is not the one being
 *  practised — the same tokens the built-in page reads. */
const PAGE_STYLE = [
  `.vrv svg{color:var(--glyph);fill:currentColor}`,
  `.vrv g.staff{color:var(--staff-line)}`,
  `.vrv g.staff>g{color:var(--glyph)}`,
  `.vrv g.staff>g.ledgerLines{color:var(--staff-line)}`,
  `.vrv g.barLine{color:var(--grid-oct)}`,
  `.vrv g.mNum{color:var(--ink-dim)}`,
  `.vrv .upper{color:var(--page-r)}`,
  `.vrv .lower{color:var(--page-l)}`,
  `.vrv .free{color:var(--note)}`,
  `.vrv .upper.other{color:var(--hand-r-dim)}`,
  `.vrv .lower.other{color:var(--hand-l-dim)}`,
  `.vrv .free.other{color:var(--note-dim)}`,
].join("");

/** The current step's heads, lit: every head of every note it sounds —
 *  tied continuations too, as on the built-in page. */
function litStyle(o: LineOpts): string {
  if (!o.current) return "";
  const sel = soundingIn(o.current).map((n) => `.vrv g[id^="${headPrefix(n.id)}"]>g.notehead`);
  return sel.length ? `${sel.join(",")}{color:var(--note-lit);filter:url(#${o.glowId})}` : "";
}

/** Where the current step strikes, on the sheet that holds it: the first
 *  of its attacks Verovio set a head for. */
function strikeAt(sheets: readonly VerovioSheet[], o: LineOpts): { sheet: number; x: number; system: number } | null {
  if (!o.current) return null;
  for (const n of o.current.attack)
    for (let s = 0; s < sheets.length; s++) {
      const head = sheets[s].page.heads.get(headId(n.id, 0));
      if (head) return { sheet: s, x: head.x, system: head.system };
    }
  return null;
}

/** Decision 4, on one of Verovio's sheets: the panel under the isolated
 *  bars, the page, and the rule through the struck column. */
function verovioSheet(sheet: VerovioSheet, o: LineOpts, strike: { x: number; system: number } | null): string {
  let out = "";
  const r = o.range;
  if (r) for (const sys of sheet.systems) out += panelMarkup(sys.bars, r, sys.y, sys.h);
  out += `<g class="vrv">${sheet.page.svg}</g>`;
  if (r) for (const sys of sheet.systems) out += gripsMarkup(sys.bars, r, sys.y, sys.h);
  if (strike) {
    const sys = sheet.systems[strike.system];
    out += `<line x1="${strike.x}" y1="${sys.y}" x2="${strike.x}" y2="${sys.y + sys.h}" ` +
      `stroke="var(--playhead)" stroke-width="1.5" opacity="0.9"/>`;
  }
  return out;
}

/** The sheets in view of a window `H` tall scrolled to `scroll`, drawn in
 *  that window's own 0..H space. Sheets and lines out of view are skipped. */
export function markup(W: number, H: number, scroll: number, score: Score, o: LineOpts): string {
  if (!W || !H || score.bars.length === 0) return "";
  const L = layout(W, score, o.hand, o.showOther);
  let out = `<rect x="0" y="0" width="${W}" height="${H}" fill="var(--desk)"/>`;
  const strike = L.engine === "verovio" ? strikeAt(L.sheets, o) : null;
  if (L.engine === "verovio") out += `<style>${PAGE_STYLE}${litStyle(o)}</style>`;
  L.sheets.forEach((sheet: Sheet, p) => {
    const top = sheet.top - scroll;
    if (top > H || top + PAPER_H * L.k < 0) return;
    out += `<g transform="translate(${L.x},${top}) scale(${L.k})">` +
      `<rect x="0" y="0" width="${PAPER_W}" height="${PAPER_H}" fill="var(--bg)" stroke="var(--line-acc)" stroke-width="1"/>`;
    if (L.engine === "verovio") {
      out += verovioSheet(L.sheets[p], o, strike && strike.sheet === p ? strike : null);
    } else {
      for (const sys of L.sheets[p].systems) {
        const y = top + sys.y * L.k;
        if (y > H || y + sys.h * L.k < 0) continue;
        out += `<g transform="translate(${MARGIN_X},${sys.y})">` + StaffBars.drawLine(SYS_H, sys.line, o) + `</g>`;
      }
    }
    if (L.sheets.length > 1)
      out += text(PAPER_W / 2, PAPER_H - MARGIN_FOOT / 2, String(p + 1),
        { size: 12, weight: 600, fill: "var(--ink-dim)" });
    out += `</g>`;
  });
  return out;
}

// --- reading the layout back ---------------------------------------------------------

/** The line a point in the scrolling content is on, with the point in that
 *  line's sheet's units — or null in a gap, a margin, or off the sheets. */
function lineAt(L: ScoreLayout, x: number, y: number): { sys: System; sx: number } | null {
  for (const sheet of L.sheets as readonly Sheet[]) {
    const sy = (y - sheet.top) / L.k;
    if (sy < 0 || sy > PAPER_H) continue;
    const sys = sheet.systems.find((s) => sy >= s.y && sy < s.y + s.h);
    return sys ? { sys, sx: (x - L.x) / L.k } : null;
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
  const b = hit.sys.bars.find((s) => hit.sx >= s.x0 && hit.sx < s.x1);
  return b ? b.index : null;
}

/** The top and bottom, in the scrolling content, of the line holding
 *  `bar` — what a scroller brings into view to follow the cursor. */
export function lineSpan(
  W: number, score: Score, hand: HandFilter, showOther: boolean, bar: number,
): [number, number] | null {
  if (!W || score.bars.length === 0) return null;
  const L = layout(W, score, hand, showOther);
  for (const sheet of L.sheets as readonly Sheet[])
    for (const sys of sheet.systems)
      if (bar >= sys.from && bar <= sys.to)
        return [sheet.top + sys.y * L.k, sheet.top + (sys.y + sys.h) * L.k];
  return null;
}

/** Following `bar` down sheets seen through a window `H` tall: the scroll
 *  positions at which its line is in sight, and where to scroll to bring it
 *  back — its line a little under the window's top. Null sight when the bar
 *  is on no line. */
export function sightOf(
  W: number, H: number, score: Score, hand: HandFilter, showOther: boolean, bar: number,
): { sight: [number, number] | null; home: number } {
  const line = lineSpan(W, score, hand, showOther, bar);
  return line
    ? { sight: [line[1] - H, line[0]], home: Math.max(0, line[0] - FOLLOW_AIR) }
    : { sight: null, home: 0 };
}

/** How tall the scrolling content is, in pixels. */
export const contentHeight = (W: number, score: Score, hand: HandFilter, showOther: boolean): number =>
  !W || score.bars.length === 0 ? 0 : layout(W, score, hand, showOther).height;

/** Which of the range's grips a point is on — `x` across the region, `y`
 *  down the scrolling content — or null. */
export function gripAt(
  W: number, score: Score, hand: HandFilter, showOther: boolean, range: BarRange, x: number, y: number,
): End | null {
  if (!W || score.bars.length === 0) return null;
  const L = layout(W, score, hand, showOther);
  const hit = lineAt(L, x, y);
  // the reach is in pixels, and a sheet shown smaller has fewer of them
  return hit ? RangeMarks.gripAt(hit.sys.bars, range, hit.sx, RangeMarks.GRIP_REACH / L.k) : null;
}

/** The score time of the nearest place a range's end can sit to a point
 *  (range-marks.ts, decision 3), or null off every line. */
export function timeAt(
  W: number, score: Score, hand: HandFilter, showOther: boolean, x: number, y: number,
): number | null {
  if (!W || score.bars.length === 0) return null;
  const hit = lineAt(layout(W, score, hand, showOther), x, y);
  return hit ? RangeMarks.timeAt(hit.sys.bars, hit.sx) : null;
}

export const StaffScore = { markup, barAt, gripAt, timeAt, layout, lineSpan, sightOf, contentHeight };
