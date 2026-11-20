// FAILS_confirm_window_when_confirmFrames_is_256, FAILS_release_when_releaseFrames_over_65535,
// FAILS_release_when_minHoldFrames_over_65535 (proofs/Harmonicland/Mic.lean).
// The tracker's counters are typed arrays (src/mic/note-tracker.ts:57-61); TrackerOptions is
// any numbers. settings.ts only ever produces the defaults (3, 4, 4) — settings_in_range.
import { DEFAULT_TRACKER, NoteTracker, type NoteEvent } from "/Users/lukesovernconley/Code/harmonicland/src/mic/note-tracker";
import { LOWEST_PITCH, N_PITCHES } from "/Users/lukesovernconley/Code/harmonicland/src/mic/window";
const C4 = 60 - LOWEST_PITCH;
const row = (v: number) => { const r = new Float32Array(N_PITCHES); r[C4] = v; return r; };
const fmt = (e: NoteEvent[]) => JSON.stringify(e.map((x) => (x.kind === "on" ? "+" : "-") + x.pitch));

for (const confirmFrames of [255, 256]) {
  const t = new NoteTracker({ ...DEFAULT_TRACKER, confirmFrames });
  console.log(`confirmFrames ${confirmFrames}: onset 1, frame 1 ->`, fmt(t.frame(row(1), row(1), true)), ' (claim: ["+60"])');
}
for (const opts of [{ releaseFrames: 4 }, { releaseFrames: 65535 }, { releaseFrames: 65536 }, { minHoldFrames: 65536 }]) {
  const t = new NoteTracker({ ...DEFAULT_TRACKER, ...opts });
  const ev: NoteEvent[] = [...t.frame(row(0.9), row(0.8), true)];
  const N = 140000; // silence for 27 minutes of frames
  let offAt = -1;
  for (let i = 1; i <= N; i++) {
    const e = t.frame(row(0), row(0), true);
    if (e.length && offAt < 0) offAt = i;
    ev.push(...e);
  }
  console.log(`${JSON.stringify(opts)}: strike then ${N} silent frames ->`, fmt(ev),
    offAt < 0 ? "— never comes up" : `— up after ${offAt} silent frames`);
}
