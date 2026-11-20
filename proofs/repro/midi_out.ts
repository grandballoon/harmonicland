/* MidiOut.lean: the FAILS_ theorems and noted behaviours, run against the
   real MidiOut with a fake port that records what it is handed (the shape
   src/outputs/midi-out.test.ts uses). The "synth" column applies MIDI 1.0's
   one-note-per-key reading to the recorded messages in timestamp order:
   note-on starts key p, note-off stops key p. */
import { MidiOut, resumedVelocity } from "/Users/lukesovernconley/Code/harmonicland/src/outputs/midi-out";

let ms = 1000;
performance.now = () => ms;
type Msg = { bytes: number[]; stamp: number | undefined; sentAt: number; seq: number };
let seq = 0, ports = 0;
const fakePort = () => {
  const sent: Msg[] = [];
  const port = { id: `repro${++ports}`, name: "Synth", state: "connected",
    send: (b: number[], t?: number) => { sent.push({ bytes: [...b], stamp: t, sentAt: ms, seq: seq++ }); } };
  return { out: MidiOut.output(port as unknown as MIDIOutput), sent };
};
const name = (m: Msg): string => {
  const [st, a, b] = m.bytes;
  const what = st === 0x90 ? `on(${a},vel ${b})` : st === 0x80 ? `off(${a})` : `cc(${a},${b})`;
  return `${what}@${m.stamp === undefined ? "now=" + m.sentAt : m.stamp}`;
};
/** Keys the synth is left sounding once every message has taken effect. */
const sounding = (sent: Msg[]): number[] => {
  const eff = (m: Msg): number => Math.max(m.stamp ?? m.sentAt, m.sentAt);
  const on = new Set<number>();
  for (const m of [...sent].sort((x, y) => eff(x) - eff(y) || x.seq - y.seq)) {
    if (m.bytes[0] === 0x90 && m.bytes[2] > 0) on.add(m.bytes[1]);
    else if (m.bytes[0] === 0x80 || (m.bytes[0] === 0x90 && m.bytes[2] === 0)) on.delete(m.bytes[1]);
  }
  return [...on];
};
const report = (sent: Msg[]): void => {
  console.log("  wire :", sent.map(name).join("  "));
  console.log("  synth left sounding:", JSON.stringify(sounding(sent)));
};

console.log("== 1. FAILS_flush_ends_every_struck_note: flush after the wall clock passed a note's off that advance() never reached ==");
{
  ms = 1000; const { out, sent } = fakePort();
  console.log("  now=1000 strike{60, at 1050, off 1500}; advance(1100); now=2000 (no tick for 900ms); flush()");
  out.strike({ pitch: 60, velocity: 70, at: 1050, off: 1500 });
  out.advance(1100);
  ms = 2000;
  out.flush();
  out.advance(9999);
  report(sent);
  console.log("  claim (midi-out.ts:19-20, SPEC_playback.md:284): flush 'sends a note-off for every note it has struck' -> an off(60) and nothing left sounding");
}

console.log("\n== 2. same call sequence with the tick on time (the hypothesis under which it HOLDS) ==");
{
  ms = 1000; const { out, sent } = fakePort();
  console.log("  now=1000 strike{60, at 1050, off 1500}; advance(1100); now=1450 advance(1550); now=2000 flush()");
  out.strike({ pitch: 60, velocity: 70, at: 1050, off: 1500 });
  out.advance(1100);
  ms = 1450; out.advance(1550);
  ms = 2000; out.flush();
  report(sent);
}

console.log("\n== 3. FAILS_flush_leaves_live_alone: a live key and a score note on one pitch ==");
{
  ms = 1000; const { out, sent } = fakePort();
  console.log("  now=1000 liveOn(60) [user holds C4]; strike{60, at 1050, off 5000}; now=1200 flush(); the user is still holding C4");
  out.liveOn(60, 90);
  out.strike({ pitch: 60, velocity: 70, at: 1050, off: 5000 });
  ms = 1200; out.flush();
  report(sent);
  console.log("  claim (types.ts:204-205, midi-out.test.ts:123): flush 'Leaves the live path alone' -> key 60 still sounding");
  ms = 1300; out.liveOn(60, 90);
  console.log("  liveOn(60) again (still held, so ignored) -> messages:", sent.length, "(unchanged: nothing re-sounds it)");
}

