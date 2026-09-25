/* ====================================================================
   SELECTION_TIP — a small tip that hovers over the selected bars on the
   sheet music and acts on them in one click, without opening the Controls
   tray. Bars not yet a section it saves; once saved, it becomes a name
   box for the new section: type a name and press Enter, or just move on
   and leave it unnamed. Over a saved section — just named, or selected by
   clicking its mark — it opens that section on the keys alone.

   It owns its own DOM (the markup is index.html's #selection-tip) and nothing
   else. Where the selection's panel stands on screen is the view's
   answer (view.ts, `Scroller.rangeBox`); the list, and what saving and
   naming do to it, are sections-panel.ts's, handed in through onSave and
   onRename; what opening a section on its keys means is main.ts's, handed
   in through onIsolate. main.ts calls `show` every frame with what the frame drew,
   so the tip follows the panel as the music scrolls or a grip drags.
   ==================================================================== */
import { Sections, type Section } from "./sections";
import type { Region } from "./view";
import type { BarRange } from "./types";

export interface SelectionTip {
  /** Stand over `box`, the selection's panel in the stage's pixels, for
   *  `selection` — `saved` when those bars are a section already. A null
   *  box hides the tip: the panel is out of sight, or not drawn. */
  show(box: Region | null, selection: BarRange | null, saved: Section | undefined): void;
}

export interface SelectionTipActions {
  /** Save the selected bars; the section saved, or null if none was. */
  onSave(): Section | null;
  onRename(id: string, name: string): void;
  /** Open the saved section on the keys alone. */
  onIsolate(s: Section): void;
}

/** Gap between the tip's arrow and the panel's top, and the least room
 *  kept between the tip and the stage's edges, in pixels. */
const GAP = 6;
const EDGE = 4;

export function mountSelectionTip(root: HTMLElement, { onSave, onRename, onIsolate }: SelectionTipActions): SelectionTip {
  const saveBtn = root.querySelector(".selection-tip-save") as HTMLButtonElement;
  const nameBox = root.querySelector(".selection-tip-name") as HTMLInputElement;
  const keysBtn = root.querySelector(".selection-tip-keys") as HTMLButtonElement;

  /** The section just saved here, while its name box is up. */
  let naming: Section | null = null;
  /** The saved section the keys button opens, while it is up. */
  let offered: Section | undefined;
  /** What the tip last showed, so a frame that changes nothing writes nothing. */
  let shown = "";

  saveBtn.addEventListener("click", () => {
    naming = onSave();
    if (!naming) return;
    shown = ""; // swap the button for the name box on the next frame
    nameBox.value = "";
    nameBox.hidden = false;
    saveBtn.hidden = true;
    nameBox.focus();
  });

  keysBtn.addEventListener("click", () => {
    if (offered) onIsolate(offered);
  });

  const finishNaming = (): void => {
    if (!naming) return;
    if (nameBox.value.trim()) onRename(naming.id, nameBox.value.trim());
    naming = null;
    shown = "";
    root.hidden = true;
  };
  nameBox.addEventListener("keydown", (e) => {
    if (e.key === "Enter") nameBox.blur();
    if (e.key === "Escape") {
      nameBox.value = ""; // leave it unnamed
      nameBox.blur();
      e.stopPropagation(); // Escape meant the name, not the page
    }
  });
  nameBox.addEventListener("blur", finishNaming);

  function place(box: Region): void {
    const stage = root.offsetParent as HTMLElement | null;
    const stageW = stage?.clientWidth ?? Infinity;
    const half = root.offsetWidth / 2;
    const cx = Math.min(Math.max(box.x + box.w / 2, half + EDGE), stageW - half - EDGE);
    // above the panel, unless the panel's top is too near the stage's
    const above = box.y - GAP - root.offsetHeight >= EDGE;
    root.dataset.side = above ? "above" : "inside";
    root.style.left = `${cx}px`;
    root.style.top = `${above ? box.y - GAP : box.y + GAP + root.offsetHeight}px`;
  }

  return {
    show(box, selection, saved) {
      // the name box stays up while its section is still the one selected
      if (naming && saved?.id !== naming.id) nameBox.blur();
      const mode = naming ? "name" : saved ? "keys" : selection ? "save" : "";
      offered = saved;
      const key = box && mode ? `${mode},${box.x},${box.y},${box.w},${box.h},${Sections.describeBars(selection)}` : "";
      if (key === shown) return;
      shown = key;
      if (!key || !box) {
        root.hidden = true;
        return;
      }
      saveBtn.hidden = mode !== "save";
      nameBox.hidden = mode !== "name";
      keysBtn.hidden = mode !== "keys";
      if (mode === "save") {
        saveBtn.textContent = `Save ${Sections.describeBars(selection)}`;
        saveBtn.title = "Save these bars as a section";
      }
      root.hidden = false;
      place(box);
    },
  };
}
