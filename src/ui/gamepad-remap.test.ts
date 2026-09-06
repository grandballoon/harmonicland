import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, parseBindings, restore } from "./gamepad-remap";
import {
  BUTTON, CONTROLS, DEFAULT_BINDINGS, getBindings, setBindings,
} from "../gamepad-perfecto";

// the panel edits the mapping, and the mapping unlocks audio on a press
vi.mock("../outputs/audio", () => ({
  ensure: () => {},
  AudioOut: {
    ensure: () => {}, liveOn: () => {}, liveOff: () => {},
    at: () => {}, silence: () => {}, setMuted: () => {},
  },
}));

const host = (): HTMLElement => {
  const div = document.createElement("div");
  document.body.appendChild(div);
  return div;
};

const selectFor = (panel: HTMLElement, index: number): HTMLSelectElement =>
  panel.querySelectorAll("select")[CONTROLS.findIndex((c) => c.index === index)];

const choose = (sel: HTMLSelectElement, value: string): void => {
  sel.value = value;
  sel.dispatchEvent(new Event("change"));
};

beforeEach(() => localStorage.clear());
afterEach(() => {
  document.body.replaceChildren();
  setBindings(DEFAULT_BINDINGS);
});

describe("parseBindings — the gate on anything persisted", () => {
  it("reads a well-formed table back", () => {
    expect(parseBindings('{"0":"degree.5","7":"octave.up"}'))
      .toEqual({ 0: "degree.5", 7: "octave.up" });
  });

  it("survives junk instead of wedging the input layer", () => {
    expect(parseBindings(null)).toBeNull();
    expect(parseBindings("not json")).toBeNull();
    expect(parseBindings('"a string"')).toBeNull();
    expect(parseBindings("[1,2]")).toBeNull();
  });

  it("drops entries this build no longer understands", () => {
    // a stale action name and a non-numeric button both vanish; the rest stays
    expect(parseBindings('{"0":"degree.1","1":"chord.retired","x":"degree.2"}'))
      .toEqual({ 0: "degree.1" });
  });
});

describe("the remap panel", () => {
  it("offers every button, showing what it currently does", () => {
    const panel = host();
    mount(panel);
    expect(panel.querySelectorAll("select")).toHaveLength(CONTROLS.length);
    expect(selectFor(panel, BUTTON.A).value).toBe("degree.1");
    expect(selectFor(panel, BUTTON.dpadLeft).value).toBe("inversion.cycle");
  });

  it("rebinds a button the moment its function is chosen", () => {
    const panel = host();
    mount(panel);
    choose(selectFor(panel, BUTTON.Y), "octave.up");
    expect(getBindings()[BUTTON.Y]).toBe("octave.up");
  });

  it("can leave a button unbound", () => {
    const panel = host();
    mount(panel);
    choose(selectFor(panel, BUTTON.LB), "");
    expect(getBindings()[BUTTON.LB]).toBeUndefined();
  });

  it("persists the choice, and restores it on the next visit", () => {
    const panel = host();
    mount(panel);
    choose(selectFor(panel, BUTTON.X), "voiceLeading.toggle");

    setBindings(DEFAULT_BINDINGS); // a fresh page load starts from the defaults
    restore();
    expect(getBindings()[BUTTON.X]).toBe("voiceLeading.toggle");
  });

  it("resets to the defaults, in the mapping and on screen", () => {
    const panel = host();
    mount(panel);
    choose(selectFor(panel, BUTTON.X), "voiceLeading.toggle");
    (panel.querySelector("button") as HTMLButtonElement).click();

    expect(getBindings()).toEqual(DEFAULT_BINDINGS);
    expect(selectFor(panel, BUTTON.X).value).toBe("degree.3");
    restore(); // and the reset was persisted too
    expect(getBindings()[BUTTON.X]).toBe("degree.3");
  });
});
