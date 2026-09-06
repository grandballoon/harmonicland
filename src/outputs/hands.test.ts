/* Hands: the spoken score drawn on the keys. The reading is where the
   meaning is, so most cases assert `readingAt` rather than markup; the
   drawing cases check only the things a renderer can get wrong on its own
   (which keys are painted which colour, and nothing off-canvas). */
import { describe, it, expect, afterEach } from "vitest";
import {
  Hands, readingAt, analyse, wrap, keyboardHeight, region, setPractice, stepTime, targetAt,
} from "./hands";
import { piano } from "../instruments/piano";
import { Core } from "../core";
import { LiveKeys } from "../live-keys";
import { vi } from "vitest";
import { proseFor } from "./prose";
import { onsetAt } from "../states";
import { NoteGate } from "../note-gate";
import { readFileSync } from "node:fs";
import { MusicxmlIn } from "../inputs/musicxml";
import type { RawNote } from "../types";

// LiveKeys drives the audio sink on every edge, and jsdom has no
// AudioContext. This file is about what gets DRAWN, so the sinks are stubbed
// away entirely.
vi.mock("../outputs/audio", () => ({
  AudioOut: { ensure: () => {}, at: () => {}, silence: () => {}, setMuted: () => {}, liveOn: () => {}, liveOff: () => {} },
}));
vi.mock("../outputs/midi-out", () => ({
  MidiOut: { enable: () => {}, disable: () => {}, at: () => {}, silence: () => {}, liveOn: () => {}, liveOff: () => {} },
}));

const score = (...raw: RawNote[]) => Core.makeScore(raw);
const n = (pitch: number, onset: number, duration: number): RawNote => ({ pitch, onset, duration });

function stage(w: number, h: number): SVGSVGElement {
  const el = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  Object.defineProperty(el, "clientWidth", { value: w });
  Object.defineProperty(el, "clientHeight", { value: h });
  return el;
}

// a two-hand texture: a sustained low triad under a moving upper line
const TWO_HANDS = score(
  n(48, 0, 4), n(52, 0, 4), n(55, 0, 4),
  n(72, 0, 1), n(74, 1, 1), n(76, 2, 1), n(77, 3, 1),
);

describe("readingAt", () => {
  const a = analyse(TWO_HANDS);

  it("splits the sonority between the hands and names every key", () => {
    const r = readingAt(a, 0)!;
    expect(r.index).toBe(0);
    expect(r.total).toBe(4);
    expect(r.pitches).toEqual([48, 52, 55, 72]);
    expect(r.unplayable).toBe(false);
    expect(r.names.L).toEqual(["C3", "E3", "G3"]);
    expect(r.names.R).toEqual(["C5"]);
    // every note is placed exactly once, by one hand or the other
    expect(r.placements.map((p) => p.note.pitch)).toEqual([48, 52, 55, 72]);
  });

  it("marks the sustained triad as ringing and the new note as one to strike", () => {
    const r = readingAt(a, 1)!;
    // the triad is literally still sounding — do not re-strike it
    expect([...r.held].sort((x, y) => x - y)).toEqual([48, 52, 55]);
    expect(r.held.has(74)).toBe(false);
  });

  it("counts a restated chord as the strikes it is, not the sonority it is", () => {
    // the same chord four times is four things you do; the state machine
    // folds it to one, and the view unfolds it again
    const b = analyse(score(n(60, 0, 0.4), n(60, 1, 0.4), n(60, 2, 0.4)));
    expect(b.states).toHaveLength(1);
    expect(b.onsets).toHaveLength(3);
    expect([0, 1, 2].map((i) => readingAt(b, i)!.statement)).toEqual([1, 2, 3]);
    expect(readingAt(b, 1)!.total).toBe(3);
    // and each statement genuinely restrikes: none of them is "still ringing"
    for (const i of [0, 1, 2]) expect(readingAt(b, i)!.held.size).toBe(0);
  });

  it("says exactly what the spoken score says for the same sonority", () => {
    // the point of the view: one instruction, two projections of it. The
    // prose reads by state and the view walks by strike, so the comparison
    // is at each run's first statement — where the two sequences meet.
    const first = a.onsets.map((_, i) => i).filter((i) => a.statement[i] === 1);
    const lines = proseFor(TWO_HANDS, piano).filter((l) => l.kind !== "figure");
    for (const line of lines) expect(readingAt(a, first[line.state])!.sentence).toBe(line.text);
  });

  it("keeps the sonority's own sentence on every statement of its run", () => {
    const b = analyse(score(n(60, 0, 0.4), n(60, 1, 0.4), n(60, 2, 0.4)));
    for (const i of [0, 1, 2]) {
      expect(readingAt(b, i)!.repeat).toBe(3);
      expect(readingAt(b, i)!.sentence).toMatch(/three times/);
    }
  });

  it("keeps the notes when the chord has no fingering at all", () => {
    // eleven notes is more than ten fingers, so the solver records no config
    const wide = score(...Array.from({ length: 11 }, (_, i) => n(40 + i * 5, 0, 1)));
    const r = readingAt(analyse(wide), 0)!;
    expect(r.unplayable).toBe(true);
    expect(r.placements).toEqual([]);
    expect(r.pitches).toHaveLength(11); // still the notes; only the hands are gone
    expect(r.sentence).toMatch(/No fingering/);
  });

  it("has nothing to read past the end of the sequence", () => {
    expect(readingAt(a, 4)).toBeNull();
    expect(readingAt(analyse(score()), 0)).toBeNull();
  });
});

