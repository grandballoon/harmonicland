// FAILS_restrike_reported_within_min_hold (proofs/Harmonicland/Mic.lean).
// Claim (src/mic/note-tracker.ts:20-22): "A fresh onset on a key that is already down is a
// RE-STRIKE: it is reported as off-then-on". Holds only once the key has been down for
// minHoldFrames (note-tracker.ts:88-89).
import { DEFAULT_TRACKER, NoteTracker, type NoteEvent } from "/Users/lukesovernconley/Code/harmonicland/src/mic/note-tracker";
import { LOWEST_PITCH, N_PITCHES } from "/Users/lukesovernconley/Code/harmonicland/src/mic/window";
const C4 = 60 - LOWEST_PITCH;
const row = (v: number) => { const r = new Float32Array(N_PITCHES); r[C4] = v; return r; };
const fmt = (e: NoteEvent[]) => JSON.stringify(e.map((x) => (x.kind === "on" ? "+" : "-") + x.pitch));

for (const gap of [1, DEFAULT_TRACKER.minHoldFrames - 1]) {
  const t = new NoteTracker();
  const log: string[] = [];
  log.push("strike   " + fmt(t.frame(row(0.9), row(0.8), true)));
  for (let i = 0; i < gap; i++) log.push("sounding " + fmt(t.frame(row(0), row(0.8), true)));
  const again = t.frame(row(0.9), row(0.8), true);
  log.push("STRIKE   " + fmt(again));
  const after: NoteEvent[] = [];
  for (let i = 0; i < 20; i++) after.push(...t.frame(row(0), row(0.8), true));
  console.log(`re-strike ${gap + 1} frames after the first (minHoldFrames = ${DEFAULT_TRACKER.minHoldFrames}):`);
  for (const l of log) console.log("   " + l);
  console.log('   claim : the second strike is reported ["-60","+60"]');
  console.log("   actual:", fmt(again), "— and in the 20 frames after it:", fmt(after));
}
