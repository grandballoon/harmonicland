/* The converted library, read the way the app reads it. convert.ts
   verified each file note for note when it was made; this keeps it true
   as the app's parser changes: every file still parses, into the number
   of notes that were verified, with bars that start at 0 and abut. */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MusicxmlIn } from "../../src/inputs/musicxml.ts";

const LIBRARY = join(import.meta.dirname, "../../library");
const REPORT = join(LIBRARY, "scores/report.json");

interface FileReport {
  piece: string;
  output?: string;
  error?: string;
  schema?: string[];
  verification?: { ok: boolean; notes: number };
}

const files: FileReport[] = existsSync(REPORT) ? JSON.parse(readFileSync(REPORT, "utf8")).files : [];

describe.skipIf(!files.length)("the converted library", () => {
  it("converted every source, valid and verified", () => {
    const failed = files.filter((f) => f.error || f.schema?.length || !f.verification?.ok).map((f) => f.piece);
    expect(failed).toEqual([]);
  });

  for (const f of files.filter((x) => x.output)) {
    it(`${f.output} parses into the notes that were verified`, () => {
      const score = MusicxmlIn.parse(readFileSync(join(LIBRARY, f.output!), "utf8"));
      expect(score.notes.length).toBe(f.verification!.notes);
      expect(score.bars[0].start).toBe(0);
      score.bars.forEach((b, i) => i && expect(b.start).toBeCloseTo(score.bars[i - 1].end, 9));
    });
  }
});
