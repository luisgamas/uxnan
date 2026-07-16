/**
 * Profile-metrics service: the bridge-owned home of the mobile profile metrics.
 *
 * Composes the {@link MetricsStore} (session + git-action events it observes) with
 * the {@link ThreadStore}'s conversation aggregate into a {@link MetricsSnapshot}
 * for `metrics/get`, and produces / verifies the tamper-proof backup file for
 * `metrics/export` / `metrics/import` (sealed under a keychain-held secret; see
 * {@link sealMetrics}). The observation hooks (`startSession`, `endSession`,
 * `recordGitAction`, `closeDanglingSessions`) are called from the transport and
 * git handlers so the phone can never inflate the numbers.
 *
 * Source: architecture/02a-system-architecture.md §5.8.11.
 */
import { hostname } from 'node:os';
import { randomBytes } from 'node:crypto';
import {
  RpcError,
  type MetricsExportResult,
  type MetricsImportResult,
  type MetricsSnapshot,
  type MetricsTransport,
} from '@uxnan/shared';
import type { DaemonState } from '../daemon-state.js';
import type { SecretStore } from '../secret-store.js';
import type { ThreadStore } from '../conversation/thread-store.js';
import { MetricsStore, type MetricsEvents } from './metrics-store.js';
import { MetricsSealError, openMetrics, sealMetrics } from './metrics-seal.js';
import { utcDayKey } from './day.js';

const SNAPSHOT_VERSION = 1;
/** Keychain entry holding the 32-byte metrics sealing key (hex). */
const SEAL_KEY_STORE_KEY = 'metrics-seal-key';

export interface MetricsServiceOptions {
  state: DaemonState;
  secretStore: SecretStore;
  threadStore: ThreadStore;
  /** The bridge PC's macDeviceId (snapshot owner + seal binding). */
  deviceId: string;
  now: () => number;
}

export class MetricsService {
  readonly #store: MetricsStore;
  readonly #secretStore: SecretStore;
  readonly #threadStore: ThreadStore;
  readonly #deviceId: string;
  readonly #now: () => number;
  #sealKey: Buffer | undefined;

  constructor(options: MetricsServiceOptions) {
    this.#store = new MetricsStore(options.state);
    this.#secretStore = options.secretStore;
    this.#threadStore = options.threadStore;
    this.#deviceId = options.deviceId;
    this.#now = options.now;
  }

  // --- Observation hooks (called by the transport + git handlers) -----------

  /** Open a session row for a freshly established channel; returns its id. */
  startSession(deviceId: string, transport: MetricsTransport): Promise<string> {
    return this.#store.startSession(deviceId, transport, this.#now());
  }

  /** Close the open session [id] (a clean teardown). */
  endSession(id: string): Promise<void> {
    return this.#store.endSession(id, this.#now());
  }

  /** Close sessions left open by a previous run. Run once at startup. */
  closeDanglingSessions(): Promise<void> {
    return this.#store.closeDanglingSessions();
  }

  /** Record a mutating git action. */
  recordGitAction(method: string, threadId: string | undefined, succeeded: boolean): Promise<void> {
    return this.#store.recordGitAction(method, threadId, succeeded, this.#now());
  }

  // --- metrics/get ----------------------------------------------------------

  /** Build this PC's aggregated snapshot from the conversation store + events. */
  async getSnapshot(): Promise<MetricsSnapshot> {
    const [conv, events] = await Promise.all([
      this.#threadStore.conversationMetrics(),
      this.#store.readEvents(),
    ]);
    const now = this.#now();

    let totalConnectedMs = 0;
    let longestSessionMs = 0;
    let relaySessions = 0;
    let directSessions = 0;
    for (const session of events.sessions) {
      // An open session (no teardown recorded yet) counts up to now.
      const end = session.endedAt ?? now;
      const duration = Math.max(0, end - session.startedAt);
      totalConnectedMs += duration;
      if (duration > longestSessionMs) longestSessionMs = duration;
      if (session.transport === 'relay') relaySessions += 1;
      else directSessions += 1;
    }

    // Activity heatmap: conversation/message buckets from the conversation store,
    // plus a "work" bucket per git action, keyed by the same local-day boundary.
    const activity = new Map<number, { conversations: number; messages: number; work: number }>();
    for (const day of conv.activityByDay) {
      activity.set(day.day, {
        conversations: day.conversations,
        messages: day.messages,
        work: 0,
      });
    }
    for (const action of events.gitActions) {
      const day = utcDayKey(action.at);
      const entry = activity.get(day) ?? { conversations: 0, messages: 0, work: 0 };
      entry.work += 1;
      activity.set(day, entry);
    }

    const byAgent = [...conv.byAgent].sort((a, b) => b.conversations - a.conversations);

    return {
      version: SNAPSHOT_VERSION,
      deviceId: this.#deviceId,
      conversations: conv.conversations,
      agentsUsed: conv.agents.length,
      modelsUsed: conv.models.length,
      messages: conv.messages,
      gitActions: events.gitActions.length,
      sessions: events.sessions.length,
      totalConnectedMs,
      longestSessionMs,
      relaySessions,
      directSessions,
      byAgent,
      ...(conv.memberSince !== undefined ? { memberSince: conv.memberSince } : {}),
      activity: [...activity]
        .map(([day, counts]) => ({ day, ...counts }))
        .sort((a, b) => a.day - b.day),
      byAgentDay: [...conv.byAgentDay].sort((a, b) => a.day - b.day),
      updatedAt: now,
    };
  }

