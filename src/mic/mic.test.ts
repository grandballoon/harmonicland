import { describe, it, expect } from "vitest";
import { NoiseGate, DEFAULT_GATE } from "./gate";
import { DEFAULT_TRACKER, NoteTracker, type NoteEvent } from "./note-tracker";
import {
  DEFAULT_SETTINGS, channelOf, loadSettings, parse, saveSettings, trackerOptions, withChannel, type MicSettings,
} from "./settings";
import { DEFAULT_TRANSCRIBER, Transcriber, type Activations, type Infer } from "./transcriber";
import {
  FRAME_HOP, LOWEST_PITCH, N_PITCHES, StreamWindow, WINDOW_FRAMES, WINDOW_SAMPLES, frameLevelDb,
} from "./window";

const C4 = 60 - LOWEST_PITCH; // row of middle C
const row = (vals: Record<number, number> = {}) => {
  const r = new Float32Array(N_PITCHES);
  for (const [i, v] of Object.entries(vals)) r[+i] = v;
  return r;
};
const fmt = (evs: NoteEvent[]) => evs.map((e) => `${e.kind === "on" ? "+" : "-"}${e.pitch}`);

describe("StreamWindow", () => {
  it("snapshots a full window aligned to the frame grid", () => {
    const w = new StreamWindow();
    const audio = Float32Array.from({ length: WINDOW_SAMPLES + 1000 }, (_, i) => i);
    w.push(audio);
    const { samples, startFrame } = w.snapshot();
    expect(samples.length).toBe(WINDOW_SAMPLES);
    // the newest window starting on a multiple of FRAME_HOP
    expect(startFrame).toBe(Math.floor(1000 / FRAME_HOP));
    expect(samples[0]).toBe(startFrame * FRAME_HOP);
  });

  it("pads with silence before the first two seconds arrive", () => {
    const w = new StreamWindow();
    w.push(new Float32Array(FRAME_HOP * 10).fill(1));
    const { samples, startFrame } = w.snapshot();
    expect(startFrame).toBeLessThan(0);
    expect(samples[0]).toBe(0);
    expect(samples[WINDOW_SAMPLES - 1]).toBe(1); // the newest sample is at the edge
  });

  it("settles up to the lookahead short of the window edge", () => {
    const w = new StreamWindow();
    w.push(new Float32Array(WINDOW_SAMPLES));
    expect(w.settledThrough(0)).toBe(WINDOW_FRAMES - 1);
    expect(w.settledThrough(8)).toBe(WINDOW_FRAMES - 9);
  });

  it("keeps the right samples across the ring's wrap", () => {
    const w = new StreamWindow();
    let n = 0;
    for (let k = 0; k < 40; k++) w.push(Float32Array.from({ length: 4000 }, () => n++));
    const { samples, startFrame } = w.snapshot();
    for (const i of [0, 1, 20000, WINDOW_SAMPLES - 1]) expect(samples[i]).toBe(startFrame * FRAME_HOP + i);
  });

  it("measures a frame's level in dBFS", () => {
    const s = new Float32Array(WINDOW_SAMPLES).fill(0.1);
    expect(frameLevelDb(s, 10)).toBeCloseTo(-20, 5);
    expect(frameLevelDb(new Float32Array(WINDOW_SAMPLES), 10)).toBe(-Infinity);
  });
});

describe("NoiseGate", () => {
  it("stays shut on a steady noise floor, whatever its level", () => {
    for (const noise of [-75, -45]) {
      const g = new NoiseGate();
      for (let i = 0; i < 200; i++) expect(g.frame(noise)).toBe(false);
    }
  });

  it("opens for playing above the floor, and holds through a short dip", () => {
    const g = new NoiseGate();
    for (let i = 0; i < 50; i++) g.frame(-60);
    expect(g.frame(-60 + DEFAULT_GATE.marginDb + 1)).toBe(true);
    expect(g.frame(-60)).toBe(true); // held
    for (let i = 0; i < DEFAULT_GATE.holdFrames; i++) g.frame(-60);
    expect(g.frame(-60)).toBe(false);
  });

  it("drops to a quieter floor at once but rises slowly under a held chord", () => {
    const g = new NoiseGate();
    g.frame(-40);
    g.frame(-70);
    expect(g.floorDb).toBe(-70);
    for (let i = 0; i < 86; i++) g.frame(-30); // one second of loud playing
    expect(g.floorDb).toBeLessThan(-69);
    expect(g.frame(-30)).toBe(true);
  });

  it("treats digital silence as a very low floor, not -Infinity", () => {
    const g = new NoiseGate();
    g.frame(-Infinity);
    expect(Number.isFinite(g.floorDb)).toBe(true);
  });
});

