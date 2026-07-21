/**
 * Profile-metrics service: the bridge-owned home of the mobile profile metrics.
 *
 * Aggregates the complete {@link MetricsStore} ledger into a
 * {@link MetricsSnapshot} for `metrics/get`, backfills existing mutable history
 * through {@link ThreadStore}, and produces/verifies the tamper-proof backup for
 * `metrics/export` / `metrics/import` (sealed under a keychain-held secret; see
 * {@link sealMetrics}). Observation hooks are called by bridge-owned transport,
 * conversation and Git paths so the phone can never inflate the numbers.
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
  /** Shared ledger instance also injected into ThreadStore for incremental capture. */
  store?: MetricsStore;
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
    this.#store = options.store ?? new MetricsStore(options.state);
    this.#secretStore = options.secretStore;
    this.#threadStore = options.threadStore;
    this.#deviceId = options.deviceId;
    this.#now = options.now;
  }

  /** Repair crash leftovers and idempotently seed the v2 conversation ledger
   * from existing `threads.json`. Run before the bridge begins serving. */
  async initialize(): Promise<void> {
    await this.#store.closeDanglingSessions();
    await this.#threadStore.captureAllMetrics();
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

  /** Build this PC's aggregated snapshot solely from its durable ledger. */
  async getSnapshot(): Promise<MetricsSnapshot> {
    // Repairs any best-effort incremental capture that failed transiently.
    await this.#threadStore.captureAllMetrics();
    const events = await this.#store.readEvents();
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

    const agents = new Set<string>();
    const models = new Set<string>();
    const byAgentCounts = new Map<string, number>();
    let memberSince: number | undefined;

    type AgentDay = { conversations: number; messages: number; tokens: number };
    const byAgentDay = new Map<number, Map<string, AgentDay>>();
    const agentDay = (day: number, agentId: string): AgentDay => {
      let agentsForDay = byAgentDay.get(day);
      if (!agentsForDay) {
        agentsForDay = new Map();
        byAgentDay.set(day, agentsForDay);
      }
      let entry = agentsForDay.get(agentId);
      if (!entry) {
        entry = { conversations: 0, messages: 0, tokens: 0 };
        agentsForDay.set(agentId, entry);
      }
      return entry;
    };

    // Activity heatmap is built entirely from the durable ledger. Thread
    // deletion cannot subtract from these buckets.
    const activity = new Map<number, { conversations: number; messages: number; work: number }>();
    const activityDay = (
      day: number,
    ): { conversations: number; messages: number; work: number } => {
      let entry = activity.get(day);
      if (!entry) {
        entry = { conversations: 0, messages: 0, work: 0 };
        activity.set(day, entry);
      }
      return entry;
    };

    for (const conversation of events.conversations) {
      const day = utcDayKey(conversation.createdAt);
      activityDay(day).conversations += 1;
      if (memberSince === undefined || conversation.createdAt < memberSince) {
        memberSince = conversation.createdAt;
      }
      if (conversation.agentId !== undefined) {
        agents.add(conversation.agentId);
        byAgentCounts.set(conversation.agentId, (byAgentCounts.get(conversation.agentId) ?? 0) + 1);
        agentDay(day, conversation.agentId).conversations += 1;
      }
      if (conversation.model !== undefined) models.add(conversation.model);
    }

    let messages = 0;
    for (const turn of events.turns) {
      if (turn.agentId !== undefined) agents.add(turn.agentId);
      if (turn.model !== undefined) models.add(turn.model);
      for (const bucket of turn.messageDays) {
        messages += bucket.messages;
        activityDay(bucket.day).messages += bucket.messages;
        if (turn.agentId !== undefined) {
          agentDay(bucket.day, turn.agentId).messages += bucket.messages;
        }
      }
      if (turn.tokens > 0 && turn.agentId !== undefined) {
        agentDay(turn.tokenDay, turn.agentId).tokens += turn.tokens;
      }
    }
    for (const action of events.gitActions) {
      const day = utcDayKey(action.at);
      activityDay(day).work += 1;
    }

    const byAgent = [...byAgentCounts]
      .map(([agentId, conversations]) => ({ agentId, conversations }))
      .sort((a, b) => b.conversations - a.conversations);

    return {
      version: SNAPSHOT_VERSION,
      deviceId: this.#deviceId,
      conversations: events.conversations.length,
      agentsUsed: agents.size,
      modelsUsed: models.size,
      messages,
      gitActions: events.gitActions.length,
      sessions: events.sessions.length,
      totalConnectedMs,
      longestSessionMs,
      relaySessions,
      directSessions,
      byAgent,
      ...(memberSince !== undefined ? { memberSince } : {}),
      activity: [...activity]
        .map(([day, counts]) => ({ day, ...counts }))
        .sort((a, b) => a.day - b.day),
      byAgentDay: [...byAgentDay]
        .map(([day, entries]) => ({
          day,
          byAgent: [...entries].map(([agentId, counts]) => ({ agentId, ...counts })),
        }))
        .sort((a, b) => a.day - b.day),
      updatedAt: now,
    };
  }

  // --- metrics/export & metrics/import --------------------------------------

  /** Seal this PC's metrics event log into a tamper-proof backup file. */
  async exportBackup(passphrase?: string): Promise<MetricsExportResult> {
    await this.#threadStore.captureAllMetrics();
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
  const conversations = Array.isArray(obj['conversations']) ? obj['conversations'] : [];
  const turns = Array.isArray(obj['turns']) ? obj['turns'] : [];
  const sessions = Array.isArray(obj['sessions']) ? obj['sessions'] : [];
  const gitActions = Array.isArray(obj['gitActions']) ? obj['gitActions'] : [];
  return {
    conversations: conversations.filter(isConversationMetricEvent),
    turns: turns.filter(isTurnMetricEvent),
    sessions: sessions.filter(isSessionEvent),
    gitActions: gitActions.filter(isGitActionEvent),
  };
}

function isConversationMetricEvent(v: unknown): v is MetricsEvents['conversations'][number] {
  const event = v as Record<string, unknown> | null;
  return (
    !!event &&
    typeof event['id'] === 'string' &&
    optionalStringField(event, 'agentId') &&
    optionalStringField(event, 'model') &&
    isFiniteNumber(event['createdAt']) &&
    isFiniteNumber(event['updatedAt'])
  );
}

function isTurnMetricEvent(v: unknown): v is MetricsEvents['turns'][number] {
  const event = v as Record<string, unknown> | null;
  const messageDays = event?.['messageDays'];
  return (
    !!event &&
    typeof event['id'] === 'string' &&
    typeof event['threadId'] === 'string' &&
    optionalStringField(event, 'agentId') &&
    optionalStringField(event, 'model') &&
    Array.isArray(messageDays) &&
    messageDays.every((entry) => {
      const bucket = entry as Record<string, unknown> | null;
      return !!bucket && isFiniteNumber(bucket['day']) && isNonNegativeInteger(bucket['messages']);
    }) &&
    isNonNegativeInteger(event['tokens']) &&
    isFiniteNumber(event['tokenDay']) &&
    isFiniteNumber(event['updatedAt'])
  );
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

function optionalStringField(value: Record<string, unknown>, key: string): boolean {
  return value[key] === undefined || typeof value[key] === 'string';
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0 && Number.isInteger(value);
}
