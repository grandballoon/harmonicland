import { describe, it, expect } from "vitest";
import { Practice, rollBandH } from "./practice";
import { Core } from "../core";
import { makeSteps, movesBetween } from "../steps";
import { realize } from "../harmony/progression";
import { progressionById } from "../harmony/repertoire";
import { PerfState } from "../perf-state";
import { TonnetzState } from "../tonnetz-state";
import type { PracticeSnapshot } from "../practice-state";
import type { Frame, LiveSnapshot } from "../view";
import type { Hand, RawNote } from "../types";

/* The view is a pure function of a snapshot, so a "moment" here is just a
   value — including moments the real cursor would take several presses to
   reach, and ones it never reaches at all. */

const n = (pitch: number, onset: number, duration = 0.5, hand?: Hand): RawNote =>
  ({ pitch, onset, duration, ...(hand && { hand }) });

// two bars of a second each, so the page has bars to show and one to leave
// out of focus
const score = Core.makeScore(
  [n(60, 0, 1, "upper"), n(64, 0, 1, "upper"), n(62, 1, 1, "upper"), n(48, 0, 2, "lower")],
  [0, 1, 2],
);
const { steps } = makeSteps(score, "upper");

const NONE: ReadonlySet<number> = new Set();

const snap = (over: Partial<PracticeSnapshot> = {}): PracticeSnapshot => ({
  active: true,
  hand: "upper",
  showOther: true,
  playOther: true,
  // the arrow tests below are about the arrows, so this fixture draws them;
  // the APP defaults them off (practice-state's cfg), which is what the
  // "switched off" test covers.
  showArrows: true,
  wholeScore: false,
  pan: 0,
  score,
  range: null,
  focus: { from: 0, to: 0 },
  span: { first: 0, last: steps.length },
  index: 0,
  total: steps.length,
  current: steps[0],
  next: steps[1],
  moves: movesBetween(steps[0], steps[1]),
  pending: new Set([60, 64]),
  dropped: NONE,
  wrong: NONE,
  stale: NONE,
  hit: new Map<number, number>(),
  chart: null,
  change: null,
  nextChange: null,
  other: new Set([48]),
  ...over,
});

/** A snapshot in which `p` was struck correctly `age` of a pulse ago. */
const justHit = (p: number, age = 0.2, over: Partial<PracticeSnapshot> = {}) =>
  snap({ hit: new Map([[p, age]]), pending: new Set([64]), ...over });

/** A moment in a lesson realized from a Progression — i.e. one that has an
 *  analysis to put in the harmony bar. ii–V–I because it is three chords
 *  with three different qualities, so a colour or a numeral going wrong
 *  shows up rather than repeating. */
const twoFiveOne = realize(progressionById("ii-V-I")!, { cycles: 1 });

const withChart = (index = 0, over: Partial<PracticeSnapshot> = {}) =>
  snap({
    chart: twoFiveOne.chart,
    change: twoFiveOne.chart.entries[index],
    nextChange: twoFiveOne.chart.entries[index + 1] ?? null,
    ...over,
  });

/** The frame's live state around a practice snapshot. Only `practice` is
 *  read by the region function; the rest is inert. */
const live = (practice: PracticeSnapshot, sheetScroll = 0): LiveSnapshot => ({
  held: NONE,
  perf: PerfState.snapshot(),
  tonnetz: TonnetzState.snapshot(),
  practice,
  pagePan: null,
  sheetScroll,
  selection: null,
});
/** ...and the frame around it, for what reads the whole frame. The lesson
 *  carries its own score, so the frame's is inert. */
const frame = (practice: PracticeSnapshot): Frame => ({ score, t: 0, live: live(practice) });

const W = 900;
const H = 600;

describe("Practice renders from a snapshot alone", () => {
  it("is deterministic — the same moment gives byte-identical markup", () => {
    expect(Practice.markup(W, H, snap(), NONE)).toBe(Practice.markup(W, H, snap(), NONE));
  });

  it("renders two different moments independently", () => {
    const a = Practice.markup(W, H, snap({ index: 0 }), NONE);
    const b = Practice.markup(W, H, snap({ index: 1, current: steps[1], next: null, moves: [] }), NONE);
    expect(a).not.toBe(b);
    expect(Practice.markup(W, H, snap({ index: 0 }), NONE)).toBe(a);
  });

  it("shows an empty state, not a broken one, with no lesson running", () => {
    const out = Practice.markup(W, H, snap({ active: false, current: null, next: null, total: 0 }), NONE);
    expect(out).toContain("Load a score to practise");
  });

  it("says the piece is complete once the cursor is past the last step", () => {
    const out = Practice.markup(W, H, snap({ index: steps.length, current: null, next: null, moves: [] }), NONE);
    expect(out).toContain("Piece complete");
  });

  it("names the hand it was handed", () => {
    expect(Practice.markup(W, H, snap({ hand: "lower" }), NONE)).toContain("left hand");
    expect(Practice.markup(W, H, snap({ hand: "both" }), NONE)).toContain("hands together");
  });

  it("colours the hand label as the hand being PLAYED, not its complement", () => {
    const label = (h: PracticeSnapshot["hand"]) =>
      /fill="([^"]+)">(?:right|left) hand</.exec(Practice.markup(W, H, snap({ hand: h }), NONE))?.[1];
    expect(label("upper")).toBe("var(--hand-r)");
    expect(label("lower")).toBe("var(--hand-l)");
  });
});