describe("wrap", () => {
  it("breaks on words and never mid-word", () => {
    expect(wrap("hold the outer two notes", 12)).toEqual(["hold the", "outer two", "notes"]);
  });
  it("keeps an over-long word on its own line rather than losing it", () => {
    expect(wrap("a supercalifragilistic b", 6)).toEqual(["a", "supercalifragilistic", "b"]);
  });
  it("returns nothing for nothing", () => {
    expect(wrap("", 10)).toEqual([]);
  });
});

describe("render", () => {
  it("draws the keyboard and the sentence, with no numbers out of place", () => {
    const el = stage(1400, 800);
    Hands.render(el, TWO_HANDS, 0);
    expect(el.getAttribute("viewBox")).toBe("0 0 1400 800");
    expect(el.innerHTML).not.toMatch(/NaN|Infinity|undefined/);
    expect(el.innerHTML).toContain("STRIKE 1 / 4");
    expect(el.innerHTML).toContain("LEFT");
    expect(el.innerHTML).toContain("RIGHT");
    // 88 keys, and nothing falling: no note bars, no strike line, no bars
    expect(el.innerHTML.match(/<rect/g)).toHaveLength(88);
    expect(el.innerHTML).not.toContain("var(--playhead)");
  });

  it("colours each hand's keys with its own token", () => {
    const el = stage(1400, 800);
    Hands.render(el, TWO_HANDS, 0);
    expect(el.innerHTML).toContain("var(--hand-l)");
    expect(el.innerHTML).toContain("var(--hand-r)");
  });

  it("shows the chord at t and nothing else — the sonority, not the score", () => {
    const el = stage(1400, 800);
    Hands.render(el, TWO_HANDS, 2.5); // third state: triad + E5
    expect(el.innerHTML).toContain("STRIKE 3 / 4");
    // the upper line has moved on; only the four keys under the hands are lit
    const lit = (el.innerHTML.match(/<rect[^>]*var\(--hand-[lr]\)/g) ?? []).length;
    expect(lit).toBe(4);
  });

  it("dims a note that is still ringing, so it is not struck again", () => {
    const el = stage(1400, 800);
    Hands.render(el, TWO_HANDS, 1); // the triad is held under a new top note
    // three keys quiet, one solid — and only the solid one carries a finger
    expect((el.innerHTML.match(/opacity="0\.34"/g) ?? []).length).toBe(3);
  });

  it("invites a score when there is none, rather than drawing an empty stage", () => {
    const el = stage(1400, 800);
    Hands.render(el, score(), 0);
    expect(el.innerHTML).toContain("Load a score");
    expect(el.innerHTML.match(/<rect/g)).toHaveLength(88); // the keys still stand
  });

  it("rings a key you are actually holding without changing whose it is", () => {
    const el = stage(1400, 800);
    LiveKeys.press(48); // a key the left hand is told to play
    LiveKeys.press(90); // and one it is not
    try {
      Hands.render(el, TWO_HANDS, 0);
      expect(el.innerHTML).toContain(`stroke="var(--key-press)"`); // confirmation
      expect(el.innerHTML).toContain(`fill="var(--key-press)"`); // a stray note
    } finally {
      LiveKeys.releaseAll();
    }
  });

  it("sizes its keyboard to the stage and hands back exactly where it drew it", () => {
    const el = stage(1400, 800);
    const r = region(el);
    expect(r).toEqual({ x: 0, y: 800 - keyboardHeight(800) - 26, w: 1400, h: keyboardHeight(800) });
    // taller stage, taller keys — but never beyond what a keyboard looks right at
    expect(keyboardHeight(400)).toBeLessThan(keyboardHeight(800));
    expect(keyboardHeight(4000)).toBe(260);
    expect(keyboardHeight(100)).toBe(96);
  });

  it("draws nothing at all rather than dividing by an unmeasured stage", () => {
    expect(Hands.markup(0, 0, TWO_HANDS, 0)).toBe("");
  });
});

