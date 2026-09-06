/* ====================================================================
   HANDS — the spoken score, drawn on a keyboard instead of written out.

   The same information as `outputs/prose.ts` and the same four layers
   underneath it (states -> plan -> transition -> `piano.describe`), but
   projected onto the keys rather than into sentences. One state at a
   time, and NOTHING FALLS: there is no time axis here at all, so there is
   nothing to scroll. What you see is the chord your hands are on, which
   keys each hand takes, and which finger goes where.

   ONE SCREEN IS ONE STRIKE, and that is the choice everything else here
   follows from. The obvious unit is the STATE — the run-length-encoded
   sonority the spoken score reads by, where a chord struck four times is
   one line saying "four times". That is the right grain for reading and
   the wrong grain for playing: four strikes are four things you do, and in
   the Chopin prelude 38 of 98 runs strike a DIFFERENT subset each time,
   which a single screen cannot show and a single gate cannot ask for. So
   the view walks `onsetsOf` — 189 strikes rather than 98 sonorities — and
   every one of the piece's 598 notes is struck at exactly one of them.

   THIS IS A `View` THAT IGNORES ITS `t` EXCEPT TO LOCATE ITSELF. Time left
   the model at states.ts, so `t` cannot be a coordinate here the way it is
   in the roll — it is used once, by `onsetAt`, to answer "which strike is
   the transport sitting on", and never again.

   The colour convention, and it is the whole point of the view:

     left hand   --hand-l    right hand  --hand-r
     dimmed      still ringing from the last chord — do NOT re-strike
     solid       strike it
     green ring  you are holding it right now (live MIDI / keyboard)

   HANDS SEPARATELY is a filter on the SCORE, not on the drawing. Practising
   the left hand is not "the same piece with the right hand greyed out" —
   it is a shorter piece, whose states are the left hand's own chords and
   whose transitions skip everything only the right hand did. So the score
   is filtered first and the whole pipeline runs on what is left, with the
   instrument narrowed to that one hand (`pianoAlone`). In the Chopin
   prelude that turns 98 states into 57 for the left hand and 69 for the
   right, which is the measurement that says the filter belongs upstream.
   The transport is untouched: onsets survive the filter, so `t` still
   locates you in the whole piece.

   Nothing about keys, fingers or hands is decided here. The plan comes
   from the solver and the sentence comes from the instrument, exactly as
   in prose.ts; this module places them.
   ==================================================================== */
import { Core } from "../core";
import {
  onsetAt, onsetsOf, statesOf, transitionsOf, type Onset, type State, type Transition,
} from "../states";
import { planFor, type Plan } from "../instruments/solver";
import { piano, pianoAlone, type Fingering, type Hand, type Placement } from "../instruments/piano";
import { opening } from "./prose";
import { LiveKeys } from "../live-keys";
import { NoteGate } from "../note-gate";
import { KEYB, keysMarkup, layout, type KeyPaint, type Region } from "./keyboard";
import { nameOf, spell } from "./staff-std";
import { GLOW_DEFS, SANS, text } from "./svg";
import type { Note, Pitch, Score, View } from "../types";

const HAND_COLOR: Record<Hand, string> = { L: "var(--hand-l)", R: "var(--hand-r)" };
const HAND_LABEL: Record<Hand, string> = { L: "LEFT", R: "RIGHT" };
const HANDS: readonly Hand[] = ["L", "R"];

/** Text on a hand-coloured key. Both fills are light, so both take ink. */
const ON_HAND = "#0b1020";

/** A note still ringing is the same key, quieter — never a different
 *  colour, or "keep holding this" would read as a third hand. */
const HELD_OPACITY = 0.34;

const PAD = 26;

/* -------- which hand is practising ---------------------------------- */

/** Both hands together, or one of them alone. */
export type Practice = "both" | Hand;

