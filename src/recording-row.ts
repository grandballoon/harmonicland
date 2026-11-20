/* ====================================================================
   RECORDING_ROW — the tray's recording row: which recording goes with
   the loaded score, and where in it the barlines fall. It owns the
   recording from the moment its file is chosen to the moment the score
   changes or it is removed, the anchors that put the score to its timing
   (alignment.ts), and the tapping that makes them.

   A RECORDING IS OF ONE SCORE. Loading another score lets go of it, and
   its barlines are remembered under both (alignment-store.ts), so opening
   the same file over the same score again finds them placed.

   What it hands out, and to whom: the recording as something to sound
   (`offer`, for the sound row's picker) and the score at the recording's
   timing (`show`, for everything that draws or plays it). It knows of
   neither beyond that.

   TAPPING. The recording plays by itself, from a little before the bar
   under the playhead, and each tap says "this barline, now". The first
   tap is the barline that bar opens with, the next the one after, and so
   on to the last barline of the piece or until told to stop. The clock is
   parked on each bar as it is tapped in, so every view shows which bar
   the taps have reached. Nothing is retimed until the tapping ends: a
   score that moved under the hand placing it could not be placed.

   A tap is read as where the recording IS, which runs ahead of what is
   heard by the device's latency — and that is the right number to keep.
   Playback draws from the same reading, so a barline tapped as it was
   heard is drawn as it is heard, whatever the device.

   Tapping again from any bar replaces what it passes and keeps the rest
   (Alignment.set), so one rushed passage is fixed without redoing a piece.
   ==================================================================== */
import { Alignment, type Anchor } from "./alignment";
import type { AlignmentStore } from "./alignment-store";
import { Core } from "./core";
import { recordingOutput, type Recording, type RecordingOutput } from "./outputs/recording";
import type { Clock, Output, Score } from "./types";

/** Seconds of recording played before the first barline to be tapped:
 *  time to find the pulse. */
const RUN_IN = 3;
/** Taps closer together than this are one tap, bounced. */
const MIN_GAP = 0.15;

export interface RecordingRowDeps {
  store: AlignmentStore;
  /** A chosen file as a Recording; rejects when it cannot be played. */
  open(file: File): Promise<Recording>;
  clock: Pick<Clock, "now" | "isPlaying">;
  /** What sounds the user's own keys while the recording plays. */
  live: Output;
  /** Offer the recording to be sounded, or with null withdraw it. */
  offer(choice: { name: string; output: Output } | null): void;
  /** The score as it is now to be shown and played: at the recording's
   *  timing, or as written. Never called for a score just loaded, which
   *  its loader is already showing. */
  show(score: Score): void;
  /** Stop the clock and put the playhead at score time `t`. */
  park(t: number): void;
  status(text: string): void;
}

/** The row's controls, as index.html lays them out. */
export interface RecordingRowElements {
  file: HTMLInputElement;
  name: HTMLElement;
  tap: HTMLButtonElement;
  clear: HTMLButtonElement;
  remove: HTMLButtonElement;
  readout: HTMLElement;
}

export interface RecordingRow {
  /** A new score. Whatever recording was attached was of the last one. */
  setScore(key: string, score: Score): void;
  /** Are barlines being tapped? While they are, the keyboard is the row's. */
  tapping(): boolean;
  /** The next barline is now. */
  tap(): void;
  /** Stop tapping and keep what was placed. */
  finish(): void;
}

