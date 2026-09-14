Current:
[x] Fix all the bugs in @hidden-coupling.md

Next:
Redesign each individual screen with Claude Design

Before the redesign:
Replace the missing test fixtures.
`scores/` now holds only MIDI, so the hands feature is exercised on one of its three code paths.
MIDI resolves `hand` from note-bearing tracks, MusicXML resolves it per part from `<staff>` or part ordinal, and LilyPond emits no `hand` at all — a score that must render unchanged with the toggle on.
Need at least one MusicXML and one LilyPond fixture back before redesigning the staff views.

After:
Rearchitect application to accommodate new screens, checking hidden coupling along the way.

Finally:
Draft plan for a mobile port (Details TBD)
