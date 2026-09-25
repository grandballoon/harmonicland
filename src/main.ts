/* ====================================================================
   LOOP — the glue. ~a dozen lines of intent. Pick a score, pick a
   view function, drive both staff and audio off the one clock's now().
   Swapping the view = swapping `view`. New input = swap how `score`
   is made. New clock = swap makeClock. Nothing reaches across.
   ==================================================================== */
import { Core } from "./core";
import { makeClock } from "./clock";
import { MidiIn } from "./inputs/midi";
import { MusicxmlIn } from "./inputs/musicxml";
import { MxlIn } from "./inputs/mxl";
import { LilyIn } from "./inputs/lily";
import { StaffStd } from "./outputs/staff-std";
import { PianoRoll } from "./outputs/piano-roll";
import { StaffPiano } from "./outputs/staff-piano";
import { Tonnetz } from "./outputs/tonnetz";
import { Combo } from "./outputs/combo";
import { Nashville } from "./outputs/nashville";
import { Practice } from "./outputs/practice";
import { IsolatedKeys } from "./outputs/isolated-keys";
import { AudioOut } from "./outputs/audio";
import { MidiOut } from "./outputs/midi-out";
import { Verovio } from "./outputs/verovio";
import { LiveKeys, type Voice } from "./live-keys";
import { TonnetzState } from "./tonnetz-state";
import { LiveMidi } from "./live-midi";
import { mountMicPanel } from "./mic-panel";
import { LiveGamepad, keysMapping } from "./live-gamepad";
import { perfectoMapping } from "./gamepad-perfecto";
import { tonnetzMapping } from "./gamepad-tonnetz";
import { PerfState } from "./perf-state";
import { PracticeState } from "./practice-state";
import { StepModel, type HandFilter, type Step } from "./steps";
import { Loop, type Edge } from "./loop";
import { Sections, describeBars, type Section } from "./sections";
import { localSectionStore } from "./section-store";
import { mountSectionsPanel } from "./sections-panel";
import { mountSectionChips } from "./section-chips";
import { mountSelectionTip } from "./selection-tip";
import {
  chordName, degreeNumeral, PITCH_NAMES,
  type Degree, type JoystickDirection, type PitchClass,
} from "./harmony/perfecto";
import { realize, transposeTo, type Chart } from "./harmony/progression";
import { REPERTOIRE, FAMILIES, progressionById } from "./harmony/repertoire";
import type { BarRange, Score } from "./types";
import type { KeyboardRegion, LiveSnapshot, PagePan, Region, Scroller, Tape, ViewModule } from "./view";
// the piece the app opens on — bundled, so it loads the same way from the
// dev server and from the deployed site
import openingScoreUrl from "../scores/chopin_prelude_4.midi?url";

const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

// UTF-8 unless a UTF-16 byte-order mark says otherwise (some notation
// software exports UTF-16; fed to a UTF-8 decoder it reads as garbage
// and a valid score dies as "Malformed XML").
const decodeText = (buf: ArrayBuffer): string => {
  const b = new Uint8Array(buf);
  const enc =
    b[0] === 0xff && b[1] === 0xfe ? "utf-16le" :
    b[0] === 0xfe && b[1] === 0xff ? "utf-16be" :
    "utf-8";
  return new TextDecoder(enc).decode(buf);
};

const svg = document.getElementById("staff") as unknown as SVGSVGElement;
let score: Score = Core.makeScore([]); // empty until loaded
// What the score MEANS, when it was generated from a Progression rather
// than parsed from a file. Travels beside the score, never inside it —
// see harmony/progression.ts. Null is the honest answer for a file.
let chart: Chart | null = null;
let view: ViewModule = Practice; // current projection; applyView sets it at startup
let scrubbing = false;
// The score cut into steps for the transport's arrow keys — all hands,
// because watching a score is not practising one hand of it. Rebuilt per
// score, not per keypress.
let steps: readonly Step[] = [];
// True while the playhead is parked on a step the user walked to. The
// sinks sound the score only while `playing`; a step is a paused clock
// that should still be heard, so the loop hands them this instead. Any
// other transport action ends it.
let auditioning = false;
// Where the page has been panned by its tape, or null at rest — see
// view.ts's PagePan. Set by the scroller, dropped by the view once the
// playhead leaves it behind, and forgotten with the view or the score.
let pagePan: PagePan | null = null;
// How far down the whole score's sheets the reader has scrolled — see
// view.ts, note 5. Set by the scroller, forgotten with the score.
let sheetScroll = 0;

const clock = makeClock(() => score.duration);

const fmt = (s: number) => s.toFixed(2);

// The live performance state, read ONCE per frame and handed to every
// consumer as a value. Reading it per-view would let two views in one frame
// observe different LiveKeys states; reading it here cannot.
const liveSnapshot = (): LiveSnapshot => ({
  held: LiveKeys.held(),
  perf: PerfState.snapshot(),
  tonnetz: TonnetzState.snapshot(),
  practice: PracticeState.snapshot(),
  pagePan,
  sheetScroll,
  selection,
  marks,
});

// the per-frame projection — now genuinely a pure function of the frame it
// is handed, with no ambient state reached for behind the signature.
clock.onFrame((t) => {
  const live = liveSnapshot();
  syncScoreScroll(live, t);
  view.render(svg, { score, t, live });
  const sounding = clock.isPlaying() || auditioning;
  AudioOut.at(score, t, sounding);
  MidiOut.at(score, t, sounding);
  // the clock pauses itself at the end of the piece, so the button reads
  // the clock rather than remembering what it was last clicked into.
  const playing = String(clock.isPlaying());
  if (playBtn.dataset.playing !== playing) {
    playBtn.dataset.playing = playing;
    const label = clock.isPlaying() ? "Pause" : "Play";
    playBtn.title = label;
    playBtn.setAttribute("aria-label", label);
  }
  if (!scrubbing && score.duration > 0) {
    $<HTMLInputElement>("scrub").value = String((t / score.duration) * 1000);
  }
  $("time-now").textContent = fmt(t);
  $("time-total").textContent = `${fmt(score.duration)}s`;
});

/** `key` is the score's identity for its saved sections (see sections.ts). */
function loadScore(s: Score, key: string, label?: string, analysis: Chart | null = null): void {
  score = s;
  chart = analysis;
  steps = StepModel.makeSteps(score, "both").steps;
  auditioning = false;
  pagePan = null;
  sheetScroll = 0;
  // a bar selection is a stretch of ONE score
  selection = null;
  looping = false;
  sectionsPanel.setScore(key, score.bars.length);
  clock.seek(0);
  clock.pause();
  AudioOut.silence();
  MidiOut.silence();
  for (const id of ["play", "scrub"]) ($<HTMLButtonElement>(id)).disabled = false;
  $("status").textContent = label ? `${label} · ${score.notes.length} notes · ${fmt(score.duration)}s` : "";
  // a lesson is about a score, so a new score is a new lesson.
  if (view === Practice) PracticeState.begin(score, clock.seek, chart);
  syncTransport();
  applyBars();
}

