import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  samplePitchFor, sampleName, leadingSilence, voicing, levelDb, LAYERS,
  releaseTime, victim, HIGHEST_DAMPED, MAX_VOICES,
} from "./audio";
import levels from "./salamander.json";

/* The sampled piano's pure math: 30 samples every minor third A0..C8;
   every playable pitch maps to a sample at most one semitone away. */
describe("AudioOut sample map", () => {
  it("pitches that ARE samples map to themselves", () => {
    for (const p of [21, 24, 27, 30, 60, 108]) expect(samplePitchFor(p)).toBe(p);
  });

  it("in-between pitches round to the nearest sample (never more than 1 semitone off)", () => {
    expect(samplePitchFor(61)).toBe(60); // C#4 -> C4 sample, shifted up
    expect(samplePitchFor(62)).toBe(63); // D4  -> D#4 sample, shifted down
    for (let p = 21; p <= 108; p++) expect(Math.abs(samplePitchFor(p) - p)).toBeLessThanOrEqual(1);
  });

  it("clamps to the sampled range at the extremes", () => {
    expect(samplePitchFor(0)).toBe(21); // below A0
    expect(samplePitchFor(127)).toBe(108); // above C8
  });

  it("names sample files the way the Salamander set does", () => {
    expect(sampleName(21)).toBe("A0");
    expect(sampleName(24)).toBe("C1");
    expect(sampleName(27)).toBe("Ds1");
    expect(sampleName(30)).toBe("Fs1");
    expect(sampleName(60)).toBe("C4");
    expect(sampleName(108)).toBe("C8");
  });
});

describe("velocity -> layer and gain", () => {
  const all = () => true;
  const peak = (layer: number, name: string) => (levels.peakDb as Record<string, Record<string, number>>)[layer][name];

  it("sounds the layer recorded nearest the velocity", () => {
    expect(voicing(20, "C4", all)!.layer).toBe(4);
    expect(voicing(50, "C4", all)!.layer).toBe(4);
    expect(voicing(55, "C4", all)!.layer).toBe(8);
    expect(voicing(80, "C4", all)!.layer).toBe(12);
    expect(voicing(127, "C4", all)!.layer).toBe(16);
  });

  it("falls back to the nearest layer that is ready, and to none", () => {
    expect(voicing(124, "C4", (l) => l === 8)!.layer).toBe(8);
    expect(voicing(80, "C4", () => false)).toBeNull();
  });

  it("keeps loudness continuous where the layer changes", () => {
    // either side of the v8/v12 boundary, the recording changes but the
    // level heard (recording peak x gain) does not jump
    const heard = (vel: number) => {
      const v = voicing(vel, "C4", all)!;
      return 20 * Math.log10(v.gain) + peak(v.layer, "C4");
    };
    expect(Math.abs(heard(76.4) - heard(76.6))).toBeLessThan(0.1);
  });

  it("gets louder with velocity, across a piano's range", () => {
    const heard = (vel: number) => {
      const v = voicing(vel, "C4", all)!;
      return 20 * Math.log10(v.gain) + peak(v.layer, "C4");
    };
    for (let vel = 2; vel <= 127; vel++) expect(heard(vel)).toBeGreaterThan(heard(vel - 1));
    expect(heard(124) - heard(20)).toBeGreaterThan(25);
  });

  it("interpolates the layers' levels, held flat past the ends", () => {
    const [lo, hi] = [LAYERS[0], LAYERS[LAYERS.length - 1]];
    expect(levelDb(1, "C4")).toBe(peak(lo.layer, "C4"));
    expect(levelDb(127, "C4")).toBe(peak(hi.layer, "C4"));
    expect(levelDb(lo.velocity, "C4")).toBe(peak(lo.layer, "C4"));
  });
});

describe("the strings", () => {
  it("damps a bass string slowly and a treble one fast, on a log scale", () => {
    expect(releaseTime(21)).toBeCloseTo(0.25, 9);
    expect(releaseTime(84)).toBeCloseTo(0.05, 9);
    expect(releaseTime(52)).toBeCloseTo(0.25 * Math.pow(0.2, 0.5), 2); // halfway, geometrically
    expect(releaseTime(100)).toBeCloseTo(0.05, 9);
    for (let p = 22; p <= 84; p++) expect(releaseTime(p)).toBeLessThan(releaseTime(p - 1));
  });

  it("gives way the voice released longest ago, else the oldest, and never one still to come", () => {
    const v = (start: number, releaseAt = Infinity) => ({ start, releaseAt });
    const held = v(0);
    const early = v(1, 2);
    const late = v(0.5, 3);
    expect(victim([held, late, early], 5)).toBe(early);
    expect(victim([v(3), held, v(1)], 5)).toBe(held);
    expect(victim([late], 2.5)).toBe(late); // releasing only later: still the oldest
    expect(victim([v(6)], 5)).toBeNull();
  });

  it("allows a full keyboard's worth of voices and then some", () => {
    expect(MAX_VOICES).toBeGreaterThanOrEqual(88);
  });
});

describe("leadingSilence", () => {
  const ch = (zeros: number, then = 0.5, len = 200) =>
    Float32Array.from({ length: len }, (_, i) => (i < zeros ? 0.0001 : then));

  it("finds where the sound starts, backed off 2ms to keep the attack's rise", () => {
    expect(leadingSilence([ch(50)], 1000)).toBeCloseTo(0.048, 9);
  });

  it("takes the earliest channel", () => {
    expect(leadingSilence([ch(80), ch(30)], 1000)).toBeCloseTo(0.028, 9);
  });

  it("never trims into the sound, nor a buffer with no sound at all", () => {
    expect(leadingSilence([ch(1)], 1000)).toBe(0);
    expect(leadingSilence([ch(200)], 1000)).toBe(0);
  });
});