/* The caption is a caption: the keyboard below it already answers "which
   key", which is what `piano.describe`'s longest sentences spend their
   words on. So it is fitted to the space left over, never given it. */
describe("the sentence, fitted", () => {
  // ten notes, five to a hand and each hand inside its octave reach, so
  // the chord is playable — and it is the opening one, so no shorter tier
  // is honest and describe names every key by landmark
  const WIDE = score(...[36, 40, 43, 45, 48, 67, 71, 74, 76, 79].map((p) => n(p, 0, 1)));
  const caption = (el: SVGSVGElement) =>
    [...el.innerHTML.matchAll(/<text[^>]*font-size="(\d+)"[^>]*font-family/g)].map((m) => +m[1]);

  it("sets a short instruction large", () => {
    const el = stage(1400, 800);
    Hands.render(el, TWO_HANDS, 1); // "Hold the other three notes; ..."
    expect(caption(el)).toEqual([22]); // one line, the largest size
  });

  it("shrinks a long one instead of letting it bury the keyboard", () => {
    const el = stage(1400, 800);
    Hands.render(el, WIDE, 0);
    const sizes = caption(el);
    // there is room above the keyboard for ten 22px lines, and fitting by
    // height alone would have taken it. The line cap is what stops it.
    expect(sizes.length).toBeGreaterThan(1);
    expect(sizes.length).toBeLessThan(7);
    expect(sizes[0]).toBe(12); // all the way down to the floor
    expect(new Set(sizes).size).toBe(1); // one size for the whole paragraph
  });

  it("steps down only as far as it has to", () => {
    // one instruction, five stage widths. Narrowing the stage may shrink
    // the type but must never grow it, and the widest stage that can hold
    // the sentence in four lines holds it at full size.
    const sizes = [1400, 1100, 900, 600, 420].map((W) => {
      const el = stage(W, 800);
      Hands.render(el, TWO_HANDS, 0);
      return caption(el)[0];
    });
    expect(sizes[0]).toBe(22);
    expect(sizes[sizes.length - 1]).toBeLessThan(22);
    for (let i = 1; i < sizes.length; i++) expect(sizes[i]).toBeLessThanOrEqual(sizes[i - 1]);
  });

  it("drops a sentence with nowhere to go rather than cutting it in half", () => {
    const el = stage(900, 300); // a squat stage: keys and names, no room left
    Hands.render(el, WIDE, 0);
    expect(caption(el)).toEqual([]);
    // the instruction is still complete, in the two forms that fit
    expect(el.innerHTML).toContain("LEFT");
    expect(el.innerHTML).toContain("var(--hand-r)");
    expect(el.innerHTML.match(/<rect/g)).toHaveLength(88);
  });

  it("keeps every baseline clear of the keyboard it sits above", () => {
    for (const [W, H] of [[1400, 800], [1000, 620], [700, 420], [900, 300]] as const) {
      const el = stage(W, H);
      Hands.render(el, WIDE, 0);
      const kbTop = H - keyboardHeight(H) - 26;
      const panel = [...el.innerHTML.matchAll(/<text[^>]*y="([\d.]+)"/g)]
        .map((m) => +m[1])
        .filter((y) => y < kbTop + 5);
      expect(Math.max(...panel)).toBeLessThan(kbTop);
    }
  });
});

