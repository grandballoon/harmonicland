/* ====================================================================
   LIVE_MIDI — a hardware keyboard becomes an input surface. A live
   Web MIDI message is 3 bytes (status, data1, data2) — no var-length
   deltas, no running status, no tempo map — so decoding is trivial next
   to the SMF reader in inputs/midi.ts. We route decoded note-on/off to
   LiveKeys.press/release and touch nothing else: AudioOut already sounds
   live voices, PianoRoll already glows held() keys. The immutable score
   is never touched (recording a performance INTO it is the deferred
   mutable-model step).

   MidiNoteEvent is private here, exactly like MidiEvent in midi.ts: it's
   an input detail, not part of the types.ts model contract.
   ==================================================================== */
import { LiveKeys } from "./live-keys";

interface MidiNoteEvent {
  kind: "on" | "off";
  pitch: number; // MIDI note number 0–127
  vel: number; // 0–127 (dropped at the LiveKeys seam for now)
}

// pure: 3-byte channel-voice message -> note event, or null for anything
// we don't act on. Note-on with velocity 0 is the conventional note-off.
export function decode(data: Uint8Array): MidiNoteEvent | null {
  if (data.length < 3) return null;
  const status = data[0] & 0xf0; // strip channel — we listen on all 16
  const pitch = data[1];
  const vel = data[2];
  if (status === 0x90) return { kind: vel > 0 ? "on" : "off", pitch, vel };
  if (status === 0x80) return { kind: "off", pitch, vel };
  return null; // CC, pitch-bend, aftertouch, program-change, … ignored
}

let access: MIDIAccess | null = null;
const attached = new Set<MIDIInput>();

function onMessage(e: MIDIMessageEvent): void {
  if (!e.data) return;
  const ev = decode(e.data);
  if (!ev) return;
  if (ev.kind === "on") LiveKeys.press(ev.pitch);
  else LiveKeys.release(ev.pitch);
}

// (re)attach the handler to every current input. Idempotent — assigning
// onmidimessage again on an already-wired input is harmless, which is
// exactly what statechange (hotplug) needs.
function attachAll(): MIDIInput[] {
  const inputs: MIDIInput[] = [];
  access!.inputs.forEach((input) => {
    input.onmidimessage = onMessage;
    attached.add(input);
    inputs.push(input);
  });
  return inputs;
}

// enable() must run from a user gesture in a secure context:
// requestMIDIAccess prompts for permission.
async function enable(): Promise<MIDIInput[]> {
  if (!navigator.requestMIDIAccess) {
    throw new Error("Web MIDI is not supported in this browser.");
  }
  if (!access) {
    access = await navigator.requestMIDIAccess({ sysex: false });
    access.onstatechange = () => attachAll(); // hotplug: wire new devices
  }
  return attachAll();
}

function disable(): void {
  for (const input of attached) input.onmidimessage = null;
  attached.clear();
  if (access) access.onstatechange = null;
  LiveKeys.releaseAll(); // panic / stuck-note guard
}

export const LiveMidi = { enable, disable };
