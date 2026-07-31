// Resource-observability store: holds the latest consolidated summary and
// manages the sampling leases. The collector backend is fully parked unless
// something takes a lease — so simply not opening a surface is what keeps the
// feature at zero cost.
//
// Two lease kinds share this store (and one event listener):
// - `popover` — a UI surface is open (the backend popover, the Settings
//   preview). Fast cadence, held while the surface is visible.
// - `budget` — a background consumer needs periodic samples: today the
//   orchestration engine's headroom check while the Performance profile allows
//   extended concurrency (see `orchestrationRun.svelte.ts`). Medium cadence.
//
// Leases are renewed on a timer while held and released on close; the backend
// also expires them on its own, so a webview reload that never released cannot
// pin the sampling cadence forever.

import { listen } from "@tauri-apps/api/event";

import { resourcesSubscribe, resourcesSummary, resourcesUnsubscribe } from "$lib/api";
import type { ResourceConsumerKind, ResourceSummary } from "$lib/types";
import { app } from "./app.svelte";

/** Renew a lease at half its backend TTL (90 s), so one missed renewal
 *  still keeps the consumer live. */
const LEASE_RENEW_MS = 45_000;

/** One held lease: its token, its renew timer. */
interface HeldLease {
  token: string;
  renew: ReturnType<typeof setInterval>;
}

class ResourcesStore {
  /** Latest consolidated summary (event-fed while any lease is held; `null`
   *  before the first read). */
  summary = $state<ResourceSummary | null>(null);
  /** First fetch for a surface is in flight (drives the loading state). */
  loading = $state(false);

  #unlisten: (() => void) | null = null;
  /** How many holders (surfaces + budget consumers) need the event feed. */
  #listenerRefs = 0;
  /** Open UI surfaces (popover, settings preview) sharing one popover lease. */
  #opens = 0;
  #popover: HeldLease | null = null;
  /** Background budget consumers sharing one budget lease. */
  #budgetRefs = 0;
  #budget: HeldLease | null = null;

  /** Whether the feature's surfaces should render at all. */
  get enabled(): boolean {
    return app.settings.resources?.enabled ?? true;
  }

  /** Attach the shared `resources:summary` listener (ref-counted). */
  async #retainListener(): Promise<void> {
    this.#listenerRefs += 1;
    if (this.#listenerRefs > 1 || this.#unlisten) return;
    try {
      this.#unlisten = await listen<ResourceSummary>("resources:summary", (event) => {
        this.summary = event.payload;
        this.loading = false;
      });
      // A holder may have released while `listen` was in flight.
      if (this.#listenerRefs === 0) {
        this.#unlisten();
        this.#unlisten = null;
      }
    } catch {
      // No Tauri event bus (plain web preview): surfaces show the empty state.
    }
  }

  #releaseListener(): void {
    if (this.#listenerRefs === 0) return;
    this.#listenerRefs -= 1;
    if (this.#listenerRefs === 0) {
      this.#unlisten?.();
      this.#unlisten = null;
    }
  }

  /** Take one lease of `kind` and keep renewing it. */
  async #acquire(kind: ResourceConsumerKind): Promise<HeldLease | null> {
    const token = crypto.randomUUID();
    try {
      await resourcesSubscribe(token, kind);
    } catch {
      return null; // no backend (web preview)
    }
    const renew = setInterval(() => {
      void resourcesSubscribe(token, kind).catch(() => {});
    }, LEASE_RENEW_MS);
    return { token, renew };
  }

  /** Release a held lease (idempotent; the backend also expires it). */
  async #release(lease: HeldLease | null): Promise<void> {
    if (!lease) return;
    clearInterval(lease.renew);
    try {
      await resourcesUnsubscribe(lease.token);
    } catch {
      // The backend expires the lease on its own; nothing to recover.
    }
  }

  /** A surface that shows live resources opened: take the popover lease,
   *  subscribe to the event feed and pull the buffered summary once. */
  async open(): Promise<void> {
    if (!this.enabled) return;
    this.#opens += 1;
    if (this.#opens > 1) return; // the lease is already live
    if (this.summary === null) this.loading = true;
    await this.#retainListener();
    this.#popover = await this.#acquire("popover");
    await this.refresh();
  }

  /** The surface closed: release the lease so the sampler can park again. */
  async close(): Promise<void> {
    if (this.#opens === 0) return;
    this.#opens -= 1;
    if (this.#opens > 0) return;
    this.#releaseListener();
    const lease = this.#popover;
    this.#popover = null;
    await this.#release(lease);
  }

  /** A background consumer (the orchestration headroom check) needs periodic
   *  samples: take the shared `budget` lease. Ref-counted and idempotent per
   *  holder pair (`acquireBudget`/`releaseBudget`). */
  async acquireBudget(): Promise<void> {
    if (!this.enabled) return;
    this.#budgetRefs += 1;
    if (this.#budgetRefs > 1) return;
    await this.#retainListener();
    this.#budget = await this.#acquire("budget");
    // A ref may have released while the subscribe was in flight.
    if (this.#budgetRefs === 0) {
      const lease = this.#budget;
      this.#budget = null;
      await this.#release(lease);
    }
  }

  /** Release one budget hold; the lease goes with the last one. */
  async releaseBudget(): Promise<void> {
    if (this.#budgetRefs === 0) return;
    this.#budgetRefs -= 1;
    if (this.#budgetRefs > 0) return;
    this.#releaseListener();
    const lease = this.#budget;
    this.#budget = null;
    await this.#release(lease);
  }

  /** Whether a budget hold is currently active (for tests/inspection). */
  get budgetHeld(): boolean {
    return this.#budgetRefs > 0;
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
