// Usage store: the plan limits of the providers the user activated (Settings →
// Providers, the status-bar popover) and what the agents on this PC spent.
// Both come from the bridge — the one reader, which asks Claude Code and Codex
// themselves and reads every agent CLI's transcripts (`agent/usageStats`,
// `usage/summary`) — so this app reads no credential and needs no OS grant.
// Only activated providers are ever polled; with the bridge off there is
// nothing to read, and the last snapshots stay as they were.

import { bridge } from "$lib/bridge/client.svelte";
import { effectiveUsageRefreshMinutes } from "$lib/resources/policy";
import {
  configuredUsageMinutes,
  usageSnapshotIsStale,
} from "$lib/usageSchedule";
import type {
  ProviderUsage,
  UsageProvider,
  UsageProviderConfig,
  UsageSummary,
} from "$lib/types";
import type { UsageStatsResult } from "$shared/models/usage";

/** The spend periods Providers offers, in days. */
export const SPEND_PERIODS = [7, 30, 90] as const;
export type SpendPeriod = (typeof SPEND_PERIODS)[number];
import { app } from "./app.svelte";
import { resourceMode } from "./resourceMode.svelte";

class UsageStore {
  /** Latest snapshot per activated provider. */
  byProvider = $state<Partial<Record<UsageProvider, ProviderUsage>>>({});
  /** A refresh is in flight (drives spinners). */
  loading = $state(false);
  /** Epoch ms of the last successful full refresh. */
  lastRefresh = $state(0);
  /** What the agents on this PC spent in the last `spendDays` days. */
  spend = $state<UsageSummary | null>(null);
  spendDays = $state<SpendPeriod>(30);
  spendLoading = $state(false);
  /** Why the last spend read failed, when it did. */
  spendError = $state<string | null>(null);

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
      if (bridge.status.state !== "connected") return;
      const { usage: results } = await bridge.call<UsageStatsResult>("agent/usageStats", {
        providers,
      });
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

  /** Read what the agents spent over [days] (the current period by default). */
  async loadSpend(days: SpendPeriod = this.spendDays): Promise<void> {
    this.spendDays = days;
    if (bridge.status.state !== "connected") return;
    this.spendLoading = true;
    try {
      const summary = await bridge.call<UsageSummary>("usage/summary", { days });
      // A slower answer for another period must not overwrite this one.
      if (days === this.spendDays) {
        this.spend = summary;
        this.spendError = null;
      }
    } catch (err) {
      if (days === this.spendDays) this.spendError = err instanceof Error ? err.message : String(err);
    } finally {
      if (days === this.spendDays) this.spendLoading = false;
    }
  }

  /** Redeem one of a provider's rate-limit resets (Codex) and keep the fresh
   *  snapshot the bridge answers with. [attempt] names this redemption, so a
   *  retry after a lost answer never spends a second one. */
  async redeemReset(provider: UsageProvider, attempt: string, creditId?: string): Promise<void> {
    const fresh = await bridge.call<ProviderUsage>("usage/redeemReset", {
      provider,
      idempotencyKey: attempt,
      ...(creditId ? { creditId } : {}),
    });
    this.byProvider = { ...this.byProvider, [provider]: fresh };
  }
}

export const usage = new UsageStore();
