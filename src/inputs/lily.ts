/* ====================================================================
   LILY_IN — text -> score. A from-scratch parser for the common subset
   of LilyPond *source*. Like MusicXML, a LilyPond note states its own
   spelling (cis = C#, des = Db), so real flats/sharps flow straight to
   StaffStd.

   Supported: \relative and absolute octaves; Dutch note names with
   is/es accidentals (incl. doubles + as/es shorthands); durations with
   dots and LilyPond's "inherit previous duration" rule; chords < >;
   rests r and spacers s; ties ~; simultaneous music << >> (brace your
   voices); and the directives \tempo \time \key \clef \new \score, with
   \header/\layout/\paper/\midi/\version skipped. Out of scope (ignored):
   tuplets \times, \repeat, grace notes, lyrics, and named-variable
   indirection (the inline definition is what gets parsed).
   ==================================================================== */
import { Core } from "../core";
import type { Score, RawNote, Spelling, Letter } from "../types";

const SEMI: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }; // semitones above C
const STEP: Record<string, number> = { c: 0, d: 1, e: 2, f: 3, g: 4, a: 5, b: 6 }; // diatonic index
const UP: Record<string, Letter> = { c: "C", d: "D", e: "E", f: "F", g: "G", a: "A", b: "B" };
// note/rest token:  letter, accidental(s), octave marks, number, dots
const NOTE_RE = /^([a-grs])((?:is|es|s)*)('+|,+)?(\d+)?(\.*)/;

type NoteTok =
  | { durSec: number; midi: null }
  | { durSec: number; midi: number; spelling: Spelling };

function tokenize(src: string): string[] {
  src = src.replace(/%\{[\s\S]*?%\}/g, " ").replace(/%[^\n]*/g, " ");
  const re = /<<|>>|\\\\|[{}<>~|=]|\\[a-zA-Z]+|"[^"]*"|[^\s{}<>~|="]+/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.push(m[0]);
  return out;
}
function alterOf(s: string): number {
  let a = 0;
  while (s) {
    if (s.startsWith("is")) {
      a += 1;
      s = s.slice(2);
    } else if (s.startsWith("es")) {
      a -= 1;
      s = s.slice(2);
    } else if (s.startsWith("s")) {
      a -= 1;
      s = s.slice(1); // as/es shorthand
    } else break;
  }
  return a;
}
const dotted = (n: number, dots: number) => (4 / n) * (2 - Math.pow(0.5, dots)); // -> quarter-note count

