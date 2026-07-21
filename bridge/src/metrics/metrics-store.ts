/**
 * Persistent metrics event store under `~/.uxnan/metrics.json`.
 *
 * The bridge is the source of truth for the mobile profile metrics. This store
 * holds every activity stream the bridge observes — conversations, turns
 * (message/day buckets + reported tokens), connection sessions and mutating Git
 * actions — as rows keyed by stable ids. Conversation/turn rows are upserted
 * because a turn is first observed with zero tokens and may receive final usage
 * later; sessions and Git actions are append-only.
 *
 * Deleting mutable conversation history never removes rows from this ledger.
 * Export/import therefore restores the complete activity history instead of
 * combining a partial backup with whatever `threads.json` happens to contain.
 *
 * Mutations are serialized through a mutex so concurrent writes cannot corrupt
 * the read-modify-write cycle.
 *
 * Source: architecture/02a-system-architecture.md §5.8.11.
 */
import { randomUUID } from 'node:crypto';
import { copyFile } from 'node:fs/promises';
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

/** One observed mutating Git action. */
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

/** One conversation's durable activity record. */
export interface ConversationMetricEvent {
  /** Stable id: the bridge thread id. */
  id: string;
  /** Agent selected when this conversation record was captured. */
  agentId?: string;
  /** Model selected when this conversation record was captured. */
  model?: string;
  /** When the conversation was created (epoch ms). */
  createdAt: number;
  /** Last time this record was refreshed from authoritative thread state. */
  updatedAt: number;
}

/** Message count for one UTC-midnight calendar-day bucket. */
export interface MetricMessageDay {
  day: number;
  messages: number;
}

/** One turn's durable activity record. */
export interface TurnMetricEvent {
  /** Stable id scoped by outer thread: `<threadId>:<turnId>`. */
  id: string;
  threadId: string;
  agentId?: string;
  model?: string;
  /** Message counts split by UTC calendar day. */
  messageDays: MetricMessageDay[];
  /** Tokens reported by the assistant message (0 when unavailable). */
  tokens: number;
  /** UTC day that receives [tokens]. */
  tokenDay: number;
  /** Last time this record was refreshed from authoritative thread state. */
  updatedAt: number;
}

/** Every event stream persisted and sealed for export/import. */
export interface MetricsEvents {
  conversations: ConversationMetricEvent[];
  turns: TurnMetricEvent[];
  sessions: SessionEvent[];
  gitActions: GitActionEvent[];
}

// FOR-DEV: Per-phone metrics are intentionally deferred. Add an explicit
// metrics-profile id and authenticated device attribution here (not a hardware
// id and not the transport Ed25519 identity); define recovery/rebinding,
// revocation, migration, shared-contract and mobile aggregation semantics first.

interface MetricsFile extends MetricsEvents {
  version: number;
}

const FILE_VERSION = 2;
const BACKUP_GENERATIONS = 5;

export class MetricsStore {
  readonly #state: DaemonState;
  #lock: Promise<void> = Promise.resolve();

  constructor(state: DaemonState) {
    this.#state = state;
  }

  /** All persisted events. */
  async readEvents(): Promise<MetricsEvents> {
    const file = await this.#read();
    return {
      conversations: file.conversations,
      turns: file.turns,
      sessions: file.sessions,
      gitActions: file.gitActions,
    };
  }

