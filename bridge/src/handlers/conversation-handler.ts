/**
 * Conversations as a catalog (architecture/02a §5.8.21): continuing one with
 * another agent — or the same one, as a fork — and searching what was said in
 * all of them. One path, whichever method asks:
 *
 * - `thread/transfer` — continue [sourceThreadId] with any agent, in its folder;
 * - `thread/fork` — the same, with the source's own agent and its history copied;
 * - `thread/start { continueFrom }` — from the new-conversation screen, where
 *   the folder, agent and model are already chosen.
 *
 * Each makes a NEW conversation (no conversation ever changes agent, and no CLI
 * continues another's native session), records where it came from on both
 * ends, and prepares the context its first message carries: built here, by
 * the owner of the history, from the source's digests
 * (`conversation/transfer-context.ts`).
 */
import {
  JsonRpcErrorCode,
  RpcError,
  TRANSFER_STRATEGIES,
  type AgentId,
  type ThreadTransferResult,
  type TransferStrategy,
} from '@uxnan/shared';
import type { BridgeContext } from '../bridge-context.js';
import type { HandlerRouter, RequestSession } from '../handler-router.js';
import type { TransferThreadResult } from '../conversation/thread-store.js';
import { buildTransferContext } from '../conversation/transfer-context.js';
import { originOf, turnRuntimeOptions } from './turn-runtime.js';
import { withLiveState } from './sync-handler.js';
import {
  asObject,
  optionalBoolean,
  optionalNumber,
  optionalString,
  requireString,
} from './params.js';

/** Longest idempotency key accepted. */
const MAX_TRANSFER_KEY_CHARS = 128;

/** What to continue, and how — every field but the source optional. */
export interface ContinueRequest {
  sourceThreadId: string;
  strategy: TransferStrategy;
  agentId?: AgentId;
  model?: string;
  title?: string;
  /** Another folder (the new-conversation screen's); absent → the source's. */
  cwd?: string;
  key?: string;
  createdBy: 'user' | 'agent';
}

/**
 * Makes the continuation [request] describes: the new conversation, with its
 * context prepared and both ends recorded. A key already used on the same
 * source returns that continuation (`created: false`).
 */
export async function continueConversation(
  ctx: BridgeContext,
  request: ContinueRequest,
  session: RequestSession | undefined,
): Promise<TransferThreadResult> {
  const source = await ctx.threadStore.getThread(request.sourceThreadId);
  const agentId =
    request.agentId ?? (source.agentId as AgentId | undefined) ?? ctx.agentManager.defaultAgent;
  if (ctx.agentManager.isDeprecated(agentId)) {
    throw new RpcError(
      JsonRpcErrorCode.AgentNotRunning,
      `agent '${agentId}' is deprecated and cannot start new threads`,
    );
  }
  if (!ctx.agentManager.listAgents().some((agent) => agent.agentId === agentId)) {
    throw RpcError.invalidParams(`unknown agent: ${agentId}`);
  }
  // The source's model only means something to the source's agent.
  const model = request.model ?? (agentId === source.agentId ? source.model : undefined);
  // A continuation lives where its source lives — without registering that
  // folder again: continuing a conversation of a project someone removed must
  // not bring the project back. A folder the person picked is a new start,
  // and registers its project like any conversation started there.
  const cwd = request.cwd ?? source.cwd;
  const projectId =
    request.cwd !== undefined
      ? (await ctx.projects.add(request.cwd, { source: 'thread' })).id
      : source.projectId;
  const sourceAgent = ctx.agentManager
    .listAgents()
    .find((agent) => agent.agentId === source.agentId)?.displayName;
  const context = buildTransferContext(
    {
      threadId: source.id,
      title: source.title,
      ...(sourceAgent !== undefined ? { agentName: sourceAgent } : {}),
      ...(source.cwd !== undefined ? { cwd: source.cwd } : {}),
      turns: await ctx.threadStore.digestTurns(source.id),
    },
    request.strategy,
  );
  const accessMode = ctx.agentManager.defaultAccessModeOf(agentId);
  const origin = originOf(ctx, session);
  return ctx.threadStore.transferThread(
    {
      sourceThreadId: source.id,
      strategy: request.strategy,
      projectId,
      ...(cwd !== undefined ? { cwd } : {}),
      agentId,
      ...(model !== undefined ? { model } : {}),
      ...(request.title !== undefined ? { title: request.title } : {}),
      ...(origin !== undefined ? { origin } : {}),
      ...(accessMode !== undefined ? { accessMode } : {}),
      createdBy: request.createdBy,
      ...(request.key !== undefined ? { key: request.key } : {}),
      context,
    },
    ctx.now(),
  );
}

