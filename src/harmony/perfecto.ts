/* ====================================================================
   PERFECTO — the generative counterpart to core.ts. Where core holds an
   immutable Score to be played BACK, this turns three live choices into a
   chord on the fly: a Key (root + scale), a numbered Degree (Nashville
   I–vii°), and a joystick "coloration" (mode × direction). computeVoicing
   feeds those through the diatonic-thirds rule and returns MIDI numbers,
   ready for LiveKeys.press. Pure: no DOM, no audio, and its only import is
   the pitch leaf, which is itself import-free — a pitch name table is not
   the kind of dependency this header exists to forbid.

   Three load-bearing subtleties, each pinned by a test:
   - Quality is DETECTED, not stored. The diatonic 3rd/5th above the root
     decide major/minor/dim; that just selects which of a joystick cell's
     three pre-baked interval lists to use.
   - Short-scale wrapping is structural. For 5–6 note scales (pentatonic,
     blues) the 3rd/5th steps run off the end of the array; the
     `% n + floor(.../n)*12` octave-add keeps thirds stacking. Don't
     simplify it away.
   - Some joystick cells collapse all three qualities to one list — that's
     how the table FORCES a quality regardless of degree.

   MIDI convention: middle C = C4 = 60, hence the +1 in (octave + 1) * 12.
   ==================================================================== */

// ---------- Pitch classes ----------
export enum PitchClass {
  C = 0, Cs, D, Ds, E, F, Fs, G, Gs, A, As, B,
}
import { PITCH_NAMES } from "../pitch";
export { PITCH_NAMES }; // re-exported: this file's callers name pitches too

// ---------- Scales ----------
export type ScaleType =
  | "major" | "naturalMinor" | "harmonicMinor" | "melodicMinor"
  | "majorPentatonic" | "minorPentatonic" | "blues"
  | "dorian" | "mixolydian" | "lydian";

export const SCALE_INTERVALS: Record<ScaleType, number[]> = {
  major:           [0, 2, 4, 5, 7, 9, 11],
  naturalMinor:    [0, 2, 3, 5, 7, 8, 10],
  harmonicMinor:   [0, 2, 3, 5, 7, 8, 11],
  melodicMinor:    [0, 2, 3, 5, 7, 9, 11],
  majorPentatonic: [0, 2, 4, 7, 9],
  minorPentatonic: [0, 3, 5, 7, 10],
  blues:           [0, 3, 5, 6, 7, 10],
  dorian:          [0, 2, 3, 5, 7, 9, 10],
  mixolydian:      [0, 2, 4, 5, 7, 9, 10],
  lydian:          [0, 2, 4, 6, 7, 9, 11],
};

export const SCALE_DISPLAY_NAMES: Record<ScaleType, string> = {
  major: "Major", naturalMinor: "Natural Minor", harmonicMinor: "Harmonic Minor",
  melodicMinor: "Melodic Minor", majorPentatonic: "Maj. Pentatonic",
  minorPentatonic: "Min. Pentatonic", blues: "Blues", dorian: "Dorian",
  mixolydian: "Mixolydian", lydian: "Lydian",
};

// ---------- Key ----------
export interface Key {
  root: PitchClass;
  scale: ScaleType;
}

// ---------- Degree (numbered chord) ----------
// I..vii°  -> zero-based index into the scale intervals
export type Degree = 1 | 2 | 3 | 4 | 5 | 6 | 7; // I, ii, iii, IV, V, vi, vii°
export const degreeIndex = (d: Degree): number => d - 1;

// ---------- Joystick (coloration) ----------
export type JoystickMode = "default" | "extended" | "chromatic";
export type JoystickDirection =
  | "center" | "up" | "upRight" | "right" | "downRight"
  | "down" | "downLeft" | "left" | "upLeft";

// Chord intervals in semitones from the chord root, one list per base quality.
export interface JoystickOutcome {
  major: number[];
  minor: number[];
  dim: number[];
}

const base: JoystickOutcome = { major: [0, 4, 7], minor: [0, 3, 7], dim: [0, 3, 6] };

