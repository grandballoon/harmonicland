/* ====================================================================
   COMPAT — the few old-API spellings convert-ly does not upgrade.

   convert-ly rewrites LilyPond syntax rule by rule, but a handful of
   Scheme-level APIs changed shape without a rule. Each entry here is
   one such change: an exact old spelling, its current equivalent, and
   why the two mean the same thing. Nothing musical is ever edited —
   only how the same value is written. Every application is counted
   and reported in the conversion log, so no rewrite is silent.
   ==================================================================== */

export interface CompatRule {
  readonly name: string;
  readonly why: string;
  readonly pattern: RegExp;
  readonly replace: (...groups: string[]) => string;
  /** Applies only to files this accepts; absent means every file. */
  readonly only?: (text: string) => boolean;
}

export const COMPAT_RULES: readonly CompatRule[] = [
  {
    name: "make-moment-4",
    why:
      "ly:make-moment once took (main-num main-den grace-num grace-den); it now " +
      "takes one rational. With a zero grace part, (ly:make-moment a b 0 0) is a/b.",
    pattern: /\(ly:make-moment\s+(\d+)\s+(\d+)\s+0\s+0\s*\)/g,
    replace: (_m, a, b) => `(ly:make-moment ${a}/${b})`,
  },
  {
    name: "set-octavation",
    why: "#(set-octavation n) was the Scheme spelling of what is now \\ottava #n.",
    pattern: /#\(set-octavation\s+(-?\d+)\s*\)/g,
    replace: (_m, n) => `\\ottava #${n}`,
  },
  {
    name: "beat-length",
    why:
      "Score.beatLength (≤ 2.12) set the unit beams subdivide at; that unit is " +
      "now Score.beatBase, a rational rather than a moment. convert-ly leaves " +
      "the old name with the value spelled \\musicLength d*n, which is n/d.",
    pattern: /\\set\s+Score\.beatLength\s*=\s*\\musicLength\s+(\d+)\*(\d+)/g,
    replace: (_m, d, n) => `\\set Score.beatBase = #${n}/${d}`,
  },
  {
    name: "script-name-symbols",
    why:
      "Script names in script alists and make-articulation were strings; since " +
      "2.23 they are symbols, so a custom articulation built on \"tenuto\" must say 'tenuto.",
    pattern: /\((make-articulation|acons|assoc-ref\s+[\w-]*script-alist)\s+"([\w-]+)"/g,
    replace: (_m, head, name) => `(${head} '${name}`,
    only: (text) => /script-alist/.test(text),
  },
  {
    name: "script-alist-mutation",
    why:
      "#(assoc-set! (assoc-ref alist 'name) 'key v) edits a script's entry in " +
      "place, which Guile 3 refuses when the entry is a literal. Prepending a " +
      "copy of the entry with key set to v gives every lookup the same answer.",
    pattern: /#\(assoc-set!\s+\(assoc-ref\s+([\w-]*script-alist)\s+'([\w-]+)\)\s+'([\w-]+)\s+([^()\s]+)\s*\)/g,
    replace: (_m, alist, name, key, v) =>
      `#(set! ${alist} (acons '${name} (acons '${key} ${v} (assoc-ref ${alist} '${name})) ${alist}))`,
  },
  {
    name: "paper-conditional-define",
    why:
      "A \\paper block's #(if … (define system-count n)) is Guile 1.8 syntax that " +
      "Guile 3 rejects. It only chose how many systems fill a page — page layout, " +
      "which this pipeline never reads — so it is removed.",
    pattern: /#\(if\s+\(equal\?\s+paper-width\s+\([^()]*\)\)\s*\(define\s+system-count\s+\d+\)\s*\)/g,
    replace: () => "",
  },
];

export interface CompatApplied {
  readonly rule: string;
  readonly count: number;
}

export function applyCompat(text: string): { text: string; applied: CompatApplied[] } {
  const applied: CompatApplied[] = [];
  for (const rule of COMPAT_RULES) {
    if (rule.only && !rule.only(text)) continue;
    let count = 0;
    text = text.replace(rule.pattern, (...args: string[]) => {
      count++;
      return rule.replace(...args);
    });
    if (count) applied.push({ rule: rule.name, count });
  }
  return { text, applied };
}
