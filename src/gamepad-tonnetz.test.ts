import { vi, describe, it, expect, beforeEach } from "vitest";

const mockTonnetz = vi.hoisted(() => ({
  trigger:     vi.fn(),
  release:     vi.fn(),
  isSounding:  vi.fn(() => false),
  apply:       vi.fn(),
  step:        vi.fn(),
  nudgeOctave: vi.fn(),
  home:        vi.fn(),
  snapshot:    vi.fn(() => ({ cursor: { col: 0, row: 0, orient: "up" }, octave: 4, sounding: [] })),
}));

const mockAudio = vi.hoisted(() => ({ ensure: vi.fn() }));

vi.mock("./tonnetz-state", () => ({ TonnetzState: mockTonnetz }));
vi.mock("./outputs/audio", () => ({ AudioOut: mockAudio }));

import { tonnetzMapping, setBindings, DEFAULT_BINDINGS, type Bindings } from "./gamepad-tonnetz";

const frame = (
  downs: number[] = [],
  ups:   number[] = [],
): Parameters<typeof tonnetzMapping.onFrame>[0] => ({
  downs, ups, held: new Set(downs), axes: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  setBindings(DEFAULT_BINDINGS);
});

describe("sustain (RT, button 7)", () => {
  it("down calls AudioOut.ensure and TonnetzState.trigger", () => {
    tonnetzMapping.onFrame(frame([7]));
    expect(mockAudio.ensure).toHaveBeenCalled();
    expect(mockTonnetz.trigger).toHaveBeenCalled();
  });

  it("up calls TonnetzState.release", () => {
    tonnetzMapping.onFrame(frame([], [7]));
    expect(mockTonnetz.release).toHaveBeenCalled();
  });
});

describe("transform buttons (momentary)", () => {
  it("A (button 0) applies P", () => {
    tonnetzMapping.onFrame(frame([0]));
    expect(mockTonnetz.apply).toHaveBeenCalledWith("P");
  });

  it("B (button 1) applies R", () => {
    tonnetzMapping.onFrame(frame([1]));
    expect(mockTonnetz.apply).toHaveBeenCalledWith("R");
  });

  it("X (button 2) applies L", () => {
    tonnetzMapping.onFrame(frame([2]));
    expect(mockTonnetz.apply).toHaveBeenCalledWith("L");
  });

  it("button-up on a momentary action does not double-fire", () => {
    tonnetzMapping.onFrame(frame([], [0])); // release A — must be a no-op
    expect(mockTonnetz.apply).not.toHaveBeenCalled();
  });
});

describe("lattice step buttons", () => {
  it("d-pad right (15) steps fifthUp", () => {
    tonnetzMapping.onFrame(frame([15]));
    expect(mockTonnetz.step).toHaveBeenCalledWith("fifthUp");
  });

  it("d-pad left (14) steps fifthDown", () => {
    tonnetzMapping.onFrame(frame([14]));
    expect(mockTonnetz.step).toHaveBeenCalledWith("fifthDown");
  });

  it("d-pad up (12) steps majThirdUp", () => {
    tonnetzMapping.onFrame(frame([12]));
    expect(mockTonnetz.step).toHaveBeenCalledWith("majThirdUp");
  });
});

describe("octave and home", () => {
  it("RB (button 5) nudges octave up", () => {
    tonnetzMapping.onFrame(frame([5]));
    expect(mockTonnetz.nudgeOctave).toHaveBeenCalledWith(1);
  });

  it("LB (button 4) nudges octave down", () => {
    tonnetzMapping.onFrame(frame([4]));
    expect(mockTonnetz.nudgeOctave).toHaveBeenCalledWith(-1);
  });

  it("Y (button 3) calls home", () => {
    tonnetzMapping.onFrame(frame([3]));
    expect(mockTonnetz.home).toHaveBeenCalled();
  });
});

describe("setBindings", () => {
  it("remaps a button and dispatches the new action", () => {
    const custom: Bindings = { 99: "home" };
    setBindings(custom);
    tonnetzMapping.onFrame(frame([99]));
    expect(mockTonnetz.home).toHaveBeenCalled();
  });

  it("an unmapped button in a custom table is a no-op", () => {
    setBindings({});
    tonnetzMapping.onFrame(frame([0]));
    expect(mockTonnetz.apply).not.toHaveBeenCalled();
  });

  it("sustain in a custom binding still fires both edges", () => {
    setBindings({ 42: "sustain" });
    tonnetzMapping.onFrame(frame([42]));
    expect(mockTonnetz.trigger).toHaveBeenCalled();
    tonnetzMapping.onFrame(frame([], [42]));
    expect(mockTonnetz.release).toHaveBeenCalled();
  });
});

describe("reset", () => {
  it("calls TonnetzState.release", () => {
    tonnetzMapping.reset();
    expect(mockTonnetz.release).toHaveBeenCalled();
  });
});