/** `strategy`, validated; absent → `selection`. */
export function optionalStrategy(params: unknown, key = 'strategy'): TransferStrategy {
  const value = optionalString(params, key);
  if (value === undefined) return 'selection';
  if ((TRANSFER_STRATEGIES as readonly string[]).includes(value)) return value as TransferStrategy;
  throw RpcError.invalidParams(`${key} must be one of ${TRANSFER_STRATEGIES.join(' | ')}`);
}

/** `clientTransferId`, validated. */
export function optionalTransferKey(params: unknown): string | undefined {
  const value = optionalString(params, 'clientTransferId');
  if (value === undefined) return undefined;
  if (value.length === 0 || value.length > MAX_TRANSFER_KEY_CHARS) {
    throw RpcError.invalidParams(`clientTransferId must be 1–${MAX_TRANSFER_KEY_CHARS} characters`);
  }
  return value;
}

/** `createdBy`: only `agent` is worth saying; anything else is the person. */
export function createdByOf(params: unknown): 'user' | 'agent' {
  return optionalString(params, 'createdBy') === 'agent' ? 'agent' : 'user';
}

export function registerConversationHandlers(router: HandlerRouter): void {
  router.register(
    'thread/transfer',
    async (p, ctx: BridgeContext, session): Promise<ThreadTransferResult> => {
      const message = optionalString(p, 'message');
      const agentId = optionalString(p, 'agentId') as AgentId | undefined;
      const model = optionalString(p, 'model');
      const title = optionalString(p, 'title');
      const key = optionalTransferKey(p);
      const made = await continueConversation(
        ctx,
        {
          sourceThreadId: requireString(p, 'sourceThreadId'),
          strategy: optionalStrategy(p),
          ...(agentId !== undefined ? { agentId } : {}),
          ...(model !== undefined ? { model } : {}),
          ...(title !== undefined && title.trim().length > 0 ? { title: title.trim() } : {}),
          ...(key !== undefined ? { key } : {}),
          createdBy: createdByOf(p),
        },
        session,
      );
      const thread = withLiveState(made.thread, ctx);
      // A retry under the same key made nothing, so it sends nothing either.
      if (!made.created || message === undefined || message.trim().length === 0) {
        return { thread, created: made.created };
      }
      const sent = await ctx.agentManager.sendTurn(
        thread.id,
        message,
        await turnRuntimeOptions(ctx, thread.id, session),
      );
      return { thread, created: true, turnId: sent.turnId };
    },
  );
  router.register('thread/transferContext', (p, ctx: BridgeContext) =>
    ctx.threadStore.transferContext(requireString(p, 'threadId')),
  );
  router.register('thread/search', (p, ctx: BridgeContext) => {
    asObject(p);
    const projectId = optionalString(p, 'projectId');
    const includeArchived = optionalBoolean(p, 'includeArchived');
    const limit = optionalNumber(p, 'limit');
    const cursor = optionalString(p, 'cursor');
    return ctx.threadSearch.search({
      query: requireString(p, 'query'),
      ...(projectId !== undefined ? { projectId } : {}),
      ...(includeArchived !== undefined ? { includeArchived } : {}),
      ...(limit !== undefined ? { limit } : {}),
      ...(cursor !== undefined ? { cursor } : {}),
    });
  });
}
