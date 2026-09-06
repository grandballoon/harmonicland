import { describe, it, expect, afterEach, vi } from "vitest";
import {
  BUTTON,
  DEFAULT_BINDINGS,
  chordStickDegree,
  controlMap,
  getBindings,
  isActionId,
  perfectoMapping,
  setBindings,
  stickDirection,
} from "./gamepad-perfecto";
import { PerfState, DEFAULT_OCTAVE, MIN_OCTAVE, MAX_OCTAVE } from "./perf-state";
import { BASE_DIRECTION } from "./harmony/perfecto";

// The mapping unlocks the AudioContext on a bound press; jsdom has no
// WebAudio, and these tests are about dispatch, not sound.
vi.mock("./outputs/audio", () => ({
  ensure: () => {},
  AudioOut: {
    ensure: () => {}, liveOn: () => {}, liveOff: () => {},
    at: () => {}, silence: () => {}, setMuted: () => {},
  },
}));

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

// ---------- the coloration ring: Base at the bottom, empty hub ----------
// Default config: the LEFT stick colors, so axes [0, 1] drive it.
const colorStick = (x: number, y: number): void =>
  perfectoMapping.onFrame({ downs: [], ups: [], held: new Set(), axes: [x, y, 0, 0] });

describe("coloration stick — the hub selects nothing", () => {
  afterEach(() => {
    perfectoMapping.reset();
    PerfState.setDirection(BASE_DIRECTION); // back to the resting selection
  });

  it("takes a color from any ring zone, Base included", () => {
    colorStick(-1, 0);
    expect(PerfState.snapshot().joystickDirection).toBe("left");
    colorStick(0, 1); // ↓ — Base now lives on the ring
    expect(PerfState.snapshot().joystickDirection).toBe("down");
  });

  it("HOLDS the color across the middle, so any color reaches any other", () => {
    colorStick(-1, 0);            // ← dark
    colorStick(0, 0);             // sweeping through the hub…
    expect(PerfState.snapshot().joystickDirection).toBe("left"); // …changes nothing
    colorStick(1, 0);             // → and lands on the next color
    expect(PerfState.snapshot().joystickDirection).toBe("right");
    colorStick(0, 0);             // letting go keeps it, too
    expect(PerfState.snapshot().joystickDirection).toBe("right");
  });
});

// ---------- bindings: any button, any function ----------
// A frame with the sticks at rest, so only the button edges under test act.
const press = (...downs: number[]): void =>
  perfectoMapping.onFrame({ downs, ups: [], held: new Set(downs), axes: [0, 0, 0, 0] });
const release = (...ups: number[]): void =>
  perfectoMapping.onFrame({ downs: [], ups, held: new Set(), axes: [0, 0, 0, 0] });

afterEach(() => {
  setBindings(DEFAULT_BINDINGS); // also releases anything held
  PerfState.resetOctave(); // PerfState is module state: leave the register home
});

