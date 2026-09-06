import { describe, it, expect } from "vitest";
import { Combo, NashvilleRoll } from "./combo";
import { Nashville } from "./nashville";
import { Tonnetz } from "./tonnetz";
import { PianoRoll } from "./piano-roll";
import { Core } from "../core";

// jsdom gives no layout, so clientWidth/Height are always 0 — the views read
// them to size themselves. Stub the two properties on a real SVG element and
// let it parse the markup for us: a malformed attribute or a NaN coordinate
// shows up as a parse failure, not a silent blank stage.
function stage(w: number, h: number): SVGSVGElement {
  const el = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  Object.defineProperty(el, "clientWidth", { value: w });
  Object.defineProperty(el, "clientHeight", { value: h });
  return el;
}

const score = Core.makeScore([{ pitch: 60, onset: 0, duration: 1 }]);

// the rect a named clipPath confines its layer to
const clipSize = (el: SVGSVGElement, id: string) => {
  const rect = el.querySelector(`clipPath#${id} rect`)!;
  return { w: rect.getAttribute("width"), h: rect.getAttribute("height") };
};

// every stacked view is the same layout with a different top panel, so the
// cases below run over both instances rather than testing one twice.
const STACKS = [
  { name: "Tonnetz + roll", stack: Combo, top: (W: number, H: number) => Tonnetz.markup(W, H, score, 0.5) },
  { name: "Nashville + roll", stack: NashvilleRoll, top: (W: number, H: number) => Nashville.markup(W, H) },
] as const;

describe.each(STACKS)("$name", ({ stack, top }) => {
  it("draws both layers with no numbers out of place", () => {
    const el = stage(1400, 780);
    stack.render(el, score, 0.5);
    expect(el.getAttribute("viewBox")).toBe("0 0 1400 780");
    expect(el.innerHTML).not.toMatch(/NaN|Infinity|undefined/);
    expect(el.innerHTML).toContain("<text"); // the top panel drew something
    // the roll rides a translate down to the band it owns
    expect(el.innerHTML).toContain(`transform="translate(0,660)"`);
  });

  it("gives the roll a fixed band and the top panel the rest", () => {
    const el = stage(1400, 780);
    stack.render(el, score, 0.5);
    expect(stack.rollRegion(el)).toEqual({ x: 0, y: 660, w: 1400, h: 120 });
    // each layer is clipped to its own band, so neither spills across the seam
    expect(clipSize(el, "comboTop")).toEqual({ w: "1400", h: "660" });
    expect(clipSize(el, "comboRoll")).toEqual({ w: "1400", h: "120" });
  });

  it("caps the roll at half the stage on a short viewport", () => {
    const el = stage(1400, 200);
    stack.render(el, score, 0.5);
    expect(stack.rollRegion(el)).toEqual({ x: 0, y: 100, w: 1400, h: 100 });
  });

  it("hands the top panel exactly the band above the roll", () => {
    const el = stage(1400, 780);
    stack.render(el, score, 0.5);
    // the stack composes; it never redraws. What the panel would draw on its
    // own at 1400x660 is what lands in the top layer. (Compared through the
    // DOM: jsdom re-serializes markup, so the raw strings differ in form.)
    const reference = stage(1400, 660);
    reference.innerHTML = top(1400, 660);
    expect(el.querySelector("g[clip-path='url(#comboTop)']")!.innerHTML)
      .toBe(reference.innerHTML);
  });

  it("hit-tests the keyboard in the band, not the top panel", () => {
    const el = stage(1400, 780);
    stack.render(el, score, 0.5);
    const region = stack.rollRegion(el);
    // jsdom's getBoundingClientRect is all zeros, so client space == svg space.
    // The keyboard is the bottom ~96px of the roll's own 120px band.
    expect(PianoRoll.pitchAt(el, 10, 770, region)).not.toBeNull();
    expect(PianoRoll.pitchAt(el, 10, 300, region)).toBeNull(); // up in the top panel
  });
});

it("keeps its glow filter — both layers reference url(#glow)", () => {
  const el = stage(1400, 780);
  NashvilleRoll.render(el, score, 0.5);
  expect(el.querySelector("filter#glow")).not.toBeNull();
});

it("draws nothing into an unsized svg", () => {
  const el = stage(0, 0);
  NashvilleRoll.render(el, score, 0.5);
  expect(el.innerHTML).toBe("");
});