export const JOYSTICK_TABLES: Record<JoystickMode, Record<JoystickDirection, JoystickOutcome>> = {
  default: {
    center:    base,
    up:        { major: [0, 3, 7],     minor: [0, 4, 7],     dim: [0, 4, 7] },     // flip major↔minor
    upRight:   { major: [0, 4, 7, 10], minor: [0, 3, 7, 10], dim: [0, 3, 6, 10] }, // dom7
    right:     { major: [0, 4, 7, 11], minor: [0, 3, 7, 10], dim: [0, 3, 6, 10] }, // maj7 / min7
    downRight: { major: [0, 4, 7, 14], minor: [0, 3, 7, 14], dim: [0, 3, 6, 14] }, // add9
    down:      { major: [0, 5, 7],     minor: [0, 5, 7],     dim: [0, 5, 7] },     // sus4
    downLeft:  { major: [0, 4, 7, 9],  minor: [0, 2, 7],     dim: [0, 2, 6] },     // 6th / sus2
    left:      { major: [0, 3, 7],     minor: [0, 3, 6],     dim: [0, 3, 6] },     // dim/min
    upLeft:    { major: [0, 4, 8],     minor: [0, 3, 8],     dim: [0, 3, 7] },     // aug
  },
  extended: {
    center:    base,
    up:        { major: [0, 3, 7],         minor: [0, 4, 7],         dim: [0, 4, 7] },
    upRight:   { major: [0, 4, 7, 10, 14], minor: [0, 3, 7, 10, 14], dim: [0, 3, 6, 10, 14] }, // dom9
    right:     { major: [0, 4, 7, 17],     minor: [0, 3, 7, 17],     dim: [0, 3, 6, 17] },     // add11
    downRight: { major: [0, 3, 7, 10, 17], minor: [0, 3, 7, 10, 17], dim: [0, 3, 7, 10, 17] }, // min11
    down:      { major: [0, 4, 7, 10, 15], minor: [0, 3, 7, 10, 15], dim: [0, 3, 6, 10, 15] }, // dom7#9
    downLeft:  { major: [0, 4, 7, 14],     minor: [0, 3, 7, 14],     dim: [0, 3, 6, 14] },     // add9
    left:      { major: [0, 5, 7, 10],     minor: [0, 5, 7, 10],     dim: [0, 5, 7, 10] },     // sus4+7
    upLeft:    { major: [0, 3, 6, 10],     minor: [0, 3, 6, 10],     dim: [0, 3, 6, 10] },     // half-dim7
  },
  chromatic: {
    center:    base,
    up:        { major: [0, 3, 7, 11],        minor: [0, 3, 7, 11],        dim: [0, 3, 7, 11] },        // minMaj7
    upRight:   { major: [0, 4, 7, 10, 14, 21], minor: [0, 4, 7, 10, 14, 21], dim: [0, 4, 7, 10, 14, 21] }, // dom13
    right:     { major: [0, 4, 7, 9, 14],     minor: [0, 3, 7, 9, 14],     dim: [0, 3, 6, 9, 14] },      // 6/9
    downRight: { major: [0, 4, 8, 10, 15],    minor: [0, 4, 8, 10, 15],    dim: [0, 4, 8, 10, 15] },     // dom7alt
    down:      { major: [0, 4, 7, 11, 14, 21], minor: [0, 4, 7, 11, 14, 21], dim: [0, 4, 7, 11, 14, 21] }, // maj13
    downLeft:  { major: [0, 4, 7, 10, 13],    minor: [0, 3, 7, 10, 13],    dim: [0, 3, 6, 10, 13] },     // dom7b9
    left:      { major: [0, 3, 6, 10],        minor: [0, 3, 6, 10],        dim: [0, 3, 6, 10] },         // half-dim7
    upLeft:    { major: [0, 4, 7, 11, 18],    minor: [0, 4, 7, 11, 18],    dim: [0, 4, 7, 11, 18] },     // maj7#11
  },
};

// ---------- Voicing ----------
export type Inversion = "root" | "first" | "second";

export interface Voicing {
  notes: number[];   // MIDI note numbers, sorted ascending
  bassNote?: number; // optional slash-chord bass (reserved, unused here)
}

