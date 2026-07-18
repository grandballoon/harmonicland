/* ====================================================================
   LIVE_PERFECTO — Perfecto (the iOS app) becomes an input surface for
   the SEMANTIC plane. Perfecto broadcasts two MIDI streams: plain note
   on/off from its "Perfecto" source (which live-midi.ts already turns
   into LiveKeys presses — sound and glow come from there), and ChordLink
   SysEx frames from "Perfecto Link" carrying the musical intent: key,
   scale, degree, joystick coloration, exact voicing. This module owns
   only that second stream. It deliberately never touches LiveKeys — the
   note plane is the authority on what sounds; doubling it here would
   double-press every chord when both inputs are enabled.

   Decoded frames are mirrored into PerfState's selection (so the
   Nashville/Perfecto views and perfStatus readout track the phone) and
   handed to an onFrame subscriber for the status line. Like MidiOut,
   this module opens its OWN MIDIAccess — with sysex:true, which
   live-midi's never needs — and it attaches to every input, letting
   chordwire.decode's header check act as the filter: over an RTP-MIDI
   network session the source name is the session's, not "Perfecto
   Link", so filtering by port name would be fragile.
   ==================================================================== */
import { decode, type ChordWireFrame, type ChordFrame } from "./chordwire";
import { PerfState } from "./perf-state";
import { chordName, DEGREE_NUMERAL } from "./harmony/perfecto";

// pure: one-line human summary for the status readout / tests.
// e.g. "C maj7 · I · 4 notes" or "released"
export function describeFrame(f: ChordWireFrame): string {
  if (f.kind === "release") return "released";
  const name = chordName(f.key, f.degree, f.joystickMode, f.joystickDirection);
  const n = f.voicing.notes.length;
  return `${name} · ${DEGREE_NUMERAL[f.degree]} · ${n} note${n === 1 ? "" : "s"}`;
}

// mirror a chord frame's selection into PerfState. Setters only, never
// trigger(): re-running computeVoicing here could disagree with the voicing
// the phone actually played (voice-leading depends on history it owns).
export function mirrorSelection(f: ChordFrame): void {
  PerfState.setKey(f.key);
  PerfState.setDegree(f.degree);
  PerfState.setMode(f.joystickMode);
  PerfState.setDirection(f.joystickDirection);
  PerfState.setInversion(f.inversion);
  PerfState.setOctave(f.octave);
  PerfState.setVoiceLeading(f.voiceLeading);
}

let access: MIDIAccess | null = null;
const attached = new Set<MIDIInput>();
let subscriber: ((f: ChordWireFrame) => void) | null = null;

function onMessage(e: MIDIMessageEvent): void {
  if (!e.data) return;
  const frame = decode(e.data);
  if (!frame) return; // foreign SysEx / channel-voice / malformed — not ours
  if (frame.kind === "chord") mirrorSelection(frame);
  subscriber?.(frame);
}

// (re)attach the handler to every current input. Idempotent, exactly like
// live-midi's attachAll — which statechange (hotplug) relies on.
function attachAll(): MIDIInput[] {
  const inputs: MIDIInput[] = [];
  access!.inputs.forEach((input) => {
    input.onmidimessage = onMessage;
    attached.add(input);
    inputs.push(input);
  });
  return inputs;
}

// enable() must run from a user gesture in a secure context; sysex:true
// adds its own consent step to the permission prompt.
async function enable(): Promise<MIDIInput[]> {
  if (!navigator.requestMIDIAccess) {
    throw new Error("Web MIDI is not supported in this browser.");
  }
  if (!access) {
    access = await navigator.requestMIDIAccess({ sysex: true });
    access.onstatechange = () => attachAll(); // hotplug: wire new devices
  }
  return attachAll();
}

function disable(): void {
  for (const input of attached) input.onmidimessage = null;
  attached.clear();
  if (access) access.onstatechange = null;
}

// single subscriber, like Clock.onFrame: the UI status line is the only
// listener today; fan-out can come when a second consumer exists.
function onFrame(fn: ((f: ChordWireFrame) => void) | null): void {
  subscriber = fn;
}

export const LivePerfecto = { enable, disable, onFrame };
