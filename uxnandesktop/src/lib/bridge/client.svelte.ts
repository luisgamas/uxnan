// The window's side of the bridge connections (`bridgeclient` in Rust).
//
// The backend owns the sockets and the tokens; a store only mirrors one
// bridge's connection status, fans its JSON-RPC notifications out to whoever
// listens, and calls its methods through the one `bridge_call` command.
// Architecture/02a §5.8.15.
//
// There is one store per machine with a bridge: this one's (`bridge`), and the
// own bridge of each connected host that runs one (`bridges.for("ssh:<id>")`,
// `02g` §5.18). The local store hears `bridge:status` / `bridge:notification`;
// the hosts' arrive together as `bridge:host-status` / `bridge:host-notification`
// and the registry hands each to its host's store.

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { BridgeClientStatus } from '$lib/types';
import { isLocalTarget, LOCAL_TARGET, sshHostId, type TargetId } from '$lib/target';

/** A JSON-RPC notification as the bridge sent it. */
export interface BridgeNotification {
  method: string;
  params?: unknown;
}

type NotificationListener = (notification: BridgeNotification) => void;
type ConnectedListener = () => void;

/** Error thrown by {@link BridgeClientStore.call}; `code` is the backend's. */
export class BridgeCallError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'BridgeCallError';
  }
}

function asCallError(err: unknown): BridgeCallError {
  if (err && typeof err === 'object' && 'message' in err) {
    const e = err as { message?: unknown; code?: unknown };
    return new BridgeCallError(
      typeof e.message === 'string' ? e.message : 'bridge call failed',
      typeof e.code === 'string' ? e.code : 'BRIDGE_ERROR',
    );
  }
  return new BridgeCallError(typeof err === 'string' ? err : 'bridge call failed', 'BRIDGE_ERROR');
}

/** The JSON-RPC error code the backend appends to a bridge error's message
 *  (`"<message> (<code>)"`, `bridgeclient::connection::CallError`). */
const RPC_CODE_SUFFIX = /\s*\((-?\d+)\)$/;

/** The bridge answered "method not found" (-32601): it predates the method. */
export function isUnknownMethodError(err: unknown): boolean {
  const message =
    err && typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message) : '';
  return RPC_CODE_SUFFIX.exec(message)?.[1] === '-32601';
}

/** A bridge error as a person reads it: the bridge's own words, without the
 *  numeric JSON-RPC code the transport appends. */
export function bridgeErrorText(err: unknown): string {
  const message =
    err && typeof err === 'object' && 'message' in err
      ? String((err as { message: unknown }).message)
      : String(err);
  return message.replace(RPC_CODE_SUFFIX, '');
}

/** Whether `value` is shaped like a JSON-RPC notification. Payloads cross a
 *  process boundary, so they are checked, not trusted. */
export function isNotification(value: unknown): value is BridgeNotification {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as { method?: unknown }).method === 'string'
  );
}

export class BridgeClientStore {
  /** The machine whose bridge this is. */
  readonly target: TargetId;
  status = $state<BridgeClientStatus>({ state: 'off' });
  connected = $derived(this.status.state === 'connected');

  #notificationListeners = new Set<NotificationListener>();
  #connectedListeners = new Set<ConnectedListener>();
  #started = false;

  constructor(target: TargetId = LOCAL_TARGET) {
    this.target = target;
  }

