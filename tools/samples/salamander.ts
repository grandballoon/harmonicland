/* ====================================================================
   SALAMANDER SAMPLES — the Salamander Grand Piano V3 recordings -> the
   built-in piano's sample set (public/samples/salamander/) and its level
   table (src/outputs/salamander.json).

   The source is the sfzinstruments remap of Alexander Holm's recordings
   (CC BY 3.0), pinned to one commit: 16 velocity layers of 30 pitches, a
   minor third apart from A0, as 48kHz 24-bit stereo FLAC. Four layers are
   kept, spaced evenly through the 16 (see LAYERS), so a note's timbre, not
   just its volume, follows how hard it is played.

   Each recording is encoded to VBR MP3 (LAME V5, ~50 kbps on a decaying
   piano note) at its own sample rate, and is otherwise left as recorded:
   no normalising, because the level difference between layers IS the
   dynamics. Each file's peak level is measured and written to the level
   table, which the piano uses to keep loudness continuous across a layer
   boundary (outputs/audio.ts). Leading silence is not trimmed here: the
   MP3 encoder would add its own, so the piano measures it at decode.

   Downloads are cached in tools/samples/build/ (not committed), so a
   re-run only encodes. Needs ffmpeg with libmp3lame on the path.

   Run with Node ≥ 22 (native TypeScript):  node tools/samples/salamander.ts
   ==================================================================== */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../..");
const CACHE = join(import.meta.dirname, "build");
const OUT = join(ROOT, "public/samples/salamander");
const LEVELS = join(ROOT, "src/outputs/salamander.json");

const REPO = "sfzinstruments/SalamanderGrandPiano";
const COMMIT = "3382bf9496bba2486f5ab0de55a264d1dfc38404";

/** The layers kept, and the velocity each was recorded to stand for: the
 *  middle of its range in the source's SFZ mapping (Data/notes.txt). */
const LAYERS = [
  { layer: 4, velocity: 40 }, // lovel=37 hivel=43
  { layer: 8, velocity: 60.5 }, // lovel=57 hivel=64
  { layer: 12, velocity: 92.5 }, // lovel=89 hivel=96
  { layer: 16, velocity: 124 }, // lovel=121 hivel=127
];

/** Sample pitches: every minor third from A0 (21) to C8 (108). */
const PITCHES = Array.from({ length: 30 }, (_, i) => 21 + 3 * i);
const LETTERS: Record<number, [string, string]> = { 0: ["C", "C"], 3: ["D#", "Ds"], 6: ["F#", "Fs"], 9: ["A", "A"] };
/** [the source's name, ours] — ours avoids "#" in a URL. */
function names(pitch: number): [string, string] {
  const [src, ours] = LETTERS[pitch % 12];
  const octave = Math.floor(pitch / 12) - 1;
  return [src + octave, ours + octave];
}

async function download(url: string, to: string): Promise<void> {
  if (existsSync(to)) return;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  writeFileSync(to, Buffer.from(await res.arrayBuffer()));
}

/** Peak level in dBFS, as ffmpeg's volumedetect measures it (on stderr). */
function peakDb(file: string): number {
  const { stderr } = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-af", "volumedetect", "-f", "null", "-"], {
    encoding: "utf8",
  });
  const m = /max_volume: (-?[\d.]+) dB/.exec(stderr);
  if (!m) throw new Error(`no level measured for ${file}`);
  return Number(m[1]);
}

async function main(): Promise<void> {
  mkdirSync(CACHE, { recursive: true });
  const jobs = LAYERS.flatMap(({ layer }) => PITCHES.map((pitch) => ({ layer, pitch })));

  // fetch, a few at a time
  const queue = [...jobs];
  const worker = async (): Promise<void> => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const [src] = names(job.pitch);
      const file = `${src}v${job.layer}.flac`;
      const url = `https://raw.githubusercontent.com/${REPO}/${COMMIT}/Samples/${encodeURIComponent(file)}`;
      await download(url, join(CACHE, file));
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  console.log(`fetched ${jobs.length} recordings`);

  // encode into a clean tree: nothing stale survives a re-run
  for (const entry of readdirSync(OUT)) if (entry.endsWith(".mp3") || /^v\d+$/.test(entry)) rmSync(join(OUT, entry), { recursive: true });
  const peaks: Record<string, Record<string, number>> = {};
  for (const { layer, pitch } of jobs) {
    const [src, ours] = names(pitch);
    const dir = join(OUT, `v${layer}`);
    mkdirSync(dir, { recursive: true });
    const flac = join(CACHE, `${src}v${layer}.flac`);
    execFileSync("ffmpeg", ["-v", "error", "-y", "-i", flac, "-c:a", "libmp3lame", "-q:a", "5", join(dir, `${ours}.mp3`)]);
    (peaks[layer] ??= {})[ours] = peakDb(flac);
  }
  console.log(`encoded ${jobs.length} samples into ${OUT}`);

  writeFileSync(LEVELS, JSON.stringify({
    source: `https://github.com/${REPO}/tree/${COMMIT}`,
    generatedBy: "tools/samples/salamander.ts — do not edit by hand",
    layers: LAYERS,
    peakDb: peaks,
  }, null, 2) + "\n");
  console.log(`wrote ${LEVELS}`);
}

await main();
