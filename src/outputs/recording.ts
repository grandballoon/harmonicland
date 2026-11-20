/* ====================================================================
   RECORDING — an Output that sounds a recording of the piece instead of
   striking its notes. The third thing the sound row can choose, beside the
   built-in piano and a MIDI port, and exclusive with them the same way
   (sound.ts). The score it plays against has already been put to the
   recording's timing (alignment.ts), so score time and recording time
   differ only by `lead`, where in the recording the score begins.

   DRIVEN THROUGH THE OUTPUT INTERFACE, with no subscription of its own.
   The scheduler already tells an Output everything this one needs:
   flush() on every break in time (play, pause, seek, a new loop) and
   advance() every tick while playing, from a worker, so it goes on in a
   background tab. Each time, the recording is asked where it is and the
   clock where it should be. Strikes are ignored: the notes are in the
   recording.

   THE EYE FOLLOWS THE EAR. A media element starts when it starts — tens
   of milliseconds after it is told to, differently each time — and cannot
   be scheduled to the sample as a strike can. So rather than chase the
   clock, the recording is left to run and its distance behind the clock is
   REPORTED as this Output's latency(), which is what every view already
   subtracts to draw what is heard. It is put back only when time jumps
   under it (a loop wrap, which no flush announces) or it has drifted
   further than a view should have to follow.

   A wrap is a seek, and a seek is audible: a loop of a few notes, which
   the piano goes round seamlessly, stutters here. That is the medium.

   LIVE KEYS still sound, on the piano handed in: playing along with a
   recording is half the point of having one.

   `Recording` is the seam for other sources. A file is the one there is
   (fileRecording); an embedded player — YouTube, Spotify — is the same
   five members over someone else's transport.
   ==================================================================== */
import type { Clock, Output } from "../types";

/** One recording of a piece, playable from any point. Seconds throughout. */
export interface Recording {
  /** What recording this is, the same on every visit: what its barlines
   *  are remembered under. */
  readonly key: string;
  readonly duration: number;
  /** How far in it is now — moving while it plays, still while it does not. */
  position(): number;
  /** Sound from `from` onward. */
  play(from: number): void;
  pause(): void;
  /** Done with: let go of the file, the element, the player. */
  close(): void;
}

/** Further adrift than this, the recording is put back where the clock is. */
const DRIFT_LIMIT = 0.5;
/** After being told to play, a recording is given this long to get going
 *  before its drift is held against it. */
const SETTLE_MS = 1000;
/** How fast the reported lag follows the measured one, per tick: position
 *  is read in steps on some browsers, and a view must not step with it. */
const SMOOTHING = 0.1;

export interface RecordingOutputDeps {
  clock: Pick<Clock, "now" | "isPlaying">;
  /** Where in the recording score time 0 falls, in seconds. Asked every
   *  time, because retiming the score moves it. */
  lead(): number;
  /** What sounds the user's own keys. */
  live: Output;
  wallNow?: () => number;
}

export type RecordingOutput = Output & {
  /** Hand the recording to someone else to play (the tapping of barlines),
   *  or take it back. While lent, the clock moves nothing. */
  lend(on: boolean): void;
};

export function recordingOutput(rec: Recording, deps: RecordingOutputDeps): RecordingOutput {
  const { clock, live } = deps;
  const wallNow = deps.wallNow ?? (() => performance.now());
  let lent = false;
  let sounding = false;
  /** Where the recording was wanted at the last look. */
  let wanted = 0;
  /** Seconds the recording runs behind the clock, smoothed. */
  let lag = 0;
  let settledAt = 0;

  function start(at: number): void {
    rec.play(at);
    sounding = true;
    lag = 0;
    settledAt = wallNow() + SETTLE_MS;
  }
  function stop(): void {
    if (sounding) rec.pause();
    sounding = false;
    lag = 0;
  }

  /** Bring the recording into line with the clock: silent while it is
   *  paused or outside the recording, sounding where it says otherwise. */
  function follow(): void {
    if (lent) return;
    const want = clock.now() + deps.lead();
    if (!clock.isPlaying() || want < 0 || want >= rec.duration) return stop();
    const behind = want - rec.position();
    const adrift = wallNow() >= settledAt && Math.abs(behind) > DRIFT_LIMIT;
    // time that ran backwards with no flush is a loop wrap
    if (!sounding || want < wanted || adrift) start(want);
    else lag += (Math.max(0, Math.min(behind, DRIFT_LIMIT)) - lag) * SMOOTHING;
    wanted = want;
  }

  return {
    strike() {},
    pedal() {},
    advance: follow,
    flush() {
      if (lent) return;
      stop();
      follow();
    },
    latency: () => lag,
    liveOn: (pitch, velocity) => live.liveOn(pitch, velocity),
    liveOff: (pitch) => live.liveOff(pitch),
    detach() {
      if (!lent) stop();
      live.detach();
    },
    lend(on) {
      lent = on;
      sounding = false;
      lag = 0;
    },
  };
}

/** Bytes of a file's head that name it. Enough to tell any two recordings
 *  apart, and read at once however long the recording is. */
const KEY_BYTES = 1 << 20;

/** A file's identity by content, so that renaming it or downloading it
 *  again keeps its barlines: a digest of its head, and its length. */
async function fileKey(file: Blob): Promise<string> {
  const head = await file.slice(0, KEY_BYTES).arrayBuffer();
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", head));
  const hex = [...digest.slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `file:${hex}-${file.size.toString(36)}`;
}

/** A sound file the browser can play, as a Recording. Played by a media
 *  element, which streams: an hour of music costs no more memory than a
 *  minute. Rejects when the browser cannot read it. */
export async function fileRecording(file: Blob): Promise<Recording> {
  const key = await fileKey(file);
  const url = URL.createObjectURL(file);
  const audio = new Audio();
  audio.preload = "auto";
  const close = (): void => {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    URL.revokeObjectURL(url);
  };
  await new Promise<void>((resolve, reject) => {
    audio.addEventListener("loadedmetadata", () => resolve(), { once: true });
    audio.addEventListener("error", () => reject(new Error("this browser can't play it")), { once: true });
    audio.src = url;
  }).catch((err: unknown) => {
    close();
    throw err;
  });
  if (!Number.isFinite(audio.duration)) {
    close();
    throw new Error("it doesn't say how long it is");
  }
  return {
    key,
    duration: audio.duration,
    position: () => audio.currentTime,
    play(from) {
      audio.currentTime = from;
      // refused only when a pause overtakes it, which is then what was wanted
      audio.play().catch(() => {});
    },
    pause: () => audio.pause(),
    close,
  };
}
