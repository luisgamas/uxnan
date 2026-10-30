// Getting the Uxnan bridge onto this machine — and keeping it current — from
// inside the app (architecture/02a §5.8.18). Who updates a bridge depends on
// how it was installed (`BridgeStatus.host.install`):
//
// - `bundled`: it came with this app (`bridgeclient::runtime` in Rust). The app
//   keeps it at the version it carries — a new desktop brings the new bridge —
//   switching it at a quiet moment, verified, and rolled back when the new one
//   does not come up.
// - `npm`: an independent bridge the user installed updates itself
//   (`bridge/update`, then `stream/bridge/updated`); the app only asks it to.
//
// This store is the one place the window mirrors that state and asks for it.
// The app never runs npm: its own path is the bridge it carries — installing
// it when there is none, keeping it current, or switching an independent
// bridge that cannot update itself over to it when the user says so.

import { invoke } from '@tauri-apps/api/core';
import type { BridgeStatus, BridgeUpdate } from '$shared/models/session';
import { isNewerVersion } from '$shared/version/compare';
import type { BridgeInstallInfo, BridgeInstallResult } from '$lib/types';
import { toast } from '$lib/toast';
import { i18n } from '$lib/i18n';
import { bridge, type BridgeClientStore } from './client.svelte';

/** How often a connected bridge's version facts are re-read (the bridge also
 *  says so itself; this only covers a missed notification). */
const STATUS_REFRESH_MS = 30 * 60 * 1000;

/**
 * What updating the connected bridge means right now:
 * - `self`: the bridge installs the published version and restarts itself.
 * - `app`: the app puts the bridge it carries in place — the bridge it
 *   installed is behind the app, or an independent one cannot update itself.
 * `version` is the target when known.
 */
export type UpdateOffer = { via: 'self' | 'app'; version: string | null };

type StatusFacts = Pick<BridgeStatus, 'update' | 'version' | 'host'>;

/** The update on offer for this bridge, given the version this app carries
 *  (`null` for a build without one), or null. Pure. */
export function updateOffer(status: StatusFacts | null, bundledVersion: string | null): UpdateOffer | null {
  if (!status) return null;
  // A status crossed a process boundary: a version it lacks compares as nothing.
  const appIsNewer =
    bundledVersion !== null &&
    typeof status.version === 'string' &&
    isNewerVersion(bundledVersion, status.version);
  // The bridge this app carries is kept at the app's version, nothing else.
  if (status.host?.install === 'bundled') {
    return appIsNewer ? { via: 'app', version: bundledVersion } : null;
  }
  const update = status.update;
  if (update?.phase === 'updating') return null;
  if (update?.available && update.canApply) {
    return { via: 'self', version: update.latestVersion ?? null };
  }
  // One that cannot update itself, or predates doing so (no `update`): the
  // app's own bridge, when it is newer.
  if ((!update || !update.canApply) && appIsNewer) return { via: 'app', version: bundledVersion };
  return null;
}

/** Whether an automatic update may run now. Pure, so the policy is testable. */
export function autoUpdateDue(input: {
  /** Settings → Bridge & mobile: let an independent bridge update itself. */
  enabled: boolean;
  /** The app keeps the bridge running (Settings → Bridge & mobile: managed). */
  managed: boolean;
  status: (StatusFacts & Pick<BridgeStatus, 'activeTurns'>) | null;
  bundledVersion: string | null;
  /** What an automatic update was already attempted for (see {@link offerKey}). */
  attemptedFor: string | null;
  installing: boolean;
}): boolean {
  const { enabled, managed, status, bundledVersion, attemptedFor, installing } = input;
  if (!managed || installing || !status) return false;
  const offer = updateOffer(status, bundledVersion);
  if (!offer || offerKey(status, offer) === attemptedFor) return false;
  const own = status.host?.install === 'bundled';
  // An independent bridge is the user's: it updates itself only when they
  // allowed it, and it is never swapped for the app's one unasked.
  if (!own && (!enabled || offer.via === 'app')) return false;
  // Never restart the bridge under someone's running turn — phone included.
  return (status.activeTurns ?? 0) === 0;
}

