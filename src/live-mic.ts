/* ====================================================================
   LIVE_MIC — a real instrument, heard through a microphone, becomes an
   input surface. The twin of live-midi.ts: note-on/off in, LiveKeys
   press/release out, nothing else touched. The immutable score is never
   touched either.

   The hearing happens off this thread, in three stages:

     getUserMedia ─▶ AudioContext @ 22.05 kHz ─▶ capture worklet ──port──▶
     transcriber worker (Basic Pitch) ─▶ note events ─▶ here ─▶ LiveKeys

   This module only plumbs them together and owns the voices:

   - ANY MICROPHONE. The device is chosen by id, and the capture context
     runs at the model's own rate, so the browser resamples whatever the
     device delivers — a laptop mic at 48 kHz, an interface at 96. Every
     channel the device offers is requested, and the worklet keeps the one
     the instrument is on or mixes them all. The browser's voice-call
     processing (echo cancellation, noise suppression, automatic gain) is
     switched off: it is tuned for speech and smears piano attacks.
   - SILENT VOICES. The instrument makes its own sound, so the voices this
     module presses glow and count as played but do not sound (see
     LiveKeys). Sounding them would double the piano and, through the
     speakers, feed back into the mic.

   Like MidiNoteEvent in live-midi.ts, the worker's NoteEvent stays an
   input detail; it is not part of the types.ts model contract.
   ==================================================================== */
import { LiveKeys, type Voice } from "./live-keys";
import type { Channel } from "./mic/settings";
import type { Stats } from "./mic/transcriber";
import type { FromWorker, ToWorker, Tuning } from "./mic/transcriber.worker";
import captureUrl from "./mic/capture.worklet.ts?worker&url";

export interface MicInput {
  deviceId: string;
  label: string;
}

/** What the running session turned out to be. */
export interface MicSession {
  label: string;
  /** Channels the device delivers (the channel picker's range). */
  channels: number;
  /** The device's own sample rate, before resampling; null if unreported. */
  deviceRate: number | null;
  /** The TF.js backend the model runs on ("webgl", or the slow "cpu"). */
  backend: string;
}

export interface MicListeners {
  onStats?(stats: Stats): void;
  /** The session died on its own: the device went away, or the model failed. */
  onLost?(reason: string): void;
}

export interface MicRequest {
  deviceId: string | null;
  channel: Channel;
  tuning: Tuning;
}

interface Running {
  stream: MediaStream;
  ctx: AudioContext;
  worker: Worker;
  node: AudioWorkletNode | null; // null until the worklet module has loaded
}

function stop({ stream, ctx, worker }: Running): void {
  worker.terminate();
  for (const t of stream.getTracks()) { t.onended = null; t.stop(); }
  void ctx.close().catch(() => {}); // already closed is fine
}

let running: Running | null = null;
// rejects an enable() still waiting on the model, when disable() cuts it short
let abortStart: ((err: Error) => void) | null = null;

// one voice per sounding pitch, exactly as live-midi.ts keeps them
const sounding = new Map<number, Voice>();

function onNote(kind: "on" | "off", pitch: number): void {
  if (kind === "on") {
    if (!sounding.has(pitch)) sounding.set(pitch, LiveKeys.press(pitch, { silent: true }));
  } else {
    const v = sounding.get(pitch);
    if (v) { LiveKeys.release(v); sounding.delete(pitch); }
  }
}

/** Audio inputs. Until the page has mic permission, browsers hide them
 *  (empty ids) or their names; hidden ones are left out. */
async function inputs(): Promise<MicInput[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const all = await navigator.mediaDevices.enumerateDevices();
  return all
    // "default" and "communications" are aliases of a real device, and
    // "System default" in the picker already stands for them
    .filter((d) => d.kind === "audioinput" && d.deviceId && d.deviceId !== "default" && d.deviceId !== "communications")
    .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
}

