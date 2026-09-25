import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MidiIn } from "../inputs/midi";
import { IsolatedKeys, PAD, type Hands } from "./isolated-keys";
import { PianoRoll } from "./piano-roll";
import { Core } from "../core";
import { PerfState } from "../perf-state";
import { TonnetzState } from "../tonnetz-state";
import { PracticeState } from "../practice-state";
import { whitesIn } from "../pitch";
import type { BarRange, Pitch, Score } from "../types";
import type { Frame } from "../view";

// two bars of one second: E4–G4 in the first, C3 held from the first into
// the second, and A5 alone in the second
const score = Core.makeScore([
  { pitch: 64, onset: 0, duration: 0.5 },
  { pitch: 67, onset: 0.5, duration: 0.5 },
  { pitch: 48, onset: 0.5, duration: 1 },
  { pitch: 81, onset: 1.5, duration: 0.5 },
], [0, 1, 2]);

const frame = (
  selection: BarRange | null, t = 0, held: ReadonlySet<Pitch> = new Set(),
  hands: Partial<Hands> = {}, on: Score = score,
): Frame => ({
  score: on, t,
  live: {
    held,
    perf: PerfState.snapshot(),
    tonnetz: TonnetzState.snapshot(),
    practice: { ...PracticeState.snapshot(), hand: "both", showOther: true, ...hands },
    pagePan: null,
    sheetScroll: 0,
    selection,
    marks: [],
  },
});

const W = 1200;
const H = 700;
const stubSvg = {
  clientWidth: W, clientHeight: H,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: W, height: H }),
} as unknown as SVGSVGElement;

describe("the keys a run of bars plays", () => {
  it("are the notes sounding in the bars, padded by greyed white keys", () => {
    const f = IsolatedKeys.focusOf(score, { from: 0, to: 0 })!;
    expect([f.lo, f.hi]).toEqual([48, 67]);
    expect(whitesIn({ lo: f.shown.lo, hi: 47 })).toHaveLength(PAD); // A2 G2 F2
    expect(whitesIn({ lo: 68, hi: f.shown.hi })).toHaveLength(PAD); // A4 B4 C5
  });

  it("include a note held into the bars from before them", () => {
    const f = IsolatedKeys.focusOf(score, { from: 1, to: 1 })!;
    expect([f.lo, f.hi]).toEqual([48, 81]);
  });

  it("are the whole piece's without a selection", () => {
    const f = IsolatedKeys.focusOf(score, null)!;
    expect([f.lo, f.hi]).toEqual([48, 81]);
  });

  it("are none in bars where nothing sounds", () => {
    const rest = Core.makeScore([{ pitch: 60, onset: 0, duration: 1 }], [0, 1, 2]);
    expect(IsolatedKeys.focusOf(rest, { from: 1, to: 1 })).toBeNull();
  });
});

