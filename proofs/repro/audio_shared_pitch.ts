/* MidiOut.lean, namespace Audio: FAILS_audio_paths_never_touch and
   flush_only_score, run against the real AudioOut on a fake AudioContext
   that records what each voice's gain is asked to do (the shape
   src/outputs/audio.test.ts uses; a plain script, so `window`, `fetch` and
   the clock are set by hand rather than by vitest). */
class Param {
  value = 0;
  calls: [string, ...number[]][] = [];
  setValueAtTime(v: number, t: number) { this.calls.push(["set", v, t]); }
  linearRampToValueAtTime(v: number, t: number) { this.calls.push(["ramp", v, t]); }
  setTargetAtTime(v: number, t: number, c: number) { this.calls.push(["target", v, t, c]); }
  cancelScheduledValues(t: number) { this.calls.push(["cancel", t]); }
  cancelAndHoldAtTime(t: number) { this.calls.push(["hold", t]); }
}
class Source {
  buffer: unknown = null;
  playbackRate = new Param();
  frequency = new Param();
  type = "";
  started: number[] = [];
  stopped: number[] = [];
  onended: (() => void) | null = null;
  connect() {}
  start(...a: number[]) { this.started = a; }
  stop(t: number) { this.stopped.push(t); }
}
class FakeContext {
  static last: FakeContext;
  currentTime = 2;
  sampleRate = 1000;
  state = "running";
  outputLatency = 0.02;
  baseLatency = 0.005;
  destination = {};
  sources: Source[] = [];
  gains: { gain: Param }[] = [];
  constructor() { FakeContext.last = this; }
  createGain() { const g = { gain: new Param(), connect() {} }; this.gains.push(g); return g; }
  createBufferSource() { const s = new Source(); this.sources.push(s); return s; }
  createOscillator() { const s = new Source(); this.sources.push(s); return s; }
  createDynamicsCompressor() {
    const p = () => ({ value: 0 });
    return { threshold: p(), ratio: p(), knee: p(), attack: p(), release: p(), connect() {} };
  }
  createConvolver() { return { buffer: null, connect() {} }; }
  createBuffer(n: number, length: number) {
    const data = Array.from({ length: n }, () => new Float32Array(length));
    return { getChannelData: (i: number) => data[i] };
  }
  addEventListener() {}
  resume() { return Promise.resolve(); }
  // every sample: 50ms of silence at 1kHz, then 10s of sound
  decodeAudioData() {
    const data = Float32Array.from({ length: 10000 }, (_, i) => (i < 50 ? 0 : 0.5));
    return Promise.resolve({ numberOfChannels: 1, sampleRate: 1000, duration: 10, getChannelData: () => data });
  }
}
const g = globalThis as unknown as Record<string, unknown>;
g.window = { AudioContext: FakeContext };
g.fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) });
let wallMs = 1000; // wall 1s <-> audio 2s
performance.now = () => wallMs;

const { AudioOut } = await import("/Users/lukesovernconley/Code/harmonicland/src/outputs/audio");
AudioOut.ensure();
const ctx = FakeContext.last;
for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); // samples decode

// the first gain made is the room's input; voices' gains come after it
const voiceGain = (i: number): Param => ctx.gains[ctx.gains.length - ctx.sources.length + i].gain;
const show = (label: string): void => {
  console.log(`  ${label}`);
  ctx.sources.forEach((s, i) =>
    console.log(`    voice ${i}: started@${s.started[0]} stop() calls=${JSON.stringify(s.stopped)} gain calls=${JSON.stringify(voiceGain(i).calls)}`));
};

console.log("== FAILS_audio_paths_never_touch: the user holds C4, then the score strikes C4 ==");
AudioOut.liveOn(60, 90); // audio time 2
show("after liveOn(60) at audio time 2 (voice 0 = the user's key):");
ctx.currentTime = 3; wallMs = 2000;
AudioOut.strike({ pitch: 60, velocity: 70, at: 2000, off: 2500 }); // audio time 3 .. 3.5
show("after strike{60, at wall 2000 = audio 3, off 2500} (voice 1 = the score's note):");
console.log("  claim (types.ts:190-193): 'Two paths that never touch each other' -> voice 0 untouched while the key is held");
console.log("  actual: voice 0 is faded from audio time 3 (hold@3, target 0 over 8ms) and stopped at 3.064: the score strike cut the user's held note");

console.log("\n== flush_only_score (HOLDS): flush silences the score voice, not a live one ==");
ctx.currentTime = 3.1; wallMs = 2100;
AudioOut.liveOn(64, 90); // voice 2, a live key on another pitch
AudioOut.flush();
show("after liveOn(64) at 3.1 and flush():");
console.log("  voice 1 (score) gets a 50ms fade at 3.1; voice 2 (live, 64) gets no call from flush");
