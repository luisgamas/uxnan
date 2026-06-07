/**
 * Thread/turn JSON-RPC handlers — conversation CRUD backed by the
 * {@link ThreadStore}, with `turn/send` driving the {@link AgentManager}.
 * Streaming output reaches the phone via `stream/*` notifications.
 *
 * Source: architecture/02a-system-architecture.md §5.8.8.
 */
import type { BridgeContext } from '../bridge-context.js';
import type { HandlerRouter } from '../handler-router.js';
import { optionalNumber, optionalString, requireString } from './params.js';

export function registerThreadHandlers(router: HandlerRouter): void {
  router.register('thread/list', (p, ctx: BridgeContext) =>
    ctx.threadStore.listThreads(optionalString(p, 'projectId')),
  );
  router.register('thread/read', (p, ctx: BridgeContext) =>
    ctx.threadStore.getThread(requireString(p, 'threadId')),
  );
  router.register('thread/start', (p, ctx: BridgeContext) =>
    ctx.threadStore.startThread(
      requireString(p, 'projectId'),
      optionalString(p, 'title'),
      ctx.now(),
    ),
  );
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
  router.register('turn/send', (p, ctx: BridgeContext) => {
    const threadId = requireString(p, 'threadId');
    const text = requireString(p, 'text');
    const options = {
      ...optionalField(p, 'service'),
      ...optionalEffort(p),
    };
    return ctx.agentManager.sendTurn(threadId, text, options);
  });
  router.register('turn/cancel', async (p, ctx: BridgeContext) => {
    await ctx.agentManager.cancelTurn(requireString(p, 'threadId'), requireString(p, 'turnId'));
    return null;
  });
}

function optionalField(params: unknown, key: 'service'): { service?: string } {
  const value = optionalString(params, key);
  return value === undefined ? {} : { service: value };
}

function optionalEffort(params: unknown): { effort?: string } {
  const value = optionalString(params, 'effort');
  return value === undefined ? {} : { effort: value };
}
