import { describe, it, expect, beforeEach } from "vitest";
import { localAlignmentStore } from "./alignment-store";

describe("the localStorage alignment store", () => {
  beforeEach(() => localStorage.clear());

  it("keeps each recording of each score apart", () => {
    const store = localAlignmentStore();
    store.save("file:a", "rec:1", [{ bar: 0, at: 1 }]);
    store.save("file:a", "rec:2", [{ bar: 0, at: 4 }]);
    store.save("file:b", "rec:1", [{ bar: 2, at: 9 }]);
    expect(store.load("file:a", "rec:1")).toEqual([{ bar: 0, at: 1 }]);
    expect(store.load("file:a", "rec:2")).toEqual([{ bar: 0, at: 4 }]);
    expect(store.load("file:b", "rec:1")).toEqual([{ bar: 2, at: 9 }]);
    expect(store.load("file:b", "rec:2")).toEqual([]);
  });

  it("forgets a recording entirely when its last barline goes", () => {
    const store = localAlignmentStore();
    store.save("demo", "rec", [{ bar: 0, at: 1 }]);
    store.save("demo", "rec", []);
    expect(localStorage.length).toBe(0);
  });

  it("reads corrupt storage as nothing placed", () => {
    localStorage.setItem("harmonicland.alignment.v1:demo|rec", "{not json");
    expect(localAlignmentStore().load("demo", "rec")).toEqual([]);
  });

  it("keeps working when storage is unavailable or refuses to write", () => {
    const none = localAlignmentStore(() => null);
    none.save("demo", "rec", [{ bar: 0, at: 1 }]);
    expect(none.load("demo", "rec")).toEqual([]);
    const full = localAlignmentStore(() => ({
      getItem: () => null,
      setItem: () => { throw new Error("quota"); },
      removeItem: () => {},
    }) as unknown as Storage);
    expect(() => full.save("demo", "rec", [{ bar: 0, at: 1 }])).not.toThrow();
  });
});
