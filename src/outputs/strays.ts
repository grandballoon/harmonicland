/* ====================================================================
   STRAYS — a key the learner is holding that the current step never
   asked for, written on the page where the step is. The keyboard already
   lights it red; the page shows it as a red notehead in the cursor's
   column, so the distance between it and the gold heads the step wanted
   is the distance the hand was off, read in the notation the learner is
   reading from.

   Three decisions:

   1. SPELLING. A stray has no spelling of its own, so it is written the
      way the key signature of the cursor's bar would write it
      (engrave.ts `spellIn`), and prints an accidental by the same rule
      every head in that bar does (`printedAt`).

   2. STAFF. A stray goes on the staff of the step's note nearest it in
      pitch — its REFERENCE. A right hand that reaches a tone too low
      under a ledger-line A3 must show up one step under that A3, not
      jump to the bass staff. On the built-in page the grand staff is one
      continuous run of positions, so this only picks the ledger lines;
      on Verovio's sheets, whose staves stand apart, it is also how far
      down the page the head goes.

   3. PLACE. In the cursor's column, so the two are compared straight up
      and down. A stray within a step of one of the step's own heads on
      its staff would overprint it, so it stands one head to the right,
      the way an engraver offsets the second of a chord.

   A model and a glyph, no layout: each page places the head in its own
   geometry and draws its own ledger lines.
   ==================================================================== */
import { ACC, R, posFromMiddleC, posOf } from "./staff-std";
import { printedAt, spellIn, staffOf, type EngravedBar, type Printed, type Staff } from "./engrave";
import type { Note, Pitch } from "../types";

export interface Stray {
  readonly pitch: Pitch;
  /** Staff position from middle C, in half-spaces. */
  readonly pos: number;
  readonly acc: Printed;
  /** The step's note it is measured against (decision 2). */
  readonly ref: Note;
  readonly staff: Staff;
  /** Would its head overprint one of the step's (decision 3)? */
  readonly crowded: boolean;
}

/** How far right a crowded stray stands: one head's width and a little. */
export const STEP_ASIDE = 2 * R + 3;

/** The strays at column `q` of an engraved bar, for a step striking
 *  `attack` — none when the step strikes nothing to measure them by. */
export function straysAt(
  eb: EngravedBar, q: number, wrong: Iterable<Pitch>, attack: readonly Note[],
): Stray[] {
  if (attack.length === 0) return [];
  return [...wrong].sort((a, b) => a - b).map((pitch) => {
    const sp = spellIn(pitch, eb.bar.fifths);
    const pos = posOf(sp);
    const ref = attack.reduce((a, b) => (Math.abs(b.pitch - pitch) < Math.abs(a.pitch - pitch) ? b : a));
    const staff = staffOf(ref);
    const crowded = attack.some((n) => staffOf(n) === staff && Math.abs(posFromMiddleC(n) - pos) <= 1);
    return { pitch, pos, acc: printedAt(eb, q, sp), ref, staff, crowded };
  });
}

/** The ledger lines a head at `pos` needs on one staff standing alone —
 *  treble lines at 2..10, bass at -10..-2 — as positions. The built-in
 *  grand staff is one continuous run and asks staff-std.ts instead. */
export function ledgerPositions(pos: number, staff: Staff): number[] {
  const [lo, hi] = staff === "treble" ? [2, 10] : [-10, -2];
  const out: number[] = [];
  for (let p = hi + 2; p <= pos; p += 2) out.push(p);
  for (let p = lo - 2; p >= pos; p -= 2) out.push(p);
  return out;
}

/** Ledger lines at `ys`, centred on `x`. */
export const ledgerLines = (ys: readonly number[], x: number): string =>
  ys.map((y) => `<line x1="${x - 9}" y1="${y}" x2="${x + 9}" y2="${y}" stroke="var(--staff-line)" stroke-width="1"/>`).join("");

/** A stray's head and accidental at (x, y): a filled head, tilted like
 *  every head on the page, in the one colour that means "wrong". */
export const strayGlyph = (x: number, y: number, acc: Printed, glow: string): string =>
  `<ellipse cx="${x}" cy="${y}" rx="${R + 1}" ry="${R}" fill="var(--wrong)"${glow} ` +
  `transform="rotate(-20 ${x} ${y})"/>` +
  (acc ? `<text x="${x - R - 10}" y="${y + 4}" font-size="15" fill="var(--wrong)" font-family="serif">${ACC[acc]}</text>` : "");
