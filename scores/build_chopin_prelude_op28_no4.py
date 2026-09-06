#!/usr/bin/env python3
r"""Builds scores/chopin_prelude_op28_no4.musicxml.

WHY THIS EXISTS
    The MusicXML shipped earlier was a python-ly export of `chopin_prelude_4.ly`
    and it was wrong in ways that broke playback outright: the `\partial 4`
    pickup was folded into bar 1, which pushed every following bar a quarter
    note out of place; each bar's last left-hand chord had its upper notes
    spilled across the barline as orphan <chord/> elements; several bars had
    voices of unequal length (bar 9's treble ran two whole bars, bar 12's
    <backup> overshot the barline), which desynchronised the hands; and no
    tempo was stated at all, so the piece played at the 120 bpm default
    instead of Largo.

    Rather than patch that export, this script transcribes the score directly
    from the LilyPond source (`chopin_prelude_4.ly`, Mutopia, public domain)
    and emits clean MusicXML. Every note was checked against the MIDI that
    LilyPond itself renders from that same source: same pitches, same onsets,
    same durations, hand for hand.

USAGE
    python3 scores/build_chopin_prelude_op28_no4.py

The emitted file is generated output: edit this script, not the XML.
"""

from pathlib import Path

DIV = 96                      # divisions per quarter note
BAR = 4 * DIV                 # 2/2 -> 384 divisions per bar
TRIP8 = DIV // 3              # eighth inside a 3:2 tuplet -> 32

# duration in divisions -> (<type>, number of dots)
NOTE_TYPES = {
    4 * DIV: ("whole", 0),
    3 * DIV: ("half", 1),
    2 * DIV: ("half", 0),
    DIV + DIV // 2: ("quarter", 1),
    DIV: ("quarter", 0),
    DIV * 3 // 4: ("eighth", 1),
    DIV // 2: ("eighth", 0),
    TRIP8: ("eighth", 0),
    DIV // 4: ("16th", 0),
}

# ---------------------------------------------------------------------------
# The score.  An event is (duration, pitches, flags):
#   duration  divisions; 0 for a grace note
#   pitches   None for a rest, else "C#4" / ["G3", "B3", "E4"]
#   flags     T tie-start  t tie-stop  G grace  3 triplet member
#             F fermata    ! force a cautionary accidental
# Bars are numbered as the source numbers them: 0 is the pickup quarter.
# ---------------------------------------------------------------------------

RH = {                                                            # \playRH
    0:  [(72, "B3", ""), (24, "B4", "")],
    1:  [(288, "B4", ""), (96, "C5", "")],
    2:  [(288, "B4", ""), (96, "C5", "")],
    3:  [(288, "B4", ""), (96, "C5", "")],
    4:  [(288, "B4", ""), (96, "Bb4", "")],
    5:  [(288, "A4", ""), (96, "B4", "!")],
    6:  [(288, "A4", ""), (96, "B4", "")],
    7:  [(288, "A4", ""), (72, "B4", ""), (24, "A4", "")],
    8:  [(288, "A4", ""), (96, "G#4", "T")],
    9:  [(96, "G#4", "t"), (48, "A4", ""), (48, "B4", ""), (48, "D5", ""),
         (48, "C5", ""), (48, "E4", ""), (48, "A4", "")],
    10: [(288, "F#4", ""), (96, "A4", "")],
    11: [(288, "F#4", ""), (0, "B4", "G"), (96, "A4", "")],
    12: [(48, "G4", "!"), (48, "F#4", ""), (48, "C4", ""), (48, "B3", ""),
         (48, "D#4", ""), (48, "F#4", ""),
         (TRIP8, "D5", "3"), (TRIP8, "C5", "3"), (TRIP8, "B4", "3")],
    13: [(288, "B4", ""), (96, "C5", "")],
    14: [(288, "B4", ""), (96, "C5", "")],
    15: [(288, "B4", ""), (96, "C5", "")],
    16: [(72, "B4", ""), (24, "A#4", ""), (96, "A#4", ""),
         (96, "G##5", ""), (72, "F#5", ""), (24, "E5", "")],
    17: [(48, "E5", ""), (48, "D#5", ""), (48, "C6", ""), (48, "D#5", ""),
         (48, "D#5", ""), (48, "E5", ""), (48, "G5", ""), (48, "B4", "")],
    18: [(48, "D5", "!"), (48, "C5", ""),
         (TRIP8, "E5", "3"), (TRIP8, "E4", "3"), (TRIP8, "A4", "3"),
         (144, "F#4", ""), (48, "A4", "")],
    19: [(288, "F#4", ""), (0, "B4", "G"), (96, "A4", "")],
    20: [(288, "F#4", "T"), (72, "F#4", "t"), (24, "E4", "")],
    21: [(288, "E4", ""), (96, "F#4", "")],
    22: [(288, "E4", ""), (96, "F#4", "")],
    23: [(192, "E4", ""), (192, None, "F")],
    24: [(192, "E4", ""), (192, "D#4", "")],
    25: [(384, "E4", "F")],
}

