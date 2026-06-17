import { describe, it, expect } from "vitest";
import { pitchClassAt, triadName, neoTransform } from "./tonnetz";

describe("tonnetz lattice", () => {
  it("places C at the origin, fifths east, major thirds up", () => {
    expect(pitchClassAt(0, 0)).toBe(0); // C
    expect(pitchClassAt(1, 0)).toBe(7); // east  = +perfect fifth → G
    expect(pitchClassAt(0, 1)).toBe(4); // up    = +major third  → E
  });

  it("the up-left edge is a minor third (fifth − major third)", () => {
    // moving east then up-left (col-1,row+1) returns a +3 from origin
    expect((pitchClassAt(-1, 1) - pitchClassAt(0, 0) + 12) % 12).toBe(9); // -3 ≡ 9
  });

  it("an up-triangle is a major triad, a down-triangle a minor triad", () => {
    // up-triangle at origin: A(0,0)=C, B(1,0)=G, C(0,1)=E → {C,E,G} major
    const up = [pitchClassAt(0, 0), pitchClassAt(1, 0), pitchClassAt(0, 1)].sort((a, b) => a - b);
    expect(up).toEqual([0, 4, 7]); // C E G
    // down-triangle B(1,0)=G, C(0,1)=E, D(1,1)=B → root E → {E,G,B} E minor
    const down = [pitchClassAt(1, 0), pitchClassAt(0, 1), pitchClassAt(1, 1)].sort((a, b) => a - b);
    expect(down).toEqual([4, 7, 11]); // E G B
  });
});

describe("triadName", () => {
  it("names major and minor triads", () => {
    expect(triadName(0, "maj")).toBe("C");
    expect(triadName(4, "min")).toBe("Em");
    expect(triadName(-3, "maj")).toBe("A"); // wraps
  });
});

describe("neoTransform", () => {
  it("P crosses the root–fifth edge for either quality", () => {
    expect(neoTransform("root", "fifth", "maj")).toBe("P");
    expect(neoTransform("fifth", "root", "min")).toBe("P");
  });

  it("R/L swap between major and minor across the other two edges", () => {
    // major: relative across root–third, leading-tone across third–fifth
    expect(neoTransform("root", "third", "maj")).toBe("R");
    expect(neoTransform("third", "fifth", "maj")).toBe("L");
    // minor: the two swap
    expect(neoTransform("root", "third", "min")).toBe("L");
    expect(neoTransform("third", "fifth", "min")).toBe("R");
  });
});
