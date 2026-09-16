/* ====================================================================
   SECTION_STORE — where saved sections live between visits: the
   browser's localStorage, one entry per score. Behind an interface so the
   panel can be tested against memory and the backing can change (a file
   export, a sync service) without the panel noticing.

   Storage can be missing, full, or forbidden (a private window, blocked
   site data), so every access is guarded: a load that fails is an empty
   list, and a save that fails leaves the sections working for this visit.
   ==================================================================== */
import { parse, type Section } from "./sections";

export interface SectionStore {
  load(scoreKey: string): readonly Section[];
  save(scoreKey: string, sections: readonly Section[]): void;
}

/** Versioned, so a future change of shape can read the old one. */
const PREFIX = "harmonicland.sections.v1:";

export function localSectionStore(storage: () => Storage | null = () => globalThis.localStorage ?? null): SectionStore {
  return {
    load(scoreKey) {
      try {
        const raw = storage()?.getItem(PREFIX + scoreKey);
        return raw ? parse(JSON.parse(raw)) : [];
      } catch {
        return [];
      }
    },
    save(scoreKey, sections) {
      try {
        const s = storage();
        if (!s) return;
        if (sections.length === 0) s.removeItem(PREFIX + scoreKey);
        else s.setItem(PREFIX + scoreKey, JSON.stringify(sections.map(({ range, name }) => ({ range, name }))));
      } catch {
        // quota or permissions: this visit keeps working, the next forgets
      }
    },
  };
}

/** A store that forgets on reload — for tests. */
export function memorySectionStore(): SectionStore {
  const data = new Map<string, readonly Section[]>();
  return {
    load: (k) => data.get(k) ?? [],
    save: (k, s) => void data.set(k, s),
  };
}
