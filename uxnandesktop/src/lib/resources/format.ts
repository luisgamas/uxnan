// Formatting for the resource-observability surfaces. Pure on purpose (node
// test project): the rule that matters — an unknown value renders as a dash,
// never as a zero — lives here once, for every surface.

/** Placeholder for a metric the collector could not provide. */
export const UNKNOWN = "—";

/** Human bytes: `812 MB`, `1.4 GB`. `null`/`undefined` → the unknown dash. */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) {
    return UNKNOWN;
  }
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  // One decimal only when it carries information (1.4 GB yes, 812.0 MB no).
  const rounded = value >= 100 ? Math.round(value).toString() : value.toFixed(1).replace(/\.0$/, "");
  return `${rounded} ${units[unit]}`;
}

/** CPU percentage: `3.4%`. `null` → the unknown dash, and 0 renders as `0%`
 *  (a real measured idle, distinct from unknown). */
export function formatCpu(percent: number | null | undefined): string {
  if (percent === null || percent === undefined || !Number.isFinite(percent) || percent < 0) {
    return UNKNOWN;
  }
  const clamped = Math.min(percent, 100);
  return `${clamped >= 10 ? Math.round(clamped) : Math.round(clamped * 10) / 10}%`;
}

/** I/O rate: `1.2 MB/s`. `null` → the unknown dash. */
export function formatRate(bytesPerSec: number | null | undefined): string {
  const bytes = formatBytes(bytesPerSec);
  return bytes === UNKNOWN ? UNKNOWN : `${bytes}/s`;
}

/** Seconds-scale age: `12s`, `3m`, `1h 05m`. Used for orphan/staleness notes. */
export function formatAge(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return UNKNOWN;
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${String(mins % 60).padStart(2, "0")}m`;
}
