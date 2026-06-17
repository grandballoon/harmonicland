/* ====================================================================
   TONNETZ — score -> t -> svg. A pitch-CLASS view, and the first one
   that collapses octaves: the 12 pitch classes laid on the triangular
   harmonic lattice, neighbours an interval apart — east = perfect fifth
   (+7), up = major third (+4), and the third edge = minor third (+3, the
   difference). Every small triangle is therefore a triad: pointing UP =
   major, pointing DOWN = minor. So a sounding chord becomes a filled
   SHAPE and chord QUALITY is which way it points — that's the lesson.

   A node glows for any sounding or live-held note of that class; a class
   recurs across the lattice, so all of its nodes light at once (that
   periodicity is the structure, not noise). When a triad sounds we name
   it and label its three edges with the neo-Riemannian transform that
   crosses each: P/L/R each keep two common tones and move one voice, so
   an edge leads to the adjacent triangle one move away — a progression
   is a walk across shared edges.

   Pitch-class only: reads pitch%12, ignores octave AND spelling (the
   physical/harmonic view, not the notation view). Same (svg, score, t)
   signature as the staves, so the view toggle stays a single swap.
   ==================================================================== */
import { Core } from "../core";
import { LiveKeys } from "../live-keys";
import type { View } from "../types";

type Cell = readonly [number, number]; // lattice coords (col, row)
type Role = "root" | "third" | "fifth";

const FIFTH = 7;
const MAJ3 = 4;
const DX = 92; // node horizontal spacing (px)
const DY = DX * 0.866; // row height → ~equilateral triangles

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// pure harmony (exported for tests): the lattice and its transforms.
export const pitchClassAt = (col: number, row: number): number =>
  (((FIFTH * col + MAJ3 * row) % 12) + 12) % 12;

export const triadName = (root: number, quality: "maj" | "min"): string =>
  NAMES[((root % 12) + 12) % 12] + (quality === "min" ? "m" : "");

// which neo-Riemannian transform crosses the edge between two chord
// tones: keep the two named, move the third. P swaps the third (keeps
// root+fifth); for a major triad R keeps root+third and L keeps
// third+fifth — and the two swap for a minor triad.
export function neoTransform(a: Role, b: Role, quality: "maj" | "min"): "P" | "L" | "R" {
  const s = new Set<Role>([a, b]);
  if (s.has("root") && s.has("fifth")) return "P";
  if (s.has("root") && s.has("third")) return quality === "maj" ? "R" : "L";
  return quality === "maj" ? "L" : "R"; // third + fifth
}

const GLOW = `<defs><filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
    <feGaussianBlur stdDeviation="3" result="b"/>
    <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter></defs>`;

export const render: View = (svg, score, t) => {
  const W = svg.clientWidth;
  const H = svg.clientHeight;
  if (!W || !H) return;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const cx = W / 2;
  const cy = H / 2;
  const X = (c: Cell) => cx + c[0] * DX + c[1] * (DX / 2);
  const Y = (c: Cell) => cy - c[1] * DY;
  const pc = (c: Cell) => pitchClassAt(c[0], c[1]);

  // sounding pitch classes = score notes active now ∪ live-held keys.
  const sounding = new Set<number>();
  for (const n of Core.activeAt(score, t)) sounding.add(((n.pitch % 12) + 12) % 12);
  const held = new Set<number>();
  for (const p of LiveKeys.held()) held.add(((p % 12) + 12) % 12);
  const lit = (p: number) => held.has(p) || sounding.has(p);

  const onScreen = (c: Cell, m = DX) => X(c) >= -m && X(c) <= W + m && Y(c) >= -m && Y(c) <= H + m;

  // visible lattice range — the row shear (x += row·DX/2) widens the cols.
  const rowMax = Math.ceil(H / (2 * DY)) + 2;
  const colMax = Math.ceil(W / DX) + rowMax + 3;

  let fills = "";
  let edges = "";
  let nodes = "";
  let labels = "";

  const segment = (a: Cell, b: Cell) =>
    `<line x1="${X(a)}" y1="${Y(a)}" x2="${X(b)}" y2="${Y(b)}" stroke="var(--grid)" stroke-width="0.8"/>`;

  // a triad anchored on the lattice, passed its cells BY ROLE. If all
  // three classes sound, fill the triangle, name it, label its edges.
  const triad = (root: Cell, third: Cell, fifth: Cell, quality: "maj" | "min") => {
    if (!(lit(pc(root)) && lit(pc(third)) && lit(pc(fifth)))) return;
    const verts = [root, third, fifth];
    if (!verts.some((c) => onScreen(c))) return;
    const poly = verts.map((c) => `${X(c)},${Y(c)}`).join(" ");
    const tint = quality === "maj" ? "var(--note-lit)" : "var(--note)";
    fills += `<polygon points="${poly}" fill="${tint}" opacity="0.2"/>`;
    const gx = (X(root) + X(third) + X(fifth)) / 3;
    const gy = (Y(root) + Y(third) + Y(fifth)) / 3;
    labels += `<text x="${gx}" y="${gy + 4}" text-anchor="middle" font-size="13" font-weight="700" fill="var(--ink)">${triadName(pc(root), quality)}</text>`;
    const edgeLabel = (a: Cell, b: Cell, ra: Role, rb: Role) => {
      const mx = (X(a) + X(b)) / 2;
      const my = (Y(a) + Y(b)) / 2;
      labels += `<text x="${mx}" y="${my + 3}" text-anchor="middle" font-size="10" font-weight="600" fill="var(--ink-dim)">${neoTransform(ra, rb, quality)}</text>`;
    };
    edgeLabel(root, fifth, "root", "fifth");
    edgeLabel(root, third, "root", "third");
    edgeLabel(third, fifth, "third", "fifth");
  };

  for (let row = -rowMax; row <= rowMax; row++) {
    for (let col = -colMax; col <= colMax; col++) {
      const A: Cell = [col, row]; // anchor
      if (!onScreen(A, DX * 1.5)) continue;
      const B: Cell = [col + 1, row]; // +fifth (east)
      const C: Cell = [col, row + 1]; // +maj3  (up)
      const D: Cell = [col + 1, row + 1]; // +fifth +maj3 (up-right)

      // three edges from this node tile the whole lattice (drawn twice at
      // shared edges — invisible for opaque hairlines, and simpler).
      edges += segment(A, B) + segment(A, C) + segment(B, C);

      // up-triangle A,B,C = MAJOR (root A, fifth B, third C);
      // down-triangle B,C,D = MINOR (root C, third B, fifth D).
      triad(A, C, B, "maj");
      triad(C, B, D, "min");

      // the node + its pitch-class name, lit when sounding/held.
      const p = pc(A);
      const on = lit(p);
      const fill = held.has(p) ? "var(--key-press)" : sounding.has(p) ? "var(--note-lit)" : "var(--panel)";
      const glow = on ? ` filter="url(#glow)"` : "";
      nodes += `<circle cx="${X(A)}" cy="${Y(A)}" r="14" fill="${fill}" stroke="var(--grid-oct)" stroke-width="1"${glow}/>`;
      nodes += `<text x="${X(A)}" y="${Y(A) + 4}" text-anchor="middle" font-size="11" font-weight="${on ? 700 : 400}" fill="${on ? "#0b1020" : "var(--ink-dim)"}">${NAMES[p]}</text>`;
    }
  }

  svg.innerHTML = GLOW + fills + edges + nodes + labels;
};

export const Tonnetz = { render, pitchClassAt, triadName, neoTransform };
