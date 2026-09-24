// The window's side of the bridge connection (`bridgeclient` in Rust).
//
// The backend owns the socket and the token; this store only mirrors the
// connection status (`bridge:status`), fans the bridge's JSON-RPC
// notifications (`bridge:notification`) out to whoever listens, and calls
// methods through the one `bridge_call` command. Architecture/02a §5.8.15.

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { BridgeClientStatus } from '$lib/types';

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
  status = $state<BridgeClientStatus>({ state: 'off' });
  connected = $derived(this.status.state === 'connected');

  #notificationListeners = new Set<NotificationListener>();
  #connectedListeners = new Set<ConnectedListener>();
  #started = false;

  /** Hydrate the status and subscribe to the backend's events (once). */
  async start(): Promise<void> {
    if (this.#started) return;
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
      return await invoke<T>('bridge_call', { method, params: params ?? null });
    } catch (err) {
      throw asCallError(err);
    }
  }

  /** Try to connect now instead of waiting out the backoff. */
  async retry(): Promise<void> {
    try {
      await invoke('bridge_client_retry');
    } catch {
      /* no backend */
    }
  }
}

export const bridge = new BridgeClientStore();
