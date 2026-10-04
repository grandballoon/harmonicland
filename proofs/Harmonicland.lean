-- the timing core: these import one another, in this order
import Harmonicland.Core
import Harmonicland.Steps
import Harmonicland.Loop
import Harmonicland.Clock
import Harmonicland.Perform
import Harmonicland.Scheduler
-- the rest stand alone: each imports only Lean core
import Harmonicland.Pitch
import Harmonicland.Tonnetz
import Harmonicland.Perfecto
import Harmonicland.Progression
import Harmonicland.Sections
import Harmonicland.PedalMarks
import Harmonicland.Dynamics
import Harmonicland.Mic
import Harmonicland.LiveKeys
import Harmonicland.Reconcile
import Harmonicland.PracticeCursor
import Harmonicland.MidiOut
import Harmonicland.Engrave
import Harmonicland.MidiParse
import Harmonicland.XmlLily
import Harmonicland.Layout

/-!
# Harmonicland — Lean 4 models of the TypeScript in `../src`

One file per slice of the codebase. `FINDINGS.md` says what was proved, what
fails, and what was left out; `CONVENTIONS.md` says how the models are built.
-/
