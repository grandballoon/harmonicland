/* ====================================================================
   PROGRESSION — the third way this program can name music, and the one
   that has been missing.

   core.ts holds a Score: notes at times, played BACK. perfecto.ts holds a
   selection: one chord, generated live from a Key, a Degree and a
   coloration. Neither can say "ii–V–I", because that is a SEQUENCE of
   perfecto's selections — a structure, not a moment and not a recording.
   This is that type.

   A CHANGE is one harmonic state, named the way a musician names it. A
   PROGRESSION is an ordered run of them. The interesting thing is not
   either value but the gap between two adjacent ones: a chord change IS a
   state transformation, and the practice view has always drawn exactly
   that — an arrow from the key a finger is on to the key it moves to.
   Until now it could only draw one when a MIDI file happened to contain
   it. A Progression is that same picture written down directly, so the
   structures worth practising — cadences, turnarounds, the blues, the
   cycle of fifths — can be PLAYED rather than found in a file.

   THE LOWERING. `realize` turns a Progression into RawNotes plus a Chart.
   Every downstream module keeps working unchanged: makeSteps cuts the
   notes into steps, the cursor grades them, the keyboard colours them,
   the arrows pair them. That is the whole design decision — a progression
   is a SOURCE of a score, taking its place beside the MIDI and MusicXML
   parsers, not a second engine bolted next to practice mode.

   What a Score cannot carry is what the notes MEAN, and lowering would
   otherwise throw it away: once C-E-G-B is four pitches, nothing in it
   remembers that it was Imaj7 in C. So realize also emits a CHART — the
   analysis, indexed by score time — and the practice cursor carries it
   alongside the score. `chart: null` is the honest answer for a score
   that came from a file: we do not guess an analysis nobody gave us.

   ONE MECHANISM FOR THREE THINGS. A Change names its own Key rather than
   inheriting the progression's. That single field is how borrowed chords
   (♭VII in a major key), secondary dominants (V/V) and outright
   modulation (Coltrane changes) are all expressed, with no second
   vocabulary and no chromatic escape hatch: every chord in this program,
   wherever it came from, is still a degree of some key.

   Pure, and it stays in the harmony layer: perfecto and the type
   declarations, nothing else. It hands back RawNotes and lets its caller
   build the Score, which is what keeps core.ts out of harmony/.
   ==================================================================== */
import {
  computeVoicing,
  degreeOffsetOf,
  degreeQuality,
  chordName,
  colorationDescriptor,
  ZONE_LABEL,
  PitchClass,
  type ChordQuality,
  type Degree,
  type Inversion,
  type JoystickDirection,
  type JoystickMode,
  type Key,
  type ScaleType,
  type Voicing,
} from "./perfecto";
import type { Barline, RawNote } from "../types";

/** One harmonic state — a chord, named in theory rather than in pitches.
 *
 *  The four harmonic fields are exactly PerfState's live selection, which
 *  is deliberate: a Change is one frozen position of the same instrument,
 *  so anything that can play a chord can play a progression, and the
 *  Nashville view's vocabulary needs no translation to appear here. */
export interface Change {
  /** The key this chord is HEARD IN — usually the progression's home, and
   *  overridden for a borrowed chord, a secondary dominant, or a genuine
   *  modulation. See the header: this one field is all three. */
  readonly key: Key;
  readonly degree: Degree;
  readonly mode: JoystickMode;
  readonly direction: JoystickDirection;
  /** Default "root". Carried so an inversion drill is a progression like
   *  any other rather than a special case somewhere else. */
  readonly inversion?: Inversion;
  /** How long the chord lasts, in beats. Beats, not seconds, because a
   *  progression is written in bars and the tempo is the realizer's
   *  business — the same split core.ts makes when it resolves ticks to
   *  seconds at the parser and never mentions tempo again. */
  readonly beats: number;
  /** The analyst's name for this chord relative to HOME, when the derived
   *  numeral cannot know it. "V/V" is a fact about function that no amount
   *  of staring at a D major triad in C will recover; `homeNumeral` would
   *  honestly say "II". Absent by default — the derivation is right far
   *  more often than not, and a label on every change is a second copy of
   *  the harmony waiting to disagree with the first. */
  readonly label?: string;
}

