/* ====================================================================
   PIANO_ROLL — score -> t -> svg. The "Synthesia" view, and a clean
   third output: it is StaffFull rotated a quarter turn. Pitch runs along
   the X axis as a literal piano keyboard at the bottom; time runs DOWN
   the Y axis. Notes fall toward the keyboard and the key lights up at the
   instant the note's leading edge reaches the strike line. Same
   (svg, score, t) signature as the staves, so the toggle is one swap.
   Like StaffFull it reads `pitch` only and ignores `spelling` — the
   keyboard is the physical-key view, not the notation view.
   ==================================================================== */
import { Core } from "../core";
import { LiveKeys } from "../live-keys";
import type { View, Note } from "../types";

const LOW = 21;
const HIGH = 108; // A0 .. C8, the 88 keys (match StaffFull)
const PPS = 120; // px/sec fall speed — match the staves
const KEYB = 96; // keyboard band height (px)

const semi = (p: number) => ((p % 12) + 12) % 12;
const isWhite = (p: number) => ![1, 3, 6, 8, 10].includes(semi(p));
const isC = (p: number) => semi(p) === 0;

interface Layout {
  whites: number[];
  ww: number;
  whiteIdx: Map<number, number>;
  bw: number;
  strikeY: number;
  blackH: number;
  lane: (p: number) => { x: number; w: number };
}

export const render: View = (svg, score, t) => {
  const W = svg.clientWidth;
  const H = svg.clientHeight;
  if (!W || !H) return;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);

  // keyboard layout + its inverse hit-test both come from one place.
  const { whites, ww, whiteIdx, strikeY, blackH, lane } = layout(W, H);

  const active = new Set(Core.activeAt(score, t)); // note-object identity
  const activePitch = new Set([...active].map((n) => n.pitch));
  const held = LiveKeys.held(); // keys the user is holding
  // a key glows for a sounding score note OR a live key-press; a live press
  // wins the color so you can tell what YOU played from what's playing back.
  const keyFill = (p: number, base: string) =>
    held.has(p) ? "var(--key-press)" : activePitch.has(p) ? "var(--note-lit)" : base;
  const keyGlow = (p: number) => (held.has(p) || activePitch.has(p) ? ` filter="url(#glow)"` : "");

  let out = "";

  // --- background: faint vertical guide at each C, for orientation ---
  for (const p of whites)
    if (isC(p)) {
      const x = whiteIdx.get(p)! * ww;
      out += `<line x1="${x}" y1="0" x2="${x}" y2="${strikeY}" stroke="var(--grid)" stroke-width="0.6" opacity="0.5"/>`;
    }

  // --- falling notes: y from (onset - t); leading edge hits strikeY at
  // onset, then the bar descends behind the keyboard. White lanes first,
  // black lanes on top so overlaps read correctly. ---
  const bar = (n: Note): string => {
    const { x, w } = lane(n.pitch);
    const bottom = strikeY - (n.onset - t) * PPS; // leading edge
    const top = bottom - n.duration * PPS;
    if (bottom < 0 || top > strikeY) return ""; // future-offscreen / passed
    const yTop = Math.max(0, top);
    const yBot = Math.min(strikeY, bottom);
    const on = active.has(n);
    const fill = on ? "var(--note-lit)" : "var(--note)";
    const glow = on ? ` filter="url(#glow)"` : "";
    const pad = 1.2;
    return `<rect x="${x + pad}" y="${yTop}" width="${Math.max(2, w - 2 * pad)}" height="${Math.max(2, yBot - yTop)}" rx="2.5" fill="${fill}" opacity="${on ? 1 : 0.85}"${glow}/>`;
  };
  for (const n of score.notes) if (isWhite(n.pitch)) out += bar(n);
  for (const n of score.notes) if (!isWhite(n.pitch)) out += bar(n);

  // --- strike line ---
  out += `<line x1="0" y1="${strikeY}" x2="${W}" y2="${strikeY}" stroke="var(--playhead)" stroke-width="1.2" opacity="0.85"/>`;

  // --- the keyboard: white keys, then black keys on top. A key glows
  // while any note of that pitch is sounding. ---
  for (const p of whites) {
    const i = whiteIdx.get(p)!;
    out += `<rect x="${i * ww}" y="${strikeY}" width="${ww}" height="${KEYB}" fill="${keyFill(p, "var(--key-white)")}" stroke="#0b0e13" stroke-width="1"${keyGlow(p)}/>`;
    if (isC(p)) out += `<text x="${i * ww + ww / 2}" y="${H - 6}" fill="var(--ink-dim)" font-size="9" text-anchor="middle">C${((p / 12) | 0) - 1}</text>`;
  }
  for (let p = LOW; p <= HIGH; p++) {
    if (isWhite(p)) continue;
    const { x, w } = lane(p);
    out += `<rect x="${x}" y="${strikeY}" width="${w}" height="${blackH}" rx="2" fill="${keyFill(p, "var(--key-black)")}" stroke="#0b0e13" stroke-width="0.8"${keyGlow(p)}/>`;
  }

  svg.innerHTML =
    `<defs><filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="3" result="b"/>
        <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter></defs>` + out;
};

// keyboard geometry, shared by render (draw) and pitchAt (inverse hit-test)
// so the two can never drift.
function layout(W: number, H: number): Layout {
  const whites: number[] = [];
  for (let p = LOW; p <= HIGH; p++) if (isWhite(p)) whites.push(p);
  const ww = W / whites.length; // white-key width
  const whiteIdx = new Map(whites.map((p, i) => [p, i] as const));
  const bw = ww * 0.62; // black-key width
  const strikeY = H - KEYB; // top of keyboard = strike line
  const blackH = KEYB * 0.62;
  // x-lane for a pitch, aligned to its key (black sits on the lower white
  // key's right edge — pitch-1 is always white for our 5 blacks).
  const lane = (p: number): { x: number; w: number } => {
    if (isWhite(p)) {
      const i = whiteIdx.get(p)!;
      return { x: i * ww, w: ww };
    }
    const cx = (whiteIdx.get(p - 1)! + 1) * ww;
    return { x: cx - bw / 2, w: bw };
  };
  return { whites, ww, whiteIdx, bw, strikeY, blackH, lane };
}

// the inverse of lane(): which key sits under a client-space point? Black
// keys are drawn on top in the upper band, so test them first. Returns a
// MIDI pitch, or null when the point isn't on the keyboard. The svg's
// viewBox tracks its pixel size 1:1, so client offset == user units.
function pitchAt(svg: SVGSVGElement, clientX: number, clientY: number): number | null {
  const W = svg.clientWidth;
  const H = svg.clientHeight;
  if (!W || !H) return null;
  const r = svg.getBoundingClientRect();
  const x = clientX - r.left;
  const y = clientY - r.top;
  const L = layout(W, H);
  if (y < L.strikeY || y > H) return null; // above keyboard / off-canvas
  if (y <= L.strikeY + L.blackH) {
    // black-key band: blacks win
    for (let p = LOW; p <= HIGH; p++) {
      if (isWhite(p)) continue;
      const { x: bx, w } = L.lane(p);
      if (x >= bx && x <= bx + w) return p;
    }
  }
  const i = Math.max(0, Math.min(L.whites.length - 1, Math.floor(x / L.ww)));
  return L.whites[i];
}

export const PianoRoll = { render, pitchAt };
