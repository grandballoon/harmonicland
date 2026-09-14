import { describe, it, expect } from "vitest";
import {
  realize, transposeTo, entryAt, entryAfter, changeOf,
  homeNumeral, changeName, changeRootPc, changePitchClasses, changeQuality,
  type Change, type Progression,
} from "./progression";
import { REPERTOIRE, FAMILIES, progressionById } from "./repertoire";
import { PitchClass, PITCH_NAMES, type Key } from "./perfecto";

/* A Progression is the SOURCE of a score, so these tests ask the two
   questions a source has to answer: does it lower to notes anyone could
   play, and does the analysis it hands over still describe them. */

const C: Key = { root: PitchClass.C, scale: "major" };
const ch = (key: Key, degree: Change["degree"], beats = 4, over: Partial<Change> = {}): Change =>
  ({ key, degree, mode: "default", direction: "center", beats, ...over });

const prog = (changes: readonly Change[], home: Key = C): Progression =>
  ({ id: "t", name: "test", family: "test", about: "", home, changes });

const names = (p: Progression): string[] => p.changes.map((c) => changeName(c));
const numerals = (p: Progression): string[] => p.changes.map((c) => homeNumeral(p.home, c));

describe("naming a change", () => {
  it("numbers a diatonic chord by its degree, cased by its quality", () => {
    const p = prog([ch(C, 1), ch(C, 2), ch(C, 5), ch(C, 7)]);
    expect(numerals(p)).toEqual(["I", "ii", "V", "vii°"]);
  });

  it("numbers a chord from ANOTHER key against home, not against its own", () => {
    // B♭ major in C: degree I of its own key, ♭VII of the piece.
    const p = prog([ch({ root: PitchClass.As, scale: "major" }, 1)]);
    expect(numerals(p)).toEqual(["♭VII"]);
    expect(names(p)).toEqual(["A# maj"]);
  });

  it("counts a minor home against the MAJOR scale, as a chart would", () => {
    // The Nashville reference is the major scale in every key: the chord on
    // A♭ in C minor is ♭VI, not VI, exactly as it is in C major.
    const cm: Key = { root: PitchClass.C, scale: "naturalMinor" };
    const p = prog([ch(cm, 1), ch(cm, 6), ch(cm, 7)], cm);
    expect(numerals(p)).toEqual(["i", "♭VI", "♭VII"]);
  });

  it("lets a label say what no derivation could — function, not spelling", () => {
    // D major in C is II by root; that it is the dominant OF the dominant
    // is a fact about function, unrecoverable from the notes.
    const p = prog([ch({ root: PitchClass.D, scale: "major" }, 1, 4, { label: "V/V" })]);
    expect(numerals(p)).toEqual(["V/V"]);
  });

  it("names the chord from the notes that will sound, not from the cell", () => {
    // default/right is the DIATONIC seventh. The regression this pins: a
    // table keyed by direction alone called the ii chord "maj7".
    const seventh = { mode: "default", direction: "right" } as const;
    expect(changeName(ch(C, 1, 4, seventh))).toBe("C maj7");
    expect(changeName(ch(C, 2, 4, seventh))).toBe("D min7");
    expect(changeName(ch(C, 7, 4, seventh))).toBe("B ½dim7");
  });

  it("gives pitch classes that ignore inversion and octave", () => {
    const root = changePitchClasses(ch(C, 1));
    const first = changePitchClasses(ch(C, 1, 4, { inversion: "first" }));
    expect(root.map((p) => PITCH_NAMES[p])).toEqual(["C", "E", "G"]);
    expect([...first].sort()).toEqual([...root].sort());
  });
});

