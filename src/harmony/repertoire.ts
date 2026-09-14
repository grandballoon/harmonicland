/* ====================================================================
   REPERTOIRE — the structures themselves. Data, not mechanism: every
   Progression here is a value, and progression.ts is what knows how to
   play one. Keeping the two apart is what makes adding a new structure a
   one-entry edit rather than a code change.

   Everything is written in C and transposed on demand (`transposeTo`), so
   there is one authoritative spelling of each structure instead of twelve
   that can drift. Which C — major, natural minor, dorian, mixolydian — is
   part of the structure and stays.

   COLORATION IS PART OF THE STRUCTURE, not a decoration on top. ii–V–I
   played as plain triads is not the thing anyone practises; it is ii7 V7
   Imaj7, and a 12-bar blues is dominant sevenths the whole way down. So
   every change names a joystick cell, in the same vocabulary the Nashville
   view and the gamepad already speak. The named constants below are those
   cells with their musical names attached, which is what keeps the tables
   readable — and they are cells, not interval lists, so a colour tweak in
   perfecto.ts reaches every progression that uses it.

   ONE CELL, THREE ANSWERS. `SEVENTH` is default/right, which perfecto
   resolves by the degree's detected quality: maj7 on a major degree, min7
   on a minor one, ø7 on a diminished one. So "add sevenths throughout"
   is literally one constant applied to every change, and the ii–V–I comes
   out ii7–V7–Imaj7 without anyone spelling the qualities by hand.
   ==================================================================== */
import { PitchClass, type Degree, type Key } from "./perfecto";
import type { Change, Progression } from "./progression";

// ---------- keys, written once ----------
const maj = (root: PitchClass): Key => ({ root, scale: "major" });
const min = (root: PitchClass): Key => ({ root, scale: "naturalMinor" });

const C = maj(PitchClass.C);
const Cm = min(PitchClass.C);
const Cdor: Key = { root: PitchClass.C, scale: "dorian" };
const Cmix: Key = { root: PitchClass.C, scale: "mixolydian" };
const Clyd: Key = { root: PitchClass.C, scale: "lydian" };
const Charm: Key = { root: PitchClass.C, scale: "harmonicMinor" };

// ---------- colorations, by their musical names ----------
type Color = Pick<Change, "mode" | "direction">;

/** The plain triad — the base cell. */
const TRIAD: Color = { mode: "default", direction: "center" };
/** The DIATONIC seventh: maj7 / min7 / ø7 by the degree's own quality. */
const SEVENTH: Color = { mode: "default", direction: "right" };
/** A dominant seventh, forced regardless of the degree's quality. */
const DOM7: Color = { mode: "default", direction: "upRight" };
const DOM9: Color = { mode: "extended", direction: "upRight" };
const DOM13: Color = { mode: "chromatic", direction: "upRight" };
const DOM7b9: Color = { mode: "chromatic", direction: "downLeft" };
const ALT: Color = { mode: "chromatic", direction: "downRight" };
const HALFDIM7: Color = { mode: "extended", direction: "upLeft" };
const MINMAJ7: Color = { mode: "chromatic", direction: "up" };
const SUS4: Color = { mode: "default", direction: "down" };
const ADD9: Color = { mode: "default", direction: "downRight" };
const SIXTH: Color = { mode: "default", direction: "downLeft" };
const SIX9: Color = { mode: "chromatic", direction: "right" };
const MAJ13: Color = { mode: "chromatic", direction: "down" };
const AUG: Color = { mode: "default", direction: "upLeft" };

// ---------- one change ----------
interface Opt {
  /** Heard in another key: a borrowed chord, a secondary dominant, a
   *  modulation. See progression.ts — the same field does all three. */
  key?: Key;
  color?: Color;
  inversion?: Change["inversion"];
  label?: string;
}

/** `at(home)` gives a change-builder bound to a progression's home key, so
 *  the tables below read as the numerals a musician would write. */
const at = (home: Key) =>
  (degree: Degree, beats: number, o: Opt = {}): Change => {
    const { mode, direction } = o.color ?? TRIAD;
    return {
      key: o.key ?? home,
      degree, mode, direction, beats,
      ...(o.inversion && { inversion: o.inversion }),
      ...(o.label && { label: o.label }),
    };
  };