// --- inputs --------------------------------------------------------
$<HTMLInputElement>("file").addEventListener("change", async (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (!f) return;
  try {
    const buf = await f.arrayBuffer();
    // dispatch on content (with a filename tiebreak): SMF starts with
    // "MThd"; "PK" is a ZIP, i.e. compressed MusicXML (.mxl); XML-looking
    // text is MusicXML; LilyPond is the text rest.
    const head = buf.byteLength >= 4 ? String.fromCharCode(...new Uint8Array(buf, 0, 4)) : "";
    let parsed: Score;
    if (head === "MThd") {
      parsed = MidiIn.parse(buf);
    } else if (head.startsWith("PK")) {
      parsed = MusicxmlIn.parse(await MxlIn.extract(buf));
    } else {
      const txt = decodeText(buf);
      const looksXml = /^\s*</.test(txt); // XML decl, comment, or root tag
      const looksLily =
        f.name.toLowerCase().endsWith(".ly") ||
        (!looksXml && /\\(relative|fixed|score|new|version|tempo)\b/.test(txt));
      parsed = looksLily ? LilyIn.parse(txt) : MusicxmlIn.parse(txt);
    }
    progression.value = ""; // a parsed file is not a progression
    loadScore(parsed, Sections.keyForBytes(new Uint8Array(buf)), f.name);
  } catch (err) {
    $("status").textContent = "Couldn't read that file: " + (err as Error).message;
  }
});

/** Open on Chopin's Prelude in E minor, Op. 28 No. 4, unless the reader
 *  has already loaded something of their own by the time it arrives. */
