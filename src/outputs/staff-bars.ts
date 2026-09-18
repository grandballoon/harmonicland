/* ====================================================================
   STAFF_BARS — the page: a run of bars as sheet music. StaffStd scrolls
   noteheads under a playhead, an instant per note; this engraves them —
   stems, flags, beams, rests, dots, ties, a key signature and a time
   signature — from what engrave.ts derives per bar, and lays the bars
   out the way a page does: by rhythm, not by the clock. Nothing moves
   under a playhead. It is the page open on the stand while the learner
   works on the bars it shows.

   What the page shows, and how it is told apart — by KIND, never shade:

   - the FOCUS, the bars being worked on, fitted to the width. Notes wear
     their hand's page token (or the plain note colour when the score has
     no hands) — the hand's hue on the dark field, black ink on paper; the
     hand not being practised wears its dim token, the same rule the
     practice keyboard follows.
   - the CONTEXT: every other bar of the piece, engraved at the same
     scale either side of the focus and seen through a WINDOW between the
     signatures and the right margin, in ink-dim. At rest the window
     shows the last few notes of the previous bar and the first few of
     the next, torn at its edges — where the passage comes from and goes
     to. PANNED (`pan`, pixels from rest; a scroller owns it, as with the
     whole score) it slides along the strip to any bar of the piece, the
     clef and signatures staying put like the edge of a stand.
   - the CURSOR: the current step's heads in the strike gold with a glow,
     and a playhead-coloured rule through their column, so the page and
     the keyboard say "now" in one colour.
   - the RANGE, when bars are isolated, on a faint panel — a mark of a
     different kind from any note's hue.

   The page is built of LINES: `placeLine` decides a line's x's and
   `drawLine` draws it. This page is one line — the whole piece as one
   strip, windowed by `panTo`; staff-score.ts sets the whole piece as a
   column of lines with no window, so the two pages draw a bar alike.

   Every staff line, clef, ledger, position and accidental glyph comes
   from staff-std.ts; every value, rest, beam and printed accidental from
   engrave.ts. This file owns the LAYOUT — columns to pixels — and the
   glyphs that only a page has: heads by value, stems, flags, beams,
   rests, ties, signatures. A pure markup function, like every renderer
   here: no DOM, no live state, renderable from a fabricated moment.
   ==================================================================== */
import { ACC, CLEF_W, HALF, R, ledgers, posFromMiddleC, staves, yOfPos } from "./staff-std";
import { glowAttr, text } from "./defs";
import {
  engrave, type Chord, type EngravedBar, type Head, type Staff, type Value,
} from "./engrave";
import { inHand, soundingIn, type HandFilter, type Step } from "../steps";
import type { Bar, BarRange, Hand, Note, Score } from "../types";

/** The share of the usable width each neighbouring bar may show. Small:
 *  the bars are the subject, the context is a glance. */
const CTX_FRAC = 0.14;
/** Breathing room at the right edge, and after the signatures. */
const PAD = 16;
/** Stem length: three and a half spaces, the engraver's norm. */
const STEM = 7 * HALF;
/** Vertical reach of the staves from middle C: the outermost line is at
 *  ±10 half-spaces and two ledger lines beyond is the piano's ordinary
 *  range. Barlines and the cursor span this. */
const STAFF_REACH = 14 * HALF;
/** Width of one sharp or flat in a key signature, and of a time signature. */
const KEY_ACC_W = 9;
const TIME_W = 26;
/** Room inside a bar before its first column. */
const LEAD = 12;
/** Beam thickness and the gap between a primary and a secondary beam. */
const BEAM_H = 4.5;
const BEAM_GAP = 7;
/** The middle line of each staff, where rests hang and stems turn. */
const MID: Record<Staff, number> = { treble: 6, bass: -6 };

export interface BarsOpts {
  glowId: string;
  /** The bars to engrave in full. */
  focus: BarRange;
  /** The bars that are ISOLATED, if any — drawn on a panel so a focus that
   *  merely follows the cursor and one the learner chose read differently. */
  range: BarRange | null;
  current: Step | null;
  hand: HandFilter;
  /** Engrave the hand not being practised? Off, it is left off the page
   *  the same way it is left off the keyboard. */
  showOther: boolean;
  /** How far along the strip the window is panned, in pixels from rest —
   *  positive toward the end of the piece. Absent is at rest. */
  pan?: number;
}

/** One bar with its pixels decided. */
export interface PlacedBar {
  readonly eb: EngravedBar;
  readonly x0: number;
  readonly x1: number;
  /** Each column's x, index-aligned with `eb.columns`. */
  readonly colX: readonly number[];
  readonly context: boolean;
  /** The part of [x0, x1) actually visible: a context bar is clipped. */
  readonly visible: readonly [number, number];
  /** Does this bar print a signature change before its first column? */
  readonly sig: { key: boolean; time: boolean };
}

