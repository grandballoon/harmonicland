import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mountSectionsPanel, type SectionsPanel } from "./sections-panel";
import { memorySectionStore, type SectionStore } from "./section-store";
import { add, rename } from "./sections";
import type { Section } from "./sections";

/* The panel is driven against index.html's own #sections markup, so a
   renamed class in the page fails here rather than silently in the app. */
const page = readFileSync(join(__dirname, "..", "index.html"), "utf8");

let root: HTMLDetailsElement;
let store: SectionStore;
let loaded: Section[];
let panel: SectionsPanel;

const q = <T extends Element>(sel: string): T => root.querySelector(sel) as T;
const rows = () => [...root.querySelectorAll<HTMLLIElement>(".section-row")];

beforeEach(() => {
  document.body.innerHTML = new DOMParser().parseFromString(page, "text/html").getElementById("sections")!.outerHTML;
  root = document.getElementById("sections") as HTMLDetailsElement;
  store = memorySectionStore();
  loaded = [];
  panel = mountSectionsPanel(root, store, (s) => loaded.push(s));
});

describe("the sections panel", () => {
  it("offers nothing to save until a score is loaded and bars are selected", () => {
    const save = q<HTMLButtonElement>(".section-save");
    expect(save.disabled).toBe(true);
    panel.setScore("demo", 8);
    expect(save.disabled).toBe(true);
    panel.setSelection({ from: 2, to: 3 });
    expect(save.disabled).toBe(false);
    expect(save.textContent).toBe("Save bars 3–4");
  });

  it("saves the selection for this score, lights it, and will not save it twice", () => {
    panel.setScore("demo", 8);
    panel.setSelection({ from: 2, to: 3 });
    q<HTMLButtonElement>(".section-save").click();
    expect(store.load("demo").map((s) => s.id)).toEqual(["2-3"]);
    expect(rows()[0].classList.contains("current")).toBe(true);
    expect(q<HTMLButtonElement>(".section-save").disabled).toBe(true);
    expect(q(".sections-count").textContent).toBe("1");
  });

  it("renames on commit without rebuilding the list", () => {
    panel.setScore("demo", 8);
    panel.setSelection({ from: 0, to: 1 });
    q<HTMLButtonElement>(".section-save").click();
    const row = rows()[0];
    const name = row.querySelector<HTMLInputElement>(".section-name")!;
    name.value = "Opening";
    name.dispatchEvent(new Event("change"));
    expect(store.load("demo")[0].name).toBe("Opening");
    expect(rows()[0]).toBe(row);
  });

  it("loads a section with its latest name, and closes", () => {
    store.save("demo", add([], { from: 4, to: 7 }));
    panel.setScore("demo", 8);
    root.open = true;
    const name = q<HTMLInputElement>(".section-name");
    name.value = "Coda";
    name.dispatchEvent(new Event("change"));
    q<HTMLButtonElement>(".section-load").click();
    expect(loaded.map((s) => [s.id, s.name])).toEqual([["4-7", "Coda"]]);
    expect(root.open).toBe(false);
  });

  it("splits the score into chunks and deletes one", () => {
    panel.setScore("demo", 6);
    q<HTMLInputElement>(".section-chunk").value = "4";
    q<HTMLButtonElement>(".section-split").click();
    expect(rows().map((r) => r.dataset.id)).toEqual(["0-3", "4-5"]);
    rows()[0].querySelector<HTMLButtonElement>(".section-remove")!.click();
    expect(store.load("demo").map((s) => s.id)).toEqual(["4-5"]);
  });

  it("offers to move the section just loaded onto a fine-tuned selection", () => {
    const update = q<HTMLButtonElement>(".section-update");
    store.save("demo", rename(add([], { from: 2, to: 3 }), "2-3", "Theme"));
    panel.setScore("demo", 8);
    expect(update.hidden).toBe(true);
    rows()[0].querySelector<HTMLButtonElement>(".section-load")!.click();
    panel.setSelection(loaded[0].range);
    expect(update.hidden).toBe(true); // nothing to update yet
    panel.setSelection({ from: 2, fromBeat: 1, to: 3 });
    expect(update.hidden).toBe(false);
    expect(update.textContent).toBe("Update Theme");
    update.click();
    expect(store.load("demo").map((s) => [s.id, s.name])).toEqual([["2@1-3", "Theme"]]);
    expect(rows()[0].classList.contains("current")).toBe(true);
    expect(update.hidden).toBe(true);
  });

  it("shows each score its own sections", () => {
    store.save("file:a", add([], { from: 0, to: 0 }));
    panel.setScore("file:a", 4);
    expect(rows()).toHaveLength(1);
    panel.setScore("file:b", 4);
    expect(rows()).toHaveLength(0);
    expect(q<HTMLParagraphElement>(".sections-empty").hidden).toBe(false);
  });
});