// The one piece of module state, and it is a UI setting rather than a fact
// about the music — the same shape as the Nashville view reading PerfState.
// `analyse` takes it as a parameter so nothing about the analysis is
// hidden; only `markup`, which has no way to be told, reads it from here.
let practice: Practice = "both";
export const setPractice = (p: Practice): void => {
  practice = p;
};
export const getPractice = (): Practice => practice;

/** Which hand plays each note.
 *
 *  The score's own answer wherever it has one — MusicXML writes the two
 *  hands as two staves, and that is a choice the composer made rather than
 *  one we should be re-deriving. Only where it says nothing does the
 *  solver get asked, and its answer is the very split this view draws with
 *  both hands on, so the two modes never disagree about whose note it is. */
function handsOf(score: Score): Map<Note, Hand> {
  const map = new Map<Note, Hand>();
  for (const n of score.notes) if (n.staff !== undefined) map.set(n, n.staff <= 1 ? "R" : "L");
  if (map.size === score.notes.length) return map;

  for (const { config } of planFor(statesOf(score), piano))
    for (const p of config?.placements ?? []) if (!map.has(p.note)) map.set(p.note, p.hand);
  // A note in a sonority nobody can hold was never placed, and it must not
  // vanish from both hands. Middle C is the crude answer, and the only one
  // available once the solver has declined.
  for (const n of score.notes) if (!map.has(n)) map.set(n, n.pitch < 60 ? "L" : "R");
  return map;
}

/** The piece as one hand plays it. Onsets and bars survive untouched, so
 *  the transport still points at the same moment of the same music. */
function scoreFor(score: Score, hand: Hand): Score {
  const hands = handsOf(score);
  return Core.makeScore(score.notes.filter((n) => hands.get(n) === hand), score.bars);
}

/* -------- the analysis, once per score ------------------------------ */

interface Analysis {
  /** What the view walks: one entry per strike. */
  onsets: Onset[];
  /** What the solver and the prose work in: sonorities, run-length encoded. */
  states: State[];
  transitions: Transition[];
  plan: Plan<Fingering>;
  /** Strike index -> the state it belongs to. `sum(repeat) === onsets.length`,
   *  so expanding the runs lines the two sequences up exactly. */
  stateOf: number[];
  /** Strike index -> which statement of its run this is, from 1. */
  statement: number[];
  practice: Practice;
  /** True when the score has notes but this hand plays none of them. */
  silent: boolean;
}

// Solving the whole piece is a whole-piece Viterbi pass and must not happen
// per frame. It is a pure function of (score, practice), so memoising on the
// score's identity is exact: `loadScore` replaces the object, never mutates
// it — and the practice mode joins the key rather than invalidating it, so
// toggling back and forth re-solves rather than returning the wrong hand.
let cached: { score: Score; practice: Practice; analysis: Analysis } | null = null;

export function analyse(score: Score, mode: Practice = "both"): Analysis {
  if (cached?.score === score && cached.practice === mode) return cached.analysis;
  const played = mode === "both" ? score : scoreFor(score, mode);
  const onsets = onsetsOf(played);
  const states = statesOf(played);
  const inst = mode === "both" ? piano : pianoAlone(mode);
  // Expanding the runs is what ties the two sequences together, and it is
  // exact rather than approximate: a state's `repeat` counts the strikes it
  // absorbed, so the expansion has one entry per onset by construction.
  const stateOf: number[] = [];
  const statement: number[] = [];
  states.forEach((st, i) => {
    for (let k = 0; k < st.repeat; k++) {
      stateOf.push(i);
      statement.push(k + 1);
    }
  });
  const analysis: Analysis = {
    onsets,
    states,
    transitions: transitionsOf(states),
    plan: planFor(states, inst),
    stateOf,
    statement,
    practice: mode,
    silent: score.notes.length > 0 && played.notes.length === 0,
  };
  cached = { score, practice: mode, analysis };
  return analysis;
}

/* -------- stepping the sequence -------------------------------------- */