/* Practising hands separately. It is a filter on the SCORE, not on the
   drawing: one hand's part is a shorter piece, with its own states and its
   own transitions, and that is the whole reason it lives upstream of the
   solver rather than in the paint function. */
describe("hands separately", () => {
  afterEach(() => setPractice("both"));

  // two staves, written the way MusicXML writes them: 1 above, 2 below.
  const staffed = Core.makeScore([
    { pitch: 48, onset: 0, duration: 2, staff: 2 },
    { pitch: 55, onset: 0, duration: 2, staff: 2 },
    { pitch: 72, onset: 0, duration: 1, staff: 1 },
    { pitch: 74, onset: 1, duration: 1, staff: 1 },
    { pitch: 50, onset: 2, duration: 2, staff: 2 },
    { pitch: 57, onset: 2, duration: 2, staff: 2 },
    { pitch: 76, onset: 2, duration: 1, staff: 1 },
    { pitch: 77, onset: 3, duration: 1, staff: 1 },
  ]);

  it("takes the score's own word for whose note it is", () => {
    expect(readingAt(analyse(staffed, "L"), 0)!.names).toEqual({ L: ["C3", "G3"], R: [] });
    expect(readingAt(analyse(staffed, "R"), 0)!.names).toEqual({ L: [], R: ["C5"] });
  });

  it("drops the states only the other hand moved through", () => {
    // four onsets between them, but the left hand changes at only two
    expect(analyse(staffed, "both").states).toHaveLength(4);
    expect(analyse(staffed, "L").states).toHaveLength(2);
    expect(analyse(staffed, "R").states).toHaveLength(4);
  });

  it("keeps every note in the hand being practised", () => {
    for (const hand of ["L", "R"] as const)
      for (const { config } of analyse(staffed, hand).plan)
        for (const p of config?.placements ?? []) expect(p.hand).toBe(hand);
  });

  it("leaves the timeline alone, so the transport still points at the music", () => {
    // the left hand's second chord is at 2s in the whole piece, and stays there
    const a = analyse(staffed, "L");
    const el = stage(1400, 800);
    setPractice("L");
    Hands.render(el, staffed, 2.5);
    expect(el.innerHTML).toContain("STRIKE 2 / 2");
    expect(a.states).toHaveLength(2);
  });

  it("names the mode in the counter, because the numbers count a different piece", () => {
    const el = stage(1400, 800);
    setPractice("L");
    Hands.render(el, staffed, 0);
    expect(el.innerHTML).toContain("LEFT HAND ALONE");
    expect(el.innerHTML).not.toContain("var(--hand-r)"); // the other hand is gone
    setPractice("both");
    Hands.render(el, staffed, 0);
    expect(el.innerHTML).not.toContain("ALONE");
  });

  it("falls back to the solver's split when the score states no staves", () => {
    // no staff anywhere: the split is the one the both-hands view draws
    const bare = Core.makeScore([n(48, 0, 1), n(52, 0, 1), n(72, 0, 1)]);
    expect(readingAt(analyse(bare, "L"), 0)!.names.L).toEqual(["C3", "E3"]);
    expect(readingAt(analyse(bare, "R"), 0)!.names.R).toEqual(["C5"]);
  });

  it("says so when a hand has nothing to practise", () => {
    const el = stage(1400, 800);
    setPractice("R");
    Hands.render(el, Core.makeScore([{ pitch: 40, onset: 0, duration: 1, staff: 2 }]), 0);
    expect(el.innerHTML).toContain("nothing for the right hand");
    expect(el.innerHTML.match(/<rect/g)).toHaveLength(88); // the keys still stand
  });

  it("calls a chord too wide for one hand what it is, and still shows it", () => {
    // a fourteenth: two hands hold it, one cannot
    const wide = Core.makeScore([
      { pitch: 36, onset: 0, duration: 1, staff: 2 },
      { pitch: 57, onset: 0, duration: 1, staff: 2 },
    ]);
    const r = readingAt(analyse(wide, "L"), 0)!;
    expect(r.unplayable).toBe(true);
    expect(r.sentence).toMatch(/left hand alone cannot hold/);
    expect(r.pitches).toEqual([36, 57]); // the notes are still the notes
    expect(readingAt(analyse(wide, "both"), 0)!.unplayable).toBe(false);
  });

  it("re-solves when the mode changes rather than handing back the last hand", () => {
    // the cache is keyed on the mode too; toggling must not return stale work
    expect(readingAt(analyse(staffed, "L"), 0)!.names.L).toEqual(["C3", "G3"]);
    expect(readingAt(analyse(staffed, "R"), 0)!.names.R).toEqual(["C5"]);
    expect(readingAt(analyse(staffed, "L"), 0)!.names.L).toEqual(["C3", "G3"]);
    expect(analyse(staffed, "both").states).toHaveLength(4);
  });
});

