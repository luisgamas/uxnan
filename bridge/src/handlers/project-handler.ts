/**
 * Project JSON-RPC handlers — the registry every client mirrors
 * (architecture/02a §5.8.5, §5.8.17): list, resolve a folder, add, remove and
 * rename. Changes are announced by the registry itself (`stream/project/*`).
 *
 * A phone may only register a folder inside the bridge's browse roots (the
 * shared start folder, plus any configured roots) — the same boundary its
 * folder browser has. Uxnan Desktop, on the local channel, publishes the
 * projects the user already opened on this machine, wherever they are.
 */
import { JsonRpcErrorCode, RpcError } from '@uxnan/shared';
import { stat } from 'node:fs/promises';
import type { BridgeContext } from '../bridge-context.js';
import type { HandlerRouter } from '../handler-router.js';
import { canonicalFolder } from '../projects/project-registry.js';
import { asObject, optionalString, requireString } from './params.js';

/** `name` may be empty (it restores the folder's name) but must be a string. */
function requireName(params: unknown): string {
  const name = asObject(params)['name'];
  if (typeof name !== 'string') throw RpcError.invalidParams('name must be a string');
  return name;
}

export function registerProjectHandlers(router: HandlerRouter): void {
  router.register('project/list', (_p, ctx: BridgeContext) => ctx.projects.list());
  router.register('project/resolve', (p, ctx: BridgeContext) =>
    ctx.projects.resolve(requireString(p, 'cwd')),
  );
  router.register('project/add', async (p, ctx: BridgeContext, session) => {
    const cwd = await canonicalFolder(requireString(p, 'cwd'));
    try {
      if (!(await stat(cwd)).isDirectory()) throw new Error('not a directory');
    } catch {
      throw new RpcError(JsonRpcErrorCode.InvalidParams, `not a folder: ${cwd}`);
    }
    const local = session?.local !== undefined;
    if (!local && !ctx.browse.contains(cwd)) {
      throw new RpcError(
        JsonRpcErrorCode.WorkspaceAccessDenied,
        'that folder is outside the start folder this bridge shares',
      );
    }
    const name = optionalString(p, 'name');
    return ctx.projects.add(cwd, {
      source: local ? 'desktop' : 'user',
      ...(name !== undefined ? { name } : {}),
    });
  });
  router.register('project/remove', async (p, ctx: BridgeContext) => ({
    removed: await ctx.projects.remove(requireString(p, 'projectId')),
  }));
  router.register('project/rename', (p, ctx: BridgeContext) =>
    ctx.projects.rename(requireString(p, 'projectId'), requireName(p)),
  );
}
