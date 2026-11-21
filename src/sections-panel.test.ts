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
let isolated: Section[];
let changes: (readonly Section[])[];
let hands: string[];
let panel: SectionsPanel;

const q = <T extends Element>(sel: string): T => root.querySelector(sel) as T;
const rows = () => [...root.querySelectorAll<HTMLLIElement>(".section-row")];

beforeEach(() => {
  document.body.innerHTML = new DOMParser().parseFromString(page, "text/html").getElementById("sections")!.outerHTML;
  root = document.getElementById("sections") as HTMLDetailsElement;
  store = memorySectionStore();
  loaded = [];
  isolated = [];
  changes = [];
  hands = [];
  panel = mountSectionsPanel(root, store, {
    onLoad: (s) => loaded.push(s),
    onIsolate: (s) => isolated.push(s),
    onChange: (list) => changes.push(list),
    onHand: (h) => hands.push(h),
  });
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

  it("saves and names from outside by the Save button's rules", () => {
    expect(panel.save()).toBeNull(); // no score
    panel.setScore("demo", 8);
    expect(panel.save()).toBeNull(); // the whole piece
    panel.setSelection({ from: 2, to: 3 });
    const s = panel.save()!;
    expect(s.id).toBe("2-3");
    expect(panel.save()).toBeNull(); // saved already
    panel.rename(s.id, "Bridge");
    expect(store.load("demo")[0].name).toBe("Bridge");
    expect(rows()[0].querySelector<HTMLInputElement>(".section-name")!.value).toBe("Bridge");
    expect(changes[changes.length - 1][0].name).toBe("Bridge");
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

  it("loads a section with its latest name, and stays open to edit it", () => {
    store.save("demo", add([], { from: 4, to: 7 }));
    panel.setScore("demo", 8);
    root.open = true;
    const name = q<HTMLInputElement>(".section-name");
    name.value = "Coda";
    name.dispatchEvent(new Event("change"));
    q<HTMLButtonElement>(".section-load").click();
    expect(loaded.map((s) => [s.id, s.name])).toEqual([["4-7", "Coda"]]);
    expect(root.open).toBe(true);
  });

  it("isolates a section's keys with its latest name, without loading it too", () => {
    store.save("demo", add([], { from: 4, to: 7 }));
    panel.setScore("demo", 8);
    const name = q<HTMLInputElement>(".section-name");
    name.value = "Coda";
    name.dispatchEvent(new Event("change"));
    q<HTMLButtonElement>(".section-keys").click();
    expect(isolated.map((s) => [s.id, s.name])).toEqual([["4-7", "Coda"]]);
    expect(loaded).toEqual([]);
  });

  it("splits the score into chunks and deletes one", () => {
    panel.setScore("demo", 6);
    q<HTMLInputElement>(".section-chunk").value = "4";
    q<HTMLButtonElement>(".section-split").click();
    expect(rows().map((r) => r.dataset.id)).toEqual(["0-3", "4-5"]);
    rows()[0].querySelector<HTMLButtonElement>(".section-remove")!.click();
    expect(store.load("demo").map((s) => s.id)).toEqual(["4-5"]);
  });

  it("moves any saved section onto the selection, name and all, without loading it first", () => {
    store.save("demo", rename(add(add([], { from: 0, to: 1 }), { from: 2, to: 3 }), "2-3", "Theme"));
    panel.setScore("demo", 8);
    const use = (i: number) => rows()[i].querySelector<HTMLButtonElement>(".section-use")!;
    expect(use(1).disabled).toBe(true); // nothing selected
    panel.setSelection({ from: 2, fromBeat: 1, to: 4 });
    expect(use(1).disabled).toBe(false);
    expect(use(1).title).toBe("Move Theme to bar 3 beat 2 – bar 5, keeping its name");
    use(1).click();
    expect(store.load("demo").map((s) => [s.id, s.name])).toEqual([["0-1", ""], ["2@1-4", "Theme"]]);
    expect(rows()[1].classList.contains("current")).toBe(true);
    expect(use(1).disabled).toBe(true); // it is the selection now
    expect(loaded).toEqual([]);
  });

  it("will not move a section onto bars another section already has", () => {
    store.save("demo", add(add([], { from: 0, to: 1 }), { from: 2, to: 3 }));
    panel.setScore("demo", 8);
    panel.setSelection({ from: 0, to: 1 });
    const use = rows()[1].querySelector<HTMLButtonElement>(".section-use")!;
    expect(use.disabled).toBe(true);
    expect(use.title).toBe("Another section already has bars 1–2");
  });

  it("shows each score its own sections", () => {
    store.save("file:a", add([], { from: 0, to: 0 }));
    panel.setScore("file:a", 4);
    expect(rows()).toHaveLength(1);
    panel.setScore("file:b", 4);
    expect(rows()).toHaveLength(0);
    expect(q<HTMLParagraphElement>(".sections-empty").hidden).toBe(false);
  });

  it("hands out the list whenever it changes, and each score's list on load", () => {
    store.save("file:a", add([], { from: 0, to: 0 }));
    panel.setScore("file:a", 4);
    expect(changes.at(-1)!.map((s) => s.id)).toEqual(["0-0"]);
    panel.setSelection({ from: 1, to: 2 });
    q<HTMLButtonElement>(".section-save").click();
    expect(changes.at(-1)!.map((s) => s.id)).toEqual(["0-0", "1-2"]);
    rows()[0].querySelector<HTMLButtonElement>(".section-remove")!.click();
    expect(changes.at(-1)!.map((s) => s.id)).toEqual(["1-2"]);
    panel.setScore(null, 0);
    expect(changes.at(-1)).toEqual([]);
  });

  it("swaps in a newer list from the server when it arrives — for the score still loaded", async () => {
    let answer!: (list: readonly Section[] | null) => void;
    store = { ...memorySectionStore(), refresh: () => new Promise((r) => (answer = r)) };
    document.body.innerHTML = new DOMParser().parseFromString(page, "text/html").getElementById("sections")!.outerHTML;
    root = document.getElementById("sections") as HTMLDetailsElement;
    panel = mountSectionsPanel(root, store, { onLoad: () => {}, onIsolate: () => {}, onChange: (l) => changes.push(l), onHand: () => {} });

    panel.setScore("file:a", 8);
    const forA = answer;
    panel.setScore("file:b", 8);
    forA(add([], { from: 0, to: 0 }, "stale")); // file:a's answer, too late
    await Promise.resolve();
    expect(rows()).toHaveLength(0);

    answer(add([], { from: 2, to: 3 }, "Fresh"));
    await Promise.resolve();
    expect(rows().map((r) => r.querySelector<HTMLInputElement>(".section-name")!.value)).toEqual(["Fresh"]);
    expect(changes.at(-1)!.map((s) => s.name)).toEqual(["Fresh"]);
  });

  it("saves for the hand chosen, beside the same bars for another hand", () => {
    panel.setScore("demo", 8);
    panel.setSelection({ from: 0, to: 3 });
    q<HTMLButtonElement>(".section-save").click();
    panel.setHand("upper");
    expect(q<HTMLButtonElement>(".section-save").disabled).toBe(false);
    expect(q<HTMLButtonElement>(".section-save").textContent).toBe("Save bars 1–4 (R)");
    expect(panel.save()?.id).toBe("0-3:R");
    expect(store.load("demo").map((s) => [s.id, s.hand])).toEqual([["0-3", "both"], ["0-3:R", "upper"]]);
    expect(rows()[1].querySelector(".section-hand-tag")!.textContent).toBe("R");
    expect(rows()[1].classList.contains("current")).toBe(true);
    expect(rows()[0].classList.contains("current")).toBe(false);
  });

  it("lights the hand chosen, and hands a pressed one out", () => {
    panel.setHand("lower");
    const buttons = [...root.querySelectorAll<HTMLButtonElement>(".section-hand button")];
    expect(buttons.map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "false", "true"]);
    buttons[1].click();
    expect(hands).toEqual(["upper"]);
  });

  it("splits a section into sub-runs beneath it, keeping it whole", () => {
    store.save("demo", add([], { from: 0, to: 7 }, "Verse", "lower"));
    panel.setScore("demo", 8);
    q<HTMLInputElement>(".section-chunk").value = "2";
    q<HTMLInputElement>(".section-chunk").dispatchEvent(new Event("input"));
    rows()[0].querySelector<HTMLButtonElement>(".section-split-one")!.click();
    expect(store.load("demo").map((s) => s.id)).toEqual(["0-7:L", "0-1:L", "2-3:L", "4-5:L", "6-7:L"]);
    expect(store.load("demo")[0].name).toBe("Verse");
    expect(rows().map((r) => r.style.getPropertyValue("--depth"))).toEqual(["0", "1", "1", "1", "1"]);
    // the parts are already there: splitting again adds nothing
    expect(rows()[0].querySelector<HTMLButtonElement>(".section-split-one")!.disabled).toBe(true);
    // a part of two bars splits into bars
    q<HTMLInputElement>(".section-chunk").value = "1";
    q<HTMLInputElement>(".section-chunk").dispatchEvent(new Event("input"));
    rows()[1].querySelector<HTMLButtonElement>(".section-split-one")!.click();
    expect(rows().map((r) => r.style.getPropertyValue("--depth"))).toEqual(["0", "1", "2", "2", "1", "1", "1"]);
  });
});
