/* Keyboard: one geometry, drawn and hit-tested. The cases that matter are
   the ones where the two halves could drift apart — every key on the board
   must hit-test back to itself, at every band height a view uses. */
import { describe, it, expect } from "vitest";
import { HIGH, LOW, KEYB, isC, isWhite, keysMarkup, layout, pitchAt } from "./keyboard";

// jsdom has no layout, so an svg's client size and bounding rect are both
// zero; stub them so the module sees a real stage.
function stage(w: number, h: number): SVGSVGElement {
  const el = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  Object.defineProperty(el, "clientWidth", { value: w });
  Object.defineProperty(el, "clientHeight", { value: h });
  el.getBoundingClientRect = () => ({ left: 0, top: 0, width: w, height: h }) as DOMRect;
  return el;
}

describe("layout", () => {
  it("lays 52 white keys edge to edge across the full width", () => {
    const L = layout(1040, 600);
    expect(L.whites).toHaveLength(52);
    expect(L.whites[0]).toBe(LOW);
    expect(L.whites[L.whites.length - 1]).toBe(HIGH);
    expect(L.ww).toBe(20);
    // no gaps and no overlap: each lane starts where the last one ended
    for (let i = 1; i < L.whites.length; i++) {
      const prev = L.lane(L.whites[i - 1]);
      expect(L.lane(L.whites[i]).x).toBeCloseTo(prev.x + prev.w);
    }
  });

  it("straddles each black key over the boundary of the white below it", () => {
    const L = layout(1040, 600);
    const cSharp4 = L.lane(61); // C#4 sits on the C4/D4 seam
    const c4 = L.lane(60);
    expect(cSharp4.x + cSharp4.w / 2).toBeCloseTo(c4.x + c4.w);
    expect(cSharp4.w).toBeLessThan(c4.w);
  });

  it("puts the band at the bottom of the region, at the height asked for", () => {
    expect(layout(1040, 600).topY).toBe(600 - KEYB);
    expect(layout(1040, 600, 240).topY).toBe(360);
    // a band that IS the region starts at its top — the shape the Hands
    // view hands to pitchAt
    expect(layout(1040, 240, 240).topY).toBe(0);
  });
});

describe("pitchAt", () => {
  // the invariant the whole module exists for: draw a key, click its
  // middle, get that key back. Anything else means the two halves drifted.
  it.each([KEYB, 200, 260])("round-trips every one of the 88 keys (band %i)", (keybH) => {
    const el = stage(1200, 700);
    const region = { x: 0, y: 700 - keybH, w: 1200, h: keybH };
    const L = layout(region.w, region.h, keybH);
    for (let p = LOW; p <= HIGH; p++) {
      const { x, w } = L.lane(p);
      // a white key is only itself BELOW the black band, where nothing
      // overlaps it; a black key anywhere in its own upper band
      const y = region.y + (isWhite(p) ? L.blackH + (L.keybH - L.blackH) / 2 : L.blackH / 2);
      expect(pitchAt(el, x + w / 2, y, region, keybH)).toBe(p);
    }
  });

  it("refuses points above the keys and below the board", () => {
    const el = stage(1200, 700);
    expect(pitchAt(el, 600, 10)).toBeNull(); // up where the notes fall
    expect(pitchAt(el, 600, 720)).toBeNull(); // off the bottom
    expect(pitchAt(el, 600, 700 - KEYB + 4)).not.toBeNull();
  });

  it("reads a region's own origin, not the svg's", () => {
    const el = stage(1200, 700);
    const region = { x: 0, y: 200, w: 1200, h: 300 }; // keys at 404..500
    // the same point means different things in the two frames, and each
    // frame refuses the other's keyboard
    expect(pitchAt(el, 600, 450, region)).not.toBeNull();
    expect(pitchAt(el, 600, 450)).toBeNull();
    expect(pitchAt(el, 600, 650, region)).toBeNull();
    expect(pitchAt(el, 600, 650)).not.toBeNull();
  });
});

describe("keysMarkup", () => {
  const L = layout(1040, 600);

  it("draws all 88 keys and labels every C", () => {
    const out = keysMarkup(L);
    expect(out.match(/<rect/g)).toHaveLength(88);
    // A0..C8 spans C1 through C8
    expect(out.match(/>C\d</g)).toEqual(
      ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8"].map((c) => `>${c}<`),
    );
    expect(out).not.toMatch(/NaN|Infinity|undefined/);
  });

  it("paints only the keys the caller claims, and leaves the rest resting", () => {
    const out = keysMarkup(L, (p) => (p === 60 ? { fill: "red", glow: true } : null));
    expect(out).toContain(`fill="red"`);
    expect(out.match(/url\(#glow\)/g)).toHaveLength(1);
    expect(out).toContain(`fill="var(--key-white)"`);
    expect(out).toContain(`fill="var(--key-black)"`);
  });

  it("holds a key label back until the band is tall enough to read it", () => {
    const paint = (p: number) => (p === 60 ? { fill: "red", label: "3" } : null);
    expect(keysMarkup(layout(1040, 600, 40), paint)).not.toContain(">3<");
    expect(keysMarkup(layout(1040, 600, 200), paint)).toContain(">3<");
  });
});

describe("isC / isWhite", () => {
  it("agree with the keyboard everyone can see", () => {
    expect(isC(60)).toBe(true);
    expect(isC(72)).toBe(true);
    expect(isC(61)).toBe(false);
    expect([60, 62, 64, 65, 67, 69, 71].every(isWhite)).toBe(true);
    expect([61, 63, 66, 68, 70].some(isWhite)).toBe(false);
  });
});
