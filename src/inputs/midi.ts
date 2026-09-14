/* ====================================================================
   MIDI_IN — bytes -> score. A minimal Standard MIDI File reader:
   header + track chunks, variable-length deltas, note-on/off pairing,
   tempo (set-tempo meta) -> seconds, time signature (meta 0x58) ->
   barlines. Fills pitch + timing, lets Core pick the default spelling.
   No dependency on any output.
   ==================================================================== */
import { Core } from "../core";
import type { Barline, Score, RawNote } from "../types";

interface MidiEvent {
  tick: number;
  kind: "tempo" | "meter" | "key" | "bar" | "on" | "off";
  pitch?: number;
  vel?: number;
  usPerQ?: number;
  /** meter and bar: the time signature, beats over unit. */
  beats?: number;
  unit?: number;
  /** key and bar: sharps (+) or flats (−) on the circle of fifths. */
  fifths?: number;
  track?: number; // 1-based; piano exports put the hands on separate tracks
}

export function parse(bytes: ArrayBuffer): Score {
  const dv = new DataView(bytes);
  let p = 0;
  const u32 = () => {
    const v = dv.getUint32(p);
    p += 4;
    return v;
  };
  const u16 = () => {
    const v = dv.getUint16(p);
    p += 2;
    return v;
  };
  const u8 = () => dv.getUint8(p++);
  const str = (n: number) => {
    let s = "";
    for (let i = 0; i < n; i++) s += String.fromCharCode(u8());
    return s;
  };

  if (str(4) !== "MThd") throw new Error("Not a MIDI file (missing MThd).");
  u32(); // header length (6)
  u16(); // format
  const nTracks = u16();
  const division = u16(); // ticks per quarter note (assume positive)
  if (division & 0x8000) throw new Error("SMPTE timecode division not supported.");

  function readVarLen(): number {
    let v = 0;
    let b: number;
    do {
      b = u8();
      v = (v << 7) | (b & 0x7f);
    } while (b & 0x80);
    return v;
  }

  // First pass over all tracks, collecting (tick, type, data).
  // Tempo can change mid-stream, so we gather a tempo map then convert.
  const events: MidiEvent[] = [];
  for (let t = 0; t < nTracks; t++) {
    if (str(4) !== "MTrk") throw new Error("Bad track chunk.");
    const len = u32();
    const end = p + len;
    let tick = 0;
    let running = 0;
    while (p < end) {
      tick += readVarLen();
      let status = dv.getUint8(p);
      if (status & 0x80) {
        p++;
        running = status;
      } else {
        status = running; // running status
      }
      const hi = status & 0xf0;
      if (status === 0xff) {
        // meta
        const type = u8();
        const mlen = readVarLen();
        if (type === 0x51) {
          // set tempo (3 bytes)
          const usPerQ = (dv.getUint8(p) << 16) | (dv.getUint8(p + 1) << 8) | dv.getUint8(p + 2);
          events.push({ tick, kind: "tempo", usPerQ });
        } else if (type === 0x58 && mlen >= 2) {
          // time signature: numerator, then the denominator as a power of
          // two (2 = quarter, 3 = eighth). The remaining two bytes describe
          // the metronome click and are not about where bars fall.
          const num = dv.getUint8(p);
          const den = 1 << dv.getUint8(p + 1);
          if (num > 0) events.push({ tick, kind: "meter", beats: num, unit: den });
        } else if (type === 0x59 && mlen >= 1) {
          // key signature: a signed count of sharps (flats when negative);
          // the mode byte after it says nothing about what gets printed.
          events.push({ tick, kind: "key", fifths: dv.getInt8(p) });
        }
        p += mlen;
      } else if (status === 0xf0 || status === 0xf7) {
        // sysex
        const slen = readVarLen();
        p += slen;
      } else if (hi === 0x90) {
        // note on
        const pitch = u8();
        const vel = u8();
        events.push({ tick, kind: vel > 0 ? "on" : "off", pitch, vel, track: t + 1 });
      } else if (hi === 0x80) {
        // note off
        const pitch = u8();
        u8();
        events.push({ tick, kind: "off", pitch, track: t + 1 });
      } else if (hi === 0xa0 || hi === 0xb0 || hi === 0xe0) {
        p += 2; // 2-byte channel msgs we ignore
      } else if (hi === 0xc0 || hi === 0xd0) {
        p += 1; // 1-byte channel msgs we ignore
      } else {
        p++; // unknown — limp forward
      }
    }
    p = end;
  }

  // Barlines are laid down in TICKS first, from the meter map, and then
  // ride through the same tempo integration as the notes below — so a
  // barline and the note on it land on the same second by construction,
  // never by two conversions agreeing. Default 4/4 when the file says
  // nothing, which is what every sequencer assumes too.
  events.sort((a, b) => a.tick - b.tick);
  const endTick = events.reduce((m, e) => Math.max(m, e.tick), 0);
  const meters = events.filter((e) => e.kind === "meter");
  if (meters.length === 0 || meters[0].tick > 0)
    meters.unshift({ tick: 0, kind: "meter", beats: 4, unit: 4 });
  const keys = events.filter((e) => e.kind === "key");
  const keyAt = (tick: number): number => {
    let f = 0;
    for (const k of keys) if (k.tick <= tick) f = k.fifths!;
    return f;
  };
  for (let i = 0; i < meters.length; i++) {
    const last = i === meters.length - 1;
    const until = last ? endTick : meters[i + 1].tick;
    const { beats, unit } = meters[i];
    const barTicks = ((beats! * 4) / unit!) * division;
    if (barTicks <= 0) continue;
    const bar = (t: number): MidiEvent => ({ tick: t, kind: "bar", beats, unit, fifths: keyAt(t) });
    let t = meters[i].tick;
    for (; t < until; t += barTicks) events.push(bar(t));
    // the closing post: the end of the final bar, which runs its full
    // length past the last note-off rather than stopping at it.
    if (last) events.push(bar(t));
  }
  events.sort((a, b) => a.tick - b.tick);
  const barlines: Barline[] = [];

  // tick -> seconds using the tempo map (default 120bpm = 500000 us/q).
  let usPerQ = 500000;
  let lastTick = 0;
  let seconds = 0;

  // We need monotonic integration, so walk events in tick order once,
  // updating seconds at each tempo change, recording note times.
  // pair on/off within a track (tracks are independent streams; the same
  // pitch may sound in both hands at once), keyed track<<7|pitch.
  const open = new Map<number, number[]>(); // track/pitch key -> onsets
  const notes: RawNote[] = [];
  for (const ev of events) {
    seconds += ((ev.tick - lastTick) * usPerQ) / division / 1e6;
    lastTick = ev.tick;
    if (ev.kind === "tempo") {
      usPerQ = ev.usPerQ!;
    } else if (ev.kind === "bar") {
      barlines.push({ at: seconds, beats: ev.beats, unit: ev.unit, fifths: ev.fifths });
    } else if (ev.kind === "on") {
      // stack note-ons of same key; pair LIFO on next off
      const key = (ev.track! << 7) | ev.pitch!;
      if (!open.has(key)) open.set(key, []);
      open.get(key)!.push(seconds);
    } else if (ev.kind === "off") {
      const stack = open.get((ev.track! << 7) | ev.pitch!);
      if (stack && stack.length) {
        const onset = stack.shift()!;
        notes.push({ pitch: ev.pitch!, onset, duration: Math.max(0.02, seconds - onset), stream: ev.track });
      }
    }
  }
  // close any hung notes at end
  for (const [key, stack] of open)
    for (const onset of stack) notes.push({ pitch: key & 0x7f, onset, duration: 0.25, stream: key >> 7 });

  if (!notes.length) throw new Error("No notes found in file.");

  // Resolve the hand HERE, in the only namespace that knows what these track
  // numbers mean. A format-1 file leads with a tempo track that bears no
  // notes, so track 1 is routinely empty and "track 1 = upper" would be
  // wrong; skip the empty ones and let the lowest NOTE-BEARING track be the
  // upper hand. (This is the normalization Core.upperStaff used to do
  // downstream, guessing at a namespace it could not see.)
  const lowest = Math.min(...notes.map((n) => n.stream!));
  for (const n of notes) n.hand = n.stream === lowest ? "upper" : "lower";

  return Core.makeScore(notes, barlines);
}

export const MidiIn = { parse };
