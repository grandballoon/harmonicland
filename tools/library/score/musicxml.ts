/* ====================================================================
   MUSICXML — Score (model.ts) -> MusicXML 4.0 partwise text.

   Pure serialization: every musical decision was made by the converter
   that built the Score. This module only chooses <divisions> (the
   least common multiple that makes every duration an integer), orders
   each measure's items into voice streams joined by <backup>/<forward>,
   numbers spanners (readers pair slur, wedge … numbers in document
   order, which only this module knows), and writes elements in the
   order the MusicXML schema requires.
   Output is deterministic: the same Score always yields the same bytes.
   ==================================================================== */
import { Fraction, lcm } from "./fraction.ts";
import type {
  Attributes, Barline, Clef, Direction, DirectionContent, Item, Measure, NoteGroup,
  NoteMark, PitchedNote, Score,
} from "./model.ts";

const QUARTER = new Fraction(1, 4);

export function toMusicXml(score: Score): string {
  const divisions = divisionsFor(score);
  const num = numberSpanners(score);
  const dur = (f: Fraction): number => {
    const q = f.div(QUARTER).mul(new Fraction(divisions));
    if (q.d !== 1) throw new Error(`duration ${f} is not a whole number of divisions (${divisions})`);
    return q.n;
  };
  const out: string[] = [];
  const w = (s: string) => out.push(s);

  w(`<?xml version="1.0" encoding="UTF-8" standalone="no"?>`);
  w(`<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">`);
  w(`<score-partwise version="4.0">`);
  if (score.title || score.subtitle) {
    w(`  <work>`);
    if (score.subtitle) w(`    <work-number>${esc(score.subtitle)}</work-number>`);
    if (score.title) w(`    <work-title>${esc(score.title)}</work-title>`);
    w(`  </work>`);
  }
  if (score.movement) w(`  <movement-title>${esc(score.movement)}</movement-title>`);
  w(`  <identification>`);
  if (score.composer) w(`    <creator type="composer">${esc(score.composer)}</creator>`);
  if (score.arranger) w(`    <creator type="arranger">${esc(score.arranger)}</creator>`);
  if (score.rights) w(`    <rights>${esc(score.rights)}</rights>`);
  w(`    <encoding>`);
  w(`      <software>harmonicland tools/library</software>`);
  w(`      <supports element="accidental" type="yes"/>`);
  w(`      <supports element="beam" type="yes"/>`);
  w(`      <supports element="stem" type="yes"/>`);
  for (const note of score.encodingNotes) w(`      <encoding-description>${esc(note)}</encoding-description>`);
  w(`    </encoding>`);
  if (score.source) w(`    <source>${esc(score.source)}</source>`);
  w(`  </identification>`);
  w(`  <part-list>`);
  w(`    <score-part id="P1">`);
  w(`      <part-name>Piano</part-name>`);
  w(`    </score-part>`);
  w(`  </part-list>`);
  w(`  <part id="P1">`);

  score.measures.forEach((m, i) => {
    w(`    <measure number="${esc(m.number)}"${m.implicit ? ` implicit="yes"` : ""}>`);
    if (i === 0 || m.attributes) writeAttributes(w, m.attributes, i === 0 ? { divisions, staves: score.staves } : null);
    if (m.left) writeBarline(w, "left", m.left);
    writeStreams(w, m, dur, num);
    if (m.right) writeBarline(w, "right", m.right);
    w(`    </measure>`);
  });

  w(`  </part>`);
  w(`</score-partwise>`);
  return out.join("\n") + "\n";
}

/** The smallest number of divisions per quarter that makes every offset,
 *  duration, and measure length an integer. */
function divisionsFor(score: Score): number {
  let d = 1;
  const take = (f: Fraction) => (d = lcm(d, f.div(QUARTER).d));
  for (const m of score.measures) {
    take(m.length);
    for (const it of m.items) {
      take(it.offset);
      if (it.kind === "group") take(it.duration);
    }
  }
  return d;
}

