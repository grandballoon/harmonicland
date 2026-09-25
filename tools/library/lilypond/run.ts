/* ====================================================================
   RUN — one captured .ly file -> LilyPond's own reading of it.

   The source is never edited. It is copied (with its includes) into
   library/build/, upgraded to the installed LilyPond's syntax by
   convert-ly — LilyPond's own, rule-based upgrader, which rewrites
   syntax and never music — plus the few rewrites in compat.ts that it
   lacks, and engraved with dump.ly loaded first.
   What comes back is the event dump and the plain MIDI dump.ly asks
   for; both are read by other modules, never interpreted here.
   ==================================================================== */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { applyCompat } from "./compat.ts";

const HERE = import.meta.dirname;
const LIBRARY = join(HERE, "../../../library");
const DUMP_LY = join(HERE, "dump.ly");

/** Per-source choices, made in pieces.json with their reasons. */
export interface LilypondOptions {
  /** Engrave a different tagged variant than the source's typeset score
   *  keeps: { printed: "played" } turns \keepWithTag #'printed into
   *  \keepWithTag #'played. */
  readonly keepWithTag?: Readonly<Record<string, string>>;
}

export interface LilypondRun {
  /** JSON-lines event dump written by dump.ly. */
  dump: string;
  /** The plain MIDI files, one per engraved score, in score order. */
  midis: string[];
  /** Everything LilyPond and convert-ly printed, for the conversion log. */
  log: string;
}

function run(cmd: string, args: string[], cwd: string, env: Record<string, string> = {}): string {
  const res = spawnSync(cmd, args, { cwd, encoding: "utf8", env: { ...process.env, ...env } });
  if (res.error) throw res.error;
  const out = `$ ${cmd} ${args.join(" ")}\n${res.stdout}${res.stderr}`;
  if (res.status !== 0) throw new Error(`${cmd} failed (exit ${res.status}):\n${out}`);
  return out;
}

/** `entry` and `includes` are paths under library/ as the manifest lists them. */
export function runLilypond(entry: string, includes: readonly string[], options: LilypondOptions = {}): LilypondRun {
  const workDir = join(LIBRARY, "build/lilypond", dirname(entry));
  rmSync(workDir, { recursive: true, force: true });
  let log = "";
  for (const file of [entry, ...includes]) {
    const copy = join(LIBRARY, "build/lilypond", file);
    mkdirSync(dirname(copy), { recursive: true });
    copyFileSync(join(LIBRARY, file), copy);
    // -e edits in place (the copy); convert-ly reads each file's own \version.
    log += run("convert-ly", ["-e", "--backup-numbered", basename(copy)], dirname(copy));
    const { text, applied } = applyCompat(readFileSync(copy, "utf8"));
    writeFileSync(copy, retag(text, options, file, (line) => (log += line)));
    for (const a of applied) log += `compat: ${a.rule} applied ${a.count}x in ${file}\n`;
  }
  for (const [from, to] of Object.entries(options.keepWithTag ?? {})) {
    if (!log.includes(`option: keepWithTag ${from} -> ${to}`)) throw new Error(`\\keepWithTag #'${from} not found for ${entry}`);
  }

  const engraved = engrave(workDir, basename(entry, ".ly"));
  return { ...engraved, log: log + engraved.log };
}

/** A LilyPond file already in current syntax (a test fixture), engraved
 *  in `workDir` as it stands. */
export function runLilypondFile(path: string, workDir: string): LilypondRun {
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });
  copyFileSync(path, join(workDir, basename(path)));
  return engrave(workDir, basename(path, ".ly"));
}

/** Engraves `name`.ly in `workDir` with dump.ly loaded first. */
function engrave(workDir: string, name: string): LilypondRun {
  const dump = join(workDir, `${name}.dump.jsonl`);
  const log = run(
    "lilypond",
    [`-dinclude-settings=${DUMP_LY}`, "-dno-print-pages", "-dno-point-and-click", "-l", "WARNING", `${name}.ly`],
    workDir,
    { HARMONIC_DUMP: dump },
  );
  if (!existsSync(dump)) throw new Error(`no dump written for ${name}.ly`);

  // LilyPond names successive outputs name.midi, name-1.midi, name-2.midi …
  // The ordinal is read after the name, which may itself end in "-1".
  const ordinal = (f: string): number | null => {
    if (f === `${name}.midi`) return 0;
    const n = f.startsWith(`${name}-`) && f.endsWith(".midi") ? f.slice(name.length + 1, -".midi".length) : "";
    return /^\d+$/.test(n) ? Number(n) : null;
  };
  const midis = readdirSync(workDir)
    .filter((f) => ordinal(f) !== null)
    .sort((a, b) => ordinal(a)! - ordinal(b)!)
    .map((f) => join(workDir, f));
  return { dump, midis, log };
}

function retag(text: string, options: LilypondOptions, file: string, note: (line: string) => void): string {
  for (const [from, to] of Object.entries(options.keepWithTag ?? {})) {
    let n = 0;
    text = text.replace(new RegExp(`\\\\keepWithTag\\s+#?'?${from}\\b`, "g"), () => (n++, `\\keepWithTag #'${to}`));
    if (n) note(`option: keepWithTag ${from} -> ${to} applied ${n}x in ${file}\n`);
  }
  return text;
}
