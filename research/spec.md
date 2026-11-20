# Research Spec

## TODO: Geometry of Music code samples, playable from the gamepad

Implement the code samples from Dmitri Tymoczko's *A Geometry of Music* textbook in harmonicland.
Each sample should be playable and explorable with the gamepad attached, not only as static code.
Wire them in as `GamepadMapping`s on the existing live-gamepad engine ([src/live-gamepad.ts](../src/live-gamepad.ts)), following the pattern of [src/gamepad-tonnetz.ts](../src/gamepad-tonnetz.ts) and [src/gamepad-perfecto.ts](../src/gamepad-perfecto.ts).
