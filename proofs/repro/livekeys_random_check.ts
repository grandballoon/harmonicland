/* LiveKeys.lean proves its invariant about a hand translation. This runs the
   REAL LiveKeys + Sound through random call sequences — including calls made
   re-entrantly from inside an onPress listener — and checks the same
   statements after every call, as evidence the translation is faithful:
     output_follows_audible, output_told_once, exclusive, held_iff,
     releaseAll_invalidates, release_idempotent. No failure is expected. */
import { Sound } from "/Users/lukesovernconley/Code/harmonicland/src/outputs/sound";
import { LiveKeys, type Voice } from "/Users/lukesovernconley/Code/harmonicland/src/live-keys";
import type { Output } from "/Users/lukesovernconley/Code/harmonicland/src/types";

let violations = 0;
const fail = (msg: string): void => { violations++; if (violations <= 10) console.log("  VIOLATION:", msg); };

/** A recording output: which keys it has been told are on, and whether any
 *  message was redundant. */
const makeOut = (name: string) => {
  const on = new Set<number>();
  const out: Output = {
    strike: () => {}, advance: () => {}, pedal: () => {}, flush: () => {}, latency: () => 0,
    liveOn: (p) => { if (on.has(p)) fail(`${name} told on(${p}) twice`); on.add(p); },
    liveOff: (p) => { if (!on.has(p)) fail(`${name} told off(${p}) while off`); on.delete(p); },
    detach: () => on.clear(),
  };
  return { out, on, name };
};
const outs = [makeOut("A"), makeOut("B"), makeOut("C")];
let active = 0;
Sound.use(outs[0].out); // off the built-in piano, which needs an AudioContext

// a small deterministic PRNG, so a run can be repeated
let seed = 12345;
const rnd = (n: number): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };

const handles: { v: Voice; silent: boolean; live: boolean }[] = [];
const check = (where: string): void => {
  const liveHandles = handles.filter((h) => h.live);
  for (const h of handles) if (LiveKeys.isLive(h.v) !== h.live) fail(`${where}: isLive disagrees for a handle on ${h.v.pitch}`);
  const audible = new Set(liveHandles.filter((h) => !h.silent).map((h) => h.v.pitch));
  const heldWant = new Set(liveHandles.map((h) => h.v.pitch));
  const eq = (a: Set<number>, b: ReadonlySet<number>) => a.size === b.size && [...a].every((x) => b.has(x));
  if (!eq(audible, outs[active].on)) fail(`${where}: active output on=${JSON.stringify([...outs[active].on])} audible=${JSON.stringify([...audible])}`);
  outs.forEach((o, i) => { if (i !== active && o.on.size > 0) fail(`${where}: inactive output ${o.name} still has keys on`); });
  if (!eq(heldWant, LiveKeys.held())) fail(`${where}: held() disagrees`);
};

let depth = 0, calls = 0, reentrant = 0;
const step = (): void => {
  calls++;
  if (depth > 0) reentrant++;
  const op = rnd(100);
  if (op < 45) {
    const pitch = 60 + rnd(4), silent = rnd(4) === 0;
    const rec = { v: null as unknown as Voice, silent, live: true };
    handles.push(rec);
    // the listener below runs INSIDE this call, before the handle is returned:
    // it finds the record through pendingRec
    pendingRec.push(rec);
    rec.v = LiveKeys.press(pitch, { silent });
  } else if (op < 80 && handles.length > 0) {
    const h = handles[rnd(handles.length)];
    if (h.v) { LiveKeys.release(h.v); h.live = false; LiveKeys.release(h.v); } // twice: idempotent
  } else if (op < 88) {
    LiveKeys.releaseAll();
    for (const h of handles) if (h.v) h.live = false;
  } else {
    active = rnd(outs.length);
    Sound.use(outs[active].out);
  }
};
const pendingRec: { v: Voice; silent: boolean; live: boolean }[] = [];
LiveKeys.onPress((v) => {
  const rec = pendingRec.pop()!;
  rec.v = v; // identity is known to the listener before press() returns
  check("inside listener");
  if (depth < 3 && rnd(3) === 0) { depth++; step(); if (rnd(2) === 0) step(); depth--; check("inside listener, after re-entrant calls"); }
});

for (let i = 0; i < 20000; i++) { step(); check(`after call ${i}`); }
LiveKeys.releaseAll();
for (const h of handles) h.live = false;
check("after final releaseAll");
console.log(`calls: ${calls} (of which ${reentrant} made from inside an onPress listener); handles issued: ${handles.length}; violations: ${violations}`);
