/* ====================================================================
   BACKCHAIN_BAR — the header's backchain switch, and while a chain runs,
   which link of it is looping (backchain.ts). It owns its own DOM (the
   markup is index.html's #chain) and nothing else: whether a chain is
   running, and at which link, is main.ts's, handed in by show; what
   starting, stopping or moving along one MEANS is main.ts's too, handed
   back through onStart, onStop and onGo.

   In the header rather than the tray, because the header is the one
   place every view keeps — the isolated keys included — and a chain is
   walked while playing, a link at a time, not set up once and left.

   Its buttons are the arrow keys' (main.ts): ↑ reaches one note further
   back, ↓ lets the earliest one go.
   ==================================================================== */

export interface ChainBar {
  /** Is there a score to backchain? The switch is dead without one. */
  setEnabled(on: boolean): void;
  /** The chain running — at link `at` of `count`, both from 0 — or null. */
  show(state: { readonly at: number; readonly count: number } | null): void;
}

export interface ChainActions {
  /** The switch was turned on: chain the selected bars. */
  onStart(): void;
  /** The switch was turned off. */
  onStop(): void;
  /** Loop link `at`, from 0 — clamped by main.ts, so it may be out of range. */
  onGo(at: number): void;
}

export function mountChainBar(root: HTMLElement, { onStart, onStop, onGo }: ChainActions): ChainBar {
  const q = <T extends HTMLElement>(sel: string): T => root.querySelector(sel) as T;
  const toggle = q<HTMLButtonElement>(".chain-toggle");
  const walk = q<HTMLSpanElement>(".chain-walk");
  const longer = q<HTMLButtonElement>(".chain-longer");
  const shorter = q<HTMLButtonElement>(".chain-shorter");
  const box = q<HTMLInputElement>(".chain-at");
  const of = q<HTMLSpanElement>(".chain-of");

  let state: { readonly at: number; readonly count: number } | null = null;

  toggle.addEventListener("click", () => (state ? onStop() : onStart()));
  longer.addEventListener("click", () => state && onGo(state.at + 1));
  shorter.addEventListener("click", () => state && onGo(state.at - 1));
  box.addEventListener("change", () => {
    const n = parseInt(box.value, 10);
    if (state && Number.isFinite(n)) onGo(n - 1);
    else show(state); // not a number: put back what is looping
  });
  box.addEventListener("keydown", (e) => {
    if (e.key === "Enter") box.blur();
    if (e.key === "Escape") {
      show(state);
      box.blur();
      e.stopPropagation(); // Escape meant the edit, not leaving the keys
    }
  });

  function show(next: typeof state): void {
    state = next;
    toggle.setAttribute("aria-pressed", String(state !== null));
    walk.hidden = state === null;
    if (!state) return;
    const { at, count } = state;
    box.value = String(at + 1);
    box.max = String(count);
    of.textContent = String(count);
    longer.disabled = at >= count - 1;
    shorter.disabled = at <= 0;
  }

  return {
    setEnabled(on) {
      toggle.disabled = !on;
    },
    show,
  };
}
