/* ====================================================================
   CHORDWIRE — the ChordLink v1 frame codec, the TypeScript twin of
   Perfecto's ChordWire.swift. Pure functions, zero runtime state: a
   SysEx byte frame in, a semantic chord event out (and the reverse, so
   round-trips are testable and a future Harmonicland→Perfecto return
   channel gets its encoder for free).

   The wire numbering is fixed by the explicit tables below, never by
   declaration order on either side — reordering a union type must not
   silently change the protocol. Golden frames in chordwire.test.ts pin
   the exact bytes against Perfecto's ChordWireTests; the shared spec
   lives in chordlink.md. Changing the layout requires a version bump.
   ==================================================================== */
import type {
  Key,
  Degree,
  JoystickMode,
  JoystickDirection,
  Inversion,
  ScaleType,
  Voicing,
} from "./harmony/perfecto";

export interface ChordFrame {
  kind: "chord";
  key: Key;
  degree: Degree;
  joystickMode: JoystickMode;
  joystickDirection: JoystickDirection;
  inversion: Inversion;
  octave: number;
  voiceLeading: boolean;
  voicing: Voicing;
}

export interface ReleaseFrame {
  kind: "release";
}

export type ChordWireFrame = ChordFrame | ReleaseFrame;

// Frame header: F0 <non-commercial mfr> 'P' 'F' <version>.
const SYSEX_START = 0xf0;
const SYSEX_END = 0xf7;
const MANUFACTURER = 0x7d; // MIDI "non-commercial / research" ID
const TAG_P = 0x50;
const TAG_F = 0x46;
const VERSION = 0x01;
const TYPE_CHORD = 0x01;
const TYPE_RELEASE = 0x02;

// Wire numbering tables. Order here IS the protocol; do not reorder.
export const SCALE_ORDER: ScaleType[] = [
  "major", "naturalMinor", "harmonicMinor", "melodicMinor",
  "majorPentatonic", "minorPentatonic", "blues",
  "dorian", "mixolydian", "lydian",
];
export const MODE_ORDER: JoystickMode[] = ["default", "extended", "chromatic"];
export const DIRECTION_ORDER: JoystickDirection[] = [
  "center", "up", "upRight", "right", "downRight",
  "down", "downLeft", "left", "upLeft",
];
export const INVERSION_ORDER: Inversion[] = ["root", "first", "second"];

// SysEx data bytes must stay below 0x80; clamp rather than truncate so an
// out-of-range value can never masquerade as a status byte.
const clamp7 = (v: number): number => Math.min(Math.max(Math.round(v), 0), 127);

export function encodeChord(f: Omit<ChordFrame, "kind">): number[] {
  return [
    SYSEX_START, MANUFACTURER, TAG_P, TAG_F, VERSION, TYPE_CHORD,
    f.key.root,
    SCALE_ORDER.indexOf(f.key.scale),
    f.degree,
    MODE_ORDER.indexOf(f.joystickMode),
    DIRECTION_ORDER.indexOf(f.joystickDirection),
    INVERSION_ORDER.indexOf(f.inversion),
    clamp7(f.octave),
    f.voiceLeading ? 1 : 0,
    f.voicing.bassNote == null ? 0 : 1,
    clamp7(f.voicing.bassNote ?? 0),
    clamp7(f.voicing.notes.length),
    ...f.voicing.notes.map(clamp7),
    SYSEX_END,
  ];
}

export function encodeRelease(): number[] {
  return [SYSEX_START, MANUFACTURER, TAG_P, TAG_F, VERSION, TYPE_RELEASE, SYSEX_END];
}

// pure: one complete SysEx message -> a frame, or null for anything that is
// not well-formed ChordLink v1. Foreign SysEx, truncated payloads, and
// out-of-range fields are all rejected rather than partially interpreted —
// this null-on-foreign behavior is also the input filter: live-perfecto
// listens on every port and lets the header decide.
export function decode(data: Uint8Array | number[]): ChordWireFrame | null {
  const b = Array.from(data);
  if (
    b.length < 7 ||
    b[0] !== SYSEX_START ||
    b[1] !== MANUFACTURER ||
    b[2] !== TAG_P ||
    b[3] !== TAG_F ||
    b[4] !== VERSION ||
    b[b.length - 1] !== SYSEX_END
  ) {
    return null;
  }

  const type = b[5];
  if (type === TYPE_RELEASE) return b.length === 7 ? { kind: "release" } : null;
  if (type !== TYPE_CHORD || b.length < 18) return null;

  const [root, scaleIdx, degree, modeIdx, dirIdx, invIdx, octave, vl, hasBass, bass, count] =
    b.slice(6, 17);
  if (
    root > 11 ||
    scaleIdx >= SCALE_ORDER.length ||
    degree < 1 || degree > 7 ||
    modeIdx >= MODE_ORDER.length ||
    dirIdx >= DIRECTION_ORDER.length ||
    invIdx >= INVERSION_ORDER.length ||
    vl > 1 || hasBass > 1 ||
    b.length !== 17 + count + 1
  ) {
    return null;
  }

  return {
    kind: "chord",
    key: { root, scale: SCALE_ORDER[scaleIdx] },
    degree: degree as Degree,
    joystickMode: MODE_ORDER[modeIdx],
    joystickDirection: DIRECTION_ORDER[dirIdx],
    inversion: INVERSION_ORDER[invIdx],
    octave,
    voiceLeading: vl === 1,
    voicing: { notes: b.slice(17, 17 + count), ...(hasBass === 1 ? { bassNote: bass } : {}) },
  };
}
