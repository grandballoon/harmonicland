/* ====================================================================
   TO-SCORE — LilyPond's reading of a score (dump.ts) -> Score (model.ts).

   Every musical fact comes from the dump, and so from LilyPond itself:
   pitches and durations from its events, measures from its own measure
   positions and printed barlines, accidentals, beams, and ties from the
   grobs it engraved. This module only re-expresses those facts in
   notation terms MusicXML can carry. It decides nothing LilyPond had
   not already decided, and whatever it cannot place is an error or a
   recorded warning — never a silent drop.

   Order of work:
     1. staves and measures        (steps + BarLine grobs)
     2. rhythmic groups per voice  (note / rest events at one moment)
     3. MusicXML voice numbers     (per measure, stable across measures)
     4. marks and directions       (every other event, one table below)
     5. attributes and barlines    (staff states, steps, repeats)
   ==================================================================== */
import { Fraction } from "../score/fraction.ts";
import type {
  Attributes, BarStyle, Barline, Clef, Direction, DirectionContent, Item, Key, Measure, NoteGroup,
  NoteMark, PitchedNote, PrintedAccidental, Score, Step, Time, TupletMark, BeamMark,
} from "../score/model.ts";
import { cmpMoment, type EventRecord, type Moment, type Props, type ScoreDump } from "./dump.ts";
import { articulationMark, beamCount, markupMeaning, noteType, placementOf, rehearsalLetters } from "./marks.ts";

export interface SourceMeta {
  readonly title?: string;
  readonly composer?: string;
  readonly rights?: string;
  readonly source?: string;
  readonly encodingNotes: readonly string[];
}

export interface Conversion {
  readonly score: Score;
  /** Things converted with a judgement call, for the conversion report. */
  readonly warnings: readonly string[];
}

/** Events that carry nothing a MusicXML score shows, each with why. */
const IGNORED: Record<string, string> = {
  "skip-event": "a spacer: advances time only",
  "bar-check-event": "a check on the input, not notation",
  "bar-event": "the printed barline is read from BarLine grobs",
  "line-break-event": "page layout",
  "page-break-event": "page layout",
  "page-turn-event": "page layout",
  "spacing-section-event": "horizontal spacing",
  "apply-output-event": "a layout tweak",
  "staff-span-event": "starts or stops staff lines (layout)",
  "key-change-event": "keys are read from staff state",
  "reference-time-signature-event": "meters are read from timing state",
  "time-signature-event": "meters are read from timing state",
  "partial-event": "pickups are read from measure positions",
  "alternative-event": "endings are read from volta-span events",
  "volta-repeat-start-event": "repeat signs are read from BarLine grobs",
  "volta-repeat-end-event": "handled with the barline it ends at",
  "volta-span-event": "handled as endings",
  "tie-event": "ties are read from Tie grobs",
  "beam-event": "beams are read from Beam grobs",
  "beam-forbid-event": "beams are read from Beam grobs",
  "tuplet-span-event": "handled as tuplets",
};

const STEPS: readonly Step[] = ["C", "D", "E", "F", "G", "A", "B"];
const RHYTHMIC = new Set(["note-event", "rest-event", "multi-measure-rest-event"]);
const LILY_DEFAULT_TEMPO = new Fraction(15); // wholes per minute: quarter = 60

interface Group {
  readonly voice: number;
  readonly at: Moment;
  readonly events: EventRecord[];
  /** Main-time length; zero for graces. */
  readonly length: Fraction;
  readonly duration: DurationProps;
  readonly multiMeasure: boolean;
  /** Filled in as marks are read. */
  readonly chordMarks: NoteMark[];
  readonly noteMarks: NoteMark[][];
  readonly tuplets: TupletMark[];
}

interface DurationProps {
  readonly log: number;
  readonly dots: number;
  readonly factor: Fraction;
  readonly length: Fraction;
}

interface MeasureFrame {
  readonly start: Fraction;
  readonly end: Fraction;
  number: string;
  implicit: boolean;
  attributes: { keys?: Key[]; time?: Time; clefs?: Clef[] } | null;
  left?: Barline;
  right?: Barline;
  readonly items: Item[];
}

