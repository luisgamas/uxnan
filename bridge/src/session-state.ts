/**
 * In-memory registry of active mobile sessions.
 *
 * Source: architecture/02a-system-architecture.md §5.8.2 (session-state).
 */
import type { ConnectedPhone } from '@uxnan/shared';

export class SessionState {
  readonly #sessions = new Map<string, ConnectedPhone>();

  add(phone: ConnectedPhone): void {
    this.#sessions.set(phone.deviceId, phone);
  }

  remove(deviceId: string): boolean {
    return this.#sessions.delete(deviceId);
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
