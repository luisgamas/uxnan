// Which hosts have a live session right now, and which incarnation each one is.
//
// This is a **leaf**: it imports nothing from the rest of the app, and that is
// its job. The facts live here because two very different places need them —
// `hosts` (the Settings store) writes them, and the editor reads them to fence a
// save — and having the editor import the hosts store instead created a cycle
// (`files` → `hosts` → `terminals` → `files`) that only worked because the
// bundler tolerated it.
//
// A generation is what a mutation carries so it cannot execute against a
// connection that replaced the one it was prepared for (`$lib/target`).

export interface LiveSession {
  hostId: string;
  generation: number;
  /** The host's own name, so a message about it can say which machine. */
  label: string;
}

class SessionRegistry {
  private live = $state<Record<string, LiveSession>>({});

  /** Replace the whole picture — the backend reports it as one list, and a
   *  host missing from that list is disconnected, not stale. */
  replace(sessions: LiveSession[]): void {
    this.live = Object.fromEntries(sessions.map((s) => [s.hostId, s]));
  }

  /** Host ids with a live session. */
  get connected(): string[] {
    return Object.keys(this.live);
  }

  isConnected(hostId: string): boolean {
    return hostId in this.live;
  }

  /** The connection generation for a host, or `undefined` when it is not
   *  connected. `undefined` is the signal for a caller to refuse — never a
   *  zero, which is an expectation nobody issued. */
  generationOf(hostId: string): number | undefined {
    return this.live[hostId]?.generation;
  }

  /** The host's name if it is connected; the id is the honest fallback. */
  labelOf(hostId: string): string {
    return this.live[hostId]?.label ?? hostId;
  }
}

export const sessions = new SessionRegistry();
