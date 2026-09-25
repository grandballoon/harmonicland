/* ====================================================================
   CONVERT — library/sources -> library/scores, verified.

   For every LilyPond source in the manifest (or just the pieces named
   on the command line):

     run.ts       LilyPond reads it, with dump.ly recording what it did
     dump.ts      the recording, typed
     to-score.ts  the recording as notation (model.ts)
     musicxml.ts  the notation as MusicXML
     schema.ts    the MusicXML, against the MusicXML 4.0 schema
     verify.ts    the MusicXML, read by the app, against LilyPond's MIDI

   Writes library/scores/<piece>/<source>.musicxml and a generated
   library/scores/report.json saying, per file, what was converted,
   every warning, and whether it verified. Exits non-zero if anything
   failed, having still converted everything it could.

     node --import ./tools/library/extensionless.ts tools/library/convert.ts [piece-id …]
   ==================================================================== */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { readDump } from "./lilypond/dump.ts";
import { runLilypond, type LilypondOptions } from "./lilypond/run.ts";
import { toScore } from "./lilypond/to-score.ts";
import { toMusicXml } from "./score/musicxml.ts";
import type { NoteGroup, Score } from "./score/model.ts";
import { schemaErrors } from "./schema.ts";
import { verify, type Verification } from "./verify.ts";

const LIBRARY = join(import.meta.dirname, "../../library");

interface ManifestEntry {
  local: string;
  url: string;
  sha256: string;
  license?: string;
  title?: string;
}
interface ManifestPiece {
  id: string;
  composer: string;
  title: string;
  catalogue: string;
  sources: { origin: string; entries: ManifestEntry[]; includes: { local: string }[] }[];
}

interface FileReport {
  piece: string;
  source: string;
  sha256: string;
  output?: string;
  measures?: number;
  /** Messages from validating against the MusicXML 4.0 schema; empty is valid. */
  schema?: string[];
  verification?: Verification;
  warnings: string[];
  lilypond: string[];
  error?: string;
}

const manifest = JSON.parse(readFileSync(join(LIBRARY, "manifest.json"), "utf8")) as { pieces: ManifestPiece[] };
// Conversion choices live with the sources in the hand-written list; the
// manifest's sources are in the same order.
const spec = JSON.parse(readFileSync(join(LIBRARY, "pieces.json"), "utf8")) as {
  pieces: { id: string; sources: { lilypond?: LilypondOptions & { why?: string } }[] }[];
};
const optionsFor = (piece: string, source: number): LilypondOptions =>
  spec.pieces.find((p) => p.id === piece)?.sources[source]?.lilypond ?? {};
const only = new Set(process.argv.slice(2));
const lilypondVersion = spawnSync("lilypond", ["--version"], { encoding: "utf8" }).stdout.split("\n")[0].trim();

const reports: FileReport[] = [];
for (const piece of manifest.pieces) {
  if (only.size && !only.has(piece.id)) continue;
  const entries = piece.sources.flatMap((s, i) => s.entries.filter((e) => e.local.endsWith(".ly")).map((e) => ({ e, s, i })));
  for (const { e, s, i } of entries) {
    const report: FileReport = { piece: piece.id, source: e.url, sha256: e.sha256, warnings: [], lilypond: [] };
    reports.push(report);
    try {
      convertOne(piece, e, s.includes.map((x) => x.local), optionsFor(piece.id, i), entries.length > 1, report);
      report.schema = await schemaErrors(join(LIBRARY, report.output!));
    } catch (err) {
      report.error = err instanceof Error ? err.message : String(err);
    }
    const status = report.error
      ? `FAILED: ${report.error.split("\n")[0]}`
      : report.schema!.length
        ? `INVALID (${report.schema![0]})`
        : report.verification!.ok ? "verified" : `MISMATCH (${report.verification!.problems.length})`;
    console.log(`${piece.id.padEnd(24)} ${basename(e.local).padEnd(36)} ${status}`);
  }
}

