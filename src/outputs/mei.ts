/* ====================================================================
   MEI — the engraved score as a Music Encoding Initiative document, the
   form Verovio reads. engrave.ts decides the NOTATION — values, rests,
   ties, beams, which accidentals print — and this only writes it down in
   MEI's vocabulary, so the page Verovio sets says exactly what the
   built-in page says, note for note. Verovio decides where things go;
   nothing here decides what they are.

   Pure: a string out, no DOM, no engine. What it promises the renderer:

   1. IDS. Every notehead is `n<NoteId>h<k>`, the k-th head of that note
      counting from its attack, and every measure is `b<bar index>`.
      Verovio keeps them in its SVG, which is how the page finds a note to
      light and a bar to hit-test without a second map.

   2. CLASSES. Every note, chord, beam and tie carries its hand in `type`
      — "upper", "lower", or "free" when the score has no hands — and
      "other" as well when it is the hand not being practised. Verovio
      copies `type` into the SVG's `class`, so colour is a stylesheet,
      never baked into the engraving.

   3. LAYERS. MEI wants each layer to be one voice whose durations follow
      one another. engrave.ts gives a staff's chords with no such promise —
      a half note held under moving quarters is two chords at one instant —
      so each staff is dealt into as few layers as keep them apart, beams
      whole, with rests in the first layer and invisible spaces filling
      the holes the others leave. Verovio then stems the layers apart, as
      the built-in page does.

   4. TRIPLETS go in <tuplet> containers, three to a bracket, since a
      container is what Verovio times by. A container must nest with the
      beams around it; where a beam and a tuplet would cross, the beam is
      broken at the tuplet — the rhythm is the fact, the beam a courtesy.
   ==================================================================== */
import {
  quartersOf, valuesFor, type Chord, type EngravedBar, type Head, type Rest, type Staff, type Value,
} from "./engrave";
import { spell } from "../pitch";
import { inHand, type HandFilter } from "../steps";
import type { Accidental, Bar, Note, NoteId } from "../types";

/** The k-th head of a note, counting from its attack. See decision 1. */
export const headId = (id: NoteId, k: number): string => `n${id}h${k}`;
/** Every head id of a note begins with this and no other note's does. */
export const headPrefix = (id: NoteId): string => `n${id}h`;
export const measureId = (bar: number): string => `b${bar}`;
/** The bar a measure id names, or null for any other id. */
export const barOfMeasureId = (id: string): number | null => {
  const m = /^b(\d+)$/.exec(id);
  return m ? Number(m[1]) : null;
};

const STAFF_N: Record<Staff, number> = { treble: 1, bass: 2 };
const EPS = 1e-6;

// --- attribute vocabulary -------------------------------------------------

const ACCID: Record<Exclude<Accidental, "">, string> = { "#": "s", b: "f" };
const PRINTED: Record<Exclude<Head["acc"], "">, string> = { "#": "s", b: "f", n: "n" };

const keySig = (fifths: number): string =>
  fifths > 0 ? `${fifths}s` : fifths < 0 ? `${-fifths}f` : "0";

const durAttrs = (v: Value): string => `dur="${v.base}"${v.dots ? ` dots="${v.dots}"` : ""}`;

/** Decision 2: what a note is called in the stylesheet. */
function handClass(n: Note, hand: HandFilter): string {
  const h = n.hand ?? "free";
  return inHand(n, hand) ? h : `${h} other`;
}

/** A group wears the class of its loudest member: a chord or beam with
 *  anything in the practised hand is in it. */
const loudest = (classes: readonly string[]): string =>
  classes.find((c) => !c.endsWith(" other")) ?? classes[0];

// --- one layer --------------------------------------------------------------

/** One thing in a layer, taking `len` quarters from `q`. */
type Item =
  | { kind: "chord"; q: number; len: number; triplet: boolean; base: number; chord: Chord }
  | { kind: "rest"; q: number; len: number; triplet: boolean; base: number; rest: Rest }
  | { kind: "space"; q: number; len: number; triplet: boolean; base: number; value: Value };

/** What a layer is dealt: a lone item, or a beamed run kept together. */
interface Unit {
  q: number;
  end: number;
  items: Item[];
  beamed: boolean;
}

const chordItem = (c: Chord): Item =>
  ({ kind: "chord", q: c.q, len: quartersOf(c.value), triplet: c.value.triplet, base: c.value.base, chord: c });
const restItem = (r: Rest): Item =>
  ({ kind: "rest", q: r.q, len: quartersOf(r.value), triplet: r.value.triplet, base: r.value.base, rest: r });

const unitOf = (items: Item[], beamed: boolean): Unit => {
  const last = items[items.length - 1];
  return { q: items[0].q, end: last.q + last.len, items, beamed };
};

/** Decision 3: deal a staff's units into as few layers as keep every
 *  layer's units apart. Rests are dealt first, into the first layer —
 *  they are where nothing sounds, so nothing can collide with them. */
