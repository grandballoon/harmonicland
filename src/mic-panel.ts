/* ====================================================================
   MIC_PANEL — the tray's microphone row: the on/off button, a one-line
   readout, and the settings dropdown (index.html's #mic-settings). It
   owns that DOM, the saved MicSettings, and the session's lifecycle, and
   talks to LiveMic alone; it knows nothing of views, the clock, or
   practice mode — mic voices reach those through LiveKeys like any other.

   What changes need a restart and what does not follows the pipeline:
   the device is the stream itself, so a new one restarts the session;
   the channel is the worklet's choice and the response and sensitivity
   are the transcriber's, so those retune the running session in place.
   ==================================================================== */
import { LiveMic, type MicInput, type MicSession } from "./live-mic";
import {
  LOOKAHEAD, channelOf, loadSettings, saveSettings, trackerOptions, withChannel,
  type Channel, type MicSettings, type Response,
} from "./mic/settings";
import type { Stats } from "./mic/transcriber";
import type { Tuning } from "./mic/transcriber.worker";

export interface MicPanelHost {
  /** One line for the app's status bar. */
  status(text: string): void;
}

// the meter's scale, in dBFS
const METER_FLOOR_DB = -80;
const pct = (db: number) => `${Math.min(100, Math.max(0, (1 - db / METER_FLOOR_DB) * 100))}%`;

const tuningOf = (s: MicSettings): Tuning =>
  ({ lookahead: LOOKAHEAD[s.response], tracker: trackerOptions(s.sensitivity) });

// why getUserMedia refused, in the listener's terms
function explain(err: unknown): string {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError") return "microphone access is blocked — allow it for this page and try again.";
  if (name === "NotFoundError") return "no microphone found — plug one in.";
  if (name === "NotReadableError") return "the microphone is busy in another app.";
  return (err as Error).message;
}

