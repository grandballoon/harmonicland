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
