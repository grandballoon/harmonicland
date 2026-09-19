/* ====================================================================
   SECTIONS_PANEL — the dropdown that saves, names, splits, and loads a
   score's sections. It owns its own DOM (the markup is index.html's
   #sections) and its own list; it knows nothing of views, the clock, or
   practice mode. What it reads is the current bar selection, handed in by
   setSelection; what it gives back is a section to load, through onLoad.
   main.ts turns that into the one shared selection, so a loaded section
   loops in the falling notes and confines a lesson by the same path a
   dragged flag does. A row's "Keys" gives the section back through
   onIsolate instead: load it, and show only the keys it plays.

   A saved section's span is edited with the one bar selection, not a
   second editor: select the bars you want (loading the section first is
   handy, not required), then press that row's "Use selection", which
   moves the section — name and all — onto them. Loading leaves the panel
   open, so load, adjust, and use-selection happen in one place.
   ==================================================================== */
import { Sections, type Section } from "./sections";
import type { SectionStore } from "./section-store";
import type { BarRange } from "./types";

export interface SectionsPanel {
  /** A new score: its key for storage (null when none is loaded) and how
   *  many bars it has. Loads that score's saved sections. */
  setScore(key: string | null, bars: number): void;
  /** The bars currently selected, or null for the whole piece. */
  setSelection(range: BarRange | null): void;
}

/** What a row hands back. Each is given the section as it now stands. */
export interface SectionActions {
  /** Select its bars. */
  onLoad(s: Section): void;
  /** Select its bars, and isolate the keys they play. */
  onIsolate(s: Section): void;
}

export function mountSectionsPanel(
  root: HTMLDetailsElement, store: SectionStore, { onLoad, onIsolate }: SectionActions,
): SectionsPanel {
  const q = <T extends HTMLElement>(sel: string): T => root.querySelector(sel) as T;
  const count = q<HTMLSpanElement>(".sections-count");
  const saveBtn = q<HTMLButtonElement>(".section-save");
  const chunkBox = q<HTMLInputElement>(".section-chunk");
  const splitBtn = q<HTMLButtonElement>(".section-split");
  const listEl = q<HTMLUListElement>(".sections-list");
  const empty = q<HTMLParagraphElement>(".sections-empty");

  let key: string | null = null;
  let bars = 0;
  let selection: BarRange | null = null;
  let list: readonly Section[] = [];

  const commit = (next: readonly Section[]): void => {
    list = next;
    if (key !== null) store.save(key, list);
  };

  const nameBox = (id: string): HTMLInputElement | null =>
    listEl.querySelector(`li[data-id="${id}"] .section-name`);

  /** Rebuilt only when the list's MEMBERS change — never on a rename, which
   *  commits on blur, and a rebuild then would pull the row out from under
   *  the click that caused the blur. */
  function render(): void {
    listEl.replaceChildren(...list.map(row));
    count.textContent = list.length ? String(list.length) : "";
    empty.textContent = key === null
      ? "Load a score to save its sections."
      : "No sections yet. Select bars (drag the flags, type bar numbers, or click bars in practice), then save them here.";
    empty.hidden = list.length > 0;
    splitBtn.disabled = key === null;
    chunkBox.disabled = key === null;
    mark();
  }

  function row(s: Section): HTMLLIElement {
    const li = document.createElement("li");
    li.className = "section-row";
    li.dataset.id = s.id;

    const load = document.createElement("button");
    load.className = "section-load";
    load.textContent = Sections.describeBars(s.range);
    load.title = "Loop these bars, or practise them";
    // the latest name, which a rename may have changed since this row was built
    const latest = (): Section => list.find((x) => x.id === s.id) ?? s;
    load.addEventListener("click", () => onLoad(latest()));

    const name = document.createElement("input");
    name.className = "section-name";
    name.type = "text";
    name.value = s.name;
    name.placeholder = "name…";
    name.setAttribute("aria-label", `Name for ${Sections.describeBars(s.range)}`);
    name.addEventListener("change", () => commit(Sections.rename(list, s.id, name.value)));
    name.addEventListener("keydown", (e) => {
      if (e.key === "Enter") name.blur();
      if (e.key === "Escape") {
        name.value = list.find((x) => x.id === s.id)?.name ?? "";
        name.blur();
        e.stopPropagation(); // leave the panel open; Escape meant the edit
      }
    });

    const keys = document.createElement("button");
    keys.className = "section-keys";
    keys.textContent = "Keys";
    keys.title = "Show only the keys these bars play, enlarged";
    keys.setAttribute("aria-label", `Isolate the keys of ${Sections.labelOf(s)}`);
    keys.addEventListener("click", () => onIsolate(latest()));

    const use = document.createElement("button");
    use.className = "section-use";
    use.textContent = "Use selection";
    use.addEventListener("click", () => {
      if (selection === null) return;
      commit(Sections.retarget(list, s.id, selection));
      render();
    });

    const del = document.createElement("button");
    del.className = "section-remove";
    del.textContent = "✕";
    del.title = "Forget this section";
    del.setAttribute("aria-label", `Delete ${Sections.labelOf(s)}`);
    del.addEventListener("click", () => {
      commit(Sections.remove(list, s.id));
      render();
    });

    li.append(load, name, keys, use, del);
    return li;
  }

  /** The Save button, each row's Use selection, and the highlighted row
   *  follow the selection, without a rebuild. */
  function mark(): void {
    const current = Sections.find(list, selection);
    for (const li of listEl.querySelectorAll<HTMLLIElement>(".section-row")) {
      const s = list.find((x) => x.id === li.dataset.id);
      if (!s) continue;
      li.classList.toggle("current", s === current);
      const use = li.querySelector<HTMLButtonElement>(".section-use")!;
      // a range is saved once (sections.ts, decision 3), so bars that are
      // already a section cannot become this one too
      use.disabled = selection === null || current !== undefined;
      use.title = selection === null
        ? "Select bars first, then move this section onto them"
        : current === s ? "This section is already the selected bars"
        : current ? `${current.name || "Another section"} already has ${Sections.describeBars(selection)}`
        : `Move ${Sections.labelOf(s)} to ${Sections.describeBars(selection)}, keeping its name`;
      use.setAttribute("aria-label", `Move ${Sections.labelOf(s)} to the selected bars`);
    }
    saveBtn.disabled = key === null || selection === null || current !== undefined;
    saveBtn.textContent = selection === null
      ? "Save selected bars"
      : current ? `${Sections.describeBars(selection)} saved` : `Save ${Sections.describeBars(selection)}`;
  }

  saveBtn.addEventListener("click", () => {
    if (selection === null) return;
    commit(Sections.add(list, selection));
    render();
    nameBox(Sections.find(list, selection)!.id)?.focus(); // name it now, if you like
  });

  splitBtn.addEventListener("click", () => {
    const size = parseInt(chunkBox.value, 10);
    if (!Number.isFinite(size) || size < 1 || bars === 0) return;
    commit(Sections.addAll(list, Sections.chunk(bars, size)));
    render();
  });

  render();

  return {
    setScore(k, n) {
      key = k;
      bars = n;
      list = k === null ? [] : store.load(k);
      render();
    },
    setSelection(r) {
      selection = r;
      mark();
    },
  };
}
