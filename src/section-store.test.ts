import { describe, it, expect, beforeEach } from "vitest";
import { localSectionStore } from "./section-store";
import { add } from "./sections";

describe("the localStorage section store", () => {
  beforeEach(() => localStorage.clear());

  it("keeps each score's sections apart", () => {
    const store = localSectionStore();
    store.save("file:a", add([], { from: 0, to: 3 }, "Intro"));
    store.save("file:b", add([], { from: 4, to: 4 }));
    expect(store.load("file:a").map((s) => s.name)).toEqual(["Intro"]);
    expect(store.load("file:b").map((s) => s.id)).toEqual(["4-4"]);
    expect(store.load("file:c")).toEqual([]);
  });

  it("forgets a score entirely when its last section goes", () => {
    const store = localSectionStore();
    store.save("demo", add([], { from: 0, to: 0 }));
    store.save("demo", []);
    expect(localStorage.length).toBe(0);
  });

  it("reads corrupt storage as nothing saved", () => {
    localStorage.setItem("harmonicland.sections.v1:demo", "{not json");
    expect(localSectionStore().load("demo")).toEqual([]);
  });

  it("keeps working when storage is unavailable or refuses to write", () => {
    const none = localSectionStore(() => null);
    expect(() => none.save("demo", add([], { from: 0, to: 0 }))).not.toThrow();
    expect(none.load("demo")).toEqual([]);

    const full = localSectionStore(() => ({
      ...localStorage,
      getItem: () => { throw new Error("SecurityError"); },
      setItem: () => { throw new Error("QuotaExceededError"); },
    }) as unknown as Storage);
    expect(() => full.save("demo", add([], { from: 0, to: 0 }))).not.toThrow();
    expect(full.load("demo")).toEqual([]);
  });
});

import { cloudSectionStore, memorySectionStore, storedPendingSet, type RemoteSections, type SyncStatus } from "./section-store";
import type { Section } from "./sections";

/** A server that answers when told to, and can be switched off. */
function fakeRemote() {
  const data = new Map<string, readonly Section[]>();
  let up = true;
  const puts: string[] = [];
  const remote: RemoteSections = {
    get: async (k) => {
      if (!up) throw new Error("offline");
      return data.get(k) ?? [];
    },
    put: async (k, s) => {
      if (!up) throw new Error("offline");
      puts.push(k);
      data.set(k, s);
    },
  };
  return { remote, data, puts, set up(v: boolean) { up = v; } };
}

describe("the cloud section store", () => {
  beforeEach(() => localStorage.clear());

  const make = (r: ReturnType<typeof fakeRemote>, uploadCache = false) => {
    const statuses: SyncStatus[] = [];
    const store = cloudSectionStore({
      cache: localSectionStore(), remote: r.remote, pending: storedPendingSet(), uploadCache,
      onStatus: (s) => statuses.push(s),
    });
    return { store, statuses };
  };

  it("answers from the cache at once, then hands back the server's newer list", async () => {
    const r = fakeRemote();
    r.data.set("demo", add([], { from: 0, to: 3 }, "From elsewhere"));
    const { store, statuses } = make(r);
    expect(store.load("demo")).toEqual([]);
    const fresh = await store.refresh("demo");
    expect(fresh?.map((s) => s.name)).toEqual(["From elsewhere"]);
    expect(store.load("demo").map((s) => s.name)).toEqual(["From elsewhere"]); // cached
    expect(await store.refresh("demo")).toBeNull(); // nothing newer now
    expect(statuses.at(-1)).toBe("synced");
  });

  it("sends every save, and the server ends with the last of a burst", async () => {
    const r = fakeRemote();
    const { store } = make(r);
    store.save("demo", add([], { from: 0, to: 0 }, "one"));
    store.save("demo", add([], { from: 0, to: 0 }, "two"));
    await store.flush();
    expect(r.data.get("demo")?.map((s) => s.name)).toEqual(["two"]);
    expect(storedPendingSet().all()).toEqual([]);
  });

  it("keeps an edit made offline, lets it win over the server, and sends it later", async () => {
    const r = fakeRemote();
    r.data.set("demo", add([], { from: 0, to: 3 }, "old"));
    const { store, statuses } = make(r);
    r.up = false;
    store.save("demo", add([], { from: 4, to: 7 }, "new"));
    await store.flush();
    expect(statuses.at(-1)).toBe("offline");
    expect(storedPendingSet().all()).toEqual(["demo"]); // survives a reload

    // next visit: the edit is still pending, so the server's copy loses
    r.up = true;
    const next = make(r);
    expect(await next.store.refresh("demo")).toBeNull();
    expect(next.store.load("demo").map((s) => s.name)).toEqual(["new"]);
    expect(r.data.get("demo")?.map((s) => s.name)).toEqual(["new"]);
    expect(next.statuses.at(-1)).toBe("synced");
  });

  it("uploads what the browser saved before there was an account", async () => {
    localSectionStore().save("file:a", add([], { from: 0, to: 1 }, "Kept"));
    const r = fakeRemote();
    const { store } = make(r, true);
    await store.flush();
    expect(r.data.get("file:a")?.map((s) => s.name)).toEqual(["Kept"]);
  });

  it("forgets everything cached and pending when the account changes", () => {
    const r = fakeRemote();
    r.up = false;
    const { store } = make(r);
    store.save("demo", add([], { from: 0, to: 0 }));
    store.reset();
    expect(store.load("demo")).toEqual([]);
    expect(storedPendingSet().all()).toEqual([]);
    expect(localStorage.length).toBe(0);
  });

  it("is never asked for anything by the memory and local stores", async () => {
    expect(await memorySectionStore().refresh("demo")).toBeNull();
    expect(await localSectionStore().refresh("demo")).toBeNull();
  });
});