export interface PageLayout {
  readonly placed: readonly PlacedBar[];
  /** Where the opening key and time signatures are drawn. */
  readonly sigX: number;
  readonly first: Bar;
  /** Width the signatures take before the first bar. */
  readonly preludeW: number;
  /** Does the line open with a time signature, or only the key? */
  readonly time: boolean;
  /** Where the staff lines stop: the margin when a torn bar runs off the
   *  edge, else the line's own closing barline. */
  readonly end: number;
  /** Does the line close the piece? It ends on a final barline. */
  readonly final: boolean;
  /** The window the line is seen through, [left, right): a bar that runs
   *  past either side is torn there. Null on a line with nothing either
   *  side of its bars, which is drawn whole. */
  readonly view: readonly [number, number] | null;
}

/** One line of bars to place — the unit both the single-line page and the
 *  whole-score page are made of. */
export interface LineSpec {
  /** The bars engraved in full, in order. */
  readonly bars: readonly EngravedBar[];
  /** The bars either side of them, in order, set at the same scale as
   *  context and seen through the line's window. Empty on a line that is
   *  all there is. */
  readonly before: readonly EngravedBar[];
  readonly after: readonly EngravedBar[];
  /** Open with the time signature as well as the key? The first line of a
   *  piece does; a later line restates only the key, as a printed page does. */
  readonly time: boolean;
  /** The most the columns may be stretched past their natural width. A line
   *  that must fill the width passes Infinity; a piece's short last line
   *  stops at ordinary spacing rather than being pulled across the page. */
  readonly maxScale: number;
  readonly final: boolean;
}

/** The natural (unscaled) width of a column, from the time it spans to
 *  the next: a quarter's worth of room is ~36px, an eighth's ~29, a
 *  whole's ~60 — wider for longer, but far less than proportionally, as
 *  a page is spaced. An accidental buys its head a little more. */
const colW = (span: number, accidentals: boolean): number =>
  12 + 24 * Math.sqrt(Math.max(span, 0.125)) + (accidentals ? 9 : 0);

const keyW = (fifths: number): number => (fifths === 0 ? 0 : Math.abs(fifths) * KEY_ACC_W + 6);

/** A bar's width at a scale of 1, before a line stretches it to fit. */
export const naturalW = (eb: EngravedBar): number => {
  let w = LEAD;
  eb.columns.forEach((c, i) => {
    const next = i + 1 < eb.columns.length ? eb.columns[i + 1].q : eb.quarters;
    w += colW(next - c.q, c.accidentals);
  });
  return w;
};

const clampBar = (bars: readonly Bar[], i: number): number => Math.max(0, Math.min(i, bars.length - 1));

const handNotes = new WeakMap<Score, Map<HandFilter, readonly Note[]>>();

/** Which notes go on the page: the practised hand always, the other hand
 *  only when asked for. The same arguments give the same array, so the
 *  layouts below can be memoized on it. */
export function visibleNotes(score: Score, hand: HandFilter, showOther: boolean): readonly Note[] {
  if (showOther) return score.notes;
  let byHand = handNotes.get(score);
  if (!byHand) handNotes.set(score, (byHand = new Map()));
  let notes = byHand.get(hand);
  if (!notes) byHand.set(hand, (notes = score.notes.filter((n) => inHand(n, hand))));
  return notes;
}

interface Sig { key: boolean; time: boolean; w: number }
const NO_SIG: Sig = { key: false, time: false, w: 0 };

const SIG_X = CLEF_W + 4;
const preludeOf = (first: Bar, time: boolean): number => keyW(first.fifths) + (time ? TIME_W : 0) + PAD / 2;

/** The width a line opening on `first` has for its bars, after the clef,
 *  the signatures and the right margin — what a line breaker fills. */
export const roomFor = (W: number, first: Bar, time: boolean): number =>
  Math.max(1, W - PAD - SIG_X - preludeOf(first, time));

/** A memo of one entry: the last answer, kept while its key holds. A
 *  cache, never a source of truth — the page redraws every frame and
 *  engraving the whole piece each time would be waste. */
function memo1<K extends readonly unknown[], V>(f: (...k: K) => V): (...k: K) => V {
  let last: { key: K; value: V } | null = null;
  return (...key: K) => {
    if (last && last.key.every((k, i) => k === key[i])) return last.value;
    last = { key, value: f(...key) };
    return last.value;
  };
}

const engraveAll = memo1((notes: readonly Note[], bars: readonly Bar[]) =>
  engrave(notes, bars, 0, bars.length - 1));

/** The single-line page's strip, at rest: the focus bars fitted to the
 *  width, and every other bar of the piece either side of them. */
