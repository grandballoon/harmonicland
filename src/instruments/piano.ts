/* ====================================================================
   PIANO — an Instrument whose configuration is a fingering.

   The keyboard is bijective: one pitch, one key, so the only free choice
   is which finger plays it and which hand it belongs to. That is a small
   enough space to enumerate, which is what `candidates` does; the solver
   then picks the path through it that keeps the hands still.

   Three questions, three answers, and they are deliberately separate:

     candidates  which fingerings are physically possible for a sonority
     cost        how hard it is to get from one fingering to another
     describe    what to SAY about it

   `cost` is where the design earns its keep. It never sees the
   transition and does not need to: a finger that ends on the key it was
   already on is the same object in both configurations, and rewarding
   that is what makes the plan keep a hand in place instead of
   re-fingering every chord. Held notes and restruck notes both count —
   for the hand they are the same fact, "you were already there", and
   only the ear knows the difference.

   `describe` prefers the shortest true sentence, in four tiers: a named
   harmonic move, a shape translation, a voice move, and — when nothing
   shorter is honest — every key by name. Each tier returns null when it
   would have to guess, so a sentence is never merely plausible.
   ==================================================================== */
import { neoRelation, triadName, triadOf } from "../harmony/triads";
import { cap, count, direction, times } from "../words";
import type { Note, Pitch } from "../types";
import type { State, Transition } from "../states";
import type { Instrument } from "./solver";
import { describeKey, isBlack } from "./piano-geometry";

export type Hand = "L" | "R";

/** One note, and the finger on it. 1 is the thumb, 5 the little finger —
 *  the standard numbering, and the one a player already knows. */
export interface Placement {
  readonly note: Note;
  readonly hand: Hand;
  readonly finger: 1 | 2 | 3 | 4 | 5;
}

/** One physical way to hold a sonority: every note of it, placed.
 *
 *  `repeat` rides along because `describe` is handed configurations and a
 *  transition, never a state, and "play that chord four times" is part of
 *  the instruction. It is copied from the state, never computed here. */
export interface Fingering {
  /** Every note of the state, sorted by pitch ascending. */
  readonly placements: readonly Placement[];
  readonly repeat: number;
}

/* -------- the shape of a hand -------------------------------------- */

const HANDS: readonly Hand[] = ["L", "R"];
const FINGER_COUNT = 5;

/** The widest a hand reaches at all. An octave is the span the standard
 *  repertoire assumes, and it is exactly what the Chopin prelude needs:
 *  its widest sonority splits into two twelve-semitone hands. */
const MAX_SPAN = 12;
/** Beyond this the hand is stretched and the fingering starts to cost. */
const COMFORT_SPAN = 9;

/** Where an idle hand sits, for the opening chord of a segment: two
 *  octaves apart around middle C. */
const HOME: Record<Hand, Pitch> = { L: 48, R: 72 };

/** Adjacent fingers sit about a whole tone apart when the hand is relaxed;
 *  a fingering is judged by how far it departs from that. */
const SEMITONES_PER_FINGER = 2;
/** The thumb is short and the black keys are set back, so a thumb on a
 *  black key drags the whole hand forward. Playable, but a last resort. */
const THUMB_ON_BLACK = 2;

/** How many fingerings to keep per hand. Intra-hand comfort is a local
 *  question and the best few answers are genuinely all that is worth
 *  carrying; the solver's job is the movement BETWEEN states, and keeping
 *  every subset would multiply its work by ten for no better plan. */
const PER_HAND = 3;

/* -------- cost weights, per semitone unless stated ------------------ */

const MOVE = 1; // sliding a hand along the keyboard
const STRETCH = 2; // opening it beyond COMFORT_SPAN
const HOLD = 4; // discount per finger that stays on its key

/* -------- candidate generation -------------------------------------- */

const span = (ns: readonly Note[]): number =>
  ns.length ? ns[ns.length - 1].pitch - ns[0].pitch : 0;

/** Every strictly increasing choice of `m` fingers out of five, in
 *  lexicographic order. Increasing is the whole constraint: fingers do not
 *  pass through one another, so a hand's finger numbers rise with pitch. */
function fingerSets(m: number): number[][] {
  const out: number[][] = [];
  const walk = (start: number, acc: number[]) => {
    if (acc.length === m) return void out.push([...acc]);
    for (let f = start; f <= FINGER_COUNT; f++) walk(f + 1, [...acc, f]);
  };
  walk(1, []);
  return out;
}
const FINGER_SETS: readonly (readonly number[])[][] = [0, 1, 2, 3, 4, 5].map(fingerSets);

/** How awkward a hand shape is on its own, before any movement. */
function comfort(ps: readonly Placement[]): number {
  let c = 0;
  for (let i = 1; i < ps.length; i++) {
    const gap = ps[i].note.pitch - ps[i - 1].note.pitch;
    const reach = SEMITONES_PER_FINGER * Math.abs(ps[i].finger - ps[i - 1].finger);
    c += Math.abs(gap - reach);
  }
  for (const p of ps) if (p.finger === 1 && isBlack(p.note.pitch)) c += THUMB_ON_BLACK;
  return c;
}

