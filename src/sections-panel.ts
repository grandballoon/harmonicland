/* ====================================================================
   SECTIONS_PANEL — the dropdown that saves, names, splits, and loads a
   score's sections. It owns its own DOM (the markup is index.html's
   #sections) and its own list; it knows nothing of views, the clock, or
   practice mode. What it reads is the current bar selection, handed in by
   setSelection; what it gives back is a section to load, through onLoad.
   main.ts turns that into the one shared selection, so a loaded section
   loops in the falling notes and confines a lesson by the same path a
   dragged flag does. A row's "Keys" gives the section back through
   onIsolate instead: load it, and show only the keys it plays. Every
   change to the list is handed out through onChange, so what else shows
   the sections — the chips in the header, the marks on the sheets —
   follows this one list rather than keeping a copy of its own.

   A saved section's span is edited with the one bar selection, not a
   second editor: select the bars you want (loading the section first is
   handy, not required), then press that row's "Use selection", which
   moves the section — name and all — onto them. Loading leaves the panel
   open, so load, adjust, and use-selection happen in one place.

   The panel's list is the only list, so a save made elsewhere — the tip
   over the selection on the sheet music (selection-tip.ts) — comes through
   save and rename here, by the same rules as the Save button and a row's
   name box.

   New sections are saved for the hand chosen in the panel's hand picker,
   which is the app's one hand setting (main.ts, chooseHand): picking it
   here goes out through onHand, and a change made elsewhere comes back
   in through setHand. A row's "Split" adds that section's runs of the
   chunk size beside it, for its hand, and leaves it whole (sections.ts,
   decision 4); rows are indented by how many sections hold them.

   The store answers at once from this browser, and may later hand back a
   newer list from the server (section-store.ts, decision 1); the panel
   shows the first and swaps in the second.
   ==================================================================== */
import { Sections, type Section } from "./sections";
import type { SectionStore } from "./section-store";
import type { BarRange } from "./types";
import type { HandFilter } from "./steps";

export interface SectionsPanel {
  /** A new score: its key for storage (null when none is loaded) and how
   *  many bars it has. Loads that score's saved sections. */
  setScore(key: string | null, bars: number): void;
  /** The bars currently selected, or null for the whole piece. */
  setSelection(range: BarRange | null): void;
  /** Save the selected bars as a section, as the Save button does, and
   *  hand it back — or null when there is nothing to save: no score, the
   *  whole piece, or bars that are a section already. */
  save(): Section | null;
  /** Name section `id`, as typing in its row does. */
  rename(id: string, name: string): void;
  /** The hand new sections are saved for — the app's hand setting. */
  setHand(h: HandFilter): void;
}

/** What a row hands back. Each is given the section as it now stands. */
export interface SectionActions {
  /** Select its bars. */
  onLoad(s: Section): void;
  /** Select its bars, and isolate the keys they play. */
  onIsolate(s: Section): void;
  /** The list changed — a score loaded, or a section saved, split,
   *  renamed, moved or deleted. */
  onChange(list: readonly Section[]): void;
  /** The hand picker was pressed. */
  onHand(h: HandFilter): void;
}