const strip = memo1((W: number, score: Score, from: number, to: number, notes: readonly Note[]): PageLayout => {
  const ebs = engraveAll(notes, score.bars);
  return placeLine(W, {
    bars: ebs.slice(from, to + 1),
    before: ebs.slice(0, from),
    after: ebs.slice(to + 1),
    time: true,
    maxScale: Infinity,
    final: true,
  });
});

const focusOf = (bars: readonly Bar[], focus: BarRange): [number, number] => {
  const from = clampBar(bars, focus.from);
  return [from, Math.max(from, clampBar(bars, focus.to))];
};

/** Decide every x on the single-line page, seen through its window at
 *  `pan`. One function, so `markup` and `barAt` cannot disagree about
 *  where a bar is. */
export function layout(W: number, score: Score, focus: BarRange, notes: readonly Note[], pan = 0): PageLayout {
  const [from, to] = focusOf(score.bars, focus);
  return panTo(strip(W, score, from, to, notes), pan);
}

/** How far a line's window can pan: from the piece's first bar at the
 *  window's left edge to its last at the right — and always through 0,
 *  the rest, even when the strip is shorter than the window. */
const panRange = (page: PageLayout): [number, number] => {
  const [L, R] = page.view ?? [0, 0];
  const { placed } = page;
  return [Math.min(0, placed[0].x0 - L), Math.max(0, placed[placed.length - 1].x1 - R)];
};

/** The page's pan, for a scroller: how far it can go, and the pans at
 *  which every focus bar is wholly inside the window — outside those, the
 *  bars being worked on are out of sight and a follower brings them back
 *  to rest. */
export function panSpan(
  W: number, score: Score, focus: BarRange, hand: HandFilter, showOther: boolean,
): { range: [number, number]; focus: [number, number] } {
  const [from, to] = focusOf(score.bars, focus);
  const page = strip(W, score, from, to, visibleNotes(score, hand, showOther));
  const [L, R] = page.view ?? [0, W];
  const inFocus = page.placed.filter((p) => !p.context);
  return {
    range: panRange(page),
    focus: [inFocus[inFocus.length - 1].x1 - R, inFocus[0].x0 - L],
  };
}

/** A line seen through its window panned `pan` pixels from rest: the bars
 *  the window reaches, moved into place and torn at its edges. A line
 *  with no window is returned as it is. */
export function panTo(page: PageLayout, pan: number): PageLayout {
  if (!page.view) return page;
  const [L, R] = page.view;
  const [lo, hi] = panRange(page);
  const d = Math.max(lo, Math.min(hi, pan));
  const placed = page.placed
    .filter((p) => p.x1 - d > L && p.x0 - d < R)
    .map((p): PlacedBar => ({
      ...p,
      x0: p.x0 - d,
      x1: p.x1 - d,
      colX: p.colX.map((x) => x - d),
      visible: [Math.max(L, p.x0 - d), Math.min(R, p.x1 - d)],
    }));
  // the staves run to the margin while music runs off it; they stop at a
  // barline only where the strip itself ends inside the window
  const last = placed[placed.length - 1];
  const ends = last !== undefined && last.eb === page.placed[page.placed.length - 1].eb && last.x1 <= R + 0.5;
  return { ...page, placed, final: page.final && ends, end: ends ? last.x1 : R + PAD };
}

/** The key or time a bar changes to from the one before it, and the room
 *  saying so takes. */
const sigBetween = (prev: Bar, bar: Bar): Sig => {
  const key = bar.fifths !== prev.fifths;
  const time = bar.beats !== prev.beats || bar.unit !== prev.unit;
  return { key, time, w: (key ? keyW(bar.fifths) + 4 : 0) + (time ? TIME_W : 0) };
};

/** Decide every x on one line of bars, at rest: its own bars fitted to the
 *  width between the margins the context leaves, and the context chained
 *  on either side at the same scale. */
