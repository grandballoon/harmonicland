/* ====================================================================
   SOUND — the switchboard: an Output that forwards to exactly one other,
   the built-in piano or a MIDI port. Exclusivity is its shape, not a rule
   to keep: there is one `active`, so the piano and a synth can never both
   sound a note and double it.

   It is also where the USER's latency offset lives (sound-row.ts sets
   it): latency() is what the device reports plus what the user says, so
   everything reading the heard time reads one number.

   Switching hands over what the user's hands are holding: the old output
   lets go of its live keys and the new one takes them up, so a chord held
   across the switch keeps sounding. The score path is flushed and left for
   the scheduler to reset() onto the new output — which drops into the
   notes sounding at that moment, mid-note, as after a seek.
   ==================================================================== */
import { AudioOut } from "./audio";
import type { Output, Pitch } from "../types";

let active: Output = AudioOut;
let offset = 0; // seconds, the user's addition to the device's latency
const live = new Map<Pitch, number>(); // held live keys -> their velocity

/** Make `o` the one output. The caller resets the scheduler after. */
function use(o: Output): void {
  if (o === active) return;
  for (const p of live.keys()) active.liveOff(p);
  active.detach();
  active = o;
  for (const [p, v] of live) o.liveOn(p, v);
}

export const Sound: Output & {
  use(o: Output): void;
  current(): Output;
  setOffset(seconds: number): void;
} = {
  use,
  current: () => active,
  setOffset(seconds) {
    offset = seconds;
  },
  strike: (s) => active.strike(s),
  advance: (until) => active.advance(until),
  pedal: (down, at) => active.pedal(down, at),
  flush: () => active.flush(),
  latency: () => active.latency() + offset,
  liveOn(pitch, velocity) {
    if (live.has(pitch)) return;
    live.set(pitch, velocity);
    active.liveOn(pitch, velocity);
  },
  liveOff(pitch) {
    if (!live.delete(pitch)) return;
    active.liveOff(pitch);
  },
  detach: () => active.detach(),
};
