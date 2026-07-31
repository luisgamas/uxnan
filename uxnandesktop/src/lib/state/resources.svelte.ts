// Resource-observability store: holds the latest consolidated summary and
// manages the sampling lease for the popover surface. The collector backend is
// fully parked unless something calls `open()` — so simply not opening the
// popover is what keeps the feature at zero cost.
//
// Leases are renewed on a timer while open and released on close; the backend
// also expires them on its own, so a webview reload that never called `close()`
// cannot pin the fast sampling cadence forever.

import { listen } from "@tauri-apps/api/event";

import { resourcesSubscribe, resourcesSummary, resourcesUnsubscribe } from "$lib/api";
import type { ResourceSummary } from "$lib/types";
import { app } from "./app.svelte";

/** Renew the lease at half its backend TTL (90 s), so one missed renewal
 *  still keeps the surface live. */
const LEASE_RENEW_MS = 45_000;

class ResourcesStore {
  /** Latest consolidated summary (event-fed while open; `null` before). */
  summary = $state<ResourceSummary | null>(null);
  /** First fetch for a surface is in flight (drives the loading state). */
  loading = $state(false);

  #token: string | null = null;
  #renewTimer: ReturnType<typeof setInterval> | null = null;
  #unlisten: (() => void) | null = null;
  /** Open surfaces (popover, settings preview) sharing the one lease. */
  #opens = 0;

  /** Whether the feature's surfaces should render at all. */
  get enabled(): boolean {
    return app.settings.resources?.enabled ?? true;
  }

  /** A surface that shows live resources opened: take the sampling lease,
   *  subscribe to the event feed and pull the buffered summary once. */
  async open(): Promise<void> {
    if (!this.enabled) return;
    this.#opens += 1;
    if (this.#opens > 1) return; // the lease is already live
    if (this.summary === null) this.loading = true;
    const token = crypto.randomUUID();
    this.#token = token;
    try {
      this.#unlisten = await listen<ResourceSummary>("resources:summary", (event) => {
        this.summary = event.payload;
        this.loading = false;
      });
      await resourcesSubscribe(token, "popover");
      this.#renewTimer = setInterval(() => {
        void resourcesSubscribe(token, "popover").catch(() => {});
      }, LEASE_RENEW_MS);
    } catch {
      // No Tauri backend (plain web preview): the surface shows its empty state.
    }
    await this.refresh();
  }

  /** The surface closed: release the lease so the sampler parks again. */
  async close(): Promise<void> {
    if (this.#opens === 0) return;
    this.#opens -= 1;
    if (this.#opens > 0) return;
    if (this.#renewTimer) {
      clearInterval(this.#renewTimer);
      this.#renewTimer = null;
    }
    this.#unlisten?.();
    this.#unlisten = null;
    const token = this.#token;
    this.#token = null;
    if (token) {
      try {
        await resourcesUnsubscribe(token);
      } catch {
        // The backend expires the lease on its own; nothing to recover.
      }
    }
  }

  /** One-shot pull of the buffered summary (no fresh sample). */
  async refresh(): Promise<void> {
    try {
      this.summary = await resourcesSummary();
    } catch {
      // Keep the previous snapshot (or the empty state outside Tauri).
    } finally {
      this.loading = false;
    }
  }
}

export const resources = new ResourcesStore();
