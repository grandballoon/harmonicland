/* The prose panel: DOM only. It is handed lines and must lay them out —
   it never computes one, so nothing here loads a score. */
import { describe, it, expect } from "vitest";
import { render } from "./prose-panel";
import type { Line } from "../outputs/prose";

const host = (): HTMLElement => {
  const div = document.createElement("div");
  document.body.appendChild(div);
  return div;
};

const line = (over: Partial<Line> = {}): Line => ({
  state: 0, depth: 0, kind: "step", text: "Hold the outer two.", ...over,
});

const rows = (h: HTMLElement) => [...h.querySelectorAll("li")];

describe("prose panel", () => {
  it("renders one row per line, numbered by state", () => {
    const h = host();
    render(h, [line({ state: 0, kind: "start" }), line({ state: 1 }), line({ state: 2 })], "Piano");
    expect(rows(h)).toHaveLength(3);
    expect(rows(h).map((r) => r.querySelector(".n")?.textContent)).toEqual(["0", "1", "2"]);
    expect(rows(h)[0].className).toContain("start");
  });

  it("indents by depth, so a figure's detail sits under its summary", () => {
    const h = host();
    render(h, [line({ kind: "figure", depth: 0 }), line({ depth: 1 }), line({ depth: 2 })], "Piano");
    const pads = rows(h).map((r) => r.style.paddingLeft);
    expect(pads[0]).toBe("0px");
    expect(parseInt(pads[1])).toBeGreaterThan(0);
    expect(parseInt(pads[2])).toBeGreaterThan(parseInt(pads[1]));
  });

  it("captions the list with the instrument and what it found", () => {
    const h = host();
    render(h, [line(), line({ kind: "figure" }), line({ kind: "unplayable" })], "Guitar · drop D");
    expect(h.querySelector(".prose-title")?.textContent).toBe("Guitar · drop D");
    const count = h.querySelector(".prose-count")?.textContent ?? "";
    expect(count).toContain("3 instructions");
    expect(count).toContain("1 repeated figure");
    expect(count).toContain("1 unplayable");
  });

  it("leaves the counts off when there is nothing to count", () => {
    const h = host();
    render(h, [line()], "Piano");
    expect(h.querySelector(".prose-count")?.textContent).toBe("1 instruction");
  });

  it("says so when there is no score, rather than showing an empty list", () => {
    const h = host();
    render(h, [], "Piano");
    expect(rows(h)).toHaveLength(0);
    expect(h.querySelector(".prose-empty")?.textContent).toMatch(/Load a score/);
  });

  it("replaces the previous list rather than appending to it", () => {
    const h = host();
    render(h, [line(), line(), line()], "Piano");
    render(h, [line()], "Guitar · standard tuning");
    expect(rows(h)).toHaveLength(1);
    expect(h.querySelectorAll(".prose-head")).toHaveLength(1);
  });
});