async function loadOpeningScore(): Promise<void> {
  try {
    const res = await fetch(openingScoreUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    if (score.notes.length > 0) return;
    loadScore(MidiIn.parse(buf), Sections.keyForBytes(new Uint8Array(buf)), "Chopin · Prelude in E minor, Op. 28 No. 4");
  } catch (err) {
    $("status").textContent = "Couldn't load the opening score: " + (err as Error).message;
  }
}

$("demo").addEventListener("click", () => {
  AudioOut.ensure();
  progression.value = "";
  loadScore(demoScore(), "demo", "demo");
});

// --- live MIDI input (hardware keyboard -> LiveKeys) ----------------
// Behind a user gesture: requestMIDIAccess prompts for permission and
// needs a secure context. Toggles on/off; AudioOut.ensure() unlocks the
// AudioContext so the first played note sounds.
let midiOn = false;
const midiBtn = $<HTMLButtonElement>("midi");
midiBtn.addEventListener("click", async () => {
  if (midiOn) {
    LiveMidi.disable();
    midiOn = false;
    midiBtn.textContent = "Enable MIDI";
    $("status").textContent = "MIDI input off.";
    return;
  }
  try {
    AudioOut.ensure();
    const inputs = await LiveMidi.enable();
    midiOn = true;
    midiBtn.textContent = "Disable MIDI";
    $("status").textContent = inputs.length
      ? `MIDI on · ${inputs.length} input${inputs.length > 1 ? "s" : ""} (${inputs.map((i) => i.name ?? "device").join(", ")})`
      : "MIDI on · no devices found — plug one in.";
  } catch (err) {
    $("status").textContent = "MIDI unavailable: " + (err as Error).message;
  }
});

// --- live gamepad input (controller -> LiveKeys) -------------------
// No permission prompt (unlike MIDI), but the API hides pads until the
// user presses a button, so "no devices found" clears once they do.
// Toggles on/off; AudioOut.ensure() unlocks the AudioContext.
let gamepadOn = false;
const gamepadBtn = $<HTMLButtonElement>("gamepad");
gamepadBtn.addEventListener("click", () => {
  if (gamepadOn) {
    LiveGamepad.disable();
    gamepadOn = false;
    gamepadBtn.textContent = "Enable gamepad";
    $("status").textContent = "Gamepad input off.";
    return;
  }
  try {
    AudioOut.ensure();
    LiveGamepad.enable(clock);
    gamepadOn = true;
    gamepadBtn.textContent = "Disable gamepad";
    $("status").textContent = "Gamepad on · press a button on your controller to begin.";
  } catch (err) {
    $("status").textContent = "Gamepad unavailable: " + (err as Error).message;
  }
});

// --- live microphone input (a real instrument -> LiveKeys) ---------
// The panel owns its row of the tray and the session; its voices reach
// every view and practice mode through LiveKeys, silently.
mountMicPanel($<HTMLButtonElement>("mic"), $("mic-readout"), $<HTMLDetailsElement>("mic-settings"), {
  status: (text) => { $("status").textContent = text; },
});

// --- MIDI output (score sink -> hardware synth) --------------------
// A Sink, not an input: the frame loop already calls MidiOut.at every
// frame; enabling just opens an output port for it to send to. Behind a
// user gesture in a secure context, same as MIDI input.
let midiOutOn = false;
const midiOutBtn = $<HTMLButtonElement>("midiout");
midiOutBtn.addEventListener("click", async () => {
  if (midiOutOn) {
    MidiOut.disable();
    AudioOut.setMuted(false); // hand sound back to the built-in synth
    midiOutOn = false;
    midiOutBtn.textContent = "Enable MIDI out";
    $("status").textContent = "MIDI output off.";
    return;
  }
  try {
    const outputs = await MidiOut.enable();
    AudioOut.setMuted(true); // external synth drives sound now — mute our own
    midiOutOn = true;
    midiOutBtn.textContent = "Disable MIDI out";
    $("status").textContent = outputs.length
      ? `MIDI out · ${outputs.length} output${outputs.length > 1 ? "s" : ""} (${outputs.map((o) => o.name ?? "device").join(", ")})`
      : "MIDI out on · no devices found — connect a synth.";
  } catch (err) {
    $("status").textContent = "MIDI out unavailable: " + (err as Error).message;
  }
});

// --- transport controls -------------------------------------------
// One play/pause button. Its glyph follows the clock in the frame loop
// above. Pausing leaves the playhead where it is; the scrubber, the bar
// range and ◀ ▶ are how to move it.
const playBtn = $<HTMLButtonElement>("play");
playBtn.addEventListener("click", () => {
  AudioOut.ensure();
  auditioning = false;
  if (clock.isPlaying()) clock.pause();
  else clock.play(); // enters the loop, if there is one; restarts from the end
});

const scrub = $<HTMLInputElement>("scrub");
const doScrub = () => {
  if (score.duration <= 0) return;
  const t = (+scrub.value / 1000) * score.duration;
  auditioning = false;
  // in practice mode the cursor owns the clock, so scrubbing moves the
  // CURSOR and lets it seek — otherwise the two would fight for `t`.
  if (view === Practice) PracticeState.seekToTime(t);
  else clock.seek(t);
};
scrub.addEventListener("input", () => {
  scrubbing = true;
  doScrub();
});
scrub.addEventListener("change", () => {
  scrubbing = false;
  doScrub();
});

// --- bars and the playback loop ------------------------------------
// ONE selection of bars, shared by every view. In practice mode it confines
// the lesson; everywhere else it is the playback loop, drawn as two flags on
// the scrub bar. Every control that edits it agrees with every other: the
// bar-number boxes, the flags (dragged), [ and ] on the bar under the
// playhead, and a click on a bar of the practice page. ← → and ◀ ▶ walk
// one step at a time, round the selection when it is looping.
//
// Edges snap to barlines. Finer, an edge may be trimmed into its bar, onto
// a note (loop.ts, decision 2): Alt-drag a flag, or press { or } on the
// step under the playhead. The boxes then show the beat beside the bar.
//
// The clock owns the loop in SECONDS and every view and sink follows the
// clock, so nothing past this block knows loops exist; PracticeState owns
// the lesson's copy. This block owns the selection itself and pushes it
// into both, in applyBars and nowhere else. Where an edge may go and where
// a step lands are loop.ts's decisions; this is only pointers and keys.
//
// The boxes speak bar NUMBERS (from 1); everything else speaks indices.
// The one conversion lives in readBarInputs and applyBars, in opposite
// directions, and nowhere else.
const scrubTrack = $("scrub-track");
const loopBtn = $<HTMLButtonElement>("loop");
const barFrom = $<HTMLInputElement>("bar-from");
const barTo = $<HTMLInputElement>("bar-to");
const beatFrom = $("beat-from");
const beatTo = $("beat-to");
let selection: BarRange | null = null; // null is the whole piece
// Outside practice mode, does playback go round the selection? Kept apart
// from the selection so switching looping off never forgets the bars.
let looping = false;

/** Selection -> clock, lesson, boxes, flags. The only writer of any of them. */
function applyBars(): void {
  const practising = view === Practice;
  const d = score.duration;
  const span = Core.barTime(score, selection);
  PracticeState.setRange(selection); // a no-op when no lesson is running
  clock.setLoop(looping && !practising ? span : null);

  barFrom.value = selection ? String(selection.from + 1) : "";
  barTo.value = selection ? String(selection.to + 1) : "";
  showBeat(beatFrom, selection?.fromBeat, "starts on");
  showBeat(beatTo, selection?.toBeat, "stops as");
  const max = String(Math.max(1, score.bars.length));
  barFrom.max = max;
  barTo.max = max;

  // Positions travel as fractions in CSS variables; the stylesheet turns
  // them into pixels, since only it knows the thumb size.
  // A lesson always goes round its bars, so in practice mode the band is
  // lit whenever there are bars to go round, and the Loop switch is hidden.
  const enabled = d > 0;
  const going = practising ? selection !== null : looping;
  scrubTrack.classList.toggle("loop-enabled", enabled);
  scrubTrack.classList.toggle("looping", enabled && going);
  loopBtn.disabled = !enabled;
  loopBtn.setAttribute("aria-pressed", String(enabled && looping && !practising));
  sectionsPanel.setSelection(selection);
  sectionChips.setSelection(selection);
  scrubTrack.style.setProperty("--loop-a", String(d > 0 ? span.start / d : 0));
  scrubTrack.style.setProperty("--loop-b", String(d > 0 ? span.end / d : 1));
}

/** A trimmed edge's beat beside its bar box, as a musician numbers it. */
function showBeat(el: HTMLElement, beat: number | undefined, verb: string): void {
  el.hidden = beat === undefined;
  if (beat === undefined) return;
  const n = String(Math.round((beat + 1) * 100) / 100);
  el.textContent = `·${n}`;
  el.title = `Trimmed: ${verb} beat ${n} of the bar`;
}

/** Choose bars. Choosing bars is asking to loop them, so it switches looping
 *  on — unless `loop` says otherwise, as "all" does: widening to the whole
 *  piece is not a request to go round it forever. */
function selectBars(r: BarRange | null, loop = true): void {
  selection = r && Core.normalizeRange(score, r);
  if (loop) looping = true;
  applyBars();
  if (view !== Practice)
    $("status").textContent = looping
      ? `Looping ${describeBars(selection)} · ← → step through it · Play goes round it`
      : `Selected ${describeBars(selection)} · press Loop to go round it`;
}

/** Boxes -> selection. Either box empty means "from the first" / "to the
 *  last"; both empty means the whole piece. A box names a whole bar, so
 *  the edge typed into goes to its barline, and the other keeps its trim. */
function readBarInputs(): void {
  const a = parseInt(barFrom.value, 10);
  const b = parseInt(barTo.value, 10);
  const hasA = Number.isFinite(a);
  const hasB = Number.isFinite(b);
  if (!hasA && !hasB) return selectBars(null);
  const from = (hasA ? a : 1) - 1;
  const to = (hasB ? b : score.bars.length) - 1;
  const was = selection;
  selectBars({
    from, to,
    ...(was?.fromBeat !== undefined && was.from === from && { fromBeat: was.fromBeat }),
    ...(was?.toBeat !== undefined && was.to === to && { toBeat: was.toBeat }),
  });
}

/** ← / →: park the playhead on the next or previous step, and sound it. */
function stepPlayhead(dir: 1 | -1): void {
  const at = Loop.stepFrom(steps, clock.now(), dir, clock.loop());
  if (at === null) return;
  AudioOut.ensure();
  clock.pause();
  clock.seek(at);
  auditioning = true;
}
/** ◀ ▶ and ← →: the lesson's cursor in practice mode, the playhead elsewhere. */
const stepBy = (dir: 1 | -1): void => (view === Practice ? PracticeState.step(dir) : stepPlayhead(dir));

/** [ / ]: pull one edge of the selection to the bar under the playhead. */
const markBar = (edge: Edge): void =>
  selectBars(Loop.withBar(score, selection, edge, Core.barAt(score, clock.now()).index));

/** { / }: pull one edge to the step under the playhead — trimmed into its
 *  bar, unless that step sits on the barline. */
const markStep = (edge: Edge): void =>
  selectBars(Loop.withEdge(score, selection, edge, Loop.stepEdge(score, steps, clock.now(), edge)));

barFrom.addEventListener("change", readBarInputs);
barTo.addEventListener("change", readBarInputs);
$("bar-all").addEventListener("click", () => selectBars(null, false));
$("step-back").addEventListener("click", () => stepBy(-1));
$("step-fwd").addEventListener("click", () => stepBy(1));
loopBtn.addEventListener("click", () => {
  looping = !looping;
  applyBars();
  $("status").textContent = looping
    ? `Looping ${describeBars(selection)} · ← → step through it · Play goes round it`
    : "Loop off · the bars stay selected for next time";
});

for (const [edge, el] of [["start", $("loop-start")], ["end", $("loop-end")]] as const) {
  el.addEventListener("pointerdown", (e) => {
    if (score.duration <= 0) return;
    el.setPointerCapture(e.pointerId);
    e.preventDefault(); // no text selection, no focus theft from the page
  });
  el.addEventListener("pointermove", (e) => {
    if (!el.hasPointerCapture(e.pointerId)) return;
    // the thumb's centre travels from half a thumb in to half a thumb short
    // of the track's end; an edge is drawn on the same line, so it is read
    // back off the same line.
    const rect = scrubTrack.getBoundingClientRect();
    const thumb = parseFloat(getComputedStyle(scrubTrack).getPropertyValue("--thumb"));
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left - thumb / 2) / (rect.width - thumb)));
    // bars by default; with Alt held, notes too — the trim (decision 2 of loop.ts)
    const t = frac * score.duration;
    const next = e.altKey
      ? Loop.withEdge(score, selection, edge, Loop.snapFine(score, steps, t, edge, selection))
      : Loop.withBar(score, selection, edge, Loop.snapBar(score.bars, t, edge, selection));
    const cur = selection ?? { from: 0, to: score.bars.length - 1 };
    // a wobble, not a move — unless it is the drag that switches looping on
    if ((looping || view === Practice) && Core.sameRange(Core.normalizeRange(score, next), cur)) return;
    selectBars(next);
  });
}