function writeAttributes(
  w: (s: string) => void,
  a: Attributes | null,
  first: { divisions: number; staves: number } | null,
): void {
  w(`      <attributes>`);
  if (first) w(`        <divisions>${first.divisions}</divisions>`);
  for (const k of a?.keys ?? []) {
    w(`        <key${k.staff ? ` number="${k.staff}"` : ""}>`);
    w(`          <fifths>${k.fifths}</fifths>`);
    if (k.mode) w(`          <mode>${k.mode}</mode>`);
    w(`        </key>`);
  }
  if (a?.time) {
    const t = a.time;
    w(`        <time${t.symbol ? ` symbol="${t.symbol}"` : ""}${t.hidden ? ` print-object="no"` : ""}>`);
    w(`          <beats>${t.beats}</beats>`);
    w(`          <beat-type>${t.beatType}</beat-type>`);
    w(`        </time>`);
  }
  if (first) w(`        <staves>${first.staves}</staves>`);
  for (const c of a?.clefs ?? []) writeClef(w, c, "        ");
  w(`      </attributes>`);
}

function writeClef(w: (s: string) => void, c: Clef, pad: string): void {
  w(`${pad}<clef number="${c.staff}">`);
  w(`${pad}  <sign>${c.sign}</sign>`);
  w(`${pad}  <line>${c.line}</line>`);
  if (c.octaveChange) w(`${pad}  <clef-octave-change>${c.octaveChange}</clef-octave-change>`);
  w(`${pad}</clef>`);
}

function writeBarline(w: (s: string) => void, location: "left" | "right", b: Barline): void {
  w(`      <barline location="${location}">`);
  if (b.style) w(`        <bar-style>${b.style}</bar-style>`);
  if (b.ending) {
    const e = b.ending;
    const text = e.text !== undefined ? `>${esc(e.text)}</ending>` : `/>`;
    w(`        <ending number="${esc(e.number)}" type="${e.type}"${text}`);
  }
  if (b.repeat) w(`        <repeat direction="${b.repeat}"${b.times ? ` times="${b.times}"` : ""}/>`);
  w(`      </barline>`);
}

/* ---- the measure's content, voice by voice -------------------------- */

/** Within one offset: clef first, then directions, then graces in order,
 *  then the main note — the order a reader must meet them in. */
function rank(it: Item): number {
  if (it.kind === "clef") return 0;
  if (it.kind === "direction") return 1;
  return it.grace ? 2 : 3;
}

function byTime(a: Item, b: Item): number {
  const c = a.offset.cmp(b.offset);
  if (c) return c;
  const r = rank(a) - rank(b);
  if (r) return r;
  if (a.kind === "group" && b.kind === "group" && a.grace && b.grace) return a.grace.order.cmp(b.grace.order);
  return 0;
}

/** A measure's items as they are written: voice by voice in voice order,
 *  voiceless items last, each stream in time order. */
function streamsOf(m: Measure): { voice: number | undefined; items: Item[] }[] {
  const streams = new Map<number, Item[]>();
  for (const it of m.items) {
    const key = it.voice ?? Number.MAX_SAFE_INTEGER; // voiceless items last
    if (!streams.has(key)) streams.set(key, []);
    streams.get(key)!.push(it);
  }
  return [...streams]
    .sort((a, b) => a[0] - b[0])
    .map(([key, items]) => ({ voice: key === Number.MAX_SAFE_INTEGER ? undefined : key, items: items.sort(byTime) }));
}

type SpannerKind = "slur" | "wavy-line" | "glissando" | "wedge" | "dashes" | "octave-shift";
type Numbering = (kind: SpannerKind, id: number) => number;

/** MusicXML numbers for every spanner, lowest free first, in the order a
 *  reader meets them. At one note or direction the spanners it starts are
 *  numbered before the ones it stops are freed, so a slur that ends where
 *  the next begins never shares its number with it. */
