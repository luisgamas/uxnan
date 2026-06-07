/**
 * Per-project agent configuration.
 *
 * Source: architecture/02a-system-architecture.md §5.8.2.
 */
import type { AgentId } from './agent-capabilities.js';

export interface AgentConfig {
  agentId: AgentId;
  /** Absolute path to the agent CLI binary, or null to resolve from PATH. */
  binaryPath?: string;
  /** Extra CLI arguments passed on every invocation. */
  extraArgs?: string[];
  /** Working directory override; defaults to the project cwd. */
  cwd?: string;
}
