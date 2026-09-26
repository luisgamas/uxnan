// Getting the Uxnan bridge onto this machine — and keeping it current — from
// inside the app. The bridge owns its own update (architecture/02a §5.8.18):
// it knows the newest published version, installs it and restarts on it
// (`bridge/update`), and tells every client (`stream/bridge/updated`). This
// store is the one place the window mirrors that state and asks for it.
//
// The app's own npm path (`bridgeclient/install.rs`) is for what the bridge
// cannot do for itself: installing it when there is none, and updating one
// that predates updating itself or does not run as the user's service.

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { BridgeStatus, BridgeUpdate } from '$shared/models/session';
import type { BridgeInstallInfo, BridgeInstallResult } from '$lib/types';
import { errorMessage, toast } from '$lib/toast';
import { i18n } from '$lib/i18n';
import { bridge, type BridgeClientStore } from './client.svelte';

/** Lines of npm output kept for the progress view. */
const LOG_LINES = 200;
/** How often a connected bridge's version facts are re-read (the bridge also
 *  says so itself; this only covers a missed notification). */
const STATUS_REFRESH_MS = 30 * 60 * 1000;

/**
 * What updating the connected bridge means right now:
 * - `self`: the bridge installs the published version and restarts itself.
 * - `installer`: the app installs it with npm and restarts the bridge — for a
 *   bridge that predates updating itself (`status.update` absent) or cannot
 *   (not run as the user's service).
 * `version` is the target when known (an old bridge does not say).
 */
export type UpdateOffer = { via: 'self' | 'installer'; version: string | null };

/** The update on offer for this bridge, or null. Pure. */
export function updateOffer(status: Pick<BridgeStatus, 'update'> | null): UpdateOffer | null {
  if (!status) return null;
  const update = status.update;
  // A bridge without `update` predates updating itself: it is older than this app.
  if (!update) return { via: 'installer', version: null };
  if (!update.available || update.phase === 'updating') return null;
  return { via: update.canApply ? 'self' : 'installer', version: update.latestVersion ?? null };
}

/** Whether an automatic update may run now. Pure, so the policy is testable. */
export function autoUpdateDue(input: {
  enabled: boolean;
  /** The app keeps the bridge running (Settings → Bridge & mobile: managed). */
  managed: boolean;
  status: Pick<BridgeStatus, 'update' | 'activeTurns' | 'version'> | null;
  /** What an automatic update was already attempted for (see {@link offerKey}). */
  attemptedFor: string | null;
  installing: boolean;
}): boolean {
  const { enabled, managed, status, attemptedFor, installing } = input;
  if (!enabled || !managed || installing || !status) return false;
  const offer = updateOffer(status);
  if (!offer || offerKey(status, offer) === attemptedFor) return false;
  // Never restart the bridge under someone's running turn — phone included.
  return (status.activeTurns ?? 0) === 0;
}

/** One automatic attempt per published version (or per old bridge version). */
function offerKey(status: Pick<BridgeStatus, 'version'>, offer: UpdateOffer): string {
  return offer.version ?? `from:${status.version}`;
}

export class BridgeInstallStore {
  readonly #client: BridgeClientStore;
  info = $state<BridgeInstallInfo | null>(null);
  probing = $state(false);
  installing = $state(false);
  restarting = $state(false);
  log = $state<string[]>([]);
  lastResult = $state<BridgeInstallResult | null>(null);
  /** The running bridge's `bridge/status`, when connected; its `update` is
   *  kept current by `stream/bridge/updated`. */
  status = $state<BridgeStatus | null>(null);
  /** The update this window asked the bridge for, until it comes back on it. */
  pendingVersion = $state<string | null>(null);
  /** How the last update this window asked for ended, for a toast. */
  outcome = $state<{ ok: boolean; version: string; message?: string } | null>(null);
  #autoAttemptedFor: string | null = null;
  #started = false;
  #autoUpdateEnabled: () => boolean = () => false;

  constructor(client: BridgeClientStore) {
    this.#client = client;
  }

