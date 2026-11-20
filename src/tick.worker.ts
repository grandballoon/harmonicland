/* ====================================================================
   TICK WORKER — a metronome and nothing else. Posts an empty message every
   N ms after being sent N, and stops when sent 0. It exists because a
   worker's timers keep their rate in a background tab, where the main
   thread's are throttled to once a second or worse: the scheduler's tick
   must keep coming while the music plays behind another tab. The work of
   the tick stays on the main thread (ticker.ts, scheduler.ts).
   ==================================================================== */
let id: ReturnType<typeof setInterval> | undefined;

onmessage = (e: MessageEvent<number>) => {
  clearInterval(id);
  id = e.data > 0 ? setInterval(() => postMessage(0), e.data) : undefined;
};
