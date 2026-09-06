import { describe, it, expect, vi, afterEach } from "vitest";
import { makeClock } from "./clock";

afterEach(() => vi.restoreAllMocks());

describe("makeClock", () => {
  it("starts at zero and reports not playing", () => {
    const clock = makeClock(() => 10);
    expect(clock.now()).toBe(0);
    expect(clock.isPlaying()).toBe(false);
  });

  it("seek sets the time and clamps to [0, duration]", () => {
    const clock = makeClock(() => 10);
    clock.seek(5);
    expect(clock.now()).toBe(5);
    clock.seek(-3);
    expect(clock.now()).toBe(0); // clamp low
    clock.seek(20);
    expect(clock.now()).toBe(10); // clamp to duration
  });

  it("play/pause toggles the flag", () => {
    const clock = makeClock(() => 10);
    expect(clock.isPlaying()).toBe(false);
    clock.play();
    expect(clock.isPlaying()).toBe(true);
    clock.pause();
    expect(clock.isPlaying()).toBe(false);
  });

  it("advances now() by wall-clock elapsed while playing, and freezes on pause", () => {
    let ms = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => ms);
    const clock = makeClock(() => 10);

    clock.seek(0);
    clock.play(); // startedAt = 1000
    ms = 1500; // +500ms
    expect(clock.now()).toBeCloseTo(0.5, 6);

    clock.pause(); // base frozen at 0.5
    ms = 3000;
    expect(clock.now()).toBeCloseTo(0.5, 6); // paused: time does not move
  });

  it("advances score time at the set rate", () => {
    let ms = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => ms);
    const clock = makeClock(() => 10);

    expect(clock.rate()).toBe(1);
    clock.setRate(0.5);
    clock.play();
    ms = 2000; // 1s of wall time...
    expect(clock.now()).toBeCloseTo(0.5, 6); // ...is half a second of score
  });

  it("banks elapsed time at the old rate when the rate changes mid-play", () => {
    let ms = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => ms);
    const clock = makeClock(() => 10);

    clock.play();
    ms = 3000; // 2s at 1x
    clock.setRate(0.25); // playhead must not move at the instant of the change
    expect(clock.now()).toBeCloseTo(2, 6);
    ms = 5000; // +2s wall at 0.25x = +0.5s score
    expect(clock.now()).toBeCloseTo(2.5, 6);
  });

  it("clamps the rate to a sane range", () => {
    const clock = makeClock(() => 10);
    clock.setRate(0);
    expect(clock.rate()).toBeGreaterThan(0);
    clock.setRate(1000);
    expect(clock.rate()).toBe(4);
  });

  it("restarts from the top if play() is hit at/after the end", () => {
    let ms = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => ms);
    const clock = makeClock(() => 10);
    clock.seek(10); // sitting at the end
    clock.play(); // now() >= duration -> base reset to 0
    expect(clock.now()).toBeCloseTo(0, 6);
  });
});
