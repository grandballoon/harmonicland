/* ====================================================================
   SECTION_STORE — where saved sections live between visits. Behind one
   interface so the panel can be tested against memory and the backing
   can change without the panel noticing. Three backings:

   - memory: forgets on reload. For tests.
   - local: the browser's localStorage, one entry per score.
   - cloud: the sections API (sections-api.ts, served by api/), with
     localStorage as its cache.

   The cloud store's rules, stated because they are decisions:

   1. THE CACHE ANSWERS FIRST. `load` never waits on the network: it is
      what this browser last knew, so a score's sections are on screen the
      moment the score is. `refresh` then asks the server, and hands back
      a newer list only when the server's differs.

   2. AN EDIT IS THE CACHE'S UNTIL THE SERVER HAS IT. Every save is
      written to the cache, marked pending (in localStorage, so it
      survives a reload), and pushed. Until a push succeeds, the cache
      wins over the server for that score: an edit made offline is sent
      next time rather than overwritten by the older copy on the server.
      One learner, several browsers at most: the last write wins.

   3. A NEW ACCOUNT TAKES WHAT THE BROWSER ALREADY HAD. Sections saved
      before there was a server are marked pending the first time an
      account is minted, so the first visit uploads them.

   Storage can be missing, full, or forbidden (a private window, blocked
   site data), so every access is guarded: a load that fails is an empty
   list, and a save that fails leaves the sections working for this visit.
   ==================================================================== */
import { parse, toJSON, type Section } from "./sections";

export interface SectionStore {
  /** What this browser knows now — immediately, never the network. */
  load(scoreKey: string): readonly Section[];
  save(scoreKey: string, sections: readonly Section[]): void;
  /** A newer list from elsewhere, or null when there is none to be had:
   *  nothing differs, nothing is elsewhere, or elsewhere is unreachable. */
  refresh(scoreKey: string): Promise<readonly Section[] | null>;
}

/** The server's side, as the cloud store needs it (sections-api.ts). */
export interface RemoteSections {
  get(scoreKey: string): Promise<readonly Section[]>;
  put(scoreKey: string, sections: readonly Section[]): Promise<void>;
}

/** Whether the server has every edit: yes, a push is under way, or it
 *  could not be reached (edits are kept here, and sent later). */
export type SyncStatus = "synced" | "saving" | "offline";

export const sameSections = (a: readonly Section[], b: readonly Section[]): boolean =>
  JSON.stringify(toJSON(a)) === JSON.stringify(toJSON(b));

type StorageFn = () => Storage | null;
const browserStorage: StorageFn = () => globalThis.localStorage ?? null;

/** Versioned, so a future change of shape can read the old one. */
const PREFIX = "harmonicland.sections.v1:";

export interface LocalSectionStore extends SectionStore {
  /** Every score with sections saved here. */
  keys(): string[];
  /** Forget every score's sections. */
  clear(): void;
}

export function localSectionStore(storage: StorageFn = browserStorage): LocalSectionStore {
  const keys = (): string[] => {
    try {
      const s = storage();
      if (!s) return [];
      const out: string[] = [];
      for (let i = 0; i < s.length; i++) {
        const k = s.key(i);
        if (k?.startsWith(PREFIX)) out.push(k.slice(PREFIX.length));
      }
      return out;
    } catch {
      return [];
    }
  };
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
        else s.setItem(PREFIX + scoreKey, JSON.stringify(toJSON(sections)));
      } catch {
        // quota or permissions: this visit keeps working, the next forgets
      }
    },
    refresh: () => Promise.resolve(null),
    keys,
    clear() {
      try {
        for (const k of keys()) storage()?.removeItem(PREFIX + k);
      } catch {
        // as above
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
    refresh: () => Promise.resolve(null),
  };
}

/** The scores with edits the server has not got yet (decision 2). */
export interface PendingSet {
  has(scoreKey: string): boolean;
  add(scoreKey: string): void;
  delete(scoreKey: string): void;
  all(): string[];
  clear(): void;
}

const PENDING = "harmonicland.sections.pending.v1";

export function storedPendingSet(storage: StorageFn = browserStorage): PendingSet {
  // read once; storage that fails keeps the set for this visit only
  let set: Set<string>;
  try {
    const raw = JSON.parse(storage()?.getItem(PENDING) ?? "[]");
    set = new Set(Array.isArray(raw) ? raw.filter((k): k is string => typeof k === "string") : []);
  } catch {
    set = new Set();
  }
  const write = (): void => {
    try {
      const s = storage();
      if (!s) return;
      if (set.size === 0) s.removeItem(PENDING);
      else s.setItem(PENDING, JSON.stringify([...set]));
    } catch {
      // as above
    }
  };
  return {
    has: (k) => set.has(k),
    add: (k) => void (set.has(k) || (set.add(k), write())),
    delete: (k) => void (set.delete(k) && write()),
    all: () => [...set],
    clear: () => void (set.clear(), write()),
  };
}

export interface CloudSectionStore extends SectionStore {
  /** Push every pending score — on startup, so an edit left offline last
   *  visit is sent without waiting for its score to be opened. */
  flush(): Promise<void>;
  /** Forget everything cached and pending: the account changed. */
  reset(): void;
}

export interface CloudOptions {
  cache: LocalSectionStore;
  remote: RemoteSections;
  pending: PendingSet;
  /** Mark everything already cached as pending (decision 3). */
  uploadCache?: boolean;
  onStatus?: (s: SyncStatus) => void;
}

export function cloudSectionStore({ cache, remote, pending, uploadCache = false, onStatus = () => {} }: CloudOptions): CloudSectionStore {
  if (uploadCache) for (const k of cache.keys()) pending.add(k);

  // One push at a time per score, in order, each sending what the cache
  // holds when it starts — so a burst of edits ends with the last of them.
  const queue = new Map<string, Promise<void>>();
  let inFlight = 0;
  const report = (failed: boolean): void => {
    if (failed) onStatus("offline");
    else if (inFlight > 0) onStatus("saving");
    else onStatus(pending.all().length > 0 ? "offline" : "synced");
  };

  function push(k: string): Promise<void> {
    const next = (queue.get(k) ?? Promise.resolve()).then(async () => {
      if (!pending.has(k)) return;
      const list = cache.load(k);
      inFlight++;
      onStatus("saving");
      let failed = false;
      try {
        await remote.put(k, list);
        // an edit made while this one was on its way is still pending
        if (sameSections(cache.load(k), list)) pending.delete(k);
      } catch {
        failed = true;
      } finally {
        inFlight--;
      }
      report(failed);
    });
    queue.set(k, next);
    return next;
  }

  return {
    load: (k) => cache.load(k),
    save(k, sections) {
      cache.save(k, sections);
      pending.add(k);
      void push(k);
    },
    async refresh(k) {
      if (pending.has(k)) {
        await push(k);
        return null;
      }
      let fetched: readonly Section[];
      try {
        fetched = await remote.get(k);
      } catch {
        report(true);
        return null;
      }
      report(false);
      // edited while the answer was on its way: the edit is newer
      if (pending.has(k) || sameSections(fetched, cache.load(k))) return null;
      cache.save(k, fetched);
      return fetched;
    },
    async flush() {
      const keys = pending.all();
      if (keys.length === 0) return;
      await Promise.all(keys.map(push));
    },
    reset() {
      cache.clear();
      pending.clear();
    },
  };
}