export function mountSectionsPanel(
  root: HTMLDetailsElement, store: SectionStore, { onLoad, onIsolate, onChange, onHand }: SectionActions,
): SectionsPanel {
  const q = <T extends HTMLElement>(sel: string): T => root.querySelector(sel) as T;
  const count = q<HTMLSpanElement>(".sections-count");
  const saveBtn = q<HTMLButtonElement>(".section-save");
  const chunkBox = q<HTMLInputElement>(".section-chunk");
  const splitBtn = q<HTMLButtonElement>(".section-split");
  const listEl = q<HTMLUListElement>(".sections-list");
  const empty = q<HTMLParagraphElement>(".sections-empty");
  const handButtons = [...root.querySelectorAll<HTMLButtonElement>(".section-hand button")];

  let key: string | null = null;
  let bars = 0;
  let selection: BarRange | null = null;
  let list: readonly Section[] = [];
  let hand: HandFilter = "both";
  /** Which setScore a refresh answers, so a late one for an earlier score
   *  is dropped. */
  let loads = 0;

  const commit = (next: readonly Section[]): void => {
    list = next;
    if (key !== null) store.save(key, list);
    onChange(list);
  };

  const nameBox = (id: string): HTMLInputElement | null =>
    listEl.querySelector(`li[data-id="${id}"] .section-name`);

  /** Rebuilt only when the list's MEMBERS change — never on a rename, which
   *  commits on blur, and a rebuild then would pull the row out from under
   *  the click that caused the blur. */
  function render(): void {
    const depth = Sections.depths(list);
    listEl.replaceChildren(...list.map((s, i) => row(s, depth[i])));
    count.textContent = list.length ? String(list.length) : "";
    empty.textContent = key === null
      ? "Load a score to save its sections."
      : "No sections yet. Select bars (drag the flags, type bar numbers, or click bars in practice), then save them here.";
    empty.hidden = list.length > 0;
    splitBtn.disabled = key === null;
    chunkBox.disabled = key === null;
    mark();
  }

  function row(s: Section, depth: number): HTMLLIElement {
    const li = document.createElement("li");
    li.className = "section-row";
    li.dataset.id = s.id;
    li.dataset.hand = s.hand;
    li.style.setProperty("--depth", String(depth));

    const load = document.createElement("button");
    load.className = "section-load";
    load.textContent = Sections.describeBars(s.range);
    if (s.hand !== "both") {
      const tag = document.createElement("span");
      tag.className = "section-hand-tag";
      tag.textContent = Sections.handTag(s.hand);
      load.append(tag);
    }
    load.title = s.hand === "both" ? "Loop these bars, or practise them" : `Loop these bars, or practise them — ${Sections.handName(s.hand)}`;
    // the latest name, which a rename may have changed since this row was built
    const latest = (): Section => list.find((x) => x.id === s.id) ?? s;
    load.addEventListener("click", () => onLoad(latest()));

    const name = document.createElement("input");
    name.className = "section-name";
    name.type = "text";
    name.value = s.name;
    name.placeholder = "name…";
    name.setAttribute("aria-label", `Name for ${Sections.labelOf({ ...s, name: "" })}`);
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

    const part = document.createElement("button");
    part.className = "section-split-one";
    part.textContent = "Split";
    part.addEventListener("click", () => {
      const next = Sections.split(list, s.id, chunkSize());
      if (next === list) return;
      commit(next);
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

    li.append(load, name, keys, use, part, del);
    return li;
  }

  /** The Save button, each row's Use selection, and the highlighted row
   *  follow the selection, without a rebuild. */
  function mark(): void {
    const current = Sections.find(list, selection, hand);
    for (const b of handButtons) b.setAttribute("aria-pressed", String(b.dataset.hand === hand));
    const size = chunkSize();
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
      const part = li.querySelector<HTMLButtonElement>(".section-split-one")!;
      part.disabled = !Number.isFinite(size) || !Sections.canSplit(list, s.id, size);
      part.title = part.disabled
        ? `${Sections.labelOf(s)} is already split into runs of ${size} bar${size === 1 ? "" : "s"}, or is no longer than one`
        : `Add ${Sections.labelOf(s)}'s runs of ${size} bar${size === 1 ? "" : "s"} beneath it, keeping it whole`;
      part.setAttribute("aria-label", `Split ${Sections.labelOf(s)} into runs of ${size} bars`);
    }
    saveBtn.disabled = key === null || selection === null || current !== undefined;
    const what = selection && Sections.labelOf({ id: "", range: selection, name: "", hand });
    saveBtn.textContent = what === null ? "Save selected bars" : current ? `${what} saved` : `Save ${what}`;
  }

  /** The chunk box, or NaN when it holds no whole number of bars. */
  const chunkSize = (): number => {
    const n = parseInt(chunkBox.value, 10);
    return n >= 1 ? n : NaN;
  };

  function save(): Section | null {
    if (key === null || selection === null || Sections.find(list, selection, hand)) return null;
    commit(Sections.add(list, selection, "", hand));
    render();
    return Sections.find(list, selection, hand)!;
  }

  for (const b of handButtons) b.addEventListener("click", () => onHand(b.dataset.hand as HandFilter));
  chunkBox.addEventListener("input", mark);

  saveBtn.addEventListener("click", () => {
    const s = save();
    if (s) nameBox(s.id)?.focus(); // name it now, if you like
  });

  splitBtn.addEventListener("click", () => {
    const size = chunkSize();
    if (!Number.isFinite(size) || bars === 0) return;
    commit(Sections.addAll(list, Sections.chunk(bars, size), hand));
    render();
  });

  render();

  return {
    setScore(k, n) {
      key = k;
      bars = n;
      list = k === null ? [] : store.load(k);
      render();
      onChange(list);
      // what this browser knew is on screen; a newer list from the
      // server, if there is one, replaces it when it arrives
      const at = ++loads;
      if (k !== null)
        void store.refresh(k).then((fresh) => {
          if (fresh === null || at !== loads) return;
          list = fresh;
          render();
          onChange(list);
        });
    },
    setSelection(r) {
      selection = r;
      mark();
    },
    save,
    setHand(h) {
      hand = h;
      mark();
    },
    rename(id, name) {
      commit(Sections.rename(list, id, name));
      const box = nameBox(id);
      if (box) box.value = list.find((x) => x.id === id)?.name ?? "";
    },
  };
}
