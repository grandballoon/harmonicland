# REDTEAM
- I'm probably thinking about this purely (overmuch) in terms of encodings, data formats, and file types, because I have limited familiarity with what they actually represent in terms of physical instruments. I should be careful about overrepresenting my understanding of music, playing, or musicianship until I can personally verify that these formats work well alongside actual instruments people would recognize—a keyboard, a guitar, maybe even a voice. 
- It'll probably take more discipline and UI finessing than I'm capable to conceptualizing at this point to A) make the interface streamlined enough to be maximally useful to beginners or non-experts, and B) make the connections between these views explicit and obvious.
- I also shouldn't forget that this came out of my wish to make it easy to practice the FOPP principles, and that motor learning and practice records aren't really represented here at all. Since this is meant to be an externalization of mental or inherent physical/mathematical structures of music, it's important not to forget that this is a learning tool, not primarily a platform designed for engagement. You're supposed to be able to move beyond it, or get benefit from a minmal amount of usage, if that's what you want. 
- I should plan to support analog, paper-based versions of everything. Don't shrug that off, plan on people not wanting digital solutions—remember that the goal of the platform is to kill the platform, a "suicidal corporation." ("compostable corporation"?) ("tempcorp.")

Will eventually need a "piano keyboard" view like Synthesia or whatever that app is—the thing YouTube tutorials use.

Should plan to wire up the tonnetz and circle views after interactivity is established. 

Will need a plan to break this into separate files eventually, too.

Will also need to migrate to TypeScript and establish data forms.

We can just take either side at leisure: implement new view, implement new input. 

We have a set of inputs and a set of outputs.

Changes to list of inputs:
- We should build in a more robust sound engine or simply punt and make it possible to pull MIDI sounds from any other program (GarageBand, for instance).
- Eventually it'd be good to expand to include uploads for PDFs of Sheet Music in addition to MusicXML. Maybe that needs to be done elsewhere in the application. Need more research on OCR for music, but I'm willing to bet it's a solved or solvable problem.
- I don't know how much information one needs from an .mp4 or .mp3 that wouldn't be present in the file itself, but what's the actual, precise gap between the interfaces of an .mp4 and MIDI file?
- Eventually we'll want to support pure audio pickup from live instruments. I know there is at least one option out there for this (according to a previous Claude chat) but I'm curious about the necessary minimum floor for a usable fidelity. Could be pretty forgiving, given the current state of home audio equipment. Maybe there's something in the world of guitar pedals that's affordable, popular, and a suitable interface. Will need to look.


Changes to list of outputs:
- It would be good to have the tonnetz view interactive. I'd like the click-to-highlight, some kind of playback mechanism (maybe tied to the time signature of a piece, or an AST of Time Signature) and the ability to step through each beat/measure and see the tonnetz highlight in the same fashion as the staff view.
- It'll eventually be necessary to map the gamepad inputs to a hotkey function. I don't know if these will be specific to a given view or something more universal. The obvious connection is with hiChord, but probably there are many, many possibilities. This could be a good prototype for a steam deck/Nintendo switch port, and for the Lua Gameboy specification (I'm sure that could be ported as a game, instead of a dedicated hardware device, too, for a much cheaper per-unit price).
- I'm also willing to bet the tonnetz view is friendly to hotkeys—like "auto-highlight a given mode" or "show a certain set of possible next options in a chord progression, based on this highlight." 
- I wonder if it would be useful to show the tonnetz and piano roll simultaneously for live-input MIDI keyboard play. 
- A MIDI-powered monochord is an interesting idea of how to "flatten" a piano keyboard—I'm assuming it would mean a MIDI keyboard plugged in that produces some kind of shrunken pitch space, i.e. a C two octaves above middle C produces the same exact tone because both correspond to the same single point on the monochord. Just guessing.

- We should implement Circle of Fifth and Chromatic Circle views
- We should implement Nashville Number system alongside the chord coloration option—but I'm betting that the space of chord coloring/mode-augmentation options is A) much larger than what was built for Perfecto, and B) possible to concretize in a more precise way based on the Geometrical approach described in A Geometry of Music. (I wonder if any of that overlaps with tonnetz view. Might be nice.)