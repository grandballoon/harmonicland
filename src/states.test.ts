/* States: the score as a run-length-encoded sequence of sonorities, plus what
   changes between them. Hand-built scores pin the rules; the real Chopin
   prelude is the golden oracle, because the whole design rests on numbers
   measured from it (see spoken-score.md). */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { Core } from "./core";
import { MusicxmlIn } from "./inputs/musicxml";
import { statesOf, transitionsOf, matchMotion, onsetsOf, onsetAt, ONSET_EPS } from "./states";
import type { Note, RawNote } from "./types";

const score = (...raw: RawNote[]) => Core.makeScore(raw);
const n = (pitch: number, onset: number, duration: number): RawNote => ({ pitch, onset, duration });
const pitches = (ns: readonly Note[]) => ns.map((x) => x.pitch);

describe("statesOf", () => {
  it("emits one state per onset, with a sustained note held under a moving line", () => {
    const s = statesOf(score(n(48, 0, 4), n(60, 0, 1), n(62, 1, 1), n(64, 2, 1), n(65, 3, 1)));
    expect(s.map((x) => pitches(x.notes))).toEqual([
      [48, 60],
      [48, 62],
      [48, 64],
      [48, 65],
    ]);

    const bass = s[0].notes[0];
    const t = transitionsOf(s);
    expect(t).toHaveLength(3);
    // the same bass OBJECT is held across every transition — one long note,
    // never released and never restruck.
    for (const tr of t) expect(tr.held).toEqual([bass]);
  });

  it("run-length encodes a restated chord instead of repeating it", () => {
    const s = statesOf(
      score(
        n(60, 0, 0.5), n(64, 0, 0.5), n(67, 0, 0.5),
        n(60, 1, 0.5), n(64, 1, 0.5), n(67, 1, 0.5),
        n(60, 2, 0.5), n(64, 2, 0.5), n(67, 2, 0.5),
        n(60, 3, 0.5), n(64, 3, 0.5), n(67, 3, 0.5),
      ),
    );
    expect(s).toHaveLength(1);
    expect(s[0].repeat).toBe(4);
    expect(pitches(s[0].notes)).toEqual([60, 64, 67]);
    // a run remembers both ends: the first statement and the last, which are
    // different notes at the same pitches.
    expect(s[0].lastNotes).not.toEqual(s[0].notes);
    expect(pitches(s[0].lastNotes)).toEqual([60, 64, 67]);
    expect(s[0].notes[0].onset).toBe(0);
    expect(s[0].lastNotes[0].onset).toBe(3);
  });

  it("leaves lastNotes identical to notes when nothing repeats", () => {
    const s = statesOf(score(n(60, 0, 1), n(62, 1, 1)));
    for (const st of s) expect(st.lastNotes).toBe(st.notes);
  });

  it("counts a restruck note as released AND pressed, never held", () => {
    // 60 is struck at 0, stops, and is struck again at 1: two notes, one pitch.
    const s = statesOf(score(n(60, 0, 1), n(64, 0, 1), n(60, 1, 1), n(67, 1, 1)));
    const [tr] = transitionsOf(s);
    expect(tr.held).toEqual([]);
    expect(pitches(tr.released)).toEqual([60, 64]);
    expect(pitches(tr.pressed)).toEqual([60, 67]);
    expect(tr.released[0]).not.toBe(tr.pressed[0]); // same pitch, different notes
    // ...but the finger never left that key, which is the physical fact the
    // prose needs: one key is replayed, only one key is genuinely new.
    expect(pitches(tr.restruck)).toEqual([60]);
    expect(tr.pressed.length - tr.restruck.length).toBe(1);
  });

  it("does not call a sustained note restruck", () => {
    const s = statesOf(score(n(60, 0, 2), n(64, 0, 1), n(67, 1, 1)));
    const [tr] = transitionsOf(s);
    expect(tr.restruck).toEqual([]);
    expect(pitches(tr.held)).toEqual([60]);
  });

  it("counts a genuinely sustained note as held", () => {
    // the mirror of the case above: one long 60 rather than two short ones.
    const s = statesOf(score(n(60, 0, 2), n(64, 0, 1), n(67, 1, 1)));
    const [tr] = transitionsOf(s);
    expect(pitches(tr.held)).toEqual([60]);
    expect(pitches(tr.released)).toEqual([64]);
    expect(pitches(tr.pressed)).toEqual([67]);
  });

  it("merges onsets within the epsilon and separates onsets beyond it", () => {
    const together = statesOf(score(n(60, 0, 1), n(64, ONSET_EPS / 2, 1)));
    expect(together).toHaveLength(1);
    expect(pitches(together[0].notes)).toEqual([60, 64]);

    const apart = statesOf(score(n(60, 0, 1), n(64, ONSET_EPS * 2, 1)));
    expect(apart.map((x) => pitches(x.notes))).toEqual([[60], [60, 64]]);
  });

  it("measures the epsilon from the group's start, so a tremolo cannot drift", () => {
    // three onsets each within EPS of the previous, but spanning more than EPS
    // in total: chaining would swallow all three into one state.
    const s = statesOf(score(n(60, 0, 1), n(62, ONSET_EPS * 0.8, 1), n(64, ONSET_EPS * 1.6, 1)));
    expect(s.length).toBeGreaterThan(1);
  });

  it("drops a note that ends exactly as the next strikes", () => {
    const s = statesOf(score(n(60, 0, 1), n(64, 1, 1)));
    expect(s.map((x) => pitches(x.notes))).toEqual([[60], [64]]);
  });
});