/** One automatic attempt per target version (or per old bridge version). */
function offerKey(status: Pick<BridgeStatus, 'version'>, offer: UpdateOffer): string {
  return `${offer.via}:${offer.version ?? `from:${status.version}`}`;
}

export class BridgeInstallStore {
  readonly #client: BridgeClientStore;
  info = $state<BridgeInstallInfo | null>(null);
  probing = $state(false);
  installing = $state(false);
  restarting = $state(false);
  uninstalling = $state(false);
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
  #probed = false;
  #autoUpdateEnabled: () => boolean = () => false;

  constructor(client: BridgeClientStore) {
    this.#client = client;
  }

  /** The bridge version this app carries, once probed. */
  get bundledVersion(): string | null {
    return this.info?.bundledVersion ?? null;
  }

  /** Subscribe to (re)connections (once). `autoUpdateEnabled` reads
   *  Settings → Bridge & mobile's switch. */
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
    const timer = setInterval(() => void this.refreshStatus(), STATUS_REFRESH_MS);
    (timer as { unref?: () => void }).unref?.();
  }

  /** Read what is on this machine. */
  async probe(): Promise<void> {
    this.probing = true;
    this.#probed = true;
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
    // What this app carries decides its own bridge's update: read once, and
    // only with a bridge connected — the `off` mode starts no process at all.
    // A plain field, not `info`: an effect that refreshes must not come to
    // depend on the state `probe` writes.
    if (!this.#probed) await this.probe();
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
    return this.#client.connected ? updateOffer(this.status, this.bundledVersion) : null;
  }

  /** Whether the connected bridge is updating (asked here or anywhere else). */
  get updating(): boolean {
    return this.pendingVersion !== null || this.status?.update?.phase === 'updating';
  }

  /**
   * Update the connected bridge, the way it can be: by itself (`bridge/update`
   * — it stops, installs and comes back) or with the bridge this app carries.
   * Throws the bridge's refusal (a turn running, say) for the caller to show.
   */
  async update(): Promise<void> {
    const offer = this.offer;
    if (!offer || this.updating) return;
    if (offer.via === 'app') {
      const result = await this.install();
      if (result) {
        this.#settle(
          result.ok
            ? { ok: true, version: result.version ?? offer.version ?? '' }
            : { ok: false, version: offer.version ?? '', message: result.error ?? undefined },
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

  /** Install the bridge this app carries and make it the user's service (or
   *  bring it to the app's version). Resolves with how it ended. */
  async install(): Promise<BridgeInstallResult | null> {
    if (this.installing) return null;
    this.installing = true;
    try {
      const result = await invoke<BridgeInstallResult>('bridge_install');
      this.lastResult = result;
      await this.probe();
      return result;
    } catch (err) {
      const message =
        err && typeof err === 'object' && 'message' in err ? String(err.message) : String(err);
      const result: BridgeInstallResult = { ok: false, version: null, rolledBack: false, error: message };
      this.lastResult = result;
      return result;
    } finally {
      this.installing = false;
    }
  }

  /** Remove the bridge this app installed (its service and runtime; never
   *  `~/.uxnan`). Throws the backend's reason when it could not. */
  async uninstall(): Promise<void> {
    if (this.uninstalling) return;
    this.uninstalling = true;
    try {
      await invoke('bridge_uninstall');
      await this.probe();
    } finally {
      this.uninstalling = false;
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
      bundledVersion: this.bundledVersion,
      attemptedFor: this.#autoAttemptedFor,
      installing: this.installing,
    });
    const offer = this.offer;
    if (!due || !offer || !this.status) return;
    // One attempt per target version: a failure is shown, not retried in a loop.
    this.#autoAttemptedFor = offerKey(this.status, offer);
    await this.update().catch(() => undefined);
  }
}

export const bridgeInstall = new BridgeInstallStore(bridge);
