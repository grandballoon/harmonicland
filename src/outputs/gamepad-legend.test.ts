import { describe, it, expect, afterEach } from "vitest";
import { render, fits, BOX } from "./gamepad-legend";
import {
  BUTTON, DEFAULT_BINDINGS, DEFAULT_CONFIG, setBindings, setConfig,
} from "../gamepad-perfecto";
import type { LegendState } from "./gamepad-legend";
import type { Key } from "../harmony/perfecto";

const C_MAJOR: Key = { root: 0, scale: "major" };
const state = (over: Partial<LegendState> = {}): LegendState => ({
  key: C_MAJOR,
  degree: 1,
  direction: "center",
  sounding: false,
  ...over,
});

const draw = (over: Partial<LegendState> = {}): string =>
  render(0, 0, BOX.w, BOX.h, state(over));

// the <text> element(s) whose content is exactly `s`, with their attributes
const textRe = (s: string, flags = ""): RegExp =>
  new RegExp(`<text[^>]*>${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</text>`, flags);
const textEl = (svg: string, s: string): string | undefined => svg.match(textRe(s))?.[0];
const allTextEls = (svg: string, s: string): string[] => svg.match(textRe(s, "g")) ?? [];
const fillOf = (el: string): string | undefined => el.match(/fill="([^"]*)"/)?.[1];

afterEach(() => {
  setConfig(DEFAULT_CONFIG);
  setBindings(DEFAULT_BINDINGS);
});