/** What the player has to do at one strike: the keys that must be DOWN,
 *  and the ones that must be freshly STRUCK. `strike` is always a subset
 *  of `hold` — you cannot play a key without holding it — and the rest of
 *  `hold` is what is still ringing from earlier. */
export interface Target {
  index: number;
  hold: readonly Pitch[];
  strike: readonly Pitch[];
}

/** How far into a sonority you may be and still count as sitting on it.
 *  Small on purpose: a chord can be shorter than the forgiveness
 *  `Core.barStep` gives a bar, so anything generous here would make
 *  "back" stick on a tremolo instead of walking out of it. */
const AT_ONSET = 1e-6;

/** Where the transport lands when stepping one strike from `t`.
 *
 *  The counterpart to `Core.barStep`, deliberately the same shape: a pure
 *  query returning a time to seek to, so stepping is ordinary transport
 *  and everything downstream — the roll, the audio, the scrubber — follows
 *  without being told. There is no separate cursor to drift out of sync
 *  with the clock, which is the whole reason this is a seek rather than a
 *  pointer of its own.
 *
 *  It is a step through STRIKES, not through time: one tap is one thing
 *  you do, however long or short it lasts, which is what "independent of
 *  tempo" means here. And it walks the sequence currently being practised
 *  — stepping the left hand alone skips everything only the right hand did.
 *
 *  Going back from inside a strike returns to its own start first, so a
 *  step never skips the one you were in the middle of; from its start it
 *  goes to the previous. At either end it stays put rather than jumping
 *  to silence. */
export function stepTime(score: Score, t: number, dir: -1 | 1): number {
  const { onsets } = analyse(score, practice);
  if (!onsets.length) return t;
  const i = onsetAt(onsets, t);
  if (dir > 0) return onsets[Math.min(onsets.length - 1, i + 1)].time;
  if (t > onsets[i].time + AT_ONSET) return onsets[i].time;
  return onsets[Math.max(0, i - 1)].time;
}

/** What the player has to do at the strike the transport is sitting on:
 *  the keys that must be DOWN, and the ones that must be freshly STRUCK.
 *
 *  The two are different and the difference is the whole point. `hold` is
 *  the sonority — including notes still ringing from earlier, which the
 *  fingers are still on. `strike` is only what the score starts here, and
 *  it is what makes the gate account for every note in the piece: a note
 *  is struck at exactly one onset, so demanding the strike set at every
 *  onset demands each note exactly once. */
export function targetAt(score: Score, t: number): Target | null {
  const { onsets } = analyse(score, practice);
  const i = onsetAt(onsets, t);
  if (i < 0) return null;
  return {
    index: i,
    hold: onsets[i].sounding.map((n) => n.pitch),
    strike: onsets[i].struck.map((n) => n.pitch),
  };
}

/* -------- what to say and show about one strike --------------------- */

/* -------- what to say and show about one state ---------------------- */

/** Everything the view draws, derived from a strike index. Separated from
 *  the drawing so a test can assert the reading without parsing markup. */
export interface Reading {
  index: number;
  total: number;
  /** How many times this sonority is struck in a row, and which of them
   *  this is. `1 of 1` for the ordinary case. */
  repeat: number;
  statement: number;
  /** The sentence — `piano.describe` verbatim, the same one the spoken
   *  score prints for this sonority. A run's restatements keep it: the
   *  instruction has not changed, only the count. */
  sentence: string;
  /** Every note sounding here, placed. Empty when the chord has no
   *  fingering at all, which `unplayable` then reports. */
  placements: readonly Placement[];
  /** Pitches still ringing from earlier: hold, do not strike. Read from
   *  this strike rather than from the sonority's first statement, which is
   *  what makes a restatement show what it actually restrikes. */
  held: ReadonlySet<Pitch>;
  /** Everything sounding here, whether or not it could be fingered. */
  pitches: readonly Pitch[];
  unplayable: boolean;
  /** Note names per hand, in the order the hand meets them. */
  names: Record<Hand, string[]>;
  /** Which hands this reading is of — the counter says so, because a
   *  strike number means something different in each mode. */
  practice: Practice;
  /** How many of this sonority's keys are down right now. */
  down: number;
}