function numberSpanners(score: Score): Numbering {
  const given = new Map<string, number>();
  const open = new Map<SpannerKind, Set<number>>();
  let where = "";
  const visit = (marks: readonly { kind: string; type?: string; id?: number }[]) => {
    const spanners = marks.filter((m): m is { kind: SpannerKind; type: string; id: number } => m.id !== undefined);
    for (const m of spanners.filter((x) => x.type !== "stop")) {
      const inUse = open.get(m.kind) ?? new Set<number>();
      open.set(m.kind, inUse);
      let n = 1;
      while (inUse.has(n)) n++;
      if (n > 16) throw new Error(`more than 16 ${m.kind}s open at once`);
      inUse.add(n);
      given.set(`${m.kind}:${m.id}`, n);
    }
    for (const m of spanners.filter((x) => x.type === "stop")) {
      const n = given.get(`${m.kind}:${m.id}`);
      if (n === undefined) throw new Error(`a ${m.kind} stops before it starts in document order (${where})`);
      open.get(m.kind)!.delete(n);
    }
  };
  for (const m of score.measures) {
    for (const { voice, items } of streamsOf(m)) {
      for (const it of items) {
        where = `bar ${m.number}, voice ${voice ?? "none"}, staff ${it.staff}, offset ${it.offset}`;
        if (it.kind === "direction") visit(it.content);
        if (it.kind !== "group") continue;
        if (!it.notes.length) visit(it.marks);
        it.notes.forEach((n, i) => visit([...n.marks, ...(i === 0 ? it.marks : [])]));
      }
    }
  }
  return (kind, id) => {
    const n = given.get(`${kind}:${id}`);
    if (n === undefined) throw new Error(`${kind} ${id} was never numbered`);
    return n;
  };
}

function writeStreams(w: (s: string) => void, m: Measure, dur: (f: Fraction) => number, num: Numbering): void {
  let cursor = Fraction.ZERO;
  const moveTo = (to: Fraction, voice: number | undefined, staff: number) => {
    if (to.lt(cursor)) {
      w(`      <backup>`);
      w(`        <duration>${dur(cursor.sub(to))}</duration>`);
      w(`      </backup>`);
    } else if (to.gt(cursor)) {
      w(`      <forward>`);
      w(`        <duration>${dur(to.sub(cursor))}</duration>`);
      if (voice !== undefined) w(`        <voice>${voice}</voice>`);
      w(`        <staff>${staff}</staff>`);
      w(`      </forward>`);
    }
    cursor = to;
  };

  for (const { voice, items } of streamsOf(m)) {
    let lastStaff = items[0].staff;
    for (const it of items) {
      moveTo(it.offset, voice, it.staff);
      lastStaff = it.staff;
      if (it.kind === "clef") {
        w(`      <attributes>`);
        writeClef(w, it.clef, "        ");
        w(`      </attributes>`);
      } else if (it.kind === "direction") {
        writeDirection(w, it, num);
      } else {
        writeGroup(w, it, dur, num);
        if (!it.grace) cursor = cursor.add(it.duration);
      }
    }
    // A voice fills its measure, so every reader agrees where it ends.
    if (voice !== undefined && cursor.lt(m.length)) moveTo(m.length, voice, lastStaff);
  }
  // And the measure ends at its barline, whatever stream came last — some
  // readers start the next measure wherever the cursor was left.
  if (cursor.lt(m.length)) moveTo(m.length, undefined, 1);
}

function writeDirection(w: (s: string) => void, d: Direction, num: Numbering): void {
  if (!d.content.length && d.tempo === undefined) return;
  w(`      <direction${d.placement ? ` placement="${d.placement}"` : ""}>`);
  for (const c of d.content) {
    w(`        <direction-type>`);
    writeDirectionContent(w, c, num);
    w(`        </direction-type>`);
  }
  if (!d.content.length) {
    // A tempo with nothing printed still needs a direction-type.
    w(`        <direction-type>`);
    w(`          <words/>`);
    w(`        </direction-type>`);
  }
  if (d.voice !== undefined) w(`        <voice>${d.voice}</voice>`);
  w(`        <staff>${d.staff}</staff>`);
  if (d.tempo !== undefined) w(`        <sound tempo="${round(d.tempo)}"/>`);
  w(`      </direction>`);
}

const DYNAMICS = new Set([
  "p", "pp", "ppp", "pppp", "ppppp", "pppppp", "f", "ff", "fff", "ffff", "fffff", "ffffff",
  "mp", "mf", "sf", "sfp", "sfpp", "fp", "rf", "rfz", "sfz", "sffz", "fz", "n", "pf", "sfzp",
]);

