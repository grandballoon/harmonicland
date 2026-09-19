/* ====================================================================
   STAFF_STD — the real grand staff. Same (svg, score, t) signature as
   every view, so the toggle is one reference swap. The key point:
   vertical position is a function of DIATONIC STEP (letter name), NOT
   pitch number. This is where `spelling` earns its keep — C# and Db are
   the same key but sit on different rows, and accidentals are drawn.

   Geometry (verified): one "position unit" = a half line-space, lines
   on even positions, spaces on odd, anchored at middle C = position 0.
     treble lines  E4 G4 B4 D5 F5  ->  +2 +4 +6 +8 +10
     bass   lines  G2 B2 D3 F3 A3  ->  -10 -8 -6 -4 -2
   The +1/-1 spaces flank the middle-C ledger line in the gap.

   That geometry has ONE owner: this file. The pieces below that draw a
   grand staff — `staves`, `posFromMiddleC`, `notehead` — are exported so
   staff-bars.ts, which lays the same staff out by bar instead of by
   playhead, draws the same staff rather than a second copy of it. A
   notehead that sat on a different line in the two views would be the
   kind of disagreement no test could see and every reader would.
   ==================================================================== */
import { SCROLL } from "./scroll";
import { glowFilter, glowAttr } from "./defs";
import { spell } from "../pitch";
import type { Score, Note, Letter, Accidental } from "../types";
import type { View, ViewModule } from "../view";

const OWN_GLOW = "staffGlow"; // this view's own filter, when it owns the svg
const LETTER: Record<Letter, number> = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
const { PPS, PLAYHEAD_X } = SCROLL;
/** Pixels per position unit (half line-space). */
export const HALF = 7;
/** Where the staff lines begin: the clefs live to the left of this. */
export const CLEF_W = 48;
/** Notehead radius. */
export const R = 5.5;
/** Accidental glyphs, including the natural the engraver prints when a
 *  key signature would otherwise alter the note. */
export const ACC: Record<Accidental | "n", string> = { "#": "♯", b: "♭", n: "♮", "": "" };

// diatonic position relative to middle C (positive = higher on the page)
const C4_STEP = LETTER.C + 7 * 4;
export function posFromMiddleC(n: Note): number {
  const s = spell(n);
  return LETTER[s.letter] + 7 * s.octave - C4_STEP;
}

/** The staff's y for a position, given where middle C is. */
export const yOfPos = (midY: number, pos: number): number => midY - pos * HALF;

/** The two staves, the middle-C guide, and both clefs, for a staff whose
 *  middle C sits at `midY` and whose lines run from CLEF_W to `W`. */
export function staves(W: number, midY: number): string {
  const yOf = (pos: number) => midY - pos * HALF;
  let out = "";
  const trebleLines = [2, 4, 6, 8, 10]; // E4 G4 B4 D5 F5
  const bassLines = [-2, -4, -6, -8, -10]; // A3 F3 D3 B2 G2
  for (const pos of [...trebleLines, ...bassLines]) {
    const y = yOf(pos);
    out += `<line x1="${CLEF_W}" y1="${y}" x2="${W}" y2="${y}" stroke="var(--staff-line)" stroke-width="1"/>`;
  }
  // middle-C ledger stub near the left, position 0, drawn faint full-width
  out += `<line x1="0" y1="${yOf(0)}" x2="${W}" y2="${yOf(0)}" stroke="var(--grid-oct)" stroke-width="0.6" stroke-dasharray="2 6" opacity="0.5"/>`;
  // treble G-clef curls around G4 (pos +4); bass F-clef dots around F3 (pos -4)
  out += `<text x="10" y="${yOf(4) + 13}" font-size="46" fill="var(--glyph)" font-family="serif">\u{1D11E}</text>`;
  out += `<text x="12" y="${yOf(-4) + 8}" font-size="40" fill="var(--glyph)" font-family="serif">\u{1D122}</text>`;
  return out;
}

/** One note on the staff at `x`: its ledger lines, the head, and the
 *  accidental its spelling calls for. `glow` is the ready-made attribute
 *  (see defs.glowAttr), so the caller decides what glows and this does
 *  not have to know why. */