const UNPLAYABLE = "No fingering reaches this chord — take the notes you can and pick it up at the next one.";
/** The one-handed case is a different fact and deserves a different
 *  sentence: this chord is playable, just not by one hand, and rolling it
 *  is what a player actually does about that. */
const HAND_WORD: Record<Hand, string> = { L: "left", R: "right" };
const TOO_WIDE = (h: Hand): string =>
  `The ${HAND_WORD[h]} hand alone cannot hold this chord — roll it, or take it with both hands.`;

export function readingAt(a: Analysis, index: number): Reading | null {
  const onset = a.onsets[index];
  if (!onset) return null;

  const si = a.stateOf[index];
  const to = a.plan[si].config;
  const from = si > 0 ? a.plan[si - 1].config : null;
  const tr = si > 0 ? a.transitions[si - 1] : opening(a.states[si]);

  // The fingering is the sonority's, so it is shared by every statement of
  // the run — the hand does not re-finger a chord to play it again. Its
  // placements name the run's FIRST notes, so they are matched by pitch.
  const placements = to?.placements ?? [];
  const names: Record<Hand, string[]> = { L: [], R: [] };
  for (const p of placements) names[p.hand].push(nameOf(spell(p.note.pitch, p.note.spelling)));

  const struck = new Set(onset.struck.map((n) => n.pitch));
  const pitches = onset.sounding.map((n) => n.pitch);

  return {
    index,
    total: a.onsets.length,
    repeat: a.states[si].repeat,
    statement: a.statement[index],
    sentence: to
      ? (a.practice === "both" ? piano : pianoAlone(a.practice)).describe(from, to, tr)
      : a.practice === "both"
        ? UNPLAYABLE
        : TOO_WIDE(a.practice),
    placements,
    held: new Set(pitches.filter((p) => !struck.has(p))),
    pitches,
    unplayable: to === null,
    names,
    practice: a.practice,
    down: NoteGate.progress(pitches, LiveKeys.held()),
  };
}

/* -------- drawing ---------------------------------------------------- */

/** Break a sentence into lines of at most `max` characters, on word
 *  boundaries. SVG text does not wrap, and a paragraph is the one thing
 *  this view has that the other views do not. */