function writeDirectionContent(w: (s: string) => void, c: DirectionContent, num: Numbering): void {
  const pad = "          ";
  switch (c.kind) {
    case "dynamics":
      w(`${pad}<dynamics>`);
      w(DYNAMICS.has(c.value) ? `${pad}  <${c.value}/>` : `${pad}  <other-dynamics>${esc(c.value)}</other-dynamics>`);
      w(`${pad}</dynamics>`);
      return;
    case "wedge":
      w(`${pad}<wedge type="${c.type}" number="${num("wedge", c.id)}"/>`);
      return;
    case "words": {
      const style = (c.italic ? ` font-style="italic"` : "") + (c.bold ? ` font-weight="bold"` : "");
      w(`${pad}<words${style}>${esc(c.text)}</words>`);
      return;
    }
    case "dashes":
      w(`${pad}<dashes type="${c.type}" number="${num("dashes", c.id)}"/>`);
      return;
    case "pedal": {
      const type = c.pedal === "sostenuto" && c.type === "start" ? "sostenuto" : c.type;
      w(`${pad}<pedal type="${type}" line="${yn(c.line)}" sign="${yn(c.sign)}"/>`);
      return;
    }
    case "octave-shift":
      w(`${pad}<octave-shift type="${c.type}" size="${c.size}" number="${num("octave-shift", c.id)}"/>`);
      return;
    case "metronome":
      w(`${pad}<metronome${c.hidden ? ` print-object="no"` : ""}>`);
      w(`${pad}  <beat-unit>${c.beatUnit}</beat-unit>`);
      for (let i = 0; i < c.dots; i++) w(`${pad}  <beat-unit-dot/>`);
      w(`${pad}  <per-minute>${esc(c.perMinute)}</per-minute>`);
      w(`${pad}</metronome>`);
      return;
    case "rehearsal":
      w(`${pad}<rehearsal>${esc(c.text)}</rehearsal>`);
      return;
    case "segno":
      w(`${pad}<segno/>`);
      return;
    case "coda":
      w(`${pad}<coda/>`);
      return;
  }
}

function writeGroup(w: (s: string) => void, g: NoteGroup, dur: (f: Fraction) => number, num: Numbering): void {
  if (!g.notes.length) {
    writeNote(w, g, null, 0, dur, num);
    return;
  }
  g.notes.forEach((n, i) => writeNote(w, g, n, i, dur, num));
}

function writeNote(
  w: (s: string) => void,
  g: NoteGroup,
  n: PitchedNote | null,
  index: number,
  dur: (f: Fraction) => number,
  num: Numbering,
): void {
  const pad = "        ";
  w(`      <note${g.hidden ? ` print-object="no"` : ""}>`);
  if (g.grace) w(`${pad}<grace${g.grace.slash ? ` slash="yes"` : ""}/>`);
  if (index > 0) w(`${pad}<chord/>`);
  if (n) {
    w(`${pad}<pitch>`);
    w(`${pad}  <step>${n.step}</step>`);
    if (n.alter) w(`${pad}  <alter>${round(n.alter)}</alter>`);
    w(`${pad}  <octave>${n.octave}</octave>`);
    w(`${pad}</pitch>`);
  } else {
    const r = g.rest!;
    const display = r.display;
    const attrs = r.measure ? ` measure="yes"` : "";
    if (display) {
      w(`${pad}<rest${attrs}>`);
      w(`${pad}  <display-step>${display.step}</display-step>`);
      w(`${pad}  <display-octave>${display.octave}</display-octave>`);
      w(`${pad}</rest>`);
    } else {
      w(`${pad}<rest${attrs}/>`);
    }
  }
  if (!g.grace) w(`${pad}<duration>${dur(g.duration)}</duration>`);
  if (n?.tie?.stop) w(`${pad}<tie type="stop"/>`);
  if (n?.tie?.start) w(`${pad}<tie type="start"/>`);
  if (g.voice !== undefined) w(`${pad}<voice>${g.voice}</voice>`);
  w(`${pad}<type>${g.type}</type>`);
  for (let i = 0; i < g.dots; i++) w(`${pad}<dot/>`);
  if (n?.accidental) {
    const a = n.accidental;
    w(`${pad}<accidental${a.cautionary ? ` cautionary="yes"` : ""}${a.parentheses ? ` parentheses="yes"` : ""}>${a.value}</accidental>`);
  }
  if (g.timeModification) {
    w(`${pad}<time-modification>`);
    w(`${pad}  <actual-notes>${g.timeModification.actual}</actual-notes>`);
    w(`${pad}  <normal-notes>${g.timeModification.normal}</normal-notes>`);
    w(`${pad}</time-modification>`);
  }
  if (g.stem) w(`${pad}<stem>${g.stem}</stem>`);
  if (n?.notehead) w(`${pad}<notehead>${esc(n.notehead)}</notehead>`);
  w(`${pad}<staff>${n ? n.staff : g.staff}</staff>`);
  if (index === 0) for (const b of g.beams) w(`${pad}<beam number="${b.level}">${b.value}</beam>`);
  writeNotations(w, g, n, index, num);
  w(`      </note>`);
}

