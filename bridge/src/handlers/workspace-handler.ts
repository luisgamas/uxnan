/**
 * Workspace JSON-RPC handlers — file reads, listing and patch application,
 * confined to the project root with sensitive files excluded.
 *
 * Checkpoints (capture/diff/apply) are deferred to a follow-up increment
 * (FOR-DEV) and remain registered as clear not-implemented stubs.
 *
 * Source: architecture/02a-system-architecture.md §5.8.7 / §5.8.9.
 */
import { JsonRpcErrorCode, RpcError, type PatchChange } from '@uxnan/shared';
import type { BridgeContext } from '../bridge-context.js';
import type { HandlerRouter } from '../handler-router.js';
import { WorkspaceService } from '../workspace/workspace-service.js';
import { CheckpointService, type CaptureOptions } from '../workspace/checkpoint-service.js';
import { GitCommandError } from '../git/git-runner.js';
import { asObject, optionalString, requireArray, requireString } from './params.js';

/** Map a git failure inside a checkpoint op to -32003 (RpcErrors pass through). */
function checkpointOp<T>(fn: () => Promise<T>): Promise<T> {
  return fn().catch((err: unknown) => {
    if (err instanceof GitCommandError) {
      throw new RpcError(JsonRpcErrorCode.GitOperationFailed, err.message, { stderr: err.stderr });
    }
    throw err;
  });
}

export function registerWorkspaceHandlers(router: HandlerRouter): void {
  const ws = new WorkspaceService();

  router.register('workspace/readFile', (p) =>
    ws.readFile(requireString(p, 'cwd'), requireString(p, 'path')),
  );
  router.register('workspace/readImage', (p) =>
    ws.readImage(requireString(p, 'cwd'), requireString(p, 'path')),
  );
  router.register('workspace/list', (p) => ws.list(requireString(p, 'cwd')));
  router.register('workspace/browseDirs', (p, ctx: BridgeContext) => {
    const params = p ?? {};
    return ctx.browse.browse(optionalString(params, 'rootId'), optionalString(params, 'path'));
  });
  router.register('workspace/applyPatch', (p) =>
    ws.applyPatch(requireString(p, 'cwd'), parseChanges(p)),
  );

  router.register('workspace/checkpoint', (p, ctx: BridgeContext) => {
    const cwd = requireString(p, 'cwd');
    const options: CaptureOptions = {
      now: ctx.now(),
      ...optionalField(p, 'label'),
      ...optionalThreadId(p),
    };
    return checkpointOp(() => new CheckpointService(ctx.state).capture(cwd, options));
  });
  router.register('workspace/diffCheckpoint', (p, ctx: BridgeContext) =>
    checkpointOp(() => new CheckpointService(ctx.state).diff(requireString(p, 'id'))),
  );
  router.register('workspace/applyCheckpoint', (p, ctx: BridgeContext) =>
    checkpointOp(() => new CheckpointService(ctx.state).apply(requireString(p, 'id'))),
  );
}

function optionalField(params: unknown, key: 'label'): { label?: string } {
  const value = optionalString(params, key);
  return value === undefined ? {} : { label: value };
}

function optionalThreadId(params: unknown): { threadId?: string } {
  const value = optionalString(params, 'threadId');
  return value === undefined ? {} : { threadId: value };
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
