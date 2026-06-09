/**
 * Declarative description of what an agent CLI adapter supports.
 *
 * Source: architecture/02a-system-architecture.md §5.8.2 (adapters).
 */

export type AgentId =
  | 'codex'
  | 'opencode'
  | 'claude-code'
  | 'gemini-cli'
  | 'pi-agent'
  | 'aider'
  /** Built-in reference/dev agent that echoes the prompt (no external CLI). */
  | 'echo';

export interface AgentCapabilities {
  /** Agent supports interactive plan mode. */
  planMode: boolean;
  /** Agent emits streaming token deltas. */
  streaming: boolean;
  /** Agent supports approval requests (tool gating). */
  approvals: boolean;
  /** Agent supports forking / resuming threads. */
  forking: boolean;
  /** Agent supports image inputs. */
  images: boolean;
}

/**
 * A registered agent the phone can pick for a thread, returned by `agent/list`.
 */
export interface AgentDescriptor {
  agentId: AgentId;
  /** Human-facing label (e.g. "OpenCode"). */
  displayName: string;
  /** Whether the agent's CLI/runtime is resolvable on this PC right now. */
  available: boolean;
  capabilities: AgentCapabilities;
  /** Default model the bridge will use when the phone does not pick one. */
  defaultModel?: string;
}

/**
 * A selectable model an agent reports, returned by `agent/models`.
 *
 * `id` is the wire value passed back to the agent for routing — a stable alias
 * for Claude Code (`opus`/`sonnet`/`haiku`), a `provider/model` id for OpenCode,
 * or a concrete model id for Codex. `displayName`, `description`, `version` and
 * `isDefault` are presentation hints; consumers must tolerate any of them being
 * absent (older bridges report bare id strings).
 */
export interface AgentModel {
  /** Value sent back to the agent to select this model (the routing key). */
  id: string;
  /** Human-facing label. Falls back to `id` when the CLI offers nothing better. */
  displayName: string;
  /** One-line description, when the CLI provides one (e.g. Codex). */
  description?: string;
  /**
   * Concrete underlying version when `id` is an alias that resolves to a
   * moving target — e.g. Claude Code's `opus` → `claude-opus-4-8`. Surfaced so
   * the user can see which exact model an alias currently maps to.
   */
  version?: string;
  /** Whether this is the agent's current default model. */
  isDefault?: boolean;
}