// --- saved sections -------------------------------------------------
// A score broken into named runs of bars, kept per score in localStorage.
// Loading one IS selecting its bars, so it loops here and confines a lesson
// in practice mode by the same path as every other bar control — and the
// hand being practised is left exactly as it was.
//
// The tray's panel owns the list. The header's chips offer the same list a
// click away, and the sheet music tints it while the chips' switch is on
// (outputs/range-marks.ts, decision 4); a click on a tinted section selects
// it (see pickBar), and the tip over it opens it on the keys alone.
const sectionName = (s: Section): string =>
  s.name ? `${s.name} (${describeBars(s.range)})` : describeBars(s.range);
/** The loaded score's sections, as the panel last handed them out. */
let sections: readonly Section[] = [];
let showMarks = true;
/** What the sheets mark: every section's bars, while the switch is on. */
let marks: readonly BarRange[] = [];
const syncMarks = (): void => {
  marks = showMarks ? sections.map((s) => s.range) : [];
};

/** Put the playhead at the top of the selection, unless it is already in
 *  it — so what follows the playhead (the sheets' scroller) goes there
 *  too. A lesson's cursor needs no help: confining it does the same. */
function enterSelection(): void {
  if (view === Practice) return;
  const { start, end } = Core.barTime(score, selection);
  const t = clock.now();
  if (t < start || t >= end) clock.seek(start);
}

function loadSection(s: Section): void {
  AudioOut.ensure();
  selectBars(s.range);
  enterSelection();
  $("status").textContent = view === Practice
    ? `Practice · ${sectionName(s)} · play the lit keys · ← → step`
    : `Looping ${sectionName(s)} · ← → step through it · Play goes round it`;
}
const sectionChips = mountSectionChips($("section-bar"), {
  // on the isolated keys, a chip moves them to another section
  onPick: (s) => (isolated() ? isolate(s) : loadSection(s)),
  onShow(on) {
    showMarks = on;
    syncMarks();
  },
});
const sectionsPanel = mountSectionsPanel($<HTMLDetailsElement>("sections"), localSectionStore(), {
  onLoad: loadSection,
  onIsolate: isolate,
  onChange(list) {
    sections = list;
    syncMarks();
    sectionChips.setList(list);
  },
});

// --- the isolated keyboard -------------------------------------------
// A section's keys, enlarged, and nothing else on the stage but the header
// above it. It is a view like any other (outputs/isolated-keys.ts), kept
// out of the view picker because it is entered from a section and left for
// the view the picker still names — by the header's button, or Escape.
// The page hides the tray while it is showing (index.html, data-isolated).
const leaveKeys = $<HTMLButtonElement>("leave-keys");
const isolated = (): boolean => view === IsolatedKeys;

/** Loop the section's bars on the keyboard they are played on. */
function isolate(s: Section): void {
  AudioOut.ensure();
  tray.open = false;
  applyView("keys"); // first, so the bars below loop rather than confine a lesson
  selectBars(s.range);
  enterSelection();
  $("status").textContent = `Keys of ${sectionName(s)} · Play goes round it · ← → step · Esc leaves`;
}

function leaveIsolation(): void {
  applyView(viewSelect.value);
  if (view !== Practice) $("status").textContent = `Back to ${viewSelect.selectedOptions[0]?.text ?? "the view"}`;
}
leaveKeys.addEventListener("click", leaveIsolation);

// --- view toggle (one reference swap) ------------------------------
const VIEWS: Record<string, ViewModule> = {
  std: StaffStd,
  "std-keys": StaffPiano.keysView,
  "std-roll": StaffPiano.rollView,
  roll: PianoRoll,
  tonnetz: Tonnetz,
  both: Combo,
  nashville: Nashville,
  practice: Practice,
  // not in the picker: entered from a section (see isolate)
  keys: IsolatedKeys,
};
const gamepadHelpTonnetz = $<HTMLDetailsElement>("gamepad-help-tonnetz");
const gamepadHelpNashville = $<HTMLDetailsElement>("gamepad-help-nashville");
// the hands toggle belongs to the stacked staff+piano views only
const handsWrap = $<HTMLLabelElement>("hands-wrap");
const handsBox = $<HTMLInputElement>("hands");
handsBox.addEventListener("change", () => StaffPiano.setHands(handsBox.checked));
// ...and the whole score to practice and the staff+keys view, each of
// which keeps the setting as its own; one box, so the two cannot disagree
const wholeScoreWrap = $<HTMLLabelElement>("whole-score-wrap");
const wholeScore = $<HTMLInputElement>("whole-score");
const applyWholeScore = (): void => {
  PracticeState.setWholeScore(wholeScore.checked);
  StaffPiano.setWholeScore(wholeScore.checked);
};
wholeScore.addEventListener("change", applyWholeScore);
// the box is the default (on, in index.html), so the views start from it
applyWholeScore();