export function placeLine(W: number, spec: LineSpec): PageLayout {
  const first = spec.bars[0].bar;
  const sigX = SIG_X;
  const preludeW = preludeOf(first, spec.time);
  const usable = roomFor(W, first, spec.time);
  const ctxL = spec.before.length ? usable * CTX_FRAC : 0;
  const ctxR = spec.after.length ? usable * CTX_FRAC : 0;
  // the window starts where the signatures' ink does, not their air, so a
  // torn bar's accidentals are not cut off short of it
  const view: [number, number] | null = spec.before.length || spec.after.length
    ? [sigX + preludeW - PAD / 2, W - PAD]
    : null;

  // inline signature changes take unscaled room; the columns of the line's
  // own bars share what is left, scaled to fit. The first bar's key and
  // time are the line's opening signatures, so it prints none of its own.
  const focusEbs = spec.bars;
  const sigs: Sig[] = focusEbs.map((eb, i) => (i === 0 ? NO_SIG : sigBetween(focusEbs[i - 1].bar, eb.bar)));
  const natural = focusEbs.reduce((s, e) => s + naturalW(e), 0);
  const sigW = sigs.reduce((s, x) => s + x.w, 0);
  const scale = Math.min(spec.maxScale, Math.max(0.05, (usable - ctxL - ctxR - sigW) / natural));

  const place = (eb: EngravedBar, x0: number, sig: Sig, context: boolean): PlacedBar => {
    const colX: number[] = [];
    let x = x0 + sig.w + LEAD * scale;
    eb.columns.forEach((c, i) => {
      colX.push(x);
      const next = i + 1 < eb.columns.length ? eb.columns[i + 1].q : eb.quarters;
      x += colW(next - c.q, c.accidentals) * scale;
    });
    const x1 = x0 + sig.w + naturalW(eb) * scale;
    return {
      eb, x0, x1, colX, context, sig: { key: sig.key, time: sig.time },
      visible: view ? [Math.max(view[0], x0), Math.min(view[1], x1)] : [x0, x1],
    };
  };
  const widthOf = (eb: EngravedBar, sig: Sig): number => sig.w + naturalW(eb) * scale;

  const placed: PlacedBar[] = [];
  const focusX0 = sigX + preludeW + ctxL;
  let x = focusX0;
  focusEbs.forEach((eb, i) => {
    const p = place(eb, x, sigs[i], false);
    placed.push(p);
    x = p.x1;
  });
  const focusX1 = x;
  // the context either side, chained outward from the line's own bars
  let prev = focusEbs[focusEbs.length - 1].bar;
  for (const eb of spec.after) {
    const p = place(eb, x, sigBetween(prev, eb.bar), true);
    placed.push(p);
    x = p.x1;
    prev = eb.bar;
  }
  x = focusX0;
  for (let i = spec.before.length - 1; i >= 0; i--) {
    const eb = spec.before[i];
    const sig = i > 0 ? sigBetween(spec.before[i - 1].bar, eb.bar) : NO_SIG;
    x -= widthOf(eb, sig);
    placed.unshift(place(eb, x, sig, true));
  }
  return {
    placed, sigX, first, preludeW, time: spec.time, final: spec.final, view,
    end: spec.after.length ? W : focusX1,
  };
}

// --- colour ---------------------------------------------------------------

// The page's own hand tokens, not the keyboard's: on the dark field they are
// the same hues, and on paper the practised notes are plain black ink.
const handHue = (h: Hand | undefined): string =>
  h === "lower" ? "var(--page-l)" : h === "upper" ? "var(--page-r)" : "var(--note)";
const handDim = (h: Hand | undefined): string =>
  h === "lower" ? "var(--hand-l-dim)" : h === "upper" ? "var(--hand-r-dim)" : "var(--note-dim)";

interface Style {
  fill: string;
  opacity: number;
  glow: string;
  /** Precedence, so a chord's stem takes the loudest of its heads. */
  rank: number;
}

const CONTEXT: Style = { fill: "var(--ink-dim)", opacity: 0.45, glow: "", rank: 0 };
const REST: Style = { fill: "var(--glyph)", opacity: 0.9, glow: "", rank: 0 };
const loudest = (a: Style, b: Style): Style => (b.rank > a.rank ? b : a);

// --- glyphs ---------------------------------------------------------------

const attrs = (s: Style): string => `fill="${s.fill}" opacity="${s.opacity}"${s.glow}`;
const strokeAttrs = (s: Style, w: number): string =>
  `stroke="${s.fill}" stroke-width="${w}" opacity="${s.opacity}"${s.glow}`;

/** A notehead by value: hollow for a whole and a half, filled below that;
 *  the whole a little wider and stemless, as engraved. Tilted like a real
 *  head, which is also what keeps it from reading as a piano-roll dot. */
function headGlyph(x: number, y: number, v: Value, s: Style): string {
  const tilt = `transform="rotate(-20 ${x} ${y})"`;
  if (v.base === 1)
    return `<ellipse cx="${x}" cy="${y}" rx="${R + 2.5}" ry="${R - 0.5}" fill="none" ${strokeAttrs(s, 2.6)}/>`;
  if (v.base === 2)
    return `<ellipse cx="${x}" cy="${y}" rx="${R + 1}" ry="${R}" fill="none" ${strokeAttrs(s, 2.2)} ${tilt}/>`;
  return `<ellipse cx="${x}" cy="${y}" rx="${R + 1}" ry="${R}" ${attrs(s)} ${tilt}/>`;
}

/** The dot after a dotted head: in the space above when the head sits on
 *  a line, level with it when it sits in a space. */
