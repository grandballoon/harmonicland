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
import { LilyIn } from "./inputs/lily";
import { StaffFull } from "./outputs/staff-full";
import { StaffStd } from "./outputs/staff-std";
import { PianoRoll } from "./outputs/piano-roll";
import { Hands } from "./outputs/hands";
import { pitchAt, type Region } from "./outputs/keyboard";
import { Tonnetz } from "./outputs/tonnetz";
import { Combo, NashvilleRoll } from "./outputs/combo";
import { Nashville } from "./outputs/nashville";
import { proseFor } from "./outputs/prose";
import { piano } from "./instruments/piano";
import { guitarIn } from "./instruments/guitar";
import { capo, DROP_D, STANDARD, type Tuning } from "./instruments/guitar-geometry";
import { ProsePanel } from "./ui/prose-panel";
import { AudioOut } from "./outputs/audio";
import { MidiOut } from "./outputs/midi-out";
import { LiveKeys } from "./live-keys";
import { NoteGate } from "./note-gate";
import { LiveMidi } from "./live-midi";
import { LivePerfecto, describeFrame } from "./live-perfecto";
import { LiveGamepad, keysMapping } from "./live-gamepad";
import { perfectoMapping } from "./gamepad-perfecto";
import { tonnetzMapping } from "./gamepad-tonnetz";
import { GamepadRemap } from "./ui/gamepad-remap";
import { PerfState } from "./perf-state";
import { chordName, DEGREE_NUMERAL, type Degree, type JoystickDirection } from "./harmony/perfecto";
import type { Score, View } from "./types";

const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

// The status line is the app's only channel for "what just happened". Routine
// readouts stay dim; failures get the alert colour, because a rejected file
// reported in the same grey as a successful load reads as nothing happening.
const setStatus = (msg: string, kind: "info" | "error" = "info"): void => {
  const el = $("status");
  el.textContent = msg;
  el.classList.toggle("error", kind === "error");
};

const svg = document.getElementById("staff") as unknown as SVGSVGElement;
let score: Score = Core.makeScore([]); // empty until loaded
let view: View = StaffFull.render; // current projection
let scrubbing = false;

const clock = makeClock(() => score.duration);

const fmt = (s: number) => s.toFixed(2);

/** The practice loop, asked once per frame and by nobody else — it is an
 *  edge detector, and a second reader would consume the edge. Returns the
 *  time the rest of this frame should use, so an advance is drawn on the
 *  frame it happens rather than the one after. */
function gate(t: number): number {
  if (!NoteGate.isEnabled() || !score.notes.length) return t;
  const target = Hands.targetAt(score, t);
  const keys = { held: LiveKeys.held(), strikes: LiveKeys.strikes() };
  if (!target || !NoteGate.check(target, keys)) return t;
  clock.seek(Hands.stepTime(score, t, 1));
  return clock.now();
}

// the per-frame projection — pure function of (score, now())
clock.onFrame((t0) => {
  const t = gate(t0);
  view(svg, score, t);
  AudioOut.at(score, t, clock.isPlaying());
  MidiOut.at(score, t, clock.isPlaying());
  if (!scrubbing && score.duration > 0) {
    $<HTMLInputElement>("scrub").value = String((t / score.duration) * 1000);
  }
  const i = Core.barIndexAt(score, t);
  $("time").textContent =
    (i < 0 ? "" : `bar ${score.bars[i].label} · `) + `${fmt(t)} / ${fmt(score.duration)}s`;
});

function loadScore(s: Score, label?: string): void {
  score = s;
  clock.seek(0);
  clock.pause();
  AudioOut.silence();
  MidiOut.silence();
  for (const id of ["play", "stop", "scrub"]) ($<HTMLButtonElement>(id)).disabled = false;
  NoteGate.reset(); // a new piece is a new place to be waiting
  syncPlayButton();
  // bar stepping exists only for inputs that state a bar grid (MusicXML today);
  // the buttons stay dead rather than lying about a structure we don't have.
  const hasBars = score.bars.length > 0;
  for (const id of ["bar-back", "bar-fwd"]) ($<HTMLButtonElement>(id)).disabled = !hasBars;
  // chord stepping needs only notes, which every score has — no bar grid,
  // no tempo, nothing the parser might not have supplied
  for (const id of ["chord-back", "chord-fwd"])
    ($<HTMLButtonElement>(id)).disabled = score.notes.length === 0;
  $("play").textContent = "Play";
  renderProse(); // the instruction list is a function of the score, so it follows it
  setStatus(
    label
      ? `${label} · ${score.notes.length} notes · ${fmt(score.duration)}s` +
          (hasBars ? ` · ${score.bars.length} bars` : "")
      : "",
  );
}

