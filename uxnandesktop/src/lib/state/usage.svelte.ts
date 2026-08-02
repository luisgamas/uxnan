// Usage-stats store: polls the providers the user activated (Settings →
// Providers) and exposes the latest per-provider snapshot to the settings cards
// and the status-bar popover. Only activated providers are ever read — the poll
// is a no-op when the list is empty, so an idle feature costs nothing.

import { usageRead } from "$lib/api";
import { effectiveUsageRefreshMinutes } from "$lib/resources/policy";
import {
  configuredUsageMinutes,
  usageSnapshotIsStale,
} from "$lib/usageSchedule";
import type { ProviderUsage, UsageProvider, UsageProviderConfig } from "$lib/types";
import { app } from "./app.svelte";
import { resourceMode } from "./resourceMode.svelte";

class UsageStore {
  /** Latest snapshot per activated provider. */
  byProvider = $state<Partial<Record<UsageProvider, ProviderUsage>>>({});
  /** A refresh is in flight (drives spinners). */
  loading = $state(false);
  /** Epoch ms of the last successful full refresh. */
  lastRefresh = $state(0);

  #timers = new Map<UsageProvider, ReturnType<typeof setInterval>>();
  #inFlight = new Set<UsageProvider>();
  #requestCount = 0;
  #started = false;
  #onFocus = () => void this.ensureFresh();

  /** The providers the user activated, in configured order. */
  active(): UsageProvider[] {
    return (app.settings.usageProviders ?? []).map((c) => c.provider);
  }

  #activeConfigs(): UsageProviderConfig[] {
    return app.settings.usageProviders ?? [];
  }

  /** Arm provider-specific polls and catch up after app startup/wake. */
  start(): void {
    if (this.#started) return;
    this.#started = true;
    this.reschedule();
    void this.ensureFresh();
    if (typeof window !== "undefined") window.addEventListener("focus", this.#onFocus);
  }

  /** Disarm focus catch-up and every provider-specific poll. */
  stop(): void {
    if (this.#started && typeof window !== "undefined") {
      window.removeEventListener("focus", this.#onFocus);
    }
    this.#started = false;
    this.#clearTimers();
  }

  /** Read all activated providers and replace the snapshot map. */
  async refresh(): Promise<void> {
    const providers = this.active();
    if (providers.length === 0) {
      this.byProvider = {};
      return;
    }
    await this.#refreshProviders(providers);
  }

  /** Read a single provider (the card's "Refresh now"). */
  async refreshOne(provider: UsageProvider): Promise<void> {
    await this.#refreshProviders([provider]);
  }

  /** The effective refresh interval (min): the configured one scaled by the
   *  resource-mode policy (1× on Balanced, longer on Efficient); `0` stays
   *  manual-only whatever the profile. */
  #effectiveMinutes(config: UsageProviderConfig): number {
    return effectiveUsageRefreshMinutes(
      resourceMode.policy,
      configuredUsageMinutes(config, app.settings.usageRefreshMinutes ?? 5),
    );
  }

  /** Refresh when the current data is older than the effective interval (or
   *  never fetched). Called when a surface that shows usage opens. */
  async ensureFresh(): Promise<void> {
    const now = Date.now();
    const stale = this.#activeConfigs()
      .filter((config) =>
        usageSnapshotIsStale(
          this.byProvider[config.provider],
          this.#effectiveMinutes(config),
          now,
        ),
      )
      .map((config) => config.provider);
    if (stale.length > 0) await this.#refreshProviders(stale);
  }

  /** (Re)start the background poll to match the effective interval + active
   *  set. Call after the providers list, the interval or the resource profile
   *  changes. `0` minutes (manual only) or an empty active set stops polling. */
  reschedule(): void {
    this.#clearTimers();
    const active = new Set(this.active());
    this.byProvider = Object.fromEntries(
      Object.entries(this.byProvider).filter(([provider]) =>
        active.has(provider as UsageProvider),
      ),
    ) as Partial<Record<UsageProvider, ProviderUsage>>;
    if (!this.#started) return;
    for (const config of this.#activeConfigs()) {
      const mins = this.#effectiveMinutes(config);
      if (mins <= 0) continue;
      this.#timers.set(
        config.provider,
        setInterval(() => void this.refreshOne(config.provider), mins * 60_000),
      );
    }
  }

  #clearTimers(): void {
    for (const timer of this.#timers.values()) clearInterval(timer);
    this.#timers.clear();
  }

  async #refreshProviders(requested: UsageProvider[]): Promise<void> {
    const providers = [...new Set(requested)].filter((provider) => !this.#inFlight.has(provider));
    if (providers.length === 0) return;
    for (const provider of providers) this.#inFlight.add(provider);
    this.#requestCount += 1;
    this.loading = true;
    try {
      const results = await usageRead(providers);
      const next = { ...this.byProvider };
      for (const result of results) next[result.provider] = result;
      this.byProvider = next;
      this.lastRefresh = Date.now();
    } catch {
      // Keep the previous snapshots; each card shows its own last-known state.
    } finally {
      for (const provider of providers) this.#inFlight.delete(provider);
      this.#requestCount -= 1;
      this.loading = this.#requestCount > 0;
    }
  }
}

export const usage = new UsageStore();
