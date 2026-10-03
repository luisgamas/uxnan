/**
 * Settings the bridge shares with every client (architecture/02a §5.8.17).
 *
 * - `home`, the start folder: where exploring for a new project begins,
 *   whatever directory `uxnan-bridge start` ran in — so a user who keeps every
 *   project under one folder points the bridge there once, and the phone and
 *   the desktop both start browsing from it.
 * - `name`, what every client calls this PC — the machine's own name until
 *   someone renames it, on any client.
 * - `relay`, where a phone reaches this PC from another network — set only by
 *   the relay service (`relay/*`), never by `settings/set`, so a phone paired
 *   on the LAN learns it and can leave home without pairing again.
 *
 * All three live in `daemon-config.json`, so the bridge's own CLI edits the same
 * values the clients do; a change takes a sync revision and is announced to
 * every client. When each was last decided is kept beside them
 * (`settings-decided.json`), so a change a client made offline and sends late
 * (`ageMs`) is applied only if nobody changed the same setting since.
 */
import { stat, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';
import { JsonRpcErrorCode, RpcError, type BridgeSettings, type RelayEndpoint } from '@uxnan/shared';
import type { DaemonConfig } from '../daemon-config.js';
import { DAEMON_FILES, type DaemonState } from '../daemon-state.js';
import { machineName } from '../presence/host-info.js';
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

/** The PC name a config asks for, or the machine's own name. */
export function configuredName(config: Pick<DaemonConfig, 'name'>): string {
  const name = config.name?.trim();
  return name && name.length > 0 ? name : machineName();
}

/** Longest PC name accepted. */
const MAX_NAME_LENGTH = 80;

/** A requested PC name, trimmed; empty means "the machine's own name". */
export function validateName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length > MAX_NAME_LENGTH || /[\u0000-\u001f\u007f]/.test(trimmed)) {
    throw RpcError.invalidParams(`name must be at most ${MAX_NAME_LENGTH} printable characters`);
  }
  return trimmed;
}

/** A change to the shared settings; each field left out stays as it is. */
export interface SettingsChangeRequest {
  home?: string;
  name?: string;
  /** Only the relay service sets this (`null` removes the relay). */
  relay?: RelayEndpoint | null;
}

type DecidedAt = Partial<Record<keyof BridgeSettings, number>>;

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
  #decidedAt: DecidedAt = {};
  #lock: Promise<unknown> = Promise.resolve();

  constructor(options: {
    state: DaemonState;
    ledger: SyncLedger;
    config: DaemonConfig;
    /** Where the bridge listens right now (see {@link setHosts}). */
    hosts?: string[];
  }) {
    this.#state = options.state;
    this.#ledger = options.ledger;
    this.#settings = {
      home: configuredHome(options.config),
      name: configuredName(options.config),
      relay: options.config.relay ?? null,
      hosts: [...(options.hosts ?? [])],
    };
  }

  /** Read when each setting was last decided. Call once at startup. */
  async load(): Promise<void> {
    this.#decidedAt = (await this.#state.readJson<DecidedAt>(DAEMON_FILES.settingsDecided)) ?? {};
  }

  get(): BridgeSettings {
    const relay = this.#settings.relay;
    return {
      ...this.#settings,
      relay: relay ? { ...relay } : null,
      hosts: [...this.#settings.hosts],
    };
  }

  /**
   * The addresses the bridge listens on changed (the PC joined another network).
   * A live fact, never stored: it takes a revision and is announced, so every
   * paired phone converges on it — over the relay too, which is how a phone that
   * fell back to the relay learns where to reach its PC directly.
   */
  setHosts(hosts: string[]): Promise<BridgeSettings> {
    const run = this.#lock.then(async () => {
      const next = [...new Set(hosts)].sort();
      const current = this.#settings.hosts;
      if (next.length === current.length && next.every((h, i) => h === current[i])) {
        return this.get();
      }
      this.#settings = { ...this.#settings, hosts: next };
      const rev = this.#ledger.stamp(SETTINGS_MARK);
      await this.#ledger.flush();
      this.#announce({ settings: this.get(), rev });
      return this.get();
    });
    this.#lock = run.catch(() => undefined);
    return run;
  }

  /** The revision the settings last changed at. */
  get rev(): number {
    return this.#ledger.mark(SETTINGS_MARK);
  }

  onChange(listener: (change: SettingsChange) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /**
   * Change the settings named in [request], decided at [at] (now, unless a
   * client sends a change it made offline): each one applies only if nobody
   * decided it later. Persists, then announces once.
   */
  set(request: SettingsChangeRequest, at: number): Promise<BridgeSettings> {
    const run = this.#lock.then(async () => {
      const next: Partial<BridgeSettings> = {};
      const stored: Partial<Pick<DaemonConfig, 'home' | 'name' | 'relay'>> = {};
      if (request.home !== undefined && this.#isLatest('home', at)) {
        next.home = await validateHome(request.home);
        stored.home = next.home;
      }
      if (request.name !== undefined && this.#isLatest('name', at)) {
        const name = validateName(request.name);
        next.name = name.length > 0 ? name : machineName();
        // Empty restores the machine's name: nothing is kept in the config.
        stored.name = name.length > 0 ? name : undefined;
      }
      if (request.relay !== undefined && this.#isLatest('relay', at)) {
        next.relay = request.relay;
        stored.relay = request.relay ?? undefined;
      }
      const decided = Object.keys(next) as (keyof BridgeSettings)[];
      if (decided.length === 0) return this.get();
      for (const key of decided) this.#decidedAt[key] = at;
      await this.#state.writeJson(DAEMON_FILES.settingsDecided, this.#decidedAt);
      const changed = decided.filter(
        (key) => JSON.stringify(next[key]) !== JSON.stringify(this.#settings[key]),
      );
      if (changed.length === 0) return this.get();
      const config = await this.#state.readConfig();
      const written: DaemonConfig = { ...config, ...stored };
      // `undefined` drops the key: a removed relay leaves nothing behind.
      if ('relay' in stored && stored.relay === undefined) delete written.relay;
      await this.#state.writeConfig(written);
      this.#settings = { ...this.#settings, ...next };
      const rev = this.#ledger.stamp(SETTINGS_MARK);
      await this.#ledger.flush();
      this.#announce({ settings: this.get(), rev });
      return this.get();
    });
    this.#lock = run.catch(() => undefined);
    return run;
  }

  #announce(change: SettingsChange): void {
    for (const listener of this.#listeners) {
      try {
        listener(change);
      } catch {
        /* a listener's failure is its own */
      }
    }
  }

  #isLatest(key: keyof BridgeSettings, at: number): boolean {
    const previous = this.#decidedAt[key];
    return previous === undefined || at >= previous;
  }
}
