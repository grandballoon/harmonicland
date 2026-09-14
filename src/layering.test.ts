import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/* The dependency shape IS the architecture, so assert it rather than
   narrating it in headers. The intended layering is

       outputs/  ->  harmony/  ->  leaves  ->  (nothing)

   one direction only. tonnetz-lattice.ts once carried a comment justifying
   two hand-maintained copies of the lattice math by a circular dependency
   that did not exist — the copies are gone, and this is what keeps the next
   person from having the same worry and inlining a third. */

const SRC = join(__dirname);
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");
const importsOf = (src: string): string[] =>
  [...src.matchAll(/(?:from|import)\s+"([^"]+)"/g)].map((m) => m[1]);

const filesIn = (dir: string): string[] =>
  readdirSync(join(SRC, dir))
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => `${dir}/${f}`);

/** The leaf layer. types.ts is its floor and imports nothing at all; the
 *  other leaves may name types from it, which is zero runtime and so does not
 *  make them a dependency in the sense the module headers guard against. */
const LEAVES = ["pitch.ts", "outputs/scroll.ts", "outputs/defs.ts", "steps.ts"];

describe("module layering", () => {
  it("types.ts is the floor — it imports nothing at all", () => {
    expect(importsOf(read("types.ts"))).toEqual([]);
  });

  it.each(LEAVES)("%s is a leaf — it imports nothing but types", (leaf) => {
    const outside = importsOf(read(leaf)).filter((i) => !/(^|\/)types$/.test(i));
    expect(outside).toEqual([]);
  });

  it.each(filesIn("harmony"))("%s does not reach up into outputs/", (file) => {
    expect(importsOf(read(file)).filter((i) => i.includes("outputs/"))).toEqual([]);
  });

  it.each(filesIn("harmony"))("%s does not reach into inputs/", (file) => {
    expect(importsOf(read(file)).filter((i) => i.includes("inputs/"))).toEqual([]);
  });

  it("inputs/ and outputs/ never import each other — they meet only at the model", () => {
    for (const file of filesIn("inputs"))
      expect(importsOf(read(file)).filter((i) => i.includes("outputs/"))).toEqual([]);
    for (const file of filesIn("outputs"))
      expect(importsOf(read(file)).filter((i) => i.includes("inputs/"))).toEqual([]);
  });
});

