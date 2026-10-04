/* ====================================================================
   SOUND_ROW — the tray's sound row: where the music sounds, how late it
   is heard there, and whether plain scores are shaped. One <select> lists the built-in piano and every
   MIDI output port, so choosing one is choosing it INSTEAD of the rest
   (outputs/sound.ts keeps exactly one active). Beside it, a delay slider
   for the output chosen, remembered per output: the browser can measure
   its own audio latency but never an external synth's, and the views and
   the heard time need both. Last, a switch for shaping scores that carry
   no dynamics of their own (perform.ts), on unless turned off.

   REMEMBERED BY NAME. A port's id can change between visits and devices;
   its name is what the user recognises and what comes back when it is
   plugged in again. The choice is kept even while its port is missing —
   the piano stands in, and the port is taken back when it reappears.

   MIDI permission is asked for only when the user picks "MIDI device…".
   On a later visit, if the browser already holds the grant, the ports are
   opened at once so a remembered synth is back without a click.

   Storage can be missing or forbidden, so every access is guarded: a load
   that fails is the defaults, a save that fails forgets on reload.
   ==================================================================== */
import type { Output } from "./types";

/** The MIDI side, as outputs/midi-out.ts provides it. */
export interface MidiPorts {
  open(): Promise<void>;
  permitted(): Promise<boolean>;
  ports(): readonly MIDIOutput[];
  onPorts(fn: () => void): () => void;
  output(port: MIDIOutput): Output;
}

export interface SoundRowDeps {
  piano: Output;
  midi: MidiPorts;
  /** Make this the output — the caller switches Sound and resets the scheduler. */
  use(o: Output): void;
  /** The user's delay for the output in use, in seconds. */
  setOffset(seconds: number): void;
  /** Shape plain scores, or not. Called once at mount with the remembered choice. */
  setShape(on: boolean): void;
  status(text: string): void;
  storage?: () => Storage | null;
}

/** The row's controls, as index.html lays them out. */
export interface SoundRowElements {
  select: HTMLSelectElement;
  slider: HTMLInputElement;
  readout: HTMLElement;
  hint: HTMLElement;
  shape: HTMLInputElement;
}

interface Prefs {
  /** The chosen port's name; null is the built-in piano. */
  output: string | null;
  /** Delay in ms, by output key ("piano", or "midi:" + port name). */
  delays: Record<string, number>;
  /** Shape plain scores. */
  shape: boolean;
}

/** Versioned, so a future change of shape can read the old one. */
const KEY = "harmonicland.output.v1";
const PIANO = "piano";
const CONNECT = "connect";
const PORT = "port:";

const keyOf = (name: string | null): string => (name === null ? PIANO : `midi:${name}`);
const portName = (p: MIDIOutput): string => p.name || "MIDI device";

function load(storage: () => Storage | null): Prefs {
  try {
    const raw = storage()?.getItem(KEY);
    const v = raw ? (JSON.parse(raw) as Partial<Prefs>) : {};
    const delays: Record<string, number> = {};
    for (const [k, ms] of Object.entries(v.delays ?? {})) if (Number.isFinite(ms)) delays[k] = ms;
    return { output: typeof v.output === "string" ? v.output : null, delays, shape: v.shape !== false };
  } catch {
    return { output: null, delays: {}, shape: true };
  }
}

function save(storage: () => Storage | null, prefs: Prefs): void {
  try {
    storage()?.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // quota or permissions: this visit keeps working, the next forgets
  }
}

export function mountSoundRow(
  { select, slider, readout, hint, shape }: SoundRowElements,
  deps: SoundRowDeps,
): void {
  const storage = deps.storage ?? (() => globalThis.localStorage ?? null);
  const prefs = load(storage);
  let opened = false;
  /** The port sounding now, or null for the piano. Differs from
   *  prefs.output only while the chosen port is missing. */
  let current: MIDIOutput | null = null;

  /** The ports on offer: none until the user has let MIDI in. */
  const ports = (): readonly MIDIOutput[] => (opened ? deps.midi.ports() : []);
  const chosenPort = (): MIDIOutput | null =>
    prefs.output === null ? null : ports().find((p) => portName(p) === prefs.output) ?? null;

  function render(): void {
    const opts: [string, string][] = [[PIANO, "Built-in piano"]];
    for (const p of ports()) opts.push([PORT + p.id, portName(p)]);
    if (!opened) opts.push([CONNECT, "MIDI device…"]);
    select.replaceChildren(...opts.map(([value, text]) => new Option(text, value)));
    select.value = current ? PORT + current.id : PIANO;
  }

  function showDelay(): void {
    const ms = prefs.delays[keyOf(current && portName(current))] ?? 0;
    slider.value = String(ms);
    readout.textContent = `${ms} ms`;
    deps.setOffset(ms / 1000);
  }

  /** Sound through the chosen output, or the piano while it is missing. */
  function apply(): void {
    const next = chosenPort();
    if (next !== current) {
      current = next;
      deps.use(next ? deps.midi.output(next) : deps.piano);
    }
    render();
    showDelay();
    hint.hidden = !(current || (opened && ports().length === 0));
  }

  async function connect(): Promise<boolean> {
    try {
      await deps.midi.open();
    } catch (err) {
      deps.status("MIDI out unavailable: " + (err as Error).message);
      return false;
    }
    if (!opened) {
      opened = true;
      deps.midi.onPorts(() => {
        const was = current;
        apply();
        if (was && !current) deps.status(`${portName(was)} disconnected · playing through the built-in piano`);
        else if (!was && current) deps.status(`Sound · ${portName(current)}`);
      });
    }
    return true;
  }

  select.addEventListener("change", async () => {
    const v = select.value;
    if (v === CONNECT) {
      if (await connect()) {
        const first = ports()[0];
        if (first) prefs.output = portName(first);
        else deps.status("No MIDI outputs found · see the note below for GarageBand");
      }
    } else if (v.startsWith(PORT)) {
      const p = ports().find((q) => PORT + q.id === v);
      if (p) prefs.output = portName(p);
    } else prefs.output = null;
    save(storage, prefs);
    apply();
    if (v !== CONNECT || current) deps.status(`Sound · ${current ? portName(current) : "built-in piano"}`);
    // a closed <select> keeps focus and would swallow the arrow keys
    select.blur();
  });

  slider.addEventListener("input", () => {
    prefs.delays[keyOf(current && portName(current))] = Number(slider.value);
    save(storage, prefs);
    showDelay();
  });

  shape.checked = prefs.shape;
  deps.setShape(prefs.shape);
  shape.addEventListener("change", () => {
    prefs.shape = shape.checked;
    save(storage, prefs);
    deps.setShape(prefs.shape);
  });

  apply();
  // a synth chosen on an earlier visit comes back without a click, when
  // the browser already holds the grant (open() would not prompt)
  if (prefs.output !== null)
    void deps.midi.permitted().then(async (ok) => {
      if (ok && (await connect())) apply();
    });
}