  /** Upserts a complete conversation-history projection. Stable ids make this
   * safe at startup, before export, and after every relevant thread mutation. */
  mergeConversationHistory(
    conversations: ConversationMetricEvent[],
    turns: TurnMetricEvent[],
  ): Promise<number> {
    return this.#mutate(async (file) => {
      const changedConversations = mergeLatest(file.conversations, conversations, true);
      const changedTurns = mergeLatest(file.turns, turns, true);
      return changedConversations + changedTurns;
    });
  }

  /** Opens a session row for a freshly established channel; returns its id. */
  startSession(deviceId: string, transport: MetricsTransport, now: number): Promise<string> {
    const id = randomUUID();
    return this.#mutate(async (file) => {
      file.sessions.push({ id, deviceId, transport, startedAt: now });
      return id;
    });
  }

  /** Closes the open session [id] at [now]. No-op if unknown/already closed. */
  endSession(id: string, now: number): Promise<void> {
    return this.#mutate(async (file) => {
      const session = file.sessions.find((s) => s.id === id);
      if (session && session.endedAt === undefined) session.endedAt = now;
    });
  }

  /**
   * Closes sessions left open by a previous run at their own `startedAt`, so a
   * crash contributes a session but never inflates connected time.
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

  /** Records a mutating Git action. */
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
   * Merges a complete imported ledger. Conversation/turn rows advance when the
   * incoming `updatedAt` is newer; append-only rows are unioned by id. Returns
   * the number of inserted or advanced rows. Re-importing is idempotent.
   */
  mergeEvents(incoming: MetricsEvents): Promise<number> {
    return this.#mutate(async (file) => {
      let changed = 0;
      changed += mergeLatest(file.conversations, incoming.conversations);
      changed += mergeLatest(file.turns, incoming.turns);

      const sessionIds = new Set(file.sessions.map((s) => s.id));
      for (const session of incoming.sessions) {
        if (!sessionIds.has(session.id)) {
          file.sessions.push(session);
          sessionIds.add(session.id);
          changed += 1;
        }
      }
      const gitIds = new Set(file.gitActions.map((g) => g.id));
      for (const action of incoming.gitActions) {
        if (!gitIds.has(action.id)) {
          file.gitActions.push(action);
          gitIds.add(action.id);
          changed += 1;
        }
      }
      return changed;
    });
  }

  async #read(): Promise<MetricsFile> {
    let file: Partial<MetricsFile> | null = null;
    let firstError: unknown;
    for (const candidate of metricFileCandidates()) {
      try {
        file = await this.#state.readJson<Partial<MetricsFile>>(candidate);
        if (file !== null) break;
      } catch (error) {
        firstError ??= error;
      }
    }
    if (file === null && firstError !== undefined) throw firstError;
    return {
      version: FILE_VERSION,
      conversations: Array.isArray(file?.conversations) ? file.conversations : [],
      turns: Array.isArray(file?.turns) ? file.turns : [],
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
      await this.#rotateBackups();
      await this.#state.writeJson(DAEMON_FILES.metrics, file);
      return result;
    });
    this.#lock = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** Preserve five previous primary generations before replacing the ledger. */
  async #rotateBackups(): Promise<void> {
    for (let generation = BACKUP_GENERATIONS; generation >= 1; generation -= 1) {
      const source =
        generation === 1
          ? this.#state.pathFor(DAEMON_FILES.metrics)
          : this.#state.pathFor(`${DAEMON_FILES.metrics}.bak${generation - 1}`);
      const target = this.#state.pathFor(`${DAEMON_FILES.metrics}.bak${generation}`);
      try {
        await copyFile(source, target);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
  }
}

function metricFileCandidates(): string[] {
  return [
    DAEMON_FILES.metrics,
    ...Array.from(
      { length: BACKUP_GENERATIONS },
      (_, index) => `${DAEMON_FILES.metrics}.bak${index + 1}`,
    ),
  ];
}

/** Merge versioned rows by id, keeping the newest representation. */
function mergeLatest<T extends { id: string; updatedAt: number }>(
  target: T[],
  incoming: T[],
  replaceDifferentEqualTimestamp = false,
): number {
  const index = new Map(target.map((event, i) => [event.id, i]));
  let changed = 0;
  for (const event of incoming) {
    const currentIndex = index.get(event.id);
    if (currentIndex === undefined) {
      target.push(event);
      index.set(event.id, target.length - 1);
      changed += 1;
      continue;
    }
    const current = target[currentIndex];
    if (
      current &&
      (event.updatedAt > current.updatedAt ||
        (replaceDifferentEqualTimestamp &&
          event.updatedAt === current.updatedAt &&
          JSON.stringify(event) !== JSON.stringify(current)))
    ) {
      target[currentIndex] = event;
      changed += 1;
    }
  }
  return changed;
}
