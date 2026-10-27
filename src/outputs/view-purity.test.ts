import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Nashville } from "./nashville";
import { Tonnetz } from "./tonnetz";
import { PianoRoll } from "./piano-roll";
import { StaffStd } from "./staff-std";
import { Combo } from "./combo";
import { StaffPiano } from "./staff-piano";
import { Practice } from "./practice";
import { IsolatedKeys } from "./isolated-keys";
import { Core } from "../core";
import { PerfState, type PerfSnapshot } from "../perf-state";
import { TonnetzState } from "../tonnetz-state";
import { PracticeState } from "../practice-state";
import type { LiveSnapshot, ViewModule } from "../view";

/* Views were typed as a function of (svg, score, t) but five of eight read
   module-level mutable globals — LiveKeys, PerfState, TonnetzState — so the
   real signature had a hidden LiveState parameter. That is why no test in
   the suite rendered Nashville or Tonnetz: there was no way to say what
   state to render. The state is a value now, and these are the tests that
   became possible. */

const score = Core.makeScore([{ pitch: 60, onset: 0, duration: 1 }]);
const G = "testGlow";
const NONE: ReadonlySet<number> = new Set();

const perf = (over: Partial<PerfSnapshot> = {}): PerfSnapshot => ({
  key: { root: 0, scale: "major" },
  degree: 1,
  joystickMode: "default",
  joystickDirection: "center",
  inversion: "root",
  octave: 4,
  voiceLeading: false,
  sounding: [],
  preview: [60, 64, 67],
  ...over,
});

describe("Nashville renders from a snapshot alone", () => {
  it("is deterministic — the same selection gives byte-identical markup", () => {
    expect(Nashville.markup(900, 600, perf())).toBe(Nashville.markup(900, 600, perf()));
  });

  it("draws the key and degree it was handed, not whatever a global holds", () => {
    const aMinor = Nashville.markup(900, 600, perf({
      key: { root: 9, scale: "naturalMinor" },
    }));
    expect(aMinor).toContain("A Natural Minor");
    expect(aMinor).toContain(">i<");     // numeral cased from the real quality
    expect(aMinor).toContain("A min");   // ...and the name agreeing with it
  });

  it("shows the preview while silent and the sounding notes once triggered", () => {
    expect(Nashville.markup(900, 600, perf())).toContain("C  E  G");
    expect(Nashville.markup(900, 600, perf({ sounding: [62, 65, 69] }))).toContain("D  F  A");
  });

  it("renders two different selections side by side, independently", () => {
    const a = Nashville.markup(900, 600, perf({ degree: 1 }));
    const b = Nashville.markup(900, 600, perf({ degree: 5 }));
    expect(a).not.toBe(b);
    // ...and rendering b did not disturb a
    expect(Nashville.markup(900, 600, perf({ degree: 1 }))).toBe(a);
  });
});

describe("Nashville's wheel is turned by a pointer", () => {
  // 900×600: hub at (450, 334), outer zones 156.24 out
  const dial = Nashville.dialAt(900, 600)!;
  const hub = [450, 334] as const;

  it("picks the zone nearest the pointer", () => {
    expect(dial.directionAt(...hub)).toBe("center");
    expect(dial.directionAt(hub[0] + 156, hub[1])).toBe("right");
    expect(dial.directionAt(hub[0], hub[1] - 156)).toBe("up");
    expect(dial.directionAt(hub[0] - 110, hub[1] + 110)).toBe("downLeft");
    expect(dial.directionAt(hub[0] - 110, hub[1] - 110)).toBe("upLeft");
  });

  it("gives the hub up halfway to the outer zones", () => {
    expect(dial.directionAt(hub[0] + 70, hub[1])).toBe("center");
    expect(dial.directionAt(hub[0] + 85, hub[1])).toBe("right");
  });

  it("keeps following a pointer that has left the wheel", () => {
    expect(dial.holds(5, 5)).toBe(false);
    expect(dial.directionAt(5, 5)).toBe("upLeft");
  });

  it("holds a pointer within the circle its zones fill, and none beside it", () => {
    expect(dial.holds(...hub)).toBe(true);
    expect(dial.holds(hub[0] + 156 + 40, hub[1])).toBe(true);
    expect(dial.holds(hub[0] + 156 + 50, hub[1])).toBe(false);
    expect(dial.holds(hub[0] - 110 - 30, hub[1] - 110 - 30)).toBe(true); // a corner zone
    expect(dial.holds(hub[0], 78)).toBe(false); // the degree row
  });

  it("lights the zone the pointer is nearest where it drew it", () => {
    const lit = Nashville.markup(900, 600, perf({ joystickDirection: "right" }));
    const { x, y } = /<rect x="(?<x>[\d.]+)" y="(?<y>[\d.]+)" width="90" height="48" rx="8" fill="var\(--note-lit\)"/
      .exec(lit)!.groups!;
    expect(dial.directionAt(Number(x) + 45, Number(y) + 24)).toBe("right");
  });

  it("has no wheel on a stage with no size", () => {
    expect(Nashville.dialAt(0, 600)).toBeNull();
  });
});

describe("Nashville prints the keyboard legend", () => {
  it("describes the keys on both sides of the wheel when there is room", () => {
    const m = Nashville.markup(900, 600, perf());
    expect(m).toContain("KEYBOARD · PLAY");
    expect(m).toContain(">Q W E<");
    expect(m).toContain("KEYBOARD · SHAPE");
    expect(m).toContain("next inversion");
  });

  it("leaves it out rather than print it over the wheel on a narrow stage", () => {
    expect(Nashville.markup(480, 600, perf())).not.toContain("KEYBOARD");
  });
});