export function wrap(s: string, max: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of s.split(/\s+/)) {
    if (!line) line = word;
    else if (line.length + 1 + word.length <= max) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** The keyboard band for a W×H view: as tall as the space comfortably
 *  allows, so the finger numbers are readable, and never taller than a
 *  keyboard looks right at. */
export const keyboardHeight = (H: number): number =>
  Math.round(Math.max(KEYB, Math.min(260, H * 0.42)));

/** Where the keyboard sits within the view, for pointer hit-testing. It
 *  is a band with the keys at its bottom, which is exactly the shape
 *  `keyboard.pitchAt` expects. */
export const region = (svg: SVGSVGElement): Region => {
  const W = svg.clientWidth;
  const H = svg.clientHeight;
  const h = keyboardHeight(H);
  return { x: 0, y: H - h - PAD, w: W, h };
};

export const render: View = (svg, score, t) => {
  const W = svg.clientWidth;
  const H = svg.clientHeight;
  if (!W || !H) return;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.innerHTML = GLOW_DEFS + markup(W, H, score, t);
};

export const markup = (W: number, H: number, score: Score, t: number): string => {
  if (!W || !H) return "";

  const a = analyse(score, practice);
  const reading = readingAt(a, onsetAt(a.onsets, t));
  const live = LiveKeys.held();

  const keybH = keyboardHeight(H);
  const L = layout(W, keybH, keybH); // a band whose keys fill it entirely
  const kbTop = H - keybH - PAD;

  // pitch -> how it is played, for the key painter below.
  const byPitch = new Map<Pitch, Placement>();
  for (const p of reading?.placements ?? []) byPitch.set(p.note.pitch, p);
  const target = new Set(reading?.pitches ?? []);

  const paint = (p: Pitch): KeyPaint | null => {
    const placed = byPitch.get(p);
    const inChord = target.has(p);
    const down = live.has(p);
    if (!inChord) return down ? { fill: "var(--key-press)", glow: true } : null;
    const ringing = reading!.held.has(p);
    return {
      // A chord with no fingering still has notes; it loses the hand
      // colours, not the keys, because "these are the notes" is still true.
      fill: placed ? HAND_COLOR[placed.hand] : "var(--note-lit)",
      opacity: ringing ? HELD_OPACITY : undefined,
      glow: !ringing,
      // The one thing a live press adds to a key you were already told to
      // play: confirmation. A ring, not a recolour — the hand it belongs
      // to has not changed.
      stroke: down ? "var(--key-press)" : undefined,
      label: placed && !ringing ? String(placed.finger) : undefined,
      labelFill: ON_HAND,
    };
  };

  let out = `<g transform="translate(0,${kbTop})">${keysMarkup(L, paint)}</g>`;
  out += panel(W, kbTop, reading, notice(a));
  return out;
};

/** Why there is no chord to show, when there is none. An empty score and a
 *  hand this score never writes for are different situations, and the
 *  second one is a dead end the player needs told about — otherwise
 *  "practise the right hand" on a bass part looks like a broken view. */
const notice = (a: Analysis): string =>
  a.silent
    ? `This score writes nothing for the ${HAND_WORD[a.practice as Hand]} hand.`
    : "Load a score to see the chord under your hands.";

/** Everything above the keyboard: where you are, what to do, and which
 *  keys each hand takes by name.
 *
 *  The hierarchy is deliberate and it is the difference between this view
 *  and the spoken-score panel. THE KEYBOARD IS THE PAYLOAD — it already
 *  answers "which key", which is what most of `piano.describe`'s longest
 *  sentences spend their words on. So the sentence is a CAPTION here: it
 *  is fitted to the space left over rather than given the space it wants,
 *  and a long one simply gets smaller. Truncating it was the alternative,
 *  and a half-instruction is worse than a small one. */
function panel(W: number, H: number, r: Reading | null, empty: string): string {
  if (H < 40) return ""; // no room; the keyboard alone still says plenty
  const mid = W / 2;

  if (!r)
    return text(mid, H / 2, empty, { size: 14, fill: "var(--ink-dim)", family: SANS });

  let out = "";

  // --- the counter, pinned to the top corners. It names the mode as well
  // as the number, because "state 12 of 57" counts a different piece when
  // one hand is practising alone. The repeat rides with it rather than
  // opposite it, leaving the right corner for the gate. ---
  const mode = r.practice === "both" ? "" : ` · ${HAND_WORD[r.practice].toUpperCase()} HAND ALONE`;
  // A repeated sonority counts its own statements, so "again" is a number
  // you can be part-way through rather than a word you have to trust.
  const rep = r.repeat > 1 ? ` · ×${r.statement} of ${r.repeat}` : "";
  out += text(PAD, 30, `STRIKE ${r.index + 1} / ${r.total}${rep}${mode}`, {
    size: 12,
    fill: r.practice === "both" ? "var(--ink-dim)" : HAND_COLOR[r.practice],
    anchor: "start",
  });

  // --- the gate, when it is holding the sequence. It counts in the same
  // colour the keys you are holding are ringed in, so the number and the
  // rings are obviously one fact. ---
  if (NoteGate.isEnabled()) {
    // "Holding all four and it still will not move" is the one state a
    // single number cannot explain, so the two waits are named apart.
    const { pending } = NoteGate.status();
    const waiting =
      r.down < r.pitches.length
        ? `WAITING · ${r.down} / ${r.pitches.length} DOWN`
        : `STRIKE ${pending} MORE`;
    out += text(W - PAD, 30, waiting, {
      size: 12,
      fill: "var(--key-press)",
      anchor: "end",
      weight: 700,
    });
  }

  // --- who plays what, sitting directly on top of the keyboard and on
  // the side of the stage that hand plays: low notes left, high notes
  // right, the same way round as the keys themselves. ---
  const nameSize = Math.round(Math.max(15, Math.min(24, W / 60)));
  const namesY = H - 14;
  const labelY = namesY - Math.round(nameSize * 1.35);
  const room = H >= 130; // a short stage keeps the names and drops the rest

  for (const hand of HANDS) {
    if (!r.names[hand].length) continue;
    const left = hand === "L";
    const x = left ? PAD : W - PAD;
    const anchor = left ? "start" : "end";
    out += text(x, labelY, HAND_LABEL[hand], {
      size: 11,
      fill: "var(--ink-dim)",
      weight: 600,
      anchor,
    });
    out += text(x, namesY, r.names[hand].join("  ·  "), {
      size: nameSize,
      fill: HAND_COLOR[hand],
      weight: 600,
      anchor,
    });
  }

  // --- the sentence, fitted to the band between the two. ---
  if (!room) return out;
  const band = { top: 52, bottom: labelY - nameSize };
  out += caption(W, band, r.sentence, r.unplayable);
  return out;
}

/** Type sizes the caption may take, largest first; the last is the floor. */
const CAPTION_SIZES = [22, 20, 18, 16, 15, 14, 13, 12];
/** Sans-serif advance width as a fraction of the em, near enough to break
 *  lines by. Erring small would overflow the band, so it errs generous. */
const CHAR_EM = 0.53;
/** A caption is a caption. Given a tall band and a long sentence, fitting
 *  by height alone would set seven lines in 22px type and bury the
 *  keyboard under a wall of prose — so a big size has to earn itself by
 *  staying short, and a long sentence goes small instead of going large. */
const MAX_CAPTION_LINES = 4;

function caption(
  W: number,
  band: { top: number; bottom: number },
  sentence: string,
  dim: boolean,
): string {
  const h = band.bottom - band.top;
  if (h < 20) return "";

  // Step down until the sentence is both short enough to read as a caption
  // and small enough to fit the band. At the floor the line limit is
  // dropped — by then "as small as it goes" is the only lever left.
  const fitted = (size: number, limit: number): string[] | null => {
    const lines = wrap(sentence, Math.floor((W * 0.84) / (size * CHAR_EM)));
    const fits = lines.length <= limit && lines.length * Math.round(size * 1.4) <= h;
    return fits ? lines : null;
  };
  const floor = CAPTION_SIZES[CAPTION_SIZES.length - 1];
  let size = floor;
  let lines: string[] | null = null;
  for (const s of CAPTION_SIZES) {
    lines = fitted(s, MAX_CAPTION_LINES);
    if (lines) {
      size = s;
      break;
    }
  }
  // Nothing fit as a caption; take whatever the floor can hold in full.
  // If even that overruns, the stage is too short for prose and the
  // sentence is dropped rather than truncated — a half-instruction is
  // worse than none, and the keys and the note names are still complete.
  lines ??= fitted(floor, Infinity);
  if (!lines) return "";

  const lineH = Math.round(size * 1.4);
  let y = band.top + Math.max(0, (h - lines.length * lineH) / 2) + size;
  let out = "";
  for (const line of lines) {
    out += text(W / 2, y, line, {
      size,
      fill: dim ? "var(--ink-dim)" : "var(--ink)",
      family: SANS,
      weight: 500,
    });
    y += lineH;
  }
  return out;
}

export const Hands = {
  render, markup, region, analyse, readingAt, wrap, keyboardHeight,
  setPractice, getPractice, stepTime, targetAt,
};
