/* ====================================================================
   PIANO_ROLL — score -> t -> svg. The "Synthesia" view, and a clean
   output: the keyboard as the axis. Pitch runs along
   the X axis as a literal piano keyboard at the bottom; time runs DOWN
   the Y axis. Notes fall toward the keyboard and the key lights up at the
   instant the note's leading edge reaches the strike line. Same
   (svg, score, t) signature as the staves, so the toggle is one swap.
   It reads `pitch` only and ignores `spelling` — the
   keyboard is the physical-key view, not the notation view.
   ==================================================================== */
import { Core } from "../core";
import { LOW, HIGH, isWhite, isC, octaveOf } from "../pitch";
import { SCROLL } from "./scroll";
import { glowFilter, glowAttr } from "./defs";
import type { Note, Score, Pitch } from "../types";
import type { View, ViewModule, Region } from "../view";

const { PPS } = SCROLL; // fall speed — the staves scroll at the same rate
export const KEYB = 96; // keyboard band height (px)

/** The keyboard's measurements for a W×H region. Public because an overlay
 *  drawn ABOVE the keys — practice mode's arrows — must point at the same
 *  lanes the keys are drawn in, and the only alternative was a second copy
 *  of this math in another module. `pitchAt` already establishes that this
 *  module owns the geometry in both directions; this states it once more
 *  rather than duplicating it. */
export interface Layout {
  whites: number[];
  ww: number;
  whiteIdx: Map<number, number>;
  bw: number;
  keyH: number;
  strikeY: number;
  blackH: number;
  lane: (p: number) => { x: number; w: number };
}

/** What markup() needs beyond the region and the moment. `glowId` is
 *  required: the filter is a document-global the CALLER owns, and a stacked
 *  view may legitimately want a different one per band. `fall` and `hands`
 *  were positional booleans — folded in here so a call site says which is
 *  which. */
export interface MarkupOpts {
  /** id of a <filter> the caller has defined in this document's <defs>. */
  glowId: string;
  /** pitches sounding live right now. Passed in — this used to be read from
   *  a module-level global, which is what made the view untestable. */
  held: ReadonlySet<Pitch>;
  /** draw the falling-note field, or keys only. Default true. */
  fall?: boolean;
  /** hue bars and lit keys by hand instead of by sounding. Default false. */
  hands?: boolean;
  /** Per-key appearance chosen by the CALLER, consulted before `held` and
   *  before the score's own sounding hue. Absent (the default) leaves every
   *  key exactly as it was. It exists because practice mode colours keys
   *  from a STEP rather than from a time — six roles that no query of
   *  (score, t) can answer — and the alternative was a second copy of the
   *  keyboard geometry in another module. */
  keyStyles?: ReadonlyMap<Pitch, KeyStyle>;
}

/** How one key should look. Fill and glow travel together because they are
 *  one decision: a dim preview key wants neither, an urgent one wants both,
 *  and two parallel maps would let them disagree. */
export interface KeyStyle {
  fill: string;
  /** default false — an override is usually a quieter state, not a louder
   *  one, and the loud ones say so. */
  glow?: boolean;
}

const OWN_GLOW = "rollGlow"; // this view's own filter, when it owns the svg

// the full-screen view measures the (outer) svg itself and sets innerHTML; the
// combo view instead asks for markup() at an exact W×H so it can place the roll
// inside a translated, clipped <g> in its own single svg — no nested <svg>,
// whose clipping and getBoundingClientRect both misbehave.
export const render: View = (svg, { score, t, live }) => {
  const W = svg.clientWidth;
  const H = svg.clientHeight;
  if (!W || !H) return;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.innerHTML =
    `<defs>${glowFilter(OWN_GLOW)}</defs>` +
    markup(W, H, score, t, { glowId: OWN_GLOW, held: live.held });
};