/** A chord named by its ROOT rather than by a degree of home — how a
 *  borrowed or chromatic chord is said in this model: it is degree I of
 *  its own key, and `homeNumeral` counts it back against home. `on` gives
 *  it a major quality and `onMin` a minor one, since the quality is
 *  DETECTED from the key it is placed in and degree I of a major key is
 *  the only reliable way to say "a major chord on this root". */
const on = (root: PitchClass, beats: number, o: Opt = {}): Change =>
  at(maj(root))(1, beats, o);
const onMin = (root: PitchClass, beats: number, o: Opt = {}): Change =>
  at(min(root))(1, beats, o);

const p = (
  id: string, name: string, family: string, about: string,
  home: Key, changes: readonly Change[],
): Progression => ({ id, name, family, about, home, changes });

// =====================================================================
// NUMBER LADDER (MAJOR KEY) — before the atoms, the alphabet. Not a
// progression anyone plays: the seven chords a major key is made of, in
// order, so the numbers stop being notation and become seven shapes under
// the hand.
//
// The tonic is always MAJOR, and that is the whole reason this family is
// marked "major key" in the picker. Nashville numbers are relative to a
// KEY, not to a chord, so "the seven numbers above this root" is only
// well-defined once the root's scale is declared — and declaring it major
// is what makes the ladder read 1 2m 3m 4 5 6m 7° in all twelve keys,
// which is the entire point of the number system. Choose the root with
// the key selector; C is the default because C major is the one key where
// the seven chords are also the seven white-key triads, so the shape you
// are taught ("three keys with a gap between each") and the key you are
// taught it in agree exactly. Every other root keeps the numbers and
// gives up the white keys — that trade is the lesson.
//
// The other reading — keep the white keys and let the tonic move, which
// makes D dorian out of the same seven chords and renumbers them
// 1m 2m ♭3 4 5m 6° ♭7 — is a DIFFERENT family and is not here yet.
// =====================================================================
const ladders: Progression[] = (() => {
  const c = at(C);
  /** One rung: the number, then home again. */
  const rung = (degree: Degree): Change[] => [c(degree, 4), c(1, 4)];
  return [
    p("ladder-major", "The ladder · 1 up to 7", "Number ladder · major key",
      "The tonic triad, then every number above it in order: 1 2m 3m 4 5 6m 7°, and home. Three keys with a gap between each, walked up the scale.",
      C, [c(1, 8), c(2, 4), c(3, 4), c(4, 4), c(5, 4), c(6, 4), c(7, 4), c(1, 8)]),
    p("ladder-major-home", "Each number, back to 1", "Number ladder · major key",
      "The same seven chords, each one answered by the tonic. A number is not a chord — it is a distance from home, and hearing it return is how that distance becomes audible.",
      C, [c(1, 8), ...([2, 3, 4, 5, 6, 7] as Degree[]).flatMap(rung)]),
  ];
})();

// =====================================================================
// CADENCES — the atoms. Two chords each, so the transformation IS the
// whole lesson and there is nowhere for the ear to hide.
// =====================================================================
const cadences: Progression[] = (() => {
  const c = at(C);
  const m = at(Cm);
  return [
    p("authentic", "Authentic cadence", "Cadences",
      "V→I: the leading tone rising a semitone into the tonic. The strongest ending in the language.",
      C, [c(5, 4, { color: DOM7 }), c(1, 4)]),
    p("plagal", "Plagal cadence", "Cadences",
      "IV→I, the 'amen'. No leading tone, so it settles rather than resolves.",
      C, [c(4, 4), c(1, 4)]),
    p("deceptive", "Deceptive cadence", "Cadences",
      "V→vi: everything about the V says tonic, and the bass goes up a step instead.",
      C, [c(5, 4, { color: DOM7 }), c(6, 4)]),
    p("half", "Half cadence", "Cadences",
      "I→IV→V, stopping ON the dominant. An unfinished sentence — feel how it wants to continue.",
      C, [c(1, 4), c(4, 4), c(5, 8, { color: DOM7 })]),
    p("picardy", "Picardy third", "Cadences",
      "A minor piece ending on a MAJOR tonic. The one change is the third, and it changes everything.",
      Cm, [m(4, 4), on(PitchClass.G, 4, { color: DOM7, label: "V7" }),
           on(PitchClass.C, 8, { label: "I" })]),
  ];
})();

