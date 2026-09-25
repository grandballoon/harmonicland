/* ====================================================================
   MIC_SETTINGS — the listener's choices, kept between visits, and what
   they mean to the transcriber. Two kinds live here:

   - WHICH SIGNAL: the input device and, for an audio interface with
     several inputs, which of its channels the instrument's mic is on (or
     all of them mixed). The channel is remembered per device, since "the
     piano is on input 2" is a fact about one interface, not about mics.
   - HOW TO READ IT: the response dial (lookahead: latency against
     accuracy) and sensitivity (how readily a strike counts as a note).

   Nothing here assumes a particular class of microphone. A laptop mic
   and a studio condenser differ in level, noise and channel count; the
   level is the noise gate's job (it adapts to each floor), the channel
   count is this module's, and the rest is the listener's to dial.

   Storage can be missing or forbidden, so every access is guarded, as in
   section-store.ts: a failed load is the defaults, a failed save is a
   setting that lasts only this visit.
   ==================================================================== */
import { DEFAULT_TRACKER, type TrackerOptions } from "./note-tracker";

/** "mix" averages every channel; a number picks one (0-based). */
export type Channel = "mix" | number;

export type Response = "fast" | "balanced" | "accurate";

export interface MicSettings {
  /** The chosen input, or null for the system default. */
  deviceId: string | null;
  /** Channel per device id ("" for the system default). */
  channels: Readonly<Record<string, Channel>>;
  response: Response;
  /** 0 (only clear, strong notes) … 1 (catch soft notes, risk ghosts). */
  sensitivity: number;
}

export const DEFAULT_SETTINGS: MicSettings = {
  deviceId: null,
  channels: {},
  response: "balanced",
  sensitivity: 0.5,
};

/** Frames of lookahead per response setting (≈11.6 ms each). Measured on
 *  the bundled piano samples: 5 still catches a repeated chord, 2 does not. */
export const LOOKAHEAD: Readonly<Record<Response, number>> = {
  fast: 5,
  balanced: 8,
  accurate: 14,
};

export const channelOf = (s: MicSettings): Channel => s.channels[s.deviceId ?? ""] ?? "mix";

export const withChannel = (s: MicSettings, ch: Channel): MicSettings =>
  ({ ...s, channels: { ...s.channels, [s.deviceId ?? ""]: ch } });

/** Sensitivity moves the two strike thresholds together, around the
 *  defaults at 0.5. The confirm threshold stays above the ~0.4 that
 *  overtones reach even at full sensitivity. */
export function trackerOptions(sensitivity: number): TrackerOptions {
  const s = Math.min(1, Math.max(0, sensitivity));
  return {
    ...DEFAULT_TRACKER,
    onsetThreshold: 0.7 - 0.4 * s, // 0.7 … 0.3
    confirmThreshold: 0.6 - 0.16 * s, // 0.6 … 0.44
  };
}

const RESPONSES: readonly Response[] = ["fast", "balanced", "accurate"];

const isChannel = (c: unknown): c is Channel =>
  c === "mix" || (Number.isInteger(c) && (c as number) >= 0);

/** Whatever was stored, as valid settings: unknown or damaged fields fall
 *  back to their defaults one by one, so one bad field loses only itself. */
export function parse(raw: unknown): MicSettings {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const channels: Record<string, Channel> = {};
  if (o.channels && typeof o.channels === "object") {
    for (const [k, v] of Object.entries(o.channels)) if (isChannel(v)) channels[k] = v;
  }
  return {
    deviceId: typeof o.deviceId === "string" ? o.deviceId : null,
    channels,
    response: RESPONSES.includes(o.response as Response) ? (o.response as Response) : DEFAULT_SETTINGS.response,
    sensitivity: typeof o.sensitivity === "number" && o.sensitivity >= 0 && o.sensitivity <= 1
      ? o.sensitivity : DEFAULT_SETTINGS.sensitivity,
  };
}

/** Versioned, so a future change of shape can read the old one. */
const KEY = "harmonicland.mic.v1";

export function loadSettings(storage: () => Storage | null = () => globalThis.localStorage ?? null): MicSettings {
  try {
    const raw = storage()?.getItem(KEY);
    return raw ? parse(JSON.parse(raw)) : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: MicSettings, storage: () => Storage | null = () => globalThis.localStorage ?? null): void {
  try {
    storage()?.setItem(KEY, JSON.stringify(s));
  } catch {
    // quota or permissions: this visit keeps the setting, the next forgets
  }
}
