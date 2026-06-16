/* ====================================================================
   STAFF_FULL — score -> t -> svg. The simplest output, built first.
   Vertical position is a straight linear function of pitch across the
   88-key range (A0=21 .. C8=108). No clefs, no ledger lines, no
   spelling. Notes scroll past a fixed playhead; active notes light up.
   ==================================================================== */
import type { View } from "../types";

const LOW = 21;
const HIGH = 108; // A0 .. C8
const PPS = 120; // pixels per second (scroll speed)
const PLAYHEAD_X = 0.18; // playhead at 18% from left

function isWhite(pitch: number): boolean {
  return ![1, 3, 6, 8, 10].includes(((pitch % 12) + 12) % 12);
}
function isC(pitch: number): boolean {
  return ((pitch % 12) + 12) % 12 === 0;
}

export const render: View = (svg, score, t) => {
  const W = svg.clientWidth;
  const H = svg.clientHeight;
  if (!W || !H) return;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const pad = 26;
  const yOf = (pitch: number) => pad + (H - 2 * pad) * (1 - (pitch - LOW) / (HIGH - LOW));
  const playX = W * PLAYHEAD_X;

  let out = "";

  // staff lines: one hairline per pitch row would be too dense; draw a
  // line per WHITE key, brighter on each C, with octave C labels.
  for (let pitch = LOW; pitch <= HIGH; pitch++) {
    if (!isWhite(pitch)) continue;
    const y = yOf(pitch);
    const c = isC(pitch);
    out += `<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="${c ? "var(--grid-oct)" : "var(--grid)"}" stroke-width="${c ? 1.1 : 0.6}"/>`;
    if (c) out += `<text x="6" y="${y - 3}" fill="var(--ink-dim)" font-size="10">C${((pitch / 12) | 0) - 1}</text>`;
  }

  // playhead
  out += `<line x1="${playX}" y1="0" x2="${playX}" y2="${H}" stroke="var(--playhead)" stroke-width="1.5" opacity="0.9"/>`;

  // notes: x derived from (onset - t). A note at onset==t sits on the
  // playhead. Width encodes duration. Lit when sounding.
  for (const n of score.notes) {
    const x = playX + (n.onset - t) * PPS;
    const w = Math.max(6, n.duration * PPS);
    if (x + w < 0 || x > W) continue; // cull offscreen
    const y = yOf(n.pitch);
    const lit = t >= n.onset && t < n.onset + n.duration;
    const fill = lit ? "var(--note-lit)" : "var(--note)";
    const op = lit ? 1 : 0.82;
    const glow = lit ? ` filter="url(#glow)"` : "";
    out += `<rect x="${x}" y="${y - 4}" width="${w}" height="8" rx="3" fill="${fill}" opacity="${op}"${glow}/>`;
  }

  svg.innerHTML =
    `<defs><filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="3" result="b"/>
        <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter></defs>` + out;
};

export const StaffFull = { render };