export function parse(src: string): Score {
  const T = tokenize(src);
  const notes: RawNote[] = [];
  const tieOpen = new Map<number, RawNote>(); // pitch -> note kept open by ~
  const st = { tempo: 120, lastDurQ: 1, mode: "abs" as "abs" | "rel", refDia: 28 }; // 28 = c'
  const P = { i: 0 };
  const secPerQ = () => 60 / st.tempo;

  function pushNote(midi: number, spelling: Spelling, onset: number, durSec: number, tieNext: boolean): void {
    if (tieOpen.has(midi)) {
      // extend the held note
      const held = tieOpen.get(midi)!;
      held.duration = onset + durSec - held.onset;
      if (!tieNext) tieOpen.delete(midi);
      return;
    }
    const note: RawNote = { pitch: midi, spelling, onset, duration: Math.max(0.02, durSec) };
    notes.push(note);
    if (tieNext) tieOpen.set(midi, note);
  }

  // resolve one note/rest token -> {durSec, midi|null, spelling}; updates
  // lastDurQ and (in relative mode) the running octave reference.
  function note(tok: string): NoteTok | null {
    const m = NOTE_RE.exec(tok);
    if (!m) return null;
    const [, letter, accS, marks, numStr, dots] = m;
    const durQ = numStr ? (st.lastDurQ = dotted(+numStr, dots.length)) : st.lastDurQ;
    const durSec = durQ * secPerQ();
    if (letter === "r" || letter === "s") return { durSec, midi: null };
    const alter = alterOf(accS || "");
    const ap = marks && marks[0] === "'" ? marks.length : 0;
    const co = marks && marks[0] === "," ? marks.length : 0;
    let octaveSci: number;
    if (st.mode === "rel") {
      const s = STEP[letter];
      const o = Math.round((st.refDia - s) / 7) + ap - co; // nearest, then marks
      octaveSci = o;
      st.refDia = s + 7 * o; // ref follows the note
    } else {
      octaveSci = 3 + ap - co; // c (no mark) = C3
    }
    const midi = 12 * (octaveSci + 1) + SEMI[letter] + alter;
    const acc = alter > 0 ? "#" : alter < 0 ? "b" : "";
    return { durSec, midi, spelling: { letter: UP[letter], acc } };
  }

  function skipBlock(): void {
    if (T[P.i] !== "{") return;
    let d = 0;
    do {
      const t = T[P.i++];
      if (t === "{") d++;
      else if (t === "}") d--;
    } while (P.i < T.length && d > 0);
  }

  // parse a sequence (items advance time) until a closing token; -> end time
  function parseSeq(closers: string[], t0: number): number {
    let t = t0;
    while (P.i < T.length && !closers.includes(T[P.i])) t = parseItem(t);
    return t;
  }
  function parseItem(t0: number): number {
    const tok = T[P.i];
    if (tok === "{") {
      P.i++;
      const e = parseSeq(["}"], t0);
      if (T[P.i] === "}") P.i++;
      return e;
    }
    if (tok === "<<") {
      P.i++;
      return parseSimul(t0);
    }
    if (tok === "<") return parseChord(t0);
    if (tok === "|" || tok === "~" || tok === "=" || tok[0] === '"') {
      P.i++;
      return t0;
    }
    if (tok[0] === "\\") return parseCommand(t0);
    const n = note(tok);
    P.i++;
    if (n && n.midi != null) {
      const tieNext = T[P.i] === "~";
      if (tieNext) P.i++;
      pushNote(n.midi, n.spelling, t0, n.durSec, tieNext);
    }
    return n ? t0 + n.durSec : t0;
  }
  function parseSimul(t0: number): number {
    // each braced voice starts at t0
    let maxT = t0;
    const startRef = st.refDia;
    while (P.i < T.length && T[P.i] !== ">>") {
      if (T[P.i] === "\\\\") {
        P.i++;
        continue;
      }
      st.refDia = startRef;
      const e = parseItem(t0);
      if (e > maxT) maxT = e;
    }
    if (T[P.i] === ">>") P.i++;
    st.refDia = startRef;
    return maxT;
  }
  function parseChord(t0: number): number {
    // < c e g >4  -> simultaneous
    P.i++; // consume '<'
    const startRef = st.refDia;
    let firstDia: number | null = null;
    const members: { midi: number; spelling: Spelling }[] = [];
    while (P.i < T.length && T[P.i] !== ">") {
      const n = note(T[P.i]);
      P.i++;
      if (n && n.midi != null) {
        members.push({ midi: n.midi, spelling: n.spelling });
        if (firstDia === null) firstDia = st.refDia;
      }
    }
    if (T[P.i] === ">") P.i++;
    let durQ = st.lastDurQ;
    if (P.i < T.length && /^\d/.test(T[P.i])) {
      const dm = /^(\d+)(\.*)/.exec(T[P.i])!;
      durQ = st.lastDurQ = dotted(+dm[1], dm[2].length);
      P.i++;
    }
    const durSec = durQ * secPerQ();
    const tieNext = T[P.i] === "~";
    if (tieNext) P.i++;
    for (const mm of members) pushNote(mm.midi, mm.spelling, t0, durSec, tieNext);
    st.refDia = st.mode === "rel" && firstDia != null ? firstDia : startRef;
    return t0 + durSec;
  }
  function parseCommand(t0: number): number {
    const cmd = T[P.i];
    P.i++;
    switch (cmd) {
      case "\\relative": {
        let ref = 28; // default c'
        const pm = P.i < T.length && /^[a-g]/.test(T[P.i]) && NOTE_RE.exec(T[P.i]);
        if (pm) {
          const marks = pm[3] || "";
          const ap = marks[0] === "'" ? marks.length : 0;
          const co = marks[0] === "," ? marks.length : 0;
          ref = STEP[pm[1]] + 7 * (3 + ap - co);
          P.i++;
        }
        const pMode = st.mode;
        const pRef = st.refDia;
        st.mode = "rel";
        st.refDia = ref;
        const e = parseItem(t0);
        st.mode = pMode;
        st.refDia = pRef; // relative scope ends
        return e;
      }
      case "\\tempo": {
        if (P.i < T.length && T[P.i][0] === '"') P.i++;
        if (P.i < T.length && /^\d/.test(T[P.i])) {
          const unit = +/^\d+/.exec(T[P.i])![0];
          P.i++;
          if (T[P.i] === "=") P.i++;
          if (P.i < T.length && /^\d/.test(T[P.i])) {
            st.tempo = (+/^\d+/.exec(T[P.i])![0] * 4) / unit;
            P.i++;
          }
        }
        return t0;
      }
      case "\\new":
      case "\\context": {
        if (P.i < T.length && /^[A-Z]/.test(T[P.i])) P.i++; // Staff / Voice
        if (T[P.i] === "=") {
          P.i++;
          if (P.i < T.length) P.i++;
        } // = "name"
        if (T[P.i] === "\\with") {
          P.i++;
          skipBlock();
        }
        return parseItem(t0);
      }
      case "\\score":
      case "\\book":
        return parseItem(t0);
      case "\\header":
      case "\\layout":
      case "\\paper":
      case "\\midi":
      case "\\with":
        skipBlock();
        return t0;
      case "\\key":
        if (P.i < T.length) P.i++;
        if (P.i < T.length && T[P.i][0] === "\\") P.i++;
        return t0;
      case "\\time":
      case "\\clef":
      case "\\partial":
      case "\\version":
      case "\\language":
      case "\\bar":
        if (P.i < T.length) P.i++;
        return t0;
      default:
        return t0; // ignore unknown directive
    }
  }

  parseSeq([], 0);
  if (!notes.length) throw new Error("No notes found — is this a supported LilyPond subset?");
  return Core.makeScore(notes);
}

export const LilyIn = { parse };
