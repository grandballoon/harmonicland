The three concepts
Key = root pitch class + scale type. The scale defines a set of semitone intervals.
Numbered chords (degrees) = scale degrees I–vii°. A degree picks a chord root and determines whether the chord is major/minor/diminished by stacking thirds within the scale.
Chord coloration (joystick) = a 3 modes × 9 directions table that maps a base triad quality (major/minor/dim) to a set of chord intervals. This is the "color" layer.
These feed computeVoicing(...), which returns MIDI note numbers.

How it works (the algorithm)
computeVoicing in ComputeVoicing.swift:

Look up the scale's intervals array (e.g. major = [0,2,4,5,7,9,11]).
From the degree index, compute degreeOffset = semitones of the chord root above the key root. Note the % n / / n * 12 wrapping — it handles scales with fewer than 7 notes (pentatonic, blues) by wrapping into the next octave.
Stack thirds diatonically: the chord's 3rd is degIdx + 2 steps up the scale, the 5th is degIdx + 4 steps up. The resulting interval sizes decide quality:
isMinor = 3rd is < 4 semitones above root
isDim = minor and 5th < 7 semitones
Look up the joystick outcome for (mode, direction), then pick its .major / .minor / .dim interval list based on the detected quality.
chordRoot (MIDI) = key.root.rawValue + (octave + 1) * 12 + degreeOffset. Add each interval to it.
Apply inversion (raise lowest 1 or 2 notes by an octave), and optionally voice-leading (try octave shifts × inversions, minimize summed distance to previous voicing).
MIDI convention: middle C = C4 = 60.

TypeScript port

// ---------- Pitch classes ----------
export enum PitchClass {
  C = 0, Cs, D, Ds, E, F, Fs, G, Gs, A, As, B,
}
export const PITCH_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"] as const;

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
export type Degree = 1 | 2 | 3 | 4 | 5 | 6 | 7;  // I, ii, iii, IV, V, vi, vii°
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

const base: JoystickOutcome = { major: [0,4,7], minor: [0,3,7], dim: [0,3,6] };

export const JOYSTICK_TABLES: Record<JoystickMode, Record<JoystickDirection, JoystickOutcome>> = {
  default: {
    center:    base,
    up:        { major: [0,3,7],    minor: [0,4,7],    dim: [0,4,7] },     // flip major↔minor
    upRight:   { major: [0,4,7,10], minor: [0,3,7,10], dim: [0,3,6,10] },  // dom7
    right:     { major: [0,4,7,11], minor: [0,3,7,10], dim: [0,3,6,10] },  // maj7 / min7
    downRight: { major: [0,4,7,14], minor: [0,3,7,14], dim: [0,3,6,14] },  // add9
    down:      { major: [0,5,7],    minor: [0,5,7],    dim: [0,5,7] },     // sus4
    downLeft:  { major: [0,4,7,9],  minor: [0,2,7],    dim: [0,2,6] },     // 6th / sus2
    left:      { major: [0,3,7],    minor: [0,3,6],    dim: [0,3,6] },     // dim/min
    upLeft:    { major: [0,4,8],    minor: [0,3,8],    dim: [0,3,7] },     // aug
  },
  extended: {
    center:    base,
    up:        { major: [0,3,7],        minor: [0,4,7],        dim: [0,4,7] },
    upRight:   { major: [0,4,7,10,14],  minor: [0,3,7,10,14],  dim: [0,3,6,10,14] },  // dom9
    right:     { major: [0,4,7,17],     minor: [0,3,7,17],     dim: [0,3,6,17] },     // add11
    downRight: { major: [0,3,7,10,17],  minor: [0,3,7,10,17],  dim: [0,3,7,10,17] },  // min11
    down:      { major: [0,4,7,10,15],  minor: [0,3,7,10,15],  dim: [0,3,6,10,15] },  // dom7#9
    downLeft:  { major: [0,4,7,14],     minor: [0,3,7,14],     dim: [0,3,6,14] },     // add9
    left:      { major: [0,5,7,10],     minor: [0,5,7,10],     dim: [0,5,7,10] },     // sus4+7
    upLeft:    { major: [0,3,6,10],     minor: [0,3,6,10],     dim: [0,3,6,10] },     // half-dim7
  },
  chromatic: {
    center:    base,
    up:        { major: [0,3,7,11],       minor: [0,3,7,11],       dim: [0,3,7,11] },        // minMaj7
    upRight:   { major: [0,4,7,10,14,21], minor: [0,4,7,10,14,21], dim: [0,4,7,10,14,21] },  // dom13
    right:     { major: [0,4,7,9,14],     minor: [0,3,7,9,14],     dim: [0,3,6,9,14] },      // 6/9
    downRight: { major: [0,4,8,10,15],    minor: [0,4,8,10,15],    dim: [0,4,8,10,15] },     // dom7alt
    down:      { major: [0,4,7,11,14,21], minor: [0,4,7,11,14,21], dim: [0,4,7,11,14,21] },  // maj13
    downLeft:  { major: [0,4,7,10,13],    minor: [0,3,7,10,13],    dim: [0,3,6,10,13] },     // dom7b9
    left:      { major: [0,3,6,10],       minor: [0,3,6,10],       dim: [0,3,6,10] },        // half-dim7
    upLeft:    { major: [0,4,7,11,18],    minor: [0,4,7,11,18],    dim: [0,4,7,11,18] },     // maj7#11
  },
};

