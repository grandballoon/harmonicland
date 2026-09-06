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
     <staff>      — which printed staff the note sits on, carried onto the
                    note so a consumer can say "right hand" without guessing
                    from pitch. Stated per note, so cross-staff writing is
                    honest; absent for single-staff parts.
   It also emits the BAR GRID: each measure's start in seconds, labelled
   with the number the score itself prints, so bar 17 here is bar 17 on
   the page (pickups and repeat-lettered bars included). Measures come
   from the first part — in a partwise score every part shares one grid.
   Out of scope (kept isolated, like every limitation): compressed
   .mxl (a zip) and timewise scores.
   ==================================================================== */
import { Core } from "../core";
import type { Score, RawNote, Letter, Bar } from "../types";

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
  const bars: Bar[] = [];

  const parts = [...root.querySelectorAll(":scope > part")];
  for (const [partIndex, part] of parts.entries()) {
    let divisions = 1; // divisions per quarter note (from <attributes>)
    let tempo = initialTempo;
    let cursor = 0; // seconds from piece start
    let lastOnset = 0; // onset of the previous note, for <chord>
    let measureStart = 0; // seconds at the current measure's barline
    const open = new Map<number, RawNote>(); // pitch -> note kept open by a tie

    const secPerDiv = () => 60 / tempo / divisions;

    for (const measure of part.querySelectorAll(":scope > measure")) {
      // Each measure restarts at its own barline, and ends at the FURTHEST
      // the cursor reached inside it — that is what makes <backup> (voice 2
      // rewinding to the barline) land the next measure correctly, and it
      // measures a short pickup bar honestly instead of assuming 4/4.
      cursor = measureStart;
      let measureEnd = measureStart;
      if (partIndex === 0)
        bars.push({
          time: measureStart,
          label: (measure.getAttribute("number") ?? "").trim() || String(bars.length + 1),
        });

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

            // <staff> is stated per note, so cross-staff writing lands on the
            // staff it is PRINTED on rather than the one its voice began in.
            // Absent (single-staff parts) leaves the field off entirely.
            const staff = numOf(el, ":scope > staff", NaN);
            const note: RawNote = {
              pitch,
              spelling,
              onset,
              duration: Math.max(0.02, durSec),
              ...(Number.isNaN(staff) ? {} : { staff }),
            };
            notes.push(note);
            if (tieStart) open.set(pitch, note);
            break;
          }
        }
        measureEnd = Math.max(measureEnd, cursor);
      }
      measureStart = measureEnd;
    }
  }

  if (!notes.length) throw new Error("No pitched notes found in score.");
  return Core.makeScore(notes, bars);
}

export const MusicxmlIn = { parse };
