/* ====================================================================
   SCHEMA — every converted file is checked against the MusicXML 4.0 XSD.

   The schema is W3C's own, fetched once from the w3c/musicxml repository
   at its v4.0 tag into library/build/schema (not committed), with its two
   imports pointed at the local copies so validation never touches the
   network. xmllint (libxml2, shipped with macOS) does the validating.
   ==================================================================== */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DIR = join(import.meta.dirname, "../../library/build/schema");
const BASE = "https://raw.githubusercontent.com/w3c/musicxml/v4.0/schema";
const FILES = ["musicxml.xsd", "xlink.xsd", "xml.xsd"];

async function ensureSchema(): Promise<string> {
  const main = join(DIR, "musicxml.xsd");
  if (FILES.every((f) => existsSync(join(DIR, f)))) return main;
  mkdirSync(DIR, { recursive: true });
  for (const f of FILES) {
    const res = await fetch(`${BASE}/${f}`);
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching the MusicXML schema (${f})`);
    let text = await res.text();
    if (f === "musicxml.xsd") {
      text = text.replace(/schemaLocation="http:\/\/www\.musicxml\.org\/xsd\/(xml|xlink)\.xsd"/g, 'schemaLocation="$1.xsd"');
    }
    writeFileSync(join(DIR, f), text);
  }
  return main;
}

/** Validates one file; the result is empty when it is valid, else the
 *  validator's messages. */
export async function schemaErrors(path: string): Promise<string[]> {
  const xsd = await ensureSchema();
  const res = spawnSync("xmllint", ["--nonet", "--noout", "--schema", xsd, path], { encoding: "utf8" });
  if (res.error) throw res.error;
  if (res.status === 0) return [];
  return res.stderr.split("\n").filter((l) => l.trim() && !l.endsWith("fails to validate"));
}
