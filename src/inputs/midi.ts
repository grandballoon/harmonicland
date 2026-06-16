/* ====================================================================
   MIDI_IN — bytes -> score. A minimal Standard MIDI File reader:
   header + track chunks, variable-length deltas, note-on/off pairing,
   tempo (set-tempo meta) -> seconds. Fills pitch + timing, lets Core
   pick the default spelling. No dependency on any output.
   ==================================================================== */
import { Core } from "../core";
import type { Score, RawNote } from "../types";

interface MidiEvent {
  tick: number;
  kind: "tempo" | "on" | "off";
  pitch?: number;
  vel?: number;
  usPerQ?: number;
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
        events.push({ tick, kind: vel > 0 ? "on" : "off", pitch, vel });
      } else if (hi === 0x80) {
        // note off
        const pitch = u8();
        u8();
        events.push({ tick, kind: "off", pitch });
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

  // tick -> seconds using the tempo map (default 120bpm = 500000 us/q).
  events.sort((a, b) => a.tick - b.tick);
  let usPerQ = 500000;
  let lastTick = 0;
  let seconds = 0;

  // We need monotonic integration, so walk events in tick order once,
  // updating seconds at each tempo change, recording note times.
  const open = new Map<number, number[]>(); // pitch -> onsets
  const notes: RawNote[] = [];
  for (const ev of events) {
    seconds += ((ev.tick - lastTick) * usPerQ) / division / 1e6;
    lastTick = ev.tick;
    if (ev.kind === "tempo") {
      usPerQ = ev.usPerQ!;
    } else if (ev.kind === "on") {
      // stack note-ons of same pitch; pair LIFO on next off
      const pitch = ev.pitch!;
      if (!open.has(pitch)) open.set(pitch, []);
      open.get(pitch)!.push(seconds);
    } else if (ev.kind === "off") {
      const stack = open.get(ev.pitch!);
      if (stack && stack.length) {
        const onset = stack.shift()!;
        notes.push({ pitch: ev.pitch!, onset, duration: Math.max(0.02, seconds - onset) });
      }
    }
  }
  // close any hung notes at end
  for (const [pitch, stack] of open) for (const onset of stack) notes.push({ pitch, onset, duration: 0.25 });

  if (!notes.length) throw new Error("No notes found in file.");
  return Core.makeScore(notes);
}

export const MidiIn = { parse };
