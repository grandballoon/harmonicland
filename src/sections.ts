/* ====================================================================
   SECTIONS — a score broken into named runs of bars, kept for later.
   Pure: lists in, lists out. Storage is section-store.ts; the panel that
   edits a list is sections-panel.ts; main.ts only hands a chosen range to
   the one bar selection every view already shares.

   Three decisions, stated because they are decisions:

   1. A SECTION IS BARS, NOT SECONDS. Bars are the unit a musician counts
      in and the unit the selection already speaks, and they mean the same
      thing whether the clock plays them (every other view) or the learner
      walks them (practice mode, where time stands still between presses).
      The same saved section loops in the falling notes and confines a
      lesson, with no tempo to convert. When a phrase does not begin or end
      on a barline, its ends are trimmed in BEATS of their bars (types.ts,
      BarRange) — still the musician's unit, still no tempo.

   2. A SECTION HAS A HAND: both, the right alone, or the left alone. A
      run worked out for one hand — a left-hand stride, a right-hand run
      — is a thing of its own to come back to, so the same bars may be
      saved up to three times, once per hand. Loading a section chooses
      its hand, which the learner may still change for the sitting.

   3. A RANGE IS SAVED ONCE PER HAND. Its id IS its range, trims
      included, and its hand, so saving bars 3–8 again finds the section
      already there rather than growing a twin. Retargeting a section to
      new bars therefore changes its id, and is refused when those bars
      are already another section of the same hand.

   4. A SECTION MAY HOLD OTHERS. Splitting a section adds its sub-runs
      beside it and leaves it as it was, so the whole is still there to
      come back to once its parts are learned. The list is in OUTLINE
      order — by where a section starts, the longer first, both hands
      before one — so a section comes just before the ones it holds, and
      `depths` says how deep each sits.
   ==================================================================== */
import type { BarRange } from "./types";
import type { HandFilter } from "./steps";

export interface Section {
  /** The range, as a key: unique within a list, stable across renames. */
  readonly id: string;
  readonly range: BarRange;
  /** What the learner called it. Empty means unnamed, and a label falls
   *  back to the bars — so renaming a section to nothing un-names it. */
  readonly name: string;
  /** Who plays it (decision 2). */
  readonly hand: HandFilter;
}

/** Untrimmed ranges keep the ids they had before trims existed, and
 *  both-hands sections the ids they had before hands did. */
const idOf = (r: BarRange, hand: HandFilter = "both"): string =>
  `${r.from}${r.fromBeat !== undefined ? `@${r.fromBeat}` : ""}-${r.to}${r.toBeat !== undefined ? `@${r.toBeat}` : ""}`
  + (hand === "upper" ? ":R" : hand === "lower" ? ":L" : "");

/** "", "right hand", "left hand". */
export const handName = (h: HandFilter): string => (h === "upper" ? "right hand" : h === "lower" ? "left hand" : "");
/** The short tag a one-hand section wears after its label: "R", "L". */
export const handTag = (h: HandFilter): string => (h === "upper" ? "R" : h === "lower" ? "L" : "");

/** A beat as a musician numbers it — from 1, to two places at most. */
const beatNo = (beat: number): string => String(Math.round((beat + 1) * 100) / 100);

/** "bar 3", "bars 3–8", "the whole piece" — bar NUMBERS, from 1. A trimmed
 *  range names its beats: "bar 3 beat 2 – bar 8", "bar 5 beat 2–4". A
 *  trimmed end is where the range stops, so "– bar 8 beat 3" ends as beat
 *  3 begins, while an untrimmed "– bar 8" plays bar 8 through. */
export function describeBars(r: BarRange | null): string {
  if (r === null) return "the whole piece";
  const { from, to, fromBeat, toBeat } = r;
  if (fromBeat === undefined && toBeat === undefined)
    return from === to ? `bar ${from + 1}` : `bars ${from + 1}–${to + 1}`;
  if (from === to)
    return `bar ${from + 1} beat ${beatNo(fromBeat ?? 0)}–${toBeat === undefined ? "end" : beatNo(toBeat)}`;
  const edge = (bar: number, beat: number | undefined): string =>
    beat === undefined ? `bar ${bar + 1}` : `bar ${bar + 1} beat ${beatNo(beat)}`;
  return `${edge(from, fromBeat)} – ${edge(to, toBeat)}`;
}

