/**
 * The paired phones (`~/.uxnan/trusted-phones.json`): who may reconnect, and
 * what every client calls each one (architecture/02a §5.8.17).
 *
 * Stores only non-secret data: the phone's Ed25519 identity public key and
 * metadata. Used to authenticate trusted reconnects and to back
 * `bridge/trustedDevices`, `device/describe` and `device/rename`.
 *
 * A phone describes itself when it connects (name, model, platform); a person
 * may rename it on any client. The latest *decision* on its name wins — a
 * rename on the desktop, or one the phone's owner made on the phone, even
 * offline — and the phone's own default never overrides a person's choice.
 * Every change is announced (`onChange`) once it is on disk.
 */
import {
  JsonRpcErrorCode,
  RpcError,
  type DeviceDescribeParams,
  type DeviceDescription,
  type TrustedDevice,
} from '@uxnan/shared';
import { DAEMON_FILES, type DaemonState } from '../daemon-state.js';

/** A phone as kept on disk: its public record plus what only the bridge needs. */
interface StoredDevice extends TrustedDevice {
  /** What the phone last called itself (restored by an empty rename). */
  describedName?: string;
  /** When a person last decided its name, on the bridge's clock. */
  nameDecidedAt?: number;
}

export interface TrustStore {
  list(): Promise<TrustedDevice[]>;
  get(deviceId: string): Promise<TrustedDevice | null>;
  /** Pair (or re-pair) a phone. A re-paired phone keeps its name. */
  upsert(device: TrustedDevice): Promise<void>;
  remove(deviceId: string): Promise<boolean>;
  /**
   * A phone describing itself: its details replace the stored ones; its name
   * applies unless a person decided one later than [nameAt] (or at all, when
   * [nameAt] is absent — the phone's default). Resolves the record as it
   * stands and how long ago (at [now]) its name was decided.
   */
  describe(
    deviceId: string,
    params: DeviceDescribeParams,
    now: number,
    nameAt?: number,
  ): Promise<DeviceDescription>;
  /**
   * A person naming a phone, decided at [at]. Applies only if nobody decided
   * its name later; an empty name goes back to what the phone calls itself.
   */
  rename(deviceId: string, name: string, at: number): Promise<TrustedDevice>;
  /** Listen for any change to the list (after it is on disk). */
  onChange(listener: (devices: TrustedDevice[]) => void): () => void;
}

/** Longest phone name accepted. */
export const MAX_DEVICE_NAME_LENGTH = 80;

function unknownDevice(deviceId: string): RpcError {
  return new RpcError(JsonRpcErrorCode.ResourceNotFound, `no paired phone ${deviceId}`);
}

/** The public record: what clients see. */
function toPublic(device: StoredDevice): TrustedDevice {
  const { describedName: _described, nameDecidedAt: _decided, ...record } = device;
  return record;
}

export class FileTrustStore implements TrustStore {
  readonly #state: DaemonState;
  readonly #listeners = new Set<(devices: TrustedDevice[]) => void>();
  #lock: Promise<unknown> = Promise.resolve();

  constructor(state: DaemonState) {
    this.#state = state;
  }

  async list(): Promise<TrustedDevice[]> {
    return (await this.#read()).map(toPublic);
  }

  async get(deviceId: string): Promise<TrustedDevice | null> {
    const device = (await this.#read()).find((d) => d.deviceId === deviceId);
    return device ? toPublic(device) : null;
  }

  upsert(device: TrustedDevice): Promise<void> {
    return this.#mutate((all) => {
      const index = all.findIndex((d) => d.deviceId === device.deviceId);
      const existing = index >= 0 ? all[index] : undefined;
      // Re-pairing proves the same phone again: what it is called stays.
      const next: StoredDevice = existing
        ? { ...existing, ...device, displayName: existing.displayName }
        : { ...device };
      if (index >= 0) all[index] = next;
      else all.push(next);
      return { result: undefined, changed: true };
    });
  }

  remove(deviceId: string): Promise<boolean> {
    return this.#mutate((all) => {
      const index = all.findIndex((d) => d.deviceId === deviceId);
      if (index === -1) return { result: false, changed: false };
      all.splice(index, 1);
      return { result: true, changed: true };
    });
  }

  describe(
    deviceId: string,
    params: DeviceDescribeParams,
    now: number,
    nameAt?: number,
  ): Promise<DeviceDescription> {
    return this.#mutate((all) => {
      const device = all.find((d) => d.deviceId === deviceId);
      if (!device) throw unknownDevice(deviceId);
      const before = JSON.stringify(device);
      device.describedName = params.name;
      if (params.model !== undefined) device.model = params.model;
      if (params.platform !== undefined) device.platform = params.platform;
      if (params.osVersion !== undefined) device.osVersion = params.osVersion;
      if (params.appVersion !== undefined) device.appVersion = params.appVersion;
      if (nameAt !== undefined) {
        // The owner named it on the phone: the latest decision wins.
        if (device.nameDecidedAt === undefined || nameAt >= device.nameDecidedAt) {
          device.displayName = params.name;
          device.nameSource = 'user';
          device.nameDecidedAt = nameAt;
        }
      } else if (device.nameDecidedAt === undefined) {
        // Nobody named it: it goes by what it calls itself.
        device.displayName = params.name;
        device.nameSource = 'device';
      }
      const result: DeviceDescription = {
        device: toPublic(device),
        ...(device.nameDecidedAt !== undefined
          ? { nameAgeMs: Math.max(0, now - device.nameDecidedAt) }
          : {}),
      };
      return { result, changed: JSON.stringify(device) !== before };
    });
  }

  rename(deviceId: string, name: string, at: number): Promise<TrustedDevice> {
    return this.#mutate((all) => {
      const device = all.find((d) => d.deviceId === deviceId);
      if (!device) throw unknownDevice(deviceId);
      if (device.nameDecidedAt !== undefined && at < device.nameDecidedAt) {
        return { result: toPublic(device), changed: false };
      }
      if (name.length === 0) {
        // Back to what the phone calls itself; no person's choice stands.
        device.displayName = device.describedName ?? device.displayName;
        device.nameSource = 'device';
      } else {
        device.displayName = name;
        device.nameSource = 'user';
      }
      device.nameDecidedAt = at;
      return { result: toPublic(device), changed: true };
    });
  }

  onChange(listener: (devices: TrustedDevice[]) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async #read(): Promise<StoredDevice[]> {
    return (await this.#state.readJson<StoredDevice[]>(DAEMON_FILES.trustedPhones)) ?? [];
  }

  /** Serialized read-modify-write; announces once the change is on disk. */
  #mutate<T>(fn: (all: StoredDevice[]) => { result: T; changed: boolean }): Promise<T> {
    const run = this.#lock.then(async () => {
      const all = await this.#read();
      const { result, changed } = fn(all);
      if (changed) {
        await this.#state.writeJson(DAEMON_FILES.trustedPhones, all);
        const devices = all.map(toPublic);
        for (const listener of this.#listeners) {
          try {
            listener(devices);
          } catch {
            /* a listener's failure is its own */
          }
        }
      }
      return result;
    });
    this.#lock = run.catch(() => undefined);
    return run;
  }
}
