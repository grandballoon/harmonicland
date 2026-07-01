import { describe, it, expect } from "vitest";
import { stickDirection } from "./gamepad-perfecto";

describe("stickDirection — analog vector to one of the 9 joystick zones", () => {
  it("is center inside the deadzone", () => {
    expect(stickDirection(0, 0)).toBe("center");
    expect(stickDirection(0.3, -0.3)).toBe("center"); // |v| ≈ 0.42 < 0.5
  });

  it("maps the cardinals (screen y points down, so +y is 'down')", () => {
    expect(stickDirection(1, 0)).toBe("right");
    expect(stickDirection(-1, 0)).toBe("left");
    expect(stickDirection(0, 1)).toBe("down");
    expect(stickDirection(0, -1)).toBe("up");
  });

  it("maps the diagonals", () => {
    expect(stickDirection(0.8, -0.8)).toBe("upRight");
    expect(stickDirection(-0.8, -0.8)).toBe("upLeft");
    expect(stickDirection(0.8, 0.8)).toBe("downRight");
    expect(stickDirection(-0.8, 0.8)).toBe("downLeft");
  });

  it("snaps near-cardinal angles to the nearest sector", () => {
    expect(stickDirection(1, 0.1)).toBe("right"); // a hair below pure east
    expect(stickDirection(0.1, 1)).toBe("down");
  });
});