# Bars 24-25 of the right hand carry a second voice that the source prints on
# the lower staff (\change Staff = "lh" \crossStaff).  It is right-hand music
# living on staff 2, so it gets its own voice there.
RH_CROSS = {
    24: [(192, ["F#3", "B3", "E3"], ""), (192, ["B3", "D#3", "F#3"], "")],
    25: [(384, ["G3", "B3", "E3"], "")],
}


def run(chord, count, flags=""):
    """`count` repeated eighth-note chords -- the left hand's whole idiom."""
    return [(DIV // 2, chord, flags)] * count


LH = {                                                            # \playLH
    0:  [(96, None, "")],
    1:  run(["G3", "B3", "E4"], 8),
    2:  run(["F#3", "A3", "E4"], 4) + run(["F#3", "A3", "D#4"], 4),
    3:  run(["F3", "A3", "D#4"], 4) + run(["F3", "A3", "D4"], 2)
        + run(["F3", "G#3", "D4"], 2),
    4:  run(["E3", "G#3", "D4"], 4) + run(["E3", "G3", "D4"], 2)
        + run(["E3", "G3", "C#4"], 2),
    5:  run(["E3", "G3", "C4"], 4) + run(["E3", "F#3", "C4"], 4),
    6:  run(["E3", "F#3", "C4"], 4) + run(["D#3", "F#3", "C4"], 4),
    7:  run(["D3", "F#3", "C4"], 8),
    8:  run(["D3", "F3", "C4"], 4) + run(["D3", "F3", "B3"], 4),
    9:  run(["C3", "E3", "B3"], 2) + run(["C3", "E3", "A3"], 6),
    10: run(["B2", "E3", "A3"], 2) + run(["B2", "D#3", "A3"], 2)
        + run(["C3", "E3", "A3"], 4),
    11: run(["B2", "D#3", "A3"], 4) + run(["C3", "E3", "A3"], 4),
    12: [(96, ["B2", "D#3", "A3"], ""), (96, None, ""), (192, None, "")],
    13: run(["G3", "B3", "E4"], 8),
    14: run(["F#3", "A3", "E4"], 4) + run(["F3", "A3", "D#4"], 4),
    15: run(["F3", "G#3", "D#4"], 2) + run(["F3", "G#3", "D4"], 2)
        + run(["E3", "G#3", "D4"], 4),
    16: run(["E3", "G3", "D4"], 2) + run(["E3", "G3", "C#4"], 2)
        + run(["C#3", "E3", "A#3"], 2) + run(["C3", "E3", "A3"], 2),
    17: run(["B1", "B2"], 1) + run(["A3", "C4", "F#4", "A4"], 3)
        + run(["G3", "B3", "D#4", "F#4"], 1) + run(["G3", "B3", "E4"], 3),
    18: run(["A3", "C4", "E4"], 2) + run(["A2"], 1)
        + run(["E3", "F#3", "C4"], 1) + run(["B2", "E3", "B3"], 2)
        + run(["C3", "E3", "A3"], 2),
    19: run(["B2", "E3", "B3"], 4) + run(["C3", "E3", "A3"], 4),
    20: run(["B2", "E3", "B3"], 4) + run(["B2", "D#3", "B3"], 2)
        + run(["B2", "D#3", "A3"], 2),
    21: run(["C3", "G3"], 4) + run(["C3", "Bb3"], 2)
        + run(["C3", "E3", "A3"], 2),
    22: run(["B2", "E3", "A3"], 2) + run(["B2", "E3", "G#3"], 2)
        + run(["B2", "E3", "G3"], 4),
    23: [(192, ["Bb2", "C3", "G3"], ""), (192, None, "F")],
    24: [(192, ["B1", "B2"], "!"), (192, ["B1", "F#2", "B2"], "")],
    25: [(384, ["E1", "E2"], "F")],
}

# Sustain pedal, straight from the \sustainOn / \sustainOff marks:
# bar -> {index of the left-hand event: "start" | "stop"}.
PEDAL = {
    1:  {0: "start", 6: "stop"},
    2:  {0: "start", 3: "stop", 4: "start", 7: "stop"},
    3:  {0: "start", 3: "stop"},
    4:  {0: "start", 3: "stop"},
    5:  {0: "start", 3: "stop"},
    6:  {0: "start", 3: "stop", 4: "start", 7: "stop"},
    7:  {0: "start", 6: "stop"},
    8:  {0: "start", 3: "stop"},
    10: {4: "start", 7: "stop"},
    11: {0: "start", 3: "stop", 4: "start", 7: "stop"},
    13: {0: "start", 6: "stop"},
    14: {0: "start", 3: "stop", 4: "start", 7: "stop"},
    15: {4: "start", 7: "stop"},
    17: {0: "start", 3: "stop"},
    18: {2: "start", 3: "stop"},
    19: {0: "start", 3: "stop"},
    20: {0: "start", 3: "stop", 4: "start", 7: "stop"},
    21: {0: "start", 6: "stop"},
    22: {4: "start", 7: "stop"},
}

LAST_BAR = 25
KEY_FIFTHS = 1                # E minor -> F sharp
ACCIDENTAL_NAMES = {2: "double-sharp", 1: "sharp", 0: "natural", -1: "flat",
                    -2: "flat-flat"}


def parse_pitch(name):
    """'G##5' -> ('G', 2, 5).  Uppercase letter, then '#'/'b', then octave."""
    step, alter, i = name[0], 0, 1
    while name[i] in "#b":
        alter += 1 if name[i] == "#" else -1
        i += 1
    return step, alter, int(name[i:])


class Accidentals:
    """Which accidental a note needs, per staff, reset at every barline.

    MusicXML states the accidental to *print*; the pitch itself is already
    exact.  Getting this right is what makes the engraved staff readable.
    """

    def __init__(self):
        self.state = {}

    def new_bar(self):
        self.state = {}

    def needed(self, step, alter, octave, forced):
        key_alter = 1 if (step == "F" and KEY_FIFTHS >= 1) else 0
        current = self.state.get((step, octave), key_alter)
        self.state[(step, octave)] = alter
        return forced or alter != current


def indent(depth, line):
    return "  " * depth + line


class Builder:
    def __init__(self):
        self.out = []
        self.acc = {1: Accidentals(), 2: Accidentals()}

    def w(self, depth, line):
        self.out.append(indent(depth, line))

    def note(self, dur, pitches, flags, voice, staff, tuplet=None):
        grace = "G" in flags
        rest = pitches is None
        names = [] if rest else ([pitches] if isinstance(pitches, str) else pitches)
        type_dur = TRIP8 if "3" in flags else (dur if not grace else DIV // 2)
        ntype, dots = NOTE_TYPES[type_dur]

        for i, name in enumerate(names):
            self.w(3, "<note>")
            if grace:
                self.w(4, '<grace slash="yes"/>')
            if i:
                self.w(4, "<chord/>")
            step, alter, octave = parse_pitch(name)
            self.w(4, "<pitch>")
            self.w(5, f"<step>{step}</step>")
            if alter:
                self.w(5, f"<alter>{alter}</alter>")
            self.w(5, f"<octave>{octave}</octave>")
            self.w(4, "</pitch>")
            if not grace:
                self.w(4, f"<duration>{dur}</duration>")
            if "T" in flags:
                self.w(4, '<tie type="start"/>')
            if "t" in flags:
                self.w(4, '<tie type="stop"/>')
            self.w(4, f"<voice>{voice}</voice>")
            self.w(4, f"<type>{ntype}</type>")
            for _ in range(dots):
                self.w(4, "<dot/>")
            if self.acc[staff].needed(step, alter, octave, "!" in flags):
                caut = ' cautionary="yes"' if "!" in flags else ""
                self.w(4, f"<accidental{caut}>{ACCIDENTAL_NAMES[alter]}</accidental>")
            if "3" in flags:
                self.w(4, "<time-modification>")
                self.w(5, "<actual-notes>3</actual-notes>")
                self.w(5, "<normal-notes>2</normal-notes>")
                self.w(4, "</time-modification>")
            self.w(4, f"<staff>{staff}</staff>")
            self.notations(flags, first=i == 0, tuplet=tuplet)
            self.w(3, "</note>")

        if rest:
            self.w(3, "<note>")
            self.w(4, "<rest/>")
            self.w(4, f"<duration>{dur}</duration>")
            self.w(4, f"<voice>{voice}</voice>")
            self.w(4, f"<type>{ntype}</type>")
            for _ in range(dots):
                self.w(4, "<dot/>")
            self.w(4, f"<staff>{staff}</staff>")
            self.notations(flags, first=True, tuplet=tuplet)
            self.w(3, "</note>")

    def backup(self, length):
        self.w(3, "<backup>")
        self.w(4, f"<duration>{length}</duration>")
        self.w(3, "</backup>")

    def notations(self, flags, first, tuplet=None):
        marks = []
        if first and "T" in flags:
            marks.append('<tied type="start"/>')
        if first and "t" in flags:
            marks.append('<tied type="stop"/>')
        if first and "F" in flags:
            marks.append("<fermata/>")
        if first and tuplet:
            marks.append(f'<tuplet type="{tuplet}" number="1"/>')
        if not marks:
            return
        self.w(4, "<notations>")
        for m in marks:
            self.w(5, m)
        self.w(4, "</notations>")

    def voice_run(self, events, voice, staff, pedal=None):
        # A tuplet bracket needs a start on its first member and a stop on its
        # last, so each run of "3"-flagged events is bracketed as a group.
        tuplet_at = {}
        run_start = None
        for i, e in enumerate(events + [(0, None, "")]):
            if "3" in e[2] and run_start is None:
                run_start = i
            elif "3" not in e[2] and run_start is not None:
                tuplet_at[run_start], tuplet_at[i - 1] = "start", "stop"
                run_start = None

        for i, (dur, pitches, flags) in enumerate(events):
            if pedal and i in pedal:
                self.w(3, '<direction placement="below">')
                self.w(4, "<direction-type>")
                self.w(5, f'<pedal type="{pedal[i]}" line="no"/>')
                self.w(4, "</direction-type>")
                self.w(4, f"<staff>{staff}</staff>")
                self.w(3, "</direction>")
            self.note(dur, pitches, flags, voice, staff, tuplet_at.get(i))

    def build(self):
        self.w(0, '<?xml version="1.0" encoding="UTF-8"?>')
        self.w(0, '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.0 Partwise//EN"')
        self.w(0, '                                "http://www.musicxml.org/dtds/partwise.dtd">')
        self.w(0, "<!-- GENERATED FILE - do not edit by hand.")
        self.w(0, "     Rebuild with: python3 scores/build_chopin_prelude_op28_no4.py")
        self.w(0, "     Transcribed from chopin_prelude_4.ly (Mutopia, public domain). -->")
        self.w(0, '<score-partwise version="3.0">')
        self.w(1, "<work>")
        self.w(2, "<work-number>Op. 28, No. 4</work-number>")
        self.w(2, "<work-title>Prelude in E minor</work-title>")
        self.w(1, "</work>")
        self.w(1, "<identification>")
        self.w(2, '<creator type="composer">Frederic Chopin (1810-1849)</creator>')
        self.w(2, '<rights type="copyright">Public Domain</rights>')
        self.w(2, "<source>Peters, 1879, via Mutopia-2016/10/28-468</source>")
        self.w(2, "<encoding>")
        self.w(3, "<software>harmonicland scores/build_chopin_prelude_op28_no4.py</software>")
        self.w(3, "<supports element=\"accidental\" type=\"yes\"/>")
        self.w(2, "</encoding>")
        self.w(1, "</identification>")
        self.w(1, "<part-list>")
        self.w(2, '<score-part id="P1">')
        self.w(3, "<part-name>Piano</part-name>")
        self.w(3, '<score-instrument id="P1-I1">')
        self.w(4, "<instrument-name>acoustic grand</instrument-name>")
        self.w(4, "<instrument-sound>keyboard.piano.grand</instrument-sound>")
        self.w(3, "</score-instrument>")
        self.w(3, '<midi-instrument id="P1-I1">')
        self.w(4, "<midi-channel>1</midi-channel>")
        self.w(4, "<midi-program>1</midi-program>")
        self.w(3, "</midi-instrument>")
        self.w(2, "</score-part>")
        self.w(1, "</part-list>")
        self.w(1, '<part id="P1">')

        for bar in range(0, LAST_BAR + 1):
            length = 96 if bar == 0 else BAR
            implicit = ' implicit="yes"' if bar == 0 else ""
            self.w(2, f'<measure number="{bar}"{implicit}>')
            for a in self.acc.values():
                a.new_bar()

            if bar == 0:
                self.w(3, "<attributes>")
                self.w(4, f"<divisions>{DIV}</divisions>")
                self.w(4, "<key>")
                self.w(5, f"<fifths>{KEY_FIFTHS}</fifths>")
                self.w(5, "<mode>minor</mode>")
                self.w(4, "</key>")
                self.w(4, '<time symbol="cut">')
                self.w(5, "<beats>2</beats>")
                self.w(5, "<beat-type>2</beat-type>")
                self.w(4, "</time>")
                self.w(4, "<staves>2</staves>")
                self.w(4, '<clef number="1">')
                self.w(5, "<sign>G</sign>")
                self.w(5, "<line>2</line>")
                self.w(4, "</clef>")
                self.w(4, '<clef number="2">')
                self.w(5, "<sign>F</sign>")
                self.w(5, "<line>4</line>")
                self.w(4, "</clef>")
                self.w(3, "</attributes>")
                self.w(3, '<direction placement="above">')
                self.w(4, "<direction-type>")
                self.w(5, '<words font-weight="bold">Largo</words>')
                self.w(4, "</direction-type>")
                self.w(4, '<sound tempo="56"/>')
                self.w(3, "</direction>")

            self.voice_run(RH[bar], voice=1, staff=1)

            if bar in RH_CROSS:
                self.backup(length)
                self.voice_run(RH_CROSS[bar], voice=2, staff=2)

            self.backup(length)
            self.voice_run(LH[bar], voice=5, staff=2, pedal=PEDAL.get(bar))

            if bar == LAST_BAR:
                self.w(3, "<barline location=\"right\">")
                self.w(4, "<bar-style>light-heavy</bar-style>")
                self.w(3, "</barline>")
            self.w(2, "</measure>")

        self.w(1, "</part>")
        self.w(0, "</score-partwise>")
        return "\n".join(self.out) + "\n"


def main():
    for bar in range(0, LAST_BAR + 1):
        want = 96 if bar == 0 else BAR
        for label, table in (("rh", RH), ("lh", LH), ("rh-cross", RH_CROSS)):
            if bar not in table:
                continue
            total = sum(d for d, _, f in table[bar] if "G" not in f)
            assert total == want, f"bar {bar} {label}: {total} != {want}"
    xml = Builder().build()
    path = Path(__file__).with_name("chopin_prelude_op28_no4.musicxml")
    path.write_text(xml, encoding="utf-8")
    print(f"wrote {path} ({len(xml.splitlines())} lines)")


if __name__ == "__main__":
    main()
