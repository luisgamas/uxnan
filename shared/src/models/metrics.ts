/**
 * Profile metrics — a bridge-owned, survivable tally of a PC's activity, plus a
 * tamper-proof export/import backup.
 *
 * The mobile profile screen shows aggregated metrics (conversations, messages,
 * agents/models used, connection time, git actions, an activity heatmap). Those
 * were derived on the phone from local storage and so were lost on an app
 * uninstall (the app has no cloud login). To make them durable, the **bridge**
 * becomes the source of truth: it persists a complete activity ledger
 * (conversations, turns/messages, reported tokens, sessions and Git actions)
 * and serves it over `metrics/get`. Deleting mutable conversation history does
 * not subtract activity. The phone renders one snapshot per PC and sums PCs.
 *
 * A `metrics/export` produces an opaque, tamper-proof file only the SAME bridge
 * can later verify + decrypt (AES-256-GCM under a secret held in the PC's OS
 * keychain), so users cannot fabricate or edit their stats; `metrics/import`
 * feeds one back and merges its events by id (idempotent).
 *
 * Provider usage/credits are deliberately NOT part of this — those are read live
 * via `agent/usageStats` and never persisted.
 *
 * Source: architecture/02a-system-architecture.md §5.8.11 and
 * 02b-contracts-and-requirements.md.
 */

/** Transport a phone→PC connection session used. */
export type MetricsTransport = 'relay' | 'direct';

/** Per-agent conversation tally (most-used first). */
export interface MetricsAgentUsage {
  /** Agent wire id (e.g. `claude-code`, `codex`). */
  agentId: string;
  /** Conversations started with this agent on this PC. */
  conversations: number;
}

/** One agent's activity on a given day (drives the per-agent bars). */
export interface MetricsAgentDay {
  /** Agent wire id (e.g. `claude-code`, `codex`). */
  agentId: string;
  /** Conversations (threads) this agent started that day. */
  conversations: number;
  /** Messages exchanged that day in this agent's threads. */
  messages: number;
  /**
   * Tokens processed that day — the sum of each turn's reported usage (input
   * incl. the re-sent context + output). **Throughput, not billed cost**: caching
   * and input/output pricing differ (use `agent/usageStats` for money). 0 for
   * agents that don't report usage (e.g. Zero).
   */
  tokens: number;
}

/** One calendar day's activity split per agent. */
export interface MetricsDayBreakdown {
  /** UTC-midnight epoch ms of the calendar date (same encoding as `activity`). */
  day: number;
  /** Per-agent activity that day (agents with any conversation/message/token). */
  byAgent: MetricsAgentDay[];
}

/**
 * One local calendar-day activity bucket. Counts are split by category so a
 * client can render any metric filter (combined / conversations / messages /
 * work) with no extra round-trip. Days with no activity are omitted.
 */
export interface MetricsActivityDay {
  /**
   * The calendar date this bucket covers, as **UTC-midnight epoch ms** of the
   * bridge host's local date. Encoding the local date at UTC midnight (not the
   * local-midnight instant) makes the key timezone-stable, so a phone in any
   * timezone maps it to the correct heatmap cell.
   */
  day: number;
  /** Conversations started that day. */
  conversations: number;
  /** Messages exchanged that day. */
  messages: number;
  /** Git/work actions performed that day. */
  work: number;
}

/**
 * Aggregated metrics for ONE PC (the bridge that returns it), built from the
 * bridge's durable activity ledger. The phone renders this per PC and sums
 * across PCs for the all-PCs profile. Every field is a count the phone cannot
 * inflate — the bridge observes and retains it. Source of `metrics/get`.
 */
export interface MetricsSnapshot {
  /** Schema version, for forward-compatible parsing. */
  version: number;
  /** The bridge PC's `macDeviceId` this snapshot belongs to. */
  deviceId: string;
  /** Total conversations (threads) started on this PC. */
  conversations: number;
  /** Distinct agents used. */
  agentsUsed: number;
  /** Distinct models used. */
  modelsUsed: number;
  /** Total messages exchanged (both roles). */
  messages: number;
  /** Total git actions performed (mutating operations). */
  gitActions: number;
  /** Connection sessions recorded. */
  sessions: number;
  /** Cumulative connected time across all sessions, ms. */
  totalConnectedMs: number;
  /** The single longest connection session, ms. */
  longestSessionMs: number;
  /** Sessions that ran over the relay. */
  relaySessions: number;
  /** Sessions that ran over a direct LAN/Tailscale host. */
  directSessions: number;
  /** Per-agent conversation tallies, most-used first. */
  byAgent: MetricsAgentUsage[];
  /** Earliest conversation creation (epoch ms); absent when there are none. */
  memberSince?: number;
  /** Per-day activity buckets for the contribution heatmap. */
  activity: MetricsActivityDay[];
  /**
   * Per-day activity split per agent (conversations, messages, tokens), for the
   * unified agent-activity view: the per-agent bars show all-time totals, or a
   * single day's totals when a heatmap cell is selected. See
   * {@link MetricsAgentDay}.
   */
  byAgentDay: MetricsDayBreakdown[];
  /** When the bridge produced this snapshot (epoch ms). */
  updatedAt: number;
}

/**
 * `metrics/export` request. The bridge seals its complete metrics ledger into an
 * opaque, tamper-proof blob that only THIS same bridge can later verify +
 * decrypt (AES-256-GCM under a secret held in the OS keychain). An optional user
 * [passphrase] adds a second confidentiality layer (scrypt-derived), so a leaked
 * file also needs the phrase; it must be supplied again at import.
 */
export interface MetricsExportParams {
  /** Optional extra passphrase lock; required again at import when set. */
  passphrase?: string;
}

export interface MetricsExportResult {
  /** The sealed blob to write to a file (a JSON string, opaque to the phone). */
  blob: string;
  /** Suggested filename (e.g. `uxnan-metrics-<host>-<date>.uxmetrics`). */
  filename: string;
  /** Whether the blob carries an extra passphrase lock (import will need it). */
  passphraseProtected: boolean;
}

/**
 * `metrics/import` request. The phone sends back a previously exported [blob].
 * The bridge verifies it was sealed by THIS PC — a foreign or edited file is
 * rejected — decrypts it (using [passphrase] when the file was passphrase-locked)
 * and merges its ledger rows by id (idempotent: re-importing the same file
 * changes nothing). Returns the refreshed snapshot.
 */
export interface MetricsImportParams {
  /** The sealed blob produced by a prior `metrics/export` on this PC. */
  blob: string;
  /** The passphrase, when the file was exported with one. */
  passphrase?: string;
}

export interface MetricsImportResult {
  /** How many ledger rows were inserted or advanced. */
  imported: number;
  /** The refreshed snapshot after the merge. */
  snapshot: MetricsSnapshot;
}