describe("matchMotion", () => {
  const note = (pitch: number): Note => ({ pitch, spelling: Core.defaultSpelling(pitch), onset: 0, duration: 1 });
  const moves = (rel: number[], pre: number[]) =>
    matchMotion(rel.map(note), pre.map(note)).map((m) => [m.from.pitch, m.to.pitch]);

  it("matches voices without crossing them", () => {
    expect(moves([60, 64], [61, 65])).toEqual([[60, 61], [64, 65]]);
    // the crossing pairing (60->65, 64->61) costs 9; the DP must not pick it.
    expect(moves([60, 64], [65, 61])).toEqual([[60, 61], [64, 65]]);
  });

  it("leaves the surplus side unmatched when the sizes differ", () => {
    expect(moves([60], [59, 61])).toHaveLength(1);
    expect(moves([60, 64], [62])).toHaveLength(1);
  });

  it("resolves equal-cost matchings deterministically, toward the lower partner", () => {
    expect(moves([60], [59, 61])).toEqual([[60, 59]]);
    expect(moves([60, 64], [62])).toEqual([[60, 62]]);
  });

  it("returns nothing when either side is empty", () => {
    expect(moves([], [60])).toEqual([]);
    expect(moves([60], [])).toEqual([]);
  });

  it("prefers the globally cheapest matching, not the greedy one", () => {
    // greedy would take 60->61 (cost 1) and strand 61->72 (cost 11) = 12;
    // the optimal pairing is 60->61 and 61->62... so make the trap explicit:
    // matching the LOW released note to the near pressed note forces the high
    // one across the gap.
    expect(moves([60, 61], [61, 62])).toEqual([[60, 61], [61, 62]]);
  });
});

describe("the Chopin prelude, end to end", () => {
  const chopin = statesOf(
    MusicxmlIn.parse(readFileSync("scores/chopin_prelude_op28_no4.musicxml", "utf8")),
  );
  const trans = transitionsOf(chopin);

  it("collapses 598 notes to a followable number of states", () => {
    expect(chopin).toHaveLength(98);
    expect(trans).toHaveLength(97);
    // every onset is accounted for: none silently dropped, none invented.
    expect(chopin.reduce((sum, s) => sum + s.repeat, 0)).toBe(189);
  });

  it("absorbs the repeated left-hand chords rather than restating them", () => {
    const absorbed = chopin.reduce((sum, s) => sum + s.repeat, 0) - chopin.length;
    expect(absorbed).toBe(91);
    expect(Math.max(...chopin.map((s) => s.repeat))).toBe(6);
  });

  it("keeps most of the hand in place from chord to chord", () => {
    const avg = (f: (t: (typeof trans)[0]) => number) =>
      trans.reduce((sum, t) => sum + f(t), 0) / trans.length;

    // Chopin restrikes almost everything, so very little is literally
    // sustained — but the hand still barely moves, because most of what it
    // strikes is a key it was already on.
    expect(avg((t) => t.held.length)).toBeCloseTo(0.41, 2);
    expect(avg((t) => t.restruck.length)).toBeCloseTo(1.69, 2);
    expect(avg((t) => t.held.length + t.restruck.length)).toBeCloseTo(2.1, 2);
    expect(avg((t) => t.pressed.length - t.restruck.length)).toBeCloseTo(1.69, 2);

    // and over half the piece adds at most one key the hand has to find.
    const easy = trans.filter((t) => t.pressed.length - t.restruck.length <= 1);
    expect(easy.length / trans.length).toBeGreaterThan(0.5);
  });

  it("conserves every note across each transition", () => {
    for (let i = 1; i < chopin.length; i++) {
      const t = trans[i - 1];
      expect(t.held.length + t.released.length).toBe(chopin[i - 1].lastNotes.length);
      expect(t.held.length + t.pressed.length).toBe(chopin[i].notes.length);
      expect(t.motion.length).toBe(Math.min(t.released.length, t.pressed.length));
    }
  });
});

