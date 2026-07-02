import { describe, it, expect } from "vitest";
import { stickDirection, chordStickDegree } from "./gamepad-perfecto";

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

describe("chordStickDegree — Nashville chord-stick layout", () => {
  // Degrees ii..vii° placed clockwise from ↗, skipping ↑ and ↓:
  //   ↗ ii (2) → iii (3) ↘ IV (4) ↙ V (5) ← vi (6) ↖ vii° (7)
  it("returns null in dead zones (center, up, down)", () => {
    expect(chordStickDegree(0, 0)).toBeNull();    // center
    expect(chordStickDegree(0, -1)).toBeNull();   // up
    expect(chordStickDegree(0, 1)).toBeNull();    // down
  });

  it("maps the six live directions to degrees 2–7 clockwise from ↗", () => {
    expect(chordStickDegree(0.8, -0.8)).toBe(2);  // ↗  ii
    expect(chordStickDegree(1, 0)).toBe(3);        // →  iii
    expect(chordStickDegree(0.8, 0.8)).toBe(4);   // ↘  IV
    expect(chordStickDegree(-0.8, 0.8)).toBe(5);  // ↙  V
    expect(chordStickDegree(-1, 0)).toBe(6);       // ←  vi
    expect(chordStickDegree(-0.8, -0.8)).toBe(7); // ↖  vii°
  });

  it("is insensitive to magnitude as long as past the deadzone", () => {
    expect(chordStickDegree(0.6, -0.6)).toBe(2);  // ↗  at lower amplitude
    expect(chordStickDegree(0.99, 0.01)).toBe(3); // → nearly pure east
  });
});

describe("chord-stick clockwise rotation — ↑/↓ are transparent pass-throughs", () => {
  // The clockwise path from ↘ (IV) to ↙ (V) passes through ↓ (dead direction).
  // Previously this caused a momentary release before ↙ reactivated. Verified
  // here at the chordStickDegree level: ↑ and ↓ return null, meaning handleChordStick
  // skips them — the release only fires when the stick returns to center.
  it("↓ is null so the handler skips it (no gap between IV and V)", () => {
    expect(chordStickDegree(0, 1)).toBeNull(); // ↓ — should not release
    expect(chordStickDegree(0.8, 0.8)).toBe(4);  // ↘ IV still accessible
    expect(chordStickDegree(-0.8, 0.8)).toBe(5); // ↙ V still accessible
  });

  it("↑ is null so the path from vii° (↖) to ii (↗) is also gap-free", () => {
    expect(chordStickDegree(0, -1)).toBeNull();   // ↑ — should not release
    expect(chordStickDegree(-0.8, -0.8)).toBe(7); // ↖ vii° still accessible
    expect(chordStickDegree(0.8, -0.8)).toBe(2);  // ↗ ii  still accessible
  });
});
