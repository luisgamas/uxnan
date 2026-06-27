/**
 * Conversation models: Thread, Turn, Message.
 *
 * The Dart equivalents live in `uxnanmobile/lib/domain/entities/{thread,turn,message}.dart`
 * and are kept in sync manually (see 02e-bridge-integration.md §4.2).
 */

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

export type TurnStatus = 'pending' | 'streaming' | 'completed' | 'error' | 'aborted';

export type ThreadStatus = 'active' | 'idle' | 'archived';

export interface Message {
  id: string;
  turnId: string;
  role: MessageRole;
  /** Serialized MessageContent blocks (text/code/image/tool/diff/...). */
  content: unknown;
  /** The agent's reasoning ("thinking") for this message, when it emitted any. */
  thinking?: string;
  /** Structured content blocks (command_execution/diff/tool) produced this turn. */
  blocks?: unknown[];
  /**
   * The assistant message's text runs and structured blocks **in the exact
   * order the agent produced them** — each entry is a serialized MessageContent
   * (text runs as `{ type:'text', text }`, work-log/diff blocks as their own
   * types). When present, a client SHOULD render from this so the work log sits
   * inline with the response it precedes, instead of all activity collapsing
   * above one merged paragraph. `content` (the full concatenated text) and
   * `blocks` are retained for older clients and for re-sync reconciliation: the
   * text runs in `segments` concatenate to `content`, and its non-text entries
   * are exactly `blocks`. Absent for turns recovered without ordering info (an
   * older bridge, or the on-disk history fallback) — clients fall back to
   * `content` + `blocks` then. Only set on assistant messages.
   */
  segments?: unknown[];
  /** Token usage for this turn, so the phone restores the context meter on re-sync. */
  usage?: { tokens: number; contextWindow?: number };
  createdAt: number;
}

export interface Turn {
  id: string;
  threadId: string;
  status: TurnStatus;
  messages: Message[];
  createdAt: number;
  completedAt?: number;
}

/**
 * Per-thread access (approval) mode: how much the agent may do before it must
 * pause for the user. Persisted on the bridge so the phone's choice survives a
 * restart and is the source of truth across devices.
 * - `requestApproval` — ask before each risky action.
 * - `approveForMe` — auto-approve routine edits.
 * - `fullAccess` — no approval gating.
 */
export type AccessMode = 'requestApproval' | 'approveForMe' | 'fullAccess';

export interface Thread {
  id: string;
  projectId: string;
  title: string;
  status: ThreadStatus;
  turnCount: number;
  createdAt: number;
  updatedAt: number;
  /** Agent driving this thread (e.g. `opencode`, `echo`). */
  agentId?: string;
  /** Model the agent uses for this thread (e.g. `provider/model`). */
  model?: string;
  /** Absolute working directory the agent and git operations run in. */
  cwd?: string;
  /**
   * The agent CLI's NATIVE session id (Claude `session_id`, Codex `thread_id`,
   * OpenCode `sessionID`, pi session id), when known. Surfaced so the phone can
   * show "resume this conversation from the CLI" beyond the bridge thread id.
   */
  agentSessionId?: string;
  /** Per-thread access (approval) mode; see {@link AccessMode}. */
  accessMode?: AccessMode;
}

export interface ThreadList {
  threads: Thread[];
}

export interface TurnList {
  turns: Turn[];
  nextCursor?: string;
  /**
   * Total number of turns available for the thread, regardless of the page
   * returned. Lets a client page from the end (newest-first) by computing
   * offsets without first pulling the whole thread.
   */
  total?: number;
  /**
   * The turn currently in-flight for this thread (an agent is actively
   * producing it RIGHT NOW in the bridge process), when one exists. This is the
   * LIVE AgentManager state, NOT a stored turn's `streaming` status — the latter
   * can be left dangling after a bridge restart (the agent child process died),
   * whereas this is cleared the moment the turn completes/errors/aborts and is
   * absent after a restart. The phone uses it on resync/reconnect to re-attach
   * its streaming view (the "responding…" indicator + Stop button) to a turn it
   * stopped tracking while backgrounded, instead of treating the turn as ended.
   */
  activeTurnId?: string;
}
