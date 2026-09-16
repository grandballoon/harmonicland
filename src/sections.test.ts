import { describe, it, expect } from "vitest";
import { add, addAll, chunk, describeBars, find, keyForBytes, labelOf, parse, remove, rename } from "./sections";

/* sections.ts is a list of named bar ranges and the rules for editing it.
   Bars from 0 here; only describeBars speaks bar numbers. */

describe("saving sections", () => {
  it("keeps the list in score order, whatever order they were saved in", () => {
    const list = add(add(add([], { from: 8, to: 11 }), { from: 0, to: 3 }), { from: 0, to: 1 });
    expect(list.map((s) => s.id)).toEqual(["0-1", "0-3", "8-11"]);
  });

  it("saves a range once: the same bars again leave the list as it was", () => {
    const once = add([], { from: 2, to: 5 }, "A theme");
    expect(add(once, { from: 2, to: 5 }, "again")).toBe(once);
  });

  it("finds the section of exactly the selected bars, and none for the whole piece", () => {
    const list = add([], { from: 2, to: 5 });
    expect(find(list, { from: 2, to: 5 })?.id).toBe("2-5");
    expect(find(list, { from: 2, to: 6 })).toBeUndefined();
    expect(find(list, null)).toBeUndefined();
  });

  it("renames by id, and an empty name falls back to the bars", () => {
    let list = add([], { from: 2, to: 5 });
    list = rename(list, "2-5", "  B section ");
    expect(labelOf(list[0])).toBe("B section");
    list = rename(list, "2-5", "   ");
    expect(labelOf(list[0])).toBe("bars 3–6");
  });

  it("removes by id", () => {
    const list = addAll([], [{ from: 0, to: 0 }, { from: 1, to: 1 }]);
    expect(remove(list, "0-0").map((s) => s.id)).toEqual(["1-1"]);
  });
});

describe("describing bars", () => {
  it("counts from one, as a musician does", () => {
    expect(describeBars({ from: 0, to: 0 })).toBe("bar 1");
    expect(describeBars({ from: 2, to: 7 })).toBe("bars 3–8");
    expect(describeBars(null)).toBe("the whole piece");
  });
});

describe("splitting a score into chunks", () => {
  it("cuts runs of the given size, the last one short", () => {
    expect(chunk(10, 4)).toEqual([{ from: 0, to: 3 }, { from: 4, to: 7 }, { from: 8, to: 9 }]);
  });

  it("treats a size below one as one bar", () => {
    expect(chunk(2, 0)).toEqual([{ from: 0, to: 0 }, { from: 1, to: 1 }]);
  });

  it("keeps the names of chunks already saved", () => {
    const named = add([], { from: 0, to: 3 }, "Opening");
    const list = addAll(named, chunk(8, 4));
    expect(list.map(labelOf)).toEqual(["Opening", "bars 5–8"]);
  });
});

describe("reading saved sections back", () => {
  it("round-trips through JSON", () => {
    const list = addAll(add([], { from: 4, to: 7 }, "Bridge"), [{ from: 0, to: 3 }]);
    expect(parse(JSON.parse(JSON.stringify(list)))).toEqual(list);
  });

  it("drops what does not parse and keeps the rest", () => {
    const got = parse([
      { range: { from: 0, to: 1 }, name: "ok" },
      { range: { from: 3, to: 1 } },
      { range: { from: -1, to: 1 } },
      { range: { from: 0.5, to: 1 } },
      { name: "no range" },
      null,
      { range: { from: 2, to: 2 }, name: 7 },
    ]);
    expect(got.map((s) => [s.id, s.name])).toEqual([["0-1", "ok"], ["2-2", ""]]);
  });

  it("reads anything but an array as nothing saved", () => {
    expect(parse({})).toEqual([]);
    expect(parse(null)).toEqual([]);
  });
});

describe("a score's key", () => {
  const bytes = (s: string) => new TextEncoder().encode(s);

  it("is the same for the same bytes, whatever the file was called", () => {
    expect(keyForBytes(bytes("MThd…"))).toBe(keyForBytes(bytes("MThd…")));
  });

  it("differs when the content does, even by one byte", () => {
    expect(keyForBytes(bytes("MThd a"))).not.toBe(keyForBytes(bytes("MThd b")));
  });
});
