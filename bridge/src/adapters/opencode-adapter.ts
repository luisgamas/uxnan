/**
 * OpenCode adapter (MVP-priority agent).
 *
 * Extends {@link ProcessAgentAdapter} with OpenCode's binary and capabilities. It
 * currently INHERITS the generic bridge agent IPC, which OpenCode does NOT speak.
 *
 * FOR-DEV: override `formatTurn`/`parseLine` to translate OpenCode's real CLI
 * invocation and stream/SQLite session output into the bridge IPC, then register
 * it in `startBridge`. Until then it is not wired by default. See bridge/FOR-DEV.md.
 */
import type { AgentCapabilities } from '@uxnan/shared';
import { ProcessAgentAdapter } from './process-agent-adapter.js';

const OPENCODE_CAPABILITIES: AgentCapabilities = {
  planMode: false,
  streaming: true,
  approvals: false,
  forking: false,
  images: false,
};

export class OpenCodeAdapter extends ProcessAgentAdapter {
  constructor(binaryPath = 'opencode') {
    super({ agentId: 'opencode', capabilities: OPENCODE_CAPABILITIES, binaryPath });
  }
}
