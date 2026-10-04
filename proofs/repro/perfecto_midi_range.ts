// Repro for Perfecto.lean: FAILS_notes_valid_midi_octave_6,
// FAILS_notes_valid_midi_octave_8, FAILS_notes_valid_midi_C_major_octave_7,
// FAILS_notes_valid_midi_led_octave_5.
// Claim: types.ts:9 "MIDI note number, 0–127"; perfecto.ts:124 "notes: number[];
// // MIDI note numbers, sorted ascending". perf-state.ts:132 allows octave 0..8.
import {
  computeVoicing, type ComputeVoicingArgs, type Voicing,
} from "/Users/lukesovernconley/Code/harmonicland/src/harmony/perfecto";

const base: ComputeVoicingArgs = {
  key: { root: 0, scale: "major" }, degree: 1, joystickMode: "default", joystickDirection: "center",
  inversion: "root", octave: 4, voiceLeading: false, previousVoicing: null,
};
const run = (label: string, over: Partial<ComputeVoicingArgs>): Voicing => {
  const v = computeVoicing({ ...base, ...over });
  const bad = v.notes.filter((p) => p < 0 || p > 127);
  console.log(`${label}\n   notes = [${v.notes}]  claim: all in 0..127.  outside: [${bad}]`);
  return v;
};
const Bmp = { root: 11, scale: "minorPentatonic" } as const;

console.log("== computeVoicing, called directly ==");
run("octave 6, B minor pentatonic, degree 7, chromatic/upLeft:",
  { key: Bmp, degree: 7, joystickMode: "chromatic", joystickDirection: "upLeft", octave: 6 });
run("octave 5, same chord (control, largest octave that is always safe without voice-leading):",
  { key: Bmp, degree: 7, joystickMode: "chromatic", joystickDirection: "upLeft", octave: 5 });
run("octave 7, C major, degree 7, chromatic/upRight:",
  { degree: 7, joystickMode: "chromatic", joystickDirection: "upRight", octave: 7 });
run("octave 8, C major, degree 7, default/right:", { degree: 7, joystickDirection: "right", octave: 8 });
run("octave 8, B major, degree 2, default/center:", { key: { root: 11, scale: "major" }, degree: 2, octave: 8 });
run("octave 8, B minor pentatonic, degree 7, chromatic/upRight (the maximum):",
  { key: Bmp, degree: 7, joystickMode: "chromatic", joystickDirection: "upRight", octave: 8 });

console.log("== voice-leading at octave 5, three triggers, each led from the one before ==");
const led = { key: Bmp, degree: 7 as const, octave: 5, voiceLeading: true };
const v1 = run("1. chromatic/upRight, second inversion:",
  { ...led, joystickMode: "chromatic", joystickDirection: "upRight", inversion: "second" });
const v2 = run("2. default/center, root position:", { ...led, previousVoicing: v1 });
run("3. chromatic/upLeft, root position:",
  { ...led, joystickMode: "chromatic", joystickDirection: "upLeft", previousVoicing: v2 });

// What the callers do with such a pitch: PerfState.trigger -> LiveKeys.press
// -> Sound.liveOn -> the active Output. A recording Output stands in for the
// device, so this is the app's own code path up to the device boundary.
console.log("== the live path: PerfState -> LiveKeys -> Sound -> Output ==");
try {
  const { PerfState } = await import("/Users/lukesovernconley/Code/harmonicland/src/perf-state");
  const { Sound } = await import("/Users/lukesovernconley/Code/harmonicland/src/outputs/sound");
  const { LiveKeys } = await import("/Users/lukesovernconley/Code/harmonicland/src/live-keys");
  const { encode } = await import("/Users/lukesovernconley/Code/harmonicland/src/outputs/midi-out");
  const { samplePitchFor } = await import("/Users/lukesovernconley/Code/harmonicland/src/outputs/audio");
  const on: number[] = [];
  Sound.use({
    strike() {}, advance() {}, pedal() {}, flush() {}, latency: () => 0, detach() {},
    liveOn: (pitch: number) => void on.push(pitch),
    liveOff() {},
  });
  // the keyboard's own moves (main.ts:1273-1277): "=" x3, "m" x2, a direction, a degree
  for (let i = 0; i < 3; i++) PerfState.setOctave(PerfState.snapshot().octave + 1);
  PerfState.cycleMode(); PerfState.cycleMode();
  PerfState.setDirection("upRight");
  PerfState.setDegree(7);
  PerfState.trigger();
  const snap = PerfState.snapshot();
  console.log(`selection: key root ${snap.key.root} ${snap.key.scale}, degree ${snap.degree}, ${snap.joystickMode}/${snap.joystickDirection}, octave ${snap.octave}`);
  console.log(`Output.liveOn was called with pitches [${on}]   claim: all in 0..127`);
  console.log(`LiveKeys.held() = [${[...LiveKeys.held()]}]`);
  const bad = on.filter((p) => p > 127);
  for (const p of bad) {
    console.log(`pitch ${p}: MIDI-out would send bytes [${encode("on", p, 80)}] (a data byte must be 0..127)`);
    const sp = samplePitchFor(p);
    console.log(`pitch ${p}: built-in piano uses sample ${sp} at playbackRate ${Math.pow(2, (p - sp) / 12).toFixed(3)} (audio.ts:297; "at most one semitone" of shift is the design, i.e. rate <= 1.06)`);
  }
  PerfState.release();
} catch (e) {
  console.log("live-path modules did not load under vite-node:", String(e));
}