export function toScore(dump: ScoreDump, meta: SourceMeta): Conversion {
  const warnings: string[] = [];
  const where = (e: { origin: EventRecord["origin"] } | null) =>
    e?.origin ? ` (line ${e.origin.line}:${e.origin.col})` : "";

  /* ---- 1. staves and measures --------------------------------------- */

  const rhythmicEvents = dump.events.filter((e) => RHYTHMIC.has(e.class));
  const usedStaves = new Set(rhythmicEvents.map((e) => e.staff));
  const staves = dump.staves.filter((s) => usedStaves.has(s.id)).sort((a, b) => a.id - b.id);
  if (!staves.length) throw new Error("score has no notes");
  const staffNo = new Map(staves.map((s, i) => [s.id, i + 1]));
  const staffOf = (id: number | null, e?: EventRecord): number => {
    const n = id === null ? undefined : staffNo.get(id);
    if (n === undefined) throw new Error(`event on an unknown staff${where(e ?? null)}`);
    return n;
  };

  // A Dynamics context prints between or around the staves it was created
  // among: below the staff made just before it, or above the first.
  const voices = new Map(dump.voices.map((v) => [v.id, v]));
  const dynamicsPlace = (voiceId: number): { staff: number; placement: "above" | "below" } => {
    const before = staves.filter((s) => s.id < voiceId).length;
    return before === 0 ? { staff: 1, placement: "above" } : { staff: before, placement: "below" };
  };

  const steps = dump.steps;
  const stepAt = new Map<string, Props>();
  for (const s of steps) if (!stepAt.has(s.at.main.toString())) stepAt.set(s.at.main.toString(), s.props);
  const measurePos = (p: Props) => (p.measurePosition as { main: string }).main;

  let end = steps.length ? steps.at(-1)!.at.main : Fraction.ZERO;
  for (const e of rhythmicEvents) end = Fraction.max(end, e.at.main.add(lengthOf(e)));

  const startSet = new Map<string, Fraction>([["0", Fraction.ZERO]]);
  for (const s of steps) {
    if (s.at.main.isZero() || s.at.main.ge(end)) continue;
    if (s.props.timing === true && measurePos(s.props) === "0") startSet.set(s.at.main.toString(), s.at.main);
  }
  const barlines = dump.grobs.flatMap((g) => (g.grob === "BarLine" ? [g] : []));
  for (const b of barlines) {
    // An empty glyph only permits a line break; any other is a bar.
    if (b.glyph && b.at.main.gt(Fraction.ZERO) && b.at.main.lt(end)) startSet.set(b.at.main.toString(), b.at.main);
  }
  const starts = [...startSet.values()].sort((a, b) => a.cmp(b));
  const frames: MeasureFrame[] = starts.map((start, i) => ({
    start,
    end: starts[i + 1] ?? end,
    number: "",
    implicit: false,
    attributes: null,
    items: [],
  }));

  // Numbers as LilyPond counts them; a pickup is 0; a bar LilyPond did not
  // count (a split bar, a cadenza segment) is implicit.
  const seen = new Map<string, number>();
  frames.forEach((f, i) => {
    const props = stepAt.get(f.start.toString());
    const n = String(props?.currentBarNumber ?? i + 1);
    if (i === 0 && props && measurePos(props) !== "0" && props.timing === true) {
      f.number = "0";
      f.implicit = true;
      return;
    }
    const k = seen.get(n) ?? 0;
    seen.set(n, k + 1);
    f.number = k === 0 ? n : `${n}.${k}`;
    f.implicit = k > 0;
  });

  const frameIndexAt = (t: Fraction): number => {
    let lo = 0;
    let hi = frames.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (frames[mid].start.le(t)) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };

  /* ---- 2. rhythmic groups per voice ---------------------------------- */

  const key = (voice: number | null, at: Moment) => `${voice}|${at.main}|${at.grace}`;
  const groups: Group[] = [];
  const groupAt = new Map<string, Group>();
  for (const e of rhythmicEvents) {
    if (e.voice === null) throw new Error(`a note outside any voice${where(e)}`);
    const k = key(e.voice, e.at);
    let g = groupAt.get(k);
    const duration = durationOf(e);
    if (!g) {
      g = {
        voice: e.voice,
        at: e.at,
        events: [],
        length: e.at.grace.isZero() ? duration.length : Fraction.ZERO,
        duration,
        multiMeasure: e.class === "multi-measure-rest-event",
        chordMarks: [],
        noteMarks: [],
        tuplets: [],
      };
      groupAt.set(k, g);
      groups.push(g);
    } else {
      if (!g.duration.length.eq(duration.length) || g.duration.log !== duration.log || g.duration.dots !== duration.dots) {
        throw new Error(`a chord with notes of different lengths${where(e)}`);
      }
      if (e.class !== "note-event" || g.events[0].class !== "note-event") {
        throw new Error(`a rest sharing a moment with another event in one voice${where(e)}`);
      }
    }
    g.events.push(e);
    g.noteMarks.push([]);
  }
  groups.sort((a, b) => a.voice - b.voice || cmpMoment(a.at, b.at));
  const voiceGroups = new Map<number, Group[]>();
  for (const g of groups) {
    if (!voiceGroups.has(g.voice)) voiceGroups.set(g.voice, []);
    voiceGroups.get(g.voice)!.push(g);
  }

  // A LilyPond voice may overlap itself (<< a2. { s8 b4 } >> with no \\\\
  // keeps both lines in one Voice). MusicXML voices cannot, so such a voice
  // is split into lanes — the first free one for each note — and each lane
  // is written as a voice of its own. Almost always there is one lane.
  const trackOf = new Map<Group, string>();
  for (const [v, gs] of voiceGroups) {
    const laneEnds: Fraction[] = [];
    for (const g of gs) {
      let lane = laneEnds.findIndex((t) => t.le(g.at.main));
      if (lane < 0) {
        lane = laneEnds.length;
        laneEnds.push(Fraction.ZERO);
        if (lane > 0) warnings.push(`voice ${v} overlaps itself; written as ${lane + 1} MusicXML voices${where(g.events[0])}`);
      }
      laneEnds[lane] = Fraction.max(laneEnds[lane], g.at.main.add(g.length));
      trackOf.set(g, lane ? `${v}.${lane}` : `${v}`);
    }
  }
  const homeStaff = new Map<string, number>();
  for (const g of groups) {
    const t = trackOf.get(g)!;
    if (!homeStaff.has(t)) homeStaff.set(t, staffOf(g.events[0].staff, g.events[0]));
  }

  /* ---- 3. MusicXML voice numbers ------------------------------------- */

  // Staff k owns voices 4k-3 … 4k, the convention every major editor uses.
  // Within a bar, voices that sound at different times may share a number
  // (a voice that stops where a divided passage begins hands its number
  // on). A voice keeps its number from bar to bar while it is free; others
  // take the lowest free one, stems-up first.
  const voiceNumber: Map<string, number>[] = frames.map(() => new Map());
  {
    // What each voice occupies in each bar: the stretches its notes and
    // rests cover (a grace is an instant).
    type Span = [Fraction, Fraction];
    const spans: Map<string, Span[]>[] = frames.map(() => new Map());
    for (const g of groups) {
      const t = trackOf.get(g)!;
      const stop = g.at.main.add(g.length);
      for (let i = frameIndexAt(g.at.main); i < frames.length && (i === frameIndexAt(g.at.main) || frames[i].start.lt(stop)); i++) {
        const from = Fraction.max(g.at.main, frames[i].start);
        const to = Fraction.min(Fraction.max(stop, from), frames[i].end);
        if (!spans[i].has(t)) spans[i].set(t, []);
        spans[i].get(t)!.push([from, to]);
      }
    }
    const first = (xs: Span[]) => xs.reduce((m, x) => Fraction.min(m, x[0]), xs[0][0]);
    const stemRank = (t: string) => {
      const g = groups.find((x) => trackOf.get(x) === t)!;
      const s = Number(g.events[0].state.stemDirection ?? 0);
      return s > 0 ? 0 : s < 0 ? 2 : 1;
    };
    const sticky = new Map<string, number>();
    frames.forEach((f, i) => {
      const tracks = [...spans[i].keys()].sort(
        (a, b) => homeStaff.get(a)! - homeStaff.get(b)! || first(spans[i].get(a)!).cmp(first(spans[i].get(b)!)) || stemRank(a) - stemRank(b) || a.localeCompare(b),
      );
      const held = new Map<number, Span[]>();
      // Two stretches can share a voice if they do not overlap; an instant
      // (a grace) fits anywhere but strictly inside another's note.
      const inside = (p: Fraction, [a, b]: Span) => a.lt(p) && p.lt(b);
      const apart = (x: Span, y: Span) =>
        x[0].eq(x[1]) ? !inside(x[0], y) : y[0].eq(y[1]) ? !inside(y[0], x) : x[1].le(y[0]) || x[0].ge(y[1]);
      const fits = (n: number, mine: Span[]) => mine.every((x) => (held.get(n) ?? []).every((y) => apart(x, y)));
      const take = (t: string, n: number) => {
        voiceNumber[i].set(t, n);
        held.set(n, [...(held.get(n) ?? []), ...spans[i].get(t)!]);
        sticky.set(t, n);
      };
      for (const t of tracks) {
        const n = sticky.get(t);
        if (n !== undefined && fits(n, spans[i].get(t)!)) take(t, n);
      }
      for (const t of tracks) {
        if (voiceNumber[i].has(t)) continue;
        const base = (homeStaff.get(t)! - 1) * 4 + 1;
        const n = [0, 1, 2, 3].map((k) => base + k).find((x) => fits(x, spans[i].get(t)!));
        if (n === undefined) throw new Error(`more than four simultaneous voices on staff ${homeStaff.get(t)} in bar ${f.number}`);
        take(t, n);
      }
    });
  }

  /* ---- 4. marks and directions --------------------------------------- */

  const directions: { frame: number; dir: Direction }[] = [];
  const addDirection = (e: EventRecord, content: DirectionContent[], placement?: "above" | "below", tempo?: number) => {
    const i = frameIndexAt(e.at.main);
    const offset = e.at.main.sub(frames[i].start);
    const voiceRec = e.voice === null ? undefined : voices.get(e.voice);
    let staff: number;
    let voice: number | undefined;
    if (!voiceRec || voiceRec.type === "Dynamics") {
      const place = voiceRec ? dynamicsPlace(voiceRec.id) : { staff: 1, placement: "above" as const };
      staff = place.staff;
      placement ??= place.placement;
    } else {
      staff = e.staff !== null ? staffOf(e.staff, e) : homeStaff.get(`${voiceRec.id}`) ?? 1;
      voice = voiceNumber[i].get(`${voiceRec.id}`);
    }
    directions.push({ frame: i, dir: { kind: "direction", offset, voice, staff, placement, content, tempo } });
  };

  // Group lookup for an event that belongs on a note: the group at its
  // exact moment, else (a mark on a spacer) the nearest one it can mean.
  const groupFor = (e: EventRecord, side: "at" | "before" | "after"): Group | undefined => {
    if (e.voice === null) return undefined;
    const exact = groupAt.get(key(e.voice, e.at));
    if (exact && side === "at") return exact;
    const gs = voiceGroups.get(e.voice) ?? [];
    if (side === "before") return [...gs].reverse().find((g) => cmpMoment(g.at, e.at) < 0 && g.at.grace.isZero());
    if (side === "after") return gs.find((g) => cmpMoment(g.at, e.at) >= 0);
    return exact ?? gs.find((g) => cmpMoment(g.at, e.at) >= 0);
  };

  // A mark on a spacer in a voice with no note there (a helper voice, a
  // dynamics line) prints at that moment on the staff; in MusicXML it goes
  // on a note starting then on that staff — the lowest for a mark placed
  // below, else the highest. A Dynamics line's mark goes to the nearer of
  // the staves around it: the one above for ^ or neutral, below for _.
  const onStaffAt = (e: EventRecord): Group | undefined => {
    let staffId = e.staff;
    let below = placementOf(e.props.direction) === "below";
    const v = e.voice === null ? undefined : voices.get(e.voice);
    if (v?.type === "Dynamics") {
      const place = dynamicsPlace(v.id);
      const down = below && place.placement === "below" && place.staff < staves.length;
      staffId = staves[(down ? place.staff + 1 : place.staff) - 1].id;
      below = place.placement === "below" && !down;
    }
    const here = groups.filter((g) => cmpMoment(g.at, e.at) === 0 && g.events[0].staff === staffId && g.events[0].class === "note-event");
    if (!here.length) return undefined;
    const pitch = (g: Group) => Math.max(...g.events.map((ev) => height(pitchOf(ev.props.pitch))));
    here.sort((a, b) => pitch(a) - pitch(b));
    warnings.push(`${e.class} on a spacer placed on the ${below ? "lowest" : "highest"} note on its staff${where(e)}`);
    return below ? here[0] : here.at(-1);
  };

  // Failing a note starting then, the note sounding then on the staff (a
  // mark over a held note: a finger substitution, a fermata mid-note).
  const soundingOnStaff = (e: EventRecord): Group | undefined => {
    const g = groups.find(
      (x) => x.events[0].staff === e.staff && x.events[0].class === "note-event" && x.at.grace.isZero() &&
        x.at.main.lt(e.at.main) && x.at.main.add(x.length).gt(e.at.main),
    );
    if (g) warnings.push(`${e.class} on a spacer placed on the note held through it${where(e)}`);
    return g;
  };

  const needGroup = (e: EventRecord, side: "at" | "before" | "after" = "at"): Group => {
    const exact = side === "at" && e.voice !== null ? groupAt.get(key(e.voice, e.at)) : undefined;
    if (exact) return exact;
    const g = side === "at" ? onStaffAt(e) ?? soundingOnStaff(e) ?? groupFor(e, "after") : groupFor(e, side);
    if (!g) throw new Error(`${e.class} with no note to attach to${where(e)}`);
    if (side === "at" && cmpMoment(g.at, e.at) > 0) warnings.push(`${e.class} on a spacer moved to the next note in its voice${where(e)}`);
    return g;
  };

  const push = (g: Group, noteIndex: number | null, m: NoteMark) => {
    if (noteIndex === null) g.chordMarks.push(m);
    else g.noteMarks[noteIndex].push(m);
  };

  // Spanners open across events, keyed by what LilyPond itself matches on.
  // Each gets an id; the MusicXML number is the writer's to choose.
  let spannerCount = 0;
  const newSpanner = () => ++spannerCount;
  // A spanner whose start is hidden is hidden to its end: its stop is
  // consumed but not written.
  const openSlurs = new Map<string, number | "hidden">();
  const openWedges = new Map<number, { id: number; text: boolean; hidden: boolean }>(); // by voice
  const openTextSpans = new Map<number, { id: number; hidden: boolean }>();
  const openTrills = new Map<number, { id: number; hidden: boolean }>();
  const openOttava = new Map<number, { id: number; size: number; hidden: boolean }>(); // by staff

  const closeWedge = (e: EventRecord, voice: number) => {
    const w = openWedges.get(voice);
    if (!w) return;
    openWedges.delete(voice);
    if (w.hidden) return;
    addDirection(e, [w.text ? { kind: "dashes", type: "stop", id: w.id } : { kind: "wedge", type: "stop", id: w.id }]);
  };

  const pedalEvents: EventRecord[] = [];
  /** A pedal mark at `e`, drawn in the style of the press it belongs to. */
  const pedal = (e: EventRecord, type: "start" | "stop" | "change", press: EventRecord) => {
    if (press.state.hidden === true) return;
    const kind = press.class === "sostenuto-event" ? "sostenuto" : press.class === "una-corda-event" ? "una-corda" : "sustain";
    if (kind === "una-corda") {
      if (type !== "change") addDirection(e, [{ kind: "words", text: type === "start" ? "una corda" : "tre corde", italic: true }], "below");
      return;
    }
    const style = String(press.state[kind === "sostenuto" ? "pedalSostenutoStyle" : "pedalSustainStyle"] ?? "text");
    addDirection(e, [{ kind: "pedal", type, line: style !== "text", sign: style !== "bracket", pedal: kind }], "below");
  };
  const tempoMarks: { e: EventRecord; content: DirectionContent[] }[] = [];

  const handle = (e: EventRecord, noteIndex: number | null) => {
    if (e.class in IGNORED) return;
    const p = e.props;
    const hidden = e.state.hidden === true;
    const dirOf = (fallback?: "above" | "below") => placementOf(p.direction) ?? placementOf(e.state.defaultDirection) ?? fallback;
    switch (e.class) {
      case "articulation-event":
        if (!hidden) push(needGroup(e), noteIndex, articulationMark(String(p["articulation-type"]), p.direction));
        return;
      case "fingering-event": {
        if (hidden) return;
        const g = needGroup(e);
        const placement = placementOf(p.direction);
        // A chord's fingering above belongs to its top note, below to its bottom one.
        if (noteIndex === null && g.events.length > 1 && placement) {
          const heights = g.events.map((ev) => height(pitchOf(ev.props.pitch)));
          const pick = placement === "above" ? Math.max(...heights) : Math.min(...heights);
          noteIndex = heights.indexOf(pick);
        }
        const tweaked = textOf(e);
        const text = tweaked !== undefined ? markupText(tweaked) : String(p.digit ?? "");
        // "2~3" (a tied pair) is a substitution: finger 2, then 3 on the held note.
        const sub = /^(\d)\s*[~‿-]\s*(\d)$/.exec(text);
        if (sub) {
          push(g, noteIndex, { kind: "fingering", text: sub[1], placement });
          push(g, noteIndex, { kind: "fingering", text: sub[2], placement, substitution: true });
        } else {
          push(g, noteIndex, { kind: "fingering", text, placement });
        }
        return;
      }
      case "string-number-event":
        if (!hidden) throw new Error(`a visible string number on a piano score${where(e)}`);
        return;
      case "slur-event":
      case "phrasing-slur-event": {
        const k = `${e.voice}|${e.class}|${p["spanner-id"] ?? ""}`;
        if (Number(p["span-direction"]) < 0) {
          if (openSlurs.has(k)) {
            // LilyPond: "already have slur" — the second start is ignored.
            warnings.push(`${e.class} starts while one is open; ignored, as LilyPond does${where(e)}`);
            return;
          }
          if (hidden) return void openSlurs.set(k, "hidden");
          const n = newSpanner();
          openSlurs.set(k, n);
          push(needGroup(e, "at"), null, { kind: "slur", type: "start", id: n, placement: placementOf(p.direction) });
        } else {
          const n = openSlurs.get(k);
          if (n === undefined) {
            warnings.push(`${e.class} ends with none open (LilyPond ignores it too)${where(e)}`);
            return;
          }
          openSlurs.delete(k);
          if (n === "hidden") return;
          const g = groupAt.get(key(e.voice, e.at)) ?? needGroup(e, "before");
          push(g, null, { kind: "slur", type: "stop", id: n });
        }
        return;
      }
      case "arpeggio-event": {
        if (hidden) return;
        const g = needGroup(e);
        const d = Number(e.state.arpeggioDirection ?? 0);
        const mark: NoteMark = {
          kind: "arpeggiate",
          direction: d > 0 ? "up" : d < 0 ? "down" : undefined,
          number: e.state.connectArpeggios === true ? 1 : undefined,
        };
        g.noteMarks.forEach((marks) => marks.push(mark));
        return;
      }
      case "tremolo-event": {
        const g = needGroup(e);
        const strokes = Math.log2(Number(p["tremolo-type"])) - Math.max(2, g.duration.log);
        if (!Number.isInteger(strokes) || strokes < 1) throw new Error(`unreadable tremolo${where(e)}`);
        push(g, null, { kind: "tremolo", marks: strokes });
        return;
      }
      case "trill-span-event": {
        const v = e.voice!;
        if (Number(p["span-direction"]) < 0) {
          const n = newSpanner();
          openTrills.set(v, { id: n, hidden });
          if (hidden) return;
          const g = needGroup(e);
          if (!g.chordMarks.some((m) => m.kind === "ornament" && m.name === "trill-mark")) {
            g.chordMarks.push({ kind: "ornament", name: "trill-mark" });
          }
          g.chordMarks.push({ kind: "wavy-line", type: "start", id: n });
        } else {
          const open = openTrills.get(v);
          if (open === undefined) return void warnings.push(`trill span ends with none open${where(e)}`);
          openTrills.delete(v);
          if (open.hidden) return;
          // The wavy line runs through the note it was drawn over, which is
          // the last one before the stop.
          needGroup(e, "before").chordMarks.push({ kind: "wavy-line", type: "stop", id: open.id });
        }
        return;
      }
      case "glissando-event": {
        const from = needGroup(e);
        const gs = voiceGroups.get(e.voice!)!;
        const to = gs[gs.indexOf(from) + 1];
        if (!to) throw new Error(`glissando to nothing${where(e)}`);
        const n = newSpanner();
        from.chordMarks.push({ kind: "glissando", type: "start", id: n });
        to.chordMarks.push({ kind: "glissando", type: "stop", id: n });
        return;
      }
      case "absolute-dynamic-event": {
        if (e.voice !== null) closeWedge(e, e.voice);
        if (hidden) return;
        const meaning = markupMeaning(textOf(e));
        const value = meaning.kind === "dynamic" ? meaning.value : meaning.kind === "text" ? meaning.text : "";
        addDirection(e, [{ kind: "dynamics", value }], dirOf("below"));
        return;
      }
      case "crescendo-event":
      case "decrescendo-event": {
        const v = e.voice!;
        if (Number(p["span-direction"]) > 0) return closeWedge(e, v);
        closeWedge(e, v);
        const cresc = e.class === "crescendo-event";
        const spanner = e.state[cresc ? "crescendoSpanner" : "decrescendoSpanner"];
        const asText = p["span-type"] === "text" || spanner === "text";
        const n = newSpanner();
        openWedges.set(v, { id: n, text: asText, hidden });
        if (hidden) return;
        if (asText) {
          const raw = p["span-text"] ?? e.state[cresc ? "crescendoText" : "decrescendoText"];
          const t = raw ? markupMeaning(raw) : null;
          const words = t?.kind === "text" ? t.text : cresc ? "cresc." : "dim.";
          addDirection(e, [{ kind: "words", text: words, italic: true }, { kind: "dashes", type: "start", id: n }], dirOf("below"));
        } else {
          addDirection(e, [{ kind: "wedge", type: cresc ? "crescendo" : "diminuendo", id: n }], dirOf("below"));
        }
        return;
      }
      case "text-script-event":
      case "multi-measure-text-event": {
        if (hidden) return;
        const m = markupMeaning(textOf(e));
        const fallback = e.class === "multi-measure-text-event" ? "above" : "below";
        if (m.kind === "dynamic") addDirection(e, [{ kind: "dynamics", value: m.value }], dirOf(fallback));
        else if (m.kind === "segno" || m.kind === "coda") addDirection(e, [{ kind: m.kind }], dirOf("above"));
        else if (m.text) addDirection(e, [{ kind: "words", text: m.text, italic: m.italic || undefined, bold: m.bold || undefined }], dirOf(fallback));
        return;
      }
      case "text-span-event": {
        const v = e.voice!;
        if (Number(p["span-direction"]) < 0) {
          const n = newSpanner();
          openTextSpans.set(v, { id: n, hidden });
          if (hidden) return;
          const left = e.state.leftText ? markupMeaning(e.state.leftText) : null;
          const words: DirectionContent[] = left?.kind === "text" && left.text ? [{ kind: "words", text: left.text, italic: left.italic || undefined }] : [];
          addDirection(e, [...words, { kind: "dashes", type: "start", id: n }], dirOf("above"));
        } else {
          const open = openTextSpans.get(v);
          if (open === undefined) return void warnings.push(`text span ends with none open${where(e)}`);
          openTextSpans.delete(v);
          if (!open.hidden) addDirection(e, [{ kind: "dashes", type: "stop", id: open.id }]);
        }
        return;
      }
      case "sustain-event":
      case "sostenuto-event":
      case "una-corda-event":
        pedalEvents.push(e);
        return;
      case "ottava-event": {
        const staff = staffOf(e.staff, e);
        const shift = Number(p["ottava-number"]);
        const open = openOttava.get(staff);
        if (open) {
          openOttava.delete(staff);
          if (!open.hidden) addDirection(e, [{ kind: "octave-shift", type: "stop", size: open.size, id: open.id }]);
        }
        if (shift !== 0) {
          const size = Math.abs(shift) * 7 + 1;
          const n = newSpanner();
          openOttava.set(staff, { id: n, size, hidden });
          // 8va is written an octave below where it sounds: MusicXML "down".
          if (!hidden) addDirection(e, [{ kind: "octave-shift", type: shift > 0 ? "down" : "up", size, id: n }], shift > 0 ? "above" : "below");
        }
        return;
      }
      case "tempo-change-event": {
        const content: DirectionContent[] = [];
        if (p.text !== undefined && p.text !== false) {
          const m = markupMeaning(p.text);
          if (m.kind === "text" && m.text) content.push({ kind: "words", text: m.text, bold: true });
        }
        const unit = p["tempo-unit"] as { log: number; dots: number } | undefined;
        const count = p["metronome-count"];
        if (unit && count !== undefined) {
          content.push({
            kind: "metronome",
            beatUnit: noteType(unit.log),
            dots: unit.dots,
            perMinute: Array.isArray(count) ? `${count[0]}-${count[1]}` : String(count),
            hidden: e.state.tempoHideNote === true || hidden,
          });
        }
        tempoMarks.push({ e, content });
        return;
      }
      case "rehearsal-mark-event": {
        if (hidden) return;
        const label = p.label ?? e.state.rehearsalMark;
        const text = typeof label === "string" && /^\d+$/.test(label) ? rehearsalLetters(Number(label)) : markupText(label);
        addDirection(e, [{ kind: "rehearsal", text }], "above");
        return;
      }
      case "ad-hoc-mark-event": {
        if (hidden) return;
        const m = markupMeaning(p.text);
        if (m.kind === "segno" || m.kind === "coda") addDirection(e, [{ kind: m.kind }], "above");
        else if (m.kind === "text" && m.text) addDirection(e, [{ kind: "words", text: m.text, italic: m.italic || undefined, bold: m.bold || undefined }], "above");
        return;
      }
      default:
        throw new Error(`no conversion for LilyPond event ${e.class}${where(e)}`);
    }
  };

  // Marks attached inside a note (a chord's per-note fingering) are only
  // there; a single note's are also broadcast, with the engraver state the
  // note-level copy lacks. Prefer the broadcast copy, aimed at its note.
  const originKey = (o: unknown) => {
    const x = o as { file?: string; line?: number; col?: number } | null;
    return x ? `${x.file}:${x.line}:${x.col}` : "";
  };
  const broadcast = new Map<string, EventRecord>();
  const others = dump.events.filter((e) => !RHYTHMIC.has(e.class));
  for (const e of others) if (e.origin) broadcast.set(`${key(e.voice, e.at)}|${originKey(e.origin)}`, e);
  // Both kinds go through one pass in time order, since spanners (slurs,
  // hairpins …) open and close as they are met.
  const work: { e: EventRecord; noteIndex: number | null }[] = [];
  const aimed = new Map<EventRecord, number>();
  for (const g of groups) {
    g.events.forEach((ev, i) => {
      for (const art of (ev.props.articulations as Props[] | undefined) ?? []) {
        const b = broadcast.get(`${key(ev.voice, ev.at)}|${originKey(art.origin)}`);
        if (b) {
          aimed.set(b, i);
          continue;
        }
        const cls = kebab(String(art.name));
        work.push({ e: { ...ev, id: -1, class: cls, props: art, state: {} }, noteIndex: g.events.length > 1 ? i : null });
      }
    });
  }
  for (const e of others) {
    const i = aimed.get(e);
    const g = groupAt.get(key(e.voice, e.at));
    work.push({ e, noteIndex: i !== undefined && g && g.events.length > 1 ? i : null });
  }
  work.sort((a, b) => cmpMoment(a.e.at, b.e.at)); // stable: same-moment order kept
  // One mark, one handling — a spanner met twice would open twice. A
  // broadcast event is itself (its id); a note-level mark must not also
  // have been broadcast at its moment.
  const handled = new Set<string>();
  const broadcastMarks = new Set(others.map((e) => `${key(e.voice, e.at)}|${e.class}|${originKey(e.origin)}`));
  for (const { e, noteIndex } of work) {
    const k = e.id >= 0 ? `event ${e.id}` : `${key(e.voice, e.at)}|${e.class}|${originKey(e.origin)}`;
    if (handled.has(k) || (e.id < 0 && broadcastMarks.has(k))) throw new Error(`${e.class} handled twice${where(e)}`);
    handled.add(k);
    handle(e, noteIndex);
  }
  for (const [, n] of openSlurs) if (n !== "hidden") warnings.push(`a slur is never closed`);

  // Pedals, paired per context as LilyPond pairs them (each staff, each
  // Dynamics line): a release and a press at one moment are one "change",
  // and a pedal still down at the end is released at the final barline,
  // where LilyPond ends its bracket.
  const pedalLines = new Map<string, EventRecord[]>();
  for (const e of pedalEvents) {
    const k = `${e.staff}|${e.class}`;
    if (!pedalLines.has(k)) pedalLines.set(k, []);
    pedalLines.get(k)!.push(e);
  }
  for (const line of pedalLines.values()) {
    line.sort((a, b) => cmpMoment(a.at, b.at));
    let down: EventRecord | null = null;
    for (let i = 0; i < line.length; i++) {
      const e = line[i];
      const press = Number(e.props["span-direction"]) < 0;
      const next = line[i + 1];
      const change: boolean = !press && down !== null && !!next && cmpMoment(next.at, e.at) === 0 && Number(next.props["span-direction"]) < 0;
      if (change) i++;
      if (!press && down === null) {
        warnings.push(`a pedal release with no pedal down (LilyPond ignores it too)${where(e)}`);
        continue;
      }
      const shown: EventRecord = change ? line[i] : e;
      pedal(e, change ? "change" : press ? "start" : "stop", (change ? shown : press ? e : down)!);
      down = press || change ? shown : null;
    }
    if (down) pedal({ ...down, at: { main: end, grace: Fraction.ZERO } }, "stop", down);
  }

  // Tempo: printed marks from \tempo; playback from the tempo LilyPond's
  // own MIDI used, wherever it changed.
  {
    const soundAt = new Map<string, number>();
    let prev = LILY_DEFAULT_TEMPO;
    for (const s of steps) {
      const v = s.props.tempoWholesPerMinute;
      if (typeof v !== "string") continue;
      const now = Fraction.parse(v);
      if (!now.eq(prev)) soundAt.set(s.at.main.toString(), now.toNumber() * 4);
      prev = now;
    }
    for (const t of tempoMarks) {
      const k = t.e.at.main.toString();
      const tempoProp = stepAt.get(k)?.tempoWholesPerMinute;
      const sound = soundAt.get(k) ?? (t.content.some((c) => c.kind === "metronome") && typeof tempoProp === "string"
        ? Fraction.parse(tempoProp).toNumber() * 4
        : undefined);
      soundAt.delete(k);
      if (t.content.length || sound !== undefined) addDirection(t.e, t.content, "above", sound);
    }
    for (const [k, bpm] of soundAt) {
      const at = { main: Fraction.parse(k), grace: Fraction.ZERO };
      addDirection({ id: -1, voice: null, staff: null, at, class: "tempo", props: {}, state: {}, origin: null }, [], "above", bpm);
    }
  }

  /* ---- tuplets ------------------------------------------------------- */

  const tupletEvents = dump.events.filter((e) => e.class === "tuplet-span-event");
  const byVoice = new Map<number, EventRecord[]>();
  for (const e of tupletEvents) {
    if (e.voice === null) throw new Error(`tuplet outside a voice${where(e)}`);
    if (!byVoice.has(e.voice)) byVoice.set(e.voice, []);
    byVoice.get(e.voice)!.push(e);
  }
  for (const [v, es] of byVoice) {
    // At one moment, the tuplet that ends is closed before the next opens.
    es.sort((a, b) => cmpMoment(a.at, b.at) || Number(b.props["span-direction"]) - Number(a.props["span-direction"]));
    const stack: EventRecord[] = [];
    for (const e of es) {
      if (Number(e.props["span-direction"]) < 0) {
        stack.push(e);
        continue;
      }
      const start = stack.pop();
      if (!start) throw new Error(`tuplet ends with none open${where(e)}`);
      const inside = (voiceGroups.get(v) ?? []).filter(
        (g) => g.at.grace.isZero() && g.at.main.ge(start.at.main) && g.at.main.lt(e.at.main),
      );
      if (!inside.length) {
        // Over a voice of spacers LilyPond has no notes to draw a bracket
        // on, so none is printed; the scaled notes elsewhere keep their
        // time modification.
        warnings.push(`a tuplet over spacers only (LilyPond prints no bracket)${where(start)}`);
        continue;
      }
      const number = stack.length + 1;
      inside[0].tuplets.push({
        type: "start",
        number,
        actual: Number(start.props.denominator),
        normal: Number(start.props.numerator),
        hidden: start.state.hidden === true || undefined,
      });
      inside.at(-1)!.tuplets.push({ type: "stop", number });
    }
    if (stack.length) throw new Error(`tuplet never closed${where(stack[0])}`);
  }

  /* ---- grob-level decisions ------------------------------------------ */

  const accidentals = new Map<number, PrintedAccidental>();
  const ties = new Map<number, { start: boolean; stop: boolean }>();
  const tieOf = (id: number) => {
    if (!ties.has(id)) ties.set(id, { start: false, stop: false });
    return ties.get(id)!;
  };
  const beamOf = new Map<Group, BeamMark[]>();
  const groupOfEvent = new Map<number, Group>();
  for (const g of groups) for (const e of g.events) groupOfEvent.set(e.id, g);
  for (const gr of dump.grobs) {
    if (gr.grob === "Accidental" || gr.grob === "AccidentalCautionary") {
      if (gr.event === null) continue;
      accidentals.set(gr.event, {
        value: accidentalName(gr.alteration),
        cautionary: gr.grob === "AccidentalCautionary",
        parentheses: gr.grob === "AccidentalCautionary" || gr.parenthesized,
      });
    } else if (gr.grob === "AccidentalSuggestion") {
      warnings.push(`an editorial (ficta) accidental is not carried over`);
    } else if (gr.grob === "Tie") {
      if (gr.from !== null) tieOf(gr.from).start = true;
      if (gr.to !== null) tieOf(gr.to).stop = true;
    } else if (gr.grob === "Beam") {
      const stems = gr.stems.map((ids) => ids.map((id) => groupOfEvent.get(id)).find((g) => g)).filter((g): g is Group => !!g);
      const counts = stems.map((g) => beamCount(g.duration.log));
      const levels = Math.max(0, ...counts);
      stems.forEach((g, i) => {
        const marks: BeamMark[] = [];
        for (let level = 1; level <= levels; level++) {
          if (counts[i] < level) continue;
          const prev = i > 0 && counts[i - 1] >= level;
          const next = i < stems.length - 1 && counts[i + 1] >= level;
          marks.push({
            level,
            value: prev && next ? "continue" : next ? "begin" : prev ? "end" : i === 0 ? "forward hook" : "backward hook",
          });
        }
        if (marks.length) beamOf.set(g, marks);
      });
    }
  }

  /* ---- groups -> items ----------------------------------------------- */

  for (const g of groups) {
    const i = frameIndexAt(g.at.main);
    const f = frames[i];
    const first = g.events[0];
    const voice = voiceNumber[i].get(trackOf.get(g)!);
    const staff = staffOf(first.staff, first);
    if (g.multiMeasure) {
      // One whole-bar rest in every bar the multi-measure rest spans.
      let t = g.at.main;
      const stop = g.at.main.add(g.length);
      while (t.lt(stop)) {
        const k = frameIndexAt(t);
        const fk = frames[k];
        if (!t.eq(fk.start)) throw new Error(`a multi-measure rest starting mid-bar${where(first)}`);
        fk.items.push({
          kind: "group", offset: Fraction.ZERO, voice: voiceNumber[k].get(trackOf.get(g)!), staff,
          duration: fk.end.sub(fk.start), type: "whole", dots: 0, tuplets: [], beams: [], notes: [],
          rest: { measure: true }, marks: k === i ? g.chordMarks : [], hidden: first.state.hidden === true || undefined,
        });
        t = fk.end;
      }
      continue;
    }
    const notes: PitchedNote[] = first.class === "note-event"
      ? g.events.map((e, k) => {
          const p = pitchOf(e.props.pitch);
          return {
            ...p,
            staff: staffOf(e.staff, e),
            accidental: accidentals.get(e.id),
            tie: ties.get(e.id),
            marks: g.noteMarks[k],
            notehead: noteheadOf(e.state.noteHeadStyle),
          };
        })
      : [];
    const restPitch = first.class === "rest-event" && first.props.pitch ? pitchOf(first.props.pitch) : undefined;
    const factor = g.duration.factor;
    const stem = Number(first.state.stemDirection ?? 0);
    const item: NoteGroup = {
      kind: "group",
      offset: g.at.main.sub(f.start),
      voice,
      staff,
      duration: g.length,
      type: noteType(g.duration.log),
      dots: g.duration.dots,
      grace: g.at.grace.isZero() ? undefined : { slash: first.state.flagStroke === "grace", order: g.at.grace },
      timeModification: factor.eq(new Fraction(1)) ? undefined : { actual: factor.d, normal: factor.n },
      tuplets: g.tuplets,
      stem: stem > 0 ? "up" : stem < 0 ? "down" : undefined,
      beams: beamOf.get(g) ?? [],
      notes,
      rest: first.class === "note-event" ? undefined : { measure: false, display: restPitch && { step: restPitch.step, octave: restPitch.octave } },
      hidden: first.state.hidden === true || undefined,
      marks: g.chordMarks,
    };
    if (g.at.main.add(g.length).le(f.end)) {
      f.items.push(item);
      continue;
    }
    // A note LilyPond let run through a barline (a breve in 4/4, say) is
    // written as tied notes, one piece per bar, in plain note values.
    if (!factor.eq(new Fraction(1))) throw new Error(`a tuplet note crosses the barline after bar ${f.number}${where(first)}`);
    warnings.push(`a ${item.type} held across the barline after bar ${f.number} is written as tied notes${where(first)}`);
    const stop = g.at.main.add(g.length);
    const pieces: { frame: number; at: Fraction; value: { log: number; dots: number }; length: Fraction }[] = [];
    for (let t = g.at.main; t.lt(stop); ) {
      const k = frameIndexAt(t);
      const bar = Fraction.min(frames[k].end, stop);
      for (const value of spell(bar.sub(t))) {
        const length = valueLength(value);
        pieces.push({ frame: k, at: t, value, length });
        t = t.add(length);
      }
    }
    pieces.forEach((piece, n) => {
      const firstPiece = n === 0;
      const lastPiece = n === pieces.length - 1;
      const fk = frames[piece.frame];
      frames[piece.frame].items.push({
        ...item,
        offset: piece.at.sub(fk.start),
        voice: voiceNumber[piece.frame].get(trackOf.get(g)!),
        duration: piece.length,
        type: noteType(piece.value.log),
        dots: piece.value.dots,
        tuplets: firstPiece ? item.tuplets : [],
        beams: firstPiece ? item.beams : [],
        marks: firstPiece ? item.marks : [],
        notes: item.notes.map((nt) => ({
          ...nt,
          accidental: firstPiece ? nt.accidental : undefined,
          marks: firstPiece ? nt.marks : [],
          tie: {
            start: !lastPiece || !!nt.tie?.start,
            stop: !firstPiece || !!nt.tie?.stop,
          },
        })),
      });
    });
  }
  for (const { frame, dir } of directions) frames[frame].items.push(dir);

  /* ---- 5. attributes and barlines ------------------------------------ */

  // Meter, from LilyPond's timing at each bar's start.
  let lastTime = "";
  frames.forEach((f, i) => {
    const props = stepAt.get(f.start.toString());
    const sig = props?.timeSignature as [string, string] | undefined;
    if (!sig) return;
    const style = staffStateAt(dump, staves[0].id, f.start);
    const beats = Number(sig[0]);
    const beatType = Number(sig[1]);
    const symbol = style.timeSignatureStyle === "C" && beats === 4 && beatType === 4 ? "common"
      : style.timeSignatureStyle === "C" && beats === 2 && beatType === 2 ? "cut"
      : style.timeSignatureStyle === "single-number" ? "single-number"
      : undefined;
    const time: Time = { beats, beatType, symbol, hidden: style.timeSignatureHidden === true || undefined };
    const k = JSON.stringify(time);
    if (k !== lastTime || i === 0) (f.attributes ??= {}).time = time;
    lastTime = k;
  });

  // Clefs and keys, per staff, as they change. A key's mode is known only
  // once a \key has been given; before that the tonic is LilyPond's default.
  const keyGiven = new Map<number, Fraction[]>();
  for (const e of dump.events) {
    if (e.class !== "key-change-event" || e.staff === null) continue;
    if (!keyGiven.has(e.staff)) keyGiven.set(e.staff, []);
    keyGiven.get(e.staff)!.push(e.at.main);
  }
  const lastClef = new Map<number, string>();
  const lastKey = new Map<number, string>();
  const keysAt = new Map<number, Map<number, Key>>();
  for (const st of [...dump.staffStates].sort((a, b) => cmpMoment(a.at, b.at))) {
    const staff = staffNo.get(st.staff);
    if (staff === undefined) continue;
    const i = frameIndexAt(st.at.main);
    const f = frames[i];
    const atStart = st.at.main.eq(f.start);
    const clef = clefOf(st.props, staff);
    const ck = JSON.stringify(clef);
    if (clef && ck !== lastClef.get(staff)) {
      lastClef.set(staff, ck);
      if (atStart) ((f.attributes ??= {}).clefs ??= []).push(clef);
      else {
        const voice = firstVoiceOn(f.items, staff, st.at.main.sub(f.start));
        f.items.push({ kind: "clef", offset: st.at.main.sub(f.start), voice, staff, clef });
      }
    }
    const given = (keyGiven.get(st.staff) ?? []).some((t) => t.le(st.at.main));
    const key = keyOf(st.props, given);
    const kk = JSON.stringify(key);
    if (kk !== lastKey.get(staff)) {
      lastKey.set(staff, kk);
      if (!atStart) throw new Error(`a key change inside bar ${f.number}`);
      if (!keysAt.has(i)) keysAt.set(i, new Map());
      keysAt.get(i)!.set(staff, key);
    }
  }
  for (const [i, byStaff] of keysAt) {
    const ks = [...byStaff.values()];
    const modes = new Set(ks.map((k) => k.mode).filter((m) => m !== undefined));
    const f = frames[i];
    // One key for the whole part when the staves agree (a staff with no
    // \key yet agrees with any mode).
    (f.attributes ??= {}).keys = byStaff.size === staves.length && ks.every((k) => k.fifths === ks[0].fifths) && modes.size <= 1
      ? [{ fifths: ks[0].fifths, mode: [...modes][0] }]
      : [...byStaff].map(([staff, k]) => ({ ...k, staff }));
  }

  // Barlines, as printed on the top staff (the piano's staves share them).
  const glyphAt = new Map<string, { glyph: string; hidden: boolean }>();
  for (const b of barlines) {
    if (b.glyph === null) continue;
    const k = b.at.main.toString();
    if (!glyphAt.has(k) || b.staff === staves[0].id) glyphAt.set(k, { glyph: b.glyph, hidden: b.hidden });
  }
  const repeatTimes = new Map<string, number>();
  for (const e of dump.events) {
    if (e.class === "volta-repeat-end-event" && Number(e.props["repeat-count"]) > 2) {
      repeatTimes.set(e.at.main.toString(), Number(e.props["repeat-count"]));
    }
  }
  for (const [k, { glyph, hidden }] of glyphAt) {
    const t = Fraction.parse(k);
    const i = frames.findIndex((f) => f.start.eq(t));
    const before = i > 0 ? frames[i - 1] : i < 0 && t.eq(end) ? frames.at(-1) : undefined;
    const after = i >= 0 ? frames[i] : undefined;
    const bar = barlineOf(glyph, hidden);
    if (!bar) throw new Error(`no MusicXML barline for LilyPond glyph "${glyph}"`);
    if (bar.right && before) before.right = { ...bar.right, times: bar.right.repeat ? repeatTimes.get(k) : undefined };
    if (bar.left && after) after.left = bar.left;
  }

  // Endings, from LilyPond's volta spans.
  const voltas = new Map<string, EventRecord>();
  for (const e of dump.events) {
    if (e.class !== "volta-span-event") continue;
    voltas.set(`${e.at.main}|${e.props["span-direction"]}|${JSON.stringify(e.props["volta-numbers"])}`, e);
  }
  for (const e of voltas.values()) {
    const nums = (e.props["volta-numbers"] as string[]).map(Number);
    const number = nums.join(", ");
    if (Number(e.props["span-direction"]) < 0) {
      const f = frames.find((x) => x.start.eq(e.at.main));
      if (!f) throw new Error(`an ending that starts mid-bar${where(e)}`);
      f.left = { ...f.left, ending: { number, type: "start", text: voltaText(nums) } };
    } else {
      const f = frames.find((x) => x.end.eq(e.at.main));
      if (!f) throw new Error(`an ending that stops mid-bar${where(e)}`);
      const type = f.right?.repeat === "backward" ? "stop" : "discontinue";
      f.right = { ...f.right, ending: { number, type } };
    }
  }

  const measures: Measure[] = frames.map((f) => ({
    number: f.number,
    implicit: f.implicit,
    start: f.start,
    length: f.end.sub(f.start),
    attributes: f.attributes as Attributes | null,
    left: f.left,
    right: f.right,
    items: f.items,
  }));

  return {
    score: {
      title: meta.title,
      composer: meta.composer,
      rights: meta.rights,
      source: meta.source,
      encodingNotes: meta.encodingNotes,
      staves: staves.length,
      measures,
    },
    warnings,
  };
}