  /** Hydrate the status and subscribe to the backend's events (once). This
   *  machine's bridge only: a host's store is fed by {@link BridgeRegistry}. */
  async start(): Promise<void> {
    if (this.#started || !isLocalTarget(this.target)) return;
    this.#started = true;
    try {
      await listen<BridgeClientStatus>('bridge:status', (e) => this.applyStatus(e.payload));
      await listen<unknown>('bridge:notification', (e) => this.dispatch(e.payload));
      this.applyStatus(await invoke<BridgeClientStatus>('bridge_client_status'));
    } catch {
      // No backend (plain web preview): stay `off`.
    }
  }

  /** Adopt a status; a transition INTO connected tells every listener to
   *  resync (a new connection may be a restarted bridge). */
  applyStatus(next: BridgeClientStatus): void {
    const wasConnected = this.status.state === 'connected';
    this.status = next;
    if (next.state === 'connected' && !wasConnected) {
      for (const listener of this.#connectedListeners) listener();
    }
  }

  /** Deliver one notification to every listener. Malformed payloads are dropped. */
  dispatch(payload: unknown): void {
    if (!isNotification(payload)) return;
    for (const listener of this.#notificationListeners) listener(payload);
  }

  /** Subscribe to bridge notifications; returns the unsubscribe. */
  onNotification(listener: NotificationListener): () => void {
    this.#notificationListeners.add(listener);
    return () => this.#notificationListeners.delete(listener);
  }

  /** Called every time the connection is (re)established; returns the unsubscribe. */
  onConnected(listener: ConnectedListener): () => void {
    this.#connectedListeners.add(listener);
    return () => this.#connectedListeners.delete(listener);
  }

  /** Call a bridge method. Throws {@link BridgeCallError}. */
  async call<T = unknown>(method: string, params?: unknown): Promise<T> {
    try {
      return await invoke<T>(
        'bridge_call',
        isLocalTarget(this.target)
          ? { method, params: params ?? null }
          : { method, params: params ?? null, target: this.target },
      );
    } catch (err) {
      throw asCallError(err);
    }
  }

  /** Try to connect now instead of waiting out the backoff. */
  async retry(): Promise<void> {
    const host = sshHostId(this.target);
    try {
      if (host) await invoke('bridge_host_retry', { hostId: host });
      else await invoke('bridge_client_retry');
    } catch {
      /* no backend */
    }
  }
}

export const bridge = new BridgeClientStore();

/** One host bridge's status, as `bridge:host-status` carries it. */
interface HostStatus {
  hostId: string;
  status: BridgeClientStatus;
}

/** Every bridge the window knows: this machine's, and each host's own. */
export class BridgeRegistry {
  readonly local: BridgeClientStore;
  // Plain maps on purpose: a store is created on first ask, which a derived
  // value may do; only each store's own status is reactive.
  readonly #hosts = new Map<string, BridgeClientStore>();
  readonly #createdListeners = new Set<(store: BridgeClientStore) => void>();
  #started = false;

  constructor(local: BridgeClientStore) {
    this.local = local;
  }

  /** The bridge of the machine `target` names (this one's when unset). */
  for(target: TargetId | null | undefined): BridgeClientStore {
    const host = sshHostId(target);
    if (!host) return this.local;
    let store = this.#hosts.get(host);
    if (!store) {
      store = new BridgeClientStore(`ssh:${host}`);
      this.#hosts.set(host, store);
      for (const listener of this.#createdListeners) listener(store);
    }
    return store;
  }

  /** Whether a chat can be offered for a folder on `target`: always on this
   *  machine (its pane says what the bridge needs), and on a host while its
   *  own bridge is connected — a host with none has nowhere to run one. Never
   *  creates a store, so it is safe in a derived value. */
  offersChat(target: TargetId | null | undefined): boolean {
    const host = sshHostId(target);
    return host === null || this.#hosts.get(host)?.connected === true;
  }

  /** The host stores known so far. */
  hosts(): BridgeClientStore[] {
    return [...this.#hosts.values()];
  }

  /** Hear about every host store as it is created (and the ones already
   *  there), so whatever replicates a bridge can attach to it. */
  onHostStore(listener: (store: BridgeClientStore) => void): () => void {
    this.#createdListeners.add(listener);
    for (const store of this.#hosts.values()) listener(store);
    return () => this.#createdListeners.delete(listener);
  }

  /** Subscribe to the hosts' events and hydrate their statuses (once). */
  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    try {
      await listen<HostStatus>('bridge:host-status', (e) => this.#applyHost(e.payload));
      await listen<{ hostId?: unknown; message?: unknown }>('bridge:host-notification', (e) => {
        const host = e.payload?.hostId;
        if (typeof host === 'string' && host) this.for(`ssh:${host}`).dispatch(e.payload.message);
      });
      for (const status of await invoke<HostStatus[]>('bridge_hosts_status')) this.#applyHost(status);
    } catch {
      // No backend (plain web preview): no hosts.
    }
  }

  #applyHost(payload: HostStatus | null | undefined): void {
    if (!payload || typeof payload.hostId !== 'string' || !payload.hostId || !payload.status) return;
    this.for(`ssh:${payload.hostId}`).applyStatus(payload.status);
  }
}

export const bridges = new BridgeRegistry(bridge);
