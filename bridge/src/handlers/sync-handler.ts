/**
 * Replica sync and shared settings (architecture/02a §5.8.17).
 *
 * `sync/changes { since, storeId }` is how a client catches up without trusting
 * that it saw every notification: everything that changed after its last
 * revision, or — when that cannot be answered incrementally — a full snapshot
 * flagged `reset`. It is the call a client makes on every (re)connect and app
 * resume, and whenever a notification's revision skips one.
 */
import { RpcError, type SyncChanges, type Thread } from '@uxnan/shared';
import type { BridgeContext } from '../bridge-context.js';
import type { HandlerRouter, RequestSession } from '../handler-router.js';
import { decisionTime } from '../conversation/thread-store.js';
import { MAX_DEVICE_NAME_LENGTH } from '../transport/trust-store.js';
import { asObject, optionalAge, optionalString, requireString } from './params.js';

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
    devices: await ctx.trustStore.list(),
  };
}

export function registerSyncHandlers(router: HandlerRouter): void {
  router.register('sync/changes', (p, ctx: BridgeContext) =>
    syncChanges(ctx, optionalRevision(p), optionalString(p, 'storeId')),
  );
  router.register('settings/get', (_p, ctx: BridgeContext) => ctx.settings.get());
  router.register('settings/set', (p, ctx: BridgeContext) => {
    const now = ctx.now();
    return ctx.settings.set(
      { home: optionalString(p, 'home'), name: optionalString(p, 'name') },
      decisionTime(now, optionalAge(p)),
    );
  });

  // Paired phones' names: a phone describes itself; anyone may rename one.
  router.register('device/describe', (p, ctx: BridgeContext, session?: RequestSession) => {
    if (session === undefined || session.local !== undefined) {
      throw RpcError.invalidParams('only a paired phone describes itself');
    }
    const now = ctx.now();
    const nameAge = optionalAge(p, 'nameAgeMs');
    return ctx.trustStore.describe(
      session.deviceId,
      {
        name: requireDeviceName(p, 'name'),
        ...optionalDetail(p, 'model'),
        ...optionalDetail(p, 'platform'),
        ...optionalDetail(p, 'osVersion'),
        ...optionalDetail(p, 'appVersion'),
      },
      now,
      nameAge === undefined ? undefined : decisionTime(now, nameAge),
    );
  });
  router.register('device/rename', (p, ctx: BridgeContext) => {
    const name = optionalString(p, 'name') ?? '';
    return ctx.trustStore.rename(
      requireString(p, 'deviceId'),
      name.length === 0 ? '' : requireDeviceName(p, 'name'),
      decisionTime(ctx.now(), optionalAge(p)),
    );
  });
}

/** A phone's name: 1..80 printable characters, trimmed. */
function requireDeviceName(params: unknown, key: string): string {
  const name = requireString(params, key).trim();
  if (
    name.length === 0 ||
    name.length > MAX_DEVICE_NAME_LENGTH ||
    /[\u0000-\u001f\u007f]/.test(name)
  ) {
    throw RpcError.invalidParams(
      `'${key}' must be 1 to ${MAX_DEVICE_NAME_LENGTH} printable characters`,
    );
  }
  return name;
}

/** An optional short descriptive field, dropped when absent or blank. */
function optionalDetail(params: unknown, key: string): Record<string, string> {
  const value = optionalString(params, key)?.trim();
  return value ? { [key]: value.slice(0, 80) } : {};
}
