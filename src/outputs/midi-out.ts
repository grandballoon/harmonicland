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
import type { Score, Note } from "../types";

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
const sounding = new Set<Note>(); // score notes currently held note-on

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
  return [...access.outputs.values()];
}

function disable(): void {
  silence();
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
  const active = new Set(Core.activeAt(score, t));
  for (const n of active) {
    if (!sounding.has(n)) {
      send("on", n.pitch);
      sounding.add(n);
    }
  }
  for (const n of [...sounding]) {
    if (!active.has(n)) {
      send("off", n.pitch);
      sounding.delete(n);
    }
  }
}

// panic / all-notes-off — release everything we're holding.
function silence(): void {
  for (const n of sounding) send("off", n.pitch);
  sounding.clear();
}

export const MidiOut = { enable, disable, at, silence };
