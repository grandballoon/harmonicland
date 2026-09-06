/* ====================================================================
   SVG — the few drawing primitives the generative views share. Not a
   rendering library: just the string helpers that were being copied
   between nashville.ts and its controller legend, plus the two visual
   CONVENTIONS those views must agree on to read as one instrument —
   the glow filter and the quality→color mapping (major = warm, minor =
   cool, dim = tension, the same convention the Tonnetz uses).

   Pure string building. No DOM, no state.
   ==================================================================== */
import type { ChordQuality } from "../harmony/perfecto";

export const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

export const text = (
  x: number, y: number, s: string,
  opts: { size?: number; weight?: number; fill?: string; anchor?: string; family?: string } = {},
): string =>
  `<text x="${x}" y="${y}" text-anchor="${opts.anchor ?? "middle"}" ` +
  `font-size="${opts.size ?? 12}" font-weight="${opts.weight ?? 400}" ` +
  (opts.family ? `font-family="${opts.family}" ` : "") +
  `fill="${opts.fill ?? "var(--ink)"}">${esc(s)}</text>`;

/** The reading face. The app is monospace everywhere because it is mostly
 *  readouts; a full SENTENCE is the exception, and gets the same sans stack
 *  the spoken-score panel wears so the two agree. */
export const SANS = "ui-sans-serif, system-ui, -apple-system, sans-serif";

// one shared <defs> per view; anything inside may reference url(#glow).
export const GLOW_DEFS = `<defs><filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
    <feGaussianBlur stdDeviation="3" result="b"/>
    <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter></defs>`;
export const GLOW_ATTR = ' filter="url(#glow)"';

// chord quality -> token. Same mapping the Tonnetz uses for triads, so a
// degree keeps its color wherever it appears.
export const QUALITY_COLOR: Record<ChordQuality, string> = {
  maj: "var(--note-lit)",
  min: "var(--note)",
  dim: "var(--playhead)",
};

// text drawn on top of a lit (--note-lit) fill.
export const ON_LIT = "#0b1020";
