/**
 * Workspace JSON-RPC handlers — file reads, listing and patch application,
 * confined to the project root with sensitive files excluded.
 *
 * Checkpoints (capture/diff/apply) are deferred to a follow-up increment
 * (FOR-DEV) and remain registered as clear not-implemented stubs.
 *
 * Source: architecture/02a-system-architecture.md §5.8.7 / §5.8.9.
 */
import { RpcError, type PatchChange } from '@uxnan/shared';
import type { HandlerRouter } from '../handler-router.js';
import { WorkspaceService } from '../workspace/workspace-service.js';
import { asObject, optionalString, requireArray, requireString } from './params.js';
import { registerStubs } from './not-implemented.js';

const CHECKPOINT_METHODS = [
  'workspace/checkpoint',
  'workspace/diffCheckpoint',
  'workspace/applyCheckpoint',
] as const;

export function registerWorkspaceHandlers(router: HandlerRouter): void {
  const ws = new WorkspaceService();

  router.register('workspace/readFile', (p) =>
    ws.readFile(requireString(p, 'cwd'), requireString(p, 'path')),
  );
  router.register('workspace/readImage', (p) =>
    ws.readImage(requireString(p, 'cwd'), requireString(p, 'path')),
  );
  router.register('workspace/list', (p) => ws.list(requireString(p, 'cwd')));
  router.register('workspace/applyPatch', (p) =>
    ws.applyPatch(requireString(p, 'cwd'), parseChanges(p)),
  );

  // FOR-DEV: implement checkpoints (capture via `git stash create`, diff, apply)
  // with persistence in ~/.uxnan (src/workspace/) — see bridge/FOR-DEV.md.
  registerStubs(router, CHECKPOINT_METHODS);
}

function parseChanges(params: unknown): PatchChange[] {
  return requireArray(params, 'changes').map((raw, index) => {
    const item = asObject(raw);
    const op = item['op'];
    if (op !== 'add' && op !== 'modify' && op !== 'delete') {
      throw RpcError.invalidParams(`changes[${index}].op must be add|modify|delete`);
    }
    const path = requireString(item, 'path');
    const content = optionalString(item, 'content');
    const change: PatchChange = { op, path };
    if (content !== undefined) change.content = content;
    return change;
  });
}
