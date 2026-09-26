/**
 * Agent JSON-RPC handlers — lets the phone discover which agents are registered
 * on this bridge (with capabilities + availability) so it can pick one per thread.
 *
 * Source: architecture/02a-system-architecture.md §5.8.2 (adapters).
 */
import type {
  AgentCommandsResult,
  AgentId,
  AgentListResult,
  AgentModelsResult,
} from '@uxnan/shared';
import type { BridgeContext } from '../bridge-context.js';
import type { HandlerRouter } from '../handler-router.js';
import { optionalString, requireString } from './params.js';

export function registerAgentHandlers(router: HandlerRouter): void {
  // Re-checks what is installed (at most every few seconds) before answering,
  // so an agent installed while the bridge runs shows up (agents/agent-installs.ts).
  router.register('agent/list', (_p, ctx: BridgeContext): AgentListResult => {
    ctx.agentInstalls.refresh();
    return { agents: ctx.agentManager.listAgents() };
  });
  router.register('agent/doctor', (_p, ctx: BridgeContext) => {
    ctx.agentInstalls.refresh(true);
    return { agents: ctx.agentInstalls.diagnose() };
  });
  router.register(
    'agent/models',
    async (p, ctx: BridgeContext): Promise<AgentModelsResult> => ({
      models: await ctx.agentManager.getModels(requireString(p, 'agentId') as AgentId),
    }),
  );
  router.register(
    'agent/commands',
    async (p, ctx: BridgeContext): Promise<AgentCommandsResult> => ({
      commands: await ctx.agentManager.getCommands(
        requireString(p, 'agentId') as AgentId,
        optionalString(p, 'cwd'),
      ),
    }),
  );
}