/** An ordered run of Changes, plus what it is for. */
export interface Progression {
  /** Stable id — what a UI stores, so renaming `name` breaks no bookmark. */
  readonly id: string;
  readonly name: string;
  /** The heading it files under: "Jazz", "Blues", "Cadences", … */
  readonly family: string;
  /** One sentence on what practising it teaches. Shown, not decoration. */
  readonly about: string;
  /** The tonic everything is numbered against. `transposeTo` moves it. */
  readonly home: Key;
  readonly changes: readonly Change[];
}

/** Where one Change sits in realized score time, and which Change it is.
 *  `index` points into `Chart.changes` rather than repeating the Change,
 *  so a progression played four times over is four references to one
 *  cycle and not four copies of it — and "which bar of the loop am I in"
 *  is a fact the view can read straight off the value. */
export interface ChartEntry {
  readonly at: number;
  readonly until: number;
  readonly index: number;
}

/** The analysis that survives lowering a Progression to notes. */
export interface Chart {
  readonly home: Key;
  readonly name: string;
  readonly about: string;
  /** One cycle. What a reader sees listed; `entries` are the repeats. */
  readonly changes: readonly Change[];
  readonly entries: readonly ChartEntry[];
}

// ---------------------------------------------------------------------
// naming a Change
// ---------------------------------------------------------------------

/** The chord's root as a pitch class. The octave-wrap `degreeOffsetOf`
 *  carries for short scales is a multiple of 12 and falls out here. */
export const changeRootPc = (c: Change): number =>
  (((c.key.root + degreeOffsetOf(c.key, c.degree)) % 12) + 12) % 12;

/** Major/minor/diminished, detected by perfecto's one rule. */
export const changeQuality = (c: Change): ChordQuality => degreeQuality(c.key, c.degree);

/** "D min7" — perfecto's own chord naming, unchanged. */
export const changeName = (c: Change): string =>
  chordName(c.key, c.degree, c.mode, c.direction);

/** "dreamy" — the coloration's one-word mood. */
export const changeColor = (c: Change): string => colorationDescriptor(c.mode, c.direction);

/** "Maj 7" — the coloration's technical name. */
export const changeColorLabel = (c: Change): string => ZONE_LABEL[c.mode][c.direction];

/** The chord's pitch classes, ascending from its root. Inversion and the
 *  register anchor only ever move notes by whole octaves, so this is a
 *  property of the CHANGE and not of whichever voicing got played. */
export const changePitchClasses = (c: Change): number[] => {
  const v = voicingOf(c, 4);
  const seen = new Set<number>();
  const out: number[] = [];
  for (const p of v.notes) {
    const pc = ((p % 12) + 12) % 12;
    if (!seen.has(pc)) { seen.add(pc); out.push(pc); }
  }
  return out;
};

/** The twelve numerals, counted against the MAJOR scale of the home tonic.
 *  That reference is the Nashville number system's own — a ♭7 chord is "♭7"
 *  in every key, major or minor — and using it always means one rule rather
 *  than one per mode. In C minor the tonic triad is i and the chord on A♭ is
 *  ♭VI, which is what both a Nashville chart and a roman-numeral analysis
 *  would write.
 *
 *  ♭V rather than ♯IV where the two spellings compete: one had to be chosen,
 *  and a Change that cares says so in `label`. */
const NUMERALS = [
  "I", "♭II", "II", "♭III", "III", "IV", "♭V", "V", "♭VI", "VI", "♭VII", "VII",
];

/** The Nashville numeral for a change AS HEARD IN the home key — the whole
 *  point of the number system, and the reason a Change carries its own key
 *  rather than a raw root: modulate away and the numbers still read
 *  against the tonic you started on.
 *
 *  Case and the ° come from the chord's own quality, exactly as
 *  `degreeNumeral` does, so a change borrowed from the parallel minor
 *  looks borrowed. `label` wins outright when it is present. */
export function homeNumeral(home: Key, c: Change): string {
  if (c.label !== undefined) return c.label;
  const base = NUMERALS[(changeRootPc(c) - home.root + 12) % 12];
  const q = changeQuality(c);
  return q === "maj" ? base : q === "min" ? base.toLowerCase() : `${base.toLowerCase()}°`;
}

// ---------------------------------------------------------------------
// transposition
// ---------------------------------------------------------------------

const shiftKey = (k: Key, by: number): Key => ({ ...k, root: (((k.root + by) % 12) + 12) % 12 });

