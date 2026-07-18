# ChordLink — chord data from Perfecto to Harmonicland and GarageBand

ChordLink is the architectural addition that lets Perfecto (iOS) broadcast what it is playing to listeners on a Mac: Harmonicland (browser) and GarageBand (desktop).
This document is the design record and the wire specification.
An identical copy lives in the Harmonicland repo; the two must be kept in sync, and the golden test frames in both test suites pin the byte layout.

## Design decision: MIDI is the transport, SysEx is the semantic layer

Three candidate architectures were considered.

1. **A WebSocket bridge** (Perfecto → Node relay → browser). Rejected: it introduces a third process to run, its own discovery/pairing story, and a second wire format, while still needing a separate MIDI path for GarageBand.
2. **Turning Harmonicland into a Mac desktop app** to give it CoreMIDI access. Rejected as unnecessary: Chrome's Web MIDI API already sees every CoreMIDI source, including iOS devices bridged over USB or the RTP-MIDI network session. Nothing about this design blocks a later desktop port — a desktop Harmonicland would read the identical stream.
3. **CoreMIDI as the single transport, with two planes.** Chosen.

The chosen design splits the data into two planes carried by the same transport:

```
Perfecto (iOS)
├── "Perfecto" virtual source        — note plane: ch-1 note on/off (already shipped)
└── "Perfecto Link" virtual source   — semantic plane: ChordWire SysEx frames (new)
        │
        ▼  USB cable (automatic) or RTP-MIDI network session (Wi-Fi)
macOS CoreMIDI
├── GarageBand         — consumes the note plane, ignores SysEx (zero code)
└── Chrome (Web MIDI)  — Harmonicland: notes → LiveKeys, SysEx → live-perfecto.ts
```

Why this wins:

- **One transport, three consumers.** USB works today with zero configuration; the network session adds wireless with one pairing step.
- **GarageBand needs nothing.** It already listens to all MIDI inputs; SysEx frames are ignored by definition.
- **The note plane stays dumb and universal; the semantic plane is additive.** Any MIDI consumer works; consumers that understand ChordWire get the full musical intent (key, scale, degree, joystick coloration, exact voicing) instead of having to reverse-engineer chords from note clusters.
- **No mutation of either architecture.** In Perfecto the announcer is one more `ChordEventSink` in the existing `CompositeSink`. In Harmonicland the receiver is one more input module beside `live-midi.ts` and `live-gamepad.ts`, feeding the existing seams.

## Wire specification (v1)

A ChordLink frame is a standard MIDI System Exclusive message.
Every byte between the `F0`/`F7` markers is 7-bit (< `0x80`).

### Header (all frames)

| Byte | Value | Meaning |
|------|-------|---------|
| 0 | `F0` | SysEx start |
| 1 | `7D` | Manufacturer: non-commercial / research |
| 2 | `50` | `'P'` |
| 3 | `46` | `'F'` |
| 4 | `01` | Protocol version |
| 5 | type | `01` chord, `02` release |
| … | payload | type-dependent, see below |
| last | `F7` | SysEx end |

Receivers must reject (not partially interpret) frames with a foreign manufacturer, unknown version, unknown type, truncated payload, or out-of-range fields.

### Type `01` — chord

Payload bytes, in order after the type byte:

| Offset | Field | Range | Notes |
|--------|-------|-------|-------|
| 6 | key root | 0–11 | pitch class, C = 0 |
| 7 | scale | 0–9 | see scale table |
| 8 | degree | 1–7 | I = 1 … vii° = 7 |
| 9 | joystick mode | 0–2 | default, extended, chromatic |
| 10 | joystick direction | 0–8 | see direction table |
| 11 | inversion | 0–2 | root, first, second |
| 12 | octave | 0–8 | MIDI convention, octave 4 = middle C |
| 13 | voice leading | 0–1 | flag |
| 14 | has bass | 0–1 | flag for slash-chord bass |
| 15 | bass note | 0–127 | MIDI note; meaningful only when has-bass = 1 |
| 16 | note count *n* | 0–127 | |
| 17…17+*n*−1 | notes | 0–127 | MIDI notes, ascending |

### Type `02` — release

No payload; the frame is exactly `F0 7D 50 46 01 02 F7`.

### Wire numbering tables

Order is normative; it is fixed by these tables, never by enum declaration order in either codebase.