describe("transposition", () => {
  const iiVI = progressionById("ii-V-I")!;

  it("moves every change by the interval home moved by", () => {
    const eb = transposeTo(iiVI, PitchClass.Ds);
    expect(numerals(eb)).toEqual(numerals(iiVI)); // the STRUCTURE is unchanged
    expect(names(eb)).toEqual(["F min7", "A# dom7", "D# maj7"]);
  });

  it("is a no-op in its own key, and returns the same value", () => {
    expect(transposeTo(iiVI, PitchClass.C)).toBe(iiVI);
  });

  it("keeps a modulating progression's internal relationships", () => {
    // Coltrane changes are three keys a major third apart. Transposing must
    // move all three, not collapse them onto the new tonic.
    const gs = transposeTo(progressionById("coltrane")!, PitchClass.Gs);
    const roots = gs.changes.map((c) => changeRootPc(c));
    expect(new Set(roots).size).toBeGreaterThan(3);
    expect(roots[0]).toBe(PitchClass.Gs);
  });

  it("wraps rather than running off the top of the pitch classes", () => {
    const b = transposeTo(iiVI, PitchClass.B);
    for (const c of b.changes) expect(c.key.root).toBeGreaterThanOrEqual(0);
    for (const c of b.changes) expect(c.key.root).toBeLessThan(12);
  });
});

describe("realizing to notes", () => {
  const one = realize(progressionById("ii-V-I")!, { cycles: 1 });

  it("lays the changes end to end, each ending where the next begins", () => {
    const e = one.chart.entries;
    for (let i = 1; i < e.length; i++) expect(e[i].at).toBe(e[i - 1].until);
    expect(one.duration).toBe(e[e.length - 1].until);
  });

  it("gives every chord a clean attack — nothing is sustained across", () => {
    // What makes one change one Step: a note ending exactly at the next
    // onset is not sounding there (half-open, as Core.activeAt is).
    for (const e of one.chart.entries) {
      const during = one.notes.filter((n) => n.onset < e.until && n.onset + n.duration > e.at);
      expect(during.every((n) => n.onset === e.at)).toBe(true);
    }
  });

  it("splits the hands: the voicing above, the root below", () => {
    const lower = one.notes.filter((n) => n.hand === "lower");
    expect(lower).toHaveLength(one.chart.entries.length);
    // clear of each other in every realization, not merely usually: the
    // register window lets a voicing sink, and a bass one octave down
    // could land inside the chord it is supposed to be under.
    for (const p of REPERTOIRE) {
      const r = realize(p, { cycles: 1 });
      const hi = r.notes.filter((n) => n.hand === "upper").map((n) => n.pitch);
      const lo = r.notes.filter((n) => n.hand === "lower").map((n) => n.pitch);
      expect({ id: p.id, clear: Math.max(...lo) < Math.min(...hi) })
        .toEqual({ id: p.id, clear: true });
    }
  });

  it("puts the bass on the chord root", () => {
    for (const e of one.chart.entries) {
      const bass = one.notes.find((n) => n.hand === "lower" && n.onset === e.at)!;
      expect(bass.pitch % 12).toBe(changeRootPc(changeOf(one.chart, e)));
    }
  });

  it("repeats the cycle without repeating the changes", () => {
    const four = realize(progressionById("ii-V-I")!, { cycles: 4 });
    expect(four.chart.changes).toHaveLength(3);          // one cycle, listed once
    expect(four.chart.entries).toHaveLength(12);         // four passes through it
    expect(four.chart.entries.map((e) => e.index)).toEqual([0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2]);
  });

  it("omits the bass when asked, and changes nothing else", () => {
    const bare = realize(progressionById("ii-V-I")!, { cycles: 1, bass: false });
    expect(bare.notes.every((n) => n.hand === "upper")).toBe(true);
    expect(bare.duration).toBe(one.duration);
  });

  it("is deterministic — the same progression realizes identically", () => {
    const a = realize(progressionById("blues-12")!, { cycles: 2 });
    const b = realize(progressionById("blues-12")!, { cycles: 2 });
    expect(a.notes).toEqual(b.notes);
  });
});

describe("reading a chart", () => {
  const r = realize(progressionById("ii-V-I")!, { cycles: 2 });
  const beat = r.chart.entries[0].until;

  it("finds the change covering a time, half-open at the right", () => {
    expect(entryAt(r.chart, 0)!.index).toBe(0);
    expect(entryAt(r.chart, beat - 0.001)!.index).toBe(0);
    expect(entryAt(r.chart, beat)!.index).toBe(1); // the boundary belongs to the next
  });

  it("has nothing to say past the end", () => {
    expect(entryAt(r.chart, r.duration)).toBeNull();
    expect(entryAfter(r.chart, r.duration)).toBeNull();
  });

  it("looks one change ahead, and across the loop", () => {
    expect(entryAfter(r.chart, 0)!.index).toBe(1);
    // the last change of a cycle looks ahead to the first of the next
    const lastOfCycle = r.chart.entries[2];
    expect(entryAfter(r.chart, lastOfCycle.at)!.index).toBe(0);
  });

  it("has nothing after the very last change", () => {
    const last = r.chart.entries[r.chart.entries.length - 1];
    expect(entryAfter(r.chart, last.at)).toBeNull();
  });
});

