/* ====================================================================
   MUSICXML_IN — text -> score. The high-value input: unlike MIDI, a
   MusicXML note already states its own spelling (<step> + <alter>),
   so real flats and naturals flow straight through to StaffStd with
   ZERO renderer changes — the spelling field finally carries truth
   instead of a guess.

   Parses partwise files with the browser's DOMParser (no dependency).
   Per part it walks measures with a seconds cursor, honoring:
     <divisions>  — ticks per quarter (sets the seconds-per-division)
     <sound tempo>— BPM; default 120
     <chord>      — note shares the previous note's onset, no advance
     <backup>/<forward> — move the cursor (multi-voice / multi-staff)
     <tie>        — merge tied notes into one sustained note, matched in
                    time (not file order), same voice first
     <measure>    — a barline at each one's start, and one at the end;
                    the next begins where the measure's furthest voice
                    ended, wherever the last <backup> left the cursor
     <time>/<key> — the meter and key signature, carried on the barline
   Out of scope (kept isolated, like every limitation): timewise
   scores. Compressed .mxl arrives here already unwrapped by MxlIn.
   ==================================================================== */
import { Core } from "../core";
import type { Barline, Score, RawNote, Letter, Hand } from "../types";

// letter name -> semitones above C, within an octave
const STEP_SEMI: Record<Letter, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

const text = (el: Element, sel: string): string => {
  const n = el.querySelector(sel);
  return n ? (n.textContent ?? "").trim() : "";
};
const numOf = (el: Element, sel: string, dflt: number): number => {
  const v = text(el, sel);
  return v === "" ? dflt : parseFloat(v);
};

