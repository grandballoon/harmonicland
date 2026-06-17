import { describe, it, expect } from "vitest";
import { decode } from "./live-midi";

const msg = (...bytes: number[]) => new Uint8Array(bytes);

describe("live-midi decode", () => {
  it("decodes note-on with velocity > 0", () => {
    expect(decode(msg(0x90, 60, 100))).toEqual({ kind: "on", pitch: 60, vel: 100 });
  });

  it("treats note-on with velocity 0 as note-off", () => {
    expect(decode(msg(0x90, 60, 0))).toEqual({ kind: "off", pitch: 60, vel: 0 });
  });

  it("decodes note-off", () => {
    expect(decode(msg(0x80, 64, 40))).toEqual({ kind: "off", pitch: 64, vel: 40 });
  });

  it("ignores the channel nibble (listens on all 16)", () => {
    expect(decode(msg(0x95, 72, 80))).toEqual({ kind: "on", pitch: 72, vel: 80 });
    expect(decode(msg(0x8f, 50, 0))).toEqual({ kind: "off", pitch: 50, vel: 0 });
  });

  it("returns null for non-note messages", () => {
    expect(decode(msg(0xb0, 7, 100))).toBeNull(); // control change
    expect(decode(msg(0xe0, 0, 64))).toBeNull(); // pitch bend
    expect(decode(msg(0xc0, 5))).toBeNull(); // program change (short)
  });

  it("returns null for short/empty data", () => {
    expect(decode(msg())).toBeNull();
    expect(decode(msg(0x90, 60))).toBeNull();
  });
});
