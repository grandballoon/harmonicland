/* ====================================================================
   SECTION_CHIPS — a score's saved sections in the header's top right, one
   chip each, so a section is a click away without opening the tray, and
   the switch that marks them on the sheet music (range-marks.ts, decision
   4). It owns its own DOM (the markup is index.html's #section-bar) and
   nothing else: the list is sections-panel.ts's, handed in by setList
   whenever it changes, and what picking a chip or flipping the switch
   MEANS is main.ts's, handed back through onPick and onShow. A one-hand
   section's chip wears its hand's tag and colour.
   ==================================================================== */
import { Sections, type Section } from "./sections";
import type { BarRange } from "./types";
import type { HandFilter } from "./steps";

export interface SectionChips {
  /** The sections to offer, in score order. None hides the bar. */
  setList(list: readonly Section[]): void;
  /** The bars currently selected, or null for the whole piece, and the
   *  hand chosen: the chip of exactly those bars for that hand is lit. */
  setSelection(range: BarRange | null, hand: HandFilter): void;
}

export interface ChipActions {
  /** A chip was clicked. */
  onPick(s: Section): void;
  /** The marks switch was flipped: show them on the sheet music, or not. */
  onShow(on: boolean): void;
}

export function mountSectionChips(root: HTMLElement, { onPick, onShow }: ChipActions): SectionChips {
  const toggle = root.querySelector(".marks-toggle") as HTMLButtonElement;
  const chipsEl = root.querySelector(".section-chips") as HTMLElement;

  let list: readonly Section[] = [];
  let selection: BarRange | null = null;
  let hand: HandFilter = "both";

  toggle.addEventListener("click", () => {
    const on = toggle.getAttribute("aria-pressed") !== "true";
    toggle.setAttribute("aria-pressed", String(on));
    onShow(on);
  });

  function chip(s: Section): HTMLButtonElement {
    const b = document.createElement("button");
    b.className = "section-chip";
    b.dataset.id = s.id;
    b.dataset.hand = s.hand;
    b.textContent = Sections.labelOf(s);
    b.title = [s.name, Sections.describeBars(s.range), Sections.handName(s.hand)].filter(Boolean).join(" · ");
    b.addEventListener("click", () => onPick(list.find((x) => x.id === s.id) ?? s));
    return b;
  }

  function mark(): void {
    const current = Sections.find(list, selection, hand);
    for (const b of chipsEl.querySelectorAll<HTMLButtonElement>(".section-chip"))
      b.setAttribute("aria-pressed", String(b.dataset.id === current?.id));
  }

  return {
    setList(next) {
      list = next;
      chipsEl.replaceChildren(...list.map(chip));
      root.hidden = list.length === 0;
      mark();
    },
    setSelection(r, h) {
      selection = r;
      hand = h;
      mark();
    },
  };
}
