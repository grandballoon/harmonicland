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
import { StaffFull } from "./outputs/staff-full";
import { StaffStd } from "./outputs/staff-std";
import { PianoRoll } from "./outputs/piano-roll";
import { StaffPiano } from "./outputs/staff-piano";
import { Tonnetz } from "./outputs/tonnetz";
import { Combo } from "./outputs/combo";
import { Nashville } from "./outputs/nashville";
import { Practice, type Scroller } from "./outputs/practice";
import { AudioOut } from "./outputs/audio";
import { MidiOut } from "./outputs/midi-out";
import { LiveKeys, type Voice } from "./live-keys";
import { TonnetzState } from "./tonnetz-state";
import { LiveMidi } from "./live-midi";
import { LiveGamepad, keysMapping } from "./live-gamepad";
import { perfectoMapping } from "./gamepad-perfecto";
import { tonnetzMapping } from "./gamepad-tonnetz";
import { PerfState } from "./perf-state";
import { PracticeState } from "./practice-state";
import { StepModel, type HandFilter, type Step } from "./steps";
import { Loop, type Edge } from "./loop";
import { Sections, describeBars } from "./sections";
import { localSectionStore } from "./section-store";
import { mountSectionsPanel } from "./sections-panel";
import {
  chordName, degreeNumeral, PITCH_NAMES,
  type Degree, type JoystickDirection, type PitchClass,
} from "./harmony/perfecto";
import { realize, transposeTo, type Chart } from "./harmony/progression";
import { REPERTOIRE, FAMILIES, progressionById } from "./harmony/repertoire";
import type { BarRange, Score } from "./types";
import type { LiveSnapshot, Region, ViewModule } from "./view";
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
let view: ViewModule = StaffFull; // current projection
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
});