describe("arrows reach exactly one transition", () => {
  // one arrowhead per Move — the head is the only <path> the view draws.
  const heads = (svg: string): number => (svg.match(/Z" fill=/g) ?? []).length;
  const dots = (svg: string): number => (svg.match(/<circle /g) ?? []).length;

  it("draws one arrow per move and no more", () => {
    expect(heads(Practice.markup(W, H, snap(), NONE))).toBe(snap().moves.length);
  });

  it("draws none at all when the toggle switches them off", () => {
    const off = snap({ showArrows: false });
    expect(off.moves.length).toBeGreaterThan(0); // the moves are still the fact
    expect(heads(Practice.markup(W, H, off, NONE))).toBe(0);
    expect(dots(Practice.markup(W, H, off, NONE))).toBe(0);
  });

  it("draws none at all on the last step", () => {
    expect(heads(Practice.markup(W, H, snap({ next: null, moves: [] }), NONE))).toBe(0);
  });

  it("marks a repeated key with its own tick rather than a flat arc", () => {
    const repeat = Practice.markup(W, H, snap({ moves: [{ from: 60, to: 60 }] }), NONE);
    expect(heads(repeat)).toBe(1);
    expect(repeat).toContain("<line"); // the "strike again" tick
    expect(dots(repeat)).toBe(0); // both ends are one key — one mark only
  });
});

/* The arc between two keys is symmetric, so it says nothing about which way
   round it goes. Direction lives entirely in the ends being different
   SHAPES, and these are the tests that keep them different. */
describe("an arrow points somewhere unambiguously", () => {
  const one = (from: number, to: number) =>
    Practice.markup(W, H, snap({ moves: [{ from, to, hand: "upper" }] }), NONE);

  const headX = (svg: string) => Number(/M([-\d.]+),[-\d.]+ L[-\d.]+,[-\d.]+ L([-\d.]+)/.exec(svg)?.[2]);
  const dotX = (svg: string) => Number(/<circle cx="([-\d.]+)"/.exec(svg)?.[1]);

  it("puts the head on the DESTINATION and the dot on the origin", () => {
    // 60 -> 72 moves right, so the head must be to the right of the dot.
    const up = one(60, 72);
    expect(headX(up)).toBeGreaterThan(dotX(up));
    // ...and the mirror case must mirror, or the arrow is drawn backwards.
    const downward = one(72, 60);
    expect(headX(downward)).toBeLessThan(dotX(downward));
  });

  it("gives the head enough size to read as a head", () => {
    // the first version's was 10x9px — indistinguishable, at a glance, from
    // the round cap on the other end of the same stroke.
    const m = /M([-\d.]+),([-\d.]+) L([-\d.]+),([-\d.]+) L[-\d.]+,([-\d.]+) Z/.exec(one(60, 67))!;
    const [, leftX, baseY, rightX, , tipY] = m.map(Number);
    expect(rightX - leftX).toBeGreaterThanOrEqual(14); // width
    expect(tipY - baseY).toBeGreaterThanOrEqual(12); // height
  });
});

describe("key roles", () => {
  const styles = (s: PracticeSnapshot) => Practice.keyStyles(s);

  it("keeps an attack gold whether it is owed or already struck", () => {
    // one verb, one colour: getting a note right must not demote it to the
    // green that means "a finger resting on a sustain".
    const s = styles(snap({ pending: new Set([64]) }));
    expect(s.get(64)).toEqual({ fill: "var(--note-lit)", glow: true }); // owed
    expect(s.get(60)).toEqual({ fill: "var(--note-lit)" }); // struck
    expect(s.get(60)?.fill).not.toBe("var(--key-press)");
  });

  it("keeps green for HOLDING only", () => {
    // a step that genuinely carries one note over: 60 runs under 62, so its
    // second step attacks 62 while sustaining 60.
    const held = makeSteps(
      Core.makeScore([n(60, 0, 2, "upper"), n(62, 1, 1, "upper")]), "upper",
    ).steps[1];
    expect(held.sustain.map((x) => x.pitch)).toEqual([60]); // the fixture is the point
    const s = styles(snap({
      current: held, next: null, moves: [], pending: new Set([62]), other: NONE,
    }));
    const green = [...s].filter(([, v]) => v.fill === "var(--key-press)").map(([p]) => p);
    expect(green).toEqual([60]);
    expect(s.get(62)?.fill).toBe("var(--note-lit)"); // ...and striking stays gold
  });

  it("ranks a wrong note above everything else it could be", () => {
    expect(styles(snap({ wrong: new Set([61]) })).get(61)?.fill).toBe("var(--wrong)");
  });

  it("returns a dropped sustain to its own colour instead of filling it red", () => {
    // red is the harmless mistake (a key nothing asked for). A blocking
    // mistake in a second, near-identical red is how both stop being read.
    const withSustain = snap({ current: steps[1], next: null, moves: [], pending: new Set([62]) });
    const s = styles({ ...withSustain, dropped: new Set([60]) });
    expect(s.get(60)).toEqual({ fill: "var(--key-white)" }); // 60 = C4, white
    expect(s.get(60)?.fill).not.toBe("var(--key-press)"); // ...and not "held", either
  });

  it("uses red for one thing only, on the whole keyboard", () => {
    const s = styles(snap({
      current: steps[1], next: null, moves: [],
      pending: new Set([62]), dropped: new Set([60]), wrong: new Set([61]),
    }));
    const reds = [...s].filter(([, v]) => /--wrong|--playhead/.test(v.fill));
    expect(reds).toEqual([[61, { fill: "var(--wrong)", glow: true }]]);
  });

  it("gives the next step's keys NO fill at all", () => {
    // "press this now" and "press this next" as two fills of equal weight is
    // exactly what made the keyboard unreadable. The next step is a bar —
    // a different kind of mark, not a different shade.
    expect(styles(snap()).has(62)).toBe(false);
    expect(Practice.markup(W, H, snap(), NONE)).not.toContain("var(--hand-r)\"/><rect");
  });

  it("hues the other hand as the hand it actually is, dimmed", () => {
    expect(styles(snap({ hand: "upper" })).get(48)?.fill).toBe("var(--hand-l-dim)");
    expect(styles(snap({ hand: "lower", other: new Set([48]) })).get(48)?.fill).toBe("var(--hand-r-dim)");
  });

  it("outlines a dropped sustain where its fill should be, and glows it", () => {
    const svg = Practice.markup(W, H, snap({
      current: steps[1], next: null, moves: [],
      pending: new Set([62]), dropped: new Set([60]),
    }), NONE);
    const mark = /<rect [^>]*fill="none" stroke="var\(--key-press\)"[^>]*>/.exec(svg);
    expect(mark).not.toBeNull();
    expect(mark![0]).toContain("filter="); // blocking, so it has to be seen
  });

  it("greys a finger still resting on the note you just played", () => {
    // not the mistake colour: playing a note correctly is not a mistake,
    // and red that also means "mid-phrase" stops meaning "wrong".
    const s = styles(snap({ stale: new Set([60]), pending: new Set([64]) }));
    expect(s.get(60)).toEqual({ fill: "var(--ink-dim)" });
    expect(s.get(60)?.fill).not.toBe("var(--wrong)");
  });

  it("still ranks a genuine wrong note above a stale one", () => {
    const s = styles(snap({ stale: new Set([60]), wrong: new Set([61]) }));
    expect(s.get(61)).toEqual({ fill: "var(--wrong)", glow: true });
    expect(s.get(60)?.glow).toBeUndefined();
  });

  it("never lets a context key glow — only the call to action does", () => {
    const s = styles(snap());
    expect(s.get(48)?.glow).toBeUndefined();
    for (const p of s.get(60)?.glow ? [60] : []) expect(s.get(p)!.glow).toBe(true);
  });

  it("actively neutralises a hidden other hand instead of leaving it lit", () => {
    // it is auto-played, so those keys ARE down; left to the default they
    // would light the same green as a key the learner pressed.
    const s = styles(snap({ showOther: false }));
    expect(s.get(48)).toEqual({ fill: "var(--key-white)" }); // 48 = C3, a white key
  });

  it("has no opinion about any key while inactive", () => {
    const s = styles(snap({ active: false, current: null, next: null, pending: NONE, other: NONE }));
    expect(s.size).toBe(0);
  });
});

/* A correct note is the one moment of reward this view has, and it used to
   be invisible: a step completes ON the press that satisfies it, so by the
   next frame the key already belongs to the NEXT step — green if it is now a
   sustain, grey if it is now a finger to lift. That is the "correct notes go
   dull" these tests exist to prevent. The acknowledgment is therefore a fact
   about a passed instant, carried on the snapshot as an AGE, and drawn as a
   flare that falls away. */
describe("a correctly struck key pulses gold", () => {
  const pulses = (svg: string): string[] =>
    svg.match(/<rect [^>]*fill="var\(--note-hit\)"[^>]*>/g) ?? [];
  const opacity = (svg: string): number =>
    Number(/opacity="([\d.]+)"/.exec(pulses(svg)[0])![1]);

  it("goes gold, over whatever the key had settled into", () => {
    // 60 is the next step's sustain, so without the acknowledgment it would
    // be sitting in the green that means "keep holding".
    const s = Practice.keyStyles(justHit(60));
    expect(s.get(60)).toEqual({ fill: "var(--note-lit)" });
    expect(s.get(60)?.fill).not.toBe("var(--key-press)");
    // ...and over grey, which is where a note you played and finished lands.
    expect(Practice.keyStyles(justHit(60, 0.2, { stale: new Set([60]) })).get(60))
      .toEqual({ fill: "var(--note-lit)" });
  });

  it("lays one flare over each acknowledged key and no others", () => {
    expect(pulses(Practice.markup(W, H, justHit(60), NONE))).toHaveLength(1);
    expect(pulses(Practice.markup(W, H, snap(), NONE))).toHaveLength(0);
  });

  it("stops the moment the note is given back", () => {
    // released a note the step still wants: pending again, so not a success.
    expect(Practice.hits(justHit(60, 0.2, { pending: new Set([60, 64]) }))).toEqual([]);
    // let go of a sustain: blocking, so certainly not a success.
    expect(Practice.hits(justHit(60, 0.2, { dropped: new Set([60]) }))).toEqual([]);
    expect(pulses(Practice.markup(W, H, justHit(60, 0.2, { dropped: new Set([60]) }), NONE)))
      .toHaveLength(0);
  });

  it("flares fast and falls away slowly — a strike, not an arrival", () => {
    expect(Practice.pulseEnv(0)).toBe(0);
    expect(Practice.pulseEnv(0.12)).toBeCloseTo(1, 5); // peak, early
    expect(Practice.pulseEnv(0.5)).toBeGreaterThan(Practice.pulseEnv(0.9));
    expect(Practice.pulseEnv(1)).toBeCloseTo(0, 5);
    // the peak sits early, or the light reads as arriving rather than struck
    const xs = Array.from({ length: 101 }, (_, i) => i / 100);
    const peak = xs.reduce((b, x) => (Practice.pulseEnv(x) > Practice.pulseEnv(b) ? x : b), 0);
    expect(peak).toBeLessThan(0.25);
    // and it is clamped, so an age off the end never inverts the light
    expect(Practice.pulseEnv(1.4)).toBeCloseTo(0, 5);
    expect(Practice.pulseEnv(-1)).toBe(0);
  });

  it("dims as the acknowledgment ages", () => {
    const early = opacity(Practice.markup(W, H, justHit(60, 0.2), NONE));
    const late = opacity(Practice.markup(W, H, justHit(60, 0.9), NONE));
    expect(early).toBeGreaterThan(late);
  });

  it("glows, so the pulse is light rather than a flashing rectangle", () => {
    expect(pulses(Practice.markup(W, H, justHit(60), NONE))[0]).toContain("filter=");
  });

  it("stays a pure function of the snapshot, ages and all", () => {
    // no clock of its own: the same moment must render identically, or the
    // view could disagree with the state about when "now" is.
    expect(Practice.markup(W, H, justHit(60, 0.3), NONE))
      .toBe(Practice.markup(W, H, justHit(60, 0.3), NONE));
    expect(Practice.markup(W, H, justHit(60, 0.3), NONE))
      .not.toBe(Practice.markup(W, H, justHit(60, 0.7), NONE));
  });
});

/* --------------------------------------------------------------------
   THE HARMONY BAR — present only when the lesson brought an analysis.
   -------------------------------------------------------------------- */
describe("the harmony bar", () => {
  it("is absent, and costs nothing, for a lesson with no analysis", () => {
    const bare = Practice.markup(W, H, snap(), NONE);
    expect(Practice.chartBandW(W, false)).toBe(0);
    expect(bare).not.toContain("ii–V–I");
    // ...and the rest of the view is laid out exactly as it always was
    expect(bare).toBe(Practice.markup(W, H, snap(), NONE));
  });

  it("names the progression and the key it is being practised in", () => {
    const out = Practice.markup(W, H, withChart(), NONE);
    expect(out).toContain("ii–V–I");
    expect(out).toContain("C Major");
  });

  it("says the numeral, the chord, the colour and the notes", () => {
    const out = Practice.markup(W, H, withChart(0), NONE);
    expect(out).toContain(">ii<");        // the number, against home
    expect(out).toContain("D min7");      // ...the chord it actually is
    expect(out).toContain("dreamy");      // ...the coloration's mood
    expect(out).toContain("D  F  A  C");  // ...and its pitch classes
  });

  it("moves with the cursor rather than restating the first chord", () => {
    const first = Practice.markup(W, H, withChart(0), NONE);
    const second = Practice.markup(W, H, withChart(1), NONE);
    expect(first).not.toBe(second);
    expect(second).toContain("G dom7");
    expect(second).toContain("2 / 3");
  });

  it("shows the whole progression, not only where you are", () => {
    const out = Practice.markup(W, H, withChart(1), NONE);
    for (const n of [">ii<", ">V<", ">I<"]) expect(out).toContain(n);
  });

  it("says the key a borrowed chord is heard in", () => {
    // The tritone sub's ♭II7 is degree I of D♭ major. That the numbers are
    // read against C and the chord belongs to another key is the whole
    // point of the field, so the bar has to say both.
    const sub = realize(progressionById("tritone-sub")!, { cycles: 1 });
    const out = Practice.markup(W, H, snap({
      chart: sub.chart, change: sub.chart.entries[1], nextChange: sub.chart.entries[2],
    }), NONE);
    expect(out).toContain("♭II7");
    expect(out).toContain("in C# Major");
  });

  it("is deterministic, like the rest of the view", () => {
    expect(Practice.markup(W, H, withChart(2), NONE))
      .toBe(Practice.markup(W, H, withChart(2), NONE));
  });

  it("stands down on a narrow viewport rather than crushing the keyboard", () => {
    const narrow = 600;
    expect(Practice.chartBandW(narrow, true)).toBe(0);
    expect(Practice.markup(narrow, H, withChart(), NONE)).not.toContain("ii–V–I");
  });

  it("drops the list, not the current chord, when there is no room", () => {
    // A viewport too short for even one row must not draw the list through
    // the footer. What you cannot do without is the chord you are on.
    const tiny = Practice.markup(W, 210, withChart(1), NONE);
    expect(tiny).toContain("G dom7");
    expect(tiny).toContain("2 / 3");
  });

  it("windows a long progression around where you are", () => {
    // Twelve bars do not fit beside a keyboard. Showing a part and saying
    // so beats showing a list that runs off the bottom.
    const blues = realize(progressionById("blues-12")!, { cycles: 1 });
    const late = Practice.markup(W, 380, snap({
      chart: blues.chart, change: blues.chart.entries[11], nextChange: null,
    }), NONE);
    expect(late).toContain("⋯");      // ...the part above is admitted to
    expect(late).toContain("12 / 12"); // ...and the current chord is in view
  });
});

describe("the view is a keyboard", () => {
  const stub = { clientWidth: W, clientHeight: H } as SVGSVGElement;

  it("puts its playable region at the bottom of the svg", () => {
    const r = Practice.keyboardRegion(stub, frame(snap()))!;
    expect(r.y + r.h).toBe(H);
    expect(r.w).toBe(W);
  });

  it("gives up exactly the harmony bar's column when there is one", () => {
    // The hit-test and the drawing must agree about where the keys stop.
    // They disagreed silently before: a region wider than the keyboard
    // sounds a wrong note near the edge and reports no error at all.
    const r = Practice.keyboardRegion(stub, frame(withChart()))!;
    expect(r.w).toBe(W - Practice.chartBandW(W, true));
    expect(r.w).toBeLessThan(W);
  });
});

/* ------------------------------------------------------------------ */
describe("the page", () => {
  // the page is the <g> moved down to SHEET_TOP; nothing else translates
  // to that y, so its presence is the page's presence. It holds groups of
  // its own (the torn context bars are clipped), so its end is found by
  // depth, not by the first closing tag.
  const page = (svg: string): string | null => {
    const open = svg.indexOf('<g transform="translate(0,60)">');
    if (open < 0) return null;
    let depth = 0;
    const re = /<g\b|<\/g>/g;
    re.lastIndex = open;
    let m: RegExpExecArray | null;
    while ((m = re.exec(svg))) {
      depth += m[0] === "</g>" ? -1 : 1;
      if (depth === 0) return svg.slice(open, m.index);
    }
    return null;
  };
  // a head carries its colour as a fill when solid and as a stroke when
  // hollow (a half or a whole)
  const heads = (svg: string, fill: string): number =>
    (svg.match(new RegExp(`<ellipse [^>]*(?:fill|stroke)="${fill.replace(/[()]/g, "\\$&")}"`, "g")) ?? []).length;

  it("is open whenever a lesson is, with the bars numbered from one", () => {
    const p = page(Practice.markup(W, H, snap(), NONE));
    expect(p).not.toBeNull();
    expect(p).toContain(">1</text>");
  });

  it("writes a key held that the step never asked for in red, as the keyboard lights it", () => {
    expect(heads(page(Practice.markup(W, H, snap(), NONE))!, "var(--wrong)")).toBe(0);
    const svg = Practice.markup(W, H, snap({ wrong: new Set([67]) }), NONE);
    expect(heads(page(svg)!, "var(--wrong)")).toBe(1);
    expect(heads(Practice.markup(W, H, snap({ wholeScore: true, wrong: new Set([67]) }), NONE), "var(--wrong)")).toBe(1);
  });

  it("is absent with no lesson, and absent for an empty one", () => {
    expect(page(Practice.markup(W, H, snap({ active: false, score: null, total: 0 }), NONE))).toBeNull();
    expect(page(Practice.markup(W, H, snap({ total: 0 }), NONE))).toBeNull();
  });

  it("stands down on a viewport too short to hold it with the readout and keys", () => {
    expect(Practice.sheetBandH(H, false)).toBeGreaterThan(0);
    expect(Practice.sheetBandH(420, false)).toBe(0);
    expect(page(Practice.markup(W, 420, snap(), NONE))).toBeNull();
  });

  it("gives up height to the arrow band rather than overlapping it", () => {
    expect(Practice.sheetBandH(560, true)).toBeLessThan(Practice.sheetBandH(560, false));
  });

  it("lights the current step's notes in the strike gold, and only those", () => {
    // step 0 of the upper hand: 60 and 64 attack; 48 is the other hand
    const p = page(Practice.markup(W, H, snap(), NONE))!;
    expect(heads(p, "var(--note-lit)")).toBe(2);
  });

  it("dims the notes outside the bars in focus", () => {
    // focus on bar 0; bar 1 is torn-off context: the D at 1.0s, and the
    // second half of the C3 whole note tied over the barline
    const p = page(Practice.markup(W, H, snap(), NONE))!;
    expect(heads(p, "var(--ink-dim)")).toBe(2);
    // ...and with both bars in focus it is a note of the lesson
    const both = page(Practice.markup(W, H, snap({ focus: { from: 0, to: 1 } }), NONE))!;
    expect(heads(both, "var(--ink-dim)")).toBe(0);
    expect(heads(both, "var(--page-r)")).toBe(1);
  });

  it("wears the dim hand token for the hand not being practised", () => {
    const p = page(Practice.markup(W, H, snap(), NONE))!;
    expect(heads(p, "var(--hand-l-dim)")).toBe(1);
  });

  it("leaves the other hand off the page when told to", () => {
    const p = page(Practice.markup(W, H, snap({ showOther: false }), NONE))!;
    expect(heads(p, "var(--hand-l-dim)")).toBe(0);
  });

  it("sits the isolated bars on a panel, and a merely-followed bar on none", () => {
    const followed = page(Practice.markup(W, H, snap(), NONE))!;
    expect(followed).not.toContain('fill="var(--panel)"');
    const isolated = page(Practice.markup(W, H, snap({ range: { from: 0, to: 0 } }), NONE))!;
    expect(isolated).toContain('fill="var(--panel)"');
  });

  it("rules the current instant in the playhead colour", () => {
    expect(page(Practice.markup(W, H, snap(), NONE))).toContain('stroke="var(--playhead)"');
    expect(page(Practice.markup(W, H, snap({ current: null, next: null }), NONE)))
      .not.toContain('stroke="var(--playhead)"');
  });

  it("is deterministic, like the rest of the view", () => {
    expect(page(Practice.markup(W, H, snap(), NONE))).toBe(page(Practice.markup(W, H, snap(), NONE)));
  });
});

describe("the page is a bar picker", () => {
  const stub = {
    clientWidth: W, clientHeight: H,
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
  } as unknown as SVGSVGElement;
  const sheetH = Practice.sheetBandH(H, true);
  const midY = 60 + sheetH / 2;
  const barAt = (x: number, y = midY, s = snap()) => Practice.barAt(stub, x, y, live(s));

  it("names the bar drawn under the pointer, in the order the bars were drawn", () => {
    // sweep left to right: the clef and signatures, bar 1, the torn start
    // of bar 2, then the margin
    const seen: (number | null)[] = [];
    for (let x = 0; x < W; x += 10) {
      const b = barAt(x);
      if (seen[seen.length - 1] !== b) seen.push(b);
    }
    expect(seen).toEqual([null, 0, 1, null]);
  });

  it("answers null above and below the page", () => {
    expect(barAt(W / 2, 30)).toBeNull();
    expect(barAt(W / 2, 60 + sheetH + 5)).toBeNull();
  });

  it("answers null when there is no page to click", () => {
    expect(barAt(W / 2, midY, snap({ active: false, score: null, total: 0 }))).toBeNull();
    const short = { ...stub, clientHeight: 420 } as unknown as SVGSVGElement;
    expect(Practice.barAt(short, W / 2, midY, live(snap()))).toBeNull();
  });

  it("stops where the harmony bar starts, like the keyboard", () => {
    // with the column present the page is narrower; a point in the column
    // is not on any bar even though the same x was bar 2 without it
    const s = withChart(0, { range: null });
    expect(barAt(W - 20, midY, snap())).not.toBeNull();
    expect(barAt(W - 20, midY, s)).toBeNull();
  });
});

describe("the page pans across the piece", () => {
  const stub = {
    clientWidth: W, clientHeight: H,
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
  } as unknown as SVGSVGElement;
  const sheetH = Practice.sheetBandH(H, true);
  const midY = 60 + sheetH / 2;
  const sweep = (s: PracticeSnapshot) => {
    const seen: (number | null)[] = [];
    for (let x = 0; x < W; x += 10) {
      const b = Practice.barAt(stub, x, midY, live(s));
      if (seen[seen.length - 1] !== b) seen.push(b);
    }
    return seen;
  };

  it("names the page's band as a scroller across, resting on the bars in hand", () => {
    const sc = Practice.scroller(stub, frame(snap()))!;
    expect(sc.axis).toBe("x");
    expect(sc.region).toEqual({ x: 0, y: 60, w: W, h: sheetH });
    // focus on bar 0, the first: nothing before it to pan back to
    expect(sc.origin).toBe(0);
    expect(sc.home).toBe(sc.origin);
    expect(sc.length).toBeGreaterThan(W);
    // the rest is in sight of the bars being worked on
    expect(sc.sight![0]).toBeLessThanOrEqual(sc.origin);
    expect(sc.sight![1]).toBeGreaterThanOrEqual(sc.origin);
  });

  it("offers nothing to scroll with no page", () => {
    const short = { ...stub, clientHeight: 420 } as unknown as SVGSVGElement;
    expect(Practice.scroller(short, frame(snap()))).toBeNull();
    expect(Practice.scroller(stub, frame(snap({ active: false, score: null, total: 0 })))).toBeNull();
  });

  it("slides the next bar into view, hit-testing where it is drawn", () => {
    expect(sweep(snap())).toEqual([null, 0, 1, null]);
    const { length } = Practice.scroller(stub, frame(snap()))!;
    // panned to the end: the torn start of bar 0, then all of bar 1
    expect(sweep(snap({ pan: length - W }))).toEqual([null, 0, 1, null]);
    const startX = (pan: number) => {
      let x = 0;
      while (x < W && Practice.barAt(stub, x, midY, live(snap({ pan }))) !== 1) x += 2;
      return x;
    };
    expect(startX(0) - startX(length - W)).toBeGreaterThan(W / 2);
  });

  it("ends the strip on the final barline once the last bar is in view", () => {
    const final = /<rect [^>]*width="4"[^>]*fill="var\(--grid-oct\)"/;
    const { length } = Practice.scroller(stub, frame(snap()))!;
    expect(Practice.markup(W, H, snap(), NONE)).not.toMatch(final);
    expect(Practice.markup(W, H, snap({ pan: length - W }), NONE)).toMatch(final);
  });

  it("holds a pan past either end at the end", () => {
    expect(Practice.markup(W, H, snap({ pan: 1e6 }), NONE))
      .toBe(Practice.markup(W, H, snap({ pan: Practice.scroller(stub, frame(snap()))!.length - W }), NONE));
    expect(Practice.markup(W, H, snap({ pan: -1e6 }), NONE)).toBe(Practice.markup(W, H, snap(), NONE));
  });
});

describe("the whole score", () => {
  const whole = (over: Partial<PracticeSnapshot> = {}) => snap({ wholeScore: true, ...over });
  const stub = {
    clientWidth: W, clientHeight: H,
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
  } as unknown as SVGSVGElement;

  it("sets every bar in place of the readout, above the keys", () => {
    const svg = Practice.markup(W, H, whole(), NONE);
    expect(svg).toContain(">1</text>");
    expect(svg).toContain(">2</text>");
    expect(svg).not.toContain(">NOW<");
    // ...and keeps the header and the keyboard
    expect(svg).toContain("step 1 / 2");
    expect(svg).toContain("var(--key-white)");
  });

  it("draws the keys exactly as the step layout does", () => {
    const keys = (svg: string) => svg.slice(svg.indexOf(`<g transform="translate(0,${H - rollBandH(H)})">`));
    const held = new Set([60]);
    expect(keys(Practice.markup(W, H, whole(), held))).toBe(keys(Practice.markup(W, H, snap(), held)));
  });

  it("offers the same keyboard to the pointer as the step layout", () => {
    expect(Practice.keyboardRegion(stub, frame(whole()))).toEqual(Practice.keyboardRegion(stub, frame(snap())));
  });

  it("keeps the sheets clear of the arrows and the keys", () => {
    for (const showArrows of [false, true]) {
      const h = Practice.sheetsH(H, showArrows);
      expect(60 + h).toBe(H - rollBandH(H) - (showArrows ? 84 : 0));
      expect(Practice.barAt(stub, W / 2, 60 + h + 1, live(whole({ showArrows })))).toBeNull();
    }
  });

  it("is a bar picker too", () => {
    const seen = new Set<number | null>();
    for (let x = 0; x < W; x += 10) seen.add(Practice.barAt(stub, x, 60 + 112, live(whole())));
    expect(seen).toEqual(new Set([null, 0, 1]));
  });

  it("names the region that scrolls, down the sheets", () => {
    const sc = Practice.scroller(stub, frame(whole()))!;
    expect(sc.region).toEqual({ x: 0, y: 60, w: W, h: Practice.sheetsH(H, true) });
    expect(sc.axis).toBe("y");
    expect(sc.length).toBeGreaterThan(0);
    expect(sc.origin).toBe(0);
    expect(sc.sight).not.toBeNull();
    // the harmony bar keeps its column; the sheets scroll beside it
    expect(Practice.scroller(stub, frame(whole({ chart: twoFiveOne.chart }))))
      .toMatchObject({ region: { w: W - Practice.chartBandW(W, true) } });
  });

  it("its scroller hit-tests the bars the same way, from its region's corner", () => {
    for (const s of [snap(), whole()]) {
      const sc = Practice.scroller(stub, frame(s))!;
      for (let x = 0; x < W; x += 10)
        expect(sc.barAt(x, 112)).toBe(Practice.barAt(stub, x, sc.region.y + 112, live(s)));
    }
  });

  it("hit-tests the sheets where they are scrolled to", () => {
    const y = 60 + 112;
    const at = (scroll: number) => {
      const seen = new Set<number | null>();
      for (let x = 0; x < W; x += 10) seen.add(Practice.barAt(stub, x, y - scroll, live(whole(), scroll)));
      return seen;
    };
    // the same point on the sheet, reached with and without scrolling
    expect(at(0)).toEqual(new Set([null, 0, 1]));
    expect(at(50)).toEqual(at(0));
  });

  it("falls back to the ordinary view with no lesson to show", () => {
    const svg = Practice.markup(W, H, whole({ active: false, score: null, total: 0 }), NONE);
    expect(svg).toContain("Load a score to practise.");
  });
});

describe("where the readout says you are", () => {
  it("counts steps through the piece when nothing is isolated", () => {
    expect(Practice.whereLabel(snap())).toBe("step 1 / 2");
    expect(Practice.whereLabel(snap({ index: 2, current: null }))).toBe("done · 2 steps");
  });

  it("names the bar and counts steps within it", () => {
    expect(Practice.whereLabel(snap({ range: { from: 1, to: 1 }, span: { first: 1, last: 2 }, index: 1 })))
      .toBe("bar 2 · step 1 / 1");
  });

  it("names a run of bars as a run", () => {
    expect(Practice.whereLabel(snap({ range: { from: 0, to: 1 }, span: { first: 0, last: 2 }, index: 1 })))
      .toBe("bars 1–2 · step 2 / 2");
  });

  it("says when there is nothing to play, rather than 'complete'", () => {
    const s = snap({ range: { from: 1, to: 1 }, span: { first: 2, last: 2 }, index: 2, current: null, next: null });
    expect(Practice.whereLabel(s)).toBe("bar 2 · nothing to play");
    const out = Practice.markup(W, H, s, NONE);
    expect(out).toContain("Nothing to play");
    expect(out).not.toContain("Piece complete");
  });

  it("measures progress through the range, not the piece", () => {
    // halfway through a two-step range: the gold rule reaches the middle
    const s = snap({ range: { from: 0, to: 1 }, span: { first: 0, last: 2 }, index: 1, current: steps[1] });
    const rule = /<line x1="24" y1="48" x2="([\d.]+)" y2="48" stroke="var\(--note-lit\)"/.exec(
      Practice.markup(W, H, s, NONE),
    );
    expect(rule).not.toBeNull();
    expect(+rule![1]).toBeCloseTo(24 + (W - Practice.chartBandW(W, false) - 48) / 2, 6);
  });
});
