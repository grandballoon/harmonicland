/* ====================================================================
   KEYBOARD — the pixel geometry of an 88-key keyboard, and the drawing
   of it. Extracted from piano-roll.ts the moment a second view wanted
   the same keys: a keyboard the player has learned the position of must
   be in exactly the same place in every view that shows one, and the
   only way to guarantee that is for there to be one layout function.

   Two things live here and nothing else:

     layout()   pitch -> lane, and the band the keys occupy
     pitchAt()  the inverse — which key is under this point

   They are a pair, and keeping them adjacent is the point: a hit-test
   derived independently of the drawing is a hit-test that drifts.

   The musical facts (which pitches are black, where the 88 keys start
   and stop) are NOT restated here — they come from
   instruments/piano-geometry.ts, which already owns them. This module
   only turns them into pixels.
   ==================================================================== */
import { HIGHEST, LOWEST, isBlack, octaveOf } from "../instruments/piano-geometry";
import { esc } from "./svg";
import type { Pitch } from "../types";

/** A0 .. C8, the 88 keys. Re-exported under the names the views use so a
 *  renderer needs one import, not two. */
export const LOW = LOWEST;
export const HIGH = HIGHEST;

/** The keyboard band's default height. The piano roll's, and the number
 *  every other view starts from before it decides it wants more. */
export const KEYB = 96;

export const isWhite = (p: Pitch): boolean => !isBlack(p);
export const isC = (p: Pitch): boolean => ((p % 12) + 12) % 12 === 0;

/** A key's horizontal extent. */
export interface Lane {
  x: number;
  w: number;
}

/** Everything a renderer needs to draw or hit-test one keyboard. */
export interface Layout {
  /** Every white key, ascending. */
  whites: Pitch[];
  /** White-key width. */
  ww: number;
  whiteIdx: Map<Pitch, number>;
  /** Black-key width. */
  bw: number;
  /** Top of the keyboard band, in the region's own space. */
  topY: number;
  /** Height of the band, and of a white key. */
  keybH: number;
  /** Height of a black key. */
  blackH: number;
  lane: (p: Pitch) => Lane;
}

/** Keyboard geometry for a W×H region, with the keys sitting at the
 *  BOTTOM of it — which is where a keyboard is, in every view that has
 *  one, and what makes `pitchAt` the exact inverse of this. Pass a taller
 *  `keybH` for a view whose keyboard is the subject rather than the floor. */
export function layout(W: number, H: number, keybH: number = KEYB): Layout {
  const whites: Pitch[] = [];
  for (let p = LOW; p <= HIGH; p++) if (isWhite(p)) whites.push(p);
  const ww = W / whites.length;
  const whiteIdx = new Map(whites.map((p, i) => [p, i] as const));
  const bw = ww * 0.62;
  const topY = H - keybH;
  const blackH = keybH * 0.62;
  // x-lane for a pitch, aligned to its key (a black key sits on the lower
  // white key's right edge — pitch-1 is always white for our five blacks).
  const lane = (p: Pitch): Lane => {
    if (isWhite(p)) {
      const i = whiteIdx.get(p)!;
      return { x: i * ww, w: ww };
    }
    const cx = (whiteIdx.get(p - 1)! + 1) * ww;
    return { x: cx - bw / 2, w: bw };
  };
  return { whites, ww, whiteIdx, bw, topY, keybH, blackH, lane };
}

/** The region a keyboard occupies within an svg, in its local px space.
 *  A full-screen roll fills the svg; a stacked view confines it. */
export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The inverse of `lane`: which key sits under a client-space point? Black
 *  keys are drawn on top in the upper band, so they are tested first.
 *  Returns a MIDI pitch, or null when the point isn't on the keyboard.
 *
 *  Every view's svg keeps its viewBox at its pixel size 1:1, so a client
 *  offset is already in user units; `region` then locates the keyboard
 *  within that svg, and `keybH` must be the one the view drew with. */
