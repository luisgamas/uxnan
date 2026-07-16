/**
 * Persistent metrics event store under `~/.uxnan/metrics.json`.
 *
 * The bridge is the source of truth for the mobile profile metrics (they used to
 * be phone-local and were lost on an app uninstall). This store holds the two
 * event streams the bridge observes itself — connection **sessions** and mutating
 * **git actions** — as append-only rows keyed by a stable id, so a re-imported
 * backup merges idempotently (a union by id). The conversation-derived metrics
 * (conversations/messages/agents/models/member-since) are computed live from the
 * {@link ThreadStore}, not stored here.
 *
 * Mutations are serialized through a mutex so concurrent session/git writes don't
 * corrupt the read-modify-write cycle (same pattern as the ThreadStore).
 *
 * Source: architecture/02a-system-architecture.md §5.8.11.
 */
import { randomUUID } from 'node:crypto';
import type { MetricsTransport } from '@uxnan/shared';
import { DAEMON_FILES, type DaemonState } from '../daemon-state.js';

/** One observed phone→PC connection session. */
export interface SessionEvent {
  /** Unique id (primary key for idempotent merge). */
  id: string;
  /** The phone's trusted-device id. */
  deviceId: string;
  /** Whether the channel ran over the relay or a direct LAN/Tailscale host. */
  transport: MetricsTransport;
  /** When the secure channel was established (epoch ms). */
  startedAt: number;
  /** When it was torn down (epoch ms), or absent while still open. */
  endedAt?: number;
}

/** One observed mutating git action. */
export interface GitActionEvent {
  /** Unique id (primary key for idempotent merge). */
  id: string;
  /** The JSON-RPC method (e.g. `git/commit`). */
  method: string;
  /** The thread the action ran for, when known. */
  threadId?: string;
  /** Whether it completed without error. */
  succeeded: boolean;
  /** When it completed (epoch ms). */
  at: number;
}

/** The two event streams, as persisted and as sealed for export/import. */
export interface MetricsEvents {
  sessions: SessionEvent[];
  gitActions: GitActionEvent[];
}

interface MetricsFile extends MetricsEvents {
  version: number;
}

const FILE_VERSION = 1;

export class MetricsStore {
  readonly #state: DaemonState;
  #lock: Promise<void> = Promise.resolve();

  constructor(state: DaemonState) {
    this.#state = state;
  }

  /** All persisted events. */
  async readEvents(): Promise<MetricsEvents> {
    const file = await this.#read();
    return { sessions: file.sessions, gitActions: file.gitActions };
  }

  /** Opens a session row for a freshly established channel; returns its id. */
  startSession(deviceId: string, transport: MetricsTransport, now: number): Promise<string> {
    const id = randomUUID();
    return this.#mutate(async (file) => {
      file.sessions.push({ id, deviceId, transport, startedAt: now });
      return id;
    });
  }

  /** Closes the open session [id] at [now] (a clean teardown). No-op if unknown
   *  or already closed. */
  endSession(id: string, now: number): Promise<void> {
    return this.#mutate(async (file) => {
      const session = file.sessions.find((s) => s.id === id);
      if (session && session.endedAt === undefined) session.endedAt = now;
    });
  }

  /**
   * Closes any session left open by a previous run (the bridge exited without a
   * clean teardown) at its own `startedAt`, so a crash contributes a session to
   * the count but never inflates the connected time. Run once at startup.
   *
   * A no-op (no write) when there is nothing to close — so a fresh bridge with no
   * metrics yet does not create `metrics.json` on boot.
   */
  async closeDanglingSessions(): Promise<void> {
    const current = await this.#read();
    if (!current.sessions.some((s) => s.endedAt === undefined)) return;
    return this.#mutate(async (file) => {
      for (const session of file.sessions) {
        if (session.endedAt === undefined) session.endedAt = session.startedAt;
      }
    });
  }

  /** Records a mutating git action. */
  recordGitAction(
    method: string,
    threadId: string | undefined,
    succeeded: boolean,
    now: number,
  ): Promise<void> {
    return this.#mutate(async (file) => {
      file.gitActions.push({
        id: randomUUID(),
        method,
        ...(threadId !== undefined ? { threadId } : {}),
        succeeded,
        at: now,
      });
    });
  }

  /**
   * Merges [incoming] events into the store by id (a union): only rows whose id
   * is not already present are added. Idempotent — re-importing the same backup
   * adds nothing. Returns how many new rows were merged.
   */
  mergeEvents(incoming: MetricsEvents): Promise<number> {
    return this.#mutate(async (file) => {
      let added = 0;
      const sessionIds = new Set(file.sessions.map((s) => s.id));
      for (const session of incoming.sessions) {
        if (!sessionIds.has(session.id)) {
          file.sessions.push(session);
          sessionIds.add(session.id);
          added += 1;
        }
      }
      const gitIds = new Set(file.gitActions.map((g) => g.id));
      for (const action of incoming.gitActions) {
        if (!gitIds.has(action.id)) {
          file.gitActions.push(action);
          gitIds.add(action.id);
          added += 1;
        }
      }
      return added;
    });
  }

  async #read(): Promise<MetricsFile> {
    const file = await this.#state.readJson<MetricsFile>(DAEMON_FILES.metrics);
    return {
      version: file?.version ?? FILE_VERSION,
      sessions: Array.isArray(file?.sessions) ? file.sessions : [],
      gitActions: Array.isArray(file?.gitActions) ? file.gitActions : [],
    };
  }

  /** Run `fn` under the write lock with the current file, then persist. */
  #mutate<T>(fn: (file: MetricsFile) => Promise<T>): Promise<T> {
    const run = this.#lock.then(async () => {
      const file = await this.#read();
      const result = await fn(file);
      file.version = FILE_VERSION;
      await this.#state.writeJson(DAEMON_FILES.metrics, file);
      return result;
    });
    this.#lock = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}