// ---------- Voicing ----------
export type Inversion = "root" | "first" | "second";

export interface Voicing {
  notes: number[];      // MIDI note numbers, sorted ascending
  bassNote?: number;    // optional slash-chord bass
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

export function computeVoicing(a: ComputeVoicingArgs): Voicing {
  const scale = SCALE_INTERVALS[a.key.scale];
  const n = scale.length;
  const degIdx = degreeIndex(a.degree);

  // chord root above key root (wraps for short scales)
  const degreeOffset = scale[degIdx % n] + Math.floor(degIdx / n) * 12;

  // diatonic third & fifth determine quality
  const thirdSteps = degIdx + 2;
  const fifthSteps = degIdx + 4;
  const thirdAbs = scale[thirdSteps % n] + Math.floor(thirdSteps / n) * 12;
  const fifthAbs = scale[fifthSteps % n] + Math.floor(fifthSteps / n) * 12;
  const thirdInterval = thirdAbs - degreeOffset;
  const fifthInterval = fifthAbs - degreeOffset;

  const isMinor = thirdInterval < 4;
  const isDim = isMinor && fifthInterval < 7;

  const outcome = JOYSTICK_TABLES[a.joystickMode][a.joystickDirection];
  const intervals = isDim ? outcome.dim : isMinor ? outcome.minor : outcome.major;

  const chordRoot = a.key.root + (a.octave + 1) * 12 + degreeOffset;

  const build = (ivls: number[], octaveShift: number): number[] =>
    ivls.map(i => chordRoot + i + octaveShift * 12).sort((x, y) => x - y);

  const applyInversion = (notes: number[], inv: Inversion): number[] => {
    if (notes.length < 2) return notes;
    const r = [...notes].sort((x, y) => x - y);
    if (inv === "first") r[0] += 12;
    else if (inv === "second") { r[0] += 12; r[1] += 12; }
    return r.sort((x, y) => x - y);
  };

  const cost = (cand: number[], ref: number[]): number =>
    cand.reduce((sum, note) =>
      sum + Math.min(...ref.map(r => Math.abs(note - r))), 0);

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
Porting notes / gotchas
PitchClass is just 0–11. The +1 in (octave + 1) * 12 is the MIDI octave convention (C4 = 60). Octave 4 → middle C.
Quality is detected, not stored. There is no ChordQuality enum in the actual code (the CLAUDE.md mentions one as a future concept, but the implemented model derives major/minor/dim from the diatonic third/fifth on the fly). Each joystick cell carries three pre-baked interval lists; the detected base quality just selects which list.
Short-scale wrapping is load-bearing. For pentatonic/blues scales (5–6 notes), degIdx + 2/+4 can exceed the array length; the % n + Math.floor(.../n)*12 octave-add is what keeps thirds stacking correctly. Don't simplify it away.
Some joystick cells intentionally collapse all three qualities to one (e.g. extended downRight min11, chromatic up minMaj7) — that's how the table "forces" a quality regardless of degree.
bassNote is defined but unused by computeVoicing (reserved for slash chords). The voicing constructor in Swift sorts notes; replicate with .sort((a,b)=>a-b) since JS default sort is lexicographic.
Display names: degrees render as I, ii, iii, IV, V, vi, vii° (case signals quality conventionally, but quality is computed). For chord-name labels you'd derive from the interval set — that logic isn't in core; it lives in the views if anywhere.

Here's the human-readable label layer. There are two slightly different naming tables in the codebase (one for the joystick zone UI in ChordBarView.swift, one for the "now playing" readout in PerformanceState.swift) — I'll give you both.

What lives where
Label	Source	Example
Degree roman numeral	Degree.numeralLabel (SequencerState.swift:13)	I, ii, iii, IV, V, vi, vii°
Degree button color	hardcoded rows in PerformanceView.swift:27	orange/blue/indigo/purple
Joystick zone short label	ChordBarView.label(for:)	Dom 7, Maj 7…
Now-playing chord name	PerformanceState.displayText + qualityLabel	C maj7, A min11
Direction arrow glyph	ChordBarView.symbol(for:)	↑ ↗ → ↘ ↓ ↙ ← ↖
Two important details:

The numeral casing is purely cosmetic/hardcoded — I/IV/V upper, ii/iii/vi lower, vii° with the degree symbol. It's a fixed array, not derived (so it assumes a major-ish diatonic context; it does not re-case for minor keys).
The now-playing root name is computed from (key.root + degreeOffset) % 12 — note it only uses intervals[degree.index % count], i.e. it does not add the octave-wrap term that computeVoicing uses. Fine for naming since it only needs the pitch class.
TypeScript additions

// ---------- Degree display ----------
export const DEGREE_NUMERAL: Record<Degree, string> = {
  1: "I", 2: "ii", 3: "iii", 4: "IV", 5: "V", 6: "vi", 7: "vii°",
};

// Button accent colors (semantic: orange=major-ish, blue=minor, etc.)
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
// Quality suffix used when building the readable chord name.
// (Note: lowercase 'maj' here vs 'Maj 7' in ZONE_LABEL — these are two separate
// tables in the Swift app; pick one for your UI or keep both.)
const CENTER_QUALITY = (d: Degree): string => {
  if (d === 1 || d === 4 || d === 5) return "maj";
  if (d === 2 || d === 3 || d === 6) return "min";
  return "dim"; // vii°
};

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
Notes for the browser port
displayName for scales (the "C Major" key readout) is already in the SCALE_DISPLAY_NAMES map I gave you earlier.
The two label tables intentionally differ — ZONE_LABEL (title-cased, for the always-visible zone grid) and QUALITY_LABEL (lowercased, appended to a root note for the now-playing text). If you don't need the dual style, just use ZONE_LABEL and lowercase it.
flip 3rd is an odd case as a chord name — it's a relative transform, not a real quality, so "C flip 3rd" reads strangely. In Perfecto's UI it only really makes sense in the zone grid. For a clean browser name you might special-case up/down-flip to recompute the actual resulting quality, but the shipped app doesn't bother.
None of this naming reflects inversion or voice-leading — those only change Voicing.notes, never the label. The name is always root-position-named.
That's the full label layer. Combined with the earlier computeVoicing port you now have both the note-generation model and the display model.