/* ---- helpers ------------------------------------------------------------ */

/** A length as plain note values, longest first (dots allowed), e.g.
 *  5/8 -> half + eighth. */
function spell(length: Fraction): { log: number; dots: number }[] {
  const out: { log: number; dots: number }[] = [];
  let left = length;
  while (left.gt(Fraction.ZERO)) {
    let best: { log: number; dots: number } | undefined;
    for (let log = -1; log <= 10 && !best; log++) {
      for (let dots = 3; dots >= 0 && !best; dots--) {
        if (valueLength({ log, dots }).le(left)) best = { log, dots };
      }
    }
    if (!best) throw new Error(`cannot spell a length of ${length}`);
    out.push(best);
    left = left.sub(valueLength(best));
  }
  return out;
}

/** The length of a note value, in whole notes: 1/2^log, times 2 - 1/2^dots. */
function valueLength({ log, dots }: { log: number; dots: number }): Fraction {
  const base = log >= 0 ? new Fraction(1, 2 ** log) : new Fraction(2 ** -log);
  return base.mul(new Fraction(2 ** (dots + 1) - 1, 2 ** dots));
}

function durationOf(e: EventRecord): DurationProps {
  const d = e.props.duration as { log: number; dots: number; factor: string; length: string } | undefined;
  if (!d) throw new Error(`${e.class} without a duration`);
  return { log: d.log, dots: d.dots, factor: Fraction.parse(d.factor), length: Fraction.parse(d.length) };
}