/** The best few ways for one hand to hold these notes, ascending.
 *
 *  The right hand's fingers rise with pitch and the left hand's fall —
 *  the thumbs face each other — which is the one asymmetry between them
 *  and the reason `hand` is not merely a label. */
function handFingerings(notes: readonly Note[], hand: Hand): Placement[][] {
  if (!notes.length) return [[]];
  const m = notes.length;
  const scored = FINGER_SETS[m].map((fs) => {
    const placements = notes.map((note, i) => ({
      note,
      hand,
      finger: (hand === "R" ? fs[i] : fs[m - 1 - i]) as Placement["finger"],
    }));
    return { score: comfort(placements), placements };
  });
  // A stable sort keeps generation order on ties, so a candidate list is a
  // function of the sonority alone and never of iteration accidents.
  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, PER_HAND).map((s) => s.placements);
}

/* -------- prose ----------------------------------------------------- */

const FINGERS = ["", "thumb", "index finger", "middle finger", "ring finger", "little finger"];
const HAND_WORD: Record<Hand, string> = { L: "left", R: "right" };
const pcOf = (p: Pitch): number => ((p % 12) + 12) % 12;

const fingerPhrase = (p: Placement): string =>
  `the ${HAND_WORD[p.hand]} hand's ${FINGERS[p.finger]}`;

const pitchesOf = (f: Fingering): Pitch[] => f.placements.map((p) => p.note.pitch);
const placementOf = (f: Fingering, note: Note): Placement | undefined =>
  f.placements.find((p) => p.note === note);

/** The voices that genuinely change pitch, or null when this transition is
 *  not a pure voice movement at all — a note appearing from nowhere or
 *  vanishing means any "hold the rest" sentence would be a lie, so the
 *  caller must fall through to naming keys. */
function movingVoices(tr: Transition): { from: Note; to: Note }[] | null {
  if (tr.released.length !== tr.pressed.length) return null;
  if (tr.motion.length !== tr.released.length) return null;
  return tr.motion.filter((m) => m.from.pitch !== m.to.pitch);
}

/** Tier 1: the transition is a neo-Riemannian move between triads.
 *  "keep the root and the fifth, move the middle finger" is both shorter
 *  and more memorable than three key names — and it is the same alphabet
 *  the Tonnetz view already draws, so a player sees and hears one thing. */
function harmonic(from: Fingering | null, to: Fingering, tr: Transition): string | null {
  if (!from) return null;
  const a = triadOf(pitchesOf(from));
  const b = triadOf(pitchesOf(to));
  if (!a || !b) return null;
  const rel = neoRelation(a, b);
  if (!rel) return null;
  // The harmony being a P/L/R is not enough: the HAND must actually do it,
  // one voice moving while the others stay on their keys. Otherwise the
  // chords are merely related and the sentence would describe a move the
  // player is not making.
  const moves = movingVoices(tr);
  if (!moves || moves.length !== 1) return null;
  const [m] = moves;
  if (pcOf(m.from.pitch) !== rel.from || pcOf(m.to.pitch) !== rel.to) return null;
  const p = placementOf(to, m.to);
  if (!p) return null;
  return (
    `${triadName(a.root, a.quality)} to ${triadName(b.root, b.quality)} (${rel.transform}): ` +
    `keep the ${rel.kept[0]} and the ${rel.kept[1]}; ` +
    `${fingerPhrase(p)} ${direction(m.to.pitch - m.from.pitch)}`
  );
}

/** Tier 2: the same shape somewhere else. One sentence for a whole
 *  figure, because the hand does not change at all — it only moves. */
function translation(from: Fingering | null, to: Fingering): string | null {
  if (!from) return null;
  const A = pitchesOf(from);
  const B = pitchesOf(to);
  if (A.length < 2 || A.length !== B.length) return null;
  const d = B[0] - A[0];
  if (d === 0) return null;
  for (let i = 1; i < A.length; i++) if (B[i] - A[i] !== d) return null;
  return `The same shape, ${direction(d)}`;
}

/** Tier 3: one or two voices move and the rest of the hand stays. */
function voiceMove(from: Fingering | null, to: Fingering, tr: Transition): string | null {
  if (!from) return null;
  const moves = movingVoices(tr);
  if (!moves || !moves.length || moves.length > 2) return null;

  const moved = new Set(moves.map((m) => m.to));
  const staying = to.placements.filter((p) => !moved.has(p.note));
  const phrases = moves.map((m) => {
    // The finger named is the one that ARRIVES: it is the same finger that
    // left, whenever the plan could manage it, and it is the actionable
    // half of the instruction either way.
    const p = placementOf(to, m.to);
    return p ? `${fingerPhrase(p)} ${direction(m.to.pitch - m.from.pitch)}` : null;
  });
  if (phrases.some((p) => p === null)) return null;
  const move = phrases.join(", and ");

  if (!staying.length) {
    // Nothing is held, so there is no anchor to move relative to and the
    // destination has to be named outright.
    const keys = moves.map((m) => describeKey(m.to.pitch)).join(", and ");
    return `${cap(move)}, to ${keys}`;
  }
  const all = pitchesOf(to);
  const outer =
    staying.length === 2 &&
    staying[0].note.pitch === all[0] &&
    staying[staying.length - 1].note.pitch === all[all.length - 1];
  const hold = outer
    ? "Hold the outer two"
    : staying.length === 1
      ? "Hold the other note"
      : `Hold the other ${count(staying.length)} notes`;
  return `${hold}; ${move}`;
}

