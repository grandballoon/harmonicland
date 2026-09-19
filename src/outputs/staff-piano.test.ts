import { describe, it, expect } from "vitest";
import { keysBandH, rollBandH } from "./staff-piano";
import { PianoRoll, KEYB } from "./piano-roll";
import { StaffPiano } from "./staff-piano";
import { StaffBars } from "./staff-bars";
import { makeSteps } from "../steps";
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

  it("the staff is the engraved page, lit where the score sounds", () => {
    const staff = StaffPiano.page(800, 400, score, 0.5, G);
    expect(staff).toContain("<ellipse"); // the notehead
    expect(staff).toContain("var(--note-lit)"); // lit at t=0.5
    expect(staff).toContain("var(--playhead)"); // the rule through its column
    // the same markup practice draws for the bar, with the same step lit
    const { steps } = makeSteps(score, "both");
    expect(staff).toBe(StaffBars.markup(800, 400, score, {
      glowId: G, focus: { from: 0, to: 0 }, range: null, current: steps[0], hand: "both", showOther: true,
    }));
  });

  it("the page goes dark when nothing sounds, and is a blank staff before a score loads", () => {
    const quiet = StaffPiano.page(800, 400, score, 1.5, G);
    expect(quiet).toContain("<ellipse"); // the note is still on the page...
    expect(quiet).not.toContain("var(--note-lit)"); // ...but not lit
    const blank = StaffPiano.page(800, 400, Core.makeScore([]), 0, G);
    expect(blank).toContain("var(--staff-line)");
    expect(blank).not.toContain("<ellipse");
  });
});

describe("hand coloring", () => {
  // the parser has already resolved the hand; the roll just reads it
  const both = Core.makeScore([
    { pitch: 72, onset: 0, duration: 1, hand: "upper" },
    { pitch: 48, onset: 0, duration: 1, hand: "lower" },
  ]);

  it("hues the roll by hand when on, not at all when off", () => {
    const on = PianoRoll.markup(800, 400, both, 0.5, { glowId: G, held: NONE, hands: true });
    expect(on).toContain("var(--hand-r)");
    expect(on).toContain("var(--hand-l)");
    expect(PianoRoll.markup(800, 400, both, 0.5, { glowId: G, held: NONE })).not.toContain("var(--hand-");
  });

  it("ignores raw stream provenance — only `hand` colors a note", () => {
    // stream numbering varies by source (MIDI tracks may start at 2 behind a
    // tempo track), which is exactly why renderers no longer look at it.
    const streamed = Core.makeScore([
      { pitch: 72, onset: 0, duration: 1, stream: 1 },
      { pitch: 48, onset: 0, duration: 1, stream: 2 },
    ]);
    expect(PianoRoll.markup(800, 400, streamed, 0.5, { glowId: G, held: NONE, hands: true })).not.toContain("var(--hand-");
  });
});

describe("the page as a tape", () => {
  // eight bars of quarter notes, a second a bar
  const notes = Array.from({ length: 32 }, (_, i) => ({ pitch: 60 + (i % 12), onset: i * 0.25, duration: 0.25 }));
  const piece = Core.makeScore(notes, Array.from({ length: 9 }, (_, i) => i));
  const W = 900;
  const H = 300;
  const t = 2.3; // in bar 2
  const tl = StaffBars.timeline(W, piece, { from: 2, to: 2 }, "both", true);

  it("rests on the playhead's bar, and panning holds the bar it was panned from", () => {
    const tape = StaffPiano.pageTape(W, H, piece, t, null)!;
    expect(tape.axis).toBe("x");
    expect(tape.pagePan).toBeNull();
    expect(tape.seek(tape.pos + 200).pagePan).toEqual({ bar: 2, pan: 200 });
  });

  it("moves the playhead by what slid under it, so it stays put on screen", () => {
    const tape = StaffPiano.pageTape(W, H, piece, t, null)!;
    const to = tape.seek(tape.pos + 120);
    expect(to.t).toBeGreaterThan(t);
    expect(tl.xOf(to.t) - 120).toBeCloseTo(tl.xOf(t));
    // the frame drawn there stands the scroller where the reader left it
    const next = StaffPiano.pageTape(W, H, piece, to.t, to.pagePan)!;
    expect(next.pos).toBeCloseTo(tape.pos + 120);
    expect(next.pagePan).toEqual(to.pagePan);
  });

  it("draws the page where its tape holds it", () => {
    const held = { bar: 2, pan: 120 };
    const at = tl.timeAt(tl.xOf(t) + 120);
    expect(StaffPiano.page(W, H, piece, at, G, held)).toBe(StaffBars.markup(W, H, piece, {
      glowId: G, focus: { from: 2, to: 2 }, range: null,
      current: makeSteps(piece, "both").steps.find((s) => s.at <= at && at < s.at + 0.25)!,
      hand: "both", showOther: true, pan: 120,
    }));
  });

  it("comes back to rest once the playhead leaves the window", () => {
    const held = { bar: 2, pan: 0 };
    expect(StaffPiano.standAt(W, piece, t, held)).toEqual(held);
    expect(StaffPiano.standAt(W, piece, 7.5, held)).toBeNull();
    expect(StaffPiano.pageTape(W, H, piece, 7.5, held)!.pagePan).toBeNull();
    expect(StaffPiano.page(W, H, piece, 7.5, G, held)).toBe(StaffPiano.page(W, H, piece, 7.5, G));
  });

  it("forgets a bar the score no longer has", () => {
    expect(StaffPiano.standAt(W, piece, t, { bar: 99, pan: 0 })).toBeNull();
  });
});