describe("button bindings — the table IS the mapping", () => {
  it("plays the chord the default table puts under a button", () => {
    press(BUTTON.B);
    expect(PerfState.snapshot().degree).toBe(2);
    expect(PerfState.isSounding()).toBe(true);
    release(BUTTON.B);
    expect(PerfState.isSounding()).toBe(false);
  });

  it("dispatches a rebound button to its new action instead of its old one", () => {
    setBindings({ ...DEFAULT_BINDINGS, [BUTTON.B]: "degree.5" });
    press(BUTTON.B);
    expect(PerfState.snapshot().degree).toBe(5);
    release(BUTTON.B);
  });

  it("lets a shaping action move onto a face button", () => {
    setBindings({ ...DEFAULT_BINDINGS, [BUTTON.A]: "inversion.cycle" });
    const before = PerfState.snapshot().inversion;
    press(BUTTON.A);
    expect(PerfState.snapshot().inversion).not.toBe(before);
    expect(PerfState.isSounding()).toBe(false); // A no longer plays a chord
  });

  it("lets a chord move onto a button that used to shape one", () => {
    setBindings({ ...DEFAULT_BINDINGS, [BUTTON.LB]: "degree.7" });
    const octave = PerfState.snapshot().octave;
    press(BUTTON.LB);
    expect(PerfState.snapshot().degree).toBe(7);
    expect(PerfState.snapshot().octave).toBe(octave); // no longer nudges the octave
    release(BUTTON.LB);
  });

  it("does nothing at all for an unbound button", () => {
    const { [BUTTON.A]: _dropped, ...rest } = DEFAULT_BINDINGS;
    setBindings(rest);
    const before = PerfState.snapshot();
    press(BUTTON.A);
    release(BUTTON.A);
    expect(PerfState.snapshot()).toEqual(before);
  });

  it("keeps two buttons on the same degree independent (release-safe)", () => {
    // A and RT both play I by default: letting go of one must not cut the other
    press(BUTTON.A);
    press(BUTTON.RT);
    release(BUTTON.A);
    expect(PerfState.isSounding()).toBe(true);
    release(BUTTON.RT);
    expect(PerfState.isSounding()).toBe(false);
  });

  it("never leaves a chord sounding across a re-bind", () => {
    press(BUTTON.A);
    expect(PerfState.isSounding()).toBe(true);
    setBindings({ ...DEFAULT_BINDINGS, [BUTTON.A]: "octave.up" });
    expect(PerfState.isSounding()).toBe(false);
  });

  // The bug this pins: octave used to sit on L3/R3 — the clicks of the two
  // sticks a player shoves on every chord — so a session of playing walked the
  // instrument up an octave at a time and never walked it back.
  it("keeps the octave off the stick clicks, which only cycle the mode", () => {
    const before = PerfState.snapshot().octave;
    for (let i = 0; i < 20; i++) { press(BUTTON.R3); release(BUTTON.R3); }
    expect(PerfState.snapshot().octave).toBe(before);
    expect(getBindings()[BUTTON.L3]).toBe("mode.prev");
    expect(getBindings()[BUTTON.R3]).toBe("mode.next");
  });

  it("nudges the octave from the shoulders, and never past the playable range", () => {
    press(BUTTON.RB); release(BUTTON.RB);
    expect(PerfState.snapshot().octave).toBe(5);
    for (let i = 0; i < 20; i++) { press(BUTTON.RB); release(BUTTON.RB); }
    expect(PerfState.snapshot().octave).toBe(MAX_OCTAVE); // clamped, not runaway
    for (let i = 0; i < 20; i++) { press(BUTTON.LB); release(BUTTON.LB); }
    expect(PerfState.snapshot().octave).toBe(MIN_OCTAVE);
  });

  it("has a way home from wherever the octave ended up", () => {
    setBindings({ ...DEFAULT_BINDINGS, [BUTTON.Y]: "octave.home" });
    press(BUTTON.RB); release(BUTTON.RB);
    press(BUTTON.RB); release(BUTTON.RB);
    expect(PerfState.snapshot().octave).not.toBe(DEFAULT_OCTAVE);
    press(BUTTON.Y); release(BUTTON.Y);
    expect(PerfState.snapshot().octave).toBe(DEFAULT_OCTAVE);
  });

  it("reports the live table, and only recognizes catalog actions", () => {
    setBindings({ ...DEFAULT_BINDINGS, [BUTTON.Y]: "octave.down" });
    expect(getBindings()[BUTTON.Y]).toBe("octave.down");
    expect(controlMap().buttons[BUTTON.Y].caption).toBe("octave −");
    expect(controlMap().buttons[BUTTON.Y].degree).toBeNull();
    expect(controlMap().buttons[BUTTON.B].degree).toBe(2);
    expect(isActionId("degree.3")).toBe(true);
    expect(isActionId("degree.9")).toBe(false);
    expect(isActionId("toString")).toBe(false); // not an inherited property either
  });
});

