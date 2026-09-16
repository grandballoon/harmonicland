# Live input: options survey

Companion to `SPEC_liveinput.md`, which is behavioral.
This document is technical: what exists for turning a microphone into note-on/off events, and which option fits this app.

## The problem, stated precisely

The app already has one seam for live playing: `LiveKeys.press(pitch)` / `LiveKeys.release(voice)`, fed by `live-midi.ts`.
Live input is a second feeder for that same seam.
It must emit *polyphonic* note-on and note-off events from a piano recorded by a laptop or phone mic, with latency low enough to feel connected to the keys.
Polyphony is the hard constraint: a piano plays chords, and the Nashville and Tonnetz views exist to show harmony.
Monophonic pitch trackers are therefore disqualified for the primary use case, however good they are.

## The landscape

### 1. Classical monophonic trackers (YIN, MPM, autocorrelation)

Libraries: [pitchy](https://www.npmjs.com/package/pitchy) (McLeod Pitch Method), [pitchfinder](https://www.npmjs.com/package/pitchfinder) (YIN and others), and the pitch algorithms in [Essentia.js](https://mtg.github.io/essentia.js/).
They are tiny, dependency-free, and run comfortably in an `AudioWorklet` at 128-sample blocks.
Latency is essentially the analysis window (20–50 ms).
They return exactly one fundamental per frame, so a triad becomes a single (often wrong) pitch.
Verdict: fine for a tuner or a melody-only mode; not a replacement for MIDI keys.

### 2. Classical multi-pitch (Klapuri, Melodia)

Essentia.js exposes `MultiPitchKlapuri` and `MultiPitchMelodia` via WebAssembly ([reference](https://essentia.upf.edu/algorithms_reference.html)).
These are salience-based multi-F0 estimators from the pre-deep-learning era.
On piano they produce octave errors and ghost harmonics at a rate that would make the keyboard glow wrong more often than right.
Every published benchmark since 2018 shows learned models beating them by a wide margin.
Verdict: not competitive.

### 3. Learned piano transcription, offline-shaped

**Onsets and Frames** ([Magenta](https://magenta.tensorflow.org/oaf-js)) runs in the browser via TensorFlow.js and is piano-specific.
It uses bidirectional LSTMs, so it needs the future; Magenta's own Piano Scribe demo transcribes a recording *after* you stop, at about half real-time.
It cannot be made streaming without retraining.

**Basic Pitch** ([spotify/basic-pitch-ts](https://github.com/spotify/basic-pitch-ts), Apache-2.0) is the best-known open-source browser transcriber.
It is a small fully-convolutional network (~900 KB of weights) over a harmonic-stacked CQT, instrument-agnostic, polyphonic, with ~11 ms frame hop.
The published API takes a whole `AudioBuffer`, but because the model is convolutional with no recurrence, it can be driven on a sliding window from an `AudioWorklet` ring buffer.
The receptive field means each frame is only reliable once roughly 100–200 ms of audio after it has arrived.
Realistic end-to-end latency on a laptop: 150–300 ms, dominated by that lookahead plus TF.js inference.
Its onset detection is weaker than piano-specialised models, and instrument-agnostic training costs some accuracy on piano.
Verdict: the strongest *shippable today* option, at the price of a perceptible lag.

### 4. Learned piano transcription, real-time-shaped

Research has moved from offline to streaming in the last two years.

- **Onsets and Velocities** ([arXiv 2303.04485](https://arxiv.org/abs/2303.04485)): ~3.1 M parameters, pure CNN, 24 ms frames, onset F1 96.8 % on MAESTRO, with open code, weights, and a real-time demo.
- **Streaming transcription with consistent onset/offset decoding** ([arXiv 2503.01362](https://arxiv.org/abs/2503.01362), ISMIR 2024): causal encoder plus autoregressive decoder, matches offline SOTA.
- **Minimum-latency real-time piano transcription** ([arXiv 2509.07586](https://arxiv.org/abs/2509.07586), Sept 2025): explicitly targets sub-30 ms against the 128–320 ms typical of block-wise adaptations, strictly causal, released as a baseline.

None of these ship as an npm package.
Each is a PyTorch model that would need export to ONNX and hosting via `onnxruntime-web` (WebGPU or WASM), plus a hand-written CQT/mel front end in the worklet.
That is real work, but it is the only path to the latency a pianist will not notice.
Verdict: the right destination; not the right first step.

## Architecture, independent of model choice

Every option shares the same plumbing, so build it once:

1. `getUserMedia` with `echoCancellation`, `noiseSuppression`, and `autoGainControl` all **off**; the browser defaults are tuned for speech and mangle piano transients.
2. An `AudioWorkletProcessor` that fills a ring buffer and posts fixed-hop frames to a `Worker`; never analyse on the main thread.
3. The `Worker` runs the model and emits `{kind, pitch, t}` events, mirroring `MidiNoteEvent` in `live-midi.ts`.
4. A small `live-mic.ts` (twin of `live-midi.ts`) turns those into `LiveKeys.press/release` with the same one-voice-per-pitch map and stuck-note guard.
5. Hysteresis at the seam: separate onset and frame thresholds, a minimum hold before release, and a debounce so a decaying note does not flicker.

Steps 1–5 are model-agnostic and testable with a synthetic frame stream.
The model is a pluggable function from spectrogram frames to per-pitch activations.

## Recommendation

**Phase 1: Basic Pitch on a sliding window, behind the plumbing above.**
It is open source, browser-native, polyphonic, and small enough to load lazily.
It gives a working "play your real piano" mode within days and validates the whole seam, the UI affordances, and the hysteresis logic against real rooms and real mics.
Accept 150–300 ms lag and say so in the UI.

**Phase 2: swap the model for a causal piano-specific network.**
Start from Onsets and Velocities, which already has weights and a real-time demo, and export to ONNX for `onnxruntime-web`.
Track the 2025 minimum-latency work as it matures; its causal design is exactly the target.
Because Phase 1 isolates the model behind a frame-in/activations-out interface, this is a model swap, not a rewrite.

**Do not** build on YIN/MPM for the primary path, and **do not** build on Onsets and Frames, which cannot stream.

## Open questions for the behavioral spec

- What latency is acceptable before the app should visibly say "listening, slightly behind" rather than pretend to be instantaneous?
- Should ghost notes be suppressed aggressively (fewer false glows, later onsets) or permissively (snappier, occasional wrong key)?
- Is a melody-only monophonic mode worth having as a low-latency fallback for non-piano instruments?

## Sources

- [spotify/basic-pitch-ts](https://github.com/spotify/basic-pitch-ts)
- [Magenta: Onsets and Frames in the browser](https://magenta.tensorflow.org/oaf-js)
- [Onsets and Velocities](https://arxiv.org/abs/2303.04485)
- [Streaming piano transcription (ISMIR 2024)](https://arxiv.org/abs/2503.01362)
- [Minimum-latency real-time piano transcription](https://arxiv.org/abs/2509.07586)
- [Essentia.js algorithms](https://essentia.upf.edu/algorithms_reference.html)
- [pitchy](https://www.npmjs.com/package/pitchy), [pitchfinder](https://www.npmjs.com/package/pitchfinder)
- [Browser pitch detection architecture (AudioWorklet vs ScriptProcessor)](https://www.musicalboard.com/blog/2026-05-05-pitch-detection/)
