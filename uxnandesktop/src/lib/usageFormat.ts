// Pure formatting helpers for the usage-stats UI (settings cards + status-bar
// popover). Kept free of i18n so both surfaces share one implementation; the
// human-facing prefixes ("resets in", provider status labels) come from the
// caller's i18n.

import type { MessageKey } from "./i18n/locales/en";
import type { UsageStatus } from "./types";

/** A compact, unit-based countdown to `epochMs` (e.g. `2h 30m`, `3d`, `5m`),
 *  or null when the reset is unknown or already past. */
export function formatReset(epochMs?: number): string | null {
  if (!epochMs) return null;
  const diff = epochMs - Date.now();
  if (diff <= 0) return null;
  const mins = Math.floor(diff / 60_000);
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${Math.max(1, m)}m`;
}

/** A currency/credit amount (e.g. `$4.20`, `120 credits`). */
export function formatCredit(amount: number, currency: string): string {
  if (currency.toLowerCase() === "credits") {
    return `${Math.round(amount)} credits`;
  }
  const symbol = currency === "USD" ? "$" : currency === "EUR" ? "€" : "";
  const value = amount.toFixed(2);
  return symbol ? `${symbol}${value}` : `${value} ${currency}`;
}

/** Tailwind fill class for a used-percentage: calm under 70, amber 70–90, red
 *  from 90 — so a near-exhausted window reads at a glance. */
export function meterFill(usedPercent: number): string {
  if (usedPercent >= 90) return "bg-destructive";
  if (usedPercent >= 70) return "bg-amber-500";
  return "bg-emerald-500";
}

/** Per-status presentation for the header dot + subtitle. `tone` picks the dot
 *  color; `labelKey` is an i18n key the caller resolves. */
export function statusMeta(status: UsageStatus): { dot: string; labelKey: MessageKey } {
  switch (status) {
    case "ok":
      return { dot: "bg-emerald-500", labelKey: "providers.statusOk" };
    case "authRequired":
      return { dot: "bg-amber-500", labelKey: "providers.statusAuthRequired" };
    case "notInstalled":
      return { dot: "bg-muted-foreground/50", labelKey: "providers.statusNotInstalled" };
    case "error":
      return { dot: "bg-destructive", labelKey: "providers.statusError" };
  }
}