// ---------- sustain: the hold, latched ----------
describe("sustain actions — press on, press off", () => {
  afterEach(() => {
    PerfState.setDirection(BASE_DIRECTION); // the colored tests move it
  });

  it("keeps the chord after the button comes up, and drops it on the next press", () => {
    setBindings({ ...DEFAULT_BINDINGS, [BUTTON.Y]: "sustain.1" });
    press(BUTTON.Y);
    release(BUTTON.Y); // the release edge is deliberately inert
    expect(PerfState.isSounding()).toBe(true);
    expect(PerfState.snapshot().degree).toBe(1);
    press(BUTTON.Y);
    expect(PerfState.isSounding()).toBe(false);
    release(BUTTON.Y);
    expect(PerfState.isSounding()).toBe(false); // and stays off
  });

  it("plays the same chord the matching hold would", () => {
    setBindings({ ...DEFAULT_BINDINGS, [BUTTON.Y]: "sustain.6" });
    press(BUTTON.Y); release(BUTTON.Y);
    const latched = PerfState.snapshot().sounding;
    press(BUTTON.Y); release(BUTTON.Y); // let it go, then hold vi the old way
    press(BUTTON.dpadRight); // vi, by default
    expect(PerfState.snapshot().sounding).toEqual(latched);
    release(BUTTON.dpadRight);
  });

  it("goes on morphing under the coloration stick, like any held chord", () => {
    setBindings({ ...DEFAULT_BINDINGS, [BUTTON.Y]: "sustain.1" });
    press(BUTTON.Y); release(BUTTON.Y);
    const before = PerfState.snapshot().sounding;
    colorStick(-1, 0); // ← is a colored zone, not Base
    expect(PerfState.snapshot().joystickDirection).toBe("left");
    expect(PerfState.snapshot().sounding).not.toEqual(before); // re-sounded, colored
    expect(PerfState.isSounding()).toBe(true);
  });

  it("is a chord source like any other: a held chord stacks on top and gives it back", () => {
    setBindings({ ...DEFAULT_BINDINGS, [BUTTON.Y]: "sustain.6" });
    press(BUTTON.Y); release(BUTTON.Y); // vi, latched
    press(BUTTON.B); // ii, held on top
    expect(PerfState.snapshot().degree).toBe(2);
    release(BUTTON.B);
    expect(PerfState.snapshot().degree).toBe(6); // back down to the drone
    expect(PerfState.isSounding()).toBe(true);
  });

  it("never leaves a drone ringing across a re-bind or a view swap", () => {
    setBindings({ ...DEFAULT_BINDINGS, [BUTTON.Y]: "sustain.1" });
    press(BUTTON.Y); release(BUTTON.Y);
    perfectoMapping.reset(); // what main.ts calls when the view changes
    expect(PerfState.isSounding()).toBe(false);
    // and the latch is genuinely clear, not merely silent: one press re-arms it
    press(BUTTON.Y); release(BUTTON.Y);
    expect(PerfState.isSounding()).toBe(true);
  });

  // The bug this pins: two latched buttons used to BOTH stay latched, so the
  // second one toggled between the two drones and the sound could only be
  // stopped by hunting down the first button and pressing it too. A sustain is
  // the instrument sitting on a chord — there is only ever one to sit on.
  it("moves the drone to the second button rather than stacking a second latch", () => {
    setBindings({ ...DEFAULT_BINDINGS, [BUTTON.Y]: "sustain.1", [BUTTON.X]: "sustain.5" });
    press(BUTTON.Y); release(BUTTON.Y);
    expect(PerfState.snapshot().degree).toBe(1);
    press(BUTTON.X); release(BUTTON.X); // the drone moves to V…
    expect(PerfState.snapshot().degree).toBe(5);
    press(BUTTON.X); release(BUTTON.X); // …and its own button is what stops it
    expect(PerfState.isSounding()).toBe(false);
  });

  it("lets the drone move back and forth and still stop on one press", () => {
    setBindings({ ...DEFAULT_BINDINGS, [BUTTON.Y]: "sustain.1", [BUTTON.X]: "sustain.5" });
    press(BUTTON.Y); release(BUTTON.Y);
    press(BUTTON.X); release(BUTTON.X);
    press(BUTTON.Y); release(BUTTON.Y); // back to I — not "I off"
    expect(PerfState.snapshot().degree).toBe(1);
    expect(PerfState.isSounding()).toBe(true);
    press(BUTTON.Y); release(BUTTON.Y);
    expect(PerfState.isSounding()).toBe(false);
  });

  it("hands a held chord back to the drone that is actually latched", () => {
    setBindings({ ...DEFAULT_BINDINGS, [BUTTON.Y]: "sustain.1", [BUTTON.X]: "sustain.5" });
    press(BUTTON.Y); release(BUTTON.Y);
    press(BUTTON.X); release(BUTTON.X); // I is gone; V is the drone
    press(BUTTON.B); // ii, held on top
    expect(PerfState.snapshot().degree).toBe(2);
    release(BUTTON.B);
    expect(PerfState.snapshot().degree).toBe(5); // V, not the abandoned I
  });

  it("is bindable, named, and reported like every other catalog action", () => {
    expect(isActionId("sustain.1")).toBe(true);
    setBindings({ ...DEFAULT_BINDINGS, [BUTTON.Y]: "sustain.7" });
    const y = controlMap().buttons[BUTTON.Y];
    expect(y.degree).toBe(7); // so the legend lights it on vii°, like a hold
    expect(y.caption).toBe("sustain: chord vii°");
    expect(y.label).toBe("vii°∞");
  });
});
