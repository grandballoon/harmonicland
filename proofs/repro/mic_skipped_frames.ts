// FAILS_each_frame_committed_exactly_once (proofs/Harmonicland/Mic.lean).
// Claims: src/mic/window.ts:16 "each absolute frame is committed exactly once";
//         src/mic/transcriber.ts:16-17 "neither ever builds a backlog: each run settles
//         everything that has arrived".
// Scenario: the model is still running on the first window while 200 more frames (2.3 s) of
// audio arrive. The real Transcriber is driven with a scripted model that records which
// window rows the commit loop reads (transcriber.ts:136), i.e. which absolute frames reach
// the tracker. C4 is struck at absolute frame 170 and sounds until frame 195.
import { Transcriber, DEFAULT_TRANSCRIBER, type Activations, type Infer } from "/Users/lukesovernconley/Code/harmonicland/src/mic/transcriber";
import { FRAME_HOP, LOWEST_PITCH, N_PITCHES, WINDOW_FRAMES, WINDOW_SAMPLES } from "/Users/lukesovernconley/Code/harmonicland/src/mic/window";
import type { NoteEvent } from "/Users/lukesovernconley/Code/harmonicland/src/mic/note-tracker";

const C4 = 60 - LOWEST_PITCH;
const row = (v: number) => { const r = new Float32Array(N_PITCHES); r[C4] = v; return r; };
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

async function run(label: string, chunks: number[], slowModel: boolean) {
  const committed: number[] = [];
  const events: NoteEvent[] = [];
  const starts: number[] = [];
  let pushed = 0;
  let release: (() => void) | null = null;
  const infer: Infer = () => {
    const s = Math.floor((pushed - WINDOW_SAMPLES) / FRAME_HOP); // this snapshot's startFrame
    starts.push(s);
    const rows = (rec: boolean, from: number, to: number, v: number) => new Proxy([] as Float32Array[], {
      get(_t, prop) {
        if (typeof prop !== "string" || !/^\d+$/.test(prop)) return undefined;
        const abs = s + Number(prop);
        if (rec) committed.push(abs);
        return row(abs >= from && abs < to ? v : 0);
      },
    });
    const act: Activations = { onsets: rows(true, 170, 171, 0.9), frames: rows(false, 170, 195, 0.8) };
    if (!slowModel) return Promise.resolve(act);
    return new Promise<Activations>((res) => { release = () => res(act); });
  };
  const tr = new Transcriber(infer, { ...DEFAULT_TRANSCRIBER, lookahead: 8, minHopFrames: 4 },
    { onEvents: (e) => events.push(...e) });
  const total = chunks.reduce((a, b) => a + b, 0);
  const audio = new Float32Array(total).fill(0.2);
  audio.fill(0.0005, 0, 30 * FRAME_HOP); // a quiet room first, so the gate has a floor
  let at = 0;
  for (const n of chunks) {
    pushed = at + n; // before push: push() takes the snapshot and calls the model synchronously
    tr.push(audio.subarray(at, at + n));
    at += n;
    if (!slowModel) await tr.settled();
  }
  while (release) { const r: () => void = release; release = null; r(); await tick(); }
  await tr.settled();

  const last = Math.max(...committed);
  const missing: number[] = [];
  for (let f = 0; f <= last; f++) if (!committed.includes(f)) missing.push(f);
  const dup = committed.filter((f, i) => committed.indexOf(f) !== i);
  console.log(`\n${label}`);
  console.log(`  model runs: ${starts.length}, window startFrames: ${starts.length > 6 ? starts.slice(0, 3).join(",") + ",…," + starts[starts.length - 1] : starts.join(",")}`);
  console.log(`  frames handed to the tracker: ${committed.length}, last ${last}, repeated ${dup.length}`);
  console.log(`  claim : every frame 0..${last} exactly once`);
  console.log(`  actual: missing ${missing.length}` + (missing.length ? ` (frames ${missing[0]}..${missing[missing.length - 1]})` : ""));
  console.log(`  note events (C4 struck at frame 170): ${JSON.stringify(events.map((e) => (e.kind === "on" ? "+" : "-") + e.pitch))}`);
}

const totalSamples = WINDOW_SAMPLES + 200 * FRAME_HOP;
const small: number[] = [];
for (let n = totalSamples; n > 0; n -= 512) small.push(Math.min(512, n));
await run("CONTROL — model keeps up (512-sample chunks, each settled before the next):", small, false);
await run("SLOW MODEL — first run still busy while 200 more frames arrive:", [WINDOW_SAMPLES, 200 * FRAME_HOP], true);
console.log(`\n(WINDOW_FRAMES ${WINDOW_FRAMES}, lookahead 8: a gap opens once more than ${WINDOW_FRAMES - 8} frames = ${((WINDOW_FRAMES - 8) * FRAME_HOP / 22050).toFixed(2)} s of audio arrive between two snapshots.)`);