/** <notations>: the note's own marks, plus — on a chord's first note —
 *  the chord's tuplets and whole-chord marks. */
function writeNotations(w: (s: string) => void, g: NoteGroup, n: PitchedNote | null, index: number, num: Numbering): void {
  const marks: NoteMark[] = [...(n?.marks ?? []), ...(index === 0 ? g.marks : [])];
  const tied = n?.tie;
  const tuplets = index === 0 ? g.tuplets : [];
  if (!marks.length && !tied && !tuplets.length) return;

  const pad = "          ";
  const lines: string[] = [];
  if (tied?.stop) lines.push(`${pad}<tied type="stop"/>`);
  if (tied?.start) lines.push(`${pad}<tied type="${tied.letRing ? "let-ring" : "start"}"/>`);
  for (const m of marks) {
    if (m.kind === "slur") lines.push(`${pad}<slur type="${m.type}" number="${num("slur", m.id)}"${place(m.placement)}/>`);
    if (m.kind === "glissando") lines.push(`${pad}<glissando type="${m.type}" number="${num("glissando", m.id)}"/>`);
  }
  for (const t of tuplets) {
    const shown = t.actual !== undefined && t.normal !== undefined;
    if (!shown) {
      lines.push(`${pad}<tuplet type="${t.type}" number="${t.number}"/>`);
      continue;
    }
    lines.push(`${pad}<tuplet type="${t.type}" number="${t.number}"${t.hidden ? ` show-number="none"` : ""}>`);
    lines.push(`${pad}  <tuplet-actual><tuplet-number>${t.actual}</tuplet-number></tuplet-actual>`);
    lines.push(`${pad}  <tuplet-normal><tuplet-number>${t.normal}</tuplet-number></tuplet-normal>`);
    lines.push(`${pad}</tuplet>`);
  }
  const group = (tag: string, inner: string[]) => {
    if (!inner.length) return;
    lines.push(`${pad}<${tag}>`);
    for (const s of inner) lines.push(`${pad}  ${s}`);
    lines.push(`${pad}</${tag}>`);
  };
  group("ornaments", marks.flatMap((m) => {
    if (m.kind === "ornament") {
      const attrs = place(m.placement) + (m.long ? ` long="yes"` : "") +
        (m.approach ? ` approach="${m.approach}"` : "") + (m.departure ? ` departure="${m.departure}"` : "");
      return [`<${m.name}${attrs}/>`];
    }
    if (m.kind === "wavy-line") return [`<wavy-line type="${m.type}" number="${num("wavy-line", m.id)}"/>`];
    if (m.kind === "tremolo") return [`<tremolo type="single">${m.marks}</tremolo>`];
    return [];
  }));
  group("technical", marks.flatMap((m) => {
    if (m.kind === "fingering") return [`<fingering${m.substitution ? ` substitution="yes"` : ""}${place(m.placement)}>${esc(m.text)}</fingering>`];
    if (m.kind === "technical") return [`<${m.name}${place(m.placement)}/>`];
    return [];
  }));
  group("articulations", marks.flatMap((m) => (m.kind === "articulation" ? [`<${m.name}${place(m.placement)}/>`] : [])));
  for (const m of marks) {
    if (m.kind === "fermata") {
      const shape = m.shape === "normal" ? "" : m.shape;
      lines.push(`${pad}<fermata type="${m.inverted ? "inverted" : "upright"}">${shape}</fermata>`);
    }
    if (m.kind === "arpeggiate") {
      const attrs = (m.direction ? ` direction="${m.direction}"` : "") + (m.number ? ` number="${m.number}"` : "");
      lines.push(`${pad}<arpeggiate${attrs}/>`);
    }
  }
  w(`        <notations>`);
  for (const l of lines) w(l);
  w(`        </notations>`);
}

const place = (p?: string) => (p ? ` placement="${p}"` : "");
const yn = (b: boolean) => (b ? "yes" : "no");
const round = (x: number) => String(Math.round(x * 1e6) / 1e6);

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