// --- paper: the light scheme ----------------------------------------
// Every view reads as sheet music on paper by default; the box takes them
// back to the dark field. A theme is only a set of CSS tokens on the stage
// (see index.html), so no renderer knows which one it is drawing in.
const stage = $("stage");
const paperBox = $<HTMLInputElement>("paper");
const applyTheme = (): void => {
  if (paperBox.checked) stage.dataset.theme = "light";
  else delete stage.dataset.theme;
};
paperBox.addEventListener("change", applyTheme);
applyTheme();

// --- practice mode controls ----------------------------------------
// In practice mode the LEARNER is the transport: the cursor advances when
// the right keys go down and seeks the clock to match, so Play/Stop would
// be a second, disagreeing source of time. Disable them, and let the scrub
// bar land on the nearest step instead of an arbitrary instant.
const practiceWrap = $<HTMLDivElement>("practice-wrap");
const practiceHand = $<HTMLSelectElement>("practice-hand");

// --- progressions: a lesson with no file behind it -------------------
// A Progression is a SOURCE of a score, taking its place beside the MIDI
// and MusicXML parsers rather than sitting next to practice mode as a
// second engine — so everything downstream (steps, cursor, keyboard,
// arrows, audio, MIDI-out, and every other view) works on it unchanged.
// What it adds is the Chart: the analysis the notes alone cannot carry.
const progression = $<HTMLSelectElement>("progression");
const progRoot = $<HTMLSelectElement>("prog-root");

// the picker is built from the repertoire, not typed out in the HTML — a
// structure added to the catalogue appears here, and one that is not in it
// cannot be selected.
for (const family of FAMILIES) {
  const group = document.createElement("optgroup");
  group.label = family;
  for (const p of REPERTOIRE.filter((x) => x.family === family)) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name;
    group.appendChild(opt);
  }
  progression.appendChild(group);
}
for (const [pc, name] of PITCH_NAMES.entries()) {
  const opt = document.createElement("option");
  opt.value = String(pc);
  opt.textContent = name;
  progRoot.appendChild(opt);
}

/** Realize the chosen structure in the chosen key and hand it to the
 *  cursor as a lesson. `about` goes to the status line, where it can wrap:
 *  the harmony bar is a column of labels, not a place for a sentence. */
function loadProgression(): void {
  const base = progressionById(progression.value);
  if (!base) return;
  const p = transposeTo(base, Number(progRoot.value) as PitchClass);
  const { notes, chart: analysis, barlines } = realize(p);
  AudioOut.ensure();
  // keyed by structure, not key: transposing moves no barline
  loadScore(Core.makeScore(notes, barlines), `progression:${base.id}`, undefined, analysis);
  $("status").textContent = `${p.name} in ${PITCH_NAMES[p.home.root]} · ${p.about}`;
}
progression.addEventListener("change", () => {
  if (progression.value) loadProgression();
});
progRoot.addEventListener("change", () => {
  if (progression.value) loadProgression();
});

const showOther = $<HTMLInputElement>("show-other");
const playOther = $<HTMLInputElement>("play-other");
// stated in the negative, because that is what the box says: the arrows are
// off unless you ask for them, so the checkbox that is ON by default has to
// be the one that means "hide".
const hideArrows = $<HTMLInputElement>("hide-arrows");
// The hand is one setting with two controls: the tray's select, and the
// isolated keyboard's buttons in the header (the tray is hidden there).
// Either sets both, and the lesson — or, with none running, the setting
// the isolated keys read from the practice snapshot.
const keysHand = $("keys-hand");
function chooseHand(h: HandFilter): void {
  practiceHand.value = h;
  PracticeState.setHand(h);
  for (const b of keysHand.querySelectorAll<HTMLButtonElement>("button"))
    b.setAttribute("aria-pressed", String(b.dataset.hand === h));
}
practiceHand.addEventListener("change", () => chooseHand(practiceHand.value as HandFilter));
for (const b of keysHand.querySelectorAll<HTMLButtonElement>("button"))
  b.addEventListener("click", () => chooseHand(b.dataset.hand as HandFilter));
chooseHand(practiceHand.value as HandFilter);
showOther.addEventListener("change", () => PracticeState.setShowOther(showOther.checked));
hideArrows.addEventListener("change", () => PracticeState.setShowArrows(!hideArrows.checked));
playOther.addEventListener("change", () => {
  AudioOut.ensure();
  PracticeState.setPlayOther(playOther.checked);
});

// Play/Stop mean nothing while the learner drives; the scrub still does.
function syncTransport(): void {
  const practising = view === Practice;
  const loaded = score.notes.length > 0;
  playBtn.disabled = practising || !loaded;
  for (const id of ["bar-from", "bar-to", "bar-all", "step-back", "step-fwd"])
    $<HTMLInputElement | HTMLButtonElement>(id).disabled = !loaded;
  // a lesson always goes round its bars, so there is nothing to switch
  loopBtn.style.display = practising ? "none" : "";
}

const viewSelect = $<HTMLSelectElement>("view");
viewSelect.addEventListener("change", () => {
  // the choice is a gesture, so it may unlock sound for the lesson it begins
  if (viewSelect.value === "practice") AudioOut.ensure();
  applyView(viewSelect.value);
  // a closed <select> keeps focus and would swallow the arrow keys that
  // step the playhead in the view just chosen.
  viewSelect.blur();
});

/** Switch to the view the selector names, and everything that goes with
 *  it. Run on every change, and once at startup for the selector's default. */
function applyView(val: string): void {
  view = VIEWS[val] ?? Practice;
  handsWrap.style.display = val === "std-keys" || val === "std-roll" ? "" : "none";
  practiceWrap.style.display = val === "practice" ? "" : "none";
  wholeScoreWrap.style.display = val === "practice" || val === "std-keys" ? "" : "none";
  document.body.toggleAttribute("data-isolated", isolated());
  leaveKeys.hidden = !isolated();
  keysHand.hidden = !isolated();
  LiveKeys.releaseAll(); // drop held notes when leaving the keyboard
  auditioning = false; // a parked step belongs to the view it was walked in
  pagePan = null; // ...and a panned page to the view it was panned in
  // ...and forget which degree keys the Perfecto harness thinks are down.
  // Practice mode ignores its keyup, so without this a degree held across
  // the switch would look held forever, and the next release of any other
  // degree would re-sound a chord into a lesson that is grading presses.
  PerfState.release();
  heldDegrees.length = 0;
  // a lesson exists only while its view does — begin/end here rather than
  // leaving a cursor listening to LiveKeys behind a view nobody is looking at.
  if (val === "practice") {
    clock.pause();
    PracticeState.begin(score, clock.seek, chart);
    $("status").textContent = score.notes.length
      ? "Practice · play the lit keys; click a bar on the page to drill it (shift-click extends) · ← → step"
      : "Practice · load a score to begin.";
  } else {
    PracticeState.end();
  }
  syncTransport();
  applyBars(); // a lesson begun above starts unconfined; hand it the bars
  // the controller means different things per view: Nashville → Perfecto,
  // Tonnetz/Combo → lattice instrument, everything else → chromatic keyboard.
  LiveGamepad.setMapping(
    val === "nashville"                 ? perfectoMapping :
    val === "tonnetz" || val === "both" ? tonnetzMapping :
    keysMapping
  );
  const isTonnetz = val === "tonnetz" || val === "both";
  const isNashville = val === "nashville";
  gamepadHelpTonnetz.style.display = isTonnetz ? "" : "none";
  gamepadHelpNashville.style.display = isNashville ? "" : "none";
  if (!isTonnetz) gamepadHelpTonnetz.removeAttribute("open");
  if (!isNashville) gamepadHelpNashville.removeAttribute("open");
}