function lengthOf(e: EventRecord): Fraction {
  return e.at.grace.isZero() ? durationOf(e).length : Fraction.ZERO;
}

/** A pitch's height in semitones, for comparing which note is higher. */
function height(p: { step: Step; alter: number; octave: number }): number {
  const semis = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  return p.octave * 12 + semis[p.step] + p.alter;
}

function pitchOf(x: unknown): { step: Step; alter: number; octave: number } {
  const p = x as { octave: number; step: number; alter: string };
  // LilyPond counts octaves from the one holding middle C (c'), as 0;
  // alterations are in whole tones, MusicXML's <alter> in semitones.
  return { step: STEPS[p.step], alter: Fraction.parse(p.alter).toNumber() * 2, octave: p.octave + 4 };
}

function accidentalName(alteration: Fraction): PrintedAccidental["value"] {
  const names: Record<string, PrintedAccidental["value"]> = {
    "0": "natural", "1/2": "sharp", "-1/2": "flat", "1": "double-sharp", "-1": "flat-flat",
    "1/4": "quarter-sharp", "-1/4": "quarter-flat", "3/4": "three-quarters-sharp", "-3/4": "three-quarters-flat",
  };
  const n = names[alteration.toString()];
  if (!n) throw new Error(`no MusicXML accidental for alteration ${alteration}`);
  return n;
}

