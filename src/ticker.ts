/* ====================================================================
   TICKER — the scheduler's Ticker, driven by tick.worker.ts so it keeps
   time in a background tab. Falls back to the main thread's setInterval
   where workers are unavailable: still correct, only throttled when hidden.
   ==================================================================== */
import type { Ticker } from "./scheduler";

export function workerTicker(ms: number): Ticker {
  let fn: (() => void) | null = null;
  let worker: Worker | null = null;
  let interval: ReturnType<typeof setInterval> | undefined;
  const run = (): void => fn?.();

  return {
    start(f) {
      fn = f;
      if (typeof Worker === "undefined") {
        clearInterval(interval);
        interval = setInterval(run, ms);
        return;
      }
      if (!worker) {
        worker = new Worker(new URL("./tick.worker.ts", import.meta.url), { type: "module" });
        worker.onmessage = run;
      }
      worker.postMessage(ms);
    },
    stop() {
      fn = null;
      clearInterval(interval);
      worker?.postMessage(0);
    },
  };
}