describe("gamepad legend", () => {
  it("only claims to fit where it can be drawn at a readable scale", () => {
    expect(fits(BOX.w, BOX.h)).toBe(true);
    expect(fits(BOX.w * 0.5, BOX.h)).toBe(false); // squeezed horizontally
    expect(fits(BOX.w, BOX.h * 0.5)).toBe(false); // squeezed vertically
  });

  it("labels every chord control with the degree the mapping gives it", () => {
    const svg = draw();
    for (const letter of ["A", "B", "X", "Y", "LB", "RB", "LT", "RT"]) {
      expect(textEl(svg, letter)).toBeTruthy();
    }
    // I ii iii IV on the face diamond, V vi vii° on the d-pad, and ii..vii°
    // again around the chord stick — so vii° is drawn twice, ii twice, etc.
    expect(svg.match(/>vii°</g)).toHaveLength(2);
    expect(svg.match(/>ii</g)).toHaveLength(2);
    expect(svg.match(/>I</g)).toHaveLength(1); // trigger + A share one numeral each
    expect(textEl(svg, "inv")).toBeTruthy(); // d-pad ← isn't a chord
  });

  it("scales the design box into the rect it is given, and centres it", () => {
    const g = render(100, 50, BOX.w * 2, BOX.h * 2, state());
    // capped at MAX_SCALE, so it centres in the oversized rect rather than filling it
    const m = g.match(/^<g transform="translate\(([\d.]+),([\d.]+)\) scale\(([\d.]+)\)">/);
    expect(m).toBeTruthy();
    const [, tx, ty, s] = m!;
    expect(Number(s)).toBeLessThanOrEqual(1.45);
    expect(Number(tx)).toBeCloseTo(100 + (BOX.w * 2 - BOX.w * Number(s)) / 2, 1);
    expect(Number(ty)).toBeCloseTo(50 + (BOX.h * 2 - BOX.h * Number(s)) / 2, 1);
  });

  it("lights the controls that select the current degree, and only those", () => {
    // a lit control is the one shape drawn --note-lit on --note-lit (plain
    // numerals are --note-lit too when the degree is major, so count shapes)
    const litShapes = (svg: string) =>
      (svg.match(/fill="var\(--note-lit\)" stroke="var\(--note-lit\)"/g) ?? []).length;
    expect(litShapes(draw({ degree: 1 }))).toBe(2); // the A button and the root trigger
    expect(litShapes(draw({ degree: 2 }))).toBe(1); // the B button (the stick's ↗ is a numeral)
    expect(litShapes(draw({ degree: 7 }))).toBe(1); // the d-pad ↓ arm
    // both vii° numerals (d-pad arm, then chord stick) are dim-colored while
    // another degree is selected, and both mark themselves when it's theirs:
    // dark ink on the lit arm, --note-lit for the numeral beside the stick.
    const seventh = (svg: string) => allTextEls(svg, "vii°").map(fillOf);
    expect(seventh(draw({ degree: 1 }))).toEqual(["var(--playhead)", "var(--playhead)"]);
    expect(seventh(draw({ degree: 7 }))).toEqual(["#0b1020", "var(--note-lit)"]);
  });

  it("glows only while a chord is actually sounding", () => {
    expect(draw({ degree: 1, sounding: false })).not.toContain("url(#glow)");
    expect(draw({ degree: 1, sounding: true })).toContain("url(#glow)");
  });

  it("draws the coloration stick where the thumb actually is", () => {
    const centred = draw({ direction: "center" });
    const pushed = draw({ direction: "left" });
    expect(centred).not.toEqual(pushed); // the knob moves with the live direction
    // pushing the coloration stick doesn't light any chord control
    expect((pushed.match(/fill="var\(--note-lit\)"/g) ?? []).length)
      .toBe((centred.match(/fill="var\(--note-lit\)"/g) ?? []).length + 1);
  });

  it("follows the bindings instead of restating them", () => {
    // default: root chord on RT, so the "chord I" caption hangs off the right
    expect(textEl(draw(), "hold: chord I")).toContain('text-anchor="start"');
    setBindings({
      ...DEFAULT_BINDINGS,
      [BUTTON.LT]: "degree.1",
      [BUTTON.RT]: "voiceLeading.toggle",
    });
    expect(textEl(draw(), "hold: chord I")).toContain('text-anchor="end"');
    expect(textEl(draw(), "voice-leading")).toContain('text-anchor="start"');
    // ...and the light follows too: LT now plays I, RT no longer does
    const lit = (svg: string) =>
      (svg.match(/fill="var\(--note-lit\)" stroke="var\(--note-lit\)"/g) ?? []).length;
    expect(lit(draw({ degree: 1 }))).toBe(2); // still A + one trigger
  });

  it("redraws a rebound button's cap with whatever it now does", () => {
    // put the inversion cycle on Y and the fourth degree on the d-pad's left
    setBindings({
      ...DEFAULT_BINDINGS,
      [BUTTON.Y]: "inversion.cycle",
      [BUTTON.dpadLeft]: "degree.4",
    });
    const svg = draw({ degree: 4 });
    expect(allTextEls(svg, "inv")).toHaveLength(1); // moved to the face diamond
    expect(allTextEls(svg, "IV")).toHaveLength(2); // d-pad arm + the chord stick
    // the d-pad arm is the lit control now that it carries the sounding degree
    expect(fillOf(allTextEls(svg, "IV")[0])).toBe("#0b1020");
  });

  it("captions a stick click with whatever that click now does", () => {
    expect(textEl(draw(), "click: md◀")).toBeTruthy(); // L3, by default
    setBindings({ ...DEFAULT_BINDINGS, [BUTTON.L3]: "degree.6" });
    expect(textEl(draw(), "click: vi")).toBeTruthy();
  });

  it("says so plainly when a control is left unbound", () => {
    const { [BUTTON.LB]: _dropped, ...rest } = DEFAULT_BINDINGS;
    setBindings(rest);
    expect(textEl(draw(), "unbound")).toBeTruthy();
    expect(textEl(draw(), "octave −")).toBeUndefined();
  });

  it("moves the chord/coloration captions when the sticks swap", () => {
    setConfig({ chordStick: "left", colorStick: "right" });
    const svg = draw();
    expect(textEl(svg, "chords ii–vii°")).toContain('text-anchor="end"'); // left column
    expect(textEl(svg, "coloration")).toContain('text-anchor="start"'); // right column
  });
});
