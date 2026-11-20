import { describe, it, expect, vi } from "vitest";
import type { Output } from "../types";

/* A recording Output, one per device. */
const recorder = (name: string, log: string[], latency = 0): Output => ({
  strike: (s) => void log.push(`${name} strike ${s.pitch}`),
  advance: () => {},
  pedal: () => {},
  flush: () => void log.push(`${name} flush`),
  latency: () => latency,
  liveOn: (p, v) => void log.push(`${name} on ${p}@${v}`),
  liveOff: (p) => void log.push(`${name} off ${p}`),
  detach: () => void log.push(`${name} detach`),
});
const log = vi.hoisted(() => [] as string[]);
vi.mock("./audio", () => ({ AudioOut: recorder("piano", log, 0.02) }));

const { Sound } = await import("./sound");

describe("Sound", () => {
  it("starts on the built-in piano, and forwards to it", () => {
    Sound.strike({ pitch: 60, velocity: 80, at: 0 });
    expect(log).toEqual(["piano strike 60"]);
  });

  it("adds the user's offset to the device's latency", () => {
    Sound.setOffset(0.1);
    expect(Sound.latency()).toBeCloseTo(0.12, 9);
    Sound.setOffset(0);
  });

  it("sounds a live key once however often it is asked", () => {
    log.length = 0;
    Sound.liveOn(62, 90);
    Sound.liveOn(62, 90);
    Sound.liveOff(62);
    Sound.liveOff(62);
    expect(log).toEqual(["piano on 62@90", "piano off 62"]);
  });

  it("switching hands the held keys to the new output and detaches the old", () => {
    const synth = recorder("synth", log);
    Sound.liveOn(64, 70);
    log.length = 0;
    Sound.use(synth);
    expect(log).toEqual(["piano off 64", "piano detach", "synth on 64@70"]);
    expect(Sound.current()).toBe(synth);
    log.length = 0;
    Sound.use(synth); // already in use: nothing happens
    Sound.strike({ pitch: 67, velocity: 80, at: 0 });
    expect(log).toEqual(["synth strike 67"]);
  });
});
