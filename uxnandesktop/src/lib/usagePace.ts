// Where a plan's usage window stands, for the chat's context ring: how much of
// the window's time has passed and, when the pace so far would use the rest
// before the window resets, how soon the limit is hit. The phone draws the
// same thing (`WindowPace` in its usage section).

import type { ProviderUsage, UsageWindow } from "$lib/types";

/** A window's pace at a moment. */
export interface WindowPace {
  /** The share of the window's time that has passed, 0–1. */
  elapsed: number;
  /** Milliseconds until the limit at the pace so far, when before the reset. */
  runsOutInMs?: number;
}

/** The pace of [window] at [now], or undefined when the window gives no
 *  length or reset, or has barely begun (too early to say). */
export function windowPace(window: UsageWindow, now: number): WindowPace | undefined {
  const minutes = window.windowMinutes;
  const reset = window.resetsAt;
  if (!minutes || minutes <= 0 || !reset) return undefined;
  const length = minutes * 60_000;
  const left = reset - now;
  if (left < 0 || left > length) return undefined;
  const passed = length - left;
  const elapsed = passed / length;
  if (elapsed < 0.05) return undefined;
  const used = Math.min(100, Math.max(0, window.usedPercent));
  if (used <= 0) return { elapsed };
  if (used >= 100) return { elapsed, runsOutInMs: 0 };
  const toLimit = ((100 - used) * passed) / used;
  return toLimit < left ? { elapsed, runsOutInMs: Math.round(toLimit) } : { elapsed };
}

/** The window of a plan most worth a glance: one the pace runs out first,
 *  else the fullest. */
export function pressingWindow(
  usage: ProviderUsage | undefined,
  now: number,
): { window: UsageWindow; pace?: WindowPace } | undefined {
  if (!usage || usage.status !== "ok" || usage.windows.length === 0) return undefined;
  const rows = usage.windows.map((window) => ({ window, pace: windowPace(window, now) }));
  const hot = rows
    .filter((r) => r.pace?.runsOutInMs !== undefined)
    .sort((a, b) => a.pace!.runsOutInMs! - b.pace!.runsOutInMs!);
  if (hot.length > 0) return hot[0];
  return rows.sort((a, b) => b.window.usedPercent - a.window.usedPercent)[0];
}