// --- inputs --------------------------------------------------------
$<HTMLInputElement>("file").addEventListener("change", async (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (!f) return;
  try {
    const buf = await f.arrayBuffer();
    // dispatch on content (with a filename tiebreak): SMF starts with
    // "MThd"; XML-looking text is MusicXML; LilyPond is the text rest.
    const head = buf.byteLength >= 4 ? String.fromCharCode(...new Uint8Array(buf, 0, 4)) : "";
    let parsed: Score;
    if (head === "MThd") {
      parsed = MidiIn.parse(buf);
    } else {
      const txt = new TextDecoder().decode(buf);
      const looksXml = /^\s*</.test(txt); // XML decl, comment, or root tag
      const looksLily =
        f.name.toLowerCase().endsWith(".ly") ||
        (!looksXml && /\\(relative|fixed|score|new|version|tempo)\b/.test(txt));
      parsed = looksLily ? LilyIn.parse(txt) : MusicxmlIn.parse(txt);
    }
    loadScore(parsed, f.name);
  } catch (err) {
    setStatus("Couldn't read that file: " + (err as Error).message, "error");
  }
});

$("demo").addEventListener("click", () => {
  AudioOut.ensure();
  loadScore(demoScore(), "demo");
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
    setStatus("MIDI input off.");
    return;
  }
  try {
    AudioOut.ensure();
    const inputs = await LiveMidi.enable();
    midiOn = true;
    midiBtn.textContent = "Disable MIDI";
    setStatus(
      inputs.length
        ? `MIDI on · ${inputs.length} input${inputs.length > 1 ? "s" : ""} (${inputs.map((i) => i.name ?? "device").join(", ")})`
        : "MIDI on · no devices found — plug one in.",
    );
  } catch (err) {
    setStatus("MIDI unavailable: " + (err as Error).message, "error");
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
    setStatus("Gamepad input off.");
    return;
  }
  try {
    AudioOut.ensure();
    LiveGamepad.enable();
    gamepadOn = true;
    gamepadBtn.textContent = "Disable gamepad";
    setStatus("Gamepad on · press a button on your controller to begin.");
  } catch (err) {
    setStatus("Gamepad unavailable: " + (err as Error).message, "error");
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
    setStatus("MIDI output off.");
    return;
  }
  try {
    const outputs = await MidiOut.enable();
    AudioOut.setMuted(true); // external synth drives sound now — mute our own
    midiOutOn = true;
    midiOutBtn.textContent = "Disable MIDI out";
    setStatus(
      outputs.length
        ? `MIDI out · ${outputs.length} output${outputs.length > 1 ? "s" : ""} (${outputs.map((o) => o.name ?? "device").join(", ")})`
        : "MIDI out on · no devices found — connect a synth.",
    );
  } catch (err) {
    setStatus("MIDI out unavailable: " + (err as Error).message, "error");
  }
});

// --- Perfecto link (semantic chord plane) -------------------------
// The iOS app broadcasts ChordLink SysEx alongside its notes (chordlink.md).
// This toggle wires the semantic plane only; enable plain MIDI in as well to
// hear/see the notes — live-perfecto never presses LiveKeys itself.
let perfectoLinkOn = false;
const perfectoLinkBtn = $<HTMLButtonElement>("perfecto-link");
perfectoLinkBtn.addEventListener("click", async () => {
  if (perfectoLinkOn) {
    LivePerfecto.disable();
    LivePerfecto.onFrame(null);
    perfectoLinkOn = false;
    perfectoLinkBtn.textContent = "Enable Perfecto link";
    setStatus("Perfecto link off.");
    return;
  }
  try {
    const inputs = await LivePerfecto.enable();
    LivePerfecto.onFrame((f) => {
      setStatus("Perfecto · " + describeFrame(f));
    });
    perfectoLinkOn = true;
    perfectoLinkBtn.textContent = "Disable Perfecto link";
    setStatus(
      inputs.length
        ? "Perfecto link on · waiting for chords."
        : "Perfecto link on · no MIDI inputs — connect the phone (USB or network session).",
    );
  } catch (err) {
    setStatus("Perfecto link unavailable: " + (err as Error).message, "error");
  }
});

