// Compact relative-time formatter for the agent view's per-row timestamps. Pure
// (takes `now`) so it's directly unit-testable and doesn't self-tick — the ticking
// clock lives in `time.svelte.ts`.

/** `now` (<1 min), then `Nm`, `Nh`, `Nd`. A future `fromMs` clamps to `now`. */
export function relTime(fromMs: number, now: number): string {
  const s = Math.max(0, Math.floor((now - fromMs) / 1000));
  if (s < 60) return "now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/**
 * A human-readable, localized relative time via `Intl.RelativeTimeFormat`
 * ("1 day ago" / "hace 1 día"). `numeric: "always"` keeps the "N unit ago"
 * phrasing (not "yesterday"). Pure — takes `now` + `locale`.
 */
export function relTimeLong(fromMs: number, now: number, locale: string): string {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "always" });
  const diffMs = fromMs - now; // negative = past
  const day = 86_400_000;
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 365 * day],
    ["month", 30 * day],
    ["day", day],
    ["hour", 3_600_000],
    ["minute", 60_000],
  ];
  for (const [unit, ms] of units) {
    if (Math.abs(diffMs) >= ms) return rtf.format(Math.round(diffMs / ms), unit);
  }
  return rtf.format(Math.round(diffMs / 1000), "second");
}