describe("Tonnetz renders from its frame alone", () => {
  const cursor = { col: 0, row: 0, orient: "up" } as const;

  it("is deterministic for a fixed cursor and held set", () => {
    const opts = { glowId: G, held: NONE, cursor };
    expect(Tonnetz.markup(900, 600, score, 0.5, opts))
      .toBe(Tonnetz.markup(900, 600, score, 0.5, opts));
  });

  it("lights the pitch classes it is handed, and no others", () => {
    const dark = Tonnetz.markup(900, 600, Core.makeScore([]), 0, { glowId: G, held: NONE, cursor });
    const lit = Tonnetz.markup(900, 600, Core.makeScore([]), 0, {
      glowId: G, held: new Set([60, 64, 67]), cursor,
    });
    expect(dark).not.toContain("var(--key-press)");
    expect(lit).toContain("var(--key-press)");
  });

  it("draws the cursor where it is told, not where a singleton sits", () => {
    const home = Tonnetz.markup(900, 600, score, 0, { glowId: G, held: NONE, cursor });
    const moved = Tonnetz.markup(900, 600, score, 0, {
      glowId: G, held: NONE, cursor: { col: 2, row: 1, orient: "down" },
    });
    expect(home).not.toBe(moved);
  });
});

describe("PianoRoll renders from its frame alone", () => {
  it("lights only the keys it is handed", () => {
    const opts = { glowId: G, held: new Set([60]) };
    expect(PianoRoll.markup(800, 400, Core.makeScore([]), 0, opts)).toContain("var(--key-press)");
    expect(PianoRoll.markup(800, 400, Core.makeScore([]), 0, { glowId: G, held: NONE }))
      .not.toContain("var(--key-press)");
  });
});

/* Finding 2: the keyboard region used to be answered by main.ts comparing
   `view` against specific module exports. Every view now answers for itself,
   and the compiler is what makes a new one answer at all. */
describe("every view answers where its keyboard is", () => {
  const stubSvg = { clientWidth: 800, clientHeight: 600 } as SVGSVGElement;
  // the frame's live state, at rest. A region may depend on it — practice
  // mode's keyboard yields a column to the harmony bar — so it is a
  // parameter rather than something a view reaches for.
  const idle: LiveSnapshot = {
    held: NONE,
    perf: PerfState.snapshot(),
    tonnetz: TonnetzState.snapshot(),
    practice: PracticeState.snapshot(),
    pagePan: null,
    sheetScroll: 0,
    selection: null,
    marks: [],
    echoes: [],
  };
  const at = { score, t: 0.5, live: idle };
  const VIEWS: Record<string, ViewModule> = {
    StaffStd, PianoRoll, Tonnetz, Combo, Nashville, Practice, IsolatedKeys,
    "StaffPiano.keysView": StaffPiano.keysView,
    "StaffPiano.rollView": StaffPiano.rollView,
  };

  it("covers all nine views", () => {
    expect(Object.keys(VIEWS)).toHaveLength(9);
  });

  it.each(Object.keys(VIEWS))("%s returns a region or an explicit null", (name) => {
    const r = VIEWS[name].keyboardRegion(stubSvg, at);
    if (r === null) return;
    expect(r.w).toBeGreaterThan(0);
    expect(r.h).toBeGreaterThan(0);
    expect(r.y).toBeGreaterThanOrEqual(0);
    expect(r.y + r.h).toBeLessThanOrEqual(600);
  });

  it.each(Object.keys(VIEWS))("%s names its dial or an explicit null", (name) => {
    const dial = VIEWS[name].dial(stubSvg, at);
    expect(dial !== null).toBe(name === "Nashville");
  });

  it.each(Object.keys(VIEWS))("%s names its tape or an explicit null", (name) => {
    const tape = VIEWS[name].tape(stubSvg, { score, t: 0.5, live: idle });
    if (tape === null) return;
    expect(tape.region.w).toBeGreaterThan(0);
    expect(tape.region.h).toBeGreaterThan(0);
    expect(tape.seek(tape.pos).t).toBeCloseTo(0.5); // standing still is staying put
  });

  it.each(Object.keys(VIEWS))("%s names a scroller or a tape, never both", (name) => {
    const f = { score, t: 0.5, live: idle };
    const v = VIEWS[name];
    expect(v.scroller(stubSvg, f) !== null && v.tape(stubSvg, f) !== null).toBe(false);
  });

  it("gives the two stacked flavors DIFFERENT regions", () => {
    // They were previously distinguishable only by closure identity, so
    // hoisting the shared stacked(...) factory would have collapsed them.
    expect(StaffPiano.keysView.keyboardRegion(stubSvg, at))
      .not.toEqual(StaffPiano.rollView.keyboardRegion(stubSvg, at));
  });

  it("no view reads live state behind its signature", () => {
    // The renderers must not import the live-state SINGLETONS; the frame is
    // how that state reaches them. A type-only import of a snapshot's shape
    // is fine — it is erased, and naming the value you are handed is the
    // opposite of reaching for a global.
    const dir = join(__dirname);
    const singleton =
      /^\s*import\s+(?!type\b)[^;]*\b(LiveKeys|PerfState|TonnetzState|PracticeState)\b/m;
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.includes(".test."))) {
      const src = readFileSync(join(dir, f), "utf8");
      expect({ file: f, readsGlobalState: singleton.test(src) })
        .toEqual({ file: f, readsGlobalState: false });
    }
  });
});
