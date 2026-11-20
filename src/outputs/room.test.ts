import { describe, it, expect } from "vitest";
import { impulseResponse } from "./room";

/** A repeatable random stream (mulberry32). */
const seeded = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const rms = (a: Float32Array, from: number, to: number) => {
  let s = 0;
  for (let i = from; i < to; i++) s += a[i] * a[i];
  return Math.sqrt(s / (to - from));
};

describe("the room's impulse response", () => {
  const sr = 48000;
  const [l, r] = impulseResponse(sr, seeded(1));

  it("is stereo, 8ms of silence then 1.2s of tail", () => {
    expect(l.length).toBe(Math.round(sr * 1.208));
    expect(r.length).toBe(l.length);
    expect(rms(l, 0, Math.round(sr * 0.008))).toBe(0);
  });

  it("decays about 60 dB over its length", () => {
    const start = Math.round(sr * 0.008);
    const head = rms(l, start, start + 2400);
    const tail = rms(l, l.length - 2400, l.length);
    const db = 20 * Math.log10(tail / head);
    expect(db).toBeLessThan(-50);
    expect(db).toBeGreaterThan(-70);
  });

  it("is decorrelated between the ears, for width", () => {
    let dot = 0;
    for (let i = 0; i < l.length; i++) dot += l[i] * r[i];
    const corr = dot / (rms(l, 0, l.length) * rms(r, 0, r.length) * l.length);
    expect(Math.abs(corr)).toBeLessThan(0.1);
  });
});
