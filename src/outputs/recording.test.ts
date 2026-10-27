import { describe, it, expect, beforeEach } from "vitest";
import { recordingOutput, type Recording, type RecordingOutput } from "./recording";
import type { Output } from "../types";

/* The output against a recording that moves only when told to and a clock
   that is a pair of variables: what it tells the recording to do, and how
   far behind it says the recording is. */
let wall: number;
let now: number;
let playing: boolean;
let lead: number;
let pos: number;
let calls: string[];
let liveCalls: string[];
let out: RecordingOutput;

const rec: Recording = {
  key: "rec",
  duration: 100,
  position: () => pos,
  play(from) {
    pos = from;
    calls.push(`play ${from}`);
  },
  pause: () => void calls.push("pause"),
  close() {},
};
const live = {
  liveOn: (p: number, v: number) => void liveCalls.push(`on ${p} ${v}`),
  liveOff: (p: number) => void liveCalls.push(`off ${p}`),
  detach: () => void liveCalls.push("detach"),
} as unknown as Output;

/** Time passes: the clock by `s` seconds, the recording by `heard`. */
const pass = (s: number, heard = s): void => {
  wall += s * 1000;
  now += s;
  pos += heard;
  out.advance(wall);
};

beforeEach(() => {
  wall = 0;
  now = 0;
  playing = false;
  lead = 0;
  pos = 0;
  calls = [];
  liveCalls = [];
  out = recordingOutput(rec, {
    clock: { now: () => now, isPlaying: () => playing },
    lead: () => lead,
    live,
    wallNow: () => wall,
  });
});

describe("following the clock", () => {
  it("stays silent while the clock is paused", () => {
    out.flush();
    expect(calls).toEqual([]);
  });

  it("starts where the clock is when it starts, the lead further in", () => {
    lead = 12;
    now = 3;
    playing = true;
    out.flush();
    expect(calls).toEqual(["play 15"]);
  });

  it("is left to run while it keeps up", () => {
    playing = true;
    out.flush();
    for (let i = 0; i < 100; i++) pass(0.025);
    expect(calls).toEqual(["play 0"]);
  });

  it("pauses when the clock does", () => {
    playing = true;
    out.flush();
    playing = false;
    out.flush();
    expect(calls).toEqual(["play 0", "pause"]);
  });

  it("starts again from the new place after a seek", () => {
    playing = true;
    out.flush();
    pass(1);
    now = 40;
    out.flush();
    expect(calls).toEqual(["play 0", "pause", "play 40"]);
  });

  it("goes back when the loop wraps, though nothing announced it", () => {
    playing = true;
    now = 10;
    out.flush();
    pass(0.5);
    now = 8; // the clock folded back to the loop's start
    out.advance(wall);
    expect(calls).toEqual(["play 10", "play 8"]);
  });

  it("is put back once it has drifted too far to follow", () => {
    playing = true;
    out.flush();
    pass(2, 1.2); // the recording stalled for most of a second
    expect(calls).toEqual(["play 0", "play 2"]);
  });

  it("is given a moment to get going before its drift counts", () => {
    playing = true;
    out.flush();
    pass(0.7, 0); // slow to start
    expect(calls).toEqual(["play 0"]);
  });

  it("is silent before the recording begins and sounds once it has", () => {
    lead = -2; // the recording starts two seconds into the score
    playing = true;
    out.flush();
    expect(calls).toEqual([]);
    pass(1, 0);
    expect(calls).toEqual([]);
    pass(1.5, 0);
    expect(calls).toEqual(["play 0.5"]);
  });

  it("falls silent where the recording ends", () => {
    playing = true;
    now = 99.9;
    out.flush();
    pass(0.2);
    expect(calls).toEqual(["play 99.9", "pause"]);
  });

  it("ignores the notes: they are in the recording", () => {
    playing = true;
    out.flush();
    out.strike({ pitch: 60, velocity: 80, at: 0, off: 100 });
    out.pedal(true, 0);
    expect(calls).toEqual(["play 0"]);
  });
});

describe("latency", () => {
  it("is nothing while nothing sounds", () => {
    expect(out.latency()).toBe(0);
  });

  it("settles on how far the recording runs behind the clock", () => {
    playing = true;
    out.flush();
    pass(0.08, 0); // it took 80ms to start
    for (let i = 0; i < 200; i++) pass(0.025);
    expect(out.latency()).toBeCloseTo(0.08, 3);
  });

  it("moves there smoothly, not in one step", () => {
    playing = true;
    out.flush();
    pass(0.08, 0);
    expect(out.latency()).toBeGreaterThan(0);
    expect(out.latency()).toBeLessThan(0.02);
  });

  it("never says the recording is ahead", () => {
    playing = true;
    out.flush();
    for (let i = 0; i < 50; i++) pass(0.025, 0.026);
    expect(out.latency()).toBe(0);
  });

  it("starts over when the recording is restarted", () => {
    playing = true;
    out.flush();
    pass(0.08, 0);
    for (let i = 0; i < 200; i++) pass(0.025);
    now = 50;
    out.flush();
    expect(out.latency()).toBe(0);
  });
});

describe("the live path", () => {
  it("sounds the user's keys on the piano it was given", () => {
    out.liveOn(60, 90);
    out.liveOff(60);
    expect(liveCalls).toEqual(["on 60 90", "off 60"]);
  });

  it("lets go of both when detached", () => {
    playing = true;
    out.flush();
    out.detach();
    expect(calls).toEqual(["play 0", "pause"]);
    expect(liveCalls).toEqual(["detach"]);
  });

  it("picks up again if it is made the output once more", () => {
    playing = true;
    out.flush();
    out.detach();
    pass(1, 0);
    expect(calls).toEqual(["play 0", "pause", "play 1"]);
  });
});

describe("lent out", () => {
  it("leaves the recording alone whatever the clock does", () => {
    playing = true;
    out.flush();
    out.lend(true);
    playing = false;
    out.flush();
    now = 30;
    out.flush();
    out.advance(wall);
    out.detach();
    expect(calls).toEqual(["play 0"]);
    expect(out.latency()).toBe(0);
  });

  it("follows the clock again when handed back", () => {
    out.lend(true);
    out.lend(false);
    now = 5;
    playing = true;
    out.flush();
    expect(calls).toEqual(["play 5"]);
  });
});
