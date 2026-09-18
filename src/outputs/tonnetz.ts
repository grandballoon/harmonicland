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

   The cursor triangle (the player's current position) is drawn from the
   frame's live snapshot, as is the set of held pitches; this file reads no
   module-level state and is a pure function of its arguments. The lattice
   MATH comes from harmony/tonnetz-lattice.ts, in the one allowed direction:
   outputs/ -> harmony/ -> leaves.
   ==================================================================== */
import { Core } from "../core";
import { pitchClassAt, triadName } from "../harmony/tonnetz-lattice";
import { QUALITY_COLOR } from "../harmony/perfecto";
import { PITCH_NAMES } from "../pitch";
import { glowFilter, glowAttr } from "./defs";
import type { Score, Pitch } from "../types";
import type { View, ViewModule } from "../view";
import type { Cursor } from "../harmony/tonnetz-lattice";

type Cell = readonly [number, number]; // lattice coords (col, row)
type Role = "root" | "third" | "fifth";

const DX = 92; // node horizontal spacing (px)
const DY = DX * 0.866; // row height → ~equilateral triangles

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

/** See piano-roll's MarkupOpts: the glow filter is the caller's to define. */
export interface MarkupOpts {
  glowId: string;
  /** pitches sounding live right now — passed in, not read from a global. */
  held: ReadonlySet<Pitch>;
  /** the player's position on the lattice, drawn as a stroked overlay. */
  cursor: Cursor;
}

const OWN_GLOW = "tonnetzGlow"; // this view's own filter, when it owns the svg

// the full-screen view measures the (outer) svg itself and sets innerHTML;
// the combo view instead asks for markup() at an exact W×H so it can place
// the lattice inside a clipped <g> in its own single svg — no nested <svg>,
// whose clipping and getBoundingClientRect both misbehave.
export const render: View = (svg, { score, t, live }) => {
  const W = svg.clientWidth;
  const H = svg.clientHeight;
  if (!W || !H) return;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.innerHTML =
    `<defs>${glowFilter(OWN_GLOW)}</defs>` +
    markup(W, H, score, t, { glowId: OWN_GLOW, held: live.held, cursor: live.tonnetz.cursor });
};

// the lattice as a markup string for a W×H region (origin at 0,0); no <defs>
// — the caller defines the glow filter and names it in `o.glowId`.
export const markup = (W: number, H: number, score: Score, t: number, o: MarkupOpts): string => {
  if (!W || !H) return "";
  const { glowId, cursor } = o;
  const cx = W / 2;
  const cy = H / 2;
  const X = (c: Cell) => cx + c[0] * DX + c[1] * (DX / 2);
  const Y = (c: Cell) => cy - c[1] * DY;
  const pc = (c: Cell) => pitchClassAt(c[0], c[1]);

  // sounding pitch classes = score notes active now ∪ live-held keys.
  const sounding = new Set<number>();
  for (const n of Core.activeAt(score, t)) sounding.add(((n.pitch % 12) + 12) % 12);
  const heldClasses = new Set<number>();
  for (const p of o.held) heldClasses.add(((p % 12) + 12) % 12);
  const lit = (p: number) => heldClasses.has(p) || sounding.has(p);

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
    fills += `<polygon points="${poly}" fill="${QUALITY_COLOR[quality]}" opacity="0.2"/>`;
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
      const fill = heldClasses.has(p) ? "var(--key-press)" : sounding.has(p) ? "var(--note-lit)" : "var(--panel)";
      const glow = glowAttr(glowId, on);
      nodes += `<circle cx="${X(A)}" cy="${Y(A)}" r="14" fill="${fill}" stroke="var(--grid-oct)" stroke-width="1"${glow}/>`;
      nodes += `<text x="${X(A)}" y="${Y(A) + 4}" text-anchor="middle" font-size="11" font-weight="${on ? 700 : 400}" fill="${on ? "#0b1020" : "var(--ink-dim)"}">${PITCH_NAMES[p]}</text>`;
    }
  }

  // cursor overlay: the player's current position, as a stroked outline
  // distinct from sounding fills. Handed in with the frame — see the header.
  const cv = (c: number, r: number): Cell => [c, r] as Cell;
  const cursorVerts = cursor.orient === "up"
    ? [cv(cursor.col, cursor.row), cv(cursor.col, cursor.row + 1), cv(cursor.col + 1, cursor.row)]
    : [cv(cursor.col + 1, cursor.row), cv(cursor.col, cursor.row + 1), cv(cursor.col + 1, cursor.row + 1)];
  const cursorPts = cursorVerts.map(c => `${X(c)},${Y(c)}`).join(" ");
  const cursorOverlay = `<polygon points="${cursorPts}" fill="none" stroke="var(--note-lit)" stroke-width="2.5" opacity="0.9"/>`;

  return fills + edges + nodes + labels + cursorOverlay;
};

// a pitch-class lattice is not a keyboard — no pointer hit-testing here.
export const Tonnetz: ViewModule & {
  markup: typeof markup;
  neoTransform: typeof neoTransform;
} = { render, keyboardRegion: () => null, markup, neoTransform };
