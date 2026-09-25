/**
 * Settings the bridge shares with every client (architecture/02a §5.8.17).
 *
 * Today that is the start folder, `home`: where exploring for a new project
 * begins, whatever directory `uxnan-bridge start` ran in — so a user who keeps
 * every project under one folder points the bridge there once, and the phone
 * and the desktop both start browsing from it. It lives in `daemon-config.json`
 * (`home`), so the bridge's own CLI edits the same value the clients do, and a
 * change takes a sync revision and is announced to every client.
 */
import { stat, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';
import { JsonRpcErrorCode, RpcError, type BridgeSettings } from '@uxnan/shared';
import type { DaemonConfig } from '../daemon-config.js';
import type { DaemonState } from '../daemon-state.js';
import type { SyncLedger } from '../sync/sync-ledger.js';

/** The ledger mark the shared settings' revision is kept under. */
export const SETTINGS_MARK = 'settings';

export interface SettingsChange {
  settings: BridgeSettings;
  rev: number;
}

/**
 * The start folder a config asks for, or the user's home directory. Not
 * canonicalized here: this is what `start` reads before anything async runs.
 */
export function configuredHome(config: Pick<DaemonConfig, 'home'>): string {
  const home = config.home?.trim();
  return home && home.length > 0 ? resolve(home) : homedir();
}

/**
 * Check a requested start folder: an absolute path to an existing directory,
 * returned with its symlinks resolved. Throws `InvalidParams` otherwise.
 */
export async function validateHome(path: string): Promise<string> {
  const trimmed = path.trim();
  if (!isAbsolute(trimmed)) {
    throw RpcError.invalidParams('home must be an absolute path');
  }
  try {
    const info = await stat(trimmed);
    if (!info.isDirectory()) throw new Error('not a directory');
    return await realpath(trimmed);
  } catch {
    throw new RpcError(JsonRpcErrorCode.InvalidParams, `not a folder: ${trimmed}`);
  }
}

export class BridgeSettingsStore {
  readonly #state: DaemonState;
  readonly #ledger: SyncLedger;
  readonly #listeners = new Set<(change: SettingsChange) => void>();
  #settings: BridgeSettings;
  #lock: Promise<unknown> = Promise.resolve();

  constructor(options: { state: DaemonState; ledger: SyncLedger; config: DaemonConfig }) {
    this.#state = options.state;
    this.#ledger = options.ledger;
    this.#settings = { home: configuredHome(options.config) };
  }

  get(): BridgeSettings {
    return { ...this.#settings };
  }

  /** The revision the settings last changed at. */
  get rev(): number {
    return this.#ledger.mark(SETTINGS_MARK);
  }

  onChange(listener: (change: SettingsChange) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Change the start folder, persist it, and announce it. */
  setHome(path: string): Promise<BridgeSettings> {
    const run = this.#lock.then(async () => {
      const home = await validateHome(path);
      if (home === this.#settings.home) return this.get();
      const config = await this.#state.readConfig();
      await this.#state.writeConfig({ ...config, home });
      this.#settings = { ...this.#settings, home };
      const rev = this.#ledger.stamp(SETTINGS_MARK);
      await this.#ledger.flush();
      const change = { settings: this.get(), rev };
      for (const listener of this.#listeners) {
        try {
          listener(change);
        } catch {
          /* a listener's failure is its own */
        }
      }
      return this.get();
    });
    this.#lock = run.catch(() => undefined);
    return run;
  }
}
