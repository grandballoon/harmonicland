/* Reconcile.lean: FAILS_one_voice_each, FAILS_computeVoicing_nodup,
   FAILS_cycle_index_in_range_dir_neg4. Runs the real PerfState / computeVoicing. */
import "./_env";
import { LiveKeys } from "/Users/lukesovernconley/Code/harmonicland/src/live-keys";
import { PerfState } from "/Users/lukesovernconley/Code/harmonicland/src/perf-state";
import {
  computeVoicing, JOYSTICK_TABLES, SCALE_INTERVALS,
  type Degree, type Inversion, type JoystickDirection, type JoystickMode, type ScaleType,
} from "/Users/lukesovernconley/Code/harmonicland/src/harmony/perfecto";
import { voiceTriad } from "/Users/lukesovernconley/Code/harmonicland/src/harmony/tonnetz-lattice";

console.log("== 1. PerfState.trigger with a voicing that names one pitch twice ==");
console.log("selection: C major, degree 2 (ii, minor), mode extended, direction down (7#9), second inversion, octave 4");
PerfState.setKey({ root: 0, scale: "major" });
PerfState.setDegree(2);
PerfState.setMode("extended");
PerfState.setDirection("down");
PerfState.setInversion("second");
PerfState.setOctave(4);
PerfState.setVoiceLeading(false);
const presses: number[] = [];
const off = LiveKeys.onPress((v) => presses.push(v.pitch));
const v = PerfState.trigger();
console.log("computeVoicing notes      :", JSON.stringify(v.notes));
console.log("LiveKeys presses (onPress):", JSON.stringify(presses));
console.log("snapshot().sounding       :", JSON.stringify(PerfState.snapshot().sounding));
console.log("LiveKeys.held()           :", JSON.stringify([...LiveKeys.held()].sort((a, b) => a - b)));
console.log("claim (perf-state.ts:11-13, 99-101 / task: one voice per wanted pitch): 5 notes -> 4 distinct pitches, one voice each");
presses.length = 0;
PerfState.trigger();
console.log("second trigger, no change -> presses:", JSON.stringify(presses), "(idempotence claim: [])");
PerfState.release();
console.log("after release(): held =", JSON.stringify([...LiveKeys.held()]));
off();

console.log("\n== 2. every selection computeVoicing can be asked for (no voice-leading) ==");
const modes = Object.keys(JOYSTICK_TABLES) as JoystickMode[];
const invs: Inversion[] = ["root", "first", "second"];
const dupCells = new Set<string>();
let total = 0, dups = 0;
for (const scale of Object.keys(SCALE_INTERVALS) as ScaleType[])
  for (let root = 0; root < 12; root++)
    for (let degree = 1; degree <= 7; degree++)
      for (const mode of modes)
        for (const dir of Object.keys(JOYSTICK_TABLES[mode]) as JoystickDirection[])
          for (const inversion of invs)
            for (let octave = 0; octave <= 8; octave++) {
              const notes = computeVoicing({
                key: { root, scale }, degree: degree as Degree, joystickMode: mode, joystickDirection: dir,
                inversion, octave, voiceLeading: false, previousVoicing: null,
              }).notes;
              total++;
              if (new Set(notes).size !== notes.length) { dups++; dupCells.add(`${mode}/${dir}/${inversion}`); }
            }
console.log(`selections tried: ${total}; with a repeated pitch: ${dups}; cells: ${JSON.stringify([...dupCells])}`);

console.log("\n== 3. trigger(); trigger() with voice-leading ON, from every previous chord of a sample ==");
let nonIdem = 0, tried = 0;
const sample = { scales: ["major", "naturalMinor", "blues", "majorPentatonic"] as ScaleType[] };
for (const scale of sample.scales)
  for (let degree = 1; degree <= 7; degree++)
    for (const mode of modes)
      for (const dir of Object.keys(JOYSTICK_TABLES[mode]) as JoystickDirection[])
        for (const inversion of invs)
          for (let pd = 1; pd <= 7; pd++) {
            const prev = computeVoicing({ key: { root: 0, scale }, degree: pd as Degree, joystickMode: mode, joystickDirection: dir, inversion: "root", octave: 4, voiceLeading: false, previousVoicing: null });
            const args = { key: { root: 0, scale: scale }, degree: degree as Degree, joystickMode: mode, joystickDirection: dir, inversion, octave: 4, voiceLeading: true };
            const v1 = computeVoicing({ ...args, previousVoicing: prev });
            const v2 = computeVoicing({ ...args, previousVoicing: v1 });
            tried++;
            if (JSON.stringify(v1.notes) !== JSON.stringify(v2.notes)) nonIdem++;
          }
console.log(`pairs tried: ${tried}; second voicing differs from first: ${nonIdem}`);

console.log("\n== 4. voiceTriad over a lattice patch ==");
let tdup = 0, tn = 0;
for (let col = -13; col <= 13; col++) for (let row = -13; row <= 13; row++) for (const orient of ["up", "down"] as const) for (let o = 0; o <= 8; o++) {
  const t = voiceTriad({ col, row, orient }, o); tn++;
  if (new Set(t).size !== 3) tdup++;
}
console.log(`triads tried: ${tn}; with a repeated pitch: ${tdup}`);

console.log("\n== 5. cycleMode / cycleInversion ==");
PerfState.setMode("default");
PerfState.cycleMode(-1);
console.log("default, cycleMode(-1) ->", PerfState.snapshot().joystickMode, "(claim: wraps to chromatic)");
PerfState.cycleMode(1);
console.log("chromatic, cycleMode(1) ->", PerfState.snapshot().joystickMode, "(claim: wraps to default)");
PerfState.setInversion("root");
PerfState.cycleInversion(-1);
console.log("root, cycleInversion(-1) ->", PerfState.snapshot().inversion, "(claim: wraps to second)");
PerfState.setMode("default");
PerfState.cycleMode(-4);
try {
  console.log("default, cycleMode(-4) ->", PerfState.snapshot().joystickMode, "(a wrap would be chromatic)");
} catch (e) {
  console.log("default, cycleMode(-4) -> joystickMode is undefined (index (0-4+3)%3 = -1; a wrap would be chromatic); snapshot() then throws:", String(e));
}
PerfState.setMode("default");
PerfState.setOctave(99); console.log("setOctave(99) ->", PerfState.snapshot().octave);
PerfState.setOctave(-5); console.log("setOctave(-5) ->", PerfState.snapshot().octave);