export interface ComputeVoicingArgs {
  key: Key;
  degree: Degree;
  joystickMode: JoystickMode;
  joystickDirection: JoystickDirection;
  inversion: Inversion;
  octave: number;
  voiceLeading: boolean;
  previousVoicing?: Voicing | null;
}

export type ChordQuality = "maj" | "min" | "dim";

// The diatonic 3rd & 5th above the degree root decide quality — the one
// rule shared by computeVoicing (to pick a joystick interval list) and the
// views (to color a degree by its quality). Honors the same short-scale
// octave-wrap as the voicing math, so it's correct for pentatonic/blues too.
// The chord root's semitone offset above the KEY root, honoring the
// short-scale octave-wrap (see the header). Extracted because three
// callers computed it — the quality rule, the voicing, and now the
// progression realizer, which needs to know where a degree sits before a
// voicing exists — and a fourth copy of the wrap is a fourth chance to
// simplify it away.
export function degreeOffsetOf(key: Key, degree: Degree): number {
  const scale = SCALE_INTERVALS[key.scale];
  const n = scale.length;
  const degIdx = degreeIndex(degree);
  return scale[degIdx % n] + Math.floor(degIdx / n) * 12;
}

export function degreeQuality(key: Key, degree: Degree): ChordQuality {
  const scale = SCALE_INTERVALS[key.scale];
  const n = scale.length;
  const degIdx = degreeIndex(degree);
  const degreeOffset = degreeOffsetOf(key, degree);
  const thirdSteps = degIdx + 2;
  const fifthSteps = degIdx + 4;
  const thirdAbs = scale[thirdSteps % n] + Math.floor(thirdSteps / n) * 12;
  const fifthAbs = scale[fifthSteps % n] + Math.floor(fifthSteps / n) * 12;
  const isMinor = thirdAbs - degreeOffset < 4;
  const isDim = isMinor && fifthAbs - degreeOffset < 7;
  return isDim ? "dim" : isMinor ? "min" : "maj";
}

// Which of a joystick cell's three interval lists this selection uses —
// the detected quality picking one of them. The one place that choice is
// made, so a caller that wants to NAME the chord and one that wants to
// SOUND it can never disagree about which notes it has.
export function chordIntervals(
  key: Key, degree: Degree, mode: JoystickMode, direction: JoystickDirection,
): number[] {
  const outcome = JOYSTICK_TABLES[mode][direction];
  const quality = degreeQuality(key, degree);
  return quality === "dim" ? outcome.dim : quality === "min" ? outcome.minor : outcome.major;
}

export function computeVoicing(a: ComputeVoicingArgs): Voicing {
  const degreeOffset = degreeOffsetOf(a.key, a.degree);
  const intervals = chordIntervals(a.key, a.degree, a.joystickMode, a.joystickDirection);

  const chordRoot = a.key.root + (a.octave + 1) * 12 + degreeOffset;

  const build = (ivls: number[], octaveShift: number): number[] =>
    ivls.map((i) => chordRoot + i + octaveShift * 12).sort((x, y) => x - y);

  const applyInversion = (notes: number[], inv: Inversion): number[] => {
    if (notes.length < 2) return notes;
    const r = [...notes].sort((x, y) => x - y);
    if (inv === "first") r[0] += 12;
    else if (inv === "second") { r[0] += 12; r[1] += 12; }
    return r.sort((x, y) => x - y);
  };

  const cost = (cand: number[], ref: number[]): number =>
    cand.reduce((sum, note) => sum + Math.min(...ref.map((r) => Math.abs(note - r))), 0);

  // Voice-leading searches the OCTAVE SHIFT and keeps the requested inversion
  // fixed. The inversion is a constraint the player set, not a seed: the
  // search used to loop over all three inversions too, which silently
  // overrode it and made cycleInversion (keyboard `i`, gamepad d-pad left) a
  // no-op whenever voice-leading was on — a live control, a readout agreeing
  // with it, and no effect on the sound. Most of the common-tone gain comes
  // from the octave shift anyway, so this costs nothing musically.
  if (a.voiceLeading && a.previousVoicing && a.previousVoicing.notes.length > 0) {
    const prev = a.previousVoicing.notes;
    let best = applyInversion(build(intervals, 0), a.inversion);
    let bestCost = cost(best, prev);
    for (const shift of [-1, 1]) {
      const cand = applyInversion(build(intervals, shift), a.inversion);
      const c = cost(cand, prev);
      if (c < bestCost) { bestCost = c; best = cand; }
    }
    return { notes: best };
  }

  return { notes: applyInversion(build(intervals, 0), a.inversion) };
}

