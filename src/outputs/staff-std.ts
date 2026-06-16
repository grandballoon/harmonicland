/* ====================================================================
   STAFF_STD — the real grand staff. Same (svg, score, t) signature as
   StaffFull, so the toggle is one reference swap. The key difference:
   vertical position is a function of DIATONIC STEP (letter name), NOT
   pitch number. This is where `spelling` earns its keep — C# and Db are
   the same key but sit on different rows, and accidentals are drawn.

   Geometry (verified): one "position unit" = a half line-space, lines
   on even positions, spaces on odd, anchored at middle C = position 0.
     treble lines  E4 G4 B4 D5 F5  ->  +2 +4 +6 +8 +10
     bass   lines  G2 B2 D3 F3 A3  ->  -10 -8 -6 -4 -2
   The +1/-1 spaces flank the middle-C ledger line in the gap.
   ==================================================================== */
import { Core } from "../core";
import type { View, Note, Letter, Accidental, Spelling } from "../types";

const LETTER: Record<Letter, number> = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
const PPS = 120; // pixels/sec — match StaffFull's scroll
const PLAYHEAD_X = 0.18;
const HALF = 7; // pixels per position unit (half line-space)
const ACC: Record<Accidental, string> = { "#": "♯", b: "♭", "": "" };

interface Spelt {
  letter: Letter;
  acc: Accidental;
  octave: number;
}

// pitch -> {letter, acc, octave} honoring a note's frozen spelling if present
function spell(n: Note): Spelt {
  if (n.spelling && n.spelling.letter)
    return {
      letter: n.spelling.letter,
      acc: n.spelling.acc || "",
      octave: octaveFor(n.pitch, n.spelling),
    };
  const s = Core.defaultSpelling(n.pitch);
  return { letter: s.letter, acc: s.acc, octave: Math.floor(n.pitch / 12) - 1 };
}
// octave for a spelling: B# / Cb cross the octave boundary; handle simply
function octaveFor(pitch: number, sp: Spelling): number {
  let oct = Math.floor(pitch / 12) - 1;
  if (sp.letter === "B" && sp.acc === "#") oct -= 1; // B#3 == C4 pitch
  if (sp.letter === "C" && sp.acc === "b") oct += 1; // Cb4 == B3 pitch
  return oct;
}
// diatonic position relative to middle C (positive = higher on the page)
const C4_STEP = LETTER.C + 7 * 4;
function posFromMiddleC(n: Note): number {
  const s = spell(n);
  return LETTER[s.letter] + 7 * s.octave - C4_STEP;
}

export const render: View = (svg, score, t) => {
  const W = svg.clientWidth;
  const H = svg.clientHeight;
  if (!W || !H) return;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);

  const midY = H / 2; // middle C lives here
  const yOf = (pos: number) => midY - pos * HALF; // higher pos -> smaller y
  const playX = W * PLAYHEAD_X;

  let out = "";

  // --- the two staves: 5 lines each -------------------------------
  const trebleLines = [2, 4, 6, 8, 10]; // E4 G4 B4 D5 F5
  const bassLines = [-2, -4, -6, -8, -10]; // A3 F3 D3 B2 G2
  for (const pos of [...trebleLines, ...bassLines]) {
    const y = yOf(pos);
    out += `<line x1="48" y1="${y}" x2="${W}" y2="${y}" stroke="var(--grid)" stroke-width="1"/>`;
  }
  // middle-C ledger stub near the left, position 0, drawn faint full-width
  out += `<line x1="0" y1="${yOf(0)}" x2="${W}" y2="${yOf(0)}" stroke="var(--grid-oct)" stroke-width="0.6" stroke-dasharray="2 6" opacity="0.5"/>`;

  // --- clefs (glyphs) ---------------------------------------------
  // treble G-clef curls around G4 (pos +4); bass F-clef dots around F3 (pos -4)
  out += `<text x="10" y="${yOf(4) + 13}" font-size="46" fill="var(--ink-dim)" font-family="serif">\u{1D11E}</text>`;
  out += `<text x="12" y="${yOf(-4) + 8}" font-size="40" fill="var(--ink-dim)" font-family="serif">\u{1D122}</text>`;

  // --- playhead ----------------------------------------------------
  out += `<line x1="${playX}" y1="20" x2="${playX}" y2="${H - 20}" stroke="var(--playhead)" stroke-width="1.5" opacity="0.9"/>`;

  // --- notes -------------------------------------------------------
  // x from (onset - t); y from diatonic position. Ledger lines drawn
  // for notes outside both staves and across the middle gap.
  const R = 5.5; // notehead radius
  for (const n of score.notes) {
    const x = playX + (n.onset - t) * PPS;
    if (x + R < 48 || x - R > W) continue; // cull (leave room for clefs)
    const pos = posFromMiddleC(n);
    const y = yOf(pos);
    const lit = t >= n.onset && t < n.onset + n.duration;
    const fill = lit ? "var(--note-lit)" : "var(--note)";
    const glow = lit ? ` filter="url(#glow)"` : "";

    // ledger lines: any line-position (even) that's outside a staff and
    // between the note and the nearest staff. Covers the middle-C region
    // (-1..+1) and the far reaches beyond +10 / below -10.
    out += ledgerLines(pos, x, yOf);

    // notehead (ellipse, slightly wide like real engraving)
    out += `<ellipse cx="${x}" cy="${y}" rx="${R + 1}" ry="${R}" fill="${fill}" opacity="${lit ? 1 : 0.85}"${glow}/>`;
    // accidental to the left, from the spelling field
    const s = spell(n);
    if (s.acc) out += `<text x="${x - R - 9}" y="${y + 4}" font-size="15" fill="${fill}" font-family="serif">${ACC[s.acc]}</text>`;
  }

  svg.innerHTML =
    `<defs><filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="3" result="b"/>
        <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter></defs>` + out;
};

// draw short ledger lines through a notehead sitting outside the staves
function ledgerLines(pos: number, x: number, yOf: (p: number) => number): string {
  let s = "";
  const w = 9;
  const line = (p: number) => `<line x1="${x - w}" y1="${yOf(p)}" x2="${x + w}" y2="${yOf(p)}" stroke="var(--grid)" stroke-width="1"/>`;
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

export const StaffStd = { render };
