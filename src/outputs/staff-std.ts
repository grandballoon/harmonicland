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

   Live keys (MIDI / pointer / gamepad) ride the playhead as green
   noteheads, so a key you press shows up on the row it would be
   notated on. A live key carries no spelling — only a pitch — so it
   gets `defaultSpelling` (sharps), exactly like imported MIDI.
   ==================================================================== */
import { Core } from "../core";
import { LiveKeys } from "../live-keys";
import type { View, Letter, Accidental, Spelling } from "../types";

const LETTER: Record<Letter, number> = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
const PPS = 120; // pixels/sec — match StaffFull's scroll
const PLAYHEAD_X = 0.18;
const HALF = 7; // pixels per position unit (half line-space)
const R = 5.5; // notehead radius
const NAME_SIZE = 12; // px, the live note-name readout
const ACC: Record<Accidental, string> = { "#": "♯", b: "♭", "": "" };

interface Spelt {
  letter: Letter;
  acc: Accidental;
  octave: number;
}

// pitch -> {letter, acc, octave}, honoring a frozen spelling when there is
// one. A bare pitch (a live key press) falls back to the default speller —
// the same sharps-only choice `MidiIn` freezes into imported MIDI.
export function spell(pitch: number, sp?: Spelling): Spelt {
  const s = sp && sp.letter ? sp : Core.defaultSpelling(pitch);
  return { letter: s.letter, acc: s.acc || "", octave: octaveFor(pitch, s) };
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
export function posFromMiddleC(s: Spelt): number {
  return LETTER[s.letter] + 7 * s.octave - C4_STEP;
}
// how the note reads out loud: "C♯4", "E♭3", "G2"
export const nameOf = (s: Spelt): string => `${s.letter}${ACC[s.acc]}${s.octave}`;

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
  // x from (onset - t); y from diatonic position.
  for (const n of score.notes) {
    const x = playX + (n.onset - t) * PPS;
    if (x + R < 48 || x - R > W) continue; // cull (leave room for clefs)
    const lit = t >= n.onset && t < n.onset + n.duration;
    out += notehead(spell(n.pitch, n.spelling), x, yOf, lit ? "var(--note-lit)" : "var(--note)", lit ? 1 : 0.85, lit);
  }

  // --- live keys ----------------------------------------------------
  // What you're holding right now, drawn on the playhead in the live
  // green so it reads apart from the playback notes, plus a readout of
  // the note names above it. Last, so it sits on top.
  const live = [...LiveKeys.held()].sort((a, b) => a - b).map((p) => spell(p));
  for (const s of live) out += notehead(s, playX, yOf, "var(--key-press)", 1, true);
  if (live.length) {
    // centered on the playhead, but a big chord's names are wider than the
    // 18% margin to its left, so nudge the label back inside the canvas.
    // The page font is monospace, so char count is a good width estimate.
    const names = live.map(nameOf).join(" ");
    const half = names.length * (NAME_SIZE * 0.3); // ~0.6em per char, halved
    const cx = Math.max(48 + half, Math.min(playX, W - 8 - half));
    out += `<text x="${cx}" y="14" font-size="${NAME_SIZE}" fill="var(--key-press)" text-anchor="middle">${names}</text>`;
  }

  svg.innerHTML =
    `<defs><filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="3" result="b"/>
        <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter></defs>` + out;
};

// one notehead at (x, its diatonic row): ledger lines, the ellipse itself
// (slightly wide, like real engraving), and the accidental its spelling asks
// for. Score notes and live key presses differ only in fill and x.
function notehead(
  s: Spelt,
  x: number,
  yOf: (p: number) => number,
  fill: string,
  opacity: number,
  glow: boolean,
): string {
  const pos = posFromMiddleC(s);
  const y = yOf(pos);
  const filter = glow ? ` filter="url(#glow)"` : "";
  // ledger lines: any line-position (even) that's outside a staff and between
  // the note and the nearest staff. Covers the middle-C region (-1..+1) and
  // the far reaches beyond +10 / below -10.
  let out = ledgerLines(pos, x, yOf);
  out += `<ellipse cx="${x}" cy="${y}" rx="${R + 1}" ry="${R}" fill="${fill}" opacity="${opacity}"${filter}/>`;
  if (s.acc)
    out += `<text x="${x - R - 9}" y="${y + 4}" font-size="15" fill="${fill}" font-family="serif">${ACC[s.acc]}</text>`;
  return out;
}

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