// ---------- Degree display ----------
const ROMAN: Record<Degree, string> = {
  1: "I", 2: "II", 3: "III", 4: "IV", 5: "V", 6: "VI", 7: "VII",
};

// The Nashville numeral for a degree IN A KEY. Casing and the ° are notation
// for the chord's quality, so they come from degreeQuality — the same one
// rule computeVoicing uses — rather than from a flat table baked around the
// major mode. In A natural minor, degree 1 is "i", not "I".
export function degreeNumeral(key: Key, degree: Degree): string {
  const q = degreeQuality(key, degree);
  const numeral = ROMAN[degree];
  return q === "maj" ? numeral : q === "min" ? numeral.toLowerCase() : `${numeral.toLowerCase()}°`;
}

// ---------- Quality colors ----------
// quality -> design token. Presentation, but presentation with ONE owner:
// the Nashville wheel, the practice harmony bar and the Tonnetz all colour a
// triad by its quality, and three copies of this map is three chances for
// two views to disagree about what a diminished chord looks like. It sits
// beside ZONE_LABEL and COLORATION_DESCRIPTOR because those are the same
// kind of fact — the vocabulary this harmony is displayed in.
export const QUALITY_COLOR: Record<ChordQuality, string> = {
  maj: "var(--note-lit)", // warm: the bright, stable one
  min: "var(--note)",     // cool
  dim: "var(--playhead)", // tension
};

// ---------- Direction glyphs ----------
export const DIRECTION_SYMBOL: Record<JoystickDirection, string> = {
  up: "↑", upRight: "↗", right: "→", downRight: "↘",
  down: "↓", downLeft: "↙", left: "←", upLeft: "↖", center: "·",
};

// ---------- Joystick zone short labels (the grid UI) ----------
export const ZONE_LABEL: Record<JoystickMode, Record<JoystickDirection, string>> = {
  default: {
    up: "Flip 3rd", upRight: "Dom 7", right: "Maj 7", downRight: "Add 9",
    down: "Sus 4", downLeft: "6/Sus2", left: "Dim", upLeft: "Aug", center: "Base",
  },
  extended: {
    up: "Flip 3rd", upRight: "Dom 9", right: "Add 11", downRight: "Min 11",
    down: "7♯9", downLeft: "Add 9", left: "Sus4 7", upLeft: "½dim 7", center: "Base",
  },
  chromatic: {
    up: "MinMaj 7", upRight: "Dom 13", right: "6/9", downRight: "7alt",
    down: "Maj 13", downLeft: "7♭9", left: "½dim 7", upLeft: "Maj7♯11", center: "Base",
  },
};