function noteheadOf(style: unknown): string | undefined {
  if (typeof style !== "string" || style === "default") return undefined;
  const map: Record<string, string> = { cross: "x", harmonic: "diamond", diamond: "diamond", triangle: "triangle", slash: "slash", xcircle: "circle-x" };
  const n = map[style];
  if (!n) throw new Error(`no MusicXML notehead for LilyPond style ${style}`);
  return n;
}

function staffStateAt(dump: ScoreDump, staffId: number, t: Fraction): Props {
  let props: Props = {};
  for (const s of dump.staffStates) {
    if (s.staff !== staffId) continue;
    if (s.at.main.gt(t)) break;
    props = s.props;
  }
  return props;
}

function clefOf(p: Props, staff: number): Clef | null {
  const glyph = p.clefGlyph;
  if (typeof glyph !== "string") return null;
  const signs: Record<string, Clef["sign"]> = { "clefs.G": "G", "clefs.F": "F", "clefs.C": "C", "clefs.percussion": "percussion" };
  const sign = signs[glyph];
  if (!sign) throw new Error(`no MusicXML clef for LilyPond ${glyph}`);
  const position = Number(p.clefPosition ?? 0);
  const transposition = Number(p.clefTransposition || 0);
  return {
    staff,
    sign,
    line: position / 2 + 3,
    octaveChange: transposition ? Math.round(transposition / 7) : undefined,
  };
}