/** What a section is called on screen: its name or its bars, and its
 *  hand when it is one hand's — "Intro (R)". */
export const labelOf = (s: Section): string =>
  (s.name || describeBars(s.range)) + (s.hand === "both" ? "" : ` (${handTag(s.hand)})`);

/** Where a range starts and stops, as [bar, beat] — an untrimmed end runs
 *  its bar through. */
const startOf = (r: BarRange): [number, number] => [r.from, r.fromBeat ?? 0];
const endOf = (r: BarRange): [number, number] => [r.to, r.toBeat ?? Infinity];
/** Two untrimmed ends are equal: Infinity − Infinity would be NaN. */
const cmp = ([a, b]: [number, number], [c, d]: [number, number]): number => a - c || (b === d ? 0 : b - d);
const HAND_ORDER: Record<HandFilter, number> = { both: 0, upper: 1, lower: 2 };

/** Outline order (decision 4): by start, the longer first, both hands
 *  before one — so a section precedes every section it holds. */
const inOrder = (list: Section[]): Section[] =>
  list.sort((a, b) =>
    cmp(startOf(a.range), startOf(b.range)) || cmp(endOf(b.range), endOf(a.range))
    || HAND_ORDER[a.hand] - HAND_ORDER[b.hand]);

/** Does `outer` hold `inner`? Its bars cover inner's, and it is played by
 *  the same hand, or by both. */
export const holds = (outer: Section, inner: Section): boolean =>
  outer.id !== inner.id
  && (outer.hand === "both" || outer.hand === inner.hand)
  && cmp(startOf(outer.range), startOf(inner.range)) <= 0
  && cmp(endOf(outer.range), endOf(inner.range)) >= 0;

/** How many sections of the list hold each one: 0 for a top-level run,
 *  1 for a part of one, and so on. Read alongside the list, index for index. */
export const depths = (list: readonly Section[]): number[] =>
  list.map((s) => list.filter((o) => holds(o, s)).length);

/** A section of `range` — copied, so a caller's object with more on it, or
 *  an explicit `undefined`, never reaches storage. */
function sectionOf(range: BarRange, name: string, hand: HandFilter): Section {
  const r: BarRange = {
    from: range.from, to: range.to,
    ...(range.fromBeat !== undefined && { fromBeat: range.fromBeat }),
    ...(range.toBeat !== undefined && { toBeat: range.toBeat }),
  };
  return { id: idOf(r, hand), range: r, name: name.trim(), hand };
}

/** Add `range` for `hand`, unless that hand has a section of exactly those
 *  bars (decision 3), in which case the list comes back unchanged. */
export function add(list: readonly Section[], range: BarRange, name = "", hand: HandFilter = "both"): readonly Section[] {
  const s = sectionOf(range, name, hand);
  if (list.some((x) => x.id === s.id)) return list;
  return inOrder([...list, s]);
}

/** Move section `id` to `range`, name and hand and all — how a saved
 *  section is fine-tuned. Unchanged when `id` is gone or its hand already
 *  has `range` (decision 3): two sections would otherwise share one id. */
export function retarget(list: readonly Section[], id: string, range: BarRange): readonly Section[] {
  const s = list.find((x) => x.id === id);
  if (!s || find(list, range, s.hand)) return list;
  return inOrder([...list.filter((x) => x.id !== id), sectionOf(range, s.name, s.hand)]);
}

export function rename(list: readonly Section[], id: string, name: string): readonly Section[] {
  return list.map((s) => (s.id === id ? { ...s, name: name.trim() } : s));
}

export function remove(list: readonly Section[], id: string): readonly Section[] {
  return list.filter((s) => s.id !== id);
}

/** The section of exactly these bars for this hand, if one is saved. */
export const find = (list: readonly Section[], range: BarRange | null, hand: HandFilter = "both"): Section | undefined =>
  range === null ? undefined : list.find((s) => s.id === idOf(range, hand));

/** A section of exactly these bars for any hand — `hand`'s if it has one,
 *  else the first. For what knows bars but not a hand: a mark on the sheet. */
export const findAny = (list: readonly Section[], range: BarRange | null, hand: HandFilter = "both"): Section | undefined =>
  find(list, range, hand) ?? (range === null ? undefined : list.find((s) => cmp(startOf(s.range), startOf(range)) === 0
    && cmp(endOf(s.range), endOf(range)) === 0));

