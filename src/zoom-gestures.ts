/* ====================================================================
   ZOOM_GESTURES — the hand's ways of zooming a keyboard, turned into
   windows (key-window.ts). Owns the listeners and nothing else: what is
   zoomed, whether zooming means anything right now, and where the keys
   are, are all asked of the caller.

     two fingers   pinch to zoom; the key between them stays between them,
                   so they also pan. Only off the keys: two fingers on the
                   keys are a chord, and they play.
     trackpad      pinch (a ctrl-wheel in Chrome and Firefox, a gesture in
                   Safari) to zoom about the pointer; swipe sideways to pan.

   Every one of these would otherwise zoom or scroll the page, so a
   gesture this module takes is one it cancels.
   ==================================================================== */
import { panBy, pinch, zoomAt, type KeyWindow } from "./key-window";

export interface ZoomTarget {
  /** Does zooming mean anything right now — is the keyboard on screen? */
  active(): boolean;
  /** White keys across the whole keyboard. */
  whites: number;
  get(): KeyWindow;
  set(w: KeyWindow): void;
  /** The keyboard's left edge and width, in client pixels. */
  bounds(): { left: number; width: number };
  /** Is a client point on a key — where a finger plays, not zooms? */
  onKeys(x: number, y: number): boolean;
}

/** How far one pixel of ctrl-wheel zooms: a notch of a mouse wheel (100px)
 *  is about a third, a trackpad's pinch a smooth fraction of that. */
const WHEEL_ZOOM = 0.004;

/** Listen on `surface` — the stage the keyboard is drawn on — for as long
 *  as the page lives. */
export function mountZoomGestures(surface: HTMLElement, t: ZoomTarget): void {
  const across = (clientX: number): number => {
    const { left, width } = t.bounds();
    return width > 0 ? (clientX - left) / width : 0.5;
  };

  // --- two fingers on a touch screen ----------------------------------
  /** The pinch under way: the window it began from and where the two
   *  fingers began, each a fraction of the way across. */
  let held: { start: KeyWindow; a0: number; b0: number } | null = null;
  surface.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 2 || !t.active()) return;
    const [a, b] = [e.touches[0], e.touches[1]];
    if (t.onKeys(a.clientX, a.clientY) || t.onKeys(b.clientX, b.clientY)) return;
    held = { start: t.get(), a0: across(a.clientX), b0: across(b.clientX) };
    e.preventDefault();
  }, { passive: false });
  surface.addEventListener("touchmove", (e) => {
    if (!held || e.touches.length !== 2) return;
    const [a, b] = [e.touches[0], e.touches[1]];
    t.set(pinch(held.start, held.a0, held.b0, across(a.clientX), across(b.clientX), t.whites));
    if (e.cancelable) e.preventDefault();
  }, { passive: false });
  const lift = (e: TouchEvent): void => {
    if (e.touches.length < 2) held = null;
  };
  surface.addEventListener("touchend", lift);
  surface.addEventListener("touchcancel", lift);

  // --- a trackpad, or a mouse wheel ------------------------------------
  surface.addEventListener("wheel", (e) => {
    if (!t.active()) return;
    const px = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : 1;
    const { width } = t.bounds();
    if (e.ctrlKey) {
      t.set(zoomAt(t.get(), Math.exp(e.deltaY * px * WHEEL_ZOOM), across(e.clientX), t.whites));
      e.preventDefault();
    } else if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && width > 0) {
      t.set(panBy(t.get(), (e.deltaX * px) / width, t.whites));
      e.preventDefault();
    }
  }, { passive: false });

  // Safari's own trackpad pinch. On a touch screen it fires as well, for
  // the fingers handled above, so there it is only cancelled.
  let gestureFrom: KeyWindow | null = null;
  type Gesture = UIEvent & { scale: number; clientX: number };
  surface.addEventListener("gesturestart", (e) => {
    if (!t.active()) return;
    gestureFrom = held ? null : t.get();
    e.preventDefault();
  });
  surface.addEventListener("gesturechange", (e) => {
    if (!t.active()) return;
    const g = e as Gesture;
    if (gestureFrom && g.scale > 0) t.set(zoomAt(gestureFrom, 1 / g.scale, across(g.clientX), t.whites));
    e.preventDefault();
  });
  surface.addEventListener("gestureend", () => {
    gestureFrom = null;
  });
}
