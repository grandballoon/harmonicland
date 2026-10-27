/* ====================================================================
   ECHOES — ear training on the live keys. Press a key, and the keys the
   chosen relations of it land on (intervals.ts) sound as well: a major
   third up, a minor sixth down. They are pressed THROUGH LiveKeys like
   any other voice, so they sound on whichever output is active, glow on
   the Tonnetz, and refcount with a finger on the same key — nothing here
   reaches the sound or the views directly. What the keyboards need
   beyond `held` to tell an echo from a press, and to name it, is
   `marks()`: the echoes sounding, each with its label.

   TOGETHER OR AFTER. Together, the echoes sound with the key, as one
   chord: the interval heard harmonically. After, they follow it one at a
   time, lowest first, GAP_MS apart: heard melodically.

   HOW LONG AN ECHO LASTS. As long as the key that raised it is held, and
   never less than HOLD_MS: a quick tap must still be followed by the
   echoes it asked for, or "after" would be silent for anyone who does not
   hold the key down. It follows the VOICE that raised it, not the pitch
   (LiveKeys.onRelease), so a second finger on the same key raises echoes
   of its own and lifting either lifts only its own.

   WHAT RAISES ONE. Audible presses only: a silent voice is an instrument
   heard through the microphone, and echoing it would play the app back
   into the mic that is listening. Never an echo itself — that would be an
   echo of an echo, without end. And only while `accept` says so: main.ts
   turns echoes off in practice mode, which grades every press it hears
   and would mark each echo a wrong note.
   ==================================================================== */
import { relativesOf, type Relation, type Relative } from "./intervals";
import type { LiveKeys, Voice } from "./live-keys";
import type { Pitch } from "./types";

export type Timing = "together" | "after";

export interface EchoSettings {
  relations: readonly Relation[];
  timing: Timing;
}

/** Between one echo and the next, played "after". */
export const GAP_MS = 450;
/** The least an echo sounds, however briefly its key was pressed. */
export const HOLD_MS = 450;

/** The timer pair echoes are scheduled with — the window's, or a test's. */
export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface EchoDeps {
  keys: Pick<typeof LiveKeys, "press" | "release" | "isLive" | "isSilent" | "onPress" | "onRelease">;
  /** May this press raise echoes now? Asked once per press. */
  accept(v: Voice): boolean;
  timers?: Timers;
}

export interface Echoes {
  set(s: EchoSettings): void;
  settings(): EchoSettings;
  /** The echoes sounding now: which keys, and what to call each. */
  marks(): Relative[];
  /** Lift every echo at once and forget the ones still to come. */
  clear(): void;
  /** Stop listening to the keys. */
  detach(): void;
}

/** One echo of a press: where it lands, and how far along it is. */
interface Echo {
  readonly rel: Relative;
  voice: Voice | null; // ours in LiveKeys while it sounds
  timer: unknown; // its start, while pending; its HOLD_MS, while sounding
  ripe: boolean; // has it sounded HOLD_MS?
  done: boolean;
}

/** The echoes one press raised, and whether its key is still down. */
interface Group {
  readonly echoes: Echo[];
  down: boolean;
}

const windowTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export function makeEchoes({ keys, accept, timers = windowTimers }: EchoDeps): Echoes {
  let settings: EchoSettings = { relations: [], timing: "together" };
  const groups = new Map<Voice, Group>(); // the press -> its echoes
  // LiveKeys reports our own press to us before handing us its Voice, so
  // our presses are told apart by WHEN they happen, not by identity
  let pressing = false;

  const pressOwn = (p: Pitch): Voice => {
    pressing = true;
    try {
      return keys.press(p);
    } finally {
      pressing = false;
    }
  };

  function lift(e: Echo): void {
    if (e.timer !== null) timers.clear(e.timer);
    e.timer = null;
    if (e.voice) keys.release(e.voice);
    e.voice = null;
    e.done = true;
  }

  // lift what may be lifted, and drop the group once every echo is done
  function settle(source: Voice, g: Group): void {
    if (!g.down) for (const e of g.echoes) if (e.ripe && !e.done) lift(e);
    if (g.echoes.every((e) => e.done)) groups.delete(source);
  }

  function start(source: Voice, g: Group, e: Echo): void {
    e.voice = pressOwn(e.rel.pitch);
    e.timer = timers.set(() => {
      e.timer = null;
      e.ripe = true;
      settle(source, g);
    }, HOLD_MS);
  }

  function raise(v: Voice): void {
    const rels = relativesOf(v.pitch, settings.relations);
    if (rels.length === 0) return;
    const g: Group = { echoes: [], down: true };
    groups.set(v, g);
    rels.forEach((rel, i) => {
      const e: Echo = { rel, voice: null, timer: null, ripe: false, done: false };
      g.echoes.push(e);
      if (settings.timing === "together") start(v, g, e);
      else e.timer = timers.set(() => start(v, g, e), (i + 1) * GAP_MS);
    });
  }

  const offPress = keys.onPress((v) => {
    if (pressing || keys.isSilent(v) || !accept(v)) return;
    raise(v);
  });
  const offRelease = keys.onRelease((v) => {
    const g = groups.get(v);
    if (!g) return;
    g.down = false;
    settle(v, g);
  });

  function clear(): void {
    for (const g of groups.values()) for (const e of g.echoes) lift(e);
    groups.clear();
  }

  return {
    set(s) {
      settings = { relations: [...s.relations], timing: s.timing };
    },
    settings: () => settings,
    marks() {
      const out: Relative[] = [];
      for (const g of groups.values())
        for (const e of g.echoes) if (e.voice && keys.isLive(e.voice)) out.push(e.rel);
      return out;
    },
    clear,
    detach() {
      clear();
      offPress();
      offRelease();
    },
  };
}
