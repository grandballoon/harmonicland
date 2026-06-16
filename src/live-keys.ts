/* ====================================================================
   LIVE_KEYS — the one bit of state that is neither the score nor the
   clock: which keys the user is physically holding right now. It owns
   the held-pitch set and drives AudioOut's live voices on press/release;
   PianoRoll reads held() to light those keys. The immutable score is
   never touched — recording a performance INTO the score is the later,
   mutable-model step, deliberately not done here. So the keyboard (an
   output surface) becomes an input surface with no module reaching
   across another.

   This is also the seam live MIDI input will plug into: a Web MIDI
   note-on/off maps to press(pitch)/release(pitch) with nothing else
   touched.
   ==================================================================== */
import { AudioOut } from "./outputs/audio";

const held = new Set<number>(); // MIDI pitches currently pressed

function press(pitch: number): void {
  if (held.has(pitch)) return;
  held.add(pitch);
  AudioOut.liveOn(pitch);
}
function release(pitch: number): void {
  if (!held.has(pitch)) return;
  held.delete(pitch);
  AudioOut.liveOff(pitch);
}
function releaseAll(): void {
  for (const p of [...held]) release(p);
}

export const LiveKeys = { press, release, releaseAll, held: () => held };