console.log("\n== 4. FAILS_paths_never_touch: the score note's own note-off, and a live key-up ==");
{
  ms = 1000; const { out, sent } = fakePort();
  console.log("  a) now=1000 liveOn(60); strike{60, at 1050, off 1400}; advance(1500); user still holding");
  out.liveOn(60, 90);
  out.strike({ pitch: 60, velocity: 70, at: 1050, off: 1400 });
  out.advance(1500);
  report(sent);
}
{
  ms = 1000; const { out, sent } = fakePort();
  console.log("  b) now=1000 strike{60, at 1000, off 5000}; liveOn(60); now=1200 liveOff(60); the score note has 3.8s left");
  out.strike({ pitch: 60, velocity: 70, at: 1000, off: 5000 });
  out.liveOn(60, 90);
  ms = 1200; out.liveOff(60);
  report(sent);
  console.log("  claim (types.ts:190-193): 'Two paths that never touch each other' -> 60 sounding in both");
}

console.log("\n== 5. FAILS_strike_off_before_at: a strike whose off precedes its at ==");
{
  ms = 1000; const { out, sent } = fakePort();
  console.log("  now=1000 strike{60, at 1090, off 1040}; advance(1100)");
  out.strike({ pitch: 60, velocity: 70, at: 1090, off: 1040 });
  out.advance(1100);
  ms = 3000; out.advance(3100);
  report(sent);
}

console.log("\n== 6. two score strikes of one pitch overlapping (noted) ==");
{
  ms = 1000; const { out, sent } = fakePort();
  console.log("  strike{60, at 1000, off 2000}; strike{60, at 1500, off 3000}; advance(2000)");
  out.strike({ pitch: 60, velocity: 70, at: 1000, off: 2000 });
  out.strike({ pitch: 60, velocity: 70, at: 1500, off: 3000 });
  ms = 1900; out.advance(2000);
  report(sent);
  console.log("  -> the first note's off(60)@2000 lands inside the second note (1500..3000)");
}

console.log("\n== 7. pitch / velocity outside MIDI's range (noted) ==");
{
  ms = 1000; const { out, sent } = fakePort();
  out.strike({ pitch: 128, velocity: 70, at: 1000, off: 1100 });
  out.strike({ pitch: -1, velocity: 70, at: 1000, off: 1100 });
  out.strike({ pitch: 60, velocity: 0, at: 1000, off: 1100 });
  out.strike({ pitch: 61, velocity: 200, at: 1000, off: 1100 });
  out.strike({ pitch: 62, velocity: 100, at: 1000, off: 1100, offset: -3 });
  out.liveOn(300, 90);
  console.log("  bytes handed to port.send:", sent.map((m) => JSON.stringify(m.bytes)).join(" "));
  console.log("  -> passed through unclamped (a real MIDIOutput.send rejects a data byte > 127 with a TypeError, which midi-out.ts:111-115 swallows)");
  console.log("  FAILS_resumedVelocity_range_negative_offset: resumedVelocity(100, -1.5*ln 2) [decay factor 2] =", resumedVelocity(100, -1.5 * Math.log(2)), "(claim, types.ts:174: velocity is 1-127)");
  console.log("  resumedVelocity(100, 0.5) =", resumedVelocity(100, 0.5), " resumedVelocity(1, 60) =", resumedVelocity(1, 60), "(non-negative offset: within 1..velocity)");
}

console.log("\n== 8. a strike with no off is held until the next flush (HOLDS) ==");
{
  ms = 1000; const { out, sent } = fakePort();
  out.strike({ pitch: 60, velocity: 70, at: 1000 });
  ms = 9000; out.advance(999999);
  console.log("  after advance(999999):", sent.map(name).join("  "));
  out.flush();
  report(sent);
}

console.log("\n== 9. a note-off already on its way outlives a flush (noted) ==");
{
  ms = 1000; const { out, sent } = fakePort();
  console.log("  now=1000 strike{60, at 1000, off 1090}; advance(1100); now=1050 flush() [a seek]; strike{60, at 1050, off 3000} [dropped into at the new place]; advance(1150)");
  out.strike({ pitch: 60, velocity: 70, at: 1000, off: 1090 });
  out.advance(1100);
  ms = 1050; out.flush();
  out.strike({ pitch: 60, velocity: 70, at: 1050, off: 3000 });
  out.advance(1150);
  report(sent);
  console.log("  -> the second note should sound until 3000; the first note's off(60)@1090, sent before the flush, releases it at 1090");
}
