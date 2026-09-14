import { describe, it, expect } from "vitest";
import { PianoRoll, KEYB } from "./piano-roll";
import { keysBandH } from "./staff-piano";
import { Core } from "../core";

const W = 800;
const score = Core.makeScore([]);
const G = "testGlow"; // markup needs the caller to name its filter
const NONE: ReadonlySet<number> = new Set(); // ...and to pass the live state

// pitchAt reads only getBoundingClientRect and (when no region is given) the
// client size, so a plain stub is enough — the arithmetic under test is pure.
const stubSvg = (w: number, h: number) =>
  ({
    clientWidth: w,
    clientHeight: h,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: w, height: h }),
  }) as unknown as SVGSVGElement;

/* A band SHORTER than the preferred KEYB is the case staff-piano hands over
   on any viewport under 192px, and the case that used to put strikeY at a
   negative y: the keyboard was drawn above the band where the clip ate it,
   every y in the band mapped to one white key, and no black key was
   reachable at any pixel. layout() now derives the key height from the band
   it was actually given, so a short band is squat but fully playable. */
describe("PianoRoll in a band shorter than KEYB", () => {
  const H = 150; // viewport
  const band = keysBandH(H); // 75 — half the viewport, well under KEYB
  const region = { x: 0, y: H - band, w: W, h: band };
  const svg = stubSvg(W, H);
  const at = (x: number, yInBand: number) =>
    PianoRoll.pitchAt(svg, x, region.y + yInBand, region);

  it("is the case the audit describes — the band really is under KEYB", () => {
    expect(band).toBeLessThan(KEYB);
  });

  it("keeps the strike line inside the band, so nothing draws above the clip", () => {
    const strike = /<line x1="0" y1="([-\d.]+)"/.exec(PianoRoll.markup(W, band, score, 0, { glowId: G, held: NONE }));
    expect(strike).not.toBeNull();
    expect(Number(strike![1])).toBeGreaterThanOrEqual(0);
  });

  it("draws no geometry above the band", () => {
    const markup = PianoRoll.markup(W, band, score, 0, { glowId: G, held: NONE });
    expect(markup).not.toMatch(/y(?:1|2)?="-/); // no negative y anywhere
  });

  it("discriminates white keys horizontally", () => {
    const low = at(10, band - 5);
    const high = at(W - 10, band - 5);
    expect(low).not.toBeNull();
    expect(high).not.toBeNull();
    expect(low).not.toBe(high);
  });

  it("still reaches black keys in the upper part of the band", () => {
    const black = new Set<number>();
    for (let x = 0; x < W; x += 2) {
      const p = at(x, 4); // just below the strike line: the black-key band
      if (p !== null && [1, 3, 6, 8, 10].includes(((p % 12) + 12) % 12)) black.add(p);
    }
    expect(black.size).toBeGreaterThan(0);
  });

  it("maps every y in the band to a key, and nothing above it", () => {
    for (let y = 0; y <= band; y += 5) expect(at(W / 2, y)).not.toBeNull();
    expect(at(W / 2, -1)).toBeNull(); // above the band is not the keyboard
  });
});

describe("PianoRoll in a band taller than KEYB", () => {
  it("keeps the keyboard at its preferred height, leaving the rest for fall room", () => {
    const strike = /<line x1="0" y1="([-\d.]+)"/.exec(PianoRoll.markup(W, 400, score, 0, { glowId: G, held: NONE }));
    expect(Number(strike![1])).toBe(400 - KEYB);
  });
});

/* keyStyles lets a caller colour keys from something other than (score, t)
   — practice mode colours them from a STEP. An override that lost to the
   defaults would not be one, so precedence is the thing to pin down. */
describe("PianoRoll.keyStyles", () => {
  const lit = Core.makeScore([{ pitch: 60, onset: 0, duration: 1 }]);
  // keys only: the override is about KEYS, and a falling bar carries the
  // same tokens for its own reasons.
  const roll = (o: Parameters<typeof PianoRoll.markup>[4]) =>
    PianoRoll.markup(W, KEYB, lit, 0, { fall: false, ...o });

  it("changes nothing when absent", () => {
    expect(roll({ glowId: G, held: NONE })).toBe(roll({ glowId: G, held: NONE, keyStyles: new Map() }));
  });

  it("outranks a live press", () => {
    const out = roll({
      glowId: G, held: new Set([60]),
      keyStyles: new Map([[60, { fill: "var(--wrong)" }]]),
    });
    expect(out).toContain("var(--wrong)");
    expect(out).not.toContain("var(--key-press)");
  });

  it("outranks the score's own sounding hue", () => {
    const out = roll({ glowId: G, held: NONE, keyStyles: new Map([[60, { fill: "var(--wrong)" }]]) });
    expect(out).not.toContain("var(--note-lit)");
  });

  it("owns the glow too, so a dim override does not glow like a lit key", () => {
    const dim = roll({ glowId: G, held: new Set([60]), keyStyles: new Map([[60, { fill: "var(--hand-l)" }]]) });
    const loud = roll({ glowId: G, held: NONE, keyStyles: new Map([[60, { fill: "var(--hand-l)", glow: true }]]) });
    expect(dim).not.toContain(`url(#${G})`);
    expect(loud).toContain(`url(#${G})`);
  });

  it("leaves keys it says nothing about alone", () => {
    const out = roll({ glowId: G, held: new Set([64]), keyStyles: new Map([[60, { fill: "var(--wrong)" }]]) });
    expect(out).toContain("var(--key-press)"); // 64 is still the learner's
  });
});

/* The arrow overlay in the practice view points at keys it does not draw.
   geometry() is how it does that without a second copy of this math. */
describe("PianoRoll.geometry", () => {
  it("agrees with pitchAt about where a key is", () => {
    const H = KEYB;
    const { lane } = PianoRoll.geometry(W, H);
    const svg = stubSvg(W, H);
    for (const p of [21, 60, 61, 72, 108]) {
      const { x, w } = lane(p);
      expect(PianoRoll.pitchAt(svg, x + w / 2, 2, { x: 0, y: 0, w: W, h: H })).toBe(p);
    }
  });

  it("puts the strike line where markup drew it", () => {
    const strike = /<line x1="0" y1="([-\d.]+)"/.exec(PianoRoll.markup(W, 400, score, 0, { glowId: G, held: NONE }));
    expect(PianoRoll.geometry(W, 400).strikeY).toBe(Number(strike![1]));
  });
});