export function pitchAt(
  svg: SVGSVGElement,
  clientX: number,
  clientY: number,
  region?: Region,
  keybH: number = KEYB,
): Pitch | null {
  const r = svg.getBoundingClientRect();
  const reg = region ?? { x: 0, y: 0, w: svg.clientWidth, h: svg.clientHeight };
  if (!reg.w || !reg.h) return null;
  const x = clientX - r.left - reg.x; // into the keyboard's local space
  const y = clientY - r.top - reg.y;
  const L = layout(reg.w, reg.h, keybH);
  if (y < L.topY || y > reg.h) return null; // above the keys / off-canvas
  if (y <= L.topY + L.blackH) {
    for (let p = LOW; p <= HIGH; p++) {
      if (isWhite(p)) continue;
      const { x: bx, w } = L.lane(p);
      if (x >= bx && x <= bx + w) return p;
    }
  }
  const i = Math.max(0, Math.min(L.whites.length - 1, Math.floor(x / L.ww)));
  return L.whites[i];
}

/** How one key is painted. `fill` is the only required answer; the rest
 *  are the ways a view says something extra about that key. */
export interface KeyPaint {
  fill: string;
  /** Reduces the fill without changing the hue — "this one is already
   *  down" reads as the same key, quieter, not as a different key. */
  opacity?: number;
  glow?: boolean;
  /** An emphasis outline, for a key that deserves more than a fill. */
  stroke?: string;
  /** A short label on the key face — a finger number, typically. Drawn
   *  only when the band is tall enough to hold one legibly. */
  label?: string;
  labelFill?: string;
}

const WHITE_DEFAULT: KeyPaint = { fill: "var(--key-white)" };
const BLACK_DEFAULT: KeyPaint = { fill: "var(--key-black)" };

/** Below this the band is furniture and a label on it would be a smudge. */
const LABEL_MIN_H = 70;

const paintAttrs = (k: KeyPaint): string =>
  (k.opacity !== undefined ? ` opacity="${k.opacity}"` : "") +
  (k.glow ? ` filter="url(#glow)"` : "");

/** The keyboard itself: white keys, then black keys on top, then the C
 *  octave labels. `paint` is asked about every key and may return nothing,
 *  which means "the resting colour".
 *
 *  Octave labels ride along because they are orientation, not decoration —
 *  the reason a player can find C4 on a screen at all — and every view that
 *  draws this keyboard wants them in the same place. */
export function keysMarkup(L: Layout, paint?: (p: Pitch) => KeyPaint | null): string {
  const at = (p: Pitch, fallback: KeyPaint): KeyPaint => paint?.(p) ?? fallback;
  const labels = L.keybH >= LABEL_MIN_H;
  let out = "";

  for (const p of L.whites) {
    const { x, w } = L.lane(p);
    const k = at(p, WHITE_DEFAULT);
    out +=
      `<rect x="${x}" y="${L.topY}" width="${w}" height="${L.keybH}" fill="${k.fill}" ` +
      `stroke="${k.stroke ?? "#0b0e13"}" stroke-width="${k.stroke ? 2 : 1}"${paintAttrs(k)}/>`;
    if (labels && k.label)
      out +=
        `<text x="${x + w / 2}" y="${L.topY + L.keybH - 22}" text-anchor="middle" ` +
        `font-size="${Math.min(15, w * 1.1)}" font-weight="700" fill="${k.labelFill ?? "#0b1020"}">${esc(k.label)}</text>`;
    if (isC(p))
      out +=
        `<text x="${x + w / 2}" y="${L.topY + L.keybH - 6}" text-anchor="middle" ` +
        `font-size="9" fill="var(--ink-dim)">C${octaveOf(p)}</text>`;
  }

  for (let p = LOW; p <= HIGH; p++) {
    if (isWhite(p)) continue;
    const { x, w } = L.lane(p);
    const k = at(p, BLACK_DEFAULT);
    out +=
      `<rect x="${x}" y="${L.topY}" width="${w}" height="${L.blackH}" rx="2" fill="${k.fill}" ` +
      `stroke="${k.stroke ?? "#0b0e13"}" stroke-width="${k.stroke ? 2 : 0.8}"${paintAttrs(k)}/>`;
    if (labels && k.label)
      out +=
        `<text x="${x + w / 2}" y="${L.topY + L.blackH - 8}" text-anchor="middle" ` +
        `font-size="${Math.min(13, w * 1.1)}" font-weight="700" fill="${k.labelFill ?? "var(--ink)"}">${esc(k.label)}</text>`;
  }

  return out;
}

export const Keyboard = { LOW, HIGH, KEYB, isWhite, isC, layout, pitchAt, keysMarkup };
