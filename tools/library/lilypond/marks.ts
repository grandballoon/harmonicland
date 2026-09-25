/* ====================================================================
   MARKS — LilyPond's vocabulary, translated into MusicXML's.

   Pure lookup: articulation names, markup, rehearsal letters, and note
   values. Every table is closed — a name LilyPond sends that is not
   listed here is an error at conversion time, never a silent drop — so
   extending the corpus can only ever fail loudly.
   ==================================================================== */
import type { NoteMark, NoteType } from "../score/model.ts";

type Placement = "above" | "below";

/** LilyPond direction (1 up, -1 down) as a MusicXML placement. */
export function placementOf(direction: unknown): Placement | undefined {
  const d = Number(direction);
  return d > 0 ? "above" : d < 0 ? "below" : undefined;
}

/** A LilyPond articulation type as the MusicXML mark it prints as.
 *  `direction` is the event's own, which also decides a fermata's side. */
export function articulationMark(type: string, direction: unknown): NoteMark {
  const placement = placementOf(direction);
  const art = (name: Extract<NoteMark, { kind: "articulation" }>["name"]): NoteMark => ({ kind: "articulation", name, placement });
  const orn = (
    name: Extract<NoteMark, { kind: "ornament" }>["name"],
    extra: { long?: boolean; approach?: Placement; departure?: Placement } = {},
  ): NoteMark => ({ kind: "ornament", name, placement, ...extra });
  const fermata = (shape: Extract<NoteMark, { kind: "fermata" }>["shape"]): NoteMark => ({
    kind: "fermata",
    shape,
    inverted: placement === "below",
  });
  switch (type) {
    case "accent": return art("accent");
    case "marcato": return art("strong-accent");
    case "staccato": return art("staccato");
    case "staccatissimo": return art("staccatissimo");
    case "tenuto": return art("tenuto");
    // Rachmaninoff Op. 23 No. 4 defines "tenutoalt": the tenuto glyph with
    // different padding (see its source), so it prints as a tenuto.
    case "tenutoalt": return art("tenuto");
    case "portato": return art("detached-legato");
    case "espressivo": return art("soft-accent");
    case "fermata": return fermata("normal");
    case "shortfermata": return fermata("angled");
    case "longfermata": return fermata("square");
    case "verylongfermata": return fermata("double-square");
    case "trill": return orn("trill-mark");
    case "turn": return orn("turn");
    case "reverseturn": return orn("inverted-turn");
    case "mordent": return orn("mordent");
    case "prall": return orn("inverted-mordent");
    case "prallprall": return orn("inverted-mordent", { long: true });
    case "prallmordent": return orn("mordent", { long: true });
    case "upprall": return orn("inverted-mordent", { long: true, approach: "below" });
    case "downprall": return orn("inverted-mordent", { long: true, approach: "above" });
    case "prallup": return orn("inverted-mordent", { long: true, departure: "above" });
    case "pralldown": return orn("inverted-mordent", { long: true, departure: "below" });
    case "upmordent": return orn("mordent", { long: true, approach: "below" });
    case "downmordent": return orn("mordent", { long: true, approach: "above" });
    case "upbow": return { kind: "technical", name: "up-bow", placement };
    case "downbow": return { kind: "technical", name: "down-bow", placement };
    case "flageolet": return { kind: "technical", name: "harmonic", placement };
    case "open": return { kind: "technical", name: "open-string", placement };
    case "stopped": return { kind: "technical", name: "stopped", placement };
    case "thumb": return { kind: "technical", name: "thumb-position", placement };
    default:
      throw new Error(`no MusicXML mark for LilyPond articulation "${type}"`);
  }
}

/* ---- markup ----------------------------------------------------------- */

export interface MarkupValue {
  readonly text: string;
  readonly tree: unknown;
}

interface Run {
  text: string;
  italic: boolean;
  bold: boolean;
}

export type MarkupMeaning =
  | { readonly kind: "text"; readonly text: string; readonly italic: boolean; readonly bold: boolean }
  | { readonly kind: "dynamic"; readonly value: string }
  | { readonly kind: "segno" }
  | { readonly kind: "coda" };

/** Markup commands that change only size, position, or padding — the
 *  text they wrap is what is printed. */
const TRANSPARENT = new Set([
  "line-markup", "concat-markup", "center-align-markup", "right-align-markup", "left-align-markup",
  "fontsize-markup", "huge-markup", "large-markup", "larger-markup", "small-markup", "smaller-markup",
  "teeny-markup", "tiny-markup", "normalsize-markup", "raise-markup", "lower-markup", "whiteout-markup",
  "pad-markup-markup", "override-markup", "with-dimensions-markup", "rotate-markup", "halign-markup",
  "general-align-markup", "translate-markup", "box-markup", "circle-markup", "normal-text-markup",
  "sans-markup", "roman-markup", "typewriter-markup", "upright-markup", "medium-markup", "caps-markup",
  "smallCaps-markup", "vcenter-markup", "hcenter-in-markup", "pad-around-markup", "pad-x-markup",
  "abs-fontsize-markup", "magnify-markup", "tied-lyric-markup",
]);

const COLUMNS = new Set(["column-markup", "center-column-markup", "left-column-markup", "right-column-markup", "dir-column-markup"]);

const GLYPH_TEXT: Record<string, string> = {
  "flat-markup": "♭",
  "sharp-markup": "♯",
  "natural-markup": "♮",
  "doubleflat-markup": "𝄫",
  "doublesharp-markup": "𝄪",
};

const NOTE_GLYPH: Record<string, string> = { "1": "𝅝", "2": "𝅗𝅥", "4": "♩", "8": "♪", "16": "𝅘𝅥𝅯" };

