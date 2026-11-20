import { describe, it, expect, beforeEach } from "vitest";
import { mountIntervalRow } from "./interval-row";
import type { EchoSettings } from "./echoes";

/* The row against an in-memory Storage: what it hands the echoes, and
   what it remembers. */
class MemoryStorage {
  data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
}

let storage: MemoryStorage;
let got: EchoSettings[];
let el: { chips: HTMLElement; timing: HTMLSelectElement; clear: HTMLButtonElement };

const mount = () => {
  el = {
    chips: document.createElement("div"),
    timing: document.createElement("select"),
    clear: document.createElement("button"),
  };
  for (const v of ["together", "after"]) el.timing.append(new Option(v, v));
  mountIntervalRow(el, { set: (s) => void got.push(s), storage: () => storage as unknown as Storage });
};
const chip = (key: string) => el.chips.querySelector<HTMLButtonElement>(`[data-relation="${key}"]`)!;
const last = () => got[got.length - 1];

beforeEach(() => {
  storage = new MemoryStorage();
  got = [];
});

describe("the intervals row", () => {
  it("offers every interval each way, and starts with none", () => {
    mount();
    expect(el.chips.querySelectorAll("button")).toHaveLength(24);
    expect(last()).toEqual({ relations: [], timing: "together" });
    expect(el.clear.disabled).toBe(true);
  });

  it("hands over each interval switched on, and off again", () => {
    mount();
    chip("up:4").click();
    chip("down:8").click();
    expect(last().relations).toEqual([{ semitones: 4, dir: "up" }, { semitones: 8, dir: "down" }]);
    expect(chip("up:4").getAttribute("aria-pressed")).toBe("true");
    chip("up:4").click();
    expect(last().relations).toEqual([{ semitones: 8, dir: "down" }]);
    expect(chip("up:4").getAttribute("aria-pressed")).toBe("false");
  });

  it("turns them all off at once", () => {
    mount();
    chip("up:4").click();
    expect(el.clear.disabled).toBe(false);
    el.clear.click();
    expect(last().relations).toEqual([]);
    expect(el.clear.disabled).toBe(true);
  });

  it("hands over the timing chosen", () => {
    mount();
    el.timing.value = "after";
    el.timing.dispatchEvent(new Event("change"));
    expect(last().timing).toBe("after");
  });

  it("remembers the choice across visits", () => {
    mount();
    chip("up:7").click();
    el.timing.value = "after";
    el.timing.dispatchEvent(new Event("change"));
    got = [];
    mount();
    expect(got).toEqual([{ relations: [{ semitones: 7, dir: "up" }], timing: "after" }]);
    expect(chip("up:7").getAttribute("aria-pressed")).toBe("true");
    expect(el.timing.value).toBe("after");
  });

  it("drops what it does not recognise in storage", () => {
    storage.setItem("harmonicland.echoes.v1", JSON.stringify({
      relations: [{ semitones: 4, dir: "up" }, { semitones: 40, dir: "up" }, "junk"],
      timing: "sideways",
    }));
    mount();
    expect(last()).toEqual({ relations: [{ semitones: 4, dir: "up" }], timing: "together" });
  });

  it("starts from the defaults when storage is unreadable", () => {
    storage.setItem("harmonicland.echoes.v1", "{not json");
    mount();
    expect(last()).toEqual({ relations: [], timing: "together" });
  });
});
