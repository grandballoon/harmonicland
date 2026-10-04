/* ====================================================================
   MIDI_OUT — Outputs (types.ts) on Web MIDI: one per output port, driving
   an external synth (GarageBand, Logic, a hardware piano) instead of
   WebAudio. It is handed strikes already placed in wall time and sends
   them with Web MIDI's own timestamps, which are performance.now()
   milliseconds too — so the synth hears them to the millisecond, whatever
   the main thread is doing. Draws nothing, knows no scores.

   It opens its OWN MIDIAccess: outputs stay ignorant of inputs, so it
   never reaches into live-midi.ts even though both touch Web MIDI. The
   3-byte channel-voice message it sends is the exact mirror of
   live-midi's decode(): (status | channel), pitch, velocity.

   What cannot be done over MIDI, and what is done instead:
   - A sent message cannot be recalled (MIDIOutput.clear() is specified but
     barely implemented). So nothing is sent further ahead than the
     scheduler's window: a long note's note-off waits here until advance()
     brings it within reach — sent seconds early, it would outlive a seek
     and cut short whatever note on that key came after. And flush() sends
     a note-off for every note it has struck, AT that note's own time when
     it is still to come: a note-on and note-off on one timestamp, the
     shortest a synth can make it.
   - A note cannot start partway through. A strike dropped into a note
     (Strike.offset) is struck softer, as the note would have decayed.
   - The pedal is the synth's to apply: it is sent as it changes (CC64),
     and notes are never lengthened for it here. Strike.damp is ignored.
   - The synth's latency cannot be measured: latency() is 0, and the user's
     offset (sound-row.ts) says the rest.
   ==================================================================== */
import type { Output, Pitch, Strike } from "../types";

const NOTE_ON = 0x90;
const NOTE_OFF = 0x80;
const CONTROL = 0xb0;
const CHANNEL = 0; // emit on channel 1
const ALL_NOTES_OFF = 123;
const SUSTAIN = 64;

// pure: a note transition -> the 3 bytes to send. The mirror of
// live-midi's decode(); note-off always carries release velocity 0.
export function encode(kind: "on" | "off", pitch: number, vel = 100): number[] {
  const status = (kind === "on" ? NOTE_ON : NOTE_OFF) | CHANNEL;
  return [status, pitch, kind === "on" ? vel : 0];
}

/** pure: a control change -> its 3 bytes. */
export const control = (controller: number, value: number): number[] => [CONTROL | CHANNEL, controller, value];

/** pure: how hard to strike a note dropped into `offset` seconds after it
 *  began — a piano note's decay, roughly, down to a floor that still
 *  sounds on any synth. */
export const resumedVelocity = (velocity: number, offset: number): number =>
  Math.max(1, Math.round(velocity * Math.max(0.35, Math.exp(-offset / 1.5))));

// ---- access to the ports ---------------------------------------------
let access: MIDIAccess | null = null;
const portSubs = new Set<() => void>();

/** Open MIDIAccess, once. Behind a user gesture in a secure context, the
 *  first time; afterwards the browser remembers the grant. */
async function open(): Promise<void> {
  if (access) return;
  if (!navigator.requestMIDIAccess) throw new Error("Web MIDI is not supported in this browser.");
  access = await navigator.requestMIDIAccess({ sysex: false });
  access.onstatechange = () => {
    for (const fn of [...portSubs]) fn();
  };
}

/** Has the user already allowed MIDI, so open() will not prompt? */
async function permitted(): Promise<boolean> {
  try {
    const status = await navigator.permissions.query({ name: "midi" as PermissionName });
    return status.state === "granted";
  } catch {
    return false; // no Permissions API, or it does not know "midi"
  }
}

/** The output ports connected now; empty until open(). */
const ports = (): MIDIOutput[] =>
  access ? [...access.outputs.values()].filter((p) => p.state !== "disconnected") : [];

/** Subscribe to ports coming and going. Returns the unsubscribe. */
function onPorts(fn: () => void): () => void {
  portSubs.add(fn);
  return () => portSubs.delete(fn);
}

// ---- one Output per port ----------------------------------------------
interface Sent {
  pitch: Pitch;
  at: number;
  off?: number;
  /** Is the note-off on its way to the synth? */
  offSent: boolean;
}

const outputs = new Map<string, Output>(); // port id -> its Output

/** The Output that sounds through `port`. One per port, so choosing a port
 *  again hands back the same Output, holding the same state. */
function output(port: MIDIOutput): Output {
  const known = outputs.get(port.id);
  if (known) return known;
  const sent: Sent[] = []; // score notes struck and not yet known to be over
  const held = new Set<Pitch>(); // live keys down

  const send = (bytes: number[], at?: number): void => {
    // a port unplugged mid-send throws; the picker is already moving on
    try {
      port.send(bytes, at);
    } catch {
      // nothing to do: the device is gone
    }
  };

  function strike(s: Strike): void {
    const vel = s.offset ? resumedVelocity(s.velocity, s.offset) : s.velocity;
    send(encode("on", s.pitch, vel), s.at);
    sent.push({ pitch: s.pitch, at: s.at, ...(s.off !== undefined && { off: s.off }), offSent: false });
  }

  function advance(until: number): void {
    for (const n of sent) {
      if (n.offSent || n.off === undefined || n.off > until) continue;
      send(encode("off", n.pitch), n.off);
      n.offSent = true;
    }
    // what is certainly over is forgotten, so the list stays a window's worth
    const now = performance.now();
    for (let i = sent.length - 1; i >= 0; i--) if (sent[i].offSent && sent[i].off! <= now) sent.splice(i, 1);
  }

  function flush(): void {
    const now = performance.now();
    for (const n of sent) if ((n.off ?? Infinity) > now) send(encode("off", n.pitch), Math.max(now, n.at));
    sent.length = 0;
    send(control(SUSTAIN, 0)); // what the pedal holds is part of what was playing
  }

  const out: Output = {
    strike,
    advance,
    pedal: (down, at) => send(control(SUSTAIN, down ? 127 : 0), at),
    flush,
    latency: () => 0,
    liveOn(pitch, velocity) {
      if (held.has(pitch)) return;
      held.add(pitch);
      send(encode("on", pitch, velocity));
    },
    liveOff(pitch) {
      if (!held.delete(pitch)) return;
      send(encode("off", pitch));
    },
    // the panic, for a synth being let go of: whatever this app believes is
    // sounding, and whatever the synth does
    detach() {
      flush();
      for (const p of held) send(encode("off", p));
      held.clear();
      send(control(ALL_NOTES_OFF, 0));
    },
  };
  outputs.set(port.id, out);
  return out;
}

export const MidiOut = { open, permitted, ports, onPorts, output };