  // --- metrics/export & metrics/import --------------------------------------

  /** Seal this PC's metrics event log into a tamper-proof backup file. */
  async exportBackup(passphrase?: string): Promise<MetricsExportResult> {
    const events = await this.#store.readEvents();
    const sealKey = await this.#sealKeyBuffer();
    const now = this.#now();
    const payload = Buffer.from(JSON.stringify(events), 'utf-8');
    const blob = sealMetrics(payload, {
      sealKey,
      deviceId: this.#deviceId,
      now,
      ...(passphrase ? { passphrase } : {}),
    });
    return {
      blob,
      filename: `uxnan-metrics-${safeHost()}-${dateStamp(now)}.uxmetrics`,
      passphraseProtected: typeof passphrase === 'string' && passphrase.length > 0,
    };
  }

  /** Verify + decrypt a backup, merge its events by id, return the new snapshot. */
  async importBackup(blob: string, passphrase?: string): Promise<MetricsImportResult> {
    const sealKey = await this.#sealKeyBuffer();
    let payload: Buffer;
    try {
      payload = openMetrics(blob, {
        sealKey,
        deviceId: this.#deviceId,
        ...(passphrase ? { passphrase } : {}),
      });
    } catch (err) {
      if (err instanceof MetricsSealError) throw RpcError.invalidParams(err.message);
      throw err;
    }
    let events: MetricsEvents;
    try {
      events = parseEvents(JSON.parse(payload.toString('utf-8')));
    } catch {
      throw RpcError.invalidParams('the backup file contents are invalid');
    }
    const imported = await this.#store.mergeEvents(events);
    const snapshot = await this.getSnapshot();
    return { imported, snapshot };
  }

  /** Load the keychain sealing key, creating + persisting one on first use. */
  async #sealKeyBuffer(): Promise<Buffer> {
    if (this.#sealKey) return this.#sealKey;
    const existing = await this.#secretStore.get(SEAL_KEY_STORE_KEY);
    if (existing) {
      this.#sealKey = Buffer.from(existing, 'hex');
      return this.#sealKey;
    }
    const key = randomBytes(32);
    await this.#secretStore.set(SEAL_KEY_STORE_KEY, key.toString('hex'));
    this.#sealKey = key;
    return key;
  }
}

/** YYYYMMDD from an epoch-ms timestamp, in the host's local time. */
function dateStamp(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

/** The hostname reduced to a filename-safe token. */
function safeHost(): string {
  return (
    hostname()
      .replace(/[^A-Za-z0-9-]/g, '-')
      .slice(0, 32) || 'pc'
  );
}

/**
 * Defensively parse the decrypted event payload. It is authenticated (only this
 * bridge could produce it) so this mostly guards against a future/format change:
 * malformed rows are dropped rather than corrupting the store.
 */
function parseEvents(raw: unknown): MetricsEvents {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const sessions = Array.isArray(obj['sessions']) ? obj['sessions'] : [];
  const gitActions = Array.isArray(obj['gitActions']) ? obj['gitActions'] : [];
  return {
    sessions: sessions.filter(isSessionEvent),
    gitActions: gitActions.filter(isGitActionEvent),
  };
}

function isSessionEvent(v: unknown): v is MetricsEvents['sessions'][number] {
  const s = v as Record<string, unknown> | null;
  return (
    !!s &&
    typeof s['id'] === 'string' &&
    typeof s['deviceId'] === 'string' &&
    (s['transport'] === 'relay' || s['transport'] === 'direct') &&
    typeof s['startedAt'] === 'number' &&
    (s['endedAt'] === undefined || typeof s['endedAt'] === 'number')
  );
}

function isGitActionEvent(v: unknown): v is MetricsEvents['gitActions'][number] {
  const g = v as Record<string, unknown> | null;
  return (
    !!g &&
    typeof g['id'] === 'string' &&
    typeof g['method'] === 'string' &&
    typeof g['succeeded'] === 'boolean' &&
    typeof g['at'] === 'number' &&
    (g['threadId'] === undefined || typeof g['threadId'] === 'string')
  );
}