/* Stepping the sequence. One tap is one sonority, however long it lasts —
   the transport counterpart to Core.barStep, and a seek rather than a
   private cursor so nothing can drift out of step with the clock. */
describe("stepTime", () => {
  afterEach(() => setPractice("both"));

  // four chords at 0, 1, 2, 3 — the last one held four times as long, so a
  // step is plainly not a step through time
  const seq = score(
    n(60, 0, 1), n(64, 0, 1),
    n(62, 1, 1), n(65, 1, 1),
    n(64, 2, 1), n(67, 2, 1),
    n(65, 3, 4), n(69, 3, 4),
  );
  const onsets = () => analyse(seq, "both").onsets.map((o) => o.time);

  it("walks the onsets, one strike per tap", () => {
    expect(onsets()).toEqual([0, 1, 2, 3]);
    let t = 0;
    const walked = [t];
    for (let k = 0; k < 3; k++) walked.push((t = stepTime(seq, t, 1)));
    expect(walked).toEqual([0, 1, 2, 3]);
  });

  it("ignores how long a chord lasts — the last is four times the first", () => {
    // one tap leaves the 4-second chord, exactly as it left the 1-second ones
    expect(stepTime(seq, 2, 1)).toBe(3);
    expect(stepTime(seq, 3, -1)).toBe(2);
  });

  it("returns to the start of the chord you are inside before leaving it", () => {
    expect(stepTime(seq, 2.6, -1)).toBe(2); // mid-chord: back to its own start
    expect(stepTime(seq, 2, -1)).toBe(1); // already there: back to the previous
  });

  it("stays put at either end rather than jumping into silence", () => {
    expect(stepTime(seq, 0, -1)).toBe(0);
    expect(stepTime(seq, 3, 1)).toBe(3);
    expect(stepTime(score(), 0, 1)).toBe(0); // nothing to step through
  });

  it("lands exactly where onsetAt reads it back, so a step is never half a step", () => {
    const onsets = analyse(seq, "both").onsets;
    let t = 0;
    for (let i = 0; i < onsets.length; i++) {
      expect(onsetAt(onsets, t)).toBe(i);
      t = stepTime(seq, t, 1);
    }
  });

  it("steps a restated chord once per statement, not once per run", () => {
    // four strikes of one sonority are four taps: the fold that makes the
    // spoken score short must not make the practice sequence lossy
    const rep = score(n(60, 0, 0.4), n(60, 1, 0.4), n(60, 2, 0.4));
    expect(analyse(rep, "both").states).toHaveLength(1);
    let t = 0;
    const walked = [t];
    for (let k = 0; k < 2; k++) walked.push((t = stepTime(rep, t, 1)));
    expect(walked).toEqual([0, 1, 2]);
  });

  it("steps the sequence being practised, skipping what the other hand did", () => {
    const staffed = Core.makeScore([
      { pitch: 48, onset: 0, duration: 2, staff: 2 },
      { pitch: 72, onset: 0, duration: 1, staff: 1 },
      { pitch: 74, onset: 1, duration: 1, staff: 1 }, // right hand alone moves
      { pitch: 50, onset: 2, duration: 2, staff: 2 },
    ]);
    setPractice("L");
    expect(stepTime(staffed, 0, 1)).toBe(2); // the left hand skips 1s entirely
    setPractice("R");
    expect(stepTime(staffed, 0, 1)).toBe(1);
    setPractice("both");
    expect(stepTime(staffed, 0, 1)).toBe(1);
  });
});