// the roll as a markup string for a W×H region (origin at 0,0); no <defs> —
// the caller defines the glow filter and names it in `o.glowId`. With `fall`
// off, the falling-note field (C guides + bars) is skipped: keys still light
// from the same activeAt query, so a keyboard-height region becomes a "keys
// only" band. With `hands` on, bars and lit keys are hued by hand (upper =
// --hand-r, lower = --hand-l); sounding is then carried by glow + opacity.
export const markup = (W: number, H: number, score: Score, t: number, o: MarkupOpts): string => {
  if (!W || !H) return "";
  const { glowId, held, fall = true, hands = false, keyStyles } = o;

  // keyboard layout + its inverse hit-test both come from one place — keyH
  // included, so the keys drawn below are exactly the ones hit-tested.
  const { whites, ww, whiteIdx, keyH, strikeY, blackH, lane } = layout(W, H);

  // hand comes resolved off the note — see staff-std's markup for why.
  const handHue = (n: Note): string | null =>
    hands && n.hand !== undefined ? (n.hand === "upper" ? "var(--hand-r)" : "var(--hand-l)") : null;

  const sounding = Core.activeAt(score, t);
  const active = new Set(sounding.map((n) => n.id)); // "is this bar lit", by id
  const activeHue = new Map<number, string>(); // pitch -> lit-key color
  for (const n of sounding) activeHue.set(n.pitch, handHue(n) ?? "var(--note-lit)");
  // a key glows for a sounding score note OR a live key-press; a live press
  // wins the color so you can tell what YOU played from what's playing back.
  // A caller-supplied style outranks both: it is a deliberate override, and
  // one that loses to the default would not be one.
  const keyFill = (p: number, base: string) => {
    const s = keyStyles?.get(p);
    if (s) return s.fill;
    return held.has(p) ? "var(--key-press)" : activeHue.get(p) ?? base;
  };
  const keyGlow = (p: number) => {
    const s = keyStyles?.get(p);
    return glowAttr(glowId, s ? s.glow === true : held.has(p) || activeHue.has(p));
  };

  let out = "";

  if (fall) {
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
      const on = active.has(n.id);
      const fill = handHue(n) ?? (on ? "var(--note-lit)" : "var(--note)");
      const glow = glowAttr(glowId, on);
      const pad = 1.2;
      return `<rect x="${x + pad}" y="${yTop}" width="${Math.max(2, w - 2 * pad)}" height="${Math.max(2, yBot - yTop)}" rx="2.5" fill="${fill}" opacity="${on ? 1 : 0.85}"${glow}/>`;
    };
    for (const n of score.notes) if (isWhite(n.pitch)) out += bar(n);
    for (const n of score.notes) if (!isWhite(n.pitch)) out += bar(n);
  }

  // --- strike line ---
  out += `<line x1="0" y1="${strikeY}" x2="${W}" y2="${strikeY}" stroke="var(--playhead)" stroke-width="1.2" opacity="0.85"/>`;

  // --- the keyboard: white keys, then black keys on top. A key glows
  // while any note of that pitch is sounding. ---
  for (const p of whites) {
    const i = whiteIdx.get(p)!;
    out += `<rect x="${i * ww}" y="${strikeY}" width="${ww}" height="${keyH}" fill="${keyFill(p, "var(--key-white)")}" stroke="#0b0e13" stroke-width="1"${keyGlow(p)}/>`;
    if (isC(p)) out += `<text x="${i * ww + ww / 2}" y="${H - 6}" fill="var(--ink-dim)" font-size="9" text-anchor="middle">C${octaveOf(p)}</text>`;
  }
  for (let p = LOW; p <= HIGH; p++) {
    if (isWhite(p)) continue;
    const { x, w } = lane(p);
    out += `<rect x="${x}" y="${strikeY}" width="${w}" height="${blackH}" rx="2" fill="${keyFill(p, "var(--key-black)")}" stroke="#0b0e13" stroke-width="0.8"${keyGlow(p)}/>`;
  }

  return out;
};

// keyboard geometry, shared by render (draw) and pitchAt (inverse hit-test)
// so the two can never drift. It owns the keyboard HEIGHT as well as its
// widths, derived from the region it was actually handed: KEYB is the
// PREFERRED height that callers size their bands from, never a precondition
// on the band they hand back. A region shorter than KEYB therefore yields a
// squat but fully functional keyboard — strikeY stays inside the band, black
// keys stay reachable, nothing is drawn above the clip — instead of the
// negative strikeY that collapsed every y onto one white key.
function layout(W: number, H: number): Layout {
  const whites: number[] = [];
  for (let p = LOW; p <= HIGH; p++) if (isWhite(p)) whites.push(p);
  const ww = W / whites.length; // white-key width
  const whiteIdx = new Map(whites.map((p, i) => [p, i] as const));
  const bw = ww * 0.62; // black-key width
  const keyH = Math.min(KEYB, H); // never taller than the band we were given
  const strikeY = H - keyH; // top of keyboard = strike line; therefore >= 0
  const blackH = keyH * 0.62;
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
  return { whites, ww, whiteIdx, bw, keyH, strikeY, blackH, lane };
}

// the inverse of lane(): which key sits under a client-space point? Black
// keys are drawn on top in the upper band, so test them first. Returns a
// MIDI pitch, or null when the point isn't on the keyboard. The svg's
// viewBox tracks its pixel size 1:1, so client offset == user units; `region`
// then locates the roll within that svg (the combo view offsets it).
function pitchAt(svg: SVGSVGElement, clientX: number, clientY: number, region?: Region): number | null {
  const r = svg.getBoundingClientRect();
  const reg = region ?? { x: 0, y: 0, w: svg.clientWidth, h: svg.clientHeight };
  if (!reg.w || !reg.h) return null;
  const x = clientX - r.left - reg.x; // into the roll's local space
  const y = clientY - r.top - reg.y;
  const L = layout(reg.w, reg.h);
  if (y < L.strikeY || y > reg.h) return null; // above keyboard / off-canvas
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

// this view IS the keyboard — it fills the whole svg.
const keyboardRegion = (svg: SVGSVGElement): Region => ({
  x: 0, y: 0, w: svg.clientWidth, h: svg.clientHeight,
});

/** The keyboard's measurements for a region — see `Layout`. */
export const geometry = (W: number, H: number): Layout => layout(W, H);

export const PianoRoll: ViewModule & {
  markup: typeof markup;
  pitchAt: typeof pitchAt;
  geometry: typeof geometry;
  KEYB: number;
} = { render, keyboardRegion, markup, pitchAt, geometry, KEYB };