/** The same structure in another key. Every change moves by the interval
 *  the HOME moved by — including the ones that named a foreign key, which
 *  is what keeps a modulating progression's internal relationships intact
 *  instead of collapsing them onto the new tonic. */
export function transposeTo(p: Progression, root: PitchClass): Progression {
  const by = (((root - p.home.root) % 12) + 12) % 12;
  if (by === 0) return p;
  return {
    ...p,
    home: shiftKey(p.home, by),
    changes: p.changes.map((c) => ({ ...c, key: shiftKey(c.key, by) })),
  };
}

// ---------------------------------------------------------------------
// lowering: Progression -> notes + chart
// ---------------------------------------------------------------------

export interface RealizeOpts {
  /** Register of the chord voicing; the bass sits BASS_DROP octaves under
   *  it. Perfecto's own convention: 4 puts a C-major triad on middle C. */
  octave?: number;
  /** Emit the chord root as a separate lower-hand note. On by default: it
   *  is what makes the practice hand filter mean something musical here —
   *  "left hand" becomes root motion and "right hand" the voicing. */
  bass?: boolean;
  /** Seconds per beat. 0.5 = 120bpm. */
  beatSec?: number;
  /** How many times round. A cadence is two chords; practising it once is
   *  not practising it. Four passes is long enough to feel the shape and
   *  short enough that the progress rule still says something. */
  cycles?: number;
  /** Beats to a bar. The repertoire is written in common time, so a bar
   *  is four beats unless a caller says otherwise; a change that lasts
   *  eight beats is two bars, and one that lasts two is half of one. */
  beatsPerBar?: number;
}

/** Octaves between the anchor tonic and the bass root. Two, not one,
 *  because `inRegister` below lets a voicing sit up to a tritone BELOW the
 *  anchor: at one octave the bass could land inside the chord it is meant
 *  to be under, and the two hands would fight for a key. Two octaves
 *  clears that with room to spare — C2 under a chord around middle C,
 *  which is where a pianist would put them anyway. */
const BASS_DROP = 2;

const DEFAULTS = {
  octave: 4, bass: true, beatSec: 0.5, cycles: 4, beatsPerBar: 4,
} as const;

export interface Realized {
  readonly notes: readonly RawNote[];
  readonly chart: Chart;
  readonly duration: number;
  /** Bar boundaries in seconds, fence-post style, for `Core.makeScore` —
   *  the same thing a parser hands it, because a progression is a source.
   *  Each carries the meter and the home key's signature. */
  readonly barlines: readonly Barline[];
}

/** How far each scale's signature sits from the major key on its tonic:
 *  A minor and C major share one, D dorian is C major's, G mixolydian is
 *  C major's. The scales with no classical signature — pentatonic, blues
 *  — take their parent's, which prints the fewest accidentals. */
const SCALE_SHIFT: Record<ScaleType, number> = {
  major: 0, lydian: 1, mixolydian: -1, dorian: -2,
  naturalMinor: -3, harmonicMinor: -3, melodicMinor: -3,
  majorPentatonic: 0, minorPentatonic: -3, blues: -3,
};

/** The key signature for a Key, in fifths. Chosen by pitch class, so an
 *  enharmonic tonic takes the side of the circle with fewer accidentals
 *  (G♭, six flats, over F♯'s six sharps only by the tie-break below). */
export function keySignature(k: Key): number {
  // the major key on this pitch class: C=0, G=1 ... walking by fifths
  const major = ((k.root * 7) % 12 + 12) % 12;
  const f = (major > 6 ? major - 12 : major) + SCALE_SHIFT[k.scale];
  return f > 7 ? f - 12 : f < -7 ? f + 12 : f;
}

/** This change's chord, in root position at the requested register.
 *
 *  computeVoicing's own voice-leading is deliberately OFF. All it can do
 *  is move a whole chord by an octave to sit near its predecessor, and
 *  `inRegister` below already puts every chord in one octave — a stricter
 *  bound, arrived at without reference to what came before, so it cannot
 *  ratchet. Asking for both would be asking twice for the same thing and
 *  letting the second answer win. */
const voicingOf = (c: Change, octave: number): Voicing =>
  computeVoicing({
    key: c.key,
    degree: c.degree,
    joystickMode: c.mode,
    joystickDirection: c.direction,
    inversion: c.inversion ?? "root",
    octave,
    voiceLeading: false,
    previousVoicing: null,
  });

