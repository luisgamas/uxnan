/**
 * Agent JSON-RPC handlers — lets the phone discover which agents are registered
 * on this bridge (with capabilities + availability) so it can pick one per thread.
 *
 * Source: architecture/02a-system-architecture.md §5.8.2 (adapters).
 */
import type { AgentListResult } from '@uxnan/shared';
import type { BridgeContext } from '../bridge-context.js';
import type { HandlerRouter } from '../handler-router.js';

export function registerAgentHandlers(router: HandlerRouter): void {
  router.register(
    'agent/list',
    (_p, ctx: BridgeContext): AgentListResult => ({ agents: ctx.agentManager.listAgents() }),
  );
}
