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
import { MidiOut } from "./outputs/midi-out";

const held = new Set<number>(); // MIDI pitches currently pressed

// How many times each pitch has been struck, ever. A held SET cannot answer
// "was this key played again?", because a release and the next press can land
// between two frames — PerfState.trigger() does exactly that, releasing and
// re-pressing a chord in one synchronous call — and a reader that polls would
// see no change at all. A monotonic count per pitch survives any sampling
// rate, which is what the practice gate needs to hear a restrike.
const strikes = new Map<number, number>();

// A MIDI data byte is 7 bits, so 0..127 is the whole sayable range: MidiOut
// would throw on anything outside it (taking the rest of the frame's note-ons
// with it, and stranding whatever was already down). Generated voicings can
// reach past it — a high register plus a wide coloration plus a voice-leading
// octave shift all stack — so the gate belongs here, at the one seam every
// input goes through, rather than in each sink.
const inRange = (pitch: number): boolean =>
  Number.isInteger(pitch) && pitch >= 0 && pitch <= 127;

function press(pitch: number): void {
  if (!inRange(pitch)) return; // unsayable: drop it rather than break the chord
  if (held.has(pitch)) return;
  held.add(pitch);
  strikes.set(pitch, (strikes.get(pitch) ?? 0) + 1);
  AudioOut.liveOn(pitch);
  MidiOut.liveOn(pitch); // no-op until a MIDI-out port is enabled
}
function release(pitch: number): void {
  if (!held.has(pitch)) return;
  held.delete(pitch);
  AudioOut.liveOff(pitch);
  MidiOut.liveOff(pitch);
}
function releaseAll(): void {
  for (const p of [...held]) release(p);
}

export const LiveKeys = {
  press,
  release,
  releaseAll,
  held: () => held,
  strikes: (): ReadonlyMap<number, number> => strikes,
};