/** Tier 4: every key by name. The honest fallback, and the only tier that
 *  works with no previous configuration to compare against. */
function restatement(to: Fingering): string {
  const parts: string[] = [];
  for (const hand of HANDS) {
    const ps = to.placements.filter((p) => p.hand === hand);
    if (!ps.length) continue;
    const keys = ps.map((p) => `${FINGERS[p.finger]} on ${describeKey(p.note.pitch)}`);
    parts.push(`${HAND_WORD[hand]} hand: ${keys.join(", ")}`);
  }
  return cap(parts.join("; "));
}

/* -------- the instrument -------------------------------------------- */

export const piano: Instrument<Fingering> = {
  /** Every split of the sonority between the hands, times the best few
   *  fingerings for each hand. A split is legal when neither hand needs
   *  more than five fingers or a reach wider than an octave; a sonority
   *  that no split can hold returns nothing, and the solver records it as
   *  unplayable rather than inventing a fingering nobody has hands for. */
  candidates(state: State): Fingering[] {
    const notes = state.notes; // sorted by pitch ascending
    if (notes.length > 2 * FINGER_COUNT) return [];
    const out: Fingering[] = [];
    // k is how many of the lowest notes the left hand takes, so the hands
    // never interleave — which is the normal case and the only one worth
    // enumerating.
    for (let k = 0; k <= notes.length; k++) {
      const left = notes.slice(0, k);
      const right = notes.slice(k);
      if (left.length > FINGER_COUNT || right.length > FINGER_COUNT) continue;
      if (span(left) > MAX_SPAN || span(right) > MAX_SPAN) continue;
      for (const l of handFingerings(left, "L"))
        for (const r of handFingerings(right, "R"))
          out.push({ placements: [...l, ...r], repeat: state.repeat });
    }
    return out;
  },

  /** Lateral movement plus stretch, less a discount for every finger that
   *  does not have to move. The discount is what makes a good plan cheap,
   *  and it can drive a cost below zero — the solver compares totals and
   *  never assumes otherwise. */
  cost(from: Fingering | null, to: Fingering): number {
    let c = 0;
    for (const hand of HANDS) {
      const ps = to.placements.filter((p) => p.hand === hand);
      if (!ps.length) continue;
      const lo = ps[0].note.pitch;
      const hi = ps[ps.length - 1].note.pitch;
      c += STRETCH * Math.max(0, hi - lo - COMFORT_SPAN);

      const was = from?.placements.filter((p) => p.hand === hand) ?? [];
      // A hand with nothing to play was resting at home, not where it last
      // played — so an idle hand costs nothing to bring back.
      const anchor = was.length
        ? (was[0].note.pitch + was[was.length - 1].note.pitch) / 2
        : HOME[hand];
      c += MOVE * Math.abs((lo + hi) / 2 - anchor);
    }
    if (from) {
      const kept = new Set(from.placements.map((p) => `${p.hand}${p.finger}:${p.note.pitch}`));
      for (const p of to.placements)
        if (kept.has(`${p.hand}${p.finger}:${p.note.pitch}`)) c -= HOLD;
    }
    return c;
  },

  describe(from: Fingering | null, to: Fingering, tr: Transition): string {
    const body =
      harmonic(from, to, tr) ??
      translation(from, to) ??
      voiceMove(from, to, tr) ??
      restatement(to);
    return `${body}${to.repeat > 1 ? `, ${times(to.repeat)}` : ""}.`;
  },
};

/** The same instrument with one hand tied behind your back: every note of
 *  the sonority goes to `hand`, and the splits that would share it out are
 *  simply not offered.
 *
 *  That is all "practise hands separately" needs to be. `cost` and
 *  `describe` are shared verbatim, because a one-handed fingering is an
 *  ordinary `Fingering` that happens to have one hand's placements in it —
 *  the cost function already skips a hand with nothing to play, and the
 *  prose already names whichever hand it finds.
 *
 *  A sonority one hand cannot hold returns nothing, exactly as a
 *  ten-fingered impossibility does. This is not hypothetical: the Chopin
 *  prelude writes three chords on the lower staff that span more than an
 *  octave, and a hand that cannot reach them is a fact the player needs
 *  rather than a fingering nobody could use. */
export function pianoAlone(hand: Hand): Instrument<Fingering> {
  return {
    ...piano,
    candidates(state: State): Fingering[] {
      const notes = state.notes;
      if (!notes.length || notes.length > FINGER_COUNT || span(notes) > MAX_SPAN) return [];
      return handFingerings(notes, hand).map((placements) => ({
        placements,
        repeat: state.repeat,
      }));
    },
  };
}

export const Piano = { piano, pianoAlone, MAX_SPAN, COMFORT_SPAN, HOME };
