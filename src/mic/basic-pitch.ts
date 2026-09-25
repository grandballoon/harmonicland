/* ====================================================================
   BASIC_PITCH — Spotify's Basic Pitch model as an `Infer`.

   The @spotify/basic-pitch package ships the model (a TF.js graph, ~900
   kB of weights) and an API shaped for whole recordings: it frames an
   AudioBuffer into overlapping windows and hands back the full matrices
   at the end. Streaming needs only the middle of that — one window in,
   its activations out, many times a second — so this calls the graph
   directly, inside tf.tidy so no intermediate tensor outlives the run
   (the package's evaluateSingleFrame leaks its input slice, harmless
   once per file but not twenty times a second). How the model is loaded
   and on which backend is the caller's business: the worker loads it
   from bundled assets on WebGL, an offline check loads it from disk.
   ==================================================================== */
import * as tf from "@tensorflow/tfjs";
import type { Activations, Infer } from "./transcriber";
import { N_PITCHES, WINDOW_FRAMES, WINDOW_SAMPLES } from "./window";

// Output tensor names in the converted graph (the package's
// OUTPUT_TO_TENSOR_NAME; "Identity" is the pitch contour, unused here).
const FRAMES = "Identity_1";
const ONSETS = "Identity_2";

// Flat [WINDOW_FRAMES · 88] data → one 88-long view per frame, no copying.
function rows(flat: Float32Array): Float32Array[] {
  return Array.from({ length: WINDOW_FRAMES }, (_, f) => flat.subarray(f * N_PITCHES, (f + 1) * N_PITCHES));
}

export function basicPitchInfer(model: tf.GraphModel): Infer {
  return async (window: Float32Array): Promise<Activations> => {
    const [frames, onsets] = tf.tidy(() =>
      model.execute(tf.tensor3d(window, [1, WINDOW_SAMPLES, 1]), [FRAMES, ONSETS]) as tf.Tensor[]);
    try {
      const [f, o] = await Promise.all([frames.data<"float32">(), onsets.data<"float32">()]);
      return { frames: rows(f), onsets: rows(o) };
    } finally {
      frames.dispose();
      onsets.dispose();
    }
  };
}
