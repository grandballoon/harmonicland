/* ====================================================================
   VERIFY — a converted MusicXML file, checked against LilyPond's MIDI.

   The witnesses are LilyPond's own performances of the very music it
   engraved (dump.ly renders them), so they come from LilyPond's
   performers, not from the event dump the MusicXML was built from.
   Everything is read by the APP'S OWN parsers — MusicxmlIn and MidiIn —
   so what is checked is exactly what the app will play.

     by voice   graces removed, a track per voice: every note of the
                MusicXML must be here with the same pitch, onset, and
                length, and nothing else may be
     by staff   graces kept, a track per staff: each note must be in the
                same hand, and the notes the first witness lacks must be
                exactly the MusicXML's grace notes, pitch for pitch

   Tempo is taken out (the MusicXML's <sound tempo> is stripped and the
   MIDI has none), so both sides run at 120 bpm.
   ==================================================================== */
import { JSDOM } from "jsdom";
import { MidiIn } from "../../src/inputs/midi.ts";
import { MusicxmlIn } from "../../src/inputs/musicxml.ts";
import type { Note, Score } from "../../src/types.ts";

/** Half a MIDI tick at LilyPond's 384 per quarter, 120 bpm, is 0.65 ms;
 *  anything further apart is a different time. */
const TOLERANCE = 0.002;

export interface Verification {
  readonly ok: boolean;
  readonly notes: number;
  readonly graces: number;
  readonly problems: readonly string[];
}

export interface Witnesses {
  readonly byVoice: Uint8Array;
  readonly byStaff: Uint8Array;
}

function ensureDom(): void {
  if (typeof globalThis.DOMParser === "undefined") globalThis.DOMParser = new JSDOM().window.DOMParser;
}

const midi = (bytes: Uint8Array): Score =>
  MidiIn.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);

const at = (n: Note) => `${n.pitch}@${n.onset.toFixed(3)}s`;

export function verify(musicxml: string, witnesses: Witnesses, gracePitches: readonly number[]): Verification {
  ensureDom();
  const xml = MusicxmlIn.parse(musicxml.replace(/<sound\b[^>]*\/>/g, "")).notes;
  const byVoice = midi(witnesses.byVoice).notes;
  const byStaff = midi(witnesses.byStaff).notes;
  const problems: string[] = [];

  // Every note, exactly: pitch, onset, and length.
  const exact = match(xml, byVoice);
  for (const [i, j] of exact.pairs) {
    if (Math.abs(xml[i].duration - byVoice[j].duration) > TOLERANCE) {
      problems.push(`${at(xml[i])} lasts ${xml[i].duration.toFixed(3)}s; LilyPond plays ${byVoice[j].duration.toFixed(3)}s`);
    }
  }
  for (const i of exact.unmatchedA) problems.push(`MusicXML note ${at(xml[i])} is not in LilyPond's performance`);
  for (const j of exact.unmatchedB) problems.push(`LilyPond plays ${at(byVoice[j])}, which the MusicXML lacks`);

  // Hands: a staff's track holds unisons within it as one note, so each
  // MusicXML note needs its pitch at its onset in its own hand's track.
  const inTrack = new Set(byStaff.map((n) => `${n.hand}|${n.pitch}|${Math.round(n.onset / TOLERANCE)}`));
  const heard = (n: Note, hand: Note["hand"]) =>
    [-1, 0, 1].some((d) => inTrack.has(`${hand}|${n.pitch}|${Math.round(n.onset / TOLERANCE) + d}`));
  for (const n of xml) {
    if (heard(n, n.hand)) continue;
    const other = n.hand === "upper" ? "lower" : "upper";
    problems.push(heard(n, other)
      ? `${at(n)} is in the ${n.hand} hand; LilyPond has it in the ${other}`
      : `${at(n)} is in neither of LilyPond's staff tracks`);
  }

  // Graces: what the staff rendering has beyond the voice rendering.
  const extra = match(byStaff, byVoice).unmatchedA.map((j) => byStaff[j].pitch).sort((a, b) => a - b);
  const graces = [...gracePitches].sort((a, b) => a - b);
  if (extra.join() !== graces.join()) {
    const more = diff(extra, graces);
    const fewer = diff(graces, extra);
    if (more.length) problems.push(`LilyPond plays grace notes the MusicXML lacks: pitches ${more.join(", ")}`);
    if (fewer.length) problems.push(`MusicXML grace notes LilyPond does not play: pitches ${fewer.join(", ")}`);
  }
  return { ok: problems.length === 0, notes: xml.length, graces: graces.length, problems };
}

/** Matching in time order: same pitch, onsets within tolerance, and of
 *  those (two voices in unison) the closest in length. */
function match(a: readonly Note[], b: readonly Note[]): { pairs: [number, number][]; unmatchedA: number[]; unmatchedB: number[] } {
  const used = new Set<number>();
  const pairs: [number, number][] = [];
  const unmatchedA: number[] = [];
  let cursor = 0;
  a.forEach((n, i) => {
    while (cursor < b.length && b[cursor].onset < n.onset - TOLERANCE) cursor++;
    let best = -1;
    for (let j = cursor; j < b.length && b[j].onset <= n.onset + TOLERANCE; j++) {
      if (used.has(j) || b[j].pitch !== n.pitch) continue;
      if (best < 0 || Math.abs(b[j].duration - n.duration) < Math.abs(b[best].duration - n.duration)) best = j;
    }
    if (best < 0) return void unmatchedA.push(i);
    used.add(best);
    pairs.push([i, best]);
  });
  const unmatchedB = b.map((_, j) => j).filter((j) => !used.has(j));
  return { pairs, unmatchedA, unmatchedB };
}

/** Multiset a − b. */
function diff(a: readonly number[], b: readonly number[]): number[] {
  const count = new Map<number, number>();
  for (const x of b) count.set(x, (count.get(x) ?? 0) + 1);
  const out: number[] = [];
  for (const x of a) {
    const c = count.get(x) ?? 0;
    if (c) count.set(x, c - 1);
    else out.push(x);
  }
  return out;
}
