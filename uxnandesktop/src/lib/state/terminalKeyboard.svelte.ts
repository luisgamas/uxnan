// Per-terminal "focus mode" (passthrough): while on, every key goes to the
// TUI/agent, even reserved uxnan shortcuts (the one exception is the passthrough
// toggle itself, so you can always turn it back off). Reactive so the
// on-terminal badge tracks it. Transient — not persisted; resets on restart.

class TerminalKeyboard {
  private on = $state<Record<string, boolean>>({});

  /** Whether the given terminal is in focus/passthrough mode. */
  passthrough(id: string): boolean {
    return this.on[id] === true;
  }

  /** Flip focus mode for a terminal; returns the new value. */
  toggle(id: string): boolean {
    const next = !this.on[id];
    this.on = { ...this.on, [id]: next };
    return next;
  }

  /** Drop a terminal's state when it closes (avoid leaking ids). */
  clear(id: string): void {
    if (id in this.on) {
      const { [id]: _drop, ...rest } = this.on;
      this.on = rest;
    }
  }
}

/** Singleton per-terminal keyboard (focus-mode) state. */
export const terminalKeyboard = new TerminalKeyboard();
