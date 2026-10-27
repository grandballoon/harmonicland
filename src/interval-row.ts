/* ====================================================================
   INTERVAL_ROW — the tray's intervals row: which relations of a pressed
   key echo (echoes.ts), and how. A switch per interval per direction, so
   "a major third up and a minor sixth down" is two switches; beside them,
   whether the echoes sound with the key or after it, and a way to turn
   them all off at once. None chosen is echoes off: there is no separate
   on switch to disagree with the choice.

   The switches are built from the one catalogue (intervals.ts), so this
   row cannot offer an interval the keys would not know how to name.

   Remembered across visits. Storage can be missing or forbidden, so every
   access is guarded: a load that fails is the defaults, a save that fails
   forgets on reload.
   ==================================================================== */
import { ARROW, INTERVALS, describe, isRelation, label, relationKey, type Direction, type Relation } from "./intervals";
import type { EchoSettings } from "./echoes";

export interface IntervalRowElements {
  /** Where the switches go: a line of them per direction. */
  chips: HTMLElement;
  timing: HTMLSelectElement;
  clear: HTMLButtonElement;
}

export interface IntervalRowDeps {
  /** The echoes to sound from now on. Called once at mount with the remembered choice. */
  set(s: EchoSettings): void;
  storage?: () => Storage | null;
}

/** Versioned, so a future change of shape can read the old one. */
const KEY = "harmonicland.echoes.v1";
const DIRS: readonly Direction[] = ["up", "down"];

function load(storage: () => Storage | null): EchoSettings {
  try {
    const raw = storage()?.getItem(KEY);
    const v = raw ? (JSON.parse(raw) as Partial<EchoSettings>) : {};
    const relations = Array.isArray(v.relations) ? v.relations.filter(isRelation) : [];
    return { relations, timing: v.timing === "after" ? "after" : "together" };
  } catch {
    return { relations: [], timing: "together" };
  }
}

function save(storage: () => Storage | null, s: EchoSettings): void {
  try {
    storage()?.setItem(KEY, JSON.stringify(s));
  } catch {
    // quota or permissions: this visit keeps working, the next forgets
  }
}

export function mountIntervalRow({ chips, timing, clear }: IntervalRowElements, deps: IntervalRowDeps): void {
  const storage = deps.storage ?? (() => globalThis.localStorage ?? null);
  const chosen = new Map<string, Relation>();
  const loaded = load(storage);
  for (const r of loaded.relations) chosen.set(relationKey(r), r);
  timing.value = loaded.timing;

  const settings = (): EchoSettings => ({
    relations: [...chosen.values()],
    timing: timing.value === "after" ? "after" : "together",
  });
  const buttons: HTMLButtonElement[] = [];
  const show = (): void => {
    for (const b of buttons) b.setAttribute("aria-pressed", String(chosen.has(b.dataset.relation!)));
    clear.disabled = chosen.size === 0;
  };
  const changed = (): void => {
    show();
    const s = settings();
    save(storage, s);
    deps.set(s);
  };

  for (const dir of DIRS) {
    const arrow = document.createElement("span");
    arrow.className = "interval-dir";
    arrow.textContent = ARROW[dir];
    arrow.setAttribute("aria-hidden", "true");
    chips.append(arrow);
    for (const { semitones, name } of INTERVALS) {
      const r: Relation = { semitones, dir };
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = name;
      b.dataset.relation = relationKey(r);
      b.title = `Echo the ${describe(r)} from each key you press`;
      b.setAttribute("aria-label", `${label(r)}, ${describe(r)}`);
      b.addEventListener("click", () => {
        const k = relationKey(r);
        if (chosen.has(k)) chosen.delete(k);
        else chosen.set(k, r);
        changed();
      });
      buttons.push(b);
      chips.append(b);
    }
  }

  timing.addEventListener("change", () => {
    changed();
    timing.blur(); // a closed <select> keeps focus and swallows the arrow keys
  });
  clear.addEventListener("click", () => {
    chosen.clear();
    changed();
  });

  show();
  deps.set(settings());
}