const dotGlyph = (x: number, y: number, pos: number, s: Style): string =>
  `<circle cx="${x + R + 6}" cy="${pos % 2 === 0 ? y - HALF : y}" r="2.2" ${attrs(s)}/>`;

/** One flag at a stem's end, curling back toward the head. A stem UP ends
 *  at the top and its flag hangs down; a stem DOWN ends at the bottom and
 *  its flag rises — `k` flips the y's. */
function flagGlyph(x: number, y: number, dir: 1 | -1, s: Style): string {
  const k = dir === -1 ? 1 : -1;
  return `<path d="M${x},${y} C${x + 1},${y + 9 * k} ${x + 11},${y + 11 * k} ${x + 9},${y + 24 * k} ` +
    `C${x + 10},${y + 15 * k} ${x + 4},${y + 12 * k} ${x},${y + 9 * k} Z" ${attrs(s)}/>`;
}

/** A rest of a value, centred on the staff's middle line at `yc`. Drawn as
 *  paths rather than font glyphs, so the page does not depend on which
 *  music font the viewer's system happens to have. */
function restGlyph(x: number, yc: number, v: Value, s: Style): string {
  let out = "";
  switch (v.base) {
    case 1: // hangs from the fourth line
      out = `<rect x="${x - 6}" y="${yc - 2 * HALF}" width="13" height="${HALF * 0.85}" ${attrs(s)}/>`;
      break;
    case 2: // sits on the middle line
      out = `<rect x="${x - 6}" y="${yc - HALF * 0.85}" width="13" height="${HALF * 0.85}" ${attrs(s)}/>`;
      break;
    case 4:
      out = `<path d="M${x - 3},${yc - 13} L${x + 4},${yc - 5} L${x - 1},${yc + 1} L${x + 5},${yc + 8} ` +
        `C${x - 1},${yc + 5} ${x - 5},${yc + 8} ${x - 1},${yc + 14} C${x - 8},${yc + 9} ${x - 7},${yc + 3} ${x - 1},${yc + 4} ` +
        `L${x - 5},${yc - 1} L${x},${yc - 7} Z" ${attrs(s)}/>`;
      break;
    default: {
      // an eighth: a hooked stroke; each halving adds a hook lower down
      const hooks = v.base === 8 ? 1 : v.base === 16 ? 2 : 3;
      const top = yc - 6;
      out = `<line x1="${x + 4}" y1="${top}" x2="${x - 2}" y2="${yc + 4 + hooks * 5}" ${strokeAttrs(s, 1.6)} stroke-linecap="round"/>`;
      for (let i = 0; i < hooks; i++) {
        const hy = top + i * 7;
        const hx = x + 4 - i * 1.6;
        out += `<circle cx="${hx - 6}" cy="${hy + 1}" r="2.4" ${attrs(s)}/>`;
        out += `<path d="M${hx},${hy} C${hx - 2},${hy + 3} ${hx - 4},${hy + 3} ${hx - 6},${hy + 1}" fill="none" ${strokeAttrs(s, 1.4)}/>`;
      }
    }
  }
  if (v.dots) out += `<circle cx="${x + 11}" cy="${yc - HALF}" r="2.2" ${attrs(s)}/>`;
  return out;
}

/** Key signature positions on each staff, in the order accidentals are
 *  written: sharps F C G D A E B, flats B E A D G C F. */
const SHARP_POS: Record<Staff, number[]> = {
  treble: [10, 7, 11, 8, 5, 9, 6], bass: [-4, -7, -3, -6, -9, -5, -8],
};
const FLAT_POS: Record<Staff, number[]> = {
  treble: [6, 9, 5, 8, 4, 7, 3], bass: [-8, -5, -9, -6, -10, -7, -11],
};

function keySigGlyph(x: number, midY: number, fifths: number): string {
  if (fifths === 0) return "";
  const glyph = fifths > 0 ? ACC["#"] : ACC.b;
  const table = fifths > 0 ? SHARP_POS : FLAT_POS;
  let out = "";
  for (const staff of ["treble", "bass"] as const)
    for (let i = 0; i < Math.abs(fifths) && i < 7; i++)
      out += `<text x="${x + i * KEY_ACC_W}" y="${yOfPos(midY, table[staff][i]) + 4}" font-size="15" ` +
        `fill="var(--ink)" font-family="serif">${glyph}</text>`;
  return out;
}

function timeSigGlyph(x: number, midY: number, bar: Bar): string {
  let out = "";
  for (const staff of ["treble", "bass"] as const) {
    const m = MID[staff];
    out += text(x + TIME_W / 2, yOfPos(midY, m + 2) + 8, String(bar.beats), { size: 24, weight: 700, fill: "var(--ink)" });
    out += text(x + TIME_W / 2, yOfPos(midY, m - 2) + 8, String(bar.unit), { size: 24, weight: 700, fill: "var(--ink)" });
  }
  return out;
}

