/* ====================================================================
   PIANO_ROLL — score -> t -> svg. The "Synthesia" view, and a clean
   third output: it is StaffFull rotated a quarter turn. Pitch runs along
   the X axis as a literal piano keyboard at the bottom; time runs DOWN
   the Y axis. Notes fall toward the keyboard and the key lights up at the
   instant the note's leading edge reaches the strike line. Same
   (svg, score, t) signature as the staves, so the toggle is one swap.
   Like StaffFull it reads `pitch` only and ignores `spelling` — the
   keyboard is the physical-key view, not the notation view. It also draws
   `score.bars` as numbered horizontal lines when the input stated any, so
   the bar you are stepping to is visible on the way down.

   The keyboard itself is NOT drawn here: `outputs/keyboard.ts` owns the
   geometry and the keys, so this view and the Hands view put the same C4
   in the same place. What is local to the roll is the one thing the roll
   adds — the strike line, which is simply the top of that keyboard.
   ==================================================================== */
import { Core } from "../core";
import { LiveKeys } from "../live-keys";
import { isC, isWhite, KEYB, keysMarkup, layout, pitchAt, type Region } from "./keyboard";
import { GLOW_DEFS, esc } from "./svg";
import type { View, Note, Score } from "../types";

const PPS = 120; // px/sec fall speed — match the staves

// the full-screen view measures the (outer) svg itself and sets innerHTML; the
// combo view instead asks for markup() at an exact W×H so it can place the roll
// inside a translated, clipped <g> in its own single svg — no nested <svg>,
// whose clipping and getBoundingClientRect both misbehave.
export const render: View = (svg, score, t) => {
  const W = svg.clientWidth;
  const H = svg.clientHeight;
  if (!W || !H) return;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.innerHTML = GLOW_DEFS + markup(W, H, score, t);
};

// the roll as a markup string for a W×H region (origin at 0,0); no <defs> —
// the caller supplies one shared glow filter.
export const markup = (W: number, H: number, score: Score, t: number): string => {
  if (!W || !H) return "";

  const L = layout(W, H);
  const strikeY = L.topY; // the top of the keyboard IS the strike line

  const active = new Set(Core.activeAt(score, t)); // note-object identity
  const activePitch = new Set([...active].map((n) => n.pitch));
  const held = LiveKeys.held(); // keys the user is holding
  // a key glows for a sounding score note OR a live key-press; a live press
  // wins the color so you can tell what YOU played from what's playing back.
  const paint = (p: number) => {
    const lit = held.has(p) || activePitch.has(p);
    if (!lit) return null; // resting colour, from the keyboard's own default
    return {
      fill: held.has(p) ? "var(--key-press)" : "var(--note-lit)",
      glow: true,
    };
  };

  let out = "";

  // --- background: faint vertical guide at each C, for orientation ---
  for (const p of L.whites)
    if (isC(p)) {
      const x = L.whiteIdx.get(p)! * L.ww;
      out += `<line x1="${x}" y1="0" x2="${x}" y2="${strikeY}" stroke="var(--grid)" stroke-width="0.6" opacity="0.5"/>`;
    }

  // --- bar lines: the same falling geometry as the notes, so a barline
  // crosses the strike line exactly when that bar begins. Numbered with the
  // score's own labels, which is what makes "back one bar" legible as motion
  // rather than an unexplained jump. Drawn under the notes. ---
  for (const b of score.bars) {
    const y = strikeY - (b.time - t) * PPS;
    if (y < 0 || y > strikeY) continue;
    out += `<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="var(--grid-oct)" stroke-width="1"/>`;
    out += `<text x="4" y="${y - 4}" fill="var(--ink-dim)" font-size="9">${esc(b.label)}</text>`;
  }

  // --- falling notes: y from (onset - t); leading edge hits strikeY at
  // onset, then the bar descends behind the keyboard. White lanes first,
  // black lanes on top so overlaps read correctly. ---
  const bar = (n: Note): string => {
    const { x, w } = L.lane(n.pitch);
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

  // --- the keyboard ---
  out += keysMarkup(L, paint);

  return out;
};

export { KEYB, pitchAt, type Region };
export const PianoRoll = { render, markup, pitchAt };
