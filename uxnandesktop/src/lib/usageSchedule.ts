import type { ProviderUsage, UsageProviderConfig } from "$lib/types";

/** Resolve a provider's own interval override against the global default. */
export function configuredUsageMinutes(
  config: UsageProviderConfig,
  globalMinutes: number,
): number {
  return config.refreshMinutes ?? globalMinutes;
}

/** Whether a visible provider needs a catch-up read. Manual-only providers are
 * fetched once when empty, but are never considered stale afterward. */
export function usageSnapshotIsStale(
  snapshot: ProviderUsage | undefined,
  effectiveMinutes: number,
  now = Date.now(),
): boolean {
  if (!snapshot) return true;
  if (effectiveMinutes <= 0) return false;
  return now - snapshot.updatedAt >= effectiveMinutes * 60_000;
}
