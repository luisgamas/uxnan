// Terminal scrollback (retained output) sizing.
//
// The live xterm buffer is a ring: past `scrollback` lines, the oldest are
// evicted — and since instances live for the tab's whole life and nothing is
// ever re-fetched (see `instances.ts`), this is the *effective* limit on how far
// back a user can scroll. Verbose agent CLIs (e.g. Codex) can blow past a low cap
// in a single session, silently dropping the start of the transcript. The default
// is generous and the value is user-configurable (Settings → Terminal).

/** Default retained lines when the user hasn't set a value. */
export const DEFAULT_TERMINAL_SCROLLBACK = 20_000;
/** Smallest value the UI/config accepts. */
export const MIN_TERMINAL_SCROLLBACK = 1_000;
/** Largest value the UI/config accepts (a bound on per-terminal memory). */
export const MAX_TERMINAL_SCROLLBACK = 200_000;

/** Preset choices offered in Settings → Terminal (the setting is a select, like
 *  the usage refresh interval, so values stay within a sane range). */
export const TERMINAL_SCROLLBACK_PRESETS = [1_000, 2_500, 5_000, 10_000, 20_000, 50_000, 100_000];

/** Clamp a persisted / user value into the supported range, falling back to the
 *  default when unset or not a finite number. */
export function clampScrollback(value: number | undefined | null): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_TERMINAL_SCROLLBACK;
  return Math.min(MAX_TERMINAL_SCROLLBACK, Math.max(MIN_TERMINAL_SCROLLBACK, Math.round(value)));
}

/** Lines persisted in the sleep/close scrollback snapshot (the terminal-buffers
 *  sidecar replayed on wake/restart). Bounded independently of the live cap so a
 *  very large live scrollback can't bloat the atomic sidecar; the byte cap in the
 *  store (`SNAPSHOT_MAX`) is the final guard. */
export const SNAPSHOT_SCROLLBACK = 5_000;