// =====================================================================
// SONG LOOPS — the four-bar cells most popular music is built from.
// =====================================================================
const loops: Progression[] = (() => {
  const c = at(C);
  return [
    p("four-chords", "The four chords", "Song loops",
      "I–V–vi–IV. Hundreds of hit songs, one loop. Learn it in every key and you can busk anything.",
      C, [c(1, 4), c(5, 4), c(6, 4), c(4, 4)]),
    p("axis", "Axis (vi first)", "Song loops",
      "vi–IV–I–V: the same four chords rotated to start on the relative minor. Same notes, different world.",
      C, [c(6, 4), c(4, 4), c(1, 4), c(5, 4)]),
    p("doo-wop", "50s / doo-wop", "Song loops",
      "I–vi–IV–V. The other four-chord loop, and the one that sounds like 1957.",
      C, [c(1, 4), c(6, 4), c(4, 4), c(5, 4)]),
    p("three-chord", "Three chords", "Song loops",
      "I–IV–V–I: tonic, subdominant, dominant. Everything else in tonal harmony is a comment on these three.",
      C, [c(1, 4), c(4, 4), c(5, 4), c(1, 4)]),
    p("pachelbel", "Pachelbel", "Song loops",
      "I–V–vi–iii–IV–I–IV–V. A descending bass line that has outlived every genre it was borrowed into.",
      C, [c(1, 4), c(5, 4), c(6, 4), c(3, 4), c(4, 4), c(1, 4), c(4, 4), c(5, 4)]),
    p("lament", "Lament bass", "Song loops",
      "i–V6–♭VI–V7: a bass falling by semitone under the harmony. The ground of every passacaglia and half the ballads since.",
      Cm, [at(Cm)(1, 4), on(PitchClass.G, 4, { inversion: "first", label: "V6" }),
           on(PitchClass.Gs, 4, { label: "♭VI" }), on(PitchClass.G, 4, { color: DOM7, label: "V7" })]),
  ];
})();

// =====================================================================
// BLUES — twelve bars is a FORM, not a loop: the ear has to hold the
// whole shape, which is exactly what a step cursor is good at teaching.
// =====================================================================
const blues: Progression[] = (() => {
  const I = (b: number, color: Color = DOM7) => on(PitchClass.C, b, { color, label: "I7" });
  const IV = (b: number, color: Color = DOM7) => on(PitchClass.F, b, { color, label: "IV7" });
  const V = (b: number, color: Color = DOM7) => on(PitchClass.G, b, { color, label: "V7" });
  const m = at(Cm);
  return [
    p("blues-12", "12-bar blues", "Blues",
      "Quick change: I7 IV7 I7 I7 · IV7 IV7 I7 I7 · V7 IV7 I7 V7. Dominant sevenths the whole way down.",
      C, [I(4), IV(4), I(4), I(4), IV(4), IV(4), I(4), I(4), V(4), IV(4), I(4), V(4)]),
    p("blues-8", "8-bar blues", "Blues",
      "The compressed form: I7 V7 IV7 IV7 · I7 V7 I7 V7. Half the bars, all of the shape.",
      C, [I(4), V(4), IV(4), IV(4), I(4), V(4), I(4), V(4)]),
    p("blues-minor", "Minor blues", "Blues",
      "i7 through, with a ♭VI7–V7 turnaround. Same twelve bars, none of the brightness.",
      Cm, [m(1, 4, { color: SEVENTH }), m(1, 4, { color: SEVENTH }), m(1, 4, { color: SEVENTH }), m(1, 4, { color: SEVENTH }),
           m(4, 4, { color: SEVENTH }), m(4, 4, { color: SEVENTH }), m(1, 4, { color: SEVENTH }), m(1, 4, { color: SEVENTH }),
           on(PitchClass.Gs, 4, { color: DOM7, label: "♭VI7" }), on(PitchClass.G, 4, { color: DOM7b9, label: "V7♭9" }),
           m(1, 4, { color: SEVENTH }), on(PitchClass.G, 4, { color: DOM7b9, label: "V7♭9" })]),
    p("blues-jazz", "Jazz blues", "Blues",
      "The bebop reading of twelve bars: a ii–V in bar 9 and a turnaround at the end.",
      C, [I(4, DOM9), IV(4), I(4, DOM9),
          onMin(PitchClass.G, 2, { color: SEVENTH, label: "v7" }), I(2, DOM7),
          IV(4), on(PitchClass.Fs, 4, { color: HALFDIM7, label: "♯iv°7" }),
          I(4, DOM9), on(PitchClass.A, 4, { color: DOM7b9, label: "VI7♭9" }),
          at(C)(2, 4, { color: SEVENTH }), at(C)(5, 4, { color: DOM13 }),
          I(4, DOM9), at(C)(5, 4, { color: ALT, label: "V7alt" })]),
  ];
})();