mkdirSync(join(LIBRARY, "scores"), { recursive: true });
if (!only.size) {
  writeFileSync(
    join(LIBRARY, "scores/report.json"),
    JSON.stringify({ _generated: "by tools/library/convert.ts — do not edit by hand", lilypond: lilypondVersion, files: reports }, null, 2) + "\n",
  );
}
const failed = reports.filter((r) => r.error || r.schema?.length || !r.verification?.ok);
console.log(`\n${reports.length - failed.length}/${reports.length} converted and verified`);
if (failed.length) process.exitCode = 1;

function convertOne(
  piece: ManifestPiece,
  entry: ManifestEntry,
  includes: string[],
  options: LilypondOptions,
  isMovement: boolean,
  report: FileReport,
): void {
  const run = runLilypond(entry.local, includes, options);
  // What LilyPond and the compat rules said about the source. The MIDI
  // channel messages come from dump.ly's per-voice witness, not the source.
  const ours = /MIDI channel wrapped around|remapping modulo/;
  report.lilypond = [...new Set(
    run.log.split("\n")
      .filter((l) => !l.startsWith("$ ") && /warning|error|^compat:|^option:/i.test(l) && !ours.test(l))
      .map((l) => l.replace(/^.*\/(?=[^/]+\.ly:)/, "")),
  )];

  // A \score inside a markup (an incipit, an ossia example) is engraved
  // too; the piece is the score with the most notes.
  const scores = readDump(run.dump);
  const count = (d: (typeof scores)[number]) => d.events.filter((ev) => ev.class === "note-event").length;
  const main = scores.reduce((a, b) => (count(b) > count(a) ? b : a));
  for (const other of scores) {
    if (other !== main) report.warnings.push(`an extra engraved score (${count(other)} notes, e.g. inside a markup) is not converted`);
  }
  // dump.ly renders two witnesses per score: by voice, then by staff.
  if (run.midis.length !== 2) throw new Error(`expected two MIDI files, LilyPond wrote ${run.midis.length}`);

  const header = { ...(main.header?.book ?? {}), ...(main.header?.score ?? {}) };
  const text = (k: string) => {
    const v = header[k] as { text?: string } | string | undefined;
    return typeof v === "string" ? v : v?.text?.trim() || undefined;
  };
  const { score, warnings } = toScore(main, {
    title: piece.title,
    composer: text("composer") ?? piece.composer,
    rights: [entry.license, text("copyright")].filter(Boolean).join(". "),
    source: entry.url,
    encodingNotes: [
      `Converted from the LilyPond source by ${lilypondVersion} reading it (event dump) — tools/library in harmonicland.`,
      ...(isMovement && entry.title ? [`Movement: ${entry.title}`] : []),
      ...report.lilypond.filter((l) => /^(compat|option):/.test(l)),
    ],
  });
  report.warnings.push(...warnings);
  const scoreWithMovement: Score = isMovement && entry.title ? { ...score, movement: entry.title } : score;

  const xml = toMusicXml(scoreWithMovement);
  const out = join("scores", piece.id, `${basename(entry.local, ".ly")}.musicxml`);
  mkdirSync(join(LIBRARY, "scores", piece.id), { recursive: true });
  writeFileSync(join(LIBRARY, out), xml);
  report.output = out;
  report.measures = score.measures.length;
  report.verification = verify(
    xml,
    { byVoice: readFileSync(run.midis[0]), byStaff: readFileSync(run.midis[1]) },
    gracePitches(score),
  );
}

function gracePitches(score: Score): number[] {
  const semis = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  return score.measures.flatMap((m) =>
    m.items
      .filter((it): it is NoteGroup => it.kind === "group" && !!it.grace)
      .flatMap((g) => g.notes.map((n) => 12 * (n.octave + 1) + semis[n.step] + n.alter)),
  );
}
