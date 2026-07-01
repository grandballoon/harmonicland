/* ====================================================================
   PERFECTO — the generative counterpart to core.ts. Where core holds an
   immutable Score to be played BACK, this turns three live choices into a
   chord on the fly: a Key (root + scale), a numbered Degree (Nashville
   I–vii°), and a joystick "coloration" (mode × direction). computeVoicing
   feeds those through the diatonic-thirds rule and returns MIDI numbers,
   ready for LiveKeys.press. Pure: imports nothing, no DOM, no audio.

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
export const PITCH_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;

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
export function degreeQuality(key: Key, degree: Degree): ChordQuality {
  const scale = SCALE_INTERVALS[key.scale];
  const n = scale.length;
  const degIdx = degreeIndex(degree);
  const degreeOffset = scale[degIdx % n] + Math.floor(degIdx / n) * 12;
  const thirdSteps = degIdx + 2;
  const fifthSteps = degIdx + 4;
  const thirdAbs = scale[thirdSteps % n] + Math.floor(thirdSteps / n) * 12;
  const fifthAbs = scale[fifthSteps % n] + Math.floor(fifthSteps / n) * 12;
  const isMinor = thirdAbs - degreeOffset < 4;
  const isDim = isMinor && fifthAbs - degreeOffset < 7;
  return isDim ? "dim" : isMinor ? "min" : "maj";
}

export function computeVoicing(a: ComputeVoicingArgs): Voicing {
  const scale = SCALE_INTERVALS[a.key.scale];
  const n = scale.length;
  const degIdx = degreeIndex(a.degree);

  // chord root above key root (wraps for short scales)
  const degreeOffset = scale[degIdx % n] + Math.floor(degIdx / n) * 12;

  const quality = degreeQuality(a.key, a.degree);
  const outcome = JOYSTICK_TABLES[a.joystickMode][a.joystickDirection];
  const intervals = quality === "dim" ? outcome.dim : quality === "min" ? outcome.minor : outcome.major;

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

  if (a.voiceLeading && a.previousVoicing && a.previousVoicing.notes.length > 0) {
    const prev = a.previousVoicing.notes;
    let best = applyInversion(build(intervals, 0), a.inversion);
    let bestCost = cost(best, prev);
    for (const shift of [-1, 0, 1]) {
      for (const inv of ["root", "first", "second"] as Inversion[]) {
        const cand = applyInversion(build(intervals, shift), inv);
        const c = cost(cand, prev);
        if (c < bestCost) { bestCost = c; best = cand; }
      }
    }
    return { notes: best };
  }

  return { notes: applyInversion(build(intervals, 0), a.inversion) };
}

// ---------- Degree display ----------
export const DEGREE_NUMERAL: Record<Degree, string> = {
  1: "I", 2: "ii", 3: "iii", 4: "IV", 5: "V", 6: "vi", 7: "vii°",
};

// Button accent colors (semantic: orange=major-ish, blue=minor, etc.).
// Casing of the numeral above is cosmetic — it assumes a major-ish diatonic
// context and does NOT re-case for minor keys, matching the shipped app.
export const DEGREE_COLOR: Record<Degree, string> = {
  1: "orange", 2: "blue", 3: "indigo", 4: "orange",
  5: "orange", 6: "blue", 7: "purple",
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

// ---------- Now-playing chord name: "C maj7" ----------
// Quality suffix at center, derived from the diatonic degree convention.
const CENTER_QUALITY = (d: Degree): string => {
  if (d === 1 || d === 4 || d === 5) return "maj";
  if (d === 2 || d === 3 || d === 6) return "min";
  return "dim"; // vii°
};

// Lowercased twin of ZONE_LABEL, appended to a root note for the readout.
const QUALITY_LABEL: Record<JoystickMode, Record<Exclude<JoystickDirection, "center">, string>> = {
  default: {
    up: "flip 3rd", upRight: "dom7", right: "maj7", downRight: "add9",
    down: "sus4", downLeft: "6/sus2", left: "dim", upLeft: "aug",
  },
  extended: {
    up: "flip 3rd", upRight: "dom9", right: "add11", downRight: "min11",
    down: "7♯9", downLeft: "add9", left: "sus4 7", upLeft: "½dim7",
  },
  chromatic: {
    up: "minMaj7", upRight: "dom13", right: "6/9", downRight: "7alt",
    down: "maj13", downLeft: "7♭9", left: "½dim7", upLeft: "maj7♯11",
  },
};

// Root name uses intervals[degIdx % n] only (pitch class — no octave-wrap
// needed for naming), unlike computeVoicing's chord-root math.
export function chordName(
  key: Key,
  degree: Degree,
  mode: JoystickMode,
  direction: JoystickDirection,
): string {
  const intervals = SCALE_INTERVALS[key.scale];
  const degreeOffset = intervals[degreeIndex(degree) % intervals.length];
  const rootPc = (key.root + degreeOffset) % 12;
  const rootName = PITCH_NAMES[rootPc];
  const quality =
    direction === "center" ? CENTER_QUALITY(degree) : QUALITY_LABEL[mode][direction];
  return `${rootName} ${quality}`;
}

export const Perfecto = { computeVoicing, degreeQuality, chordName, degreeIndex };