// =====================================================================
// JAZZ — where the number system earns its keep, because the chords stop
// being diatonic and the numbers are the only thing that stays still.
// =====================================================================
const jazz: Progression[] = (() => {
  const c = at(C);
  const m = at(Cm);
  /** One ii–V–I in `key`, as three changes. The unit the whole idiom is
   *  assembled from, so it is written once and reused. */
  const twoFiveOne = (root: PitchClass, beats = 4): Change[] => {
    const k = maj(root);
    const b = at(k);
    return [b(2, beats, { color: SEVENTH }), b(5, beats, { color: DOM7 }), b(1, beats, { color: SEVENTH })];
  };
  return [
    p("ii-V-I", "ii–V–I", "Jazz",
      "ii7–V7–Imaj7. The sentence jazz is written in. Watch the 3rds and 7ths slide by semitone.",
      C, [c(2, 4, { color: SEVENTH }), c(5, 4, { color: DOM7 }), c(1, 8, { color: SEVENTH })]),
    p("ii-V-i", "Minor ii–V–i", "Jazz",
      "iiø7–V7♭9–i(maj7). The half-diminished ii and the flat nine are what make it minor rather than sad major.",
      Cm, [m(2, 4, { color: HALFDIM7 }), on(PitchClass.G, 4, { color: DOM7b9, label: "V7♭9" }),
           m(1, 8, { color: MINMAJ7 })]),
    p("turnaround", "I–vi–ii–V turnaround", "Jazz",
      "The last two bars of a thousand standards, sending you back to the top.",
      C, [c(1, 4, { color: SEVENTH }), c(6, 4, { color: SEVENTH }), c(2, 4, { color: SEVENTH }), c(5, 4, { color: DOM7 })]),
    p("ii-V-chain", "ii–V chain (whole steps)", "Jazz",
      "ii–V in C, then B♭, then A♭, then G♭. The drill that makes the shape portable instead of memorised.",
      C, [
        ...twoFiveOne(PitchClass.C, 2).slice(0, 2), ...twoFiveOne(PitchClass.As, 2).slice(0, 2),
        ...twoFiveOne(PitchClass.Gs, 2).slice(0, 2), ...twoFiveOne(PitchClass.Fs, 2).slice(0, 2),
      ]),
    p("tritone-sub", "Tritone substitution", "Jazz",
      "ii7–♭II7–Imaj7. Swap the V for the dominant a tritone away: same guide tones, chromatic bass.",
      C, [c(2, 4, { color: SEVENTH }), on(PitchClass.Cs, 4, { color: DOM7, label: "♭II7" }),
          c(1, 8, { color: SEVENTH })]),
    p("backdoor", "Backdoor cadence", "Jazz",
      "Imaj7–iv7–♭VII7–Imaj7. Resolving to the tonic from BELOW, borrowed out of the parallel minor.",
      C, [c(1, 4, { color: SEVENTH }), at(Cm)(4, 4, { color: SEVENTH, label: "iv7" }),
          on(PitchClass.As, 4, { color: DOM7, label: "♭VII7" }), c(1, 4, { color: SEVENTH })]),
    p("coltrane", "Coltrane changes", "Jazz",
      "Three tonics a major third apart, each reached by its own V7. The cycle that broke ii–V–I open.",
      C, [
        on(PitchClass.C, 2, { color: SEVENTH, label: "Imaj7" }), on(PitchClass.Ds, 2, { color: DOM7, label: "V7/♭VI" }),
        on(PitchClass.Gs, 2, { color: SEVENTH, label: "♭VImaj7" }), on(PitchClass.B, 2, { color: DOM7, label: "V7/III" }),
        on(PitchClass.E, 4, { color: SEVENTH, label: "IIImaj7" }),
        on(PitchClass.G, 2, { color: DOM7, label: "V7" }), on(PitchClass.C, 2, { color: SEVENTH, label: "Imaj7" }),
      ]),
    p("rhythm-a", "Rhythm changes (A)", "Jazz",
      "I–vi–ii–V twice, then I–I7–IV–iv. The other form every jazz musician is expected to know cold.",
      C, [
        c(1, 2, { color: SIXTH }), c(6, 2, { color: SEVENTH }), c(2, 2, { color: SEVENTH }), c(5, 2, { color: DOM7 }),
        c(1, 2, { color: SIXTH }), c(6, 2, { color: SEVENTH }), c(2, 2, { color: SEVENTH }), c(5, 2, { color: DOM7 }),
        c(1, 4, { color: SEVENTH }), on(PitchClass.C, 4, { color: DOM7, label: "I7" }),
        c(4, 4, { color: SEVENTH }), at(Cm)(4, 4, { color: SEVENTH, label: "iv7" }),
      ]),
  ];
})();