/** Slide a voicing by whole octaves so its lowest note sits as close to
 *  the anchor tonic as an octave allows — within a tritone either side.
 *  Whole octaves only, so the chord itself is untouched: this chooses a
 *  REGISTER, it never chooses notes.
 *
 *  It is also this program's voice-leading, and a better one than picking
 *  each chord's octave to suit its predecessor. A degree's root sits
 *  wherever its scale puts it, up to eleven semitones above the key root,
 *  and a greedy chord-to-chord choice compounds that: the dominant cycle
 *  climbed from C2 to A6 over twelve chords, every chord correct and the
 *  sequence unplayable. Anchoring instead bounds the whole progression to
 *  one octave of movement, which is what makes the practice view's arrows
 *  describe a hand rather than a series of leaps. */
function inRegister(v: Voicing, anchor: number): Voicing {
  const shift = Math.round((anchor - Math.min(...v.notes)) / 12) * 12;
  return shift === 0 ? v : { ...v, notes: v.notes.map((n) => n + shift) };
}

/** Lower a Progression to notes and an analysis.
 *
 *  Each change's notes end exactly where the next change's begin, so
 *  `makeSteps` sees one clean simultaneity per chord with nothing
 *  sustained across the bar line: every chord is struck fresh. That is the
 *  drill — a common tone re-attacked is still a common tone, and the
 *  arrows say so by pointing a repeat tick straight down at its own key
 *  rather than arcing nowhere. */
export function realize(p: Progression, o: RealizeOpts = {}): Realized {
  const { octave, bass, beatSec, cycles, beatsPerBar } = { ...DEFAULTS, ...o };
  const anchor = (octave + 1) * 12; // the tonic every voicing is kept near
  const notes: RawNote[] = [];
  const entries: ChartEntry[] = [];
  let t = 0;

  for (let cycle = 0; cycle < cycles; cycle++) {
    for (let i = 0; i < p.changes.length; i++) {
      const c = p.changes[i];
      const dur = c.beats * beatSec;
      const v = inRegister(voicingOf(c, octave), anchor);
      for (const pitch of v.notes) notes.push({ pitch, onset: t, duration: dur, hand: "upper" });
      if (bass)
        notes.push({
          pitch: changeRootPc(c) + (octave - BASS_DROP + 1) * 12,
          onset: t, duration: dur, hand: "lower",
        });
      entries.push({ at: t, until: t + dur, index: i });
      t += dur;
    }
  }

  // bars on the beat grid, regardless of where the changes fall: a chord
  // held for six beats crosses a barline, and the barline stays put.
  const barSec = beatsPerBar * beatSec;
  const at: number[] = [];
  for (let b = 0; b < t || at.length === 0; b += barSec) at.push(b);
  at.push(at[at.length - 1] + barSec);
  const fifths = keySignature(p.home);
  const barlines: Barline[] = at.map((b) => ({ at: b, beats: beatsPerBar, unit: 4, fifths }));

  return {
    notes,
    duration: t,
    chart: { home: p.home, name: p.name, about: p.about, changes: p.changes, entries },
    barlines,
  };
}

// ---------------------------------------------------------------------
// reading a chart
// ---------------------------------------------------------------------

/** The entry covering score time `t`, or null past the end. Half-open on
 *  the right, matching Core.activeAt — a chord that ends exactly at the
 *  next one's onset is not still sounding there. */
export function entryAt(chart: Chart, t: number): ChartEntry | null {
  return chart.entries.find((e) => t >= e.at && t < e.until) ?? null;
}

/** The entry after the one covering `t`. Null at the end, so a view that
 *  draws look-ahead has one thing to test rather than two. */
export function entryAfter(chart: Chart, t: number): ChartEntry | null {
  const i = chart.entries.findIndex((e) => t >= e.at && t < e.until);
  return i >= 0 ? chart.entries[i + 1] ?? null : null;
}

/** The Change an entry names. One lookup, written once, because `entries`
 *  holding indices rather than Changes is exactly the kind of indirection
 *  that grows a second, subtly different copy at every call site. */
export const changeOf = (chart: Chart, e: ChartEntry): Change => chart.changes[e.index];

export const Progressions = {
  realize, transposeTo, entryAt, entryAfter, changeOf,
  homeNumeral, changeName, changeColor, changeColorLabel, changeQuality,
  changeRootPc, changePitchClasses,
};