// the per-frame projection — now genuinely a pure function of the frame it
// is handed, with no ambient state reached for behind the signature.
clock.onFrame((t) => {
  const live = liveSnapshot();
  syncScoreScroll(live);
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
  scrubTrack.style.setProperty("--loop-a", String(d > 0 ? span.start / d : 0));
  scrubTrack.style.setProperty("--loop-b", String(d > 0 ? span.end / d : 1));
}

/** Choose bars. Choosing bars is asking to loop them, so it switches looping
 *  on — unless `loop` says otherwise, as "all" does: widening to the whole
 *  piece is not a request to go round it forever. */
function selectBars(r: BarRange | null, loop = true): void {
  selection = r && Core.clampRange(r, score.bars.length);
  if (loop) looping = true;
  applyBars();
  if (view !== Practice)
    $("status").textContent = looping
      ? `Looping ${describeBars(selection)} · ← → step through it · Play goes round it`
      : `Selected ${describeBars(selection)} · press Loop to go round it`;
}

/** Boxes -> selection. Either box empty means "from the first" / "to the
 *  last"; both empty means the whole piece. */
function readBarInputs(): void {
  const a = parseInt(barFrom.value, 10);
  const b = parseInt(barTo.value, 10);
  const hasA = Number.isFinite(a);
  const hasB = Number.isFinite(b);
  selectBars(!hasA && !hasB ? null : {
    from: (hasA ? a : 1) - 1,
    to: (hasB ? b : score.bars.length) - 1,
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
  selectBars(Loop.withBar(selection, edge, Core.barAt(score, clock.now()).index, score.bars.length));

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
    const bar = Loop.snapBar(score.bars, frac * score.duration, edge, selection);
    const next = Loop.withBar(selection, edge, bar, score.bars.length);
    const cur = selection ?? { from: 0, to: score.bars.length - 1 };
    // a wobble, not a move — unless it is the drag that switches looping on
    if ((looping || view === Practice) && next.from === cur.from && next.to === cur.to) return;
    selectBars(next);
  });
}

// --- saved sections -------------------------------------------------
// A score broken into named runs of bars, kept per score in localStorage.
// Loading one IS selecting its bars, so it loops here and confines a lesson
// in practice mode by the same path as every other bar control — and the
// hand being practised is left exactly as it was.
const sectionsPanel = mountSectionsPanel($<HTMLDetailsElement>("sections"), localSectionStore(), (s) => {
  AudioOut.ensure();
  selectBars(s.range);
  const what = s.name ? `${s.name} (${describeBars(s.range)})` : describeBars(s.range);
  $("status").textContent = view === Practice
    ? `Practice · ${what} · play the lit keys · ← → step`
    : `Looping ${what} · ← → step through it · Play goes round it`;
});

// --- view toggle (one reference swap) ------------------------------
const VIEWS: Record<string, ViewModule> = {
  full: StaffFull,
  std: StaffStd,
  "std-keys": StaffPiano.keysView,
  "std-roll": StaffPiano.rollView,
  roll: PianoRoll,
  tonnetz: Tonnetz,
  both: Combo,
  nashville: Nashville,
  practice: Practice,
};
const gamepadHelpTonnetz = $<HTMLDetailsElement>("gamepad-help-tonnetz");
const gamepadHelpNashville = $<HTMLDetailsElement>("gamepad-help-nashville");
// the hands toggle belongs to the stacked staff+piano views only
const handsWrap = $<HTMLLabelElement>("hands-wrap");
const handsBox = $<HTMLInputElement>("hands");
handsBox.addEventListener("change", () => StaffPiano.setHands(handsBox.checked));

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
const wholeScore = $<HTMLInputElement>("whole-score");
practiceHand.addEventListener("change", () => PracticeState.setHand(practiceHand.value as HandFilter));
showOther.addEventListener("change", () => PracticeState.setShowOther(showOther.checked));
hideArrows.addEventListener("change", () => PracticeState.setShowArrows(!hideArrows.checked));
wholeScore.addEventListener("change", () => PracticeState.setWholeScore(wholeScore.checked));
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
  view = VIEWS[val] ?? StaffFull;
  handsWrap.style.display = val === "std-keys" || val === "std-roll" ? "" : "none";
  practiceWrap.style.display = val === "practice" ? "" : "none";
  LiveKeys.releaseAll(); // drop held notes when leaving the keyboard
  auditioning = false; // a parked step belongs to the view it was walked in
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
const rollRegion = (): Region | null => view.keyboardRegion(svg, liveSnapshot());
/** The practice page is a second input surface: a bar clicked there is
 *  isolated, and shift-click grows the range to reach it. True when the
 *  pointer was on a bar and the selection took it. */
function pickBar(e: MouseEvent): boolean {
  if (view !== Practice) return false;
  const bar = Practice.barAt(svg, e.clientX, e.clientY, liveSnapshot());
  if (bar === null) return false;
  // only the lesson knows how shift-click extends its range, so ask it,
  // then adopt the answer as the one selection every view shares.
  PracticeState.isolate(bar, e.shiftKey);
  selectBars(PracticeState.snapshot().range);
  return true;
}

// --- the music's scroller -------------------------------------------
// The whole score's sheets and the practice page's strip are drawn in the
// svg like everything else, but scrolled by a native scroller laid over
// them — down the sheets, across the strip — so the wheel, the trackpad's
// momentum, touch and the scrollbar all behave as they do on any page. Its
// position, less the view's origin, is copied into PracticeState, which is
// how the view learns the offset.
const scoreScroll = $<HTMLDivElement>("score-scroll");
const scoreSpacer = scoreScroll.firstElementChild as HTMLDivElement;
/** What the scroller is laid over now, or null while it is hidden. */
let scrolling: Scroller | null = null;
const scrollPos = (): number => (scrolling?.axis === "x" ? scoreScroll.scrollLeft : scoreScroll.scrollTop);
function setScrollPos(v: number): void {
  if (scrolling?.axis === "x") scoreScroll.scrollLeft = v;
  else scoreScroll.scrollTop = v;
}
/** Copy the scroller's position into the lesson, as the view's offset. */
function publishScroll(): void {
  if (!scrolling) return;
  const offset = scrollPos() - scrolling.origin;
  if (scrolling.axis === "x") PracticeState.setPan(offset);
  else PracticeState.setScroll(offset);
}
scoreScroll.addEventListener("scroll", publishScroll);
// a mouse wheel only turns vertically, and a strip that scrolls only across
// would ignore it; turn it into the axis there is
scoreScroll.addEventListener("wheel", (e) => {
  if (scrolling?.axis !== "x" || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
  scoreScroll.scrollLeft += e.deltaY;
  e.preventDefault();
}, { passive: false });
// a click, not a pointerdown: a finger that lands on a bar to scroll the
// music must not isolate it. A click only fires when the pointer did not
// scroll.
scoreScroll.addEventListener("click", (e) => { pickBar(e); });

/** The step the scroller last followed, or null to follow afresh. */
let followed: number | null = null;
let scrollBox = "";

/** Lay the scroller over the music, size what it scrolls, and follow the
 *  cursor: when the learner's step moves out of sight, scroll back to it.
 *  Only when the step MOVES, so a reader who scrolls away to look ahead
 *  is left there until they play on. */
function syncScoreScroll(live: LiveSnapshot): void {
  const sc = view === Practice ? Practice.scroller(svg, live) : null;
  if (!sc) {
    scoreScroll.hidden = true;
    scrolling = null;
    followed = null;
    scrollBox = "";
    return;
  }
  scrolling = sc;
  const { region: r, axis, length, origin } = sc;
  const box = `${axis},${r.x},${r.y},${r.w},${r.h},${length},${origin}`;
  if (box !== scrollBox) {
    // the content changed under the scroller — a resize, or the page turned
    // to other bars — so put it back at the offset the view is drawing
    scrollBox = box;
    const offset = axis === "x" ? live.practice.pan : live.practice.scroll;
    scoreScroll.dataset.axis = axis;
    Object.assign(scoreScroll.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
    Object.assign(scoreSpacer.style, axis === "x"
      ? { width: `${length}px`, height: "1px" }
      : { width: "", height: `${length}px` });
    scoreScroll.hidden = false;
    setScrollPos(origin + offset);
    publishScroll();
  }
  const at = live.practice.index;
  if (followed === at || !sc.sight) return;
  followed = at;
  const pos = scrollPos();
  if (pos < sc.sight[0] - 1 || pos > sc.sight[1] + 1) {
    setScrollPos(sc.home);
    publishScroll();
  }
}

svg.addEventListener("pointerdown", (e) => {
  if (pickBar(e)) {
    e.preventDefault();
    return;
  }
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
  if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
  // In practice mode the arrow keys walk the cursor by hand — back to see a
  // transition again, forward to skip one — [ and ] mark the bar the
  // cursor stands in, and nothing else on the keyboard means anything.
  // Not the harness below: it presses chords THROUGH LiveKeys, and the
  // practice cursor grades everything that arrives there. A stray "1" would sound a C major triad and advance the
  // lesson with it.
  if (view === Practice) {
    if (e.key === "ArrowLeft") { PracticeState.step(-1); e.preventDefault(); }
    else if (e.key === "ArrowRight") { PracticeState.step(1); e.preventDefault(); }
    else if ((e.key === "[" || e.key === "]") && !e.repeat && score.notes.length > 0)
      markBar(e.key === "[" ? "start" : "end"); // the clock stands on the cursor's step
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
