import { describe, it, expect } from "vitest";
import { samplePitchFor, sampleName } from "./audio";

/* The sampled piano's pure math: 30 samples every minor third A0..C8;
   every playable pitch maps to a sample at most one semitone away. */
describe("AudioOut sample map", () => {
  it("pitches that ARE samples map to themselves", () => {
    for (const p of [21, 24, 27, 30, 60, 108]) expect(samplePitchFor(p)).toBe(p);
  });

  it("in-between pitches round to the nearest sample (never more than 1 semitone off)", () => {
    expect(samplePitchFor(61)).toBe(60); // C#4 -> C4 sample, shifted up
    expect(samplePitchFor(62)).toBe(63); // D4  -> D#4 sample, shifted down
    for (let p = 21; p <= 108; p++) expect(Math.abs(samplePitchFor(p) - p)).toBeLessThanOrEqual(1);
  });

  it("clamps to the sampled range at the extremes", () => {
    expect(samplePitchFor(0)).toBe(21); // below A0
    expect(samplePitchFor(127)).toBe(108); // above C8
  });

  it("names sample files the way the Salamander set does", () => {
    expect(sampleName(21)).toBe("A0");
    expect(sampleName(24)).toBe("C1");
    expect(sampleName(27)).toBe("Ds1");
    expect(sampleName(30)).toBe("Fs1");
    expect(sampleName(60)).toBe("C4");
    expect(sampleName(108)).toBe("C8");
  });
});
