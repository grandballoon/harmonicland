/* ====================================================================
   SCHEDULER — performance x clock -> strikes, ahead of time. The one place
   that knows sound is scheduled early: every TICK_MS it asks the clock what
   the next LOOKAHEAD_MS of wall time will play (clock.ahead) and hands the
   Output every note that starts in it, stamped with the exact wall time it
   should sound and the wall time it should stop. The Output never guesses
   when; this module never knows how. See SPEC_playback.md.

   Why ahead of time, not per frame: a note started from a frame callback
   sounds whenever the frame happens to land (0–16ms late, differently for
   every note of a chord) and not at all in a background tab. Stamped
   strikes sound on the audio device's own clock, to the sample.

   Why only 100ms ahead: what has been sent to a MIDI port cannot be taken
   back, so a pause or a seek can at worst leave a tenth of a second of
   notes already on their way.

   THE WINDOWS are contiguous and half-open in wall time, so every note is
   struck exactly once per pass without any bookkeeping of which were.
   Anything that breaks that continuity — play, pause, seek, a new loop —
   arrives through clock.onChange as reset(): flush, and start afresh from
   the present, DROPPING INTO notes already sounding there (a strike with
   an offset) rather than re-striking them or leaving them out. A loop wrap
   is the same drop, flagged by the clock on the stretch (Stretch.jump).

   THE PEDAL. Each note carries its damper time (perform.ts), so the
   piano needs nothing more; a MIDI synth is handed the pedal itself, as
   down/up changes inside each window. Where time jumps, the pedal is
   lifted and then set as it stands at the new place — what sustained
   before the jump does not ring on into music it was never part of.

   Late ticks: a strike stamped a little in the past is still struck (the
   Output clamps it to now), because a late attack is better than a
   clipped one; one stamped more than LATE_MS in the past is dropped into,
   at its offset, like a seek — or skipped if it is nearly over.
   ==================================================================== */
import { firstAtOrAfter, type PerfNote, type Performance } from "./perform";
import type { Clock, Output, Stretch } from "./types";

export const TICK_MS = 25;
export const LOOKAHEAD_MS = 100;
/** Past due by more than this, a note is dropped into instead of struck late. */
const LATE_MS = 50;
/** A note dropped into with less than this left would only click. */
const MIN_REMAINING_MS = 60;

/** What drives tick(): a worker's timer in the app, a hand in tests. */
export interface Ticker {
  start(fn: () => void): void;
  stop(): void;
}

export interface Scheduler {
  /** A new score to play. Resets. */
  setPerformance(p: Performance): void;
  /** Drop what was scheduled and start afresh from the clock's present.
   *  Called by every clock change; call it too when the Output changes. */
  reset(): void;
  /** Sound the notes under a parked playhead, held until the next reset:
   *  a step walked to with the arrow keys is heard, though time stands still. */
  audition(t: number): void;
  dispose(): void;
}

export function makeScheduler(
  clock: Clock,
  output: Output,
  ticker: Ticker,
  wallNow: () => number = () => performance.now(),
): Scheduler {
  let perf: Performance = { notes: [], pedal: [] };
  /** Wall ms up to which strikes have been handed out. */
  let scheduledTo = 0;
  /** The next window opens on a reset, and drops into what is sounding. */
  let fresh = false;

  /** Hand one note over: key down at `at`, up at `off`, dampers at `damp`. */
  function strike(n: PerfNote, at: number, off: number, damp: number, offset: number, wall: number): void {
    if (damp - at <= 0) return;
    const late = wall - at;
    if (late > LATE_MS) {
      if (damp - wall < MIN_REMAINING_MS) return;
      at = wall;
      offset += late / 1000;
      off = Math.max(off, wall);
    }
    output.strike({
      pitch: n.pitch, velocity: n.velocity, at, off,
      ...(damp > off && { damp }),
      ...(offset > 0 && { offset }),
    });
  }

  /** Strike everything a stretch holds — and, when time jumped to its
   *  start, everything already sounding there. */
  function play(s: Stretch, jump: boolean, wall: number): void {
    const wallOf = (t: number): number => s.at + (t - s.start) * 1000;
    // a note stops where it does, or where this pass does (the loop wraps)
    const upTo = (t: number): number => wallOf(Math.min(t, s.until));
    if (jump) {
      pedalAt(s);
      // everything still sounding here — held down, or held by the pedal
      for (const n of perf.notes) {
        if (n.onset >= s.start) break;
        if (Math.min(n.damp, s.until) <= s.start) continue;
        if (upTo(n.damp) - s.at < MIN_REMAINING_MS) continue;
        strike(n, s.at, Math.max(s.at, upTo(n.end)), upTo(n.damp), s.start - n.onset, wall);
      }
    }
    for (let i = firstAtOrAfter(perf, s.start); i < perf.notes.length && perf.notes[i].onset < s.end; i++) {
      const n = perf.notes[i];
      strike(n, wallOf(n.onset), upTo(n.end), upTo(n.damp), 0, wall);
    }
    pedalWithin(s);
  }

  /** Where time jumps: lift the pedal, then set it as it stands here. */
  function pedalAt(s: Stretch): void {
    output.pedal(false, s.at);
    if (perf.pedal.some((r) => r.start <= s.start && s.start < r.end)) output.pedal(true, s.at);
  }

  /** The pedal's changes inside a stretch, in time order — a change's up
   *  before its down. Not a lift at the pass's own end: a wrap sets the
   *  pedal afresh, and the end of the piece pauses, which flushes. */
  function pedalWithin(s: Stretch): void {
    const changes: { t: number; down: boolean }[] = [];
    for (const r of perf.pedal) {
      if (r.start >= s.end) break;
      if (r.start >= s.start) changes.push({ t: r.start, down: true });
      if (r.end >= s.start && r.end < s.end && r.end < s.until) changes.push({ t: r.end, down: false });
    }
    changes.sort((a, b) => a.t - b.t || Number(a.down) - Number(b.down));
    for (const c of changes) output.pedal(c.down, s.at + (c.t - s.start) * 1000);
  }

  function tick(): void {
    const wall = wallNow();
    const until = wall + LOOKAHEAD_MS;
    const stretches = clock.ahead(scheduledTo, until);
    stretches.forEach((s, i) => play(s, s.jump || (i === 0 && fresh), wall));
    if (stretches.length > 0) fresh = false;
    scheduledTo = until;
    output.advance(until);
  }

  function reset(): void {
    output.flush();
    scheduledTo = wallNow();
    fresh = true;
    if (clock.isPlaying()) {
      ticker.start(tick);
      tick(); // now, not a tick from now: the first notes are due at once
    } else ticker.stop();
  }

  function audition(t: number): void {
    reset();
    const wall = wallNow();
    for (const n of perf.notes) {
      if (n.onset > t) break;
      if (n.end > t) output.strike({ pitch: n.pitch, velocity: n.velocity, at: wall });
    }
  }

  const unsubscribe = clock.onChange(reset);

  return {
    setPerformance(p) {
      perf = p;
      reset();
    },
    reset,
    audition,
    dispose() {
      unsubscribe();
      ticker.stop();
      output.flush();
    },
  };
}