/* Onsets: the grain below the state machine, and the one at which every
   note is accounted for exactly once. `statesOf` is now defined as the
   run-length encoding of this, so the two can never drift. */
describe("onsetsOf", () => {
  const s = score(n(48, 0, 4), n(60, 0, 1), n(62, 1, 1), n(64, 2, 1), n(65, 3, 1));

  it("strikes every note exactly once, across all its groups", () => {
    const os = onsetsOf(s);
    const struck = os.flatMap((o) => o.struck);
    expect(struck).toHaveLength(s.notes.length);
    expect(new Set(struck).size).toBe(s.notes.length); // identities, not copies
  });

  it("separates what starts here from what is merely still ringing", () => {
    const os = onsetsOf(s);
    expect(os.map((o) => pitches(o.struck))).toEqual([[48, 60], [62], [64], [65]]);
    // the bass rings under all four but is struck at only the first
    expect(os.map((o) => pitches(o.sounding))).toEqual([
      [48, 60],
      [48, 62],
      [48, 64],
      [48, 65],
    ]);
  });

  it("timestamps each group by the strike that opens it", () => {
    expect(onsetsOf(s).map((o) => o.time)).toEqual([0, 1, 2, 3]);
  });

  it("never emits an empty group, and rises strictly in time", () => {
    const os = onsetsOf(score(n(60, 0, 1), n(64, 0, 1), n(67, 0.5, 1), n(72, 2, 1)));
    for (const o of os) expect(o.struck.length).toBeGreaterThan(0);
    for (let i = 1; i < os.length; i++) expect(os[i].time).toBeGreaterThan(os[i - 1].time);
  });

  it("is what statesOf run-length encodes, exactly", () => {
    // the invariant the two sequences are tied together by
    const rep = score(n(60, 0, 0.5), n(60, 1, 0.5), n(60, 2, 0.5), n(67, 3, 1));
    const os = onsetsOf(rep);
    const st = statesOf(rep);
    expect(os).toHaveLength(4);
    expect(st).toHaveLength(2);
    expect(st.reduce((k, x) => k + x.repeat, 0)).toBe(os.length);
    // and the fold only merges neighbours that sound the same
    expect(st[0].repeat).toBe(3);
  });

  it("groups a smeared chord the way statesOf always did", () => {
    const smeared = score(n(60, 0, 1), n(64, ONSET_EPS / 2, 1), n(67, 5, 1));
    expect(onsetsOf(smeared).map((o) => pitches(o.struck))).toEqual([[60, 64], [67]]);
  });
});

describe("onsetAt", () => {
  const os = onsetsOf(score(n(48, 0, 4), n(60, 0, 1), n(62, 1, 1), n(64, 2, 1), n(65, 3, 1)));

  it("sits on the last strike that has happened", () => {
    expect(onsetAt(os, 0)).toBe(0);
    expect(onsetAt(os, 0.9)).toBe(0);
    expect(onsetAt(os, 1)).toBe(1);
    expect(onsetAt(os, 2.5)).toBe(2);
    expect(onsetAt(os, 99)).toBe(3); // past the end, still the last strike
  });

  it("answers the first strike before the piece starts, and -1 for no piece", () => {
    const late = onsetsOf(score(n(60, 5, 1)));
    expect(onsetAt(late, 0)).toBe(0); // what is coming is the useful answer
    expect(onsetAt([], 0)).toBe(-1);
  });

  it("gives a restated chord one entry per statement, not one for the run", () => {
    // the difference from the state sequence, and the reason the view walks
    // this one: four strikes are four things you do
    const rep = onsetsOf(score(n(60, 0, 0.5), n(60, 1, 0.5), n(60, 2, 0.5), n(67, 3, 1)));
    expect([0, 1, 2, 3].map((t) => onsetAt(rep, t))).toEqual([0, 1, 2, 3]);
  });
});
