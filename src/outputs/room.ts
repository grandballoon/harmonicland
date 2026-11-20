/* ====================================================================
   ROOM — the built-in piano's signal chain after its voices: a small room,
   then a limiter. Everything the piano sounds goes into input(), and
   nothing here knows it is a piano.

     input ──────────────────────────────────► limiter ──► destination
         └──► send (−18 dB) ──► convolver ──┘

   THE ROOM is a convolution reverb whose impulse response is generated
   here, not loaded: 1.2s of decorrelated stereo noise decaying to −60 dB,
   darkening as it decays (a one-pole lowpass whose cutoff falls from
   8 kHz to 2 kHz), after 8ms of silence for the sound to reach the walls.
   Small and quiet on purpose — a piano in a room, not a hall — so the
   detail a practising ear needs is not washed out. Always on.

   THE LIMITER is a safety net, not a character: per-voice gains leave
   enough headroom that ordinary playing never reaches it; it only keeps a
   fortissimo chord with the pedal down from clipping.
   ==================================================================== */

const SEND = Math.pow(10, -18 / 20);
const RT60 = 1.2; // seconds to decay 60 dB
const PREDELAY = 0.008;
const CUTOFF_START = 8000;
const CUTOFF_END = 2000;

/** The room's impulse response, one Float32Array per channel. `random`
 *  is injectable so a test can make it repeatable. */
export function impulseResponse(sampleRate: number, random: () => number = Math.random): Float32Array[] {
  const length = Math.round(sampleRate * (PREDELAY + RT60));
  const start = Math.round(sampleRate * PREDELAY);
  const decay = Math.log(1000) / RT60; // amplitude e-folds per second, for -60 dB at RT60
  return [0, 1].map(() => {
    const ch = new Float32Array(length);
    let y = 0;
    for (let i = start; i < length; i++) {
      const t = (i - start) / sampleRate;
      const cutoff = CUTOFF_START * Math.pow(CUTOFF_END / CUTOFF_START, t / RT60);
      const a = 1 - Math.exp((-2 * Math.PI * cutoff) / sampleRate);
      y += a * (random() * 2 - 1 - y);
      ch[i] = y * Math.exp(-decay * t);
    }
    return ch;
  });
}

/** Build the chain on `c` and hand back its input. */
export function makeRoom(c: BaseAudioContext): AudioNode {
  const input = c.createGain();
  const limiter = c.createDynamicsCompressor();
  limiter.threshold.value = -6;
  limiter.ratio.value = 4;
  limiter.knee.value = 6;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.25;
  limiter.connect(c.destination);
  input.connect(limiter);

  const channels = impulseResponse(c.sampleRate);
  const ir = c.createBuffer(channels.length, channels[0].length, c.sampleRate);
  channels.forEach((data, i) => ir.getChannelData(i).set(data));
  const convolver = c.createConvolver();
  convolver.buffer = ir;
  const send = c.createGain();
  send.gain.value = SEND;
  input.connect(send);
  send.connect(convolver);
  convolver.connect(limiter);
  return input;
}