const MAJOR_TONIC = ["Cb", "Gb", "Db", "Ab", "Eb", "Bb", "F", "C", "G", "D", "A", "E", "B", "F#", "C#"];
const MINOR_TONIC = ["Ab", "Eb", "Bb", "F", "C", "G", "D", "A", "E", "B", "F#", "C#", "G#", "D#", "A#"];

function keyOf(p: Props, given: boolean): Key {
  const alts = Array.isArray(p.keyAlterations) ? (p.keyAlterations as [unknown, string][]) : [];
  let fifths = 0;
  for (const [, alter] of alts) {
    const a = Fraction.parse(String(alter));
    if (a.eq(new Fraction(1, 2))) fifths++;
    else if (a.eq(new Fraction(-1, 2))) fifths--;
    else throw new Error(`a key signature with alteration ${a} has no fifths`);
  }
  const tonic = p.tonic as { step: number; alter: string } | undefined;
  let mode: Key["mode"];
  if (given && tonic && Math.abs(fifths) <= 7) {
    const a = Fraction.parse(tonic.alter).toNumber() * 2;
    const name = STEPS[tonic.step] + (a > 0 ? "#".repeat(a) : "b".repeat(-a));
    if (MAJOR_TONIC[fifths + 7] === name) mode = "major";
    else if (MINOR_TONIC[fifths + 7] === name) mode = "minor";
  }
  return { fifths, mode };
}