// --- transport controls -------------------------------------------
$("play").addEventListener("click", () => {
  AudioOut.ensure();
  if (clock.isPlaying()) {
    clock.pause();
    $("play").textContent = "Play";
  } else {
    clock.play();
    $("play").textContent = "Pause";
  }
});
$("stop").addEventListener("click", () => {
  clock.pause();
  clock.seek(0);
  AudioOut.silence();
  MidiOut.silence();
  $("play").textContent = "Play";
});

// a keystroke aimed at a form control belongs to that control, not to us —
// so ← / → still nudge the scrubber or the speed menu while they have focus.
const isTyping = (el: EventTarget | null): boolean => {
  const t = el as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA");
};

// --- bar stepping + playback speed (the practice loop) --------------
// Both are pure transport: `barStep` is a query on the score, `setRate` a
// property of the clock. No view, sink, or parser learns anything new — the
// frame loop still just projects (score, now()).
const stepBar = (dir: -1 | 1): void => {
  if (!score.bars.length) return;
  clock.seek(Core.barStep(score, clock.now(), dir));
};
$("bar-back").addEventListener("click", () => stepBar(-1));
$("bar-fwd").addEventListener("click", () => stepBar(1));

// Stepping SONORITIES is the same kind of thing one level down: not "a
// bar later" but "the next chord", however long this one lasts. It is a
// seek like every other, so the roll, the audio and the scrubber all
// follow it — there is no second cursor to keep in step with the clock.
const stepChord = (dir: -1 | 1): void => {
  if (!score.notes.length) return;
  clock.seek(Hands.stepTime(score, clock.now(), dir));
};
$("chord-back").addEventListener("click", () => stepChord(-1));
$("chord-fwd").addEventListener("click", () => stepChord(1));

$<HTMLSelectElement>("speed").addEventListener("change", (e) => {
  clock.setRate(parseFloat((e.target as HTMLSelectElement).value) || 1);
});

// The arrows step the score without leaving it — the point of the feature
// is repetition, and repetition wants a key, not a mouse trip to the
// toolbar. Horizontal moves through TIME (bars), vertical through the
// CHORD LIST, which is the axis each of those reads along.
const STEP_KEYS: Record<string, () => void> = {
  ArrowLeft: () => stepBar(-1),
  ArrowRight: () => stepBar(1),
  ArrowUp: () => stepChord(-1),
  ArrowDown: () => stepChord(1),
};
window.addEventListener("keydown", (e) => {
  if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
  const step = STEP_KEYS[e.key];
  if (!step) return;
  step();
  e.preventDefault();
});

const scrub = $<HTMLInputElement>("scrub");
const doScrub = () => {
  if (score.duration > 0) clock.seek((+scrub.value / 1000) * score.duration);
};
scrub.addEventListener("input", () => {
  scrubbing = true;
  doScrub();
});
scrub.addEventListener("change", () => {
  scrubbing = false;
  doScrub();
});

// --- view toggle (one reference swap) ------------------------------
const VIEWS: Record<string, View> = {
  full: StaffFull.render,
  std: StaffStd.render,
  roll: PianoRoll.render,
  tonnetz: Tonnetz.render,
  both: Combo.render,
  nashville: Nashville.render,
  "nashville-roll": NashvilleRoll.render,
  hands: Hands.render,
};
// Practising one hand at a time belongs to the Hands view and nothing else,
// so its selector rides the view toggle. The setting lives in the view (it
// has no other way to be told — `View` is (svg, score, t)); this is the
// control that writes it.
const practiceWrap = $("practice-wrap");
$<HTMLSelectElement>("practice").addEventListener("change", (e) => {
  Hands.setPractice((e.target as HTMLSelectElement).value as "both" | "L" | "R");
  NoteGate.reset(); // a different hand is a different chord to be waiting for
  view(svg, score, clock.now()); // redraw now rather than on the next note
});

// --- the practice loop ---------------------------------------------
// "Wait for notes" and "play it for me" are the same claim twice, and only
// one of them can be true, so switching the gate on stops the transport and
// takes Play out of the running until it is switched off again.
const waitBox = $<HTMLInputElement>("wait-notes");
const syncPlayButton = (): void => {
  $<HTMLButtonElement>("play").disabled = waitBox.checked || score.notes.length === 0;
};
waitBox.addEventListener("change", () => {
  NoteGate.setEnabled(waitBox.checked);
  if (waitBox.checked) {
    clock.pause();
    AudioOut.silence();
    MidiOut.silence();
    $("play").textContent = "Play";
  }
  syncPlayButton();
});

const gamepadHelpTonnetz = $<HTMLDetailsElement>("gamepad-help-tonnetz");
const gamepadHelpNashville = $<HTMLDetailsElement>("gamepad-help-nashville");

