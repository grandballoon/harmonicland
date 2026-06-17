import { describe, it, expect } from "vitest";
import { pressedButtons, diff } from "./live-gamepad";

// minimal Gamepad stand-in: only .buttons[].pressed is read by pressedButtons
const pad = (...pressed: boolean[]): Gamepad =>
  ({ buttons: pressed.map((p) => ({ pressed: p, value: p ? 1 : 0 })) }) as unknown as Gamepad;

describe("live-gamepad pressedButtons", () => {
  it("collects the indices whose .pressed is true", () => {
    expect(pressedButtons(pad(true, false, true))).toEqual(new Set([0, 2]));
  });

  it("returns an empty set when nothing is held", () => {
    expect(pressedButtons(pad(false, false))).toEqual(new Set());
  });
});

describe("live-gamepad diff", () => {
  it("emits a down for a newly-pressed button", () => {
    expect(diff(new Set(), new Set([0]))).toEqual([{ kind: "down", index: 0 }]);
  });

  it("emits an up for a released button", () => {
    expect(diff(new Set([3]), new Set())).toEqual([{ kind: "up", index: 3 }]);
  });

  it("emits nothing for a button held across frames", () => {
    expect(diff(new Set([1]), new Set([1]))).toEqual([]);
  });

  it("handles simultaneous press and release in one frame", () => {
    const events = diff(new Set([0]), new Set([1]));
    expect(events).toContainEqual({ kind: "down", index: 1 });
    expect(events).toContainEqual({ kind: "up", index: 0 });
    expect(events).toHaveLength(2);
  });
});
