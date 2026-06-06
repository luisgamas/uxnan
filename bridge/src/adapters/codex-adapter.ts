/**
 * OpenAI Codex CLI adapter.
 *
 * FOR-DEV: spawn and drive the Codex CLI, mapping its stream to AgentStreamEvent
 * and its session JSONL to the history fallback (src/adapters/codex-adapter.ts).
 * Codex is an MVP-priority agent. Unblocks: real conversations from mobile.
 */
import type { AgentCapabilities, AgentConfig, AgentId, SendTurnOptions } from '@uxnan/shared';
import { BaseAgentAdapter } from './base-adapter.js';

export class CodexAdapter extends BaseAgentAdapter {
  readonly agentId: AgentId = 'codex';
  readonly capabilities: AgentCapabilities = {
    planMode: true,
    streaming: true,
    approvals: true,
    forking: true,
    images: true,
  };

  start(_config: AgentConfig): Promise<void> {
    return Promise.reject(new Error('FOR-DEV: CodexAdapter.start not implemented'));
  }

  stop(): Promise<void> {
    return Promise.resolve();
  }

  sendTurn(_options: SendTurnOptions): Promise<void> {
    return Promise.reject(new Error('FOR-DEV: CodexAdapter.sendTurn not implemented'));
  }

  cancelTurn(_threadId: string, _turnId: string): Promise<void> {
    return Promise.reject(new Error('FOR-DEV: CodexAdapter.cancelTurn not implemented'));
  }
}
