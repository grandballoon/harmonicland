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
     <tie>        — merge tied notes into one sustained note
   Out of scope (kept isolated, like every limitation): compressed
   .mxl (a zip) and timewise scores.
   ==================================================================== */
import { Core } from "../core";
import type { Score, RawNote, Letter } from "../types";

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

  for (const part of root.querySelectorAll(":scope > part")) {
    let divisions = 1; // divisions per quarter note (from <attributes>)
    let tempo = initialTempo;
    let cursor = 0; // seconds from piece start
    let lastOnset = 0; // onset of the previous note, for <chord>
    const open = new Map<number, RawNote>(); // pitch -> note kept open by a tie

    const secPerDiv = () => 60 / tempo / divisions;

    for (const measure of part.querySelectorAll(":scope > measure")) {
      for (const el of measure.children) {
        switch (el.nodeName) {
          case "attributes": {
            const d = numOf(el, ":scope > divisions", NaN);
            if (!Number.isNaN(d) && d > 0) divisions = d;
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

            // ties: <tie type="stop"> extends the matching open note rather
            // than emitting a new one; <tie type="start"> keeps it open.
            const tieTypes = [...el.querySelectorAll(":scope > tie")].map((t) => t.getAttribute("type"));
            const tieStart = tieTypes.includes("start");
            const tieStop = tieTypes.includes("stop");

            if (tieStop && open.has(pitch)) {
              const held = open.get(pitch)!;
              held.duration = onset + durSec - held.onset;
              if (!tieStart) open.delete(pitch); // chain fully closed
              break;
            }

            const note: RawNote = { pitch, spelling, onset, duration: Math.max(0.02, durSec) };
            notes.push(note);
            if (tieStart) open.set(pitch, note);
            break;
          }
        }
      }
    }
  }

  if (!notes.length) throw new Error("No pitched notes found in score.");
  return Core.makeScore(notes);
}

export const MusicxmlIn = { parse };
