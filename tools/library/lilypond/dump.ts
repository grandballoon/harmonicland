/* ====================================================================
   DUMP — dump.ly's JSON lines, read into typed records.

   The shapes here mirror what dump.ly writes and nothing more; the
   meaning of any record is decided in to-score.ts. Moments become
   exact Fractions on the way in. Properties stay loosely typed
   (`Props`), because LilyPond's property set is open-ended — each
   consumer asks for exactly the property it understands.
   ==================================================================== */
import { readFileSync } from "node:fs";
import { Fraction } from "../score/fraction.ts";

/** A LilyPond moment: main time plus grace time, both in whole notes. */
export interface Moment {
  readonly main: Fraction;
  readonly grace: Fraction;
}

export const cmpMoment = (a: Moment, b: Moment): number => a.main.cmp(b.main) || a.grace.cmp(b.grace);

export type Props = Record<string, unknown>;

export interface Origin {
  readonly file: string;
  readonly line: number;
  readonly col: number;
}

export interface ContextRecord {
  readonly id: number;
  readonly type: string;
  readonly name: string;
  readonly parent: number | null;
}

export interface VoiceRecord extends ContextRecord {
  readonly at: Moment;
  readonly staff: number | null;
}

export interface EventRecord {
  readonly id: number;
  readonly voice: number | null;
  readonly staff: number | null;
  readonly at: Moment;
  readonly class: string;
  readonly props: Props;
  readonly state: Props;
  readonly origin: Origin | null;
}

export interface StaffStateRecord {
  readonly staff: number;
  readonly at: Moment;
  readonly props: Props;
}

export interface StepRecord {
  readonly at: Moment;
  readonly props: Props;
}

export type GrobRecord =
  | { readonly grob: "Accidental" | "AccidentalCautionary" | "AccidentalSuggestion"; readonly event: number | null; readonly alteration: Fraction; readonly parenthesized: boolean }
  | { readonly grob: "Beam"; readonly stems: readonly (readonly number[])[] }
  | { readonly grob: "Tie"; readonly from: number | null; readonly to: number | null }
  | { readonly grob: "BarLine"; readonly at: Moment; readonly staff: number | null; readonly glyph: string | null; readonly hidden: boolean };

/** Everything one engraved \score produced. */
export interface ScoreDump {
  readonly index: number;
  readonly header: { readonly book: Props; readonly score: Props } | null;
  readonly staves: readonly ContextRecord[];
  readonly voices: readonly VoiceRecord[];
  readonly events: readonly EventRecord[];
  readonly staffStates: readonly StaffStateRecord[];
  readonly steps: readonly StepRecord[];
  readonly grobs: readonly GrobRecord[];
}

export function moment(x: unknown): Moment {
  const m = x as { main: string; grace: string };
  return { main: Fraction.parse(m.main), grace: Fraction.parse(m.grace) };
}

const num = (x: unknown): number | null => (x === null || x === undefined ? null : Number(x));

/** Reads a dump file. Scores come back in engraving order; each is
 *  paired with the header recorded when it was parsed. */
export function readDump(path: string): ScoreDump[] {
  const headers: { book: Props; score: Props }[] = [];
  const scores: {
    index: number;
    staves: ContextRecord[];
    voices: VoiceRecord[];
    events: EventRecord[];
    staffStates: StaffStateRecord[];
    steps: StepRecord[];
    grobs: GrobRecord[];
  }[] = [];
  const current = () => {
    const s = scores.at(-1);
    if (!s) throw new Error(`${path}: record before any score`);
    return s;
  };

  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const r = JSON.parse(line) as Props & { kind: string };
    switch (r.kind) {
      case "header":
        headers.push({ book: r.book as Props, score: r.score as Props });
        break;
      case "score":
        scores.push({ index: Number(r.index), staves: [], voices: [], events: [], staffStates: [], steps: [], grobs: [] });
        break;
      case "staff":
        current().staves.push(context(r));
        break;
      case "voice":
        current().voices.push({ ...context(r), at: moment(r.at), staff: num(r.staff) });
        break;
      case "event":
        current().events.push({
          id: Number(r.id),
          voice: num(r.voice),
          staff: num(r.staff),
          at: moment(r.at),
          class: String(r.class),
          props: r.props as Props,
          state: (r.state as Props) ?? {},
          origin: (r.origin as Origin) ?? null,
        });
        break;
      case "staff-state":
        current().staffStates.push({ staff: Number(r.staff), at: moment(r.at), props: r.props as Props });
        break;
      case "step":
        current().steps.push({ at: moment(r.at), props: r.props as Props });
        break;
      case "grob":
        current().grobs.push(grob(r));
        break;
      default:
        throw new Error(`${path}: unknown record kind ${r.kind}`);
    }
  }
  return scores.map((s, i) => ({ ...s, header: headers[i] ?? null }));
}

function context(r: Props): ContextRecord {
  return { id: Number(r.id), type: String(r.type), name: String(r.name), parent: num(r.parent) };
}

function grob(r: Props): GrobRecord {
  switch (r.grob) {
    case "Accidental":
    case "AccidentalCautionary":
    case "AccidentalSuggestion":
      return {
        grob: r.grob,
        event: num(r.event),
        alteration: Fraction.parse(String(r.alteration)),
        parenthesized: r.parenthesized === true,
      };
    case "Beam":
      return { grob: "Beam", stems: (r.stems as string[][]).map((heads) => heads.map(Number).filter(Number.isFinite)) };
    case "Tie":
      return { grob: "Tie", from: num(r.from), to: num(r.to) };
    case "BarLine":
      return { grob: "BarLine", at: moment(r.at), staff: num(r.staff), glyph: (r.glyph as string | null) ?? null, hidden: r.hidden === true };
    default:
      throw new Error(`unknown grob record ${String(r.grob)}`);
  }
}