// --- the page ---------------------------------------------------------------

/** A head with its pixels decided, kept for the ties drawn after all
 *  bars are placed. */
interface Drawn {
  head: Head;
  x: number;
  y: number;
  dir: 1 | -1;
  style: Style;
}

/** A tie: from one head toward the next, bulging away from the stem. */
const tieArc = (x1: number, x2: number, y: number, dir: 1 | -1, s: Style): string => {
  const bulge = dir === -1 ? 9 : -9;
  return `<path d="M${x1},${y + bulge / 3} Q${(x1 + x2) / 2},${y + bulge} ${x2},${y + bulge / 3}" fill="none" ${strokeAttrs(s, 1.5)}/>`;
};

/** How many beams a value carries: an eighth one, a sixteenth two. */
const beamLevels = (c: Chord): number => (c.value.base === 8 ? 0 : c.value.base === 16 ? 1 : 2);

/** How a line is drawn: everything in BarsOpts but which bars and where
 *  the window is — a placed line already knows both. */
export type LineOpts = Omit<BarsOpts, "focus" | "pan">;

/** The single-line page: the focus bars, with the rest of the piece
 *  either side of them, seen through the window at `pan`. */
export function markup(W: number, H: number, score: Score, o: BarsOpts): string {
  if (!W || !H || score.bars.length === 0) return "";
  return drawLine(H, layout(W, score, o.focus, visibleNotes(score, o.hand, o.showOther), o.pan), o);
}

/** One placed line of bars as markup, its staves centred in 0..H. The one
 *  drawing both pages share: the single-line page is one of these, and the
 *  whole score is a column of them. */
