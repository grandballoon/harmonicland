/* ====================================================================
   MIDI_OUT — a Sink: score -> t -> Web MIDI note-on/off. Edge-triggered
   exactly like AudioOut — it tracks which notes sounded last frame and
   emits note-on / note-off on the transitions — but it drives a hardware
   synth instead of WebAudio, and draws nothing. Reads the same activeAt()
   query as every other consumer; knows nothing of rendering or inputs.

   It opens its OWN MIDIAccess: outputs stay ignorant of inputs, so it
   never reaches into live-midi.ts even though both touch Web MIDI. The
   3-byte channel-voice message it sends is the exact mirror of
   live-midi's decode(): (status | channel), pitch, velocity.
   ==================================================================== */
import { Core } from "../core";
import type { Score, Pitch, NoteId } from "../types";

const NOTE_ON = 0x90;
const NOTE_OFF = 0x80;
const CHANNEL = 0; // emit on channel 1
const VELOCITY = 100; // score notes carry no dynamics yet (cf. AudioOut)

// pure: a note transition -> the 3 bytes to send. The mirror of
// live-midi's decode(); note-off always carries release velocity 0.
export function encode(kind: "on" | "off", pitch: number, vel = VELOCITY): number[] {
  const status = (kind === "on" ? NOTE_ON : NOTE_OFF) | CHANNEL;
  return [status, pitch, kind === "on" ? vel : 0];
}

let port: MIDIOutput | null = null;

/** SCORE path. Invariant: the notes the PORT has note-on for, keyed by
 *  NoteId and carrying the pitch each one needs its note-off sent on.
 *  Deliberately empty when a port opens mid-playback — the port genuinely has
 *  nothing on yet, and at()'s next frame will attack whatever is active. */
const sounding = new Map<NoteId, Pitch>();

/** LIVE path. Invariant: the pitches the USER is holding — a mirror of
 *  LiveKeys, not of the wire — maintained whether or not a port is open, and
 *  whenever `port` is open it has a matching note-on for exactly these.
 *  enable() flushes the current hold to make the second half true. */
const livePitches = new Set<number>();

function send(kind: "on" | "off", pitch: number): void {
  port?.send(encode(kind, pitch));
}

// open MIDIAccess and pick the first available output. Behind a user
// gesture in a secure context, same as live input. Returns the output
// list so the UI can name the device (or report none found).
async function enable(): Promise<MIDIOutput[]> {
  if (!navigator.requestMIDIAccess) {
    throw new Error("Web MIDI is not supported in this browser.");
  }
  const access = await navigator.requestMIDIAccess({ sysex: false });
  const pick = () => [...access.outputs.values()][0] ?? null;
  port = pick();
  // hotplug: re-pick if our port vanished or none was chosen yet
  access.onstatechange = () => {
    if (!port || port.state === "disconnected") port = pick();
  };
  // the port catches up to what the user is already holding. Without this,
  // livePitches' invariant is false for every key pressed before enable(),
  // and the dedupe guards in liveOn/liveOff turn that into a note the synth
  // never sounds followed by a note-off for a note that was never on.
  for (const p of livePitches) send("on", p);
  return [...access.outputs.values()];
}

function disable(): void {
  silence();
  liveSilence();
  port = null;
}

// the Sink — diff the active set against what's sounding, emit the
// transitions. Same shape as AudioOut.at, one note-on/off per edge.
function at(score: Score, t: number, playing: boolean): void {
  if (!port) return;
  if (!playing) {
    silence();
    return;
  }
  const active = Core.activeAt(score, t);
  const activeIds = new Set(active.map((n) => n.id));
  for (const n of active) {
    if (!sounding.has(n.id)) {
      send("on", n.pitch);
      sounding.set(n.id, n.pitch);
    }
  }
  for (const [id, pitch] of [...sounding]) {
    if (!activeIds.has(id)) {
      send("off", pitch);
      sounding.delete(id);
    }
  }
}

// panic / all-notes-off for the SCORE path. Called every idle frame from
// at(), so it deliberately leaves the live path alone — a Perfecto chord
// triggered while the transport is paused must keep sounding.
function silence(): void {
  for (const pitch of sounding.values()) send("off", pitch);
  sounding.clear();
}

// live path — the exact mirror of AudioOut.liveOn/liveOff, driven by
// LiveKeys.press/release. One note-on per held pitch, independent of the
// score, the clock, and whether a port is open; guards against duplicate
// on/off like the audio side. LiveKeys already refcounts, so these see one
// call per pitch-that-starts and one per pitch-that-stops.
function liveOn(pitch: number): void {
  if (livePitches.has(pitch)) return;
  livePitches.add(pitch);
  send("on", pitch);
}
function liveOff(pitch: number): void {
  if (!livePitches.has(pitch)) return;
  livePitches.delete(pitch);
  send("off", pitch);
}
function liveSilence(): void {
  for (const p of livePitches) send("off", p);
  livePitches.clear();
}

export const MidiOut = { enable, disable, at, silence, liveOn, liveOff };
