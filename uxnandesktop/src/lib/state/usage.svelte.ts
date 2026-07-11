// Usage-stats store: polls the providers the user activated (Settings →
// Providers) and exposes the latest per-provider snapshot to the settings cards
// and the status-bar popover. Only activated providers are ever read — the poll
// is a no-op when the list is empty, so an idle feature costs nothing.

import { usageRead } from "$lib/api";
import type { ProviderUsage, UsageProvider } from "$lib/types";
import { app } from "./app.svelte";

class UsageStore {
  /** Latest snapshot per activated provider. */
  byProvider = $state<Partial<Record<UsageProvider, ProviderUsage>>>({});
  /** A refresh is in flight (drives spinners). */
  loading = $state(false);
  /** Epoch ms of the last successful full refresh. */
  lastRefresh = $state(0);

  #timer: ReturnType<typeof setInterval> | null = null;

  /** The providers the user activated, in configured order. */
  active(): UsageProvider[] {
    return (app.settings.usageProviders ?? []).map((c) => c.provider);
  }

  /** Read all activated providers and replace the snapshot map. */
  async refresh(): Promise<void> {
    const providers = this.active();
    if (providers.length === 0) {
      this.byProvider = {};
      return;
    }
    this.loading = true;
    try {
      const results = await usageRead(providers);
      const next: Partial<Record<UsageProvider, ProviderUsage>> = {};
      for (const r of results) next[r.provider] = r;
      this.byProvider = next;
      this.lastRefresh = Date.now();
    } catch {
      // Keep the previous snapshot; each card shows its own last-known state.
    } finally {
      this.loading = false;
    }
  }

  /** Read a single provider (the card's "Refresh now"). */
  async refreshOne(provider: UsageProvider): Promise<void> {
    this.loading = true;
    try {
      const [r] = await usageRead([provider]);
      if (r) this.byProvider = { ...this.byProvider, [provider]: r };
    } catch {
      // ignore; the card keeps its last-known state
    } finally {
      this.loading = false;
    }
  }

  /** Refresh when the current data is older than the configured interval (or
   *  never fetched). Called when a surface that shows usage opens. */
  async ensureFresh(): Promise<void> {
    const mins = app.settings.usageRefreshMinutes ?? 5;
    const maxAge = mins > 0 ? mins * 60_000 : Number.POSITIVE_INFINITY;
    if (Date.now() - this.lastRefresh > maxAge) await this.refresh();
  }

  /** (Re)start the background poll to match the configured interval + active
   *  set. Call after the providers list or interval changes. `0` minutes (manual
   *  only) or an empty active set stops polling. */
  reschedule(): void {
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
    const mins = app.settings.usageRefreshMinutes ?? 5;
    if (mins <= 0 || this.active().length === 0) return;
    this.#timer = setInterval(() => void this.refresh(), mins * 60_000);
  }
}

export const usage = new UsageStore();
