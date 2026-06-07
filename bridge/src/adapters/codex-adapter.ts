/**
 * OpenAI Codex CLI adapter (MVP-priority agent).
 *
 * Extends {@link ProcessAgentAdapter} with Codex's binary and capabilities. It
 * currently INHERITS the generic bridge agent IPC, which the real Codex CLI does
 * NOT speak.
 *
 * FOR-DEV: Codex is a one-shot-per-turn CLI like OpenCode, so the real adapter
 * should follow `opencode-adapter.ts` (NOT the persistent-stdio ProcessAgentAdapter):
 * spawn `codex exec --json [-m model] [resume <sessionId>] <prompt>` with stdin
 * ignored, map its JSONL events to bridge events, keep the session id per thread,
 * then register it in `startBridge`. See the "Adding the next agent" recipe in
 * bridge/FOR-DEV.md. Not wired by default until then.
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