/** `bars` bars cut into runs of `size`, the last one short if it must.
 *  The mechanical first pass at breaking a piece down; the learner then
 *  renames, deletes, or saves their own musical phrases beside it. */
export function chunk(bars: number, size: number): BarRange[] {
  const n = Math.max(1, Math.floor(size));
  const out: BarRange[] = [];
  for (let from = 0; from < bars; from += n) out.push({ from, to: Math.min(from + n, bars) - 1 });
  return out;
}

/** Every section in `ranges` added to `list` for `hand`, existing ones
 *  left as named. */
export const addAll = (list: readonly Section[], ranges: readonly BarRange[], hand: HandFilter = "both"): readonly Section[] =>
  ranges.reduce((acc, r) => add(acc, r, "", hand), list);

/** `range` cut into runs of `size` bars, the last one short if it must.
 *  Its trims stay where they were: the first run starts where the range
 *  does, the last stops where it does. One bar or fewer than `size` is
 *  one run — itself. */
export function subdivide(range: BarRange, size: number): BarRange[] {
  const n = Math.max(1, Math.floor(size));
  const out: BarRange[] = [];
  for (let from = range.from; from <= range.to; from += n) {
    const to = Math.min(from + n - 1, range.to);
    out.push({
      from, to,
      ...(from === range.from && range.fromBeat !== undefined && { fromBeat: range.fromBeat }),
      ...(to === range.to && range.toBeat !== undefined && { toBeat: range.toBeat }),
    });
  }
  return out;
}

/** Split section `id` into runs of `size` bars, added beside it for its
 *  hand; the section itself stays as it was (decision 4). Unchanged when
 *  `id` is gone, or its bars are already one run of that size. */
export function split(list: readonly Section[], id: string, size: number): readonly Section[] {
  const s = list.find((x) => x.id === id);
  if (!s) return list;
  const runs = subdivide(s.range, size);
  return runs.length < 2 ? list : addAll(list, runs, s.hand);
}

/** Would splitting section `id` by `size` add anything? */
export const canSplit = (list: readonly Section[], id: string, size: number): boolean =>
  split(list, id, size) !== list;

/** What goes over the wire and into storage: the range, the name, and the
 *  hand when it is one hand's. The id is rebuilt on the way back in. The
 *  app and the server (api/) both write with this. */
export const toJSON = (sections: readonly Section[]): { range: BarRange; name: string; hand?: HandFilter }[] =>
  sections.map(({ range, name, hand }) => ({ range, name, ...(hand !== "both" && { hand }) }));

/** Sections out of untrusted JSON — storage a user, an old version, or a
 *  browser extension may have touched. What does not parse is dropped, not
 *  thrown: one bad entry must not cost the learner every other section. */
export function parse(data: unknown): readonly Section[] {
  if (!Array.isArray(data)) return [];
  const isBar = (x: unknown): x is number => Number.isInteger(x) && (x as number) >= 0;
  const isTrim = (x: unknown): boolean => x === undefined || (Number.isFinite(x) && (x as number) > 0);
  let list: readonly Section[] = [];
  for (const d of data) {
    const r = d?.range;
    if (!r || !isBar(r.from) || !isBar(r.to) || r.from > r.to || !isTrim(r.fromBeat) || !isTrim(r.toBeat)) continue;
    const hand: HandFilter = d.hand === "upper" || d.hand === "lower" ? d.hand : "both";
    list = add(list, r, typeof d.name === "string" ? d.name : "", hand);
  }
  return list;
}

/** A score's identity for saving sections against: a hash of the file's
 *  bytes (cyrb53) plus their length. By CONTENT, not name, so two files
 *  called "prelude.mid" never share sections and a renamed file keeps
 *  them. The cost, accepted: re-exporting an edited score starts afresh. */
export function keyForBytes(bytes: Uint8Array): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (const b of bytes) {
    h1 = Math.imul(h1 ^ b, 2654435761);
    h2 = Math.imul(h2 ^ b, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hash = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return `file:${hash.toString(36)}-${bytes.length.toString(36)}`;
}

export const Sections = {
  describeBars, labelOf, handName, handTag, add, addAll, retarget, rename, remove, find, findAny,
  chunk, subdivide, split, canSplit, holds, depths, parse, toJSON, keyForBytes,
};
