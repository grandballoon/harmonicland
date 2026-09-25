/* ====================================================================
   LIBRARY FETCH — pieces.json -> library/sources/ + library/manifest.json.

   pieces.json is the hand-written list: which pieces, from which open
   sources, pinned to which commit. This script downloads exactly those
   files, byte for byte, and writes the manifest — the generated record
   of what was fetched, from where, under what license, with checksums.
   Nothing here converts or interprets music; it only captures sources.

   Run with Node ≥ 22 (native TypeScript):  node tools/library/fetch.ts
   ==================================================================== */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";

const ROOT = join(import.meta.dirname, "../..");
const LIBRARY = join(ROOT, "library");
const PARALLEL = 8;

interface RepoPin {
  commit: string;
  /** Set when the license is dataset-wide rather than stated per file. */
  license?: string;
}

/** A source is either a pinned GitHub repo (entries + includes, as repo
 *  paths) or one unversioned URL saved at `path` under sources/. */
interface SourceSpec {
  repo?: string;
  entries?: string[];
  includes?: string[];
  url?: string;
  path?: string;
}

interface PieceSpec {
  id: string;
  composer: string;
  title: string;
  catalogue: string;
  group: "well-known" | "gem";
  sources: SourceSpec[];
}

interface Pieces {
  repos: Record<string, RepoPin>;
  pieces: PieceSpec[];
}

interface FetchedFile {
  /** Path under library/, posix-style. */
  local: string;
  url: string;
  sha256: string;
  bytes: number;
}

interface Download {
  url: string;
  local: string;
}

const spec: Pieces = JSON.parse(readFileSync(join(LIBRARY, "pieces.json"), "utf8"));

function downloadsFor(src: SourceSpec): { entries: Download[]; includes: Download[] } {
  const repo = src.repo;
  if (repo) {
    const pin = spec.repos[repo];
    if (!pin) throw new Error(`repo ${repo} has no pin in pieces.json`);
    const dl = (p: string): Download => ({
      url: `https://raw.githubusercontent.com/${repo}/${pin.commit}/${p}`,
      local: posix.join("sources/github", repo, p),
    });
    return { entries: (src.entries ?? []).map(dl), includes: (src.includes ?? []).map(dl) };
  }
  if (src.url && src.path) return { entries: [{ url: src.url, local: posix.join("sources", src.path) }], includes: [] };
  throw new Error(`source needs either repo+entries or url+path: ${JSON.stringify(src)}`);
}

async function fetchOne(d: Download): Promise<FetchedFile> {
  const res = await fetch(d.url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${d.url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const out = join(LIBRARY, d.local);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, buf);
  return { local: d.local, url: d.url, sha256: createHash("sha256").update(buf).digest("hex"), bytes: buf.length };
}

async function pool<T, R>(items: T[], n: number, f: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await f(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

/** What a file says about itself: its license line and its title, read
 *  from the format's own header conventions. Absent means unstated. */
function selfDescription(local: string): { license?: string; copyright?: string; title?: string; opus?: string; number?: string } {
  const text = readFileSync(join(LIBRARY, local), "utf8");
  const first = (re: RegExp) => re.exec(text)?.[1]?.trim();
  if (local.endsWith(".ly")) {
    return {
      license: first(/^\s*license\s*=\s*"([^"]*)"/m) ?? first(/^\s*copyright\s*=\s*"([^"]*)"/m),
      title: first(/^\s*mutopiatitle\s*=\s*"([^"]*)"/m) ?? first(/^\s*title\s*=\s*"([^"]*)"/m),
    };
  }
  if (local.endsWith(".krn")) {
    return {
      license: first(/^!!!YEM[^:]*:(.*)$/m),
      copyright: first(/^!!!YEC[^:]*:(.*)$/m),
      title: first(/^!!!OTL[^:]*:(.*)$/m),
      opus: first(/^!!!OPS[^:]*:(.*)$/m),
      number: first(/^!!!ONM[^:]*:(.*)$/m),
    };
  }
  if (local.endsWith(".musicxml")) {
    return {
      copyright: first(/<rights>([^<]*)<\/rights>/),
      title: first(/<work-title>([^<]*)<\/work-title>/) ?? first(/<movement-title>([^<]*)<\/movement-title>/),
    };
  }
  return {};
}

/** Every `\include "x"` in a fetched .ly must resolve to a fetched file,
 *  or LilyPond will fail (or worse, pick up something else) later. */
function checkIncludes(local: string): string[] {
  if (!local.endsWith(".ly")) return [];
  const text = readFileSync(join(LIBRARY, local), "utf8");
  const missing: string[] = [];
  for (const m of text.matchAll(/\\include\s+"([^"]+)"/g)) {
    // LilyPond's own init files (e.g. "english.ly") resolve from its install, not here.
    if (LILYPOND_INIT.test(m[1])) continue;
    const target = posix.join(posix.dirname(local), m[1]);
    if (!existsSync(join(LIBRARY, target))) missing.push(target);
  }
  return missing;
}

const LILYPOND_INIT =
  /^(english|deutsch|italiano|espanol|catalan|nederlands|norsk|portugues|suomi|svenska|vlaams|articulate|gregorian|event-listener|predefined-[\w-]+)\.ly$/;

async function main(): Promise<void> {
  const plan = spec.pieces.flatMap((p) => p.sources.map((s) => ({ piece: p, src: s, ...downloadsFor(s) })));
  const unique = new Map<string, Download>();
  for (const x of plan) for (const d of [...x.entries, ...x.includes]) unique.set(d.local, d);

  const fetched = new Map<string, FetchedFile>();
  for (const f of await pool([...unique.values()], PARALLEL, fetchOne)) fetched.set(f.local, f);

  const problems: string[] = [];
  const manifest = {
    _generated: "by tools/library/fetch.ts from library/pieces.json — do not edit by hand",
    pieces: spec.pieces.map((p) => ({
      id: p.id,
      composer: p.composer,
      title: p.title,
      catalogue: p.catalogue,
      group: p.group,
      sources: p.sources.map((s) => {
        const { entries, includes } = downloadsFor(s);
        const pin = s.repo ? spec.repos[s.repo] : undefined;
        const described = entries.map((d) => ({ ...fetched.get(d.local)!, ...selfDescription(d.local) }));
        for (const d of [...entries, ...includes]) {
          for (const miss of checkIncludes(d.local)) problems.push(`${p.id}: ${d.local} includes missing ${miss}`);
        }
        return {
          origin: s.repo ? `github:${s.repo}` : new URL(s.url!).host,
          commit: pin?.commit ?? null,
          datasetLicense: pin?.license ?? null,
          entries: described,
          includes: includes.map((d) => fetched.get(d.local)!),
        };
      }),
    })),
  };

  writeFileSync(join(LIBRARY, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`fetched ${fetched.size} files for ${spec.pieces.length} pieces`);
  if (problems.length) {
    console.error(problems.join("\n"));
    process.exitCode = 1;
  }
}

await main();
