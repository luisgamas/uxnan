/**
 * Who is connected to the bridge right now — every paired phone and Uxnan
 * Desktop on the local channel (architecture/02a §5.8.17).
 *
 * The phone shows it as "Linked with Uxnan Desktop on <machine>" and the desktop
 * as the phones currently connected, so each side knows the other is there
 * instead of guessing. Live only: presence is not revisioned, because a client
 * reconnecting learns the current list from `sync/changes` and `bridge/status`.
 */
import type { ClientKind, ClientPresence } from '@uxnan/shared';

export class PresenceRegistry {
  readonly #clients = new Map<string, ClientPresence>();
  readonly #listeners = new Set<(clients: ClientPresence[]) => void>();

  list(): ClientPresence[] {
    return [...this.#clients.values()].sort((a, b) => a.since - b.since);
  }

  /** Whether a client of [kind] is connected. */
  has(kind: ClientKind): boolean {
    for (const client of this.#clients.values()) if (client.kind === kind) return true;
    return false;
  }

  onChange(listener: (clients: ClientPresence[]) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  connected(client: ClientPresence): void {
    const current = this.#clients.get(client.id);
    if (current && current.kind === client.kind && current.name === client.name) return;
    this.#clients.set(client.id, { ...client, since: current?.since ?? client.since });
    this.#emit();
  }

  /** Every connected client of [kind] now goes by [name]. */
  rename(kind: ClientKind, name: string): void {
    let changed = false;
    for (const [id, client] of this.#clients) {
      if (client.kind !== kind || client.name === name) continue;
      this.#clients.set(id, { ...client, name });
      changed = true;
    }
    if (changed) this.#emit();
  }

  disconnected(id: string): void {
    if (this.#clients.delete(id)) this.#emit();
  }

  #emit(): void {
    const clients = this.list();
    for (const listener of this.#listeners) {
      try {
        listener(clients);
      } catch {
        /* a listener's failure is its own */
      }
    }
  }
}
