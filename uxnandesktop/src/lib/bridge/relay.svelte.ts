// The user's own relay, as this window sees it (Settings → Bridge & mobile →
// Remote access).
//
// The bridge owns the relay: it deploys the Worker into the user's Cloudflare
// account, holds its control socket and reports how it stands
// (architecture/02a §5.10). This window is a client of it like the phone and
// the CLI — it never calls Cloudflare and never keeps a relay setting of its
// own. This store is the one replica of `RelayStatus` on the desktop: fed by
// `relay/status` on every (re)connect and by `stream/relay/updated`, and the
// answer of every `relay/*` call (each returns the whole status) lands through
// the same `#adopt`. Nothing else writes it.
//
// A Cloudflare API token passes through here only as a call's parameter. It is
// never stored on this object, never logged, and the caller clears its field
// right after the call.

import type {
  RelayRemoveParams,
  RelayStatus,
  RelayUpdatedNotification,
} from '$shared/models/relay';
import { bridge, isUnknownMethodError, type BridgeClientStore, type BridgeNotification } from './client.svelte';

/** The notification that carries the whole status. */
export const RELAY_UPDATED = 'stream/relay/updated';

/** Whether `value` is shaped like a `RelayStatus` — payloads cross a process
 *  boundary, so they are checked, not trusted. */
export function isRelayStatus(value: unknown): value is RelayStatus {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<RelayStatus>;
  const endpointOk =
    v.endpoint === null ||
    (!!v.endpoint &&
      typeof v.endpoint === 'object' &&
      typeof v.endpoint.url === 'string' &&
      typeof v.endpoint.enabled === 'boolean');
  return (
    endpointOk &&
    typeof v.state === 'string' &&
    typeof v.bundledVersion === 'string' &&
    typeof v.tokenRemembered === 'boolean' &&
    typeof v.connectedPhones === 'number' &&
    typeof v.hostKey === 'string'
  );
}

/**
 * The relay this bridge deployed runs an older Worker than the one it ships,
 * so `relay/update` has something to deploy. Only a relay the bridge deployed
 * (`cloudflare`) can be updated from here; one deployed by hand is updated
 * where it was deployed.
 */
export function relayUpdateAvailable(status: RelayStatus | null): boolean {
  if (!status?.endpoint || status.provider === 'custom') return false;
  return status.deployedVersion !== status.bundledVersion;
}

export class RelayStore {
  readonly #client: BridgeClientStore;
  /** The relay as the bridge last described it; `null` until it answered. */
  status = $state<RelayStatus | null>(null);
  /** `false` when the connected bridge predates `relay/*` (an update helps). */
  supported = $state(true);
  /** `relay/status` is in flight after a (re)connect. */
  loading = $state(false);
  #started = false;
  /** Bumped by every notification adopted, so a `relay/status` answer that
   *  crossed one in flight does not undo it (notifications and call answers
   *  reach the window on different channels, in no guaranteed order). */
  #notified = 0;

  constructor(client: BridgeClientStore) {
    this.#client = client;
  }

  /** Subscribe to the bridge (once). Safe to call before it is connected. */
  start(): void {
    if (this.#started) return;
    this.#started = true;
    this.#client.onNotification((n) => this.apply(n));
    this.#client.onConnected(() => void this.load());
    if (this.#client.connected) void this.load();
  }

  /** Ask the bridge how the relay stands — every (re)connect, since a
   *  notification may have been missed while away. */
  async load(): Promise<void> {
    this.loading = true;
    const seen = this.#notified;
    try {
      const status = await this.#client.call<RelayStatus>('relay/status');
      if (seen === this.#notified) this.#adopt(status);
      this.supported = true;
    } catch (err) {
      // A bridge too old to own a relay answers "method not found"; anything
      // else (not connected, a timeout) leaves what was known.
      if (isUnknownMethodError(err)) {
        this.supported = false;
        this.status = null;
      }
    } finally {
      this.loading = false;
    }
  }

  /** Route one bridge notification. */
  apply(notification: BridgeNotification): void {
    if (notification.method !== RELAY_UPDATED) return;
    const status = (notification.params as RelayUpdatedNotification | undefined)?.status;
    if (!this.#adopt(status)) return;
    this.#notified += 1;
    this.supported = true;
  }

  /** Deploy the relay into the user's Cloudflare account (can take a minute). */
  setup(accountId: string, apiToken: string, remember: boolean): Promise<RelayStatus | null> {
    return this.#call('relay/setup', { provider: 'cloudflare', accountId, apiToken, remember });
  }

  /** Use a relay the user deployed by hand. */
  use(url: string): Promise<RelayStatus | null> {
    return this.#call('relay/use', { url });
  }

  /** Serve phones through the relay, or stop. */
  setEnabled(enabled: boolean): Promise<RelayStatus | null> {
    return this.#call('relay/set', { enabled });
  }

  /** Deploy the Worker this bridge ships over the one in the account. A
   *  remembered token is used when `apiToken` is left out. */
  update(apiToken?: string, remember?: boolean): Promise<RelayStatus | null> {
    return this.#call('relay/update', {
      ...(apiToken !== undefined ? { apiToken } : {}),
      ...(remember !== undefined ? { remember } : {}),
    });
  }

  /** A new address: phones away from home reach it after their next sync. */
  rotate(): Promise<RelayStatus | null> {
    return this.#call('relay/rotate');
  }

  /** Stop using the relay; optionally delete it from Cloudflare too. */
  remove(params: RelayRemoveParams): Promise<RelayStatus | null> {
    return this.#call('relay/remove', params);
  }

  async #call(method: string, params?: unknown): Promise<RelayStatus | null> {
    const result = await this.#client.call<RelayStatus>(method, params);
    this.#adopt(result);
    return this.status;
  }

  /** The one writer: a whole status replaces the last one. */
  #adopt(value: unknown): boolean {
    if (!isRelayStatus(value)) return false;
    this.status = value;
    return true;
  }
}

export const relay = new RelayStore(bridge);
