/* ====================================================================
   DYNAMICS — a source's loudness markings -> each note's velocity. Shared
   by the parsers whose sources write dynamics as words (MusicXML, and
   LilyPond); MIDI states a velocity per note and needs none of this.

   A marking is placed IN TIME, not on a note: collected as the parser
   meets it, at the score time it stands at, and read back per note by
   onset once the whole source has been walked. That is what makes it
   right for music written voice by voice — a LilyPond right hand parsed
   in full before the left, a MusicXML <backup> to the other staff — where
   "the last marking seen" would carry the end of one hand's dynamics
   into the start of the other's.

   Two kinds of marking:
   - a LEVEL (pp, mf, ff…) holds from where it stands until the next;
   - an ACCENT (sf, sfz, fz…) lifts only the notes struck where it stands.
     Some accents set a level after them too: fp is forte, then piano.

   A note before any level is left without a velocity: the source said
   nothing about it, and perform.ts decides what that means.
   ==================================================================== */

/** Marked levels as MIDI velocities, pppp to ffff. */
const LEVELS: Record<string, number> = {
  pppp: 10, ppp: 20, pp: 33, p: 49, mp: 64, mf: 80, f: 96, ff: 112, fff: 124, ffff: 127,
};

/** Accents, and the level each leaves in force after it (if it sets one). */
const ACCENTS: Record<string, string | null> = {
  sf: null, sfz: null, sffz: null, fz: null, rf: null, rfz: null,
  fp: "p", sfp: "p", sfpp: "pp", fzp: "p",
};

/** How far an accent lifts a note above the level in force, and the least
 *  it lifts it to: sf over pp is still a forte. */
const ACCENT_LIFT = 24;
const ACCENT_FLOOR = 96;

/** Seconds: a note this close to a marking is struck where it stands. */
const SAME_TIME = 1e-6;

/** A velocity from a percentage of forte, as MusicXML's `dynamics`
 *  attributes state it (100 is forte, which MIDI 1.0 puts at 90). */
export const fromPercent = (pct: number): number => Math.max(1, Math.min(127, Math.round((pct * 90) / 100)));

export interface Dynamics {
  /** Record a marking word at score time `at`. False if it is not a
   *  dynamic this reader knows, so the caller can ignore it. */
  mark(word: string, at: number): boolean;
  /** Record a level stated as a velocity (MusicXML <sound dynamics>). */
  level(velocity: number, at: number): void;
  /** The velocity a note struck at `t` is played at, or undefined when no
   *  level stands before it. */
  velocityAt(t: number): number | undefined;
}

export function makeDynamics(): Dynamics {
  const levels: { at: number; velocity: number }[] = [];
  const accents: number[] = [];

  function level(velocity: number, at: number): void {
    levels.push({ at, velocity });
  }

  return {
    level,
    mark(word, at) {
      const w = word.trim().toLowerCase();
      if (w in LEVELS) {
        level(LEVELS[w], at);
        return true;
      }
      if (w in ACCENTS) {
        accents.push(at);
        const after = ACCENTS[w];
        if (after) level(LEVELS[after], at + SAME_TIME * 2);
        return true;
      }
      return false;
    },
    velocityAt(t) {
      // the latest level at or before t; among equals, the last recorded
      let inForce: number | undefined;
      let at = -Infinity;
      for (const l of levels)
        if (l.at <= t + SAME_TIME && l.at >= at) {
          at = l.at;
          inForce = l.velocity;
        }
      if (!accents.some((a) => Math.abs(a - t) < SAME_TIME)) return inForce;
      // an fp's own "p" sits just after its accent, so it is not yet in
      // force for the accented note itself
      return Math.min(127, Math.max((inForce ?? LEVELS.mf) + ACCENT_LIFT, ACCENT_FLOOR));
    },
  };
}