/* The catalogue is data, and data is exactly what goes quietly wrong. */
describe("the repertoire", () => {
  it("has unique ids, so a picker can address them", () => {
    expect(new Set(REPERTOIRE.map((p) => p.id)).size).toBe(REPERTOIRE.length);
  });

  it("lists every family that any progression claims", () => {
    expect(new Set(FAMILIES)).toEqual(new Set(REPERTOIRE.map((p) => p.family)));
  });

  it("is written in C, so transposition has one thing to move", () => {
    for (const p of REPERTOIRE)
      expect({ id: p.id, root: p.home.root }).toEqual({ id: p.id, root: PitchClass.C });
  });

  it.each(REPERTOIRE.map((p) => [p.id, p] as const))(
    "%s realizes into a range two hands could reach", (id, p) => {
      const { notes } = realize(p, { cycles: 1 });
      expect(notes.length).toBeGreaterThan(0);
      const pitches = notes.map((n) => n.pitch);
      // A ratcheting register once sent a dominant cycle from C2 to A6 —
      // every chord correct and the sequence unplayable.
      expect({ id, low: Math.min(...pitches) >= 36 }).toEqual({ id, low: true });
      expect({ id, high: Math.max(...pitches) <= 96 }).toEqual({ id, high: true });
    });

  it.each(REPERTOIRE.map((p) => [p.id, p] as const))(
    "%s says something about every change", (id, p) => {
      for (const c of p.changes) {
        expect(homeNumeral(p.home, c)).not.toBe("");
        expect(changeName(c)).toMatch(/^[A-G]#? .+/);
        expect(["maj", "min", "dim"]).toContain(changeQuality(c));
      }
      expect({ id, about: p.about.length > 20 }).toEqual({ id, about: true });
    });

  it("names the chords a ii–V–I is actually made of", () => {
    // The one progression every reader can check by eye.
    expect(names(progressionById("ii-V-I")!)).toEqual(["D min7", "G dom7", "C maj7"]);
  });

  it("names the chords a 12-bar blues is actually made of", () => {
    expect(new Set(names(progressionById("blues-12")!)))
      .toEqual(new Set(["C dom7", "F dom7", "G dom7"]));
  });
});

/* The number ladder is the one family whose CONTRACT is its numerals
   rather than its notes: it exists to teach that 1 2m 3m 4 5 6m 7° is the
   same ladder in every key. So it is pinned here by what it is numbered,
   in C and then everywhere. */
describe("the number ladder", () => {
  const ladder = progressionById("ladder-major")!;

  it("walks 1 up to 7 and comes home", () => {
    expect(numerals(ladder)).toEqual(["I", "ii", "iii", "IV", "V", "vi", "vii°", "I"]);
  });

  it("is the seven white-key triads in C — the shape the lesson opens with", () => {
    expect(names(ladder)).toEqual([
      "C maj", "D min", "E min", "F maj", "G maj", "A min", "B dim", "C maj",
    ]);
  });

  it("keeps those numbers in all twelve keys, which is the whole point", () => {
    const inC = numerals(ladder);
    for (const root of PITCH_NAMES.keys())
      expect({ root, n: numerals(transposeTo(ladder, root)) }).toEqual({ root, n: inC });
  });

  it("answers every number with the tonic, in the drill that says so", () => {
    const home = progressionById("ladder-major-home")!;
    const n = numerals(home);
    expect(n.filter((_, i) => i % 2 === 0)).toEqual(Array(7).fill("I"));
    expect(n.filter((_, i) => i % 2 === 1)).toEqual(["ii", "iii", "IV", "V", "vi", "vii°"]);
  });
});
