import { describe, it, expect } from "vitest";
import { keysBandH, rollBandH } from "./staff-piano";
import { PianoRoll, KEYB } from "./piano-roll";
import { StaffStd } from "./staff-std";
import { Core } from "../core";

const score = Core.makeScore([{ pitch: 60, onset: 0, duration: 1 }]);
const G = "testGlow"; // markup needs the caller to name its filter
const NONE: ReadonlySet<number> = new Set(); // ...and to pass the live state

describe("staff-piano band layout", () => {
  it("keys band is exactly the keyboard, yielding only on short viewports", () => {
    expect(keysBandH(600)).toBe(KEYB);
    expect(keysBandH(100)).toBe(50); // never more than half the height
  });

  it("roll band adds fall room but the staff keeps the majority", () => {
    expect(rollBandH(600)).toBe(240); // 40% of the height...
    expect(rollBandH(900)).toBe(280); // ...capped
    expect(rollBandH(300)).toBe(136); // floor: keyboard + minimum fall room
    expect(rollBandH(200)).toBe(100); // short viewport: half, like keys
  });
});

describe("the stacked layers' markup", () => {
  it("keys-only piano markup draws the keyboard but no falling bars", () => {
    const keys = PianoRoll.markup(800, KEYB, score, 0.5, { glowId: G, held: NONE, fall: false });
    expect(keys).toContain("var(--key-white)"); // keyboard present
    expect(keys).toContain("var(--note-lit)"); // the sounding key is lit
    expect(keys).not.toContain('rx="2.5"'); // no falling-note bars
  });

  it("full piano markup keeps the falling bars", () => {
    expect(PianoRoll.markup(800, 400, score, 0.5, { glowId: G, held: NONE })).toContain('rx="2.5"');
  });

  it("staff markup is region-sized and carries the sounding notehead", () => {
    const staff = StaffStd.markup(800, 400, score, 0.5, { glowId: G });
    expect(staff).toContain("<ellipse"); // the notehead
    expect(staff).toContain("var(--note-lit)"); // lit at t=0.5
    expect(StaffStd.markup(0, 400, score, 0.5, { glowId: G })).toBe(""); // degenerate region
  });
});

describe("hand coloring", () => {
  // the parser has already resolved the hand; the renderers just read it
  const both = Core.makeScore([
    { pitch: 72, onset: 0, duration: 1, hand: "upper" },
    { pitch: 48, onset: 0, duration: 1, hand: "lower" },
  ]);

  it("hues staff and roll by hand when on, not at all when off", () => {
    for (const on of [
      StaffStd.markup(800, 400, both, 0.5, { glowId: G, hands: true }),
      PianoRoll.markup(800, 400, both, 0.5, { glowId: G, held: NONE, hands: true }),
    ]) {
      expect(on).toContain("var(--hand-r)");
      expect(on).toContain("var(--hand-l)");
    }
    for (const off of [
      StaffStd.markup(800, 400, both, 0.5, { glowId: G }),
      PianoRoll.markup(800, 400, both, 0.5, { glowId: G, held: NONE }),
    ]) {
      expect(off).not.toContain("var(--hand-");
    }
  });

  it("ignores raw stream provenance — only `hand` colors a note", () => {
    // stream numbering varies by source (MIDI tracks may start at 2 behind a
    // tempo track), which is exactly why renderers no longer look at it.
    const tracked = Core.makeScore([
      { pitch: 72, onset: 0, duration: 1, hand: "upper", stream: 2 },
      { pitch: 48, onset: 0, duration: 1, hand: "lower", stream: 3 },
    ]);
    const staff = StaffStd.markup(800, 400, tracked, 0.5, { glowId: G, hands: true });
    expect(staff).toContain("var(--hand-r)");
    expect(staff).toContain("var(--hand-l)");
  });

  it("does not color by stream when the parser resolved no hand", () => {
    const streamed = Core.makeScore([
      { pitch: 72, onset: 0, duration: 1, stream: 1 },
      { pitch: 48, onset: 0, duration: 1, stream: 2 },
    ]);
    expect(StaffStd.markup(800, 400, streamed, 0.5, { glowId: G, hands: true })).not.toContain("var(--hand-");
  });

  it("scores without hand data render unchanged with the toggle on", () => {
    expect(StaffStd.markup(800, 400, score, 0.5, { glowId: G, hands: true })).not.toContain("var(--hand-");
  });
});
