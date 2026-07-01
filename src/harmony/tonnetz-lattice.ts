/* ====================================================================
   TONNETZ_LATTICE — pure lattice math for the Tonnetz instrument.
   No DOM, no audio, no side effects. Formulas from tonnetz-instrument.md.

   pitchClassAt and triadName are inlined rather than imported from
   outputs/tonnetz.ts to prevent a circular dependency: tonnetz.ts imports
   TonnetzState (Task 5 cursor overlay) which imports this file.
   ==================================================================== */

export type Orient = "up" | "down";
export interface Cursor { col: number; row: number; orient: Orient; }
export type Transform = "P" | "L" | "R";
export type LatticeStep =
  | "fifthUp" | "fifthDown"
  | "majThirdUp" | "majThirdDown"
  | "minThirdUp" | "minThirdDown";

const FIFTH = 7;
const MAJ3 = 4;
const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

const pc = (col: number, row: number): number =>
  (((FIFTH * col + MAJ3 * row) % 12) + 12) % 12;

// Cell roles for up (major) and down (minor) triangles:
//   up  (col,row): root=(col,row)   third=(col,row+1)  fifth=(col+1,row)
//   down(col,row): root=(col,row+1) third=(col+1,row)  fifth=(col+1,row+1)
export function triadCells(c: Cursor): {
  root:  [number, number];
  third: [number, number];
  fifth: [number, number];
} {
  if (c.orient === "up") {
    return {
      root:  [c.col,     c.row    ],
      third: [c.col,     c.row + 1],
      fifth: [c.col + 1, c.row    ],
    };
  }
  return {
    root:  [c.col,     c.row + 1],
    third: [c.col + 1, c.row    ],
    fifth: [c.col + 1, c.row + 1],
  };
}

export function triadPitchClasses(c: Cursor): {
  root: number; third: number; fifth: number;
} {
  const cells = triadCells(c);
  return {
    root:  pc(cells.root[0],  cells.root[1]),
    third: pc(cells.third[0], cells.third[1]),
    fifth: pc(cells.fifth[0], cells.fifth[1]),
  };
}

// Neo-Riemannian transforms — each is an involution (applying twice = identity):
//   from up  (col,row): P→down(col,row-1)  L→down(col,row)   R→down(col-1,row)
//   from down(col,row): P→up(col,row+1)    L→up(col,row)     R→up(col+1,row)
export function transform(c: Cursor, t: Transform): Cursor {
  if (c.orient === "up") {
    if (t === "P") return { col: c.col,     row: c.row - 1, orient: "down" };
    if (t === "L") return { col: c.col,     row: c.row,     orient: "down" };
    return               { col: c.col - 1, row: c.row,     orient: "down" }; // R
  }
  if (t === "P") return { col: c.col,     row: c.row + 1, orient: "up" };
  if (t === "L") return { col: c.col,     row: c.row,     orient: "up" };
  return               { col: c.col + 1, row: c.row,     orient: "up" };   // R
}

// Lattice translations — preserve orientation and quality.
export function translate(c: Cursor, step: LatticeStep): Cursor {
  switch (step) {
    case "fifthUp":      return { ...c, col: c.col + 1 };
    case "fifthDown":    return { ...c, col: c.col - 1 };
    case "majThirdUp":   return { ...c, row: c.row + 1 };
    case "majThirdDown": return { ...c, row: c.row - 1 };
    case "minThirdUp":   return { ...c, col: c.col + 1, row: c.row - 1 };
    case "minThirdDown": return { ...c, col: c.col - 1, row: c.row + 1 };
  }
}

// Voice a cursor to MIDI: tight root-position triad, sorted ascending.
// rootMidi = (octave+1)*12 + rootPc; interval gaps are always the short way up.
export function voiceTriad(c: Cursor, octave: number): number[] {
  const { root: rootPc, third: thirdPc, fifth: fifthPc } = triadPitchClasses(c);
  const rootMidi  = (octave + 1) * 12 + rootPc;
  const thirdMidi = rootMidi + ((thirdPc - rootPc + 12) % 12);
  const fifthMidi = rootMidi + ((fifthPc - rootPc + 12) % 12);
  return [rootMidi, thirdMidi, fifthMidi].sort((a, b) => a - b);
}

export function cursorLabel(c: Cursor): string {
  const { root } = triadPitchClasses(c);
  const quality = c.orient === "up" ? "maj" : "min";
  return NAMES[((root % 12) + 12) % 12] + (quality === "min" ? "m" : "");
}