// ---------- Now-playing chord name: "C dom7" ----------
// DERIVED from the intervals that will actually sound, not looked up in a
// table keyed by joystick direction. That table was a second, quality-BLIND
// copy of the harmony: `default/right` is the diatonic seventh, so it makes
// a maj7 on I and a min7 on ii — and the table called both of them "maj7".
// A ii–V–I read "D maj7 · G dom7 · C maj7", which is wrong about the first
// chord in the most-played progression there is.
//
// Naming from the notes cannot drift, because there is nothing to keep in
// sync: add a joystick cell and it names itself.
//
// The vocabulary is this app's own — "dom7" rather than a bare "7", "min7"
// rather than "m7" — because that is what ZONE_LABEL, the gamepad help and
// the coloration wheel already say, and one program should use one set of
// words for one thing.
export function chordSymbol(intervals: readonly number[]): string {
  const has = (i: number): boolean => intervals.includes(i);

  const third = has(4) ? "maj" : has(3) ? "min" : has(5) ? "sus4" : has(2) ? "sus2" : "none";
  // a fifth that is not perfect. Spoken here only when the core name does
  // not already say it: "aug" and "dim" ARE the altered fifth.
  const fifth = has(7) ? "" : has(6) ? "♭5" : has(8) ? "♯5" : "";
  const seventh = has(11) ? "maj7" : has(10) ? "dom7" : "";
  // the highest NATURAL extension names the chord; a 13th implies the 9th
  // and 11th below it and they are not spelled out. 18 is a ♯11 and is an
  // alteration, not an eleventh — which is why it is not in this list.
  const ext = has(21) ? 13 : has(17) ? 11 : has(14) ? 9 : 0;
  const alts = (has(13) ? "♭9" : "") + (has(15) ? "♯9" : "") + (has(18) ? "♯11" : "");
  // a sixth, only where no seventh has already claimed that region.
  const sixth = has(9) && seventh === "";

  const core = ((): string => {
    if (third === "sus4" || third === "sus2")
      return seventh === "" ? third : `${seventh}${third}`;
    if (third === "maj") {
      if (seventh) return ext ? `${seventh === "maj7" ? "maj" : "dom"}${ext}` : seventh;
      if (sixth) return ext === 9 ? "6/9" : "6";
      if (has(8)) return "aug";
      return ext ? `add${ext}` : "maj";
    }
    if (third === "min") {
      const half = fifth === "♭5"; // a diminished fifth under a minor third
      if (seventh === "maj7") return "minMaj7";
      if (seventh === "dom7") return `${half ? "½dim" : "min"}${ext || 7}`;
      if (half) return sixth && ext === 9 ? "dim6/9" : ext ? `dim add${ext}` : "dim";
      if (sixth) return ext === 9 ? "min6/9" : "min6";
      return ext ? `min add${ext}` : "min";
    }
    return "5"; // no third at all — a bare fifth
  })();

  // "aug" and "dim"/"½dim" have already said what the fifth is.
  const spoken = /^(aug|dim|½dim)/.test(core);
  return core + (spoken ? "" : fifth) + alts;
}

// Root name uses degreeOffsetOf mod 12 (pitch class — the octave-wrap the
// offset carries falls out), unlike computeVoicing's absolute chord root.
export function chordName(
  key: Key,
  degree: Degree,
  mode: JoystickMode,
  direction: JoystickDirection,
): string {
  const rootPc = (((key.root + degreeOffsetOf(key, degree)) % 12) + 12) % 12;
  return `${PITCH_NAMES[rootPc]} ${chordSymbol(chordIntervals(key, degree, mode, direction))}`;
}

// ---------- Coloration descriptors: the FEEL of a joystick cell ----------
// A one-word mood for each coloration, the qualitative twin of the technical
// ZONE_LABEL ("Dom 7" -> "bluesy"). The player thinks in colors, not chord
// symbols, so this is what the readout leads with. One word per cell, keyed
// the same (mode × direction) as every other joystick table; center is the
// uncolored base. Subjective by design — tweak freely, the shape is stable.
export const COLORATION_DESCRIPTOR: Record<JoystickMode, Record<JoystickDirection, string>> = {
  default: {
    center: "plain",
    up: "bittersweet", upRight: "bluesy", right: "dreamy", downRight: "shimmery",
    down: "floating", downLeft: "wistful", left: "dark", upLeft: "eerie",
  },
  extended: {
    center: "plain",
    up: "bittersweet", upRight: "funky", right: "airy", downRight: "moody",
    down: "gritty", downLeft: "shimmery", left: "yearning", upLeft: "melancholy",
  },
  chromatic: {
    center: "plain",
    up: "noir", upRight: "swanky", right: "sunny", downRight: "biting",
    down: "cinematic", downLeft: "sinister", left: "melancholy", upLeft: "ethereal",
  },
};

export const colorationDescriptor = (mode: JoystickMode, direction: JoystickDirection): string =>
  COLORATION_DESCRIPTOR[mode][direction];

export const Perfecto = {
  computeVoicing, degreeQuality, chordName, chordSymbol, chordIntervals,
  colorationDescriptor, degreeIndex, degreeOffsetOf, QUALITY_COLOR,
};