describe("NoteTracker", () => {
  const strike = { [C4]: 0.9 };
  const sound = { [C4]: 0.8 };

  it("lights a key on a confirmed strike and lifts it after the debounce", () => {
    const t = new NoteTracker();
    expect(fmt(t.frame(row(strike), row(sound), true))).toEqual(["+60"]);
    for (let i = 0; i < 10; i++) expect(t.frame(row(), row(sound), true)).toEqual([]);
    const lifts: NoteEvent[] = [];
    for (let i = 0; i < DEFAULT_TRACKER.releaseFrames; i++) lifts.push(...t.frame(row(), row(), true));
    expect(fmt(lifts)).toEqual(["-60"]);
  });

  it("ignores an overtone: a strong onset whose frame activation stays low", () => {
    const t = new NoteTracker();
    const out: NoteEvent[] = [];
    out.push(...t.frame(row({ [C4 + 12]: 0.79 }), row({ [C4 + 12]: 0.35 }), true));
    for (let i = 0; i < 5; i++) out.push(...t.frame(row(), row({ [C4 + 12]: 0.35 }), true));
    expect(out).toEqual([]);
  });

  it("waits a few frames for the frame activation to confirm a strike", () => {
    const t = new NoteTracker();
    expect(t.frame(row(strike), row({ [C4]: 0.2 }), true)).toEqual([]);
    expect(fmt(t.frame(row(), row(sound), true))).toEqual(["+60"]);
  });

  it("reports a re-strike of a held key as off-then-on", () => {
    const t = new NoteTracker();
    t.frame(row(strike), row(sound), true);
    for (let i = 0; i < DEFAULT_TRACKER.minHoldFrames; i++) t.frame(row(), row(sound), true);
    expect(fmt(t.frame(row(strike), row(sound), true))).toEqual(["-60", "+60"]);
  });

  it("does not flicker a key that dips briefly below the frame threshold", () => {
    const t = new NoteTracker();
    t.frame(row(strike), row(sound), true);
    const out: NoteEvent[] = [];
    for (let i = 0; i < 10; i++) out.push(...t.frame(row(), row(i % 3 ? sound : {}), true));
    expect(out).toEqual([]);
  });

  it("hears nothing through a closed gate", () => {
    const t = new NoteTracker();
    expect(t.frame(row(strike), row(sound), false)).toEqual([]);
  });

  it("releases every held key at once", () => {
    const t = new NoteTracker();
    t.frame(row({ [C4]: 0.9, [C4 + 4]: 0.9 }), row({ [C4]: 0.8, [C4 + 4]: 0.8 }), true);
    expect(fmt(t.releaseAll())).toEqual(["-60", "-64"]);
    expect(t.releaseAll()).toEqual([]);
  });
});

describe("Transcriber", () => {
  // A scripted model: C4 is struck at absolute frame 100 and sounds until
  // frame 200. Each window's start is recovered from how much audio has
  // been pushed, which is what the snapshot is taken from.
  it("turns a stream of audio into note events, each frame settled once", async () => {
    const events: NoteEvent[] = [];
    let pushed = 0;
    const infer: Infer = async () => {
      const s = Math.floor((pushed - WINDOW_SAMPLES) / FRAME_HOP);
      const at = (f: number, from: number, to: number, v: number) => row(s + f >= from && s + f < to ? { [C4]: v } : {});
      const act: Activations = {
        onsets: Array.from({ length: WINDOW_FRAMES }, (_, f) => at(f, 100, 101, 0.9)),
        frames: Array.from({ length: WINDOW_FRAMES }, (_, f) => at(f, 100, 200, 0.8)),
      };
      return act;
    };
    let stats = 0;
    const tr = new Transcriber(infer, { ...DEFAULT_TRANSCRIBER, lookahead: 8, minHopFrames: 4 },
      { onEvents: (e) => events.push(...e), onStats: () => stats++ });
    // a quiet room, then playing loud enough to hold the gate open
    const audio = new Float32Array(FRAME_HOP * 400).fill(0.2);
    audio.fill(0.0005, 0, 30 * FRAME_HOP);
    for (let i = 0; i < audio.length; i += 512) {
      const chunk = audio.subarray(i, i + 512);
      pushed += chunk.length;
      tr.push(chunk);
      await tr.settled();
    }
    expect(fmt(events)).toEqual(["+60", "-60"]);
    expect(stats).toBeGreaterThan(0);
  });

  it("reports a failing model once and then ignores audio", async () => {
    const errors: unknown[] = [];
    let calls = 0;
    const tr = new Transcriber(async () => { calls++; throw new Error("context lost"); }, DEFAULT_TRANSCRIBER, {
      onEvents: () => {},
      onError: (e) => errors.push(e),
    });
    for (let i = 0; i < 20; i++) {
      tr.push(new Float32Array(2048));
      await tr.settled();
    }
    expect(errors).toHaveLength(1);
    expect(calls).toBe(1);
  });
});

describe("mic settings", () => {
  it("remembers the channel per device", () => {
    let s: MicSettings = { ...DEFAULT_SETTINGS, deviceId: "interface" };
    s = withChannel(s, 1);
    expect(channelOf(s)).toBe(1);
    expect(channelOf({ ...s, deviceId: "laptop" })).toBe("mix");
    expect(channelOf({ ...s, deviceId: "interface" })).toBe(1);
  });

  it("keeps the confirm threshold above overtone level at full sensitivity", () => {
    expect(trackerOptions(1).confirmThreshold).toBeGreaterThan(0.4);
    expect(trackerOptions(0.5).onsetThreshold).toBeCloseTo(DEFAULT_TRACKER.onsetThreshold);
    expect(trackerOptions(0).onsetThreshold).toBeGreaterThan(trackerOptions(1).onsetThreshold);
  });

  it("parses damaged storage field by field", () => {
    expect(parse(null)).toEqual(DEFAULT_SETTINGS);
    expect(parse({ response: "warp", sensitivity: 7, deviceId: "x", channels: { x: 2, y: -1, z: "mix" } }))
      .toEqual({ ...DEFAULT_SETTINGS, deviceId: "x", channels: { x: 2, z: "mix" } });
  });

  it("round-trips through storage, and survives storage that throws", () => {
    const mem = new Map<string, string>();
    const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) } as Storage;
    const s = { ...DEFAULT_SETTINGS, response: "fast" as const, sensitivity: 0.8 };
    saveSettings(s, () => store);
    expect(loadSettings(() => store)).toEqual(s);
    const broken = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("full"); } } as unknown as Storage;
    expect(loadSettings(() => broken)).toEqual(DEFAULT_SETTINGS);
    expect(() => saveSettings(s, () => broken)).not.toThrow();
  });
});
