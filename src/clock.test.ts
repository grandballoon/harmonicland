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

  it("restarts from the top if play() is hit at/after the end", () => {
    let ms = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => ms);
    const clock = makeClock(() => 10);
    clock.seek(10); // sitting at the end
    clock.play(); // now() >= duration -> base reset to 0
    expect(clock.now()).toBeCloseTo(0, 6);
  });
});

/* The loop is honoured inside now(), so it is observable with nothing but a
   mocked performance.now() — no frames needed. */
describe("Clock loop", () => {
  let ms = 0;
  const at = (sec: number) => { ms = sec * 1000; };
  const setup = () => {
    ms = 0;
    vi.spyOn(performance, "now").mockImplementation(() => ms);
    return makeClock(() => 10);
  };

  it("comes back round to the start when time reaches the end", () => {
    const clock = setup();
    clock.setLoop({ start: 2, end: 4 });
    clock.seek(2);
    clock.play();
    at(1.5);
    expect(clock.now()).toBeCloseTo(3.5, 6);
    at(2.5); // 4.5 unlooped
    expect(clock.now()).toBeCloseTo(2.5, 6);
    at(6.25); // many laps later
    expect(clock.now()).toBeCloseTo(2.25, 6);
  });

  it("play() from outside the loop enters it at the start", () => {
    const clock = setup();
    clock.setLoop({ start: 2, end: 4 });
    clock.seek(7);
    clock.play();
    expect(clock.now()).toBe(2);
  });

  it("play() from inside the loop continues from where the playhead is", () => {
    const clock = setup();
    clock.setLoop({ start: 2, end: 4 });
    clock.seek(3);
    clock.play();
    expect(clock.now()).toBe(3);
  });

  it("pause() keeps the wrapped time, not the time the loop threw away", () => {
    const clock = setup();
    clock.setLoop({ start: 2, end: 4 });
    clock.seek(3);
    clock.play();
    at(1.5); // 4.5 -> 2.5
    clock.pause();
    at(9);
    expect(clock.now()).toBeCloseTo(2.5, 6);
  });

  it("a seek past the end while playing escapes the loop instead of folding back", () => {
    const clock = setup();
    clock.setLoop({ start: 2, end: 4 });
    clock.seek(3);
    clock.play();
    clock.seek(6);
    at(1);
    expect(clock.now()).toBeCloseTo(7, 6);
  });

  it("a seek before the start while playing plays into the loop, then loops", () => {
    const clock = setup();
    clock.setLoop({ start: 2, end: 4 });
    clock.seek(3);
    clock.play();
    clock.seek(1);
    at(2); // 3
    expect(clock.now()).toBeCloseTo(3, 6);
    at(3.5); // 4.5 -> 2.5
    expect(clock.now()).toBeCloseTo(2.5, 6);
  });

  it("clamps the loop to the piece, and drops one with nothing left", () => {
    const clock = setup();
    clock.setLoop({ start: -1, end: 20 });
    expect(clock.loop()).toEqual({ start: 0, end: 10 });
    clock.setLoop({ start: 5, end: 5 });
    expect(clock.loop()).toBeNull();
    clock.setLoop({ start: 11, end: 12 });
    expect(clock.loop()).toBeNull();
  });

  it("a loop ending at the piece's end loops instead of pausing there", () => {
    const frames: (() => void)[] = [];
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((fn) => {
      frames.push(() => fn(0));
      return frames.length;
    });
    const clock = setup();
    clock.setLoop({ start: 8, end: 10 });
    clock.play();
    at(2.5); // 10.5 -> 8.5
    for (const f of frames.splice(0)) f();
    expect(clock.isPlaying()).toBe(true);
    expect(clock.now()).toBeCloseTo(8.5, 6);
    clock.stop();
  });

  it("changing the loop mid-play keeps the lap already taken, and enters the new loop", () => {
    const clock = setup();
    clock.setLoop({ start: 2, end: 4 });
    clock.seek(3);
    clock.play();
    at(1.5); // 2.5
    clock.setLoop({ start: 2, end: 6 });
    at(2.5); // one more second from 2.5
    expect(clock.now()).toBeCloseTo(3.5, 6);
    clock.setLoop({ start: 7, end: 8 }); // playhead is outside it
    expect(clock.now()).toBe(7);
  });

  it("clearing the loop lets time run on past its old end", () => {
    const clock = setup();
    clock.setLoop({ start: 2, end: 4 });
    clock.seek(3);
    clock.play();
    clock.setLoop(null);
    at(2);
    expect(clock.now()).toBeCloseTo(5, 6);
  });
});

/* Finding 14: the clock claimed "exactly one timer in this whole program"
   while live-gamepad ran a second, independent rAF — because onFrame had no
   unsubscribe and tick no stop, so anything needing a per-frame callback had
   to start its own loop. Both operations now exist, and the gamepad shares
   this one. */
describe("Clock frame lifecycle", () => {
  // drive rAF by hand so the loop is observable without real frames
  const frames: (() => void)[] = [];
  const install = () =>
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((fn) => {
      frames.push(() => fn(0));
      return frames.length;
    });
  const advance = () => {
    const due = frames.splice(0, frames.length);
    for (const f of due) f();
  };

  afterEach(() => { frames.length = 0; });

  it("drives every subscriber off one loop", () => {
    install();
    const clock = makeClock(() => 10);
    const a = vi.fn();
    const b = vi.fn();
    clock.onFrame(a);
    clock.onFrame(b);
    advance();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    clock.stop();
  });

  it("onFrame returns an unsubscribe that actually detaches", () => {
    install();
    const clock = makeClock(() => 10);
    const fn = vi.fn();
    const off = clock.onFrame(fn);
    advance();
    expect(fn).toHaveBeenCalledTimes(1);
    off();
    advance();
    expect(fn).toHaveBeenCalledTimes(1); // no further ticks
    clock.stop();
  });

  it("tolerates a subscriber unsubscribing from inside its own callback", () => {
    install();
    const clock = makeClock(() => 10);
    const other = vi.fn();
    const off = clock.onFrame(() => off());
    clock.onFrame(other);
    expect(() => advance()).not.toThrow();
    expect(other).toHaveBeenCalledTimes(1);
    clock.stop();
  });

  it("stop() cancels the loop and drops the subscribers", () => {
    install();
    const cancel = vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});
    const clock = makeClock(() => 10);
    const fn = vi.fn();
    clock.onFrame(fn);
    clock.stop();
    expect(cancel).toHaveBeenCalled();
    advance();
    expect(fn).not.toHaveBeenCalled();
  });
});
