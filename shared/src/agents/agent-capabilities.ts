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
