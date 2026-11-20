import { describe, it, expect } from "vitest";
import { MIN_WHITES, clamp, isWhole, panBy, pinch, whole, zoomAt } from "./key-window";

const N = 52; // the 88's white keys

describe("clamp", () => {
  it("keeps a window on the keyboard and no narrower than an octave", () => {
    expect(clamp({ from: -3, count: 10 }, N)).toEqual({ from: 0, count: 10 });
    expect(clamp({ from: 50, count: 10 }, N)).toEqual({ from: 42, count: 10 });
    expect(clamp({ from: 20, count: 2 }, N)).toEqual({ from: 20, count: MIN_WHITES });
    expect(clamp({ from: 5, count: 80 }, N)).toEqual(whole(N));
  });

  it("lets a keyboard narrower than an octave be seen whole", () => {
    expect(clamp({ from: 0, count: 1 }, 4)).toEqual({ from: 0, count: 4 });
  });
});

describe("zoomAt", () => {
  it("keeps the key under the pointer where it is", () => {
    const w = { from: 10, count: 20 };
    const at = 0.25;
    const z = zoomAt(w, 0.5, at, N);
    expect(z.count).toBe(10);
    expect(z.from + at * z.count).toBeCloseTo(w.from + at * w.count);
  });

  it("zooms out no further than the whole keyboard", () => {
    expect(isWhole(zoomAt(whole(N), 2, 0.5, N), N)).toBe(true);
  });
});

describe("panBy", () => {
  it("moves by a fraction of the window's own width, and stops at the ends", () => {
    expect(panBy({ from: 10, count: 20 }, 0.5, N)).toEqual({ from: 20, count: 20 });
    expect(panBy({ from: 10, count: 20 }, -2, N)).toEqual({ from: 0, count: 20 });
  });
});

describe("pinch", () => {
  const start = whole(N);

  it("narrows the window as the fingers part, around the key between them", () => {
    const w = pinch(start, 0.4, 0.6, 0.3, 0.7, N);
    expect(w.count).toBeCloseTo(N / 2);
    expect(w.from + 0.5 * w.count).toBeCloseTo(N / 2); // the middle stays the middle
  });

  it("pans with the hand: fingers that move together slide the keys under them", () => {
    const zoomed = { from: 20, count: 10 };
    const w = pinch(zoomed, 0.4, 0.6, 0.2, 0.4, N);
    expect(w.count).toBeCloseTo(10);
    expect(w.from).toBeCloseTo(22); // the key at 0.5 is now at 0.3
  });

  it("ignores fingers that have met", () => {
    expect(pinch(start, 0.5, 0.5, 0.4, 0.6, N)).toBe(start);
    expect(pinch(start, 0.4, 0.6, 0.5, 0.5, N)).toBe(start);
  });
});
