// FAILS_flush_lifts_pedal (proofs/Harmonicland/MidiOut.lean)
// Claim, src/outputs/midi-out.ts:139: flush sends sustain-off because "what the pedal
// holds is part of what was playing"; src/types.ts:204: flush silences "sounding notes
// and anything scheduled but not yet heard".
// The scheduler sends pedal changes up to 100ms ahead, stamped (scheduler.ts:134). A
// pause inside that window flushes: the sustain-off goes out NOW, and the stamped
// sustain-on already on its way arrives after it.
let ms = 0;
(globalThis as any).requestAnimationFrame = () => 0;
(globalThis as any).cancelAnimationFrame = () => {};
performance.now = () => ms;
const { makeClock } = await import("/Users/lukesovernconley/Code/harmonicland/src/clock");
const { makeScore } = await import("/Users/lukesovernconley/Code/harmonicland/src/core");
const { perform } = await import("/Users/lukesovernconley/Code/harmonicland/src/perform");
const { makeScheduler } = await import("/Users/lukesovernconley/Code/harmonicland/src/scheduler");
const { MidiOut } = await import("/Users/lukesovernconley/Code/harmonicland/src/outputs/midi-out");

type Msg = { bytes: number[]; stamp: number | undefined; sentAt: number; seq: number };
const sent: Msg[] = [];
let seq = 0;
const port = { id: "repro-pedal", name: "Synth", state: "connected",
  send: (b: number[], t?: number) => { sent.push({ bytes: [...b], stamp: t, sentAt: ms, seq: seq++ }); } };
const out = MidiOut.output(port as unknown as MIDIOutput);

// two bars; the pedal goes down at 0.55s and is held to the end
const score = makeScore(
  [{ pitch: 60, onset: 0, duration: 0.5 }, { pitch: 64, onset: 0.55, duration: 1.4 }],
  [0, 1, 2],
  [{ start: 0.55, end: 2 }],
);
let tick: (() => void) | null = null;
const ticker = { start: (fn: () => void) => void (tick = fn), stop: () => void (tick = null) };
const clock = makeClock(() => score.duration);
const scheduler = makeScheduler(clock, out, ticker, () => ms);
scheduler.setPerformance(perform(score));

clock.play(); // wall 0
for (ms = 25; ms <= 475; ms += 25) tick?.(); // the worker's ticks; the one at 475 looks ahead to 575
ms = 480;
clock.pause(); // 70ms before the pedal mark

const eff = (m: Msg): number => Math.max(m.stamp ?? m.sentAt, m.sentAt);
const cc = sent.filter((m) => m.bytes[0] === 0xb0 && m.bytes[1] === 64);
console.log("sustain messages, in the order sent:");
for (const m of cc) console.log(`  cc64=${m.bytes[2]}  sent at wall ${m.sentAt}  takes effect at ${eff(m)}`);
const last = [...cc].sort((a, b) => eff(a) - eff(b) || a.seq - b.seq).at(-1)!;
console.log("paused at wall 480. the synth's pedal once every message has taken effect:", last.bytes[2] > 0 ? "DOWN" : "up");
console.log("claim: after a flush nothing of the score is left on the synth -> up");

// what the user hears: a key played while paused never stops
ms = 1000; out.liveOn(72, 80);
ms = 1200; out.liveOff(72);
console.log("while paused the user plays and lifts C5: note-off sent, but the pedal is", last.bytes[2] > 0 ? "down, so it rings on" : "up");
