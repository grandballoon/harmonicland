/* The gate that makes the sequence wait. Pure pitch sets and strike counts,
   so every rule below is checkable without a score, a clock or a DOM —
   which is the point of it being its own module. */
import { describe, it, expect, beforeEach } from "vitest";
import { NoteGate, check, progress, satisfied, setEnabled, type Keys } from "./note-gate";

const held = (...ps: number[]) => new Set(ps);
const C_MAJOR = [60, 64, 67];

/** One strike of the score. `strike` defaults to the whole sonority — the
 *  ordinary case, a chord played from nothing — and is given separately
 *  when some of it is merely still ringing. */
const target = (index: number, hold: number[], strike: number[] = hold) => ({
  index,
  hold,
  strike,
});

/** A stand-in keyboard: the three gestures a player actually makes,
 *  counting strikes the way LiveKeys does, so the gate is fed exactly what
 *  the app feeds it. The distinction between them is the whole subject —
 *  a key you keep down is not a key you played. */
function keyboard() {
  const down = new Set<number>();
  const strikes = new Map<number, number>();
  const keys: Keys = { held: down, strikes };
  const hit = (p: number) => {
    down.add(p);
    strikes.set(p, (strikes.get(p) ?? 0) + 1);
  };
  return {
    keys,
    /** Play this chord fresh: hands off the keyboard, then down on these.
     *  Every key counts, including ones that were already down. */
    strike(...ps: number[]) {
      down.clear();
      for (const p of ps) hit(p);
      return keys;
    },
    /** End up holding exactly these, moving as little as possible: keys
     *  already down stay down and count nothing. The legato case — hold
     *  two, move one. */
    hold(...ps: number[]) {
      for (const p of [...down]) if (!ps.includes(p)) down.delete(p);
      for (const p of ps) if (!down.has(p)) hit(p);
      return keys;
    },
    /** Strike these again without lifting first — the way a chord retrigger
     *  arrives, invisible to anything polling `held`. */
    restrike(...ps: number[]) {
      for (const p of ps) hit(p);
      return keys;
    },
    lift() {
      down.clear();
      return keys;
    },
  };
}
type Keyboard = ReturnType<typeof keyboard>;

/** The frame the sequence lands on a sonority, before anything is struck.
 *  The gate marks the strike counts here, which is how it tells a chord you
 *  are about to play from one you were already holding. Every practice pass
 *  starts with one of these; in the app the loop supplies sixty a second. */
const arrive = (index: number, hold: number[], k: Keyboard, strike = hold): void => {
  expect(check(target(index, hold, strike), k.lift())).toBe(false);
};

beforeEach(() => setEnabled(true));

describe("satisfied", () => {
  it("wants every note of the chord, not merely some of it", () => {
    expect(satisfied(C_MAJOR, held(60, 64, 67))).toBe(true);
    expect(satisfied(C_MAJOR, held(60, 64))).toBe(false);
    expect(satisfied(C_MAJOR, held())).toBe(false);
  });

  it("lets a wrong note through rather than refusing the right ones", () => {
    // a brushed neighbour is a mistake you can see, not a reason to block
    expect(satisfied(C_MAJOR, held(60, 63, 64, 67))).toBe(true);
  });

  it("is never satisfied by nothing, so silence cannot advance the piece", () => {
    expect(satisfied([], held())).toBe(false);
    expect(satisfied([], held(60))).toBe(false);
  });
});

describe("progress", () => {
  it("counts the target's own keys and ignores the rest", () => {
    expect(progress(C_MAJOR, held())).toBe(0);
    expect(progress(C_MAJOR, held(60, 67))).toBe(2);
    expect(progress(C_MAJOR, held(60, 64, 67, 72))).toBe(3); // the octave is not a target
  });
});

