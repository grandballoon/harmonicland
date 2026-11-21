import { describe, it, expect } from "vitest";
import {
  add, addAll, canSplit, chunk, depths, describeBars, find, findAny, holds, keyForBytes, labelOf, parse, remove,
  rename, retarget, split, subdivide, toJSON,
} from "./sections";

/* sections.ts is a list of named bar ranges and the rules for editing it.
   Bars from 0 here; only describeBars speaks bar numbers. */

describe("saving sections", () => {
  it("keeps the list in outline order, whatever order they were saved in", () => {
    const list = add(add(add([], { from: 8, to: 11 }), { from: 0, to: 1 }), { from: 0, to: 3 });
    // by start; the longer, which holds the shorter, first
    expect(list.map((s) => s.id)).toEqual(["0-3", "0-1", "8-11"]);
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

describe("sections that begin or end inside a bar", () => {
  it("are their own sections, apart from the whole bars around them", () => {
    const list = add(add(add([], { from: 2, to: 7 }), { from: 2, fromBeat: 1, to: 7 }), { from: 2, to: 7, toBeat: 2 });
    // outline order: bars 3–8 whole holds the run that stops inside bar 8
    expect(list.map((s) => s.id)).toEqual(["2-7", "2-7@2", "2@1-7"]);
    expect(find(list, { from: 2, fromBeat: 1, to: 7 })?.id).toBe("2@1-7");
  });

  it("name their beats, counted from one", () => {
    expect(describeBars({ from: 2, fromBeat: 1, to: 7 })).toBe("bar 3 beat 2 – bar 8");
    expect(describeBars({ from: 2, to: 7, toBeat: 2.5 })).toBe("bar 3 – bar 8 beat 3.5");
    expect(describeBars({ from: 4, fromBeat: 1, to: 4, toBeat: 3 })).toBe("bar 5 beat 2–4");
    expect(describeBars({ from: 4, fromBeat: 1, to: 4 })).toBe("bar 5 beat 2–end");
    expect(describeBars({ from: 1, fromBeat: 1 / 3, to: 2 })).toBe("bar 2 beat 1.33 – bar 3");
  });

  it("round-trip through JSON, trims and all, and drop a trim that is no beat", () => {
    const list = add([], { from: 2, fromBeat: 1.5, to: 3, toBeat: 2 }, "Pickup");
    expect(parse(JSON.parse(JSON.stringify(list)))).toEqual(list);
    expect(parse([{ range: { from: 0, to: 1, fromBeat: -1 }, name: "" }, { range: { from: 0, to: 1, toBeat: "2" }, name: "" }])).toEqual([]);
  });
});

describe("fine-tuning a saved section", () => {
  it("moves it to new bars, keeping its name", () => {
    const list = rename(add([], { from: 2, to: 7 }), "2-7", "Theme");
    const moved = retarget(list, "2-7", { from: 2, fromBeat: 1, to: 7 });
    expect(moved.map((s) => [s.id, s.name])).toEqual([["2@1-7", "Theme"]]);
  });

  it("refuses to move it onto bars that are already a section", () => {
    const list = add(add([], { from: 2, to: 7 }), { from: 0, to: 1 });
    expect(retarget(list, "2-7", { from: 0, to: 1 })).toBe(list);
    expect(retarget(list, "gone", { from: 4, to: 5 })).toBe(list);
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

describe("a section's hand", () => {
  it("saves the same bars once per hand, both hands first", () => {
    let list = add([], { from: 0, to: 3 }, "", "lower");
    list = add(list, { from: 0, to: 3 }, "", "upper");
    list = add(list, { from: 0, to: 3 });
    expect(list.map((s) => s.id)).toEqual(["0-3", "0-3:R", "0-3:L"]);
    expect(add(list, { from: 0, to: 3 }, "again", "upper")).toBe(list);
  });

  it("is found by bars and hand, or by bars alone where no hand is known", () => {
    const list = add([], { from: 0, to: 3 }, "", "lower");
    expect(find(list, { from: 0, to: 3 })).toBeUndefined();
    expect(find(list, { from: 0, to: 3 }, "lower")?.id).toBe("0-3:L");
    expect(findAny(list, { from: 0, to: 3 }, "upper")?.id).toBe("0-3:L");
    expect(findAny(add(list, { from: 0, to: 3 }, "", "upper"), { from: 0, to: 3 }, "upper")?.id).toBe("0-3:R");
  });

  it("wears its tag in its label, and keeps it through a move", () => {
    let list = add([], { from: 0, to: 3 }, "Run", "upper");
    expect(labelOf(list[0])).toBe("Run (R)");
    list = retarget(list, "0-3:R", { from: 1, to: 3 });
    expect(list.map((s) => [s.id, s.name, s.hand])).toEqual([["1-3:R", "Run", "upper"]]);
    // another hand's section of those bars does not block the move
    expect(retarget(add(list, { from: 2, to: 3 }), "1-3:R", { from: 2, to: 3 }).map((s) => s.id)).toEqual(["2-3", "2-3:R"]);
  });

  it("is stored only when it is one hand's, and read back; an old entry is both hands", () => {
    const list = add(add([], { from: 0, to: 0 }), { from: 1, to: 1 }, "x", "lower");
    expect(toJSON(list)).toEqual([{ range: { from: 0, to: 0 }, name: "" }, { range: { from: 1, to: 1 }, name: "x", hand: "lower" }]);
    expect(parse(toJSON(list))).toEqual(list);
    expect(parse([{ range: { from: 0, to: 0 }, name: "", hand: "feet" }])[0].hand).toBe("both");
  });
});

describe("sub-runs", () => {
  it("cut a range into runs, keeping its trims at its ends", () => {
    expect(subdivide({ from: 2, to: 8, fromBeat: 1, toBeat: 2 }, 3)).toEqual([
      { from: 2, to: 4, fromBeat: 1 }, { from: 5, to: 7 }, { from: 8, to: 8, toBeat: 2 },
    ]);
    expect(subdivide({ from: 2, to: 3 }, 4)).toEqual([{ from: 2, to: 3 }]);
  });

  it("are added beside the section, for its hand, and leave it as it was", () => {
    const list = add([], { from: 0, to: 3 }, "Theme", "upper");
    const next = split(list, "0-3:R", 2);
    expect(next.map((s) => s.id)).toEqual(["0-3:R", "0-1:R", "2-3:R"]);
    expect(next[0]).toBe(list[0]);
    expect(canSplit(next, "0-3:R", 2)).toBe(false); // nothing more to add
    expect(canSplit(list, "0-3:R", 4)).toBe(false); // already one run of 4
    expect(split(list, "gone", 2)).toBe(list);
  });

  it("sit under every section that holds them: same bars or wider, same hand or both", () => {
    let list = add([], { from: 0, to: 7 });
    list = add(list, { from: 0, to: 3 }, "", "upper");
    list = add(list, { from: 0, to: 1 }, "", "upper");
    list = add(list, { from: 0, to: 1 }, "", "lower");
    list = add(list, { from: 8, to: 9 });
    expect(list.map((s) => s.id)).toEqual(["0-7", "0-3:R", "0-1:R", "0-1:L", "8-9"]);
    expect(depths(list)).toEqual([0, 1, 2, 1, 0]);
    const [whole, right] = list;
    expect(holds(whole, right)).toBe(true);
    expect(holds(right, whole)).toBe(false);
    expect(holds(right, list[3])).toBe(false); // the right hand holds no left-hand run
  });
});