export function drawLine(H: number, page: PageLayout, o: LineOpts): string {
  const midY = H / 2;
  const top = midY - STAFF_REACH;
  const bottom = midY + STAFF_REACH;
  const yOf = (pos: number) => yOfPos(midY, pos);
  const now = new Set(o.current ? soundingIn(o.current).map((n) => n.id) : []);
  const attack = new Set(o.current ? o.current.attack.map((n) => n.id) : []);

  const styleOf = (n: Note, context: boolean): Style => {
    if (now.has(n.id)) return { fill: "var(--note-lit)", opacity: 1, glow: glowAttr(o.glowId), rank: 3 };
    if (context) return CONTEXT;
    return inHand(n, o.hand)
      ? { fill: handHue(n.hand), opacity: 0.92, glow: "", rank: 2 }
      : { fill: handDim(n.hand), opacity: 0.92, glow: "", rank: 1 };
  };

  // the music is drawn in the window, the staves and signatures around it;
  // a bar running past the window's edge is torn there — clipped, not
  // culled, so a head half off the edge is drawn half
  let out = "";
  let staff = "";
  if (page.view) {
    const [va, vb] = page.view;
    staff += `<defs><clipPath id="${o.glowId}-page"><rect x="${va}" y="0" width="${Math.max(0, vb - va)}" height="${H}"/></clipPath></defs>`;
  }

  // the isolated bars, as a panel under everything
  if (o.range) {
    const r = o.range;
    const inRange = page.placed.filter((p) => !p.context && p.eb.bar.index >= r.from && p.eb.bar.index <= r.to);
    if (inRange.length) {
      const xa = inRange[0].x0;
      const xb = inRange[inRange.length - 1].x1;
      out += `<rect x="${xa}" y="${top - 6}" width="${Math.max(0, xb - xa)}" height="${bottom - top + 12}" rx="4" fill="var(--panel)"/>`;
    }
  }

  const panel = out;
  out = "";
  staff += staves(page.end, midY);

  // opening signatures, once, before the first bar
  staff += keySigGlyph(page.sigX, midY, page.first.fifths);
  if (page.time) staff += timeSigGlyph(page.sigX + keyW(page.first.fifths), midY, page.first);

  const drawn: Drawn[] = [];
  let cursorX: number | null = null;

  page.placed.forEach((p, pi) => {
    const { eb } = p;
    let g = "";

    // inline signature changes
    let sx = p.x0 + 4;
    if (p.sig.key) { g += keySigGlyph(sx, midY, eb.bar.fifths); sx += keyW(eb.bar.fifths) + 4; }
    if (p.sig.time) g += timeSigGlyph(sx, midY, eb.bar);

    const colXOf = (q: number): number => {
      const i = eb.columns.findIndex((c) => Math.abs(c.q - q) < 1e-6);
      return i >= 0 ? p.colX[i] : p.x0 + LEAD;
    };
    const chordStyle = (c: Chord): Style => c.heads.map((h) => styleOf(h.note, p.context)).reduce(loudest);
    const posOf = (h: Head): number => posFromMiddleC(h.note);
    const stemX = (x: number, dir: 1 | -1): number => (dir === -1 ? x + R + 0.5 : x - R - 0.5);

    // rests
    const restStyle = p.context ? CONTEXT : REST;
    for (const r of eb.rests) {
      const x = r.whole ? (p.x0 + p.x1) / 2 : colXOf(r.q);
      g += restGlyph(x, yOf(MID[r.staff]), r.value, restStyle);
    }

    // stem directions: by the chord's average position against the middle
    // line (-1 is up); two chords at one instant on one staff stem apart.
    const dirOf = new Map<Chord, 1 | -1>();
    for (const c of eb.chords) {
      const twin = eb.chords.find((d) => d !== c && d.staff === c.staff && d.q === c.q);
      if (twin) {
        dirOf.set(c, Math.max(...c.heads.map(posOf)) > Math.max(...twin.heads.map(posOf)) ? -1 : 1);
      } else {
        const avg = c.heads.reduce((s, h) => s + posOf(h), 0) / c.heads.length;
        dirOf.set(c, avg < MID[c.staff] ? -1 : 1);
      }
    }
    // a beamed group shares one direction and one flat beam line, so its
    // stems all reach it
    const beamed = new Map<Chord, { y: number; dir: 1 | -1 }>();
    for (const group of eb.beams) {
      const heads = group.flatMap((c) => c.heads);
      const avg = heads.reduce((s, h) => s + posOf(h), 0) / heads.length;
      const dir: 1 | -1 = avg < MID[group[0].staff] ? -1 : 1;
      const ys = heads.map((h) => yOf(posOf(h)));
      const y = dir === -1 ? Math.min(...ys) - STEM : Math.max(...ys) + STEM;
      for (const c of group) beamed.set(c, { y, dir });
    }

    for (const c of eb.chords) {
      const x = colXOf(c.q);
      const dir = beamed.get(c)?.dir ?? dirOf.get(c)!;
      const style = chordStyle(c);
      // heads, lowest first; a second (adjacent positions) shifts one head
      // to the stem's far side so the two do not overprint
      let prevPos = NaN;
      let prevShift = false;
      let topY = Infinity;
      let botY = -Infinity;
      for (const h of c.heads) {
        const pos = posOf(h);
        const shift: boolean = pos - prevPos === 1 && !prevShift;
        const hx = x + (shift ? (dir === -1 ? 2 * R + 1 : -(2 * R + 1)) : 0);
        const y = yOf(pos);
        const s = styleOf(h.note, p.context);
        g += ledgers(pos, hx, midY);
        g += headGlyph(hx, y, c.value, s);
        if (h.acc) g += `<text x="${x - R - 10}" y="${y + 4}" font-size="15" ${attrs(s)} font-family="serif">${ACC[h.acc]}</text>`;
        if (c.value.dots) g += dotGlyph(hx, y, pos, s);
        drawn.push({ head: h, x: hx, y, dir, style: s });
        // the head the step STRIKES — not a tied continuation of it, which
        // on the whole-score page may sit on the next line
        if (attack.has(h.note.id) && !h.tiedFrom && !p.context && cursorX === null) cursorX = x;
        topY = Math.min(topY, y);
        botY = Math.max(botY, y);
        prevPos = pos;
        prevShift = shift;
      }
      // stem, and flags when no beam carries the value
      if (c.value.base >= 2) {
        const sx = stemX(x, dir);
        const beam = beamed.get(c);
        const end = beam ? beam.y : dir === -1 ? topY - STEM : botY + STEM;
        const from = dir === -1 ? botY : topY;
        g += `<line x1="${sx}" y1="${from}" x2="${sx}" y2="${end}" ${strokeAttrs(style, 1.6)}/>`;
        if (!beam && c.value.base >= 8) {
          const flags = c.value.base === 8 ? 1 : c.value.base === 16 ? 2 : 3;
          for (let i = 0; i < flags; i++) g += flagGlyph(sx, end - i * 7 * dir, dir, style);
        }
      }
      // a triplet says so past its stem
      if (c.value.triplet && !beamed.has(c)) {
        const y = dir === -1 ? topY - STEM - 6 : botY + STEM + 14;
        g += text(x, y, "3", { size: 10, weight: 700, fill: style.fill });
      }
    }

    // beams: one flat primary over the group, secondaries between the
    // shorter neighbours, a stub for a short note beside a longer one
    for (const group of eb.beams) {
      const { y, dir } = beamed.get(group[0])!;
      const style = group.map(chordStyle).reduce(loudest);
      const xs = group.map((c) => stemX(colXOf(c.q), dir));
      const inward = dir === -1 ? 1 : -1; // secondary beams sit toward the heads
      const beamRect = (xa: number, xb: number, level: number): string =>
        `<rect x="${Math.min(xa, xb)}" y="${y + inward * level * BEAM_GAP - (dir === -1 ? 0 : BEAM_H)}" ` +
        `width="${Math.abs(xb - xa)}" height="${BEAM_H}" ${attrs(style)}/>`;
      g += beamRect(xs[0] - 0.8, xs[xs.length - 1] + 0.8, 0);
      for (let level = 1; level <= 2; level++) {
        for (let i = 0; i < group.length; i++) {
          if (beamLevels(group[i]) < level) continue;
          const left = i > 0 && beamLevels(group[i - 1]) >= level;
          const right = i + 1 < group.length && beamLevels(group[i + 1]) >= level;
          if (right) g += beamRect(xs[i], xs[i + 1], level);
          else if (!left) g += beamRect(xs[i], xs[i] + (i > 0 ? -9 : 9), level);
        }
      }
      if (group[0].value.triplet)
        g += text((xs[0] + xs[xs.length - 1]) / 2, dir === -1 ? y - 6 : y + 14, "3", { size: 10, weight: 700, fill: style.fill });
    }

    // barline at the bar's start; strong when it opens or closes the focus
    const strong = !p.context || (pi > 0 && !page.placed[pi - 1].context);
    out += `<line x1="${p.x0}" y1="${top}" x2="${p.x0}" y2="${bottom}" ` +
      `stroke="${strong ? "var(--grid-oct)" : "var(--grid)"}" stroke-width="${strong ? 1.5 : 1}"/>`;
    if (p.x0 >= p.visible[0])
      out += text(p.x0 + 4, top - 4, String(eb.bar.index + 1), {
        size: 10, weight: p.context ? 500 : 700, anchor: "start",
        fill: p.context ? "var(--ink-dim)" : "var(--ink)",
      });
    // the closing barline of the last bar on the page — thin-thick, the
    // final barline, when it is the end of the piece
    if (pi === page.placed.length - 1 && page.final)
      out += `<line x1="${p.x1 - 7}" y1="${top}" x2="${p.x1 - 7}" y2="${bottom}" stroke="var(--grid-oct)" stroke-width="1.5"/>` +
        `<rect x="${p.x1 - 4}" y="${top}" width="4" height="${bottom - top}" fill="var(--grid-oct)"/>`;
    else if (pi === page.placed.length - 1)
      out += `<line x1="${p.x1}" y1="${top}" x2="${p.x1}" y2="${bottom}" ` +
        `stroke="${p.context ? "var(--grid)" : "var(--grid-oct)"}" stroke-width="${p.context ? 1 : 1.5}"/>`;

    out += g;
  });

  // ties, after every head has its place: to the next head of the same
  // note when it is on the page, else a stub off the edge it went over
  drawn.forEach((d, i) => {
    if (d.head.tiedTo) {
      const next = drawn.slice(i + 1).find((e) => e.head.note.id === d.head.note.id);
      out += tieArc(d.x + R, next ? next.x - R : d.x + R + 18, d.y, d.dir, d.style);
    }
    if (d.head.tiedFrom && !drawn.slice(0, i).some((e) => e.head.note.id === d.head.note.id))
      out += tieArc(d.x - R - 18, d.x - R, d.y, d.dir, d.style);
  });

  // the current step's column: a rule through it, not a mark on the notes
  // — the gold heads already say which ones are meant
  if (cursorX !== null)
    out += `<line x1="${cursorX}" y1="${top}" x2="${cursorX}" y2="${bottom}" stroke="var(--playhead)" stroke-width="1.5" opacity="0.9"/>`;

  const inView = (m: string): string => (page.view && m ? `<g clip-path="url(#${o.glowId}-page)">${m}</g>` : m);
  return inView(panel) + staff + inView(out);
}

/** Which bar a point in the page's local space is over, or null off any
 *  bar in view — the clef, the signatures, the margins. Hit-tests the
 *  same layout `markup` drew, from the same notes (leaving a hand off the
 *  page changes the spacing), so a click lands on the bar under it.
 *  Context bars count, by their visible part: a click on the bar before
 *  the focus is how the learner widens it. */
export function barAt(
  W: number, score: Score, focus: BarRange, localX: number, hand: HandFilter = "both", showOther = true, pan = 0,
): number | null {
  if (!W || score.bars.length === 0) return null;
  for (const p of layout(W, score, focus, visibleNotes(score, hand, showOther), pan).placed) {
    const [a, b] = p.visible;
    if (localX >= a && localX < b) return p.eb.bar.index;
  }
  return null;
}

export const StaffBars = { markup, barAt, layout, panSpan, panTo, placeLine, drawLine, roomFor, naturalW, visibleNotes };
