/**
 * Replica sync and shared settings (architecture/02a §5.8.17).
 *
 * `sync/changes { since, storeId }` is how a client catches up without trusting
 * that it saw every notification: everything that changed after its last
 * revision, or — when that cannot be answered incrementally — a full snapshot
 * flagged `reset`. It is the call a client makes on every (re)connect and app
 * resume, and whenever a notification's revision skips one.
 */
import type { SyncChanges, Thread } from '@uxnan/shared';
import type { BridgeContext } from '../bridge-context.js';
import type { HandlerRouter } from '../handler-router.js';
import { asObject, optionalString, requireString } from './params.js';

function optionalRevision(params: unknown): number | undefined {
  if (params === undefined || params === null) return undefined;
  const value = asObject(params)['since'];
  if (value === undefined || value === null) return undefined;
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/** A thread with its live state (never persisted) added. */
export function withLiveState(thread: Thread, ctx: BridgeContext): Thread {
  const activeTurnId = ctx.agentManager.activeTurnId(thread.id);
  return activeTurnId !== undefined ? { ...thread, activeTurnId } : thread;
}

export async function syncChanges(
  ctx: BridgeContext,
  since: number | undefined,
  storeId: string | undefined,
): Promise<SyncChanges> {
  const ledger = ctx.ledger;
  const reset =
    since === undefined ||
    storeId !== ledger.storeId ||
    since < ledger.horizon ||
    since > ledger.rev;
  const from = reset ? undefined : since;
  const threads = await ctx.threadStore.threadsChangedSince(from);
  return {
    storeId: ledger.storeId,
    rev: ledger.rev,
    reset,
    settings: ctx.settings.get(),
    projects: ctx.projects.changedSince(from),
    removedProjectIds: from === undefined ? [] : ledger.deletedSince('project', from),
    threads: threads.map((thread) => withLiveState(thread, ctx)),
    removedThreadIds: from === undefined ? [] : ledger.deletedSince('thread', from),
    clients: ctx.presence.list(),
  };
}

export function registerSyncHandlers(router: HandlerRouter): void {
  router.register('sync/changes', (p, ctx: BridgeContext) =>
    syncChanges(ctx, optionalRevision(p), optionalString(p, 'storeId')),
  );
  router.register('settings/get', (_p, ctx: BridgeContext) => ctx.settings.get());
  router.register('settings/set', async (p, ctx: BridgeContext) => {
    const home = optionalString(p, 'home');
    if (home !== undefined) await ctx.settings.setHome(requireString(p, 'home'));
    return ctx.settings.get();
  });
}