// =====================================================================
// MODAL — progressions with no leading tone and nowhere to cadence, held
// together by colour instead of by pull. The ear has to learn a different
// question: not "where is this going" but "what is this made of".
// =====================================================================
const modal: Progression[] = [
  p("dorian-vamp", "Dorian vamp", "Modal",
    "i–IV, forever. The major IV over a minor tonic is the whole sound of dorian.",
    Cdor, [at(Cdor)(1, 8, { color: SEVENTH }), at(Cdor)(4, 8, { color: DOM7 })]),
  p("mixolydian", "Mixolydian", "Modal",
    "I–♭VII–IV–I. A major tonic with a flat seventh: rock, folk, and every modal jam.",
    Cmix, [at(Cmix)(1, 4), on(PitchClass.As, 4, { label: "♭VII" }), at(Cmix)(4, 4), at(Cmix)(1, 4)]),
  p("aeolian", "Aeolian", "Modal",
    "i–♭VI–♭VII–i. Natural minor with no raised leading tone — the descent is the point.",
    Cm, [at(Cm)(1, 4), at(Cm)(6, 4), at(Cm)(7, 4), at(Cm)(1, 4)]),
  p("andalusian", "Andalusian cadence", "Modal",
    "i–♭VII–♭VI–V. A stepwise fall to a MAJOR dominant. Flamenco, and half of Western pop's darker corners.",
    Cm, [at(Cm)(1, 4), at(Cm)(7, 4), at(Cm)(6, 4), on(PitchClass.G, 4, { label: "V" })]),
  p("lydian", "Lydian", "Modal",
    "I–II. Major with a raised fourth, and a major II chord that belongs to no major key.",
    Clyd, [at(Clyd)(1, 8, { color: MAJ13 }), at(Clyd)(2, 8, { color: SEVENTH })]),
  p("phrygian", "Phrygian", "Modal",
    "i–♭II. The flat second falling into the tonic — the darkest step in the system.",
    Cm, [at(Cm)(1, 8), on(PitchClass.Cs, 8, { label: "♭II" })]),
];

