import { describe, it, expect } from "vitest";
import { encode } from "./midi-out";

describe("midi-out encode", () => {
  it("encodes note-on with the default velocity on channel 1", () => {
    expect(encode("on", 60)).toEqual([0x90, 60, 100]);
  });

  it("encodes note-off with release velocity 0", () => {
    expect(encode("off", 64)).toEqual([0x80, 64, 0]);
  });

  it("honours an explicit note-on velocity", () => {
    expect(encode("on", 72, 40)).toEqual([0x90, 72, 40]);
  });

  it("forces velocity 0 on note-off even when one is passed", () => {
    expect(encode("off", 50, 90)).toEqual([0x80, 50, 0]);
  });

  it("round-trips with live-midi decode (out -> in)", async () => {
    const { decode } = await import("../live-midi");
    expect(decode(new Uint8Array(encode("on", 67)))).toEqual({ kind: "on", pitch: 67, vel: 100 });
    expect(decode(new Uint8Array(encode("off", 67)))).toEqual({ kind: "off", pitch: 67, vel: 0 });
  });
});
