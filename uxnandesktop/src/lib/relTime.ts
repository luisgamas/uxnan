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