/* The whole prelude, stepped by hand. The unit cases above pin each rule;
   this is the one that would catch a rule that is right in isolation and
   wrong over 598 notes — an onset the walk skips, a state it visits twice,
   or a step that sticks. */
describe("scores/chopin_prelude_op28_no4.musicxml", () => {
  afterEach(() => {
    setPractice("both");
    NoteGate.setEnabled(false);
    LiveKeys.releaseAll();
  });
  const chopin = MusicxmlIn.parse(
    readFileSync("scores/chopin_prelude_op28_no4.musicxml", "utf8"),
  );

  it.each([
    ["both", 189],
    ["L", 173],
    ["R", 77],
  ] as const)("steps every strike of the %s sequence, once and in order", (mode, count) => {
    setPractice(mode);
    const onsets = analyse(chopin, mode).onsets;
    expect(onsets).toHaveLength(count);

    const visited: number[] = [];
    let t = 0;
    for (;;) {
      visited.push(onsetAt(onsets, t));
      const next = stepTime(chopin, t, 1);
      if (next === t) break; // the end holds still rather than sticking mid-piece
      t = next;
    }
    expect(visited).toEqual(onsets.map((_, i) => i));

    // and the same walk in reverse gets all the way home
    let back = 0;
    for (;;) {
      const prev = stepTime(chopin, t, -1);
      if (prev === t) break;
      t = prev;
      back++;
    }
    expect(back).toBe(onsets.length - 1);
    expect(onsetAt(onsets, t)).toBe(0);
  });

  // The whole claim, in one table: every note of the part, struck exactly
  // once, and no way to get through the piece having played fewer.
  it.each([
    ["both", 189, 598],
    ["L", 173, 521],
    ["R", 77, 77],
  ] as const)("plays every note of the %s part through the gate", (mode, count, notes) => {
    setPractice(mode);
    NoteGate.setEnabled(true);
    LiveKeys.releaseAll();
    const { onsets } = analyse(chopin, mode);
    expect(onsets).toHaveLength(count);
    // every note belongs to exactly one strike, which is what makes
    // "a gate at every strike" and "every note" the same statement
    expect(onsets.flatMap((o) => o.struck)).toHaveLength(notes);
    expect(new Set(onsets.flatMap((o) => o.struck)).size).toBe(notes);

    const frame = (t: number): number => {
      const target = targetAt(chopin, t)!;
      const keys = { held: LiveKeys.held(), strikes: LiveKeys.strikes() };
      return NoteGate.check(target, keys) ? stepTime(chopin, t, 1) : t;
    };

    let t = 0;
    let played = 0;
    let lazy = 0;
    for (let i = 0; i < onsets.length; i++) {
      expect(onsetAt(onsets, t)).toBe(i);
      t = frame(t); // the frame the sequence lands on this strike
      const sounding = new Set(onsets[i].sounding.map((n) => n.pitch));
      const struck = onsets[i].struck.map((n) => n.pitch);

      // THE LAZY PLAYER: let go of what stopped sounding, put down only
      // what is genuinely new, and leave every already-down key exactly
      // where it is — that is, skip re-articulating the repeated notes.
      // This is the shortcut the old one-fresh-key rule allowed.
      for (const p of [...LiveKeys.held()]) if (!sounding.has(p)) LiveKeys.release(p);
      const isNew = struck.filter((p) => !LiveKeys.held().has(p));
      for (const p of isNew) LiveKeys.press(p);
      if (isNew.length < struck.length) {
        lazy++;
        expect(frame(t)).toBe(t); // refused: some note of this chord went unplayed
      }

      // THE HONEST PLAYER: re-articulate everything the score starts here.
      for (const p of struck) {
        LiveKeys.release(p);
        LiveKeys.press(p);
      }
      for (const p of sounding) if (!LiveKeys.held().has(p)) LiveKeys.press(p);
      played += struck.length;
      t = frame(t);
    }

    expect(onsetAt(onsets, t)).toBe(onsets.length - 1);
    expect(played).toBe(notes); // every note of the part, struck exactly once
    expect(lazy).toBeGreaterThan(0); // and the shortcut was really on offer

    NoteGate.setEnabled(false);
    LiveKeys.releaseAll();
  });
});
