// Repro for Progression.lean: FAILS_realize_terminates(_beatsPerBar_zero),
// FAILS_barlines_increasing_beatSec_zero, FAILS_entries_positive_beats_zero.
// Claims: realize(p, o): Realized (progression.ts:327) returns; barlines are
// "Bar boundaries in seconds, fence-post style" (progression.ts:255); entryAt
// gives "The entry covering score time `t`" (progression.ts:371).
import { spawnSync } from "node:child_process";
import { realize, entryAt, type Progression } from "/Users/lukesovernconley/Code/harmonicland/src/harmony/progression";
import { progressionById } from "/Users/lukesovernconley/Code/harmonicland/src/harmony/repertoire";

const plagal = progressionById("plagal")!;

console.log("== control: defaults ==");
const ok = realize(plagal);
console.log(`duration ${ok.duration}, barlines at [${ok.barlines.map((b) => (b as { at: number }).at)}]`);

console.log("== beatSec: 0 ==");
const z = realize(plagal, { beatSec: 0 });
console.log(`duration ${z.duration}, barlines at [${z.barlines.map((b) => (b as { at: number }).at)}]   claim: fence posts, each after the last`);
console.log(`note durations: [${[...new Set(z.notes.map((n) => n.duration))]}]`);

console.log("== a change with beats: 0 ==");
const zero: Progression = { ...plagal, changes: [{ ...plagal.changes[0], beats: 0 }] };
const zb = realize(zero);
console.log(`entries: ${JSON.stringify(zb.chart.entries)}`);
console.log(`entryAt(chart, 0) = ${JSON.stringify(entryAt(zb.chart, 0))}   claim: the entry covering t = 0`);

// The non-terminating calls run in a child process with a small heap and a
// time limit, so this script itself always finishes.
const child = "/Users/lukesovernconley/Code/harmonicland/proofs/repro/progression_realize_hang_child.ts";
const viteNode = "/Users/lukesovernconley/Code/harmonicland/node_modules/.bin/vite-node";
for (const opts of [{ cycles: 1 }, { beatsPerBar: 0 }, { beatsPerBar: -4 }, { beatSec: -0.5, cycles: 1 }]) {
  console.log(`== child process: realize(plagal, ${JSON.stringify(opts)}), 5 s limit, 256 MB heap ==`);
  const r = spawnSync(process.execPath, ["--max-old-space-size=256", viteNode, child, JSON.stringify(opts)],
    { timeout: 5000, encoding: "utf8", cwd: "/Users/lukesovernconley/Code/harmonicland" });
  const out = (r.stdout ?? "").trim().split("\n").map((l) => "   " + l).join("\n");
  console.log(out);
  const err = (r.stderr ?? "").split("\n").filter((l) => /FATAL|RangeError|heap|Error/.test(l)).slice(0, 2);
  console.log(`   exit status ${r.status}, signal ${r.signal}${r.error ? `, ${(r.error as NodeJS.ErrnoException).code}` : ""}` +
    (err.length ? `\n   stderr: ${err.join(" | ")}` : ""));
  console.log(`   claim: the call returns a Realized.  actual: ${/RETURNED/.test(r.stdout ?? "") ? "returned" : "DID NOT RETURN"}`);
}
