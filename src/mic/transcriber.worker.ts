/* ====================================================================
   TRANSCRIBER WORKER — Basic Pitch off the main thread. It loads the
   model once (from assets bundled with the app; no network beyond our
   own origin), picks the fastest TF.js backend the browser offers, warms
   it up, then runs a Transcriber over the audio the capture worklet
   posts on its port. Note events and stats go back to the main thread.

   The protocol is the two message types below and nothing more; the
   main-thread half is live-mic.ts.
   ==================================================================== */
import * as tf from "@tensorflow/tfjs";
import modelUrl from "@spotify/basic-pitch/model/model.json?url";
import weightsUrl from "@spotify/basic-pitch/model/group1-shard1of1.bin?url";
import { basicPitchInfer } from "./basic-pitch";
import type { NoteEvent } from "./note-tracker";
import { DEFAULT_TRANSCRIBER, Transcriber, type Infer, type Stats, type TranscriberOptions } from "./transcriber";
import { WINDOW_SAMPLES } from "./window";

/** The live-adjustable part of the transcriber's options. */
export type Tuning = Pick<TranscriberOptions, "lookahead" | "tracker">;

export type ToWorker =
  | { type: "start"; audio: MessagePort; options: Tuning }
  | { type: "options"; options: Tuning };

export type FromWorker =
  | { type: "ready"; backend: string }
  | { type: "events"; events: NoteEvent[] }
  | { type: "stats"; stats: Stats }
  | { type: "error"; message: string };

const post = (m: FromWorker) => postMessage(m);

// WebGL runs the ~2 s window in tens of milliseconds; the CPU takes over a
// second, which still works but lags badly — the backend is reported so
// the panel can say which one the listener got. A backend counts only once
// the model has actually run on it: WebGL can initialise and then fail on
// the first real shader (old drivers, a worker without OffscreenCanvas).
async function loadOn(backend: string): Promise<Infer> {
  if (!(await tf.setBackend(backend))) throw new Error(`${backend} is unavailable`);
  const model = await tf.loadGraphModel(modelUrl, { weightUrlConverter: async () => weightsUrl });
  const infer = basicPitchInfer(model);
  await infer(new Float32Array(WINDOW_SAMPLES)); // compiles the shaders before the first note
  return infer;
}

async function load(): Promise<{ infer: Infer; backend: string }> {
  let last: unknown;
  for (const backend of ["webgl", "cpu"]) {
    try {
      return { infer: await loadOn(backend), backend };
    } catch (err) {
      last = err;
    }
  }
  throw last;
}

let transcriber: Transcriber | null = null;
let tuning: Tuning; // the latest, so a change made while the model loads is kept

const describe = (err: unknown) => (err instanceof Error ? err.message : String(err));

async function start(audio: MessagePort): Promise<void> {
  const { infer, backend } = await load();
  transcriber = new Transcriber(infer, { ...DEFAULT_TRANSCRIBER, ...tuning }, {
    onEvents: (events) => post({ type: "events", events }),
    onStats: (stats) => post({ type: "stats", stats }),
    onError: (err) => post({ type: "error", message: describe(err) }),
  });
  audio.onmessage = (e: MessageEvent<Float32Array>) => transcriber!.push(e.data);
  post({ type: "ready", backend });
}

onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  tuning = m.options;
  if (m.type === "start") start(m.audio).catch((err: unknown) => post({ type: "error", message: describe(err) }));
  else transcriber?.setOptions(tuning);
};
