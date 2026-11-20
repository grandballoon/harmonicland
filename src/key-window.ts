/* ====================================================================
   KEY_WINDOW — which stretch of a keyboard is in sight, when the keyboard
   is wider than the screen. Pure: a pinch, a trackpad zoom and a sideways
   pan each turn one window into another, and nothing here knows about
   pointers, svgs or the clock.

   A window is measured in WHITE keys, from the left edge of the keyboard
   it looks at, and is continuous: a pinch moves smoothly through half a
   key, so a window may start, and end, partway across one. The keys keep
   their places on the instrument; the window only says which of them are
   under the glass.
   ==================================================================== */

export interface KeyWindow {
  /** White keys from the keyboard's left edge to the window's. */
  from: number;
  /** White keys across the window. */
  count: number;
}

/** The narrowest a window gets: an octave, so there is always a C in it to
 *  read the rest from. */
export const MIN_WHITES = 7;

/** The whole keyboard of `whites` white keys. */
export const whole = (whites: number): KeyWindow => ({ from: 0, count: whites });

/** Does the window show every key? */
export const isWhole = (w: KeyWindow, whites: number): boolean =>
  w.from <= 0 && w.count >= whites;

/** The window kept on the keyboard: no narrower than an octave (or the
 *  keyboard, if that is narrower still), no wider than the keyboard, and
 *  never hanging over either end. */
export function clamp(w: KeyWindow, whites: number): KeyWindow {
  const count = Math.max(Math.min(MIN_WHITES, whites), Math.min(whites, w.count));
  const from = Math.max(0, Math.min(whites - count, w.from));
  return { from, count };
}

/** Grow the window by `factor` (above 1 shows more keys, below 1 fewer),
 *  keeping the key at `at` — a fraction of the way across it — where it is. */
export function zoomAt(w: KeyWindow, factor: number, at: number, whites: number): KeyWindow {
  const count = w.count * factor;
  return clamp({ from: w.from + at * (w.count - count), count }, whites);
}

/** Slide the window by `by`, a fraction of its own width; positive moves
 *  it toward the top of the keyboard. */
export const panBy = (w: KeyWindow, by: number, whites: number): KeyWindow =>
  clamp({ from: w.from + by * w.count, count: w.count }, whites);

/** Two fingers that stood at `a0` and `b0` now stand at `a` and `b`, each
 *  a fraction of the way across the screen. The window that began as
 *  `start` follows them: it narrows as they part and widens as they close,
 *  and the key that was between them stays between them, so the keyboard
 *  moves with the hand that is holding it. */
export function pinch(
  start: KeyWindow, a0: number, b0: number, a: number, b: number, whites: number,
): KeyWindow {
  const gap0 = Math.abs(b0 - a0);
  const gap = Math.abs(b - a);
  if (gap0 <= 0 || gap <= 0) return start;
  const count = Math.max(Math.min(MIN_WHITES, whites), Math.min(whites, (start.count * gap0) / gap));
  const held = start.from + ((a0 + b0) / 2) * start.count; // the key between the fingers
  return clamp({ from: held - ((a + b) / 2) * count, count }, whites);
}