// --- playable keyboard (piano-roll view only) ----------------------
// The keyboard is an OUTPUT surface; hit-testing pointer events turns it
// into an INPUT surface too. Tracked per-pointer so chords, multi-touch,
// and glissando all work. The hit-test is pure coordinate math
// (PianoRoll.pitchAt), so the per-frame innerHTML rebuild can't break it.
// Each pointer owns its own voice, so a pointer-pressed C4 and a chord's C4
// refcount independently: lifting the finger can't steal the chord's note.
const pointerVoice = new Map<number, Voice>(); // pointerId -> its live voice
// Where the playable keyboard lives in `svg` right now, or null if the current
// view has none. The view answers for itself — this used to be a chain of
// reference-identity comparisons against specific module exports, which meant
// a new view silently had no keyboard and any decorator around a view broke
// hit-testing without an error.
const rollRegion = (): KeyboardRegion | null =>
  view.keyboardRegion(svg, { score, t: clock.now(), live: liveSnapshot() });
/** The music under the scroller is a second input surface: the view says
 *  which bar a click is on (view.ts, note 5), and this says what picking
 *  it means. On a marked section, its bars are selected.
 *  Otherwise, in practice mode the bar is isolated, and shift-click grows
 *  the range to reach it; elsewhere the playhead goes to the bar. */
function pickBar(e: MouseEvent): void {
  if (!scrolling) return;
  const r = scoreScroll.getBoundingClientRect();
  // a grip standing on a mark's edge is the grip's, clicked or dragged
  const onGrip = scrolling.gripAt(e.clientX - r.left, e.clientY - r.top) !== null;
  const mark = onGrip ? null : scrolling.markAt(e.clientX - r.left, e.clientY - r.top);
  const marked = Sections.find(sections, mark);
  if (marked) return loadSection(marked);
  const bar = scrolling.barAt(e.clientX - r.left, e.clientY - r.top);
  if (bar === null) return;
  if (view === Practice) {
    // only the lesson knows how shift-click extends its range, so ask it,
    // then adopt the answer as the one selection every view shares.
    PracticeState.isolate(bar, e.shiftKey);
    selectBars(PracticeState.snapshot().range);
    return;
  }
  auditioning = false;
  clock.seek(score.bars[bar].start);
}

// --- the music's scroller -------------------------------------------
// The whole score's sheets, the practice page's strip and a view's tape
// (view.ts, note 4) are drawn in the svg like everything else, but
// scrolled by a native scroller laid over them — down the sheets, across
// the strip, along the tape — so the wheel, the trackpad's momentum, touch
// and the scrollbar all behave as they do on any page.
//
// What a position MEANS differs, and that is the one branch here. On a
// view's scroller (view.ts, note 5) it is only where the reader is looking:
// its offset from the scroller's origin is copied into live state — the
// sheets' `sheetScroll` here, the practice strip's pan in PracticeState —
// which is how the view learns it. On a tape it is the playhead: a scroll
// seeks the clock, and every frame puts the scroller back where the
// playhead now stands.
const scoreScroll = $<HTMLDivElement>("score-scroll");
const scoreSpacer = scoreScroll.firstElementChild as HTMLDivElement;
/** The view's scroller the native one is laid over, or null. */
let scrolling: Scroller | null = null;
/** The tape the scroller is laid over, as the last frame drew it, or null. */
let tape: Tape | null = null;
/** Where this code last put the tape's scroller — anything else is a reader. */
let tapeAt = 0;
let axis: "x" | "y" = "y";
const scrollPos = (): number => (axis === "x" ? scoreScroll.scrollLeft : scoreScroll.scrollTop);
function setScrollPos(v: number): void {
  if (axis === "x") scoreScroll.scrollLeft = v;
  else scoreScroll.scrollTop = v;
}
/** Copy the scroller's position into live state, as the view's offset.
 *  Down is always the whole score's sheets; across, only practice's strip
 *  of bars scrolls without being a tape (view.ts, `Scroller.axis`). */
