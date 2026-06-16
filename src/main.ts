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
import { AudioOut } from "./outputs/audio";
import { LiveKeys } from "./live-keys";
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
  $("empty").style.display = "none";
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
};
$<HTMLSelectElement>("view").addEventListener("change", (e) => {
  view = VIEWS[(e.target as HTMLSelectElement).value] ?? StaffFull.render;
  LiveKeys.releaseAll(); // drop held notes when leaving the keyboard
});

// --- playable keyboard (piano-roll view only) ----------------------
// The keyboard is an OUTPUT surface; hit-testing pointer events turns it
// into an INPUT surface too. Tracked per-pointer so chords, multi-touch,
// and glissando all work. The hit-test is pure coordinate math
// (PianoRoll.pitchAt), so the per-frame innerHTML rebuild can't break it.
const pointerPitch = new Map<number, number>(); // pointerId -> currently-pressed pitch
const isRoll = () => view === PianoRoll.render;
svg.addEventListener("pointerdown", (e) => {
  if (!isRoll()) return;
  AudioOut.ensure(); // first gesture unlocks the AudioContext
  const p = PianoRoll.pitchAt(svg, e.clientX, e.clientY);
  if (p == null) return;
  svg.setPointerCapture(e.pointerId);
  pointerPitch.set(e.pointerId, p);
  LiveKeys.press(p);
  e.preventDefault();
});
svg.addEventListener("pointermove", (e) => {
  if (!pointerPitch.has(e.pointerId)) return;
  const prev = pointerPitch.get(e.pointerId)!;
  const p = PianoRoll.pitchAt(svg, e.clientX, e.clientY);
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