/** Reads a markup (as dump.ly writes it: a string, an empty list, or
 *  text plus tree) into what it means. */
export function markupMeaning(value: unknown): MarkupMeaning {
  if (typeof value === "string") return { kind: "text", text: value, italic: false, bold: false };
  const m: MarkupValue = value && typeof value === "object" && "tree" in value
    ? (value as MarkupValue)
    : { text: "", tree: value ?? [] };
  const glyph = findGlyph(m.tree);
  if (glyph === "scripts.segno") return { kind: "segno" };
  if (glyph === "scripts.coda" || glyph === "scripts.varcoda") return { kind: "coda" };
  const runs: Run[] = [];
  let dynamicOnly = true;
  walk(m.tree, { italic: false, bold: false, dynamic: false }, runs, (d) => (dynamicOnly &&= d));
  const text = runs.map((r) => r.text).join("").replace(/\s+/g, " ").trim();
  if (dynamicOnly && text && /^[pmfsrzn]+$/.test(text)) return { kind: "dynamic", value: text };
  const printed = runs.filter((r) => r.text.trim());
  return {
    kind: "text",
    text: text || (m.text ?? "").trim(),
    italic: printed.length > 0 && printed.every((r) => r.italic),
    bold: printed.length > 0 && printed.every((r) => r.bold),
  };
}

type Style = { italic: boolean; bold: boolean; dynamic: boolean };

function walk(t: unknown, style: Style, out: Run[], seen: (dynamic: boolean) => void): void {
  if (typeof t === "string") {
    seen(style.dynamic);
    out.push({ text: t, italic: style.italic, bold: style.bold });
    return;
  }
  if (Array.isArray(t)) {
    t.forEach((x, i) => {
      if (i > 0) out.push({ text: " ", italic: style.italic, bold: style.bold });
      walk(x, style, out, seen);
    });
    return;
  }
  if (!t || typeof t !== "object") return;
  const node = t as { cmd?: string; args?: unknown[]; tree?: unknown };
  if (node.tree !== undefined) return walk(node.tree, style, out, seen);
  const cmd = node.cmd ?? "";
  const args = node.args ?? [];
  const markupArgs = args.filter((a) => typeof a === "string" || Array.isArray(a) || (a && typeof a === "object" && ("cmd" in a || "tree" in a)));
  const last = markupArgs.at(-1);
  if (cmd === "italic-markup") return walk(last, { ...style, italic: true }, out, seen);
  if (cmd === "bold-markup") return walk(last, { ...style, bold: true }, out, seen);
  if (cmd === "normal-weight-markup") return walk(last, { ...style, bold: false }, out, seen);
  if (cmd === "dynamic-markup") return walk(last, { ...style, dynamic: true }, out, seen);
  if (cmd === "finger-markup") return walk(last, style, out, seen);
  if (cmd === "hspace-markup") return void out.push({ text: " ", ...style });
  if (cmd in GLYPH_TEXT) {
    seen(false);
    return void out.push({ text: GLYPH_TEXT[cmd], ...style });
  }
  if (cmd === "note-markup") {
    seen(false);
    const dur = String(args[0] ?? "");
    const base = NOTE_GLYPH[dur.replace(/\.+$/, "")] ?? "♩";
    return void out.push({ text: base + (dur.match(/\./g) ?? []).join(""), ...style });
  }
  if (COLUMNS.has(cmd)) {
    const lines = Array.isArray(last) ? last : [last];
    lines.forEach((l, i) => {
      if (i > 0) out.push({ text: " ", ...style });
      walk(l, style, out, seen);
    });
    return;
  }
  if (cmd === "musicglyph-markup" || cmd === "score-markup") {
    // A glyph or an embedded score has no text; the caller decides.
    seen(false);
    return;
  }
  if (TRANSPARENT.has(cmd)) return walk(last, style, out, seen);
  throw new Error(`no text rendering for markup command ${cmd}`);
}

function findGlyph(t: unknown): string | undefined {
  if (Array.isArray(t)) {
    for (const x of t) {
      const g = findGlyph(x);
      if (g) return g;
    }
    return undefined;
  }
  if (!t || typeof t !== "object") return undefined;
  const node = t as { cmd?: string; args?: unknown[]; tree?: unknown };
  if (node.tree !== undefined) return findGlyph(node.tree);
  if (node.cmd === "musicglyph-markup") return String(node.args?.[0]);
  for (const a of node.args ?? []) {
    const g = findGlyph(a);
    if (g) return g;
  }
  return undefined;
}

/* ---- other vocabularies ---------------------------------------------- */

/** LilyPond's default rehearsal-mark letters: A–Z without I, then AA, AB … */
export function rehearsalLetters(n: number): string {
  const letters = "ABCDEFGHJKLMNOPQRSTUVWXYZ";
  let s = "";
  for (let k = n - 1; ; k = Math.floor(k / letters.length) - 1) {
    s = letters[k % letters.length] + s;
    if (k < letters.length) break;
  }
  return s;
}

const TYPES: Record<number, NoteType> = {
  [-3]: "maxima", [-2]: "long", [-1]: "breve", 0: "whole", 1: "half", 2: "quarter", 3: "eighth",
  4: "16th", 5: "32nd", 6: "64th", 7: "128th", 8: "256th", 9: "512th", 10: "1024th",
};

/** LilyPond's duration log (2 = quarter) as a MusicXML note type. */
export function noteType(log: number): NoteType {
  const t = TYPES[log];
  if (!t) throw new Error(`no note type for duration log ${log}`);
  return t;
}

/** Beams a note of this duration log carries: none for a quarter or longer. */
export const beamCount = (log: number): number => Math.max(0, log - 2);