function publishScroll(): void {
  if (!scrolling) return;
  const offset = scrollPos() - scrolling.origin;
  if (scrolling.axis === "x") PracticeState.setPan(offset);
  else sheetScroll = Math.max(0, offset);
}
/** A reader moved the tape: the playhead goes with it. */
function readTape(): void {
  const pos = scrollPos();
  if (!tape || Math.abs(pos - tapeAt) < 0.5) return;
  const to = tape.seek(pos);
  tapeAt = pos;
  pagePan = to.pagePan;
  auditioning = false;
  clock.seek(to.t);
}
scoreScroll.addEventListener("scroll", () => {
  publishScroll();
  readTape();
});
// a mouse wheel only turns vertically, and a strip that scrolls only across
// would ignore it; turn it into the axis there is
scoreScroll.addEventListener("wheel", (e) => {
  if (scoreScroll.hidden || axis !== "x" || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
  scoreScroll.scrollLeft += e.deltaY;
  e.preventDefault();
}, { passive: false });
// a click, not a pointerdown: a finger that lands on a bar to scroll the
// music must not isolate it. A click only fires when the pointer did not
// scroll — and one that ends a grip's drag picks nothing.
scoreScroll.addEventListener("click", (e) => {
  if (gripDragged) gripDragged = false;
  else pickBar(e);
});

// The isolated range's grips (outputs/range-marks.ts): drag one to move
// that end of the selection, to a barline or the gap before a note — the
// same edge, and the same rules, as Alt-dragging a flag on the scrub bar.
/** The end being dragged, or null. */
let gripping: Edge | null = null;
/** Did the pointer that just lifted drag a grip? Then its click is not a pick. */
let gripDragged = false;
const inScroll = (e: PointerEvent): [number, number] => {
  const r = scoreScroll.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
};
scoreScroll.addEventListener("pointerdown", (e) => {
  gripDragged = false;
  const edge = scrolling?.gripAt(...inScroll(e)) ?? null;
  if (!edge || e.button !== 0) return;
  gripping = edge;
  scoreScroll.setPointerCapture(e.pointerId);
  PracticeState.holdFocus(true);
  e.preventDefault(); // no text selection, no scroll
});
scoreScroll.addEventListener("pointermove", (e) => {
  if (!gripping) {
    const at = inScroll(e);
    scoreScroll.style.cursor = scrolling?.gripAt(...at) ? "ew-resize" : scrolling?.markAt(...at) ? "pointer" : "";
    return;
  }
  const t = scrolling?.timeAt(...inScroll(e)) ?? null;
  if (t === null) return;
  const next = Core.normalizeRange(score,
    Loop.withEdge(score, selection, gripping, Loop.snapFine(score, steps, t, gripping, selection)));
  gripDragged = true;
  if (!Core.sameRange(next, selection)) selectBars(next);
});
const releaseGrip = (e: PointerEvent): void => {
  if (!gripping) return;
  gripping = null;
  if (scoreScroll.hasPointerCapture(e.pointerId)) scoreScroll.releasePointerCapture(e.pointerId);
  PracticeState.holdFocus(false);
};
scoreScroll.addEventListener("pointerup", releaseGrip);
scoreScroll.addEventListener("pointercancel", releaseGrip);

// The selection tip (selection-tip.ts): over the selected bars, so saving
// them — or, once saved, opening them on the keys alone — needs no trip to
// the tray. Kept out of the way while a grip is being dragged — it would
// only chase the pointer.
const selectionTip = mountSelectionTip($("selection-tip"), {
  onSave: () => sectionsPanel.save(),
  onRename: (id, name) => sectionsPanel.rename(id, name),
  onIsolate: isolate,
});
function showSelectionTip(sc: Scroller | null): void {
  const box = sc && !gripping ? sc.rangeBox() : null;
  selectionTip.show(box && { ...box, x: box.x + sc!.region.x, y: box.y + sc!.region.y },
    selection, Sections.find(sections, selection));
}

/** What the scroller last followed, or null to follow afresh. */
let followed: number | null = null;
let scrollBox = "";

/** Lay the scroller over `r`, `length` long along `ax`. True when that
 *  changed where it lies or what it scrolls — the position it held then
 *  means nothing, and the caller puts it where the view is drawing. */
function layScroller(r: Region, ax: "x" | "y", length: number, key: string): boolean {
  const box = `${ax},${r.x},${r.y},${r.w},${r.h},${length},${key}`;
  if (box === scrollBox) return false;
  scrollBox = box;
  axis = ax;
  scoreScroll.dataset.axis = ax;
  Object.assign(scoreScroll.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
  Object.assign(scoreSpacer.style, ax === "x"
    ? { width: `${length}px`, height: "1px" }
    : { width: "", height: `${length}px` });
  scoreScroll.hidden = false;
  return true;
}

/** Lay the scroller over whatever scrolls in this frame, or hide it. */
function syncScoreScroll(live: LiveSnapshot, t: number): void {
  const sc = view.scroller(svg, { score, t, live });
  const tp = sc ? null : view.tape(svg, { score, t, live });
  scrolling = sc;
  tape = tp;
  showSelectionTip(sc);
  if (sc) followReader(sc, live);
  else if (tp) followPlayhead(tp);
  else {
    scoreScroll.hidden = true;
    followed = null;
    scrollBox = "";
  }
}

/** A view's scroller: size what it scrolls, and follow what the view
 *  follows — when that moves out of sight, scroll back to it. Only when it
 *  MOVES, so a reader who scrolls away to look ahead is left there until
 *  the learner plays on, or the music does. */
function followReader(sc: Scroller, live: LiveSnapshot): void {
  const { region: r, axis: ax, length, origin } = sc;
  if (layScroller(r, ax, length, `reader,${origin}`)) {
    // the content changed under the scroller — a resize, the page turned
    // to other bars, another view — so put it back at the offset the view
    // is drawing, and look afresh for what it follows
    const offset = ax === "x" ? live.practice.pan : live.sheetScroll;
    setScrollPos(origin + offset);
    publishScroll();
    followed = null;
  }
  const at = sc.follow;
  if (followed === at || at === null || !sc.sight) return;
  followed = at;
  const pos = scrollPos();
  if (pos < sc.sight[0] - 1 || pos > sc.sight[1] + 1) {
    setScrollPos(sc.home);
    publishScroll();
  }
}

/** A tape: stand the scroller where the playhead is. A reader's scroll has
 *  already moved the playhead there (scroll events run before the frame),
 *  so this only ever moves it for the clock — playing, scrubbed, stepped. */
function followPlayhead(tp: Tape): void {
  followed = null;
  pagePan = tp.pagePan; // drop a pan the playhead has left behind
  const moved = layScroller(tp.region, tp.axis, tp.length, "tape");
  if (moved || Math.abs(scrollPos() - tp.pos) >= 0.5) {
    setScrollPos(tp.pos);
    tapeAt = scrollPos();
  }
}

svg.addEventListener("pointerdown", (e) => {
  const region = rollRegion();
  if (region === null) return;
  AudioOut.ensure(); // first gesture unlocks the AudioContext
  const p = PianoRoll.pitchAt(svg, e.clientX, e.clientY, region);
  if (p == null) return;
  svg.setPointerCapture(e.pointerId);
  pointerVoice.set(e.pointerId, LiveKeys.press(p));
  e.preventDefault();
});
svg.addEventListener("pointermove", (e) => {
  const prev = pointerVoice.get(e.pointerId);
  if (!prev) return;
  const region = rollRegion();
  if (region === null) return;
  const p = PianoRoll.pitchAt(svg, e.clientX, e.clientY, region);
  if (p === prev.pitch) return;
  LiveKeys.release(prev); // slid off this key...
  if (p == null) pointerVoice.delete(e.pointerId); // ...and off the keyboard
  else pointerVoice.set(e.pointerId, LiveKeys.press(p)); // ...onto the next (gliss)
});
const endPointer = (e: PointerEvent) => {
  const v = pointerVoice.get(e.pointerId);
  if (!v) return;
  LiveKeys.release(v);
  pointerVoice.delete(e.pointerId);
};
svg.addEventListener("pointerup", endPointer);
svg.addEventListener("pointercancel", endPointer);

// --- TEMPORARY: Perfecto keyboard harness ---------------------------
// Proves the generative chain (computeVoicing -> PerfState -> LiveKeys ->
// audio/MIDI-out + Tonnetz glow) before the gamepad mapping and the
// Nashville view exist. Switch the view to Tonnetz or Piano roll to SEE
// the chords light up while you play them here.
//   1–7            select degree (hold to sustain the chord)
//   Q W E / A S D / Z X C   joystick direction (S = center)
//   m              cycle coloration mode (default→extended→chromatic)
//   i              cycle inversion      v  toggle voice-leading
//   - / =          octave down / up
// Directions/mode/inversion/octave re-sound only while a chord is held.
const DIR_KEYS: Record<string, JoystickDirection> = {
  q: "upLeft", w: "up", e: "upRight",
  a: "left", s: "center", d: "right",
  z: "downLeft", x: "down", c: "downRight",
};
const heldDegrees: Degree[] = []; // stack of held number keys, latest last

function perfStatus(): void {
  const s = PerfState.snapshot();
  const name = chordName(s.key, s.degree, s.joystickMode, s.joystickDirection);
  $("status").textContent =
    `Perfecto · ${degreeNumeral(s.key, s.degree)} ${name} · ${s.joystickMode}/${s.joystickDirection}` +
    ` · ${s.inversion} · oct ${s.octave}${s.voiceLeading ? " · VL" : ""}`;
}
// re-sound the current selection if (and only if) a chord is being held
const resoundIfHeld = (): void => { if (PerfState.isSounding()) PerfState.trigger(); };

const isTyping = (el: EventTarget | null): boolean => {
  const t = el as HTMLElement | null;
  if (!t) return false;
  // a slider or a checkbox holds focus after a click but takes no typing;
  // treating it as a text field would leave the arrow keys dead after
  // every scrub, or worse, nudging the slider instead of stepping.
  if (t instanceof HTMLInputElement) return !["range", "checkbox", "button"].includes(t.type);
  return t.tagName === "SELECT" || t.tagName === "TEXTAREA";
};

// The tray folds every control not needed while reading behind one corner
// indicator. Escape closes it from anywhere — including from a control in
// it, whose focus would otherwise be left inside a closed panel.
const tray = $<HTMLDetailsElement>("tray");

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && tray.open) {
    tray.open = false;
    tray.querySelector("summary")!.focus();
    e.preventDefault();
    return;
  }
  if (e.key === "Escape" && isolated()) {
    leaveIsolation();
    e.preventDefault();
    return;
  }
  if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
  // In practice mode the arrow keys walk the cursor by hand — back to see a
  // transition again, forward to skip one — [ and ] mark the bar the
  // cursor stands in, { and } the step, and nothing else on the keyboard
  // means anything.
  // Not the harness below: it presses chords THROUGH LiveKeys, and the
  // practice cursor grades everything that arrives there. A stray "1" would sound a C major triad and advance the
  // lesson with it.
  if (view === Practice) {
    if (e.key === "ArrowLeft") { PracticeState.step(-1); e.preventDefault(); }
    else if (e.key === "ArrowRight") { PracticeState.step(1); e.preventDefault(); }
    else if ((e.key === "[" || e.key === "]") && !e.repeat && score.notes.length > 0)
      markBar(e.key === "[" ? "start" : "end"); // the clock stands on the cursor's step
    else if ((e.key === "{" || e.key === "}") && !e.repeat && score.notes.length > 0)
      markStep(e.key === "{" ? "start" : "end");
    return;
  }
  if (steps.length > 0) {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      stepBy(e.key === "ArrowLeft" ? -1 : 1);
      e.preventDefault(); // the focused slider would otherwise move too
      return;
    }
    if ((e.key === "[" || e.key === "]") && !e.repeat) {
      markBar(e.key === "[" ? "start" : "end");
      return;
    }
    if ((e.key === "{" || e.key === "}") && !e.repeat) {
      markStep(e.key === "{" ? "start" : "end");
      return;
    }
  }
  const k = e.key.toLowerCase();

  if (k >= "1" && k <= "7") {
    const d = Number(k) as Degree;
    AudioOut.ensure(); // first gesture unlocks the AudioContext
    if (!heldDegrees.includes(d)) heldDegrees.push(d);
    PerfState.setDegree(d);
    PerfState.trigger();
    perfStatus();
    return;
  }
  if (k in DIR_KEYS) { PerfState.setDirection(DIR_KEYS[k]); resoundIfHeld(); perfStatus(); return; }
  if (e.repeat) return; // the rest are single-shot toggles, ignore auto-repeat
  if (k === "m") { PerfState.cycleMode(); resoundIfHeld(); perfStatus(); return; }
  if (k === "i") { PerfState.cycleInversion(); resoundIfHeld(); perfStatus(); return; }
  if (k === "v") { PerfState.setVoiceLeading(!PerfState.snapshot().voiceLeading); resoundIfHeld(); perfStatus(); return; }
  if (k === "-") { PerfState.setOctave(PerfState.snapshot().octave - 1); resoundIfHeld(); perfStatus(); return; }
  if (k === "=") { PerfState.setOctave(PerfState.snapshot().octave + 1); resoundIfHeld(); perfStatus(); return; }
});