export function mountRecordingRow(el: RecordingRowElements, deps: RecordingRowDeps): RecordingRow {
  let scoreKey = "";
  /** The score as its source wrote it, and as it is shown. */
  let written: Score | null = null;
  let shown: Score | null = null;
  let attached: { rec: Recording; name: string; output: RecordingOutput } | null = null;
  let anchors: readonly Anchor[] = [];
  /** Where in the recording the shown score begins. */
  let lead = 0;
  /** A run of taps: the barline the next one places, and those placed. */
  let session: { first: number; next: number; placed: readonly Anchor[]; lastAt: number } | null = null;

  function render(): void {
    el.name.textContent = attached?.name ?? "";
    el.tap.disabled = !attached;
    el.tap.textContent = session ? "Done" : "Tap bars";
    el.tap.setAttribute("aria-pressed", String(session !== null));
    el.clear.disabled = !attached || session !== null || anchors.length === 0;
    el.remove.hidden = !attached;
    el.remove.disabled = session !== null;
    const posts = written ? written.bars.length + 1 : 0;
    el.readout.textContent = !attached ? ""
      : session ? `tap as bar ${session.next + 1} begins`
      : anchors.length === 0 ? "no barlines placed · it plays at the score's own tempo"
      : `${anchors.length} of ${posts} barlines placed`;
  }

  /** Put the score to these anchors, and say so to whoever shows it. */
  function align(next: readonly Anchor[]): void {
    if (!written) return;
    anchors = Alignment.clean(next, written.bars.length);
    const r = Alignment.retime(written, anchors);
    lead = r.lead;
    if (r.score === shown) return;
    shown = r.score;
    deps.show(shown);
  }

  /** Let go of the recording. The score is left as it stands: the caller
   *  decides whether it goes back to how it was written. */
  function detach(): void {
    if (!attached) return;
    if (session) attached.output.lend(false);
    session = null;
    deps.offer(null);
    attached.rec.close();
    attached = null;
    anchors = [];
    lead = 0;
  }

  async function attach(file: File): Promise<void> {
    const forScore = scoreKey;
    let rec: Recording;
    try {
      rec = await deps.open(file);
    } catch (err) {
      deps.status(`Couldn't open ${file.name}: ${(err as Error).message}`);
      return;
    }
    // the score changed while the file was being read: it is not of this one
    if (forScore !== scoreKey || !written) return rec.close();
    detach();
    const output = recordingOutput(rec, { clock: deps.clock, lead: () => lead, live: deps.live });
    attached = { rec, name: file.name, output };
    align(deps.store.load(scoreKey, rec.key));
    deps.offer({ name: file.name, output });
    render();
    deps.status(anchors.length > 0
      ? `Recording · ${file.name} · ${anchors.length} barlines placed`
      : `Recording · ${file.name} · Tap bars to place its barlines`);
  }

  function begin(): void {
    if (!attached || !written || !shown) return;
    const bar = Core.barAt(shown, deps.clock.now()).index;
    deps.park(shown.bars[bar].start);
    attached.output.lend(true);
    attached.rec.play(Math.max(0, Alignment.barlines(written, anchors)[bar] - RUN_IN));
    session = { first: bar, next: bar, placed: anchors, lastAt: -Infinity };
    render();
    deps.status(`Tapping · press T or Space as bar ${bar + 1} begins, and at every barline after · Esc when done`);
  }

  function tap(): void {
    if (!session || !attached || !shown) return;
    const at = attached.rec.position();
    if (at - session.lastAt < MIN_GAP) return;
    const bar = session.next;
    session = { ...session, next: bar + 1, placed: Alignment.set(session.placed, { bar, at }), lastAt: at };
    // the barline that closes the piece is the last there is to tap
    if (bar === shown.bars.length) return finish();
    deps.park(shown.bars[bar].start);
    render();
    deps.status(`Tapping · bar ${bar + 1} of ${shown.bars.length} · Esc when done`);
  }

  function finish(): void {
    if (!session || !attached) return;
    const { first, next, placed } = session;
    session = null;
    attached.rec.pause();
    attached.output.lend(false);
    if (next > first) {
      deps.store.save(scoreKey, attached.rec.key, placed);
      align(placed);
      // back to where the tapping began, to hear what it made
      if (shown) deps.park(shown.bars[first].start);
      deps.status(`Placed ${next - first} barline${next - first > 1 ? "s" : ""} from bar ${first + 1} · Play to check them`);
    } else deps.status("No barlines tapped");
    render();
  }

  el.file.addEventListener("change", () => {
    const f = el.file.files?.[0];
    el.file.value = ""; // so choosing the same file again is still a change
    if (f) void attach(f);
  });
  el.tap.addEventListener("click", () => {
    if (session) finish();
    else begin();
    // a focused button would take Space for itself, and Space is a tap
    el.tap.blur();
  });
  el.clear.addEventListener("click", () => {
    if (!attached || session) return;
    deps.store.save(scoreKey, attached.rec.key, []);
    align([]);
    render();
    deps.status("Barlines cleared · the recording plays at the score's own tempo");
  });
  el.remove.addEventListener("click", () => {
    if (!attached || session) return;
    const { name } = attached;
    detach();
    if (written && shown !== written) {
      shown = written;
      deps.show(written);
    }
    render();
    deps.status(`Removed ${name}`);
  });

  render();
  return {
    setScore(key, score) {
      detach();
      scoreKey = key;
      written = shown = score;
      render();
    },
    tapping: () => session !== null,
    tap,
    finish,
  };
}
