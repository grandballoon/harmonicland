import { describe, it, expect } from "vitest";
import { keysBandH, rollBandH } from "./staff-piano";
import { PianoRoll, KEYB } from "./piano-roll";
import { StaffStd } from "./staff-std";
import { Core } from "../core";

const score = Core.makeScore([{ pitch: 60, onset: 0, duration: 1 }]);

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
    const keys = PianoRoll.markup(800, KEYB, score, 0.5, false);
    expect(keys).toContain("var(--key-white)"); // keyboard present
    expect(keys).toContain("var(--note-lit)"); // the sounding key is lit
    expect(keys).not.toContain('rx="2.5"'); // no falling-note bars
  });

  it("full piano markup keeps the falling bars", () => {
    expect(PianoRoll.markup(800, 400, score, 0.5, true)).toContain('rx="2.5"');
  });

  it("staff markup is region-sized and carries the sounding notehead", () => {
    const staff = StaffStd.markup(800, 400, score, 0.5);
    expect(staff).toContain("<ellipse"); // the notehead
    expect(staff).toContain("var(--note-lit)"); // lit at t=0.5
    expect(StaffStd.markup(0, 400, score, 0.5)).toBe(""); // degenerate region
  });
});

describe("hand coloring", () => {
  // two hands: staff 1 (upper/right) and staff 2 (lower/left)
  const both = Core.makeScore([
    { pitch: 72, onset: 0, duration: 1, staff: 1 },
    { pitch: 48, onset: 0, duration: 1, staff: 2 },
  ]);

  it("hues staff and roll by hand when on, not at all when off", () => {
    for (const on of [StaffStd.markup(800, 400, both, 0.5, true), PianoRoll.markup(800, 400, both, 0.5, true, true)]) {
      expect(on).toContain("var(--hand-r)");
      expect(on).toContain("var(--hand-l)");
    }
    for (const off of [StaffStd.markup(800, 400, both, 0.5), PianoRoll.markup(800, 400, both, 0.5)]) {
      expect(off).not.toContain("var(--hand-");
    }
  });

  it("normalizes staff numbering — the LOWEST staff is the right hand (MIDI tracks may start at 2)", () => {
    const tracked = Core.makeScore([
      { pitch: 72, onset: 0, duration: 1, staff: 2 },
      { pitch: 48, onset: 0, duration: 1, staff: 3 },
    ]);
    expect(Core.upperStaff(tracked)).toBe(2);
    const staff = StaffStd.markup(800, 400, tracked, 0.5, true);
    // the high note (staff 2 = lowest present) gets the right-hand hue
    expect(staff).toContain("var(--hand-r)");
    expect(staff).toContain("var(--hand-l)");
  });

  it("scores without staff data render unchanged with the toggle on", () => {
    expect(StaffStd.markup(800, 400, score, 0.5, true)).not.toContain("var(--hand-");
  });
});
