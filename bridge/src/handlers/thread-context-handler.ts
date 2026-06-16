/**
 * Thread/turn JSON-RPC handlers — conversation CRUD backed by the
 * {@link ThreadStore}, with `turn/send` driving the {@link AgentManager}.
 * Streaming output reaches the phone via `stream/*` notifications.
 *
 * Source: architecture/02a-system-architecture.md §5.8.8.
 */
import { RpcError } from '@uxnan/shared';
import type { AgentId, Turn, TurnAttachment, TurnList } from '@uxnan/shared';
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
    // The phone provides the cwd (e.g. a folder-browser directory, which
    // `project/resolve` SYNTHESIZES into a project that is NOT in
    // workspaceRoots). Use that cwd directly; only resolve the project by id to
    // get a cwd fallback when none is given — otherwise a browsed folder failed
    // `byId` with "unknown project", and the thread was never created.
    const cwd = optionalString(p, 'cwd') ?? ctx.projects.byId(projectId).cwd;
    // Per-project pin: when the phone omits agent/model, fall back to the
    // project's configured agent (then the bridge's global default). The pinned
    // model only applies when the resolved agent IS the pinned one, so we never
    // force one agent's model onto a thread the phone steered to another agent.
    const pin = ctx.projects.agentConfigFor(cwd);
    const explicitAgent = optionalString(p, 'agentId') as AgentId | undefined;
    const agentId = explicitAgent ?? pin?.agentId ?? ctx.agentManager.defaultAgent;
    const explicitModel = optionalString(p, 'model');
    const model = explicitModel ?? (pin && agentId === pin.agentId ? pin.model : undefined);
    return ctx.threadStore.startThread(
      {
        projectId,
        ...(optionalString(p, 'title') !== undefined ? { title: optionalString(p, 'title') } : {}),
        agentId,
        ...(model !== undefined ? { model } : {}),
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
  router.register('thread/setModel', async (p, ctx: BridgeContext) => {
    await ctx.threadStore.setModel(
      requireString(p, 'threadId'),
      requireString(p, 'model'),
      ctx.now(),
    );
    return null;
  });
  router.register('thread/rename', (p, ctx: BridgeContext) =>
    ctx.threadStore.renameThread(
      requireString(p, 'threadId'),
      requireString(p, 'title'),
      ctx.now(),
    ),
  );
  router.register('thread/archive', (p, ctx: BridgeContext) =>
    ctx.threadStore.archiveThread(requireString(p, 'threadId'), ctx.now()),
  );
  router.register('thread/unarchive', (p, ctx: BridgeContext) =>
    ctx.threadStore.unarchiveThread(requireString(p, 'threadId'), ctx.now()),
  );
  router.register('thread/delete', async (p, ctx: BridgeContext) => {
    await ctx.threadStore.deleteThread(requireString(p, 'threadId'));
    return null;
  });

  router.register('turn/list', async (p, ctx: BridgeContext) => {
    const threadId = requireString(p, 'threadId');
    const cursor = optionalString(p, 'cursor');
    const limit = optionalNumber(p, 'limit');
    const stored = await ctx.threadStore.listTurns(threadId, cursor, limit);
    // Fallback (§5.8.8): when the store has nothing for this thread, read the
    // agent's own on-disk session log so the phone can still show history (e.g.
    // after the bridge missed the turns, or threads.json was lost).
    if (stored.turns.length > 0 || stored.nextCursor) return stored;
    const source = await ctx.threadStore.getHistorySource(threadId);
    const turns = await ctx.sessionHistory.readTurns(source, threadId);
    if (!turns || turns.length === 0) return stored;
    return paginateTurns(turns, cursor, limit);
  });
  router.register('turn/read', (p, ctx: BridgeContext) =>
    ctx.threadStore.getTurn(requireString(p, 'turnId')),
  );
  router.register('turn/send', async (p, ctx: BridgeContext) => {
    const threadId = requireString(p, 'threadId');
    // `text` is OPTIONAL: an image-only message (empty text + attachments) is
    // valid, so we no longer hard-require a non-empty string. Reject only when
    // there is neither text nor an attachment to act on.
    const text = optionalString(p, 'text') ?? '';
    const attachments = optionalAttachments(p);
    if (text.length === 0 && attachments.length === 0) {
      throw RpcError.invalidParams('turn/send requires non-empty text or attachments');
    }
    const runtime = await ctx.threadStore.getThreadRuntime(threadId);
    // A turn runs with the thread's agent/model/cwd; explicit params override.
    const service = optionalString(p, 'service') ?? runtime.model;
    const options: SendTurnOptions = {
      ...(runtime.agentId !== undefined ? { agentId: runtime.agentId as AgentId } : {}),
      ...(service !== undefined ? { service } : {}),
      ...optionalEffort(p),
      ...optionalRunOptions(p),
      ...(attachments.length > 0 ? { attachments } : {}),
      ...(runtime.cwd !== undefined ? { cwd: runtime.cwd } : {}),
    };
    return ctx.agentManager.sendTurn(threadId, text, options);
  });
  router.register('turn/cancel', async (p, ctx: BridgeContext) => {
    await ctx.agentManager.cancelTurn(requireString(p, 'threadId'), requireString(p, 'turnId'));
    return null;
  });
}

/**
 * Page a full turn list (from the on-disk history fallback) the same way the
 * store does: numeric cursor offset + limit, with a `nextCursor` when more remain.
 */
function paginateTurns(
  turns: Turn[],
  cursor: string | undefined,
  limit: number | undefined,
): TurnList {
  const start = cursor ? Number.parseInt(cursor, 10) || 0 : 0;
  const size = limit && limit > 0 ? limit : 20;
  const result: TurnList = { turns: turns.slice(start, start + size) };
  if (start + size < turns.length) result.nextCursor = String(start + size);
  return result;
}

function optionalEffort(params: unknown): { effort?: string } {
  const value = optionalString(params, 'effort');
  return value === undefined ? {} : { effort: value };
}

/**
 * Extracts the inline `attachments` from `turn/send` params, keeping only
 * well-formed image entries (a `mimeType` plus at least one of
 * `base64Data`/`path`). Tolerant — malformed entries are dropped, never thrown,
 * so an older/garbled client degrades to a text turn instead of an error.
 */
function optionalAttachments(params: unknown): TurnAttachment[] {
  if (!params || typeof params !== 'object') return [];
  const raw = (params as Record<string, unknown>)['attachments'];
  if (!Array.isArray(raw)) return [];
  const out: TurnAttachment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const mimeType = typeof obj['mimeType'] === 'string' ? obj['mimeType'] : 'application/octet-stream';
    const base64Data = typeof obj['base64Data'] === 'string' ? obj['base64Data'] : undefined;
    const path = typeof obj['path'] === 'string' ? obj['path'] : undefined;
    if (base64Data === undefined && path === undefined) continue;
    const att: TurnAttachment = { type: 'image', mimeType };
    if (base64Data !== undefined) att.base64Data = base64Data;
    if (path !== undefined) att.path = path;
    if (typeof obj['width'] === 'number') att.width = obj['width'];
    if (typeof obj['height'] === 'number') att.height = obj['height'];
    out.push(att);
  }
  return out;
}

/**
 * Extracts the per-model run-option values (`{ options: { key: value } }`) from
 * `turn/send` params, keeping only string/boolean values (tolerant — unknown
 * shapes are dropped, never thrown).
 */
function optionalRunOptions(params: unknown): {
  options?: Record<string, string | boolean>;
} {
  if (!params || typeof params !== 'object') return {};
  const raw = (params as Record<string, unknown>)['options'];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string | boolean> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'string' || typeof value === 'boolean') out[key] = value;
  }
  return Object.keys(out).length > 0 ? { options: out } : {};
}