describe("facts with one owner", () => {
  // Each of these used to exist in three or four files, kept in sync by hand.
  const sources = [
    "core.ts", "pitch.ts", "steps.ts", ...filesIn("harmony"), ...filesIn("outputs"),
  ].map((f) => [f, read(f)] as const);

  const declaredIn = (re: RegExp) => sources.filter(([, s]) => re.test(s)).map(([f]) => f);

  it("declares the pitch-name table exactly once, in pitch.ts", () => {
    expect(declaredIn(/\["C",\s*"C#"/)).toEqual(["pitch.ts"]);
  });

  it("declares the scroll speed exactly once, in outputs/scroll.ts", () => {
    // staff-piano's stacked view promises a note crosses the staff playhead
    // exactly as its bar reaches the strike line — true only with one PPS.
    expect(declaredIn(/PPS[^:]*[:=]\s*120/)).toEqual(["outputs/scroll.ts"]);
    expect(declaredIn(/PLAYHEAD_X[^:]*[:=]\s*0\.18/)).toEqual(["outputs/scroll.ts"]);
  });

  it("declares the black-key set exactly once, in pitch.ts", () => {
    expect(declaredIn(/\[1,\s*3,\s*6,\s*8,\s*10\]/)).toEqual(["pitch.ts"]);
  });

  it("declares the 88-key range exactly once, in pitch.ts", () => {
    expect(declaredIn(/LOW[^=]*=\s*21/)).toEqual(["pitch.ts"]);
  });

  it("declares the lattice formula exactly once, in harmony/tonnetz-lattice.ts", () => {
    expect(declaredIn(/FIFTH \* col \+ MAJ3 \* row/)).toEqual(["harmony/tonnetz-lattice.ts"]);
  });

  it("declares the glow filter exactly once, in outputs/defs.ts", () => {
    // Five modules used to copy-paste this literal to satisfy an undeclared
    // precondition that a #glow existed in the document.
    expect(declaredIn(/feGaussianBlur/)).toEqual(["outputs/defs.ts"]);
  });

  it("hardcodes no filter id at a use site — every one is passed in", () => {
    expect(declaredIn(/url\(#glow\)/)).toEqual([]);
  });

  it("declares the <text> helper exactly once, in outputs/defs.ts", () => {
    // Nashville and Practice both need this markup to look the same; a
    // second copy is how the glow filter ended up in five files.
    expect(declaredIn(/text-anchor="\$\{opts\.anchor/)).toEqual(["outputs/defs.ts"]);
  });

  it("declares the onset-grouping tolerance exactly once, in steps.ts", () => {
    // What counts as "played together" is one decision. Two copies would
    // let the cursor and a renderer disagree about where a chord even is.
    expect(declaredIn(/GROUP_SEC\s*=\s*0\.03/)).toEqual(["steps.ts"]);
  });

  it("declares the quality->colour map exactly once, in harmony/perfecto.ts", () => {
    // The Nashville wheel and the practice harmony bar both colour a chord
    // by its quality. Two copies is two chances for one view to disagree
    // with the other about what a diminished chord looks like.
    expect(declaredIn(/maj: "var\(--note-lit\)"/)).toEqual(["harmony/perfecto.ts"]);
  });

  it("derives a chord's name in exactly one place, from its intervals", () => {
    // It used to be a table keyed by joystick direction alone — a second,
    // quality-BLIND copy of the harmony, which called the ii chord "maj7".
    expect(declaredIn(/export function chordSymbol/)).toEqual(["harmony/perfecto.ts"]);
  });

  it("declares the short-scale octave-wrap exactly once, in harmony/perfecto.ts", () => {
    // The quality rule, the voicing and the progression realizer all need
    // to know where a degree sits; a second copy of the wrap is a second
    // chance for someone to simplify it away.
    expect(declaredIn(/Math\.floor\(degIdx \/ n\) \* 12/)).toEqual(["harmony/perfecto.ts"]);
  });

  it("picks a joystick cell's interval list in exactly one place", () => {
    // Naming a chord and sounding one must never disagree about which of a
    // cell's three lists this degree uses.
    expect(declaredIn(/outcome\.dim : /)).toEqual(["harmony/perfecto.ts"]);
  });

  it("keeps the octave-number formula in pitch.ts alone", () => {
    // scientific pitch is off by one from p/12, and piano-roll had its own
    // copy of the arithmetic in a label.
    expect(declaredIn(/Math\.floor\(p \/ 12\) - 1/)).toEqual(["pitch.ts"]);
  });
});

/* A Progression is a SOURCE of a score — it takes its place beside the
   parsers, and like them it must not know what will be done with the notes
   afterwards. It is also the reason harmony/ now has two files that talk to
   each other, so the direction of that edge is worth pinning: the catalogue
   depends on the mechanism, never the other way round. */
describe("progressions are a source, not an engine", () => {
  it("harmony/progression.ts does not import the model builder", () => {
    // It hands back RawNotes and lets its caller build the Score, which is
    // what keeps core.ts (and everything core.ts drags in) out of harmony/.
    expect(importsOf(read("harmony/progression.ts")).filter((i) => /(^|\/)core$/.test(i)))
      .toEqual([]);
  });

  it("the catalogue depends on the mechanism, not the reverse", () => {
    expect(importsOf(read("harmony/repertoire.ts"))).toContain("./progression");
    expect(importsOf(read("harmony/progression.ts"))).not.toContain("./repertoire");
  });

  it("nothing but the loop chooses which progression to play", () => {
    // The repertoire is data for a picker. A view or a state module that
    // reached for it would be deciding the lesson as a side effect of
    // drawing or grading it.
    const owners = [
      ...readdirSync(SRC).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts")),
      ...filesIn("outputs"), ...filesIn("harmony"),
    ].filter((f) => /from "[^"]*repertoire"/.test(read(f)));
    expect(owners).toEqual(["main.ts"]);
  });
});

/* The practice cursor drives time. It must take the clock as a VALUE, the
   way every view now takes its live state as one — a module that reached
   for makeClock could not be tested, and two of them would be two timers. */
describe("only main.ts builds a clock", () => {
  it("nothing under src/ imports makeClock except the loop", () => {
    const owners = readdirSync(SRC)
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
      .filter((f) => /\bmakeClock\b/.test(read(f)));
    expect(owners.sort()).toEqual(["clock.ts", "main.ts"]);
  });
});

/* The page in practice mode is the same grand staff StaffStd scrolls, laid
   out by bar instead of by playhead. Two copies of where a notehead sits
   would be two chances for the page and the staff to disagree about a
   note, silently, and only a reader would ever see it. */
describe("one grand staff", () => {
  const sources = filesIn("outputs").map((f) => [f, read(f)] as const);
  const declaredIn = (re: RegExp) => sources.filter(([, s]) => re.test(s)).map(([f]) => f);

  it("declares the diatonic position math exactly once, in outputs/staff-std.ts", () => {
    expect(declaredIn(/function posFromMiddleC/)).toEqual(["outputs/staff-std.ts"]);
  });

  it("draws the clef glyphs exactly once, in outputs/staff-std.ts", () => {
    expect(declaredIn(/1D11E/)).toEqual(["outputs/staff-std.ts"]);
  });

  it("lays out the staff lines exactly once, in outputs/staff-std.ts", () => {
    expect(declaredIn(/\[2, 4, 6, 8, 10\]/)).toEqual(["outputs/staff-std.ts"]);
  });

  it("spells a note exactly once, in pitch.ts", () => {
    // the staff view, the page and the engraver all put a note on a line
    // by asking this; a second copy is a note on two different lines
    const all = ["pitch.ts", "core.ts", ...filesIn("outputs"), ...filesIn("inputs")].map((f) => [f, read(f)] as const);
    expect(all.filter(([, src]) => /octaveFor\b\s*[=(]/.test(src) && /B.*#.*oct -= 1/.test(src)).map(([f]) => f))
      .toEqual(["pitch.ts"]);
  });
});

/* The engraver derives notation — values, rests, beams, accidentals —
   from the model and nothing else. It draws nothing, so it must import
   nothing that draws: a renderer reaching into it is fine, it reaching
   into a renderer would make "a dotted quarter" a fact about pixels. */
describe("the engraver is a notation leaf", () => {
  it("outputs/engrave.ts imports only the pitch leaf and the model's types", () => {
    const outside = importsOf(read("outputs/engrave.ts")).filter((i) => !/(^|\/)(types|pitch)$/.test(i));
    expect(outside).toEqual([]);
  });
});
