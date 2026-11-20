/* ====================================================================
   SYNC_ROW — the tray's sync row: whether the server has every saved
   section, and the account's key (identity.ts), to copy into another
   browser or to paste one from it. Owns its DOM (index.html's #sync-row);
   knows nothing of sections beyond the status it is handed. Adopting a
   key is handed back through onAdopt, and main.ts reloads the sections.
   ==================================================================== */
import { isKey } from "./identity";
import type { SyncStatus } from "./section-store";

export interface SyncRow {
  setStatus(s: SyncStatus): void;
}

export interface SyncRowOptions {
  /** False when the build names no server: sections stay in this browser. */
  cloud: boolean;
  key(): string;
  onAdopt(key: string): void;
}

const TEXT: Record<SyncStatus, string> = {
  synced: "Sections saved to the cloud",
  saving: "Saving sections…",
  offline: "Server unreachable · sections kept here, sent later",
};

export function mountSyncRow(root: HTMLElement, { cloud, key, onAdopt }: SyncRowOptions): SyncRow {
  const q = <T extends HTMLElement>(sel: string): T => root.querySelector(sel) as T;
  const status = q<HTMLSpanElement>(".sync-status");
  const details = q<HTMLDetailsElement>(".sync-key");
  const own = q<HTMLInputElement>(".sync-key-own");
  const copy = q<HTMLButtonElement>(".sync-copy");
  const other = q<HTMLInputElement>(".sync-key-other");
  const use = q<HTMLButtonElement>(".sync-use");

  const setStatus = (s: SyncStatus): void => {
    status.textContent = TEXT[s];
    status.dataset.status = s;
  };

  details.hidden = !cloud;
  if (!cloud) {
    status.textContent = "Sections saved in this browser only";
    return { setStatus: () => {} };
  }
  status.textContent = "Connecting…";
  own.value = key();

  own.addEventListener("focus", () => own.select());
  copy.addEventListener("click", () => {
    own.select();
    void navigator.clipboard?.writeText(own.value).then(
      () => (copy.textContent = "Copied"),
      () => {}, // the key is selected; the learner can copy it by hand
    );
  });

  const candidate = (): string => other.value.trim();
  other.addEventListener("input", () => {
    use.disabled = !isKey(candidate()) || candidate() === key();
    copy.textContent = "Copy";
  });
  const adopt = (): void => {
    const k = candidate();
    if (!isKey(k) || k === key()) return;
    onAdopt(k);
    own.value = key();
    other.value = "";
    use.disabled = true;
  };
  use.addEventListener("click", adopt);
  other.addEventListener("keydown", (e) => {
    if (e.key === "Enter") adopt();
  });

  return { setStatus };
}
