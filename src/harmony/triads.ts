/* ====================================================================
   TRIADS — the harmonic vocabulary, in one place.

   A triad is three pitch classes; the neo-Riemannian transforms P, L and
   R are the three ways to move to another triad while keeping two of
   them. That alphabet was already here twice — drawn on the lattice by
   `outputs/tonnetz.ts`, walked by `harmony/tonnetz-lattice.ts` — and the
   piano narrator needs it a third time, because "keep the root and the
   fifth, move the middle finger" is a shorter and more memorable
   instruction than three key names.

   So it lives here: pure pitch-class arithmetic, no DOM, no lattice
   coordinates, no state. `outputs/tonnetz.ts` re-exports `triadName` and
   `neoTransform` for its existing callers; nothing is duplicated.

   Pitch classes throughout, never pitches: these are facts about
   harmony, and harmony does not know which octave you played it in.
   ==================================================================== */

/** A note's job inside a triad. The two roles a transform KEEPS are what
 *  name it, which is why this type is shared rather than private. */
export type Role = "root" | "third" | "fifth";
export type Quality = "maj" | "min";

export interface Triad {
  /** Pitch class 0–11. */
  readonly root: number;
  readonly quality: Quality;
}

/** Sharp spellings, because a pitch class has no spelling of its own and
 *  one arbitrary choice is better than an inconsistent one. */
export const PC_NAMES: readonly string[] =
  ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

const pc = (n: number): number => ((n % 12) + 12) % 12;

export const triadName = (root: number, quality: Quality): string =>
  PC_NAMES[pc(root)] + (quality === "min" ? "m" : "");

/** Which neo-Riemannian transform crosses the edge between two chord
 *  tones: keep the two named, move the third. P swaps the third (keeps
 *  root+fifth); for a major triad R keeps root+third and L keeps
 *  third+fifth — and the two swap for a minor triad. */
export function neoTransform(a: Role, b: Role, quality: Quality): "P" | "L" | "R" {
  const s = new Set<Role>([a, b]);
  if (s.has("root") && s.has("fifth")) return "P";
  if (s.has("root") && s.has("third")) return quality === "maj" ? "R" : "L";
  return quality === "maj" ? "L" : "R"; // third + fifth
}

/** The three pitch classes of a triad, in role order: root, third, fifth. */
export const triadClasses = (t: Triad): [number, number, number] => [
  t.root,
  pc(t.root + (t.quality === "maj" ? 4 : 3)),
  pc(t.root + 7),
];

const ROLES: readonly Role[] = ["root", "third", "fifth"];

/** Identify a sonority as a triad, or don't.
 *
 *  Octaves and doublings are irrelevant — the input is reduced to pitch
 *  classes first — but everything else is strict: exactly three distinct
 *  classes, in one of the two consonant shapes. A diminished or augmented
 *  triad, a seventh chord, or a two-note dyad is `null`, and the caller
 *  falls back to describing keys. Guessing a root for an ambiguous
 *  sonority would put a wrong chord name in a player's ear. */
export function triadOf(pitches: readonly number[]): Triad | null {
  const classes = [...new Set(pitches.map(pc))].sort((a, b) => a - b);
  if (classes.length !== 3) return null;
  for (const root of classes) {
    const rel = classes.map((c) => pc(c - root)).sort((a, b) => a - b);
    if (rel[1] === 4 && rel[2] === 7) return { root, quality: "maj" };
    if (rel[1] === 3 && rel[2] === 7) return { root, quality: "min" };
  }
  return null;
}

/** One triad reached from another by a single transform. */
export interface NeoMove {
  readonly transform: "P" | "L" | "R";
  /** The two roles (in the SOURCE triad) that stay put, in role order. */
  readonly kept: readonly [Role, Role];
  /** The pitch class that moves, and where it lands. */
  readonly from: number;
  readonly to: number;
}

/** How `a` becomes `b`, when a single P, L or R does it; `null` otherwise.
 *
 *  The test is exact rather than approximate: a transform flips quality
 *  and keeps two common tones, and that pair of facts identifies P, L and
 *  R uniquely — for any major triad there is exactly one minor triad
 *  sharing each pair of its tones. So no distance threshold is needed,
 *  and no relation is ever reported that is not literally one move. */
export function neoRelation(a: Triad, b: Triad): NeoMove | null {
  if (a.quality === b.quality) return null;
  const A = triadClasses(a);
  const B = triadClasses(b);
  const inB = new Set(B);
  const keptIdx = [0, 1, 2].filter((i) => inB.has(A[i]));
  if (keptIdx.length !== 2) return null;
  const from = A[[0, 1, 2].find((i) => !inB.has(A[i]))!];
  const to = B.find((c) => !A.includes(c))!;
  const kept: [Role, Role] = [ROLES[keptIdx[0]], ROLES[keptIdx[1]]];
  return { transform: neoTransform(kept[0], kept[1], a.quality), kept, from, to };
}

export const Triads = { triadName, neoTransform, triadOf, triadClasses, neoRelation, PC_NAMES };
