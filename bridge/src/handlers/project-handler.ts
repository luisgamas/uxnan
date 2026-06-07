/**
 * Project JSON-RPC handlers — list the project directories the phone may open and
 * resolve one by cwd. Backed by the {@link ProjectRegistry} (configured
 * `workspaceRoots`, or the bridge's own cwd when none are set).
 *
 * Source: architecture/02a-system-architecture.md §5.8.5.
 */
import type { BridgeContext } from '../bridge-context.js';
import type { HandlerRouter } from '../handler-router.js';
import { requireString } from './params.js';

export function registerProjectHandlers(router: HandlerRouter): void {
  router.register('project/list', (_p, ctx: BridgeContext) => ctx.projects.list());
  router.register('project/resolve', (p, ctx: BridgeContext) =>
    ctx.projects.resolve(requireString(p, 'cwd')),
  );
}