// Resolves on the worker's "ready" (model loaded and warmed), rejects on
// its first error; afterwards errors go to onLost.
function startWorker(w: Worker, audio: MessagePort, tuning: Tuning, ls: MicListeners): Promise<string> {
  return new Promise((resolve, reject) => {
    let ready = false;
    abortStart = reject;
    w.onmessage = (e: MessageEvent<FromWorker>) => {
      if (running?.worker !== w) return; // queued before a disable(); stale
      const m = e.data;
      if (m.type === "events") for (const ev of m.events) onNote(ev.kind, ev.pitch);
      else if (m.type === "stats") ls.onStats?.(m.stats);
      else if (m.type === "ready") { ready = true; resolve(m.backend); }
      else if (!ready) reject(new Error(m.message));
      else lost(ls, "the transcriber stopped: " + m.message);
    };
    w.onerror = (e) => (ready ? lost(ls, "the transcriber crashed") : reject(new Error(e.message || "the transcriber failed to load")));
    const start: ToWorker = { type: "start", audio, options: tuning };
    w.postMessage(start, [audio]);
  });
}

function lost(ls: MicListeners, reason: string): void {
  disable();
  ls.onLost?.(reason);
}

// Chrome honours `latency` (the capture buffer it asks the OS for); the
// DOM typings have not caught up with it.
type AudioConstraints = MediaTrackConstraints & { latency?: ConstrainDouble };

// Bumped by every disable(), so an enable() still awaiting the permission
// prompt or the model knows it was called off and tidies up after itself.
let generation = 0;

const cancelled = () => new Error("cancelled");

/** Must run from a user gesture in a secure context (it prompts for the mic).
 *  Rejects with "cancelled" if disable() is called before it finishes. */
async function enable(req: MicRequest, ls: MicListeners = {}): Promise<MicSession> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("microphone input is not supported in this browser.");
  }
  disable();
  const gen = generation;
  const audio: AudioConstraints = {
    deviceId: req.deviceId ? { exact: req.deviceId } : undefined,
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    channelCount: { ideal: 8 }, // as many as the device has
    latency: { ideal: 0 },
  };
  const stream = await navigator.mediaDevices.getUserMedia({ audio });
  const track = stream.getAudioTracks()[0];
  const settings = track.getSettings();
  const channels = settings.channelCount ?? 1;
  const ctx = new AudioContext({ sampleRate: 22050, latencyHint: "interactive" });
  const worker = new Worker(new URL("./mic/transcriber.worker.ts", import.meta.url), { type: "module" });
  const session: Running = { stream, ctx, worker, node: null };
  if (gen !== generation) { stop(session); throw cancelled(); }
  running = session;
  try {
    await ctx.audioWorklet.addModule(captureUrl);
    if (gen !== generation) throw cancelled();
    const node = new AudioWorkletNode(ctx, "mic-capture", {
      numberOfInputs: 1,
      numberOfOutputs: 1, // silent; connected so every browser keeps pulling it
      channelCount: channels,
      channelCountMode: "explicit",
      channelInterpretation: "discrete", // channels are inputs, not speakers
    });
    session.node = node;
    ctx.createMediaStreamSource(stream).connect(node).connect(ctx.destination);
    node.port.postMessage({ type: "channel", channel: req.channel });
    const wire = new MessageChannel();
    node.port.postMessage({ type: "sink", port: wire.port1 }, [wire.port1]);
    const backend = await startWorker(worker, wire.port2, req.tuning, ls);
    abortStart = null;
    track.onended = () => lost(ls, "the microphone was disconnected");
    return { label: track.label || "microphone", channels, deviceRate: settings.sampleRate ?? null, backend };
  } catch (err) {
    if (gen === generation) disable(); // our own failure, not a disable() that already tidied
    throw err;
  }
}

/** Retune a running session without restarting it. */
function tune(tuning: Tuning): void {
  const m: ToWorker = { type: "options", options: tuning };
  running?.worker.postMessage(m);
}

function setChannel(channel: Channel): void {
  running?.node?.port.postMessage({ type: "channel", channel });
}

function disable(): void {
  generation++;
  abortStart?.(cancelled());
  abortStart = null;
  if (running) {
    stop(running);
    running = null;
  }
  // lift exactly the voices the mic owns, as live-midi does
  for (const v of sounding.values()) LiveKeys.release(v);
  sounding.clear();
}

export const LiveMic = { inputs, enable, tune, setChannel, disable, isOn: () => running !== null };
