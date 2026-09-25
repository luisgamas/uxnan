/**
 * In-memory registry of active mobile sessions.
 *
 * Every phone that connects or leaves is also reported to the
 * {@link PresenceRegistry}, so presence (`stream/presence/updated`) can never
 * disagree with the phones this list holds — whichever path adds or removes one
 * (a session ending, `bridge/disconnectPhone`, a revoked device).
 *
 * Source: architecture/02a-system-architecture.md §5.8.2 (session-state).
 */
import type { ConnectedPhone } from '@uxnan/shared';
import type { PresenceRegistry } from './presence/presence-registry.js';

export class SessionState {
  readonly #sessions = new Map<string, ConnectedPhone>();
  readonly #presence: PresenceRegistry | undefined;

  constructor(presence?: PresenceRegistry) {
    this.#presence = presence;
  }

  add(phone: ConnectedPhone): void {
    this.#sessions.set(phone.deviceId, phone);
    this.#presence?.connected({
      id: phone.deviceId,
      kind: 'phone',
      name: phone.displayName,
      since: phone.connectedAt,
    });
  }

  /** A connected phone was renamed: it shows under [name] from now on. */
  rename(deviceId: string, name: string): void {
    const phone = this.#sessions.get(deviceId);
    if (!phone || phone.displayName === name) return;
    this.add({ ...phone, displayName: name });
  }

  remove(deviceId: string): boolean {
    const removed = this.#sessions.delete(deviceId);
    if (removed) this.#presence?.disconnected(deviceId);
    return removed;
  }

  get(deviceId: string): ConnectedPhone | undefined {
    return this.#sessions.get(deviceId);
  }

  list(): ConnectedPhone[] {
    return [...this.#sessions.values()];
  }

  get count(): number {
    return this.#sessions.size;
  }
}