export function parse(src: string): Score {
  const doc = new DOMParser().parseFromString(src, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("Malformed XML.");
  const root = doc.documentElement;
  if (root.nodeName === "score-timewise")
    throw new Error("Timewise MusicXML isn't supported — export partwise.");
  if (root.nodeName !== "score-partwise")
    throw new Error("Not a MusicXML score (expected <score-partwise>).");

  // tempo is a property of time, not of a part; seed every part from the
  // first marking so a single-tempo piece is exact across all parts.
  const firstSound = root.querySelector("sound[tempo]");
  const initialTempo = firstSound ? parseFloat(firstSound.getAttribute("tempo")!) || 120 : 120;

  const notes: RawNote[] = [];
  // Barlines come from the FIRST part alone. Partwise MusicXML aligns
  // measures across parts by definition, so any part would give the same
  // answer and the first is simply the one that is always there; taking the
  // union would let a part whose voices come up short invent extra bars.
  const barlines: Barline[] = [];

  let partOrdinal = 0;
  for (const part of root.querySelectorAll(":scope > part")) {
    partOrdinal++;
    // The hand is decided ONCE PER PART, in this part's own namespace, by
    // asking whether the part is multi-staff — piano-style, where staff 1 is
    // the upper hand and the rest are lower — or a single voice among several,
    // where its ORDINAL decides. A part is multi-staff only if it actually has
    // more than one staff: <attributes><staves> says so outright, and failing
    // that, more than one distinct <staff> value does.
    //
    // Note that "declares any <staff> at all" is NOT the test. An SATB export
    // gives every part a lone <staff>1</staff>, so that reading collapsed all
    // four parts onto staff 1 — which is precisely what letting the <staff>
    // namespace and the ordinal namespace coexist per note used to cost.
    const declared = numOf(part, "attributes > staves", 1);
    const distinct = new Set(
      [...part.querySelectorAll("staff")].map((e) => e.textContent?.trim()),
    ).size;
    const multiStaff = declared > 1 || distinct > 1;
    let divisions = 1; // divisions per quarter note (from <attributes>)
    let tempo = initialTempo;
    let cursor = 0; // seconds from piece start
    let lastOnset = 0; // onset of the previous note, for <chord>
    const tied: TiedNote[] = []; // this part's notes, before ties are joined

    const secPerDiv = () => 60 / tempo / divisions;

    for (const measure of part.querySelectorAll(":scope > measure")) {
      // the post is made first and filled in as the measure's <attributes>
      // are met — they come inside the measure they govern.
      const post: { at: number; beats?: number; unit?: number; fifths?: number } = { at: cursor };
      if (partOrdinal === 1) barlines.push(post);
      let reached = cursor; // the furthest any voice got in this measure
      for (const el of measure.children) {
        reached = Math.max(reached, cursor);
        switch (el.nodeName) {
          case "attributes": {
            const d = numOf(el, ":scope > divisions", NaN);
            if (!Number.isNaN(d) && d > 0) divisions = d;
            const beats = numOf(el, ":scope > time > beats", NaN);
            const unit = numOf(el, ":scope > time > beat-type", NaN);
            if (beats > 0 && unit > 0) Object.assign(post, { beats, unit });
            const fifths = numOf(el, ":scope > key > fifths", NaN);
            if (!Number.isNaN(fifths)) post.fifths = fifths;
            break;
          }
          case "sound":
          case "direction": {
            const snd = el.nodeName === "sound" ? el : el.querySelector("sound[tempo]");
            const bpm = snd && parseFloat(snd.getAttribute("tempo")!);
            if (bpm) tempo = bpm;
            break;
          }
          case "backup":
            cursor = Math.max(0, cursor - numOf(el, ":scope > duration", 0) * secPerDiv());
            break;
          case "forward":
            cursor += numOf(el, ":scope > duration", 0) * secPerDiv();
            break;
          case "note": {
            if (el.querySelector(":scope > grace")) break; // no duration; skip
            const durSec = numOf(el, ":scope > duration", 0) * secPerDiv();
            const isChord = !!el.querySelector(":scope > chord");

            // onset is taken BEFORE advancing; a chord note reuses the
            // previous onset and leaves the cursor where it is.
            const onset = isChord ? lastOnset : cursor;
            if (!isChord) {
              lastOnset = cursor;
              cursor += durSec;
            }

            const pitchEl = el.querySelector(":scope > pitch");
            if (!pitchEl) break; // rest or unpitched

            const step = text(pitchEl, "step");
            const octave = parseInt(text(pitchEl, "octave"), 10);
            const alter = Math.round(numOf(pitchEl, "alter", 0));
            if (!(step in STEP_SEMI) || Number.isNaN(octave)) break;

            const pitch = 12 * (octave + 1) + STEP_SEMI[step as Letter] + alter;
            // the spelling is stated, not guessed — this is the whole point.
            // (double accidentals collapse to one glyph; position is by letter.)
            const acc = alter > 0 ? "#" : alter < 0 ? "b" : "";
            const spelling = { letter: step as Letter, acc } as const;

            const tieTypes = [...el.querySelectorAll(":scope > tie")].map((t) => t.getAttribute("type"));

            // provenance in this part's namespace, and the hand resolved from
            // it by the rule chosen above for the whole part.
            const stream = multiStaff ? numOf(el, ":scope > staff", 1) : partOrdinal;
            const hand: Hand = stream === 1 ? "upper" : "lower";

            tied.push({
              note: { pitch, spelling, onset, duration: Math.max(0.02, durSec), hand, stream },
              end: onset + durSec,
              voice: text(el, ":scope > voice"),
              stream,
              start: tieTypes.includes("start"),
              stop: tieTypes.includes("stop"),
            });
            break;
          }
        }
      }
      cursor = Math.max(reached, cursor);
    }
    notes.push(...joinTies(tied));
    // the closing post: where the last measure's content left the cursor.
    if (partOrdinal === 1) barlines.push({ at: cursor });
  }

  if (!notes.length) throw new Error("No pitched notes found in score.");
  return Core.makeScore(notes, barlines);
}

interface TiedNote {
  note: RawNote;
  /** Exact end, before the minimum audible duration is applied. */
  end: number;
  voice: string;
  stream: number;
  start: boolean;
  stop: boolean;
}

// Seconds are sums of float divisions; two instants this close are one.
const SAME_TIME = 1e-6;

/** Joins tied notes into single sustained notes. A tie-stop continues the
 *  open tie on its pitch that ends exactly where it begins — the same
 *  voice's if there is one, else the same staff's, else any — so ties
 *  resolve by time, whatever order the file wrote its voices in. A stop
 *  with no such tie is a note of its own. */
function joinTies(tied: TiedNote[]): RawNote[] {
  const byTime = [...tied].sort((a, b) => a.note.onset - b.note.onset);
  const open: TiedNote[] = [];
  const out: RawNote[] = [];
  for (const t of byTime) {
    if (t.stop) {
      const ends = open.filter((o) => o.note.pitch === t.note.pitch && Math.abs(o.end - t.note.onset) < SAME_TIME);
      const held = ends.find((o) => o.voice === t.voice) ?? ends.find((o) => o.stream === t.stream) ?? ends[0];
      if (held) {
        held.end = t.end;
        held.note.duration = held.end - held.note.onset;
        held.voice = t.voice;
        held.stream = t.stream;
        if (!t.start) open.splice(open.indexOf(held), 1); // chain fully closed
        continue;
      }
    }
    out.push(t.note);
    if (t.start) open.push(t);
  }
  return out;
}

export const MusicxmlIn = { parse };
