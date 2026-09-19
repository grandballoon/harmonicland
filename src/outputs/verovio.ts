/* ====================================================================
   VEROVIO — the engraving engine, and the one module that knows it
   exists. Verovio (verovio.org) sets an MEI document as pages of SVG,
   placing every glyph by engraving rules — spacing, collisions, beam
   slopes, slurs that bend around what they pass — that a hand-built
   engraver approximates. mei.ts says what the music is; this sets it.

   It owns three things:

   1. LOADING. The engine is a WebAssembly build of a C++ library, several
      megabytes, so it is fetched once, on demand, and asynchronously.
      Until it has arrived `engrave` answers null and the caller draws
      without it; nothing here blocks a frame.

   2. OPTIONS. The page is set to a size given in the caller's pixels, and
      the staff space it is set at is the caller's too, so a page from
      here and a page from the built-in engraver are the same paper with
      the music at the same size.

   3. GEOMETRY. A page comes back as SVG, but the caller has to hit-test
      bars, follow a line, and light a note — so each page is read once
      for where its systems, bars and noteheads landed, in the page's own
      pixels. It reads what Verovio drew rather than asking Verovio to
      predict it, so the two cannot disagree.

   The engine is module state, like a cache: `engrave` is a function of
   its arguments once the engine is loaded, and the only thing loading
   changes is whether it answers at all.
   ==================================================================== */
import type { VerovioToolkit } from "verovio/esm";
import { barOfMeasureId } from "./mei";

/** A page to set, in the caller's pixels. */
export interface PageSpec {
  readonly width: number;
  readonly height: number;
  readonly margin: { readonly top: number; readonly bottom: number; readonly left: number; readonly right: number };
  /** The distance between two staff lines. */
  readonly space: number;
}

/** One bar on a system: where its staff lines begin and end. */
export interface VrvBar {
  readonly index: number;
  readonly x0: number;
  readonly x1: number;
}

/** One line of music: its bars, and the top and bottom staff lines. */
export interface VrvSystem {
  readonly top: number;
  readonly bottom: number;
  readonly bars: readonly VrvBar[];
}

/** One engraved page, and where things landed on it — all in the page's
 *  own pixels, origin at its top left. */
export interface VrvPage {
  /** An <svg> exactly `width` by `height`, ready to place. */
  readonly svg: string;
  readonly systems: readonly VrvSystem[];
  /** Each notehead's centre, by the id mei.ts gave it. */
  readonly heads: ReadonlyMap<string, { readonly x: number; readonly y: number; readonly system: number }>;
}

// --- 1. loading ---------------------------------------------------------------

let toolkit: VerovioToolkit | null = null;
let loading: Promise<boolean> | null = null;

/** Fetch and start the engine. Idempotent; resolves false, once and for
 *  good, if the engine cannot run here. */
export function load(): Promise<boolean> {
  loading ??= (async () => {
    const [{ default: createModule }, { VerovioToolkit }] = await Promise.all([
      import("verovio/wasm"),
      import("verovio/esm"),
    ]);
    toolkit = new VerovioToolkit(await createModule());
    return true;
  })().catch((e: unknown) => {
    console.error("Verovio could not start; the built-in engraver stays.", e);
    return false;
  });
  return loading;
}

export const ready = (): boolean => toolkit !== null;

// --- 2. options -----------------------------------------------------------------

/** Verovio's own unit: half a staff space, at its default size. */
const UNIT = 9;

function optionsFor(spec: PageSpec): Record<string, unknown> {
  // everything Verovio measures is in its units; one of ours is this many
  const perPx = (2 * UNIT) / spec.space;
  const u = (px: number): number => Math.round(px * perPx);
  return {
    pageWidth: u(spec.width),
    pageHeight: u(spec.height),
    pageMarginTop: u(spec.margin.top),
    pageMarginBottom: u(spec.margin.bottom),
    pageMarginLeft: u(spec.margin.left),
    pageMarginRight: u(spec.margin.right),
    unit: UNIT,
    scale: 100,
    font: "Leland",
    breaks: "auto",
    // closer than Verovio's defaults, which are for print: the music here
    // is twice print size, and a sheet should hold as many lines as the
    // built-in page does
    spacingStaff: 6,
    spacingSystem: 4,
    adjustPageHeight: false,
    justifyVertically: true,
    header: "none",
    footer: "none",
    svgRemoveXlink: true,
    svgFormatRaw: true,
    // the same score sets to the same ids, and so to the same string
    xmlIdSeed: 1,
  };
}