- **Scales**: 0 major, 1 naturalMinor, 2 harmonicMinor, 3 melodicMinor, 4 majorPentatonic, 5 minorPentatonic, 6 blues, 7 dorian, 8 mixolydian, 9 lydian.
- **Joystick directions**: 0 center, 1 up, 2 upRight, 3 right, 4 downRight, 5 down, 6 downLeft, 7 left, 8 upLeft.

### Golden frame

C major, degree I, default/right (maj7), root inversion, octave 4, no voice leading, voicing C4 E4 G4 B4:

```
F0 7D 50 46 01 01 00 00 01 00 03 00 04 00 00 00 04 3C 40 43 47 F7
```

Both test suites assert this exact byte sequence; changing it requires a version bump at byte 4.

### Semantics and cadence

- A chord frame is emitted for every `playChord` event, including per-tick events from clock-driven modes (arpeggio single notes arrive as one-note voicings with the current selection context). Receivers that only care about harmony changes should dedupe on the context fields.
- A release frame is emitted for every `stopChord`.
- Frames are advisory display/analysis data. The note plane remains the authority on what is sounding; receivers must not synthesize audio-critical state solely from the semantic plane.
- Chord frames are skipped (note plane unaffected) when Perfecto has no active degree yet.

## Perfecto-side architecture

New pieces, one file each, no changes to the event flow:

- `Perfecto/Sources/MusicTheoryCore/ChordWire.swift` — `ChordAnnouncement` + `ChordWire` encode/decode. Pure Swift (Int/Array only), honoring the Music Theory Core purity constraint, and round-trip tested in the SwiftPM package (`ChordWireTests`).
- `MIDI/MidiAnnouncerSink.swift` — `MidiAnnouncerSink: ChordEventSink`, registered in the `CompositeSink` beside `AudioSink` and `MidiSink`. It pairs each voicing with a semantic context pulled from an injected `contextProvider` closure at send time, and hands the encoded frame to a `SysExTransport`. The transport seam (`CoreMidiSysExTransport` / `RecordingSysExTransport`) mirrors the existing `MidiBackend` seam.
- `MIDI/MidiNetwork.swift` — enables the RTP-MIDI network session so both virtual sources reach the Mac over Wi-Fi.
- `App/PerfectoApp.swift` — wiring only: builds the announcer, adds it to the composite, binds the context provider to `PerformanceState` after construction.

The context provider reads `PerformanceState.activeDegree`, `key`, `joystickMode`, `joystickDirection`, and `octave`; inversion and voice-leading mirror `makeVoicing`'s current fixed values and are carried in the protocol for when those become live settings.

## Harmonicland-side architecture

New pieces beside the existing input modules:

- `src/chordwire.ts` — the decoder/encoder twin of `ChordWire.swift`, pure functions, golden-frame tested against the same bytes.
- `src/live-perfecto.ts` — an input module in the mold of `live-midi.ts`: opens its own `MIDIAccess` (with `sysex: true`), listens to inputs named "Perfecto Link", decodes frames, and mirrors the semantic selection into `PerfState` setters plus a subscriber callback for the UI readout. It deliberately does **not** press notes into `LiveKeys` — the note plane already flows through `live-midi.ts`, so enabling both buttons gives sound/glow from notes and labels/harmony from ChordLink with no double-pressing.

## Setup (macOS)

1. **USB**: plug the iPhone into the Mac; both "Perfecto" and "Perfecto Link" appear in Audio MIDI Setup automatically.
2. **Wireless**: open Audio MIDI Setup → Window → Show MIDI Studio → Network, create/enable a session, and connect to the iPhone (Perfecto enables its session with an open connection policy on launch).
3. **GarageBand**: nothing to configure; record-enable a software instrument track.
4. **Harmonicland**: use Chrome or Edge (Safari has no Web MIDI); click *Enable MIDI* for the note plane and *Perfecto link* for the semantic plane, and accept the SysEx permission prompt.

## Future directions

- Dedupe/interval extension: announce selection changes (key/mode changes without a trigger) as a third frame type.
- Harmonicland recording chord progressions into its score model from the semantic plane.
- A desktop Harmonicland (Tauri/Electron) would consume the same stream via native CoreMIDI; no protocol change.
- Bidirectional control (Harmonicland driving Perfecto) would reuse the same frame format on a return SysEx channel.
