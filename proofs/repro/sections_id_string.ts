// EVIDENCE (not a proof) for the one thing Sections.lean does not model: that the STRING idOf
// builds (sections.ts:40) is injective on the ranges parse() admits. Ids of many awkward-but-valid
// ranges are checked pairwise distinct; then the inputs outside parse()'s guards are shown.
import { add } from "/Users/lukesovernconley/Code/harmonicland/src/sections";
const id = (r: { from: number; to: number; fromBeat?: number; toBeat?: number }) => add([], r)[0].id;
const bars = [0, 1, 2, 5, 7, 10, 17, 1e21, 1e22];
const trims = [undefined, 1e-7, 1e-6, 5e-324, 0.1, 1, 1.5, 2, 5, 7, 1e21, 1e-7 + 1e-22, 1 / 3];
const seen = new Map<string, string>();
let n = 0, clashes = 0;
for (const from of bars) for (const to of bars) for (const fromBeat of trims) for (const toBeat of trims) {
  if (from > to) continue;
  const r = { from, to, ...(fromBeat !== undefined && { fromBeat }), ...(toBeat !== undefined && { toBeat }) };
  const key = JSON.stringify([from, fromBeat ?? null, to, toBeat ?? null]);
  const s = id(r);
  n++;
  if (seen.has(s) && seen.get(s) !== key) { clashes++; console.log("CLASH", s, key, seen.get(s)); }
  seen.set(s, key);
}
console.log(`${n} valid ranges, ${seen.size} distinct ids, ${clashes} clashes`);
console.log("examples:", id({ from: 1, fromBeat: 1e-7, to: 5 }), "|", id({ from: 1e21, to: 1e21 }), "|", id({ from: 1, to: 5, toBeat: 1e-7 }));
console.log("-0 and 0 (the same bar; both pass isBar) share an id:", id({ from: -0, to: 1 }), id({ from: 0, to: 1 }));
