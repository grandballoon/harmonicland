import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mountSectionChips, type SectionChips } from "./section-chips";
import { add, rename } from "./sections";
import type { Section } from "./sections";

/* Driven against index.html's own #section-bar markup, so a renamed class
   in the page fails here rather than silently in the app. */
const page = readFileSync(join(__dirname, "..", "index.html"), "utf8");

let root: HTMLElement;
let picked: Section[];
let shown: boolean[];
let chips: SectionChips;

const buttons = () => [...root.querySelectorAll<HTMLButtonElement>(".section-chip")];
const toggle = () => root.querySelector<HTMLButtonElement>(".marks-toggle")!;

beforeEach(() => {
  document.body.innerHTML = new DOMParser().parseFromString(page, "text/html").getElementById("section-bar")!.outerHTML;
  root = document.getElementById("section-bar")!;
  picked = [];
  shown = [];
  chips = mountSectionChips(root, { onPick: (s) => picked.push(s), onShow: (on) => shown.push(on) });
});

describe("the section chips", () => {
  it("are hidden until there are sections, then offer one chip each, named or by bars", () => {
    expect(root.hidden).toBe(true);
    const list = rename(add(add([], { from: 0, to: 3 }), { from: 4, to: 7 }), "4-7", "Bridge");
    chips.setList(list);
    expect(root.hidden).toBe(false);
    expect(buttons().map((b) => b.textContent)).toEqual(["bars 1–4", "Bridge"]);
    expect(buttons()[1].title).toBe("Bridge · bars 5–8");
    chips.setList([]);
    expect(root.hidden).toBe(true);
  });

  it("hand back the section clicked, and light the one selected", () => {
    chips.setList(add(add([], { from: 0, to: 3 }), { from: 4, to: 7 }));
    buttons()[1].click();
    expect(picked.map((s) => s.id)).toEqual(["4-7"]);
    chips.setSelection({ from: 4, to: 7 });
    expect(buttons().map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "true"]);
    chips.setSelection({ from: 4, to: 6 });
    expect(buttons().map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "false"]);
  });

  it("flip the marks on the sheet music, starting from the page's default of on", () => {
    expect(toggle().getAttribute("aria-pressed")).toBe("true");
    toggle().click();
    toggle().click();
    expect(shown).toEqual([false, true]);
  });
});