  /** Subscribe to install output and to (re)connections (once).
   *  `autoUpdateEnabled` reads Settings → Bridge & mobile's switch. */
  async start(autoUpdateEnabled: () => boolean = () => false): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    this.#autoUpdateEnabled = autoUpdateEnabled;
    this.#client.onConnected(() => void this.refreshStatus());
    this.#client.onNotification((n) => {
      if (n.method !== 'stream/bridge/updated') return;
      const update = (n.params as { update?: BridgeUpdate } | undefined)?.update;
      if (update && this.status) this.#applyUpdate({ ...this.status, update });
    });
    try {
      await listen<string>('bridge:install-log', (e) => this.#append(e.payload));
    } catch {
      /* no backend */
    }
    const timer = setInterval(() => void this.refreshStatus(), STATUS_REFRESH_MS);
    (timer as { unref?: () => void }).unref?.();
  }

  /** Read what is installed. */
  async probe(): Promise<void> {
    this.probing = true;
    try {
      this.info = await invoke<BridgeInstallInfo>('bridge_install_probe');
    } catch {
      this.info = null;
    } finally {
      this.probing = false;
    }
  }

  /**
   * "Check again": what is installed, and the newest bridge asked of the
   * running bridge right now (`bridge/checkForUpdate`, past its hourly check),
   * so a release is offered the moment it is out. A bridge too old to answer
   * is simply re-read.
   */
  async checkForUpdate(): Promise<void> {
    await this.probe();
    if (!this.#client.connected) return;
    try {
      const update = await this.#client.call<BridgeUpdate>('bridge/checkForUpdate');
      if (this.status) this.status = { ...this.status, update };
    } catch {
      /* a bridge older than the method: its status is all there is */
    }
    await this.refreshStatus();
  }

  /** Re-read the running bridge's version facts. */
  async refreshStatus(): Promise<void> {
    if (!this.#client.connected) {
      this.status = null;
      return;
    }
    let next: BridgeStatus;
    try {
      next = await this.#client.call<BridgeStatus>('bridge/status');
    } catch {
      this.status = null;
      return;
    }
    this.#applyUpdate(next);
    await this.maybeAutoUpdate(this.#autoUpdateEnabled());
  }

  /** Adopt a status; settles an update this window asked for once the bridge
   *  is back on the new version, or says it failed. */
  #applyUpdate(next: BridgeStatus): void {
    this.status = next;
    const target = this.pendingVersion;
    if (target === null) return;
    if (next.version === target) {
      this.pendingVersion = null;
      this.#settle({ ok: true, version: target });
    } else if (next.update?.phase === 'failed') {
      this.pendingVersion = null;
      this.#settle({ ok: false, version: target, message: next.update.failure?.message });
    }
  }

  /** Record how an update ended, and say so. */
  #settle(outcome: { ok: boolean; version: string; message?: string }): void {
    this.outcome = outcome;
    if (outcome.ok) toast.success(i18n.t('bridge.updatedOk', { version: outcome.version }));
    else
      toast.error(i18n.t('bridge.updateFailedToast', { version: outcome.version }), {
        description: outcome.message,
      });
  }

  /** The update on offer right now (see {@link updateOffer}). */
  get offer(): UpdateOffer | null {
    return this.#client.connected ? updateOffer(this.status) : null;
  }

  /** Whether the connected bridge is updating (asked here or anywhere else). */
  get updating(): boolean {
    return this.pendingVersion !== null || this.status?.update?.phase === 'updating';
  }

  /**
   * Update the connected bridge, the way it can be: by itself (`bridge/update`
   * — it stops, installs and comes back) or with the app's installer. Throws
   * the bridge's refusal (a turn running, say) for the caller to show.
   */
  async update(): Promise<void> {
    const offer = this.offer;
    if (!offer || this.updating) return;
    if (offer.via === 'installer') {
      const result = await this.install();
      if (result) {
        this.#settle(
          result.ok
            ? { ok: true, version: result.version ?? offer.version ?? '' }
            : { ok: false, version: offer.version ?? '', message: result.tail.at(-1) },
        );
      }
      return;
    }
    const entered = await this.#client.call<BridgeUpdate>('bridge/update');
    if (entered.phase === 'updating') {
      this.pendingVersion = entered.targetVersion ?? offer.version;
      if (this.status) this.status = { ...this.status, update: entered };
    }
  }

  /** Install or update now. Resolves with how it ended. */
  async install(): Promise<BridgeInstallResult | null> {
    if (this.installing) return null;
    this.installing = true;
    this.log = [];
    try {
      const result = await invoke<BridgeInstallResult>('bridge_install');
      this.lastResult = result;
      await this.probe();
      return result;
    } catch (err) {
      const message = errorMessage(err);
      const result: BridgeInstallResult = {
        ok: false,
        version: null,
        permissionDenied: false,
        tail: [message],
        restarted: false,
      };
      this.lastResult = result;
      return result;
    } finally {
      this.installing = false;
    }
  }

  /** Restart the bridge on the version installed now (the running one —
   *  the app's or the user's — is stopped and a fresh one started). Throws
   *  the backend's reason when it could not. */
  async restart(): Promise<void> {
    if (this.restarting) return;
    this.restarting = true;
    try {
      await invoke('bridge_restart');
    } finally {
      this.restarting = false;
    }
  }

  /** Run an automatic update when the policy says it is due. */
  async maybeAutoUpdate(enabled: boolean): Promise<void> {
    const managed = this.#client.status.state === 'connected' && this.#client.status.managed;
    const due = autoUpdateDue({
      enabled,
      managed,
      status: this.status,
      attemptedFor: this.#autoAttemptedFor,
      installing: this.installing,
    });
    const offer = this.offer;
    if (!due || !offer || !this.status) return;
    // One attempt per published version: a failure is shown, not retried in a loop.
    this.#autoAttemptedFor = offerKey(this.status, offer);
    await this.update().catch(() => undefined);
  }

  #append(line: string): void {
    const next = [...this.log, line];
    this.log = next.length > LOG_LINES ? next.slice(next.length - LOG_LINES) : next;
  }
}

export const bridgeInstall = new BridgeInstallStore(bridge);
