/* Regenerates the fixture's dump and witness MIDIs (needs LilyPond):
     node tools/library/lilypond/fixtures/make.ts */
import { renameSync } from "node:fs";
import { join } from "node:path";
import { runLilypondFile } from "../run.ts";

const here = import.meta.dirname;
const { dump, midis } = runLilypondFile(join(here, "features.ly"), join(here, "../../../../library/build/fixtures"));
renameSync(dump, join(here, "features.dump.jsonl"));
renameSync(midis[0], join(here, "features.by-voice.midi"));
renameSync(midis[1], join(here, "features.by-staff.midi"));