export function notehead(
  n: Note, x: number, midY: number, fill: string, opacity: number, glow = "",
): string {
  const pos = posFromMiddleC(n);
  const y = yOfPos(midY, pos);
  let out = ledgers(pos, x, midY);
  // notehead (ellipse, slightly wide like real engraving)
  out += `<ellipse cx="${x}" cy="${y}" rx="${R + 1}" ry="${R}" fill="${fill}" opacity="${opacity}"${glow}/>`;
  // accidental to the left, from the spelling field
  const s = spell(n);
  if (s.acc) out += `<text x="${x - R - 9}" y="${y + 4}" font-size="15" fill="${fill}" opacity="${opacity}" font-family="serif">${ACC[s.acc]}</text>`;
  return out;
}

// the view measures the svg itself and sets innerHTML; markup() draws at an
// exact W×H, so a test can render it without a DOM.
export const render: View = (svg, { score, t }) => {
  const W = svg.clientWidth;
  const H = svg.clientHeight;
  if (!W || !H) return;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.innerHTML =
    `<defs>${glowFilter(OWN_GLOW)}</defs>` + markup(W, H, score, t, { glowId: OWN_GLOW });
};

/** What markup() needs beyond the region and the moment; see piano-roll's
 *  MarkupOpts for why `glowId` is required rather than assumed. */
export interface MarkupOpts {
  glowId: string;
}

// the staff as a markup string for a W×H region (origin at 0,0); no <defs> —
// the caller defines the glow filter and names it.
export const markup = (W: number, H: number, score: Score, t: number, o: MarkupOpts): string => {
  if (!W || !H) return "";
  const { glowId } = o;
  const midY = H / 2; // middle C lives here
  const playX = W * PLAYHEAD_X;

  let out = staves(W, midY);

  // --- playhead ----------------------------------------------------
  out += `<line x1="${playX}" y1="20" x2="${playX}" y2="${H - 20}" stroke="var(--playhead)" stroke-width="1.5" opacity="0.9"/>`;

  // --- notes -------------------------------------------------------
  // x from (onset - t); y from diatonic position. Ledger lines drawn
  // for notes outside both staves and across the middle gap.
  for (const n of score.notes) {
    const x = playX + (n.onset - t) * PPS;
    if (x + R < CLEF_W || x - R > W) continue; // cull (leave room for clefs)
    const lit = t >= n.onset && t < n.onset + n.duration;
    const fill = lit ? "var(--note-lit)" : "var(--note)";
    out += notehead(n, x, midY, fill, lit ? 1 : 0.85, glowAttr(glowId, lit));
  }

  return out;
};

/** Short ledger lines through a notehead sitting outside the staves: any
 *  line-position (even) that's outside a staff and between the note and
 *  the nearest staff. Covers the middle-C region (-1..+1) and the far
 *  reaches beyond +10 / below -10. */
export function ledgers(pos: number, x: number, midY: number): string {
  const yOf = (p: number) => yOfPos(midY, p);
  let s = "";
  const w = 9;
  const line = (p: number) => `<line x1="${x - w}" y1="${yOf(p)}" x2="${x + w}" y2="${yOf(p)}" stroke="var(--staff-line)" stroke-width="1"/>`;
  // middle gap: position 0 (middle C) needs its own ledger when used
  if (pos === 0 || pos === 1 || pos === -1) {
    if (pos === 0) s += line(0);
  }
  // above treble (>10): ledgers at 12,14,...
  for (let p = 12; p <= pos; p += 2) s += line(p);
  // below bass (<-10): ledgers at -12,-14,...
  for (let p = -12; p >= pos; p -= 2) s += line(p);
  return s;
}

// the notation view has no pointer-playable keyboard; the stacked
// staff+piano views are where a staff gains one.
export const StaffStd: ViewModule & {
  markup: typeof markup;
  staves: typeof staves;
  notehead: typeof notehead;
  ledgers: typeof ledgers;
  posFromMiddleC: typeof posFromMiddleC;
} = {
  render,
  keyboardRegion: () => null,
  tape: () => null,
  markup,
  staves,
  notehead,
  ledgers,
  posFromMiddleC,
};