// the Nashville pad map is editable: restore this browser's bindings before
// the first frame draws the legend, then build the panel that edits them.
GamepadRemap.restore();
GamepadRemap.mount($("gamepad-remap"));

$<HTMLSelectElement>("view").addEventListener("change", (e) => {
  const val = (e.target as HTMLSelectElement).value;
  view = VIEWS[val] ?? StaffFull.render;
  LiveKeys.releaseAll(); // drop held notes when leaving the keyboard
  // the controller means different things per view: Nashville → Perfecto,
  // Tonnetz/Combo → lattice instrument, everything else → chromatic keyboard.
  const isTonnetz = val === "tonnetz" || val === "both";
  const isNashville = val === "nashville" || val === "nashville-roll";
  LiveGamepad.setMapping(
    isNashville ? perfectoMapping :
    isTonnetz   ? tonnetzMapping :
    keysMapping
  );
  practiceWrap.style.display = val === "hands" ? "" : "none";
  gamepadHelpTonnetz.style.display = isTonnetz ? "" : "none";
  gamepadHelpNashville.style.display = isNashville ? "" : "none";
  if (!isTonnetz) gamepadHelpTonnetz.removeAttribute("open");
  if (!isNashville) gamepadHelpNashville.removeAttribute("open");
});

// --- spoken score (the instruction panel) --------------------------
// Deliberately NOT a member of VIEWS: `View` is (svg, score, t) and this
// output has neither an svg nor a t (see outputs/prose.ts). It is the same
// kind of CHOICE as the view toggle, though, so its selector sits beside
// it and its panel beside the stage.
const TUNINGS: Record<string, { tuning: Tuning; label: string }> = {
  standard: { tuning: STANDARD, label: "standard tuning" },
  dropd: { tuning: DROP_D, label: "drop D" },
  capo2: { tuning: capo(STANDARD, 2), label: "capo 2" },
  capo5: { tuning: capo(STANDARD, 5), label: "capo 5" },
};
const proseHost = $("prose-panel");
const proseSel = $<HTMLSelectElement>("prose");
const proseTuningSel = $<HTMLSelectElement>("prose-tuning");
const proseTuningWrap = $("prose-tuning-wrap");

// Re-planning is a whole-piece solve, so it happens on a CHANGE (a new
// score, a new instrument) and never per frame — which it can afford to,
// the instructions having no time in them to keep up with.
function renderProse(): void {
  const kind = proseSel.value;
  proseTuningWrap.style.display = kind === "guitar" ? "" : "none";
  proseHost.hidden = kind === "off";
  if (kind === "off") return;
  const t = TUNINGS[proseTuningSel.value] ?? TUNINGS.standard;
  const lines =
    kind === "guitar" ? proseFor(score, guitarIn(t.tuning)) : proseFor(score, piano);
  ProsePanel.render(proseHost, lines, kind === "guitar" ? `Guitar · ${t.label}` : "Piano");
}
proseSel.addEventListener("change", renderProse);
proseTuningSel.addEventListener("change", renderProse);

// --- playable keyboard (piano-roll view only) ----------------------
// The keyboard is an OUTPUT surface; hit-testing pointer events turns it
// into an INPUT surface too. Tracked per-pointer so chords, multi-touch,
// and glissando all work. The hit-test is pure coordinate math
// (PianoRoll.pitchAt), so the per-frame innerHTML rebuild can't break it.
const pointerPitch = new Map<number, number>(); // pointerId -> currently-pressed pitch
// where the playable keyboard lives in `svg` right now, and how tall its band
// is — the two facts `pitchAt` needs to be the exact inverse of what the view
// drew. The roll view IS the keyboard (the whole svg, default band height); a
// stacked view confines it to a bottom band; the Hands view draws a taller
// keyboard of its own. Every other view has no keyboard to hit-test.
interface KeyboardHost {
  region?: Region; // undefined = the whole svg
  keybH?: number; // undefined = the default band height
}
const KEYBOARD_HOSTS = new Map<View, (svg: SVGSVGElement) => KeyboardHost>([
  [PianoRoll.render, () => ({})],
  [Combo.render, (s) => ({ region: Combo.rollRegion(s) })],
  [NashvilleRoll.render, (s) => ({ region: NashvilleRoll.rollRegion(s) })],
  // the Hands band is exactly its keys, so its height IS the key height
  [Hands.render, (s) => { const r = Hands.region(s); return { region: r, keybH: r.h }; }],
]);
const keyboardHost = (): KeyboardHost | null =>
  KEYBOARD_HOSTS.has(view) ? KEYBOARD_HOSTS.get(view)!(svg) : null; // null = none here