window.addEventListener("keyup", (e) => {
  if (view === Practice) return; // see keydown; the view change cleared us
  const k = e.key.toLowerCase();
  if (k < "1" || k > "7") return;
  const d = Number(k) as Degree;
  const i = heldDegrees.indexOf(d);
  if (i >= 0) heldDegrees.splice(i, 1);
  if (heldDegrees.length === 0) { PerfState.release(); perfStatus(); }
  else { PerfState.setDegree(heldDegrees[heldDegrees.length - 1]); PerfState.trigger(); perfStatus(); }
});

// redraw on resize so the SVG tracks the viewport
window.addEventListener("resize", () =>
  view.render(svg, { score, t: clock.now(), live: liveSnapshot() }));

/* a tiny built-in score so the thing runs with no file:
   C-major arpeggio up then a triad, just to exercise the pipeline. In
   4/4 at one note a beat, so it has bars to isolate too. */
function demoScore(): Score {
  const BEAT = 0.35;
  const seq = [60, 64, 67, 72, 67, 64, 60, 62, 64, 65, 67, 69, 71, 72];
  const notes = seq.map((pitch, i) => ({ pitch, onset: i * BEAT, duration: 0.33 }));
  // a sustained low triad underneath
  [48, 52, 55].forEach((p) => notes.push({ pitch: p, onset: 0, duration: seq.length * BEAT }));
  const bars = Math.ceil(seq.length / 4);
  return Core.makeScore(notes, Array.from({ length: bars + 1 }, (_, i) => i * 4 * BEAT));
}

// --- startup ---------------------------------------------------------
// last, so every control and panel the view and the score touch exists
applyView(viewSelect.value);
void loadOpeningScore();
// the engraving engine for the whole score: several megabytes, so it is
// fetched in the background, and the sheets are set without it until it
// arrives — the next frame after it does sets them with it
void Verovio.load();
