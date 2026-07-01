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
import { PianoRoll, type Region as PianoRollRegion } from "./outputs/piano-roll";
import { Tonnetz } from "./outputs/tonnetz";
import { Combo } from "./outputs/combo";
import { Nashville } from "./outputs/nashville";
import { AudioOut } from "./outputs/audio";
import { MidiOut } from "./outputs/midi-out";
import { LiveKeys } from "./live-keys";
import { LiveMidi } from "./live-midi";
import { LiveGamepad, keysMapping } from "./live-gamepad";
import { perfectoMapping } from "./gamepad-perfecto";
import { tonnetzMapping } from "./gamepad-tonnetz";
import { PerfState } from "./perf-state";
import { chordName, DEGREE_NUMERAL, type Degree, type JoystickDirection } from "./harmony/perfecto";
import type { Score, View } from "./types";

const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

const svg = document.getElementById("staff") as unknown as SVGSVGElement;
let score: Score = Core.makeScore([]); // empty until loaded
let view: View = StaffFull.render; // current projection
let scrubbing = false;

const clock = makeClock(() => score.duration);

const fmt = (s: number) => s.toFixed(2);

// the per-frame projection — pure function of (score, now())
clock.onFrame((t) => {
  view(svg, score, t);
  AudioOut.at(score, t, clock.isPlaying());
  MidiOut.at(score, t, clock.isPlaying());
  if (!scrubbing && score.duration > 0) {
    $<HTMLInputElement>("scrub").value = String((t / score.duration) * 1000);
  }
  $("time").textContent = `${fmt(t)} / ${fmt(score.duration)}s`;
});

function loadScore(s: Score, label?: string): void {
  score = s;
  clock.seek(0);
  clock.pause();
  AudioOut.silence();
  MidiOut.silence();
  for (const id of ["play", "stop", "scrub"]) ($<HTMLButtonElement>(id)).disabled = false;
  $("play").textContent = "Play";
  $("status").textContent = label ? `${label} · ${score.notes.length} notes · ${fmt(score.duration)}s` : "";
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
    $("status").textContent = "Couldn't read that file: " + (err as Error).message;
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
    LiveGamepad.enable();
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
};
const gamepadHelp = $<HTMLDetailsElement>("gamepad-help");
$<HTMLSelectElement>("view").addEventListener("change", (e) => {
  const val = (e.target as HTMLSelectElement).value;
  view = VIEWS[val] ?? StaffFull.render;
  LiveKeys.releaseAll(); // drop held notes when leaving the keyboard
  // the controller means different things per view: Nashville → Perfecto,
  // Tonnetz/Combo → lattice instrument, everything else → chromatic keyboard.
  LiveGamepad.setMapping(
    val === "nashville"              ? perfectoMapping :
    val === "tonnetz" || val === "both" ? tonnetzMapping :
    keysMapping
  );
  const isTonnetz = val === "tonnetz" || val === "both";
  gamepadHelp.style.display = isTonnetz ? "" : "none";
  if (!isTonnetz) gamepadHelp.removeAttribute("open");
});

// --- playable keyboard (piano-roll view only) ----------------------
// The keyboard is an OUTPUT surface; hit-testing pointer events turns it
// into an INPUT surface too. Tracked per-pointer so chords, multi-touch,
// and glissando all work. The hit-test is pure coordinate math
// (PianoRoll.pitchAt), so the per-frame innerHTML rebuild can't break it.
const pointerPitch = new Map<number, number>(); // pointerId -> currently-pressed pitch
// where the playable keyboard lives in `svg` right now, or null if the current
// view has none. The roll view IS the keyboard (whole svg); the combo view
// confines it to a bottom band; everything else has no keyboard to hit-test.
const rollRegion = (): PianoRollRegion | null | undefined =>
  view === PianoRoll.render ? undefined // undefined = the whole svg
  : view === Combo.render ? Combo.rollRegion(svg)
  : null; // null = no keyboard here
svg.addEventListener("pointerdown", (e) => {
  const region = rollRegion();
  if (region === null) return;
  AudioOut.ensure(); // first gesture unlocks the AudioContext
  const p = PianoRoll.pitchAt(svg, e.clientX, e.clientY, region);
  if (p == null) return;
  svg.setPointerCapture(e.pointerId);
  pointerPitch.set(e.pointerId, p);
  LiveKeys.press(p);
  e.preventDefault();
});
svg.addEventListener("pointermove", (e) => {
  if (!pointerPitch.has(e.pointerId)) return;
  const region = rollRegion();
  if (region === null) return;
  const prev = pointerPitch.get(e.pointerId)!;
  const p = PianoRoll.pitchAt(svg, e.clientX, e.clientY, region);
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
    `Perfecto · ${DEGREE_NUMERAL[s.degree]} ${name} · ${s.joystickMode}/${s.joystickDirection}` +
    ` · ${s.inversion} · oct ${s.octave}${s.voiceLeading ? " · VL" : ""}`;
}
// re-sound the current selection if (and only if) a chord is being held
const resoundIfHeld = (): void => { if (PerfState.isSounding()) PerfState.trigger(); };

const isTyping = (el: EventTarget | null): boolean => {
  const t = el as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA");
};

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