function dealLayers(units: readonly Unit[], rests: readonly Unit[]): Unit[][] {
  const layers: Unit[][] = [[...rests]];
  const clear = (layer: Unit[], u: Unit): boolean =>
    layer.every((o) => o.end <= u.q + EPS || u.end <= o.q + EPS);
  for (const u of [...units].sort((a, b) => a.q - b.q)) {
    const home = layers.find((l) => clear(l, u));
    if (home) home.push(u);
    else layers.push([u]);
  }
  for (const l of layers) l.sort((a, b) => a.q - b.q);
  return layers;
}

/** A layer's items in time order, its holes filled with spaces, and the
 *  beamed runs as index ranges into that list. */
function flatten(layer: readonly Unit[], quarters: number) {
  const items: Item[] = [];
  const beams: [number, number][] = [];
  let at = 0;
  const fill = (to: number): void => {
    let q = at;
    for (const value of valuesFor(to - at)) {
      const len = quartersOf(value);
      items.push({ kind: "space", q, len, triplet: value.triplet, base: value.base, value });
      q += len;
    }
  };
  for (const u of layer) {
    if (u.q > at + EPS) fill(u.q);
    if (u.beamed) beams.push([items.length, items.length + u.items.length - 1]);
    items.push(...u.items);
    at = u.end;
  }
  if (quarters > at + EPS) fill(quarters);
  return { items, beams };
}

/** Decision 4: consecutive triplet items, closed three to a bracket — as
 *  soon as what they have taken is a whole number of the smallest value
 *  among them, written straight. */
function tupletRanges(items: readonly Item[]): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  let taken = 0;
  let base = 0;
  items.forEach((it, i) => {
    if (!it.triplet) {
      if (start >= 0) out.push([start, i - 1]);
      start = -1;
      return;
    }
    if (start < 0) { start = i; taken = 0; base = 0; }
    taken += it.len;
    base = Math.max(base, it.base);
    const unit = 4 / base;
    if (Math.abs(taken / unit - Math.round(taken / unit)) < EPS) {
      out.push([start, i]);
      start = -1;
    }
  });
  if (start >= 0) out.push([start, items.length - 1]);
  return out;
}

const holds = (a: readonly [number, number], b: readonly [number, number]): boolean => a[0] <= b[0] && b[1] <= a[1];
/** Do two ranges overlap with neither inside the other? */
const crosses = (a: readonly [number, number], b: readonly [number, number]): boolean =>
  a[0] <= b[1] && b[0] <= a[1] && !holds(a, b) && !holds(b, a);

/** Break every beam that crosses a tuplet at that tuplet's edges, so the
 *  two nest. Pieces of one item are no longer beams. */
function nestBeams(beams: readonly [number, number][], tuplets: readonly [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const b of beams) {
    if (!tuplets.some((t) => crosses(b, t))) { out.push(b); continue; }
    const cuts = new Set<number>([b[0], b[1] + 1]);
    for (const [s, e] of tuplets) {
      if (s > b[0] && s <= b[1]) cuts.add(s);
      if (e + 1 > b[0] && e + 1 <= b[1]) cuts.add(e + 1);
    }
    const at = [...cuts].sort((x, y) => x - y);
    for (let i = 0; i + 1 < at.length; i++) if (at[i + 1] - at[i] > 1) out.push([at[i], at[i + 1] - 1]);
  }
  return out;
}

// --- writing it down ----------------------------------------------------------

interface Ids {
  /** The id a head was given, looked up by the head itself. */
  of: Map<Head, string>;
}

function noteXml(h: Head, ids: Ids, hand: HandFilter, dur: string): string {
  const sp = spell(h.note);
  const accid = h.acc ? ` accid="${PRINTED[h.acc]}"` : sp.acc ? ` accid.ges="${ACCID[sp.acc]}"` : "";
  return `<note xml:id="${ids.of.get(h)}" pname="${sp.letter.toLowerCase()}" oct="${sp.octave}"` +
    `${dur}${accid} type="${handClass(h.note, hand)}"/>`;
}

const chordClass = (c: Chord, hand: HandFilter): string =>
  loudest(c.heads.map((h) => handClass(h.note, hand)));

function itemXml(it: Item, ids: Ids, hand: HandFilter): string {
  switch (it.kind) {
    case "space":
      return `<space ${durAttrs(it.value)}/>`;
    case "rest":
      return `<rest ${durAttrs(it.rest.value)}/>`;
    case "chord": {
      const c = it.chord;
      if (c.heads.length === 1) return noteXml(c.heads[0], ids, hand, ` ${durAttrs(c.value)}`);
      return `<chord ${durAttrs(c.value)} type="${chordClass(c, hand)}">` +
        c.heads.map((h) => noteXml(h, ids, hand, "")).join("") + `</chord>`;
    }
  }
}

/** A layer's items, wrapped in its beams and tuplets — which by now nest,
 *  so a stack of open containers is all it takes. */
