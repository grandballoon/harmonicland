import { describe, it, expect } from "vitest";
import { Core } from "./core";
import { makeSteps } from "./steps";
import { added, links, nextInHand } from "./backchain";
import type { RawNote } from "./types";

/* Two bars of 4/4 at a beat a second: bar 1 is four quarter notes, bar 2
   a chord on beat 1, a note on beat 3, and a rest to the end. */
const n = (pitch: number, onset: number, duration = 1): RawNote => ({ pitch, onset, duration });
const piece = Core.makeScore(
  [n(60, 0), n(62, 1), n(64, 2), n(65, 3), n(67, 4), n(71, 4), n(72, 6)],
  [0, 4, 8],
);
const { steps } = makeSteps(piece, "both");
const starts = (r: ReturnType<typeof links>) => r.map((x) => Core.barTime(piece, x).start);

describe("a backchain", () => {
  it("grows from the last note back to the first, one link per note", () => {
    const chain = links(piece, steps, { from: 0, to: 0 });
    expect(starts(chain)).toEqual([3, 2, 1, 0]);
    expect(chain[0]).toEqual({ from: 0, to: 0, fromBeat: 3 });
    expect(chain[3]).toEqual({ from: 0, to: 0 });
  });

  it("keeps the section's end on every link, trim and all", () => {
    const chain = links(piece, steps, { from: 0, to: 1, toBeat: 2 });
    expect(chain.every((r) => r.to === 1 && r.toBeat === 2)).toBe(true);
    expect(starts(chain)).toEqual([4, 3, 2, 1, 0]); // the note at 6 is past the end
  });

  it("counts a chord as one note", () => {
    expect(starts(links(piece, steps, { from: 1, to: 1 }))).toEqual([6, 4]);
  });

  it("ends on the section as chosen, even when it opens on a rest", () => {
    const rest = Core.makeScore([n(60, 1), n(62, 2)], [0, 4]);
    const chain = links(rest, makeSteps(rest, "both").steps, { from: 0, to: 0 });
    expect(chain).toEqual([{ from: 0, to: 0, fromBeat: 2 }, { from: 0, to: 0 }]);
  });

  it("leaves out a note begun before the section and still sounding into it", () => {
    // one note begins in bar 2, so one link — and, being the longest, it is the whole bar
    const tied = Core.makeScore([n(60, 3, 3), n(62, 5), n(64, 6)], [0, 4, 8]);
    expect(starts(links(tied, makeSteps(tied, "both").steps, { from: 1, to: 1 }))).toEqual([6, 4]);
  });

  it("chains the whole piece when nothing is selected", () => {
    expect(starts(links(piece, steps, null))).toEqual([6, 4, 3, 2, 1, 0]);
  });

  it("is empty for a section with no notes in it", () => {
    const quiet = Core.makeScore([n(60, 0)], [0, 4, 8]);
    expect(links(quiet, makeSteps(quiet, "both").steps, { from: 1, to: 1 })).toEqual([]);
  });

  it("starts each link on its note in an uneven meter, where beats are not seconds", () => {
    // 3/4 at 0.7s a beat, notes on off-beat eighths
    const beat = 0.7;
    const odd = Core.makeScore(
      [0.35, 1.05, 1.75].map((t, i) => n(60 + i, t, 0.3)),
      [{ at: 0, beats: 3, unit: 4 }, 3 * beat],
    );
    const chain = links(odd, makeSteps(odd, "both").steps, { from: 0, to: 0 });
    expect(chain.map((r) => Core.barTime(odd, r).start)).toEqual([1.75, 1.05, 0]);
  });
});

describe("a backchain skipping to one hand", () => {
  /* One bar: the right hand on beats 1 and 4, the left alone on 2 and 3,
     and a hand-less note (every hand's) with the left on 4 too. */
  const h = (pitch: number, onset: number, hand?: "upper" | "lower"): RawNote => ({ ...n(pitch, onset), hand });
  const hands = Core.makeScore([h(72, 0, "upper"), h(48, 1, "lower"), h(50, 2, "lower"), h(74, 3, "upper")], [0, 4]);
  // links add, in order: beat 4 (R), 3 (L), 2 (L), 1 (R)
  const adds = added(hands, makeSteps(hands, "both").steps, { from: 0, to: 0 });

  it("adds one step per link, last first", () => {
    expect(adds.map((s) => s.at)).toEqual([3, 2, 1, 0]);
  });

  it("steps past the links that add only the other hand's notes, both ways", () => {
    expect(nextInHand(adds, 0, 1, "upper")).toBe(3);
    expect(nextInHand(adds, 3, -1, "upper")).toBe(0);
    expect(nextInHand(adds, 0, 1, "lower")).toBe(1);
  });

  it("is a plain step with both hands", () => {
    expect(nextInHand(adds, 0, 1, "both")).toBe(1);
    expect(nextInHand(adds, 2, -1, "both")).toBe(1);
  });

  it("stays put with no note of that hand left that way", () => {
    expect(nextInHand(adds, 3, 1, "upper")).toBe(3);
    expect(nextInHand(adds, 2, 1, "lower")).toBe(2);
    expect(nextInHand(adds, 1, -1, "lower")).toBe(1);
  });

  it("counts a note with no hand as every hand's", () => {
    const bare = Core.makeScore([h(72, 0, "upper"), h(48, 1, "lower"), h(60, 2)], [0, 4]);
    const a = added(bare, makeSteps(bare, "both").steps, null);
    expect(nextInHand(a, 0, 1, "upper")).toBe(2);
    expect(nextInHand(a, 2, -1, "upper")).toBe(0);
  });
});
