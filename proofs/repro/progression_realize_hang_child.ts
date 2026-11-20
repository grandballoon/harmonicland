// Child of progression_realize_degenerate.ts: the call that does not return.
import { realize } from "/Users/lukesovernconley/Code/harmonicland/src/harmony/progression";
import { progressionById } from "/Users/lukesovernconley/Code/harmonicland/src/harmony/repertoire";

const opts = JSON.parse(process.argv[2] ?? "{}");
console.log(`child: calling realize(progressionById("plagal"), ${JSON.stringify(opts)})`);
const r = realize(progressionById("plagal")!, opts);
console.log(`child: RETURNED, duration ${r.duration}, ${r.barlines.length} barlines`);
