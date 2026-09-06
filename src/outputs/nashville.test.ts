import { describe, it, expect } from "vitest";
import { Nashville } from "./nashville";
import { Core } from "../core";
import { BOX } from "./gamepad-legend";

// jsdom gives no layout, so clientWidth/Height are always 0 — the view reads
// them to size itself. Stub the two properties on a real SVG element and let
// it parse the markup for us, which is the point: a malformed attribute or a
// NaN coordinate shows up as a parse failure, not a silent blank stage.
function stage(w: number, h: number): SVGSVGElement {
  const el = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  Object.defineProperty(el, "clientWidth", { value: w });
  Object.defineProperty(el, "clientHeight", { value: h });
  return el;
}

const empty = Core.makeScore([]);
const hasLegend = (el: SVGSVGElement) => el.innerHTML.includes("Xbox 360");

describe("nashville view", () => {
  it("draws with no score and no numbers out of place", () => {
    const el = stage(1400, 780);
    Nashville.render(el, empty, 0);
    expect(el.innerHTML).toContain("<text"); // it drew something
    expect(el.innerHTML).not.toMatch(/NaN|Infinity|undefined/);
    expect(el.getAttribute("viewBox")).toBe("0 0 1400 780");
  });

  it("gives the controller legend a column when there is room for it", () => {
    expect(hasLegend((() => { const e = stage(1400, 780); Nashville.render(e, empty, 0); return e; })())).toBe(true);
    // too narrow, and too short: the wheel keeps the whole band instead
    expect(hasLegend((() => { const e = stage(700, 780); Nashville.render(e, empty, 0); return e; })())).toBe(false);
    expect(hasLegend((() => { const e = stage(1400, 380); Nashville.render(e, empty, 0); return e; })())).toBe(false);
  });

  it("keeps the coloration wheel clear of the legend column", () => {
    const el = stage(1400, 780);
    Nashville.render(el, empty, 0);
    const g = el.querySelector("g[transform]")!; // the legend's scaled group
    const [, tx, scale] = g.getAttribute("transform")!
      .match(/translate\(([\d.]+),[\d.]+\) scale\(([\d.]+)\)/)!;
    const legendRight = Number(tx) + BOX.w * Number(scale);
    // every wheel zone starts to the right of the legend (zone cells are the
    // 48-tall ones; the degree row's are 46 and the legend's are none of these)
    const zoneLefts = [...el.querySelectorAll("rect")]
      .filter((r) => r.getAttribute("height") === "48")
      .map((r) => Number(r.getAttribute("x")));
    expect(zoneLefts).toHaveLength(8); // the 8 ring zones — the hub is empty
    expect(Math.min(...zoneLefts)).toBeGreaterThan(legendRight);
  });

  it("puts Base at the bottom of the ring and leaves the hub empty", () => {
    const el = stage(1400, 780);
    Nashville.render(el, empty, 0);
    // the default mode's eight zone labels, by where they were drawn
    const labels = ["Flip 3rd", "Dom 7", "Maj 7", "Add 9", "Base", "6/Sus2", "Dim", "Aug"];
    const placed = [...el.querySelectorAll("text")]
      .filter((t) => labels.includes(t.textContent ?? ""))
      .map((t) => ({ label: t.textContent, y: Number(t.getAttribute("y")) }));
    expect(placed).toHaveLength(8); // one per zone — no ninth label at the hub
    const lowest = placed.reduce((a, b) => (b.y > a.y ? b : a));
    expect(lowest.label).toBe("Base");

    // and no zone cell sits on the wheel's center
    const cells = [...el.querySelectorAll("rect")]
      .filter((r) => r.getAttribute("height") === "48")
      .map((r) => ({
        cx: Number(r.getAttribute("x")) + Number(r.getAttribute("width")) / 2,
        cy: Number(r.getAttribute("y")) + 24,
      }));
    const span = (v: number[]) => (Math.min(...v) + Math.max(...v)) / 2;
    const hub = { cx: span(cells.map((c) => c.cx)), cy: span(cells.map((c) => c.cy)) };
    expect(cells.some((c) => Math.abs(c.cx - hub.cx) < 1 && Math.abs(c.cy - hub.cy) < 1))
      .toBe(false);
  });
});
