/* ====================================================================
   GAMEPAD_REMAP — the panel where the player re-binds the pad for the
   Nashville (chord coloration) view, and the one place the choice is
   persisted.

   It owns no mapping knowledge. The physical vocabulary (CONTROLS), the
   functional one (ACTION_CHOICES), and the current table (getBindings) all
   come from gamepad-perfecto; this file only turns them into DOM and hands
   an edited table back through setBindings. So a new action appears in every
   menu the moment it joins that catalog, and the on-screen legend follows
   the same table without either module knowing about the other.

   The mapping stays ignorant of the DOM and of storage, which is why the
   localStorage read/write lives here: it is a property of this browser
   profile, not of the instrument.
   ==================================================================== */
import {
  ACTION_CHOICES,
  CONTROLS,
  DEFAULT_BINDINGS,
  controlMap,
  getBindings,
  isActionId,
  setBindings,
  type ActionId,
  type Bindings,
} from "../gamepad-perfecto";

// Versioned: a saved table outlives the defaults it was derived from, so when
// a default layout changes for a REASON — v2 moved octave off the stick clicks,
// where an accidental click transposed the instrument for good — the old key is
// abandoned rather than silently reinstating the hazard. Bump only for that
// kind of change; a stored v2 table still wins over the defaults.
const STORE_KEY = "notation-animator.perfecto.bindings.v2";
const UNBOUND = ""; // the select's "nothing" value — an absent key in Bindings

// pure: stored JSON -> a Bindings table, keeping only entries this build
// still understands. A hand-edited or stale value can't wedge the input
// layer; the worst case is a button that falls back to unbound.
export function parseBindings(raw: string | null): Bindings | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const out: Record<number, ActionId> = {};
  for (const [key, value] of Object.entries(data)) {
    const index = Number(key);
    if (Number.isInteger(index) && isActionId(value)) out[index] = value;
  }
  return out;
}

// storage is a nicety, never a requirement: private mode / disabled storage
// throws on access, and the instrument plays on with the defaults.
const readStore = (): string | null => {
  try {
    return localStorage.getItem(STORE_KEY);
  } catch {
    return null;
  }
};

const writeStore = (b: Bindings): void => {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(b));
  } catch {
    /* no storage here — the session's bindings still work */
  }
};

/** Apply the saved binding table, if this browser has one. Call once at
 *  startup, before the first frame draws the legend. */
export function restore(): void {
  const saved = parseBindings(readStore());
  if (saved) setBindings(saved);
}

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K, cls?: string, txt?: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (txt) node.textContent = txt;
  return node;
};

const headRow = (title: string): HTMLTableRowElement => {
  const tr = el("tr", "section-head");
  const td = el("td", undefined, title);
  td.colSpan = 2;
  tr.appendChild(td);
  return tr;
};

const infoRow = (name: string, desc: string): HTMLTableRowElement => {
  const tr = el("tr");
  tr.append(el("td", "btn", name), el("td", "desc", desc));
  return tr;
};

/** Build the remap panel inside `host` (replacing its contents). Every edit
 *  takes effect immediately — the Nashville view redraws its legend from the
 *  same table on the next frame. */
export function mount(host: HTMLElement): void {
  const selects = new Map<number, HTMLSelectElement>();

  // collect every select into a fresh table and install it
  const apply = (): void => {
    const next: Record<number, ActionId> = {};
    for (const [index, sel] of selects) {
      if (isActionId(sel.value)) next[index] = sel.value;
    }
    setBindings(next);
    writeStore(next);
  };

  const showCurrent = (): void => {
    const current = getBindings();
    for (const [index, sel] of selects) sel.value = current[index] ?? UNBOUND;
  };

  const table = el("table");
  const body = el("tbody");
  table.appendChild(body);

  body.appendChild(headRow("Buttons — any button, any function"));
  for (const control of CONTROLS) {
    const tr = el("tr");
    const sel = el("select");
    sel.appendChild(new Option("— unbound —", UNBOUND));
    for (const choice of ACTION_CHOICES) sel.appendChild(new Option(choice.name, choice.id));
    sel.setAttribute("aria-label", `Function for ${control.label}`);
    sel.addEventListener("change", apply);
    selects.set(control.index, sel);

    const cell = el("td");
    cell.appendChild(sel);
    tr.append(el("td", "btn", control.label), cell);
    body.appendChild(tr);
  }

  // The sticks are analog, not buttons, so they aren't part of the binding
  // table — but the player still needs to read what they do. Straight from
  // the same controlMap() the legend draws.
  const cm = controlMap();
  const stickName = (side: "left" | "right" | null): string =>
    side === null ? "—" : side === "left" ? "L stick" : "R stick";
  body.appendChild(headRow("Sticks"));
  body.appendChild(infoRow(stickName(cm.chordStick), "Chords ii–vii° — push toward the number"));
  body.appendChild(infoRow(stickName(cm.colorStick), "Coloration — tilt to morph the chord"));

  const reset = el("button", "step", "Reset to defaults");
  reset.type = "button";
  reset.addEventListener("click", () => {
    setBindings(DEFAULT_BINDINGS);
    writeStore(DEFAULT_BINDINGS);
    showCurrent();
  });

  const foot = el("div", "panel-foot");
  foot.appendChild(reset);
  foot.appendChild(el("span", "panel-note", "Saved in this browser"));

  host.replaceChildren(table, foot);
  showCurrent();
}

export const GamepadRemap = { mount, restore, parseBindings };
