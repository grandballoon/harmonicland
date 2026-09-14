/* ====================================================================
   DEFS — the SVG <defs> content the renderers need, with one owner.
   A leaf: imports nothing.

   Every markup() referenced a filter by a fixed document-global name but
   defined none, so its real type was never (W, H, Score, t) -> string; it was
   a function of the ambient DOM, and "a matching <filter> must already exist
   in this document" lived only in prose. Five modules copy-pasted the same
   filter literal to satisfy it, and a stacked view could not give its two
   bands different glow radii because both layers named the same id.

   The precondition is now a parameter: a caller passes the id it defined,
   and one that forgets does not compile.
   ==================================================================== */

/** A soft additive bloom, the one visual accent this app uses. `id` is the
 *  document-local name the caller will pass to markup as `glowId`. */
export const glowFilter = (id: string, radius = 3): string =>
  `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%">` +
  `<feGaussianBlur stdDeviation="${radius}" result="b"/>` +
  `<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>` +
  `</filter>`;

/** The attribute that applies a filter, or "" when there is nothing to glow —
 *  the shape every renderer's `glow` local already had. */
export const glowAttr = (id: string, on = true): string =>
  on ? ` filter="url(#${id})"` : "";

/** Escape text destined for markup. Every renderer builds SVG by string
 *  concatenation, so this is the one place that stays honest about it. */
export const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

/** A `<text>` element with this app's defaults. Lives here for the same
 *  reason the glow filter does: it is markup two renderers need to agree
 *  about, and agreement by copy-paste is what this file replaced. */
export const text = (
  x: number, y: number, s: string,
  opts: { size?: number; weight?: number; fill?: string; anchor?: string } = {},
): string =>
  `<text x="${x}" y="${y}" text-anchor="${opts.anchor ?? "middle"}" ` +
  `font-size="${opts.size ?? 12}" font-weight="${opts.weight ?? 400}" ` +
  `fill="${opts.fill ?? "var(--ink)"}">${esc(s)}</text>`;
