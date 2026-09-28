import { describe, it, expect } from "vitest";
import { Core } from "./core";
import { makeSteps } from "./steps";
import { links } from "./backchain";
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
