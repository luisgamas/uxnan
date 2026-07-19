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
  /** Antigravity — Google's `agy` CLI, the successor to the deprecated Gemini CLI. */
  | 'antigravity-cli'
  | 'pi-agent'
  /** Zero — open-source Go coding agent, driven over the Agent Client Protocol. */
  | 'zero'
  /** Grok — xAI's coding CLI, driven over the Agent Client Protocol (`grok agent stdio`). */
  | 'grok'
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
  /**
   * Agent runs in autonomous ("YOLO") mode by default — it acts and edits
   * without per-action approval prompts because its headless CLI exposes no
   * pre-tool approval channel. The phone surfaces this so the user knows Pi
   * (and any such agent) will not ask before running tools. Optional; absent/
   * false means the agent either gates tools or is pending approval wiring.
   */
  autonomous?: boolean;
  /**
   * Agent exposes special ("slash") commands the phone can discover via
   * `agent/commands` and invoke through `turn/send` `command`. Optional for
   * back-compat; absent/false means the agent advertises none (the phone shows
   * only its client-side `/` palette). See {@link AgentCommand}.
   */
  commands?: boolean;
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
  /**
   * Context-window size in tokens, when the CLI reports it (e.g. pi's
   * `--list-models` `context` column). Lets the adapter emit `usage.contextWindow`
   * per turn so the phone can show context usage as a percentage. Absent when the
   * CLI does not expose it.
   */
  contextWindow?: number;
  /**
   * Marks a moving-target "latest" alias (Claude Code's `opus`/`sonnet`/`haiku`,
   * each of which always routes to the newest version of that tier the account
   * can use — see {@link version} for the resolved concrete id). Concrete/pinned
   * models leave this absent. Presentation-only: lets a client offer to
   * hide the aliases and show exact versions only, without hardcoding ids.
   */
  isLatestAlias?: boolean;
}

/**
 * A special ("slash") command an agent exposes, returned by `agent/commands`.
 *
 * Two kinds are unified under this one shape:
 * - **control** commands the CLI understands in its headless/programmatic mode
 *   (Claude Code's `/compact` sent as the prompt with `--resume`; the commands
 *   ACP agents advertise via `available_commands_update`), and
 * - **custom** user-defined prompt-template commands (`.claude/commands`,
 *   `~/.codex/prompts`, `.gemini/commands`, `.opencode/command`) that the bridge
 *   expands itself before running a normal turn.
 *
 * The phone is a generic renderer: it lists the advertised commands in its `/`
 * palette and, when one is picked, echoes it back on `turn/send` under
 * {@link AgentCommandInvocation} — the bridge resolves it to the final prompt
 * text (expanded template) or the CLI's native `/name args` form. Consumers MUST
 * tolerate absent optional fields so a newer bridge advertising a richer command
 * never breaks an older app.
 */
export interface AgentCommand {
  /** Command name WITHOUT the leading slash (e.g. `compact`, `refactor`). */
  name: string;
  /** One-line description for the palette, when the source provides one. */
  description?: string;
  /** Hint for the arguments the command accepts (e.g. `<file> <priority>`). */
  argumentHint?: string;
  /**
   * Where the command comes from: `acp` (advertised by an ACP agent),
   * `builtin` (a CLI control command reachable headless), or `custom` (a
   * user-defined prompt-template file the bridge expands).
   */
  source: 'acp' | 'builtin' | 'custom';
  /**
   * Whether the command actually runs in the agent's headless/programmatic mode.
   * Absent/true means yes; `false` marks a command that only works in the CLI's
   * interactive TUI, which the phone should hide. The bridge only advertises
   * commands it can run, so this is a belt-and-suspenders gate.
   */
  headlessSupported?: boolean;
}

/**
 * A picked {@link AgentCommand} carried on `turn/send` under `command`, instead
 * of free-form `text`. The bridge resolves `{ name, args }` to the final prompt.
 */
export interface AgentCommandInvocation {
  /** The command's {@link AgentCommand.name} (no leading slash). */
  name: string;
  /** Raw argument string the user appended after the command, if any. */
  args?: string;
}
