/**
 * OpenCode adapter.
 *
 * FOR-DEV: drive the OpenCode runtime and read its SQLite session store
 * (src/adapters/opencode-adapter.ts). OpenCode is an MVP-priority agent.
 * Unblocks: real conversations from mobile.
 */
import type { AgentCapabilities, AgentConfig, AgentId, SendTurnOptions } from '@uxnan/shared';
import { BaseAgentAdapter } from './base-adapter.js';

export class OpenCodeAdapter extends BaseAgentAdapter {
  readonly agentId: AgentId = 'opencode';
  readonly capabilities: AgentCapabilities = {
    planMode: false,
    streaming: true,
    approvals: false,
    forking: false,
    images: false,
  };

  start(_config: AgentConfig): Promise<void> {
    return Promise.reject(new Error('FOR-DEV: OpenCodeAdapter.start not implemented'));
  }

  stop(): Promise<void> {
    return Promise.resolve();
  }

  sendTurn(_options: SendTurnOptions): Promise<void> {
    return Promise.reject(new Error('FOR-DEV: OpenCodeAdapter.sendTurn not implemented'));
  }

  cancelTurn(_threadId: string, _turnId: string): Promise<void> {
    return Promise.reject(new Error('FOR-DEV: OpenCodeAdapter.cancelTurn not implemented'));
  }
}
