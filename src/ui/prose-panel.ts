/* ====================================================================
   PROSE_PANEL — where the spoken score is put on screen.

   The counterpart to `outputs/prose.ts`, split from it for the reason
   every other output is split from its renderer: the sentences are a
   pure function of the score and the instrument, and the DOM is not.
   This file holds the half that touches the document and knows no music
   at all — hand it `Line[]` and it will lay them out; it never asks
   where they came from, and it is the same shape of module as
   `ui/gamepad-remap.ts`.

   One decision worth stating: the panel renders the whole list at once
   rather than following the playhead. These instructions have no time in
   them (see the header of `outputs/prose.ts`), so there is no "current"
   line to highlight — the player reads at their own pace, which is the
   entire point of an output you can follow with your eyes on the keys.
   ==================================================================== */
import type { Line } from "../outputs/prose";

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K, cls?: string, txt?: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (txt) node.textContent = txt;
  return node;
};

/** How far a nested figure's detail sits in, per level. */
const INDENT_PX = 14;

const lineNode = (line: Line): HTMLLIElement => {
  const li = el("li", `prose-line ${line.kind}`);
  li.style.paddingLeft = `${line.depth * INDENT_PX}px`;
  // The state number is a handle, not decoration: it is what a reader
  // counts by when they lose their place, and what ties a sentence back
  // to the sonority it came from.
  li.append(el("span", "n", String(line.state)), el("span", "t", line.text));
  return li;
};

/** A one-line reading of the list itself, so the panel says how much work
 *  it is before the player scrolls through it. */
const summarise = (lines: readonly Line[]): string => {
  const unplayable = lines.filter((l) => l.kind === "unplayable").length;
  const figures = lines.filter((l) => l.kind === "figure").length;
  return (
    `${lines.length} instruction${lines.length === 1 ? "" : "s"}` +
    (figures ? ` · ${figures} repeated figure${figures === 1 ? "" : "s"}` : "") +
    (unplayable ? ` · ${unplayable} unplayable` : "")
  );
};

/** Fill `host` with the instruction list (replacing whatever was there).
 *  An empty list is a state the panel renders rather than hides from: a
 *  score with no notes is a real thing to load. */
export function render(host: HTMLElement, lines: readonly Line[], caption: string): void {
  const head = el("div", "prose-head");
  head.append(el("span", "prose-title", caption), el("span", "prose-count", summarise(lines)));

  if (!lines.length) {
    host.replaceChildren(head, el("p", "prose-empty", "Load a score to read it back as instructions."));
    return;
  }
  const list = el("ol", "prose-list");
  for (const line of lines) list.appendChild(lineNode(line));
  host.replaceChildren(head, list);
  list.scrollTop = 0;
}

export const ProsePanel = { render };
