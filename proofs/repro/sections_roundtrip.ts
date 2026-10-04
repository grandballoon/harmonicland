// FAILS_load_save_roundtrip_unvalidated_range, FAILS_load_save_roundtrip_zero_trim
// (proofs/Harmonicland/Sections.lean). Claim (section-store.ts header; sections.test.ts:62,100
// "round-trips through JSON"): what save() wrote, load() reads back. Holds only for ranges
// parse() admits (sections.ts:135); add()/retarget() admit anything.
import { add, retarget } from "/Users/lukesovernconley/Code/harmonicland/src/sections";
import { localSectionStore } from "/Users/lukesovernconley/Code/harmonicland/src/section-store";

const mem = new Map<string, string>();
const storage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
} as unknown as Storage;
const store = localSectionStore(() => storage);

const show = (label: string, list: readonly { id: string; name: string }[]) =>
  console.log(label, JSON.stringify(list.map((s) => [s.id, s.name])));

for (const [what, range] of [
  ["from > to", { from: 3, to: 1 }],
  ["fromBeat: 0", { from: 1, to: 2, fromBeat: 0 }],
  ["toBeat: -1", { from: 1, to: 2, toBeat: -1 }],
  ["valid (control)", { from: 1, to: 2, fromBeat: 1.5 }],
] as const) {
  const list = add(add([], { from: 0, to: 0 }, "Intro"), range, "Theme");
  store.save("k", list);
  console.log(`\nadd(…, ${JSON.stringify(range)})   [${what}]`);
  show("  saved            :", list);
  show("  claim : load() =  ", list);
  show("  actual: load() =  ", store.load("k"));
}

const moved = retarget(add([], { from: 0, to: 3 }, "Theme"), "0-3", { from: 5, to: 2 });
store.save("k", moved);
console.log("\nretarget(…, '0-3', {from:5,to:2})");
show("  saved            :", moved);
show("  actual: load() =  ", store.load("k"));
