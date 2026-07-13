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
  router.register(
    'agent/list',
    (_p, ctx: BridgeContext): AgentListResult => ({ agents: ctx.agentManager.listAgents() }),
  );
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