describe("the isolated keyboard", () => {
  const drawn = (f: Frame): string => IsolatedKeys.markup(W, H, f);

  it("draws only the shown keys, and greys the pad but not what is played", () => {
    const m = drawn(frame({ from: 0, to: 0 }));
    const f = IsolatedKeys.focusOf(score, { from: 0, to: 0 })!;
    const keys = (m.match(/<rect /g) ?? []).length;
    let count = 0;
    for (let p = f.shown.lo; p <= f.shown.hi; p++) count++;
    expect(keys).toBe(count);
    // every key below C3 and above G4 is pad, black keys included
    const muted = (m.match(/var\(--key-mute-(white|black)\)/g) ?? []).length;
    expect(muted).toBe((48 - f.shown.lo) + (f.shown.hi - 67));
  });

  it("lights a key pressed on the pad instead of greying it", () => {
    const idle = drawn(frame({ from: 0, to: 0 }, 0.9));
    const pressed = drawn(frame({ from: 0, to: 0 }, 0.9, new Set([70]))); // A♯4, pad
    expect(idle).not.toContain("var(--key-press)");
    expect(pressed).toContain("var(--key-press)");
    const muted = (m: string) => (m.match(/var\(--key-mute-/g) ?? []).length;
    expect(muted(pressed)).toBe(muted(idle) - 1);
  });

  it("sits inside the stage, centred, and is hit-tested where it is drawn", () => {
    const f = frame({ from: 0, to: 0 });
    const r = IsolatedKeys.keyboardRegion(stubSvg, f)!;
    expect(r.x).toBeGreaterThan(0);
    expect(r.y).toBeGreaterThan(0);
    expect(r.x + r.w).toBeLessThan(W);
    expect(r.y + r.h).toBeLessThan(H);
    expect(r.x + r.w / 2).toBeCloseTo(W / 2);
    expect(r.y + r.h / 2).toBeCloseTo(H / 2);
    // the leftmost key is the pad's first, the rightmost its last
    expect(PianoRoll.pitchAt(stubSvg, r.x + 2, r.y + r.h - 2, r)).toBe(r.span!.lo);
    expect(PianoRoll.pitchAt(stubSvg, r.x + r.w - 2, r.y + r.h - 2, r)).toBe(r.span!.hi);
  });

  it("narrows rather than squashing when the stage is too short for its keys", () => {
    const short = IsolatedKeys.placement(W, 200, { lo: 60, hi: 64 })!;
    const tall = IsolatedKeys.placement(W, 2000, { lo: 60, hi: 64 })!;
    expect(short.h).toBeLessThanOrEqual(200);
    expect(short.w / short.h).toBeCloseTo(tall.w / tall.h);
  });

  it("falls back to all 88 keys when the bars play nothing", () => {
    const rest = Core.makeScore([], [0, 1]);
    const r = IsolatedKeys.keyboardRegion(stubSvg, { ...frame(null), score: rest })!;
    expect(r.span).toEqual({ lo: 21, hi: 108 });
  });

  it("has no tape and no scroller", () => {
    const f = frame(null);
    expect(IsolatedKeys.tape(stubSvg, f)).toBeNull();
    expect(IsolatedKeys.scroller(stubSvg, f)).toBeNull();
  });
});

/* The other hand's chords used to light in the same gold as the run being
   learned, so a passage one hand plays a note at a time looked like a
   handful of keys at once. The hand practice mode is set to now leads. */
describe("the hands on the isolated keyboard", () => {
  const duet = Core.makeScore([
    { pitch: 72, onset: 0, duration: 1, hand: "upper" },
    { pitch: 48, onset: 0, duration: 1, hand: "lower" },
    { pitch: 52, onset: 0, duration: 1, hand: "lower" },
  ], [0, 1]);
  const styles = (hands: Hands, held: ReadonlySet<Pitch> = new Set()) =>
    IsolatedKeys.keyStyles(duet, 0.5, held, IsolatedKeys.focusOf(duet, null), hands);

  it("lights the hand being learned gold, and dims the other", () => {
    const s = styles({ hand: "upper", showOther: true });
    expect(s.get(72)).toEqual({ fill: "var(--note-lit)", glow: true });
    expect(s.get(48)).toEqual({ fill: "var(--hand-l-dim)" });
    expect(s.get(52)).toEqual({ fill: "var(--hand-l-dim)" });
  });

  it("leaves the other hand dark when it is not to be shown", () => {
    const s = styles({ hand: "lower", showOther: false });
    expect(s.get(72)).toEqual({ fill: "var(--key-white)" });
    expect(s.get(48)).toEqual({ fill: "var(--note-lit)", glow: true });
  });

  it("colours each hand its own way, hands together", () => {
    const s = styles({ hand: "both", showOther: true });
    expect(s.get(72)?.fill).toBe("var(--hand-r)");
    expect(s.get(48)?.fill).toBe("var(--hand-l)");
  });

  it("leaves a key held live to show as pressed", () => {
    expect(styles({ hand: "upper", showOther: true }, new Set([48])).has(48)).toBe(false);
  });

  it("lights one key at a time through the Chopin prelude's right-hand run", () => {
    const b = readFileSync(join(__dirname, "..", "..", "scores", "chopin_prelude_4.midi"));
    const chopin = MidiIn.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
    const bars = { from: 16, to: 17 };
    const { start, end } = Core.barTime(chopin, bars);
    for (let t = start; t < end; t += 0.1) {
      const m = IsolatedKeys.markup(W, H, frame(bars, t, new Set(), { hand: "upper" }, chopin));
      const right = Core.activeAt(chopin, t).filter((n) => n.hand === "upper");
      expect(right).toHaveLength(1);
      expect((m.match(/var\(--note-lit\)/g) ?? []).length).toBe(1);
    }
  });
});
