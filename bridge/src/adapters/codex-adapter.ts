/**
 * OpenAI Codex CLI adapter (MVP-priority agent).
 *
 * Extends {@link ProcessAgentAdapter} with Codex's binary and capabilities. It
 * currently INHERITS the generic bridge agent IPC, which the real Codex CLI does
 * NOT speak.
 *
 * FOR-DEV: override `formatTurn`/`parseLine` to translate the real Codex CLI
 * invocation and streaming output (its `exec`/proto JSON events) into the bridge
 * IPC, then register it in `startBridge`. Until then it is not wired by default.
 * See bridge/FOR-DEV.md.
 */
import type { AgentCapabilities } from '@uxnan/shared';
import { ProcessAgentAdapter } from './process-agent-adapter.js';

const CODEX_CAPABILITIES: AgentCapabilities = {
  planMode: true,
  streaming: true,
  approvals: true,
  forking: true,
  images: true,
};

export class CodexAdapter extends ProcessAgentAdapter {
  constructor(binaryPath = 'codex') {
    super({ agentId: 'codex', capabilities: CODEX_CAPABILITIES, binaryPath });
  }
}