export function mountMicPanel(
  button: HTMLButtonElement, readout: HTMLElement, root: HTMLDetailsElement, host: MicPanelHost,
): void {
  const q = <T extends HTMLElement>(sel: string): T => root.querySelector(sel) as T;
  const deviceSel = q<HTMLSelectElement>(".mic-device");
  const channelSel = q<HTMLSelectElement>(".mic-channel");
  const responseSel = q<HTMLSelectElement>(".mic-response");
  const sensitivity = q<HTMLInputElement>(".mic-sensitivity");
  const meter = q<HTMLDivElement>(".mic-meter");
  const level = q<HTMLDivElement>(".mic-level");
  const floor = q<HTMLDivElement>(".mic-floor");

  let settings = loadSettings();
  let state: "off" | "starting" | "on" = "off";
  let session: MicSession | null = null;
  let lagMs = 0; // smoothed, for the readout
  let lastReadout = 0;

  const update = (next: MicSettings) => {
    settings = next;
    saveSettings(settings);
  };

  // --- the controls reflect settings ------------------------------------
  function renderDevices(inputs: readonly MicInput[]): void {
    deviceSel.replaceChildren(new Option("System default", ""));
    for (const d of inputs) deviceSel.add(new Option(d.label, d.deviceId));
    // the saved device keeps its place when it is not listed — unplugged,
    // or unnamed until the page has permission — and enable() falls back
    // to the default if it really is gone
    if (settings.deviceId && !inputs.some((d) => d.deviceId === settings.deviceId)) {
      deviceSel.add(new Option("Last used input", settings.deviceId));
    }
    deviceSel.value = settings.deviceId ?? "";
  }

  function renderChannels(): void {
    const n = session?.channels ?? 1;
    const ch = channelOf(settings);
    channelSel.replaceChildren(new Option(n > 1 ? "Mix all" : "Mono", "mix"));
    for (let i = 0; i < n && n > 1; i++) channelSel.add(new Option(`Input ${i + 1}`, String(i)));
    channelSel.value = ch === "mix" || ch >= n ? "mix" : String(ch);
    channelSel.disabled = n < 2;
    channelSel.title = n > 1
      ? "Which input of the device the instrument is on"
      : session ? "This device has one channel" : "Choices appear once the mic is on";
  }

  async function refreshDevices(): Promise<void> {
    try {
      renderDevices(await LiveMic.inputs());
    } catch {
      renderDevices([]);
    }
  }

  function renderButton(): void {
    button.textContent = state === "on" ? "Disable mic" : state === "starting" ? "Starting…" : "Enable mic";
    button.disabled = state === "starting";
  }

  function renderIdleMeter(): void {
    meter.classList.remove("on", "open");
    level.style.width = "0";
  }

  function onStats(s: Stats): void {
    meter.classList.add("on");
    meter.classList.toggle("open", s.gateOpen);
    level.style.width = pct(s.levelDb);
    floor.style.left = pct(s.floorDb);
    lagMs = lagMs ? lagMs * 0.9 + s.lagMs * 0.1 : s.lagMs;
    const now = performance.now();
    if (now - lastReadout > 500) {
      lastReadout = now;
      readout.textContent = describeLag();
    }
  }

  const describeLag = () =>
    `listening · ~${Math.round(lagMs / 10) * 10} ms behind` + (session?.backend === "cpu" ? " (no GPU: slow)" : "");

  // --- the session ------------------------------------------------------
  async function start(): Promise<void> {
    state = "starting";
    renderButton();
    host.status("Mic starting · loading the listening model…");
    const request = (deviceId: string | null) =>
      LiveMic.enable({ deviceId, channel: channelOf(settings), tuning: tuningOf(settings) }, {
        onStats,
        onLost: (reason) => stopped(`Mic off · ${reason}.`),
      });
    try {
      try {
        session = await request(settings.deviceId);
      } catch (err) {
        // the saved device is gone: listen on the default instead, and keep
        // the saved choice for when it comes back
        if (!(err instanceof DOMException && err.name === "OverconstrainedError") || !settings.deviceId) throw err;
        session = await request(null);
      }
    } catch (err) {
      if ((err as Error).message === "cancelled") return; // stop() got there first
      stopped("Mic unavailable: " + explain(err));
      return;
    }
    state = "on";
    renderButton();
    renderChannels();
    void refreshDevices(); // permission granted: real names now
    const rate = session.deviceRate ? ` · ${Math.round(session.deviceRate / 100) / 10} kHz` : "";
    const chans = session.channels > 1 ? ` · ${session.channels} ch` : "";
    host.status(`Mic on · ${session.label}${rate}${chans}`);
    readout.textContent = "listening";
  }

  function stopped(message: string): void {
    LiveMic.disable();
    state = "off";
    session = null;
    lagMs = 0;
    readout.textContent = "";
    renderButton();
    renderChannels();
    renderIdleMeter();
    host.status(message);
  }

  // --- wiring ------------------------------------------------------------
  button.addEventListener("click", () => {
    if (state === "off") void start();
    else stopped("Mic off.");
  });

  deviceSel.addEventListener("change", () => {
    update({ ...settings, deviceId: deviceSel.value || null });
    renderChannels();
    if (state === "on") void start(); // a new device is a new stream
  });

  channelSel.addEventListener("change", () => {
    const ch: Channel = channelSel.value === "mix" ? "mix" : Number(channelSel.value);
    update(withChannel(settings, ch));
    LiveMic.setChannel(ch);
  });

  responseSel.addEventListener("change", () => {
    update({ ...settings, response: responseSel.value as Response });
    LiveMic.tune(tuningOf(settings));
  });

  sensitivity.addEventListener("input", () => {
    update({ ...settings, sensitivity: Number(sensitivity.value) });
    LiveMic.tune(tuningOf(settings));
  });

  navigator.mediaDevices?.addEventListener?.("devicechange", () => void refreshDevices());

  responseSel.value = settings.response;
  sensitivity.value = String(settings.sensitivity);
  renderButton();
  renderChannels();
  renderIdleMeter();
  void refreshDevices();
}