// =====================================================================
// DRILLS — not music, exercises. Each isolates ONE variable and moves it,
// which is the thing a step-by-step view can do that a recording cannot.
// =====================================================================
const drills: Progression[] = (() => {
  const c = at(C);
  const DIRS: Change["direction"][] = [
    "center", "up", "upRight", "right", "downRight", "down", "downLeft", "left", "upLeft",
  ];
  const tour = (mode: Change["mode"]): Change[] =>
    DIRS.map((direction) => c(1, 4, { color: { mode, direction } }));
  return [
    p("circle-diatonic", "Circle of fifths (diatonic)", "Drills",
      "I–IV–vii°–iii–vi–ii–V–I: every chord in the key, each a fourth above the last. The whole key in one lap.",
      C, [c(1, 4), c(4, 4), c(7, 4), c(3, 4), c(6, 4), c(2, 4), c(5, 4), c(1, 4)]),
    p("dominant-cycle", "Dominant cycle", "Drills",
      "Twelve dominant sevenths falling in fourths, back to where you started. The best voice-leading drill there is.",
      C, [
        PitchClass.C, PitchClass.F, PitchClass.As, PitchClass.Ds, PitchClass.Gs, PitchClass.Cs,
        PitchClass.Fs, PitchClass.B, PitchClass.E, PitchClass.A, PitchClass.D, PitchClass.G,
      ].map((root) => on(root, 2, { color: DOM7 }))),
    p("secondary-dominants", "Secondary dominants", "Drills",
      "I–V/ii–ii–V/V–V–I. Borrow a dominant to point at a chord that is not the tonic.",
      C, [
        c(1, 4), on(PitchClass.A, 4, { color: DOM7, label: "V7/ii" }), c(2, 4, { color: SEVENTH }),
        on(PitchClass.D, 4, { color: DOM7, label: "V7/V" }), c(5, 4, { color: DOM7 }), c(1, 4),
      ]),
    p("modal-interchange", "Modal interchange", "Drills",
      "I–iv–♭VI–♭VII–I: four chords lifted out of the parallel minor and dropped into a major key.",
      C, [c(1, 4), at(Cm)(4, 4, { label: "iv" }), on(PitchClass.Gs, 4, { label: "♭VI" }),
          on(PitchClass.As, 4, { label: "♭VII" }), c(1, 4)]),
    p("inversions", "Inversion drill", "Drills",
      "One chord, three shapes. Root, first, second, root — the bass moves, the harmony does not.",
      C, [c(1, 4, { inversion: "root" }), c(1, 4, { inversion: "first" }),
          c(1, 4, { inversion: "second" }), c(1, 4, { inversion: "root" })]),
    p("color-default", "Coloration tour · default", "Drills",
      "The tonic through all nine cells of the default joystick ring. Learn what each direction FEELS like.",
      C, tour("default")),
    p("color-extended", "Coloration tour · extended", "Drills",
      "The same nine directions in extended mode: ninths, elevenths, and the sound of more notes.",
      C, tour("extended")),
    p("color-chromatic", "Coloration tour · chromatic", "Drills",
      "The chromatic ring: thirteenths, altered dominants, and the maj7♯11. The far end of the vocabulary.",
      C, tour("chromatic")),
    p("harmonic-minor", "Harmonic minor cadence", "Drills",
      "i–iv–V7–i with the raised seventh. The one alteration that gives minor a real leading tone.",
      Charm, [at(Charm)(1, 4), at(Charm)(4, 4), at(Charm)(5, 4, { color: DOM7 }), at(Charm)(1, 4)]),
    p("suspensions", "Suspension and release", "Drills",
      "Isus4→I, then Vsus4→V7. Hear the fourth lean on the third and let go.",
      C, [c(1, 4, { color: SUS4 }), c(1, 4, { color: ADD9 }),
          c(5, 4, { color: SUS4 }), c(5, 4, { color: DOM7 })]),
    p("augmented-lift", "Augmented lift", "Drills",
      "I–I+–I6–I6/9: one inner voice climbing while everything around it holds still.",
      C, [c(1, 4), c(1, 4, { color: AUG }), c(1, 4, { color: SIXTH }), c(1, 4, { color: SIX9 })]),
  ];
})();

/** Every structure, in the order a UI should list them: the alphabet
 *  first, then the atoms, then the forms built from them, then the
 *  exercises. */
export const REPERTOIRE: readonly Progression[] = [
  ...ladders, ...cadences, ...loops, ...blues, ...jazz, ...modal, ...drills,
];

/** The families, in list order and each named once. Derived rather than
 *  declared, so a new progression cannot introduce a heading that the
 *  picker does not show. */
export const FAMILIES: readonly string[] = [...new Set(REPERTOIRE.map((x) => x.family))];

export const progressionById = (id: string): Progression | undefined =>
  REPERTOIRE.find((x) => x.id === id);