/* The piano against a fake AudioContext that records what it is asked:
   when each source starts, how far in, and when it is released. */
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
  // every sample: 50ms of silence at 1kHz, then sound
  decodeAudioData() {
    const data = Float32Array.from({ length: 1000 }, (_, i) => (i < 50 ? 0 : 0.5));
    return Promise.resolve({ numberOfChannels: 1, sampleRate: 1000, duration: 1, getChannelData: () => data });
  }
}

describe("AudioOut scheduling", () => {
  let Audio: typeof import("./audio").AudioOut;
  let ctx: FakeContext;

  beforeEach(async () => {
    vi.resetModules();
    vi.spyOn(performance, "now").mockImplementation(() => 1000); // wall 1s <-> audio 2s
    (window as unknown as { AudioContext: unknown }).AudioContext = FakeContext;
    vi.stubGlobal("fetch", async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) }));
    Audio = (await import("./audio")).AudioOut;
    Audio.ensure();
    ctx = FakeContext.last;
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); // samples decode
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // the first gain made is the room's input; voices' gains come after it
  const voiceGain = (i: number) => ctx.gains[ctx.gains.length - ctx.sources.length + i].gain;

  it("starts a strike at its wall time on the audio clock, past the sample's silence", () => {
    Audio.strike({ pitch: 60, velocity: 80, at: 1050, off: 1550 });
    const [src] = ctx.sources;
    expect(src.started[0]).toBeCloseTo(2.05, 9);
    expect(src.started[1]).toBeCloseTo(0.048, 9);
    const release = voiceGain(0).calls.find((c) => c[0] === "target")!;
    expect(release[2]).toBeCloseTo(2.55, 9);
    expect(release[3]).toBeCloseTo(releaseTime(60), 9); // C4's own damper
  });

  it("lets an undamped string ring on past its key-up", () => {
    Audio.strike({ pitch: HIGHEST_DAMPED + 1, velocity: 80, at: 1000, off: 1200 });
    expect(voiceGain(0).calls.some((c) => c[0] === "target")).toBe(false);
    expect(ctx.sources[0].stopped).toEqual([]); // it stops when its recording does
  });

  it("takes the oldest voice, faded fast, when every voice is sounding", () => {
    // MAX_VOICES held notes on distinct pitches, then one more
    for (let i = 0; i <= MAX_VOICES; i++) Audio.strike({ pitch: 10 + i, velocity: 80, at: 1000 + i, off: 9000 });
    const stolen = voiceGain(0).calls.filter((c) => c[0] === "target");
    expect(stolen.some((c) => c[3] === 0.0025)).toBe(true);
    expect(voiceGain(1).calls.some((c) => c[0] === "target" && c[3] === 0.0025)).toBe(false);
  });

  it("cuts a string's earlier sound when it is struck again", () => {
    Audio.strike({ pitch: 60, velocity: 80, at: 1000, off: 3000 });
    Audio.strike({ pitch: 60, velocity: 80, at: 1050, off: 3000 });
    expect(voiceGain(0).calls).toContainEqual(["hold", 2.05]);
    expect(voiceGain(0).calls).toContainEqual(["target", 0, 2.05, 0.008]);
  });

  it("lets go where the dampers fall, when the pedal holds them past the key-up", () => {
    Audio.strike({ pitch: 60, velocity: 80, at: 1000, off: 1500, damp: 2500 });
    const release = voiceGain(0).calls.find((c) => c[0] === "target")!;
    expect(release[2]).toBeCloseTo(3.5, 9);
  });

  it("drops into a note at its offset, scaled by the pitch shift", () => {
    Audio.strike({ pitch: 61, velocity: 80, at: 1000, off: 2000, offset: 0.5 });
    expect(ctx.sources[0].started[1]).toBeCloseTo(0.048 + 0.5 * Math.pow(2, 1 / 12), 9);
  });

  it("strikes an overdue note now rather than in the past", () => {
    Audio.strike({ pitch: 60, velocity: 80, at: 900, off: 1500 });
    expect(ctx.sources[0].started[0]).toBe(2);
  });

  it("flush stops a voice still waiting to start, and releases a sounding one", () => {
    Audio.strike({ pitch: 60, velocity: 80, at: 1000, off: 3000 }); // sounding
    Audio.strike({ pitch: 64, velocity: 80, at: 1080, off: 3000 }); // still to come
    Audio.flush();
    const [sounding, waiting] = ctx.sources;
    expect(waiting.stopped).toContain(2); // before its start: never heard
    expect(voiceGain(1).calls.some((c) => c[0] === "target" && c[2] === 2)).toBe(false);
    expect(voiceGain(0).calls).toContainEqual(["hold", 2]);
    expect(voiceGain(0).calls).toContainEqual(["target", 0, 2, 0.05]);
    expect(sounding.stopped).toContain(2.4);
  });

  it("is ready once the first layer is in", async () => {
    expect(Audio.isReady()).toBe(true);
    await expect(Audio.ready()).resolves.toBeUndefined();
  });

  it("reports the device's latency", () => {
    expect(Audio.latency()).toBeCloseTo(0.025, 9);
  });
});
