// Getting the Uxnan bridge onto this machine — and keeping it current — from
// inside the app (`bridgeclient/install.rs`). The user never has to leave Uxnan
// to make chats work: the window offers to install it, shows npm's output while
// it runs, and falls back to the command to copy when npm cannot do it.
//
// Versions: the running bridge reports its own and the newest published one
// (`bridge/status` → `version`, `latestVersion`, `updateAvailable`), the same
// fields the phone reads for its "bridge update available" hint.

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { BridgeStatus } from '$shared/models/session';
import type { BridgeInstallInfo, BridgeInstallResult } from '$lib/types';
import { errorMessage } from '$lib/toast';
import { bridge, type BridgeClientStore } from './client.svelte';

/** Lines of npm output kept for the progress view. */
const LOG_LINES = 200;
/** How often a connected bridge's version facts are re-read. */
const STATUS_REFRESH_MS = 30 * 60 * 1000;

/** Whether an automatic update may run now. Pure, so the policy is testable. */
export function autoUpdateDue(input: {
  enabled: boolean;
  /** This app started the bridge (it can restart it on the new version). */
  managed: boolean;
  status: Pick<BridgeStatus, 'updateAvailable' | 'latestVersion' | 'activeTurns'> | null;
  /** The version an automatic update was already attempted for. */
  attemptedFor: string | null;
  installing: boolean;
}): boolean {
  const { enabled, managed, status, attemptedFor, installing } = input;
  if (!enabled || !managed || installing || !status?.updateAvailable) return false;
  if (!status.latestVersion || status.latestVersion === attemptedFor) return false;
  // Never restart the bridge under someone's running turn — phone included.
  return (status.activeTurns ?? 0) === 0;
}

export class BridgeInstallStore {
  readonly #client: BridgeClientStore;
  info = $state<BridgeInstallInfo | null>(null);
  probing = $state(false);
  installing = $state(false);
  restarting = $state(false);
  log = $state<string[]>([]);
  lastResult = $state<BridgeInstallResult | null>(null);
  /** The running bridge's `bridge/status`, when connected. */
  status = $state<BridgeStatus | null>(null);
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

  /** Re-read the running bridge's version facts. */
  async refreshStatus(): Promise<void> {
    if (!this.#client.connected) {
      this.status = null;
      return;
    }
    try {
      this.status = await this.#client.call<BridgeStatus>('bridge/status');
    } catch {
      this.status = null;
      return;
    }
    await this.maybeAutoUpdate(this.#autoUpdateEnabled());
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
    if (!due || !this.status?.latestVersion) return;
    // One attempt per published version: a failure is shown, not retried in a loop.
    this.#autoAttemptedFor = this.status.latestVersion;
    await this.install();
  }

  #append(line: string): void {
    const next = [...this.log, line];
    this.log = next.length > LOG_LINES ? next.slice(next.length - LOG_LINES) : next;
  }
}

export const bridgeInstall = new BridgeInstallStore(bridge);
