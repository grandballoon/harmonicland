/* ====================================================================
   SCROLL — the shared time-to-pixels geometry for every scrolling view.
   A leaf: imports nothing.

   staff-piano.ts stacks a staff over a falling-note roll and promises "a
   note crosses the staff playhead exactly as its bar reaches the keyboard's
   strike line". That promise is a statement about TWO renderers agreeing on
   one number. While each file declared its own `PPS = 120`, the promise held
   by coincidence and editing either one broke the stacked view silently.
   With one owner it holds by construction.
   ==================================================================== */
export const SCROLL = {
  /** Pixels per second of score time — the scroll/fall speed. */
  PPS: 120,
  /** Playhead position as a fraction of the region's width. */
  PLAYHEAD_X: 0.18,
} as const;