const hitTest = (h: KeyboardHost, e: PointerEvent): number | null =>
  pitchAt(svg, e.clientX, e.clientY, h.region, h.keybH);
svg.addEventListener("pointerdown", (e) => {
  const host = keyboardHost();
  if (host === null) return;
  AudioOut.ensure(); // first gesture unlocks the AudioContext
  const p = hitTest(host, e);
  if (p == null) return;
  svg.setPointerCapture(e.pointerId);
  pointerPitch.set(e.pointerId, p);
  LiveKeys.press(p);
  e.preventDefault();
});
svg.addEventListener("pointermove", (e) => {
  if (!pointerPitch.has(e.pointerId)) return;
  const host = keyboardHost();
  if (host === null) return;
  const prev = pointerPitch.get(e.pointerId)!;
  const p = hitTest(host, e);
  if (p === prev) return;
  LiveKeys.release(prev); // slid off this key...
  if (p == null) pointerPitch.delete(e.pointerId); // ...and off the keyboard
  else {
    LiveKeys.press(p);
    pointerPitch.set(e.pointerId, p);
  } // ...onto the next (gliss)
});
const endPointer = (e: PointerEvent) => {
  if (!pointerPitch.has(e.pointerId)) return;
  LiveKeys.release(pointerPitch.get(e.pointerId)!);
  pointerPitch.delete(e.pointerId);
};
svg.addEventListener("pointerup", endPointer);
svg.addEventListener("pointercancel", endPointer);

// --- TEMPORARY: Perfecto keyboard harness ---------------------------
// Proves the generative chain (computeVoicing -> PerfState -> LiveKeys ->
// audio/MIDI-out + Tonnetz glow) before the gamepad mapping and the
// Nashville view exist. Switch the view to Tonnetz or Piano roll to SEE
// the chords light up while you play them here.
//   1–7            select degree (hold to sustain the chord)
//   Q W E / A · D / Z X C   coloration ring (X = Base at the bottom; the
//                           hub is empty, so S selects nothing)
//   m              cycle coloration mode (default→extended→chromatic)
//   i              cycle inversion      v  toggle voice-leading
//   - / =          octave down / up
// Directions/mode/inversion/octave re-sound only while a chord is held.
const DIR_KEYS: Record<string, JoystickDirection> = {
  q: "upLeft", w: "up", e: "upRight",
  a: "left", d: "right",
  z: "downLeft", x: "down", c: "downRight",
};
const heldDegrees: Degree[] = []; // stack of held number keys, latest last

function perfStatus(): void {
  const s = PerfState.snapshot();
  const name = chordName(s.key, s.degree, s.joystickMode, s.joystickDirection);
  setStatus(
    `Perfecto · ${DEGREE_NUMERAL[s.degree]} ${name} · ${s.joystickMode}/${s.joystickDirection}` +
      ` · ${s.inversion} · oct ${s.octave}${s.voiceLeading ? " · VL" : ""}`,
  );
}
// re-sound the current selection if (and only if) a chord is being held
const resoundIfHeld = (): void => { if (PerfState.isSounding()) PerfState.trigger(); };

window.addEventListener("keydown", (e) => {
  if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
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
  const k = e.key.toLowerCase();
  if (k < "1" || k > "7") return;
  const d = Number(k) as Degree;
  const i = heldDegrees.indexOf(d);
  if (i >= 0) heldDegrees.splice(i, 1);
  if (heldDegrees.length === 0) { PerfState.release(); perfStatus(); }
  else { PerfState.setDegree(heldDegrees[heldDegrees.length - 1]); PerfState.trigger(); perfStatus(); }
});

// redraw on resize so the SVG tracks the viewport
window.addEventListener("resize", () => view(svg, score, clock.now()));

/* a tiny built-in score so the thing runs with no file:
   C-major arpeggio up then a triad, just to exercise the pipeline. */
function demoScore(): Score {
  const seq = [60, 64, 67, 72, 67, 64, 60, 62, 64, 65, 67, 69, 71, 72];
  const notes = seq.map((pitch, i) => ({ pitch, onset: i * 0.35, duration: 0.33 }));
  // a sustained low triad underneath
  [48, 52, 55].forEach((p) => notes.push({ pitch: p, onset: 0, duration: seq.length * 0.35 }));
  return Core.makeScore(notes);
}
