import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mountSelectionTip, type SelectionTip } from "./selection-tip";
import type { Section } from "./sections";

/* Driven against index.html's own #selection-tip markup, so a renamed class in
   the page fails here rather than silently in the app. */
const page = readFileSync(join(__dirname, "..", "index.html"), "utf8");

const BOX = { x: 100, y: 200, w: 80, h: 60 };
const RANGE = { from: 2, to: 3 };
const SECTION: Section = { id: "2-3", name: "", range: RANGE };

let root: HTMLElement;
let tip: SelectionTip;
let saves: number;
let renames: [string, string][];
let isolated: Section[];

const q = <T extends Element>(sel: string): T => root.querySelector(sel) as T;

beforeEach(() => {
  document.body.innerHTML = new DOMParser().parseFromString(page, "text/html").getElementById("selection-tip")!.outerHTML;
  root = document.getElementById("selection-tip")!;
  saves = 0;
  renames = [];
  isolated = [];
  tip = mountSelectionTip(root, {
    onSave: () => (saves++, SECTION),
    onRename: (id, name) => renames.push([id, name]),
    onIsolate: (s) => isolated.push(s),
  });
});

describe("the selection tip", () => {
  it("offers to save selected bars that are not yet a section", () => {
    tip.show(BOX, RANGE, undefined);
    expect(root.hidden).toBe(false);
    expect(q<HTMLButtonElement>(".selection-tip-save").hidden).toBe(false);
    expect(q(".selection-tip-save").textContent).toBe("Save bars 3–4");
    expect(root.style.left).toBe("140px");
  });

  it("hides for the whole piece, and a panel out of sight", () => {
    tip.show(BOX, null, undefined);
    expect(root.hidden).toBe(true);
    tip.show(null, RANGE, undefined);
    expect(root.hidden).toBe(true);
    tip.show(null, RANGE, SECTION);
    expect(root.hidden).toBe(true);
  });

  it("opens a saved section on the keys alone", () => {
    tip.show(BOX, RANGE, SECTION);
    expect(root.hidden).toBe(false);
    expect(q<HTMLButtonElement>(".selection-tip-save").hidden).toBe(true);
    const keys = q<HTMLButtonElement>(".selection-tip-keys");
    expect(keys.hidden).toBe(false);
    keys.click();
    expect(isolated).toEqual([SECTION]);
  });

  it("saves, then asks for a name, and hands it back on Enter", () => {
    tip.show(BOX, RANGE, undefined);
    q<HTMLButtonElement>(".selection-tip-save").click();
    expect(saves).toBe(1);
    const name = q<HTMLInputElement>(".selection-tip-name");
    tip.show(BOX, RANGE, SECTION);
    expect(root.hidden).toBe(false);
    expect(name.hidden).toBe(false);
    expect(document.activeElement).toBe(name);
    name.value = "  Bridge ";
    name.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(renames).toEqual([["2-3", "Bridge"]]);
    expect(root.hidden).toBe(true);
    // named, the section is offered on its keys
    tip.show(BOX, RANGE, SECTION);
    expect(q<HTMLButtonElement>(".selection-tip-keys").hidden).toBe(false);
  });

  it("leaves the section unnamed on Escape, or when the selection moves on", () => {
    tip.show(BOX, RANGE, undefined);
    q<HTMLButtonElement>(".selection-tip-save").click();
    const name = q<HTMLInputElement>(".selection-tip-name");
    name.value = "Bridge";
    name.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(renames).toEqual([]);

    tip.show(BOX, RANGE, undefined);
    q<HTMLButtonElement>(".selection-tip-save").click();
    tip.show(BOX, { from: 5, to: 6 }, undefined);
    expect(renames).toEqual([]);
    expect(q<HTMLButtonElement>(".selection-tip-save").hidden).toBe(false);
  });
});
