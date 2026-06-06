/**
 * Built-in reference agent: streams the user's prompt back as deltas. It needs
 * no external CLI, so it exercises the full turn pipeline end-to-end (store +
 * streaming notifications) and is useful for mobile-side development and tests.
 */
import type { AgentCapabilities, AgentConfig, AgentId, SendTurnOptions } from '@uxnan/shared';
import { BaseAgentAdapter } from './base-adapter.js';

export class EchoAgentAdapter extends BaseAgentAdapter {
  readonly agentId: AgentId = 'echo';
  readonly capabilities: AgentCapabilities = {
    planMode: false,
    streaming: true,
    approvals: false,
    forking: false,
    images: false,
  };

  start(_config: AgentConfig): Promise<void> {
    return Promise.resolve();
  }

  stop(): Promise<void> {
    return Promise.resolve();
  }

  sendTurn(options: SendTurnOptions): Promise<void> {
    const { threadId, turnId, text } = options;
    this.emit({ type: 'turn_started', threadId, turnId });
    for (const chunk of text.split(/(\s+)/).filter((part) => part.length > 0)) {
      this.emit({ type: 'delta', threadId, turnId, data: { text: chunk } });
    }
    this.emit({ type: 'turn_completed', threadId, turnId, data: { text } });
    return Promise.resolve();
  }

  cancelTurn(threadId: string, turnId: string): Promise<void> {
    this.emit({ type: 'turn_aborted', threadId, turnId });
    return Promise.resolve();
  }
}