// --- 3. geometry ----------------------------------------------------------------

const nums = (s: string | null): number[] => (s ?? "").match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];

/** Verovio names each page's svg — and scopes its glyphs and stylesheet
 *  by that name — the same on every page of a document, so two pages on
 *  one screen would share ids. Each is renamed for its page number. The
 *  name only ever appears whole, or after `#` or `-` (a glyph's id). */
function ownIds(svg: string, page: number): string {
  const id = /^<svg\b[^>]*\bid="([^"]+)"/.exec(svg)?.[1];
  return id ? svg.replace(new RegExp(`(?<=["#-])${id}(?=[" ])`, "g"), `${id}p${page}`) : svg;
}

/** Read one page Verovio drew. `svg` is its output with its own ids. */
function readPage(svg: string, spec: PageSpec): VrvPage {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const inner = doc.querySelector("svg.definition-scale");
  const [, , vbW] = nums(inner?.getAttribute("viewBox") ?? null);
  const [mx = 0, my = 0] = nums(doc.querySelector("g.page-margin")?.getAttribute("transform") ?? null);
  const k = vbW ? spec.width / vbW : 1;
  const X = (x: number): number => (x + mx) * k;
  const Y = (y: number): number => (y + my) * k;

  const systems: VrvSystem[] = [];
  const heads = new Map<string, { x: number; y: number; system: number }>();
  doc.querySelectorAll("g.system").forEach((sys) => {
    let top = Infinity;
    let bottom = -Infinity;
    let space = Infinity;
    const bars: VrvBar[] = [];
    sys.querySelectorAll("g.measure").forEach((m) => {
      const index = barOfMeasureId(m.id);
      if (index === null) return;
      let x0 = Infinity;
      let x1 = -Infinity;
      m.querySelectorAll(":scope > g.staff").forEach((staff) => {
        const ys: number[] = [];
        staff.querySelectorAll(":scope > path").forEach((line) => {
          const [xa, ya, xb] = nums(line.getAttribute("d"));
          x0 = Math.min(x0, xa, xb);
          x1 = Math.max(x1, xa, xb);
          ys.push(ya);
        });
        ys.sort((a, b) => a - b);
        for (let i = 1; i < ys.length; i++) space = Math.min(space, ys[i] - ys[i - 1]);
        top = Math.min(top, ...ys);
        bottom = Math.max(bottom, ...ys);
      });
      if (x1 > x0) bars.push({ index, x0: X(x0), x1: X(x1) });
    });
    if (!bars.length) return;
    // a head's use is placed at its left edge; its centre is a little over
    // half a space in, which is what a notehead measures across
    const half = Number.isFinite(space) ? 0.6 * space : 0;
    sys.querySelectorAll("g.note").forEach((note) => {
      const use = note.querySelector(":scope > g.notehead > use");
      if (!use) return;
      const [x, y] = nums(use.getAttribute("transform"));
      heads.set(note.id, { x: X(x + half), y: Y(y), system: systems.length });
    });
    systems.push({ top: Y(top), bottom: Y(bottom), bars });
  });

  // the page's own size, in pixels, whatever Verovio called it
  const sized = svg.replace(/^<svg\b[^>]*?\bwidth="[^"]*"\s+height="[^"]*"/,
    (tag) => tag.replace(/\bwidth="[^"]*"\s+height="[^"]*"/, `width="${spec.width}" height="${spec.height}"`));
  return { svg: sized, systems, heads };
}

/** Set an MEI document as pages of `spec`, or null while the engine is not
 *  loaded. An empty or unreadable document is no pages. */
export function engrave(mei: string, spec: PageSpec): VrvPage[] | null {
  const tk = toolkit;
  if (!tk) return null;
  if (!mei) return [];
  tk.setOptions(optionsFor(spec));
  if (!tk.loadData(mei)) return [];
  const pages: VrvPage[] = [];
  for (let p = 1; p <= tk.getPageCount(); p++) pages.push(readPage(ownIds(tk.renderToSVG(p), p), spec));
  return pages;
}

export const Verovio = { load, ready, engrave };