function layerXml(items: readonly Item[], beams: readonly [number, number][], ids: Ids, hand: HandFilter): string {
  const tuplets = tupletRanges(items);
  type Box = { s: number; e: number; open: string; close: string };
  const boxes: Box[] = [
    ...tuplets.map(([s, e]): Box => ({ s, e, open: `<tuplet num="3" numbase="2">`, close: `</tuplet>` })),
    ...nestBeams(beams, tuplets).map(([s, e]): Box => {
      const cls = loudest(items.slice(s, e + 1).flatMap((it) => (it.kind === "chord" ? [chordClass(it.chord, hand)] : [])));
      return { s, e, open: `<beam type="${cls}">`, close: `</beam>` };
    }),
  ].sort((a, b) => a.s - b.s || b.e - a.e);

  let out = "";
  const open: Box[] = [];
  items.forEach((it, i) => {
    for (const b of boxes) if (b.s === i) { out += b.open; open.push(b); }
    out += itemXml(it, ids, hand);
    while (open.length && open[open.length - 1].e === i) out += open.pop()!.close;
  });
  return out;
}

function staffXml(eb: EngravedBar, staff: Staff, ids: Ids, hand: HandFilter): string {
  const rests = eb.rests.filter((r) => r.staff === staff);
  let body: string;
  if (rests.some((r) => r.whole)) {
    body = `<layer n="1"><mRest/></layer>`;
  } else {
    const chords = eb.chords.filter((c) => c.staff === staff);
    const beams = eb.beams.filter((g) => g[0].staff === staff);
    const beamed = new Set(beams.flat());
    const units = [
      ...beams.map((g) => unitOf(g.map(chordItem), true)),
      ...chords.filter((c) => !beamed.has(c)).map((c) => unitOf([chordItem(c)], false)),
    ];
    body = dealLayers(units, rests.map((r) => unitOf([restItem(r)], false)))
      .filter((l) => l.length > 0)
      .map((l, i) => {
        const { items, beams: bs } = flatten(l, eb.quarters);
        return `<layer n="${i + 1}">${layerXml(items, bs, ids, hand)}</layer>`;
      })
      .join("");
  }
  return `<staff n="${STAFF_N[staff]}">${body}</staff>`;
}

const meterDiffers = (a: Bar, b: Bar): boolean => a.beats !== b.beats || a.unit !== b.unit;

/** The engraved bars of a piece as one MEI document, for the hand being
 *  practised — which decides only the classes (decision 2); which notes
 *  are on the page was decided by whoever engraved `ebs`. */
export function toMei(ebs: readonly EngravedBar[], hand: HandFilter): string {
  if (ebs.length === 0) return "";

  // decision 1: number each note's heads from its attack, in page order
  const ids: Ids = { of: new Map() };
  const headsOf = new Map<NoteId, Head[]>();
  for (const eb of ebs)
    for (const c of eb.chords)
      for (const h of c.heads) {
        let list = headsOf.get(h.note.id);
        if (!list) headsOf.set(h.note.id, (list = []));
        ids.of.set(h, headId(h.note.id, list.length));
        list.push(h);
      }
  // a tie from each head to the next head of its note, filed with the
  // measure it starts in
  const tiesFrom = new Map<Head, Head>();
  for (const list of headsOf.values())
    for (let k = 0; k + 1 < list.length; k++) if (list[k].tiedTo) tiesFrom.set(list[k], list[k + 1]);

  const first = ebs[0].bar;
  let out = `<?xml version="1.0" encoding="UTF-8"?>` +
    `<mei xmlns="http://www.music-encoding.org/ns/mei" meiversion="5.1">` +
    `<meiHead><fileDesc><titleStmt><title/></titleStmt><pubStmt/></fileDesc></meiHead>` +
    `<music><body><mdiv><score>` +
    `<scoreDef><keySig sig="${keySig(first.fifths)}"/><meterSig count="${first.beats}" unit="${first.unit}"/>` +
    `<staffGrp symbol="brace" bar.thru="true">` +
    `<staffDef n="1" lines="5"><clef shape="G" line="2"/></staffDef>` +
    `<staffDef n="2" lines="5"><clef shape="F" line="4"/></staffDef>` +
    `</staffGrp></scoreDef><section>`;

  ebs.forEach((eb, i) => {
    const bar = eb.bar;
    const prev = i > 0 ? ebs[i - 1].bar : null;
    if (prev && (prev.fifths !== bar.fifths || meterDiffers(prev, bar)))
      out += `<scoreDef>` +
        (prev.fifths !== bar.fifths ? `<keySig sig="${keySig(bar.fifths)}"/>` : "") +
        (meterDiffers(prev, bar) ? `<meterSig count="${bar.beats}" unit="${bar.unit}"/>` : "") +
        `</scoreDef>`;
    const last = i === ebs.length - 1;
    out += `<measure n="${bar.index + 1}" xml:id="${measureId(bar.index)}"${last ? ` right="end"` : ""}>`;
    out += staffXml(eb, "treble", ids, hand) + staffXml(eb, "bass", ids, hand);
    for (const c of eb.chords)
      for (const h of c.heads) {
        const to = tiesFrom.get(h);
        if (to) out += `<tie startid="#${ids.of.get(h)}" endid="#${ids.of.get(to)}" type="${handClass(h.note, hand)}"/>`;
      }
    out += `</measure>`;
  });
  return out + `</section></score></mdiv></body></music></mei>`;
}

export const Mei = { toMei, headId, headPrefix, measureId, barOfMeasureId };