describe("check", () => {
  it("advances exactly once, on the frame the chord completes", () => {
    const k = keyboard();
    arrive(0, C_MAJOR, k);
    expect(check(target(0, C_MAJOR), k.hold(60, 64))).toBe(false);
    expect(check(target(0, C_MAJOR), k.hold(60, 64, 67))).toBe(true);
    // still holding it: the strike already counted
    expect(check(target(0, C_MAJOR), k.keys)).toBe(false);
    expect(check(target(0, C_MAJOR), k.keys)).toBe(false);
  });

  it("comes back for a chord played again — all of it", () => {
    const k = keyboard();
    arrive(0, C_MAJOR, k);
    expect(check(target(0, C_MAJOR), k.strike(60, 64, 67))).toBe(true);
    expect(check(target(0, C_MAJOR), k.hold(60, 64))).toBe(false); // one finger lifts
    // putting that one finger back is not playing the chord again: the
    // other two never moved, so two of its three notes went unplayed
    expect(check(target(0, C_MAJOR), k.hold(60, 64, 67))).toBe(false);
    expect(check(target(0, C_MAJOR), k.strike(60, 64, 67))).toBe(true);
  });

  it("will not take a three-note chord on one finger", () => {
    // THE rule that makes the gate account for every note. The obvious
    // version — any one target key freshly struck — lets two of these
    // three through unplayed, every time the chord comes round.
    const k = keyboard();
    arrive(0, C_MAJOR, k);
    expect(check(target(0, C_MAJOR), k.hold(60))).toBe(false);
    expect(check(target(0, C_MAJOR), k.hold(60, 64))).toBe(false);
    expect(check(target(0, C_MAJOR), k.hold(60, 64, 67))).toBe(true); // all three
  });

  it("hears a restrike that never shows up in the held set", () => {
    // THE case strike counts exist for: a chord retrigger releases and
    // re-presses in one synchronous call, so nothing polling `held` ever
    // sees it let go. PerfState.trigger() does exactly this.
    const k = keyboard();
    arrive(0, C_MAJOR, k);
    expect(check(target(0, C_MAJOR), k.strike(60, 64, 67))).toBe(true);
    expect(check(target(0, C_MAJOR), k.keys)).toBe(false);
    expect(check(target(0, C_MAJOR), k.restrike(60, 64, 67))).toBe(true);
    expect(check(target(0, C_MAJOR), k.keys)).toBe(false);
    expect(check(target(0, C_MAJOR), k.restrike(60))).toBe(false); // one key is not
    expect(check(target(0, C_MAJOR), k.restrike(64, 67))).toBe(true); // the rest of it
  });

  it("does not run away when the next chord is a subset of this one", () => {
    // drop a voice and the remaining keys are already down the instant you
    // arrive — a bare "all held?" check would fire here every frame
    const k = keyboard();
    arrive(0, C_MAJOR, k);
    expect(check(target(0, C_MAJOR), k.strike(60, 64, 67))).toBe(true);
    for (let frame = 0; frame < 5; frame++) expect(check(target(1, [60, 64]), k.keys)).toBe(false);
    expect(check(target(1, [60, 64]), k.strike(60, 64))).toBe(true); // a real strike
  });

  it("waits on a chord you happened to be holding when you arrived", () => {
    const k = keyboard();
    k.hold(60, 64, 67);
    expect(check(target(3, [60, 64]), k.keys)).toBe(false); // arrive already holding it
    expect(check(target(3, [60, 64]), k.keys)).toBe(false);
    expect(check(target(3, [60, 64]), k.strike(60, 64))).toBe(true);
  });

  it("asks only for the notes the score strikes, not the ones still ringing", () => {
    // the ordinary voice-leading case: keep two, move one. The sonority is
    // three notes and exactly one of them is played, which is why the
    // target has two halves rather than one.
    const k = keyboard();
    const voiceMove = target(1, [60, 64, 69], [69]);
    arrive(0, C_MAJOR, k);
    expect(check(target(0, C_MAJOR), k.strike(60, 64, 67))).toBe(true);
    expect(check(voiceMove, k.keys)).toBe(false); // arrived, not there yet
    expect(check(voiceMove, k.hold(60, 64, 69))).toBe(true); // one finger moves
  });

  it("still wants the ringing notes held, even though it does not want them played", () => {
    const k = keyboard();
    const voiceMove = target(1, [60, 64, 69], [69]);
    arrive(1, [60, 64, 69], k, [69]);
    // the note it wants played, played — but the two it wants held are not
    expect(check(voiceMove, k.strike(69))).toBe(false);
    expect(check(voiceMove, k.hold(60, 64, 69))).toBe(true); // and now they are
    expect(check(voiceMove, k.keys)).toBe(false); // that strike of 69 is spent

    // holding all three is not enough on its own: 69 has to be played again
    expect(check(voiceMove, k.hold(60, 64))).toBe(false);
    expect(check(voiceMove, k.hold(60, 64, 69))).toBe(true);
  });

  it("will not let a wrong note pass the gate on the chord's behalf", () => {
    // counting strikes per PITCH is what makes this true: a brushed
    // neighbour is not one of the chord's own keys
    const k = keyboard();
    arrive(0, C_MAJOR, k);
    expect(check(target(0, C_MAJOR), k.strike(60, 64, 67))).toBe(true);
    expect(check(target(1, [60, 64]), k.hold(60, 64, 63))).toBe(false); // 63 is not a target
    expect(check(target(1, [60, 64]), k.strike(60, 64))).toBe(true);
  });

  it("still advances on a chord played with a wrong note in it", () => {
    const k = keyboard();
    arrive(0, C_MAJOR, k);
    expect(check(target(0, C_MAJOR), k.strike(60, 63, 64, 67))).toBe(true);
  });

  it("never fires while switched off", () => {
    const k = keyboard();
    setEnabled(false);
    for (let frame = 0; frame < 5; frame++)
      expect(check(target(0, C_MAJOR), k.strike(60, 64, 67))).toBe(false);
  });

  it("forgets where it was when it is switched on, or reset", () => {
    // otherwise a chord held from before the toggle would advance instantly
    const k = keyboard();
    k.hold(60, 64, 67);
    setEnabled(true);
    expect(check(target(0, C_MAJOR), k.keys)).toBe(false);
    expect(NoteGate.isEnabled()).toBe(true);

    NoteGate.reset();
    expect(check(target(0, C_MAJOR), k.keys)).toBe(false);
    expect(check(target(0, C_MAJOR), k.strike(60, 64, 67))).toBe(true);
  });

  it("has nothing to wait for when the chord is empty", () => {
    const k = keyboard();
    expect(check(target(0, []), k.lift())).toBe(false);
    expect(check(target(0, []), k.strike(60))).toBe(false);
  });
});
