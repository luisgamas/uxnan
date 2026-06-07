/**
 * Persistence of trusted phones (`~/.uxnan/trusted-phones.json`).
 *
 * Stores only non-secret data: the phone's Ed25519 identity public key and
 * metadata. Used to authenticate trusted reconnects and to back the
 * `bridge/trustedDevices` handler.
 */
import type { TrustedDevice } from '@uxnan/shared';
import { DAEMON_FILES, type DaemonState } from '../daemon-state.js';

export interface TrustStore {
  list(): Promise<TrustedDevice[]>;
  get(deviceId: string): Promise<TrustedDevice | null>;
  upsert(device: TrustedDevice): Promise<void>;
  remove(deviceId: string): Promise<boolean>;
}

export class FileTrustStore implements TrustStore {
  readonly #state: DaemonState;

  constructor(state: DaemonState) {
    this.#state = state;
  }

  async list(): Promise<TrustedDevice[]> {
    return (await this.#state.readJson<TrustedDevice[]>(DAEMON_FILES.trustedPhones)) ?? [];
  }

  async get(deviceId: string): Promise<TrustedDevice | null> {
    return (await this.list()).find((d) => d.deviceId === deviceId) ?? null;
  }

  async upsert(device: TrustedDevice): Promise<void> {
    const all = await this.list();
    const index = all.findIndex((d) => d.deviceId === device.deviceId);
    if (index >= 0) {
      all[index] = device;
    } else {
      all.push(device);
    }
    await this.#state.writeJson(DAEMON_FILES.trustedPhones, all);
  }

  async remove(deviceId: string): Promise<boolean> {
    const all = await this.list();
    const next = all.filter((d) => d.deviceId !== deviceId);
    if (next.length === all.length) return false;
    await this.#state.writeJson(DAEMON_FILES.trustedPhones, next);
    return true;
  }
}
