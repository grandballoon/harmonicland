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

   2. A SECTION IS NOT A HAND. Which hand you drill is a choice made at the
      instrument, per sitting, and the same eight bars get practised right
      hand, then left, then together. Saving it would make one chunk three.

   3. A RANGE IS SAVED ONCE. Its id IS its range, trims included, so
      saving bars 3–8 again finds the section already there rather than
      growing a twin, and a list is always in score order. Retargeting a
      section to new bars therefore changes its id, and is refused when
      those bars are already another section.
   ==================================================================== */
import type { BarRange } from "./types";

export interface Section {
  /** The range, as a key: unique within a list, stable across renames. */
  readonly id: string;
  readonly range: BarRange;
  /** What the learner called it. Empty means unnamed, and a label falls
   *  back to the bars — so renaming a section to nothing un-names it. */
  readonly name: string;
}

/** Untrimmed ranges keep the ids they had before trims existed. */
const idOf = (r: BarRange): string =>
  `${r.from}${r.fromBeat !== undefined ? `@${r.fromBeat}` : ""}-${r.to}${r.toBeat !== undefined ? `@${r.toBeat}` : ""}`;

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

/** What a section is called on screen. */
export const labelOf = (s: Section): string => s.name || describeBars(s.range);

/** By where a section starts, then where it ends — trims included. */
const inOrder = (list: Section[]): Section[] =>
  list.sort((a, b) =>
    a.range.from - b.range.from || (a.range.fromBeat ?? 0) - (b.range.fromBeat ?? 0)
    || a.range.to - b.range.to || (a.range.toBeat ?? Infinity) - (b.range.toBeat ?? Infinity));

/** A section of `range` — copied, so a caller's object with more on it, or
 *  an explicit `undefined`, never reaches storage. */
function sectionOf(range: BarRange, name: string): Section {
  const r: BarRange = {
    from: range.from, to: range.to,
    ...(range.fromBeat !== undefined && { fromBeat: range.fromBeat }),
    ...(range.toBeat !== undefined && { toBeat: range.toBeat }),
  };
  return { id: idOf(r), range: r, name: name.trim() };
}

/** Add `range`, unless a section of exactly those bars exists (decision 3),
 *  in which case the list comes back unchanged. */
export function add(list: readonly Section[], range: BarRange, name = ""): readonly Section[] {
  const s = sectionOf(range, name);
  if (list.some((x) => x.id === s.id)) return list;
  return inOrder([...list, s]);
}

/** Move section `id` to `range`, name and all — how a saved section is
 *  fine-tuned. Unchanged when `id` is gone or `range` is already another
 *  section (decision 3): two sections would otherwise share one id. */
export function retarget(list: readonly Section[], id: string, range: BarRange): readonly Section[] {
  const s = list.find((x) => x.id === id);
  if (!s || find(list, range)) return list;
  return inOrder([...list.filter((x) => x.id !== id), sectionOf(range, s.name)]);
}

export function rename(list: readonly Section[], id: string, name: string): readonly Section[] {
  return list.map((s) => (s.id === id ? { ...s, name: name.trim() } : s));
}

export function remove(list: readonly Section[], id: string): readonly Section[] {
  return list.filter((s) => s.id !== id);
}

/** The section of exactly these bars, if one is saved. */
export const find = (list: readonly Section[], range: BarRange | null): Section | undefined =>
  range === null ? undefined : list.find((s) => s.id === idOf(range));

/** `bars` bars cut into runs of `size`, the last one short if it must.
 *  The mechanical first pass at breaking a piece down; the learner then
 *  renames, deletes, or saves their own musical phrases beside it. */
export function chunk(bars: number, size: number): BarRange[] {
  const n = Math.max(1, Math.floor(size));
  const out: BarRange[] = [];
  for (let from = 0; from < bars; from += n) out.push({ from, to: Math.min(from + n, bars) - 1 });
  return out;
}

/** Every section in `ranges` added to `list`, existing ones left as named. */
export const addAll = (list: readonly Section[], ranges: readonly BarRange[]): readonly Section[] =>
  ranges.reduce((acc, r) => add(acc, r), list);

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
    list = add(list, r, typeof d.name === "string" ? d.name : "");
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

export const Sections = { describeBars, labelOf, add, addAll, retarget, rename, remove, find, chunk, parse, keyForBytes };
