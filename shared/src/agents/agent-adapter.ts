/**
 * Contract every agent CLI adapter must implement.
 *
 * Source: architecture/02a-system-architecture.md §5.8.2 (adapters/base-adapter).
 */
import type {
  AgentCapabilities,
  AgentCommand,
  AgentCommandInvocation,
  AgentId,
  AgentModel,
} from './agent-capabilities.js';
import type { AgentConfig } from './agent-config.js';
import type { TurnAttachment } from '../models/workspace.js';
import type { ApprovalDecision } from '../models/approval.js';
import type { AccessMode } from '../models/thread.js';

/** A single streamed event produced by a running agent turn. */
export interface AgentStreamEvent {
  type:
    | 'delta'
    /** A chunk of the agent's reasoning / "thinking" (`data.text`). */
    | 'thinking'
    /** A structured content block — command/diff/tool (`data.content`). */
    | 'block'
    | 'turn_started'
    | 'turn_completed'
    | 'turn_error'
    | 'turn_aborted'
    /** The agent reported the concrete model it resolved an alias to (`data.text`). */
    | 'model_resolved';
  threadId: string;
  turnId: string;
  /** Free-form payload depending on `type`. */
  data?: unknown;
}

export interface SendTurnOptions {
  threadId: string;
  turnId: string;
  text: string;
  /** Model/service identifier (e.g. `provider/model`) for adapters that accept one. */
  service?: string;
  /** Legacy flat reasoning effort / variant (e.g. `high`, `max`, `minimal`). */
  effort?: string;
  /**
   * Chosen per-model run-option values keyed by `AgentModelOption.key` (e.g.
   * `{ reasoning: 'high' }`). Adapters translate these into CLI flags; the
   * legacy `effort` is used as a fallback for the `reasoning` knob.
   */
  options?: Record<string, string | boolean>;
  /**
   * Inline image attachments for this turn. The {@link AgentManager}
   * materializes these to temp files and appends a reference to {@link text}
   * before the adapter runs, so adapters need no per-CLI image handling.
   */
  attachments?: TurnAttachment[];
  /** Working directory the agent should run in for this turn. */
  cwd?: string;
  /**
   * The thread's persisted access (approval) mode (see {@link AccessMode}).
   * Adapters that gate tool execution map it to their per-turn permission flag
   * — `requestApproval` keeps interactive approvals in play, `approveForMe`
   * auto-approves, `fullAccess` bypasses gating. Absent → the adapter's
   * configured default posture (no behaviour change).
   */
  accessMode?: AccessMode;
  /**
   * Invoke an advertised agent command (from `agent/commands`) instead of
   * free-form {@link text}. The {@link AgentManager} resolves it before the
   * adapter runs — expanding a custom prompt-template via {@link
   * IAgentAdapter.expandCommand}, or composing the CLI's native `/name args`
   * form — and sets {@link text} to the result, so most adapters need no
   * per-command handling. Absent for an ordinary text turn.
   */
  command?: AgentCommandInvocation;
}

export interface IAgentAdapter {
  readonly agentId: AgentId;
  readonly capabilities: AgentCapabilities;

  /** Start (or attach to) the agent runtime for the given config. */
  start(config: AgentConfig): Promise<void>;

  /** Stop the agent runtime and release resources. */
  stop(): Promise<void>;

  /** Send a user turn; streamed events are delivered via {@link onEvent}. */
  sendTurn(options: SendTurnOptions): Promise<void>;

  /** Cancel an in-flight turn. */
  cancelTurn(threadId: string, turnId: string): Promise<void>;

  /**
   * Reply to a pending approval the agent emitted (as an `approval` content
   * block) for {@link threadId}. Optional: adapters that never request approval
   * (or that run non-interactively) don't implement it. Implementations should
   * be a no-op when there is no pending approval for `approvalId`.
   */
  respondApproval?(threadId: string, approvalId: string, decision: ApprovalDecision): Promise<void>;

  /** Subscribe to streaming events. Returns an unsubscribe function. */
  onEvent(listener: (event: AgentStreamEvent) => void): () => void;

  /** List the models this agent's CLI reports as available (optional). */
  listModels?(): Promise<AgentModel[]>;

  /**
   * List the special ("slash") commands this agent exposes — control commands
   * reachable headless plus user-defined prompt-template commands scanned from
   * disk (optional; adapters with none simply don't implement it). `cwd` is the
   * thread/project directory so project-scoped custom commands (`<cwd>/.claude/
   * commands`, `<cwd>/.gemini/commands`, …) are discovered alongside user-level
   * ones. Discovery only; invocation flows through {@link sendTurn} with {@link
   * SendTurnOptions.command}.
   */
  listCommands?(cwd?: string): Promise<AgentCommand[]>;

  /**
   * Resolve a custom prompt-template command to the final prompt text (reads the
   * template file from `cwd`/user config, substitutes arguments). Implemented
   * only by adapters whose commands are prompt templates the bridge expands
   * itself (Codex/Gemini/OpenCode); adapters whose commands run natively (Claude
   * Code, ACP agents) leave it unset and receive the composed `/name args` form
   * as {@link SendTurnOptions.text}. Throw if `name` is not a known custom command.
   */
  expandCommand?(name: string, args?: string, cwd?: string): Promise<string>;
}
