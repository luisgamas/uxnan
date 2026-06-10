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
  /**
   * Agent reports per-turn token/context usage (`usage` on `turn/completed`),
   * so the phone can show a context meter (at 0 until the first turn). Optional
   * for back-compat; absent/false means the agent reports no usage (e.g.
   * OpenCode) and the meter stays hidden.
   */
  reportsContextUsage?: boolean;
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

/** One selectable value of an {@link AgentModelOption} of kind `enum`. */
export interface AgentModelOptionValue {
  /** Value sent back in `turn/send` `options` when chosen. */
  value: string;
  /** Human-facing label for this value. */
  label: string;
}

/**
 * A per-model run-option "knob" the phone should let the user set for a turn
 * (e.g. reasoning effort). Declared per {@link AgentModel} because the same
 * agent's models can differ. The phone is a generic renderer: it shows only the
 * knobs the bridge advertises and sends the chosen values back on `turn/send`
 * (keyed by {@link AgentModelOption.key}); the bridge translates them into each
 * CLI's real flag. Consumers MUST ignore an unknown `kind` so adding a knob
 * never breaks an older app.
 */
export interface AgentModelOption {
  /** Stable key echoed back in `turn/send` `options` (e.g. `reasoning`). */
  key: string;
  /** Control kind. Unknown kinds are ignored by the phone (forward-compatible). */
  kind: 'enum' | 'toggle';
  /** Human-facing label for the control. */
  label: string;
  /** For `enum`: the selectable values (omit for `toggle`). */
  values?: AgentModelOptionValue[];
  /** Default value when the agent has one (string for `enum`, boolean for `toggle`). */
  default?: string | boolean;
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
  /**
   * Per-model run-option knobs (reasoning effort, etc.) the phone may let the
   * user set. Absent/empty when the model has none. The phone renders these
   * generically and sends chosen values on `turn/send` via `options`.
   */
  options?: AgentModelOption[];
}
