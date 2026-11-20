import { describe, it, expect } from "vitest";
import { fromPercent, makeDynamics } from "./dynamics";

describe("dynamics", () => {
  it("leaves notes before any level without a velocity", () => {
    const d = makeDynamics();
    d.mark("p", 2);
    expect(d.velocityAt(1)).toBeUndefined();
    expect(d.velocityAt(2)).toBe(49);
    expect(d.velocityAt(9)).toBe(49);
  });

  it("holds a level until the next, whatever order they were marked in", () => {
    const d = makeDynamics();
    d.mark("ff", 4); // a right hand parsed first...
    d.mark("pp", 0); // ...then the left, from the top
    expect(d.velocityAt(1)).toBe(33);
    expect(d.velocityAt(5)).toBe(112);
  });

  it("lifts only the notes where an accent stands", () => {
    const d = makeDynamics();
    d.mark("p", 0);
    d.mark("sfz", 1);
    expect(d.velocityAt(1)).toBe(96); // p + lift, floored at forte
    expect(d.velocityAt(1.5)).toBe(49);
  });

  it("strikes an fp forte, then holds piano", () => {
    const d = makeDynamics();
    d.mark("ff", 0);
    d.mark("fp", 1);
    expect(d.velocityAt(1)).toBe(127);
    expect(d.velocityAt(2)).toBe(49);
  });

  it("ignores words that are not dynamics", () => {
    const d = makeDynamics();
    expect(d.mark("sustainOn", 0)).toBe(false);
    expect(d.mark("MF", 0)).toBe(true);
    expect(d.velocityAt(0)).toBe(80);
  });

  it("reads MusicXML's percentages of forte", () => {
    expect(fromPercent(100)).toBe(90);
    expect(fromPercent(50)).toBe(45);
    expect(fromPercent(500)).toBe(127);
    expect(fromPercent(0)).toBe(1);
  });
});
