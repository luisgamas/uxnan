/**
 * Thread/turn JSON-RPC handlers — conversation CRUD backed by the
 * {@link ThreadStore}, with `turn/send` driving the {@link AgentManager}.
 * Streaming output reaches the phone via `stream/*` notifications.
 *
 * Source: architecture/02a-system-architecture.md §5.8.8.
 */
import type { AgentId } from '@uxnan/shared';
import type { BridgeContext } from '../bridge-context.js';
import type { HandlerRouter } from '../handler-router.js';
import type { SendTurnOptions } from '../agents/agent-manager.js';
import { optionalNumber, optionalString, requireString } from './params.js';

export function registerThreadHandlers(router: HandlerRouter): void {
  router.register('thread/list', (p, ctx: BridgeContext) =>
    ctx.threadStore.listThreads(optionalString(p, 'projectId')),
  );
  router.register('thread/read', (p, ctx: BridgeContext) =>
    ctx.threadStore.getThread(requireString(p, 'threadId')),
  );
  router.register('thread/start', (p, ctx: BridgeContext) => {
    const projectId = requireString(p, 'projectId');
    const project = ctx.projects.byId(projectId);
    const agentId =
      (optionalString(p, 'agentId') as AgentId | undefined) ?? ctx.agentManager.defaultAgent;
    const cwd = optionalString(p, 'cwd') ?? project.cwd;
    return ctx.threadStore.startThread(
      {
        projectId,
        ...(optionalString(p, 'title') !== undefined ? { title: optionalString(p, 'title') } : {}),
        agentId,
        ...(optionalString(p, 'model') !== undefined ? { model: optionalString(p, 'model') } : {}),
        cwd,
      },
      ctx.now(),
    );
  });
  router.register('thread/resume', (p, ctx: BridgeContext) =>
    ctx.threadStore.resumeThread(requireString(p, 'threadId'), ctx.now()),
  );
  router.register('thread/fork', (p, ctx: BridgeContext) =>
    ctx.threadStore.forkThread(requireString(p, 'threadId'), ctx.now()),
  );

  router.register('turn/list', (p, ctx: BridgeContext) =>
    ctx.threadStore.listTurns(
      requireString(p, 'threadId'),
      optionalString(p, 'cursor'),
      optionalNumber(p, 'limit'),
    ),
  );
  router.register('turn/read', (p, ctx: BridgeContext) =>
    ctx.threadStore.getTurn(requireString(p, 'turnId')),
  );
  router.register('turn/send', async (p, ctx: BridgeContext) => {
    const threadId = requireString(p, 'threadId');
    const text = requireString(p, 'text');
    const runtime = await ctx.threadStore.getThreadRuntime(threadId);
    // A turn runs with the thread's agent/model/cwd; explicit params override.
    const service = optionalString(p, 'service') ?? runtime.model;
    const options: SendTurnOptions = {
      ...(runtime.agentId !== undefined ? { agentId: runtime.agentId as AgentId } : {}),
      ...(service !== undefined ? { service } : {}),
      ...optionalEffort(p),
      ...(runtime.cwd !== undefined ? { cwd: runtime.cwd } : {}),
    };
    return ctx.agentManager.sendTurn(threadId, text, options);
  });
  router.register('turn/cancel', async (p, ctx: BridgeContext) => {
    await ctx.agentManager.cancelTurn(requireString(p, 'threadId'), requireString(p, 'turnId'));
    return null;
  });
}

function optionalEffort(params: unknown): { effort?: string } {
  const value = optionalString(params, 'effort');
  return value === undefined ? {} : { effort: value };
}
