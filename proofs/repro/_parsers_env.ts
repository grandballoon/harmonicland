/* Shared by the parser repros (MidiParse_*, XmlLily_*).

   - `dom()` gives MusicxmlIn the DOMParser it needs, from jsdom (the same DOM the test
     runner uses, vite.config.ts `environment: "jsdom"`).
   - `smf(division, track)` wraps track bytes in a one-track Standard MIDI File.
   - `guarded(script, label, run)` runs `run` in a child process and kills it after `ms`
     milliseconds (SIGKILL: a busy loop never runs a SIGTERM handler), so a parse that
     never returns is REPORTED instead of hanging the repro. */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

export const dom = (): void => {
  (globalThis as unknown as { DOMParser: unknown }).DOMParser = new JSDOM().window.DOMParser;
};

export const smf = (division: number, track: number[]): ArrayBuffer => {
  const n = track.length;
  return new Uint8Array([
    0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, (division >> 8) & 255, division & 255,
    0x4d, 0x54, 0x72, 0x6b, (n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255,
    ...track,
  ]).buffer;
};

export const hex = (buf: ArrayBuffer): string =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join(" ");

/** Is this the child process `guarded` started? */
export const isChild = (): boolean => process.env.REPRO_CHILD === "1";

/** Run `run` in a child process; report what it printed, or that it had to be killed.
 *  `script` is the calling script's `import.meta.url`. */
export function guarded(script: string, label: string, run: () => unknown, ms = 10000): void {
  if (isChild()) {
    try {
      console.log("returned:", JSON.stringify(run()));
    } catch (e) {
      console.log("threw:", String(e));
    }
    return;
  }
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [process.argv[1], fileURLToPath(script)], {
    timeout: ms, killSignal: "SIGKILL", encoding: "utf8", maxBuffer: 1 << 26, env: { ...process.env, REPRO_CHILD: "1" },
  });
  const out = (r.stdout ?? "").split("\n").filter((l) => /^(returned|threw):/.test(l)).join("\n");
  if (out) console.log(`actual: ${out}  (after ${Date.now() - t0} ms)`);
  else if (r.error && /ETIMEDOUT/.test(String(r.error)))
    console.log(`actual: ${label} did not return or throw within ${ms} ms; the child process was killed (${r.signal})`);
  else {
    const err = (r.stderr ?? "").split("\n").filter((l) => /heap|memory|FATAL|Error/i.test(l)).slice(0, 3).join(" | ");
    console.log(`actual: ${label} neither returned nor threw; the child process died after ${Date.now() - t0} ms (status ${r.status}, signal ${r.signal}) ${err}`);
  }
}