function firstVoiceOn(items: readonly Item[], staff: number, offset: Fraction): number | undefined {
  const g = items
    .filter((it): it is NoteGroup => it.kind === "group" && it.staff === staff && it.offset.ge(offset) && it.voice !== undefined)
    .sort((a, b) => a.offset.cmp(b.offset) || a.voice! - b.voice!)[0];
  return g?.voice;
}

/** A LilyPond bar glyph as the barlines either side of it. A glyph like
 *  ".|:-||" is "mid-line form - line-end form"; the mid-line form is the
 *  bar itself. */
function barlineOf(glyph: string, hidden: boolean): { left?: Barline; right?: Barline } | null {
  if (hidden) return { right: { style: "none" } };
  const g = glyph.split("-")[0];
  const styles: Record<string, BarStyle> = {
    "": "none", "|": "regular", "||": "light-light", "|.": "light-heavy", ".|": "heavy-light", ".": "heavy",
    "..": "heavy-heavy", "!": "dashed", ";": "dotted", "'": "tick", "|.|": "light-light",
  };
  if (g === "|") return {};
  if (g in styles) return { right: { style: styles[g] } };
  const endRepeat = g.startsWith(":");
  const startRepeat = g.endsWith(":");
  if (!endRepeat && !startRepeat) return null;
  return {
    right: endRepeat ? { style: "light-heavy", repeat: "backward" } : undefined,
    left: startRepeat ? { style: "heavy-light", repeat: "forward" } : undefined,
  };
}

/** Ending text as LilyPond prints it: "1.", "2.", or a run "1.–3.". */
function voltaText(nums: number[]): string {
  const sorted = [...nums].sort((a, b) => a - b);
  const contiguous = sorted.every((n, i) => i === 0 || n === sorted[i - 1] + 1);
  if (sorted.length > 2 && contiguous) return `${sorted[0]}.–${sorted.at(-1)}.`;
  return sorted.map((n) => `${n}.`).join(" ");
}

/** The text an event prints: a \tweak text wins over its own. */
function textOf(e: EventRecord): unknown {
  const tweak = ((e.props.tweaks as [string, unknown][] | undefined) ?? []).find(([k]) => k === "text" || k.endsWith(".text"));
  return tweak ? tweak[1] : e.props.text;
}

function markupText(x: unknown): string {
  if (typeof x === "string") return x;
  const m = markupMeaning(x);
  return m.kind === "text" ? m.text : "";
}

function kebab(name: string): string {
  return name.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
}
