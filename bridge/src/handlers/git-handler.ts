/**
 * Git JSON-RPC handlers — run git locally via `child_process` (no shell).
 *
 * Source: architecture/02a-system-architecture.md §5.8.6.
 */
import { JsonRpcErrorCode, RpcError } from '@uxnan/shared';
import type { HandlerRouter, RpcHandler } from '../handler-router.js';
import { GitService } from '../git/git-service.js';
import { GitCommandError } from '../git/git-runner.js';
import { optionalString, requireSafe, requireString } from './params.js';

/** Wrap a git operation so failures become a -32003 GitOperationFailed error. */
function gitOp(fn: () => Promise<unknown>): Promise<unknown> {
  return fn().catch((err: unknown) => {
    if (err instanceof GitCommandError) {
      throw new RpcError(JsonRpcErrorCode.GitOperationFailed, err.message, { stderr: err.stderr });
    }
    throw err;
  });
}

export function registerGitHandlers(router: HandlerRouter): void {
  const git = new GitService();

  const handlers: Record<string, RpcHandler> = {
    'git/status': (p) => gitOp(() => git.status(requireString(p, 'cwd'))),
    'git/diff': (p) => gitOp(() => git.diff(requireString(p, 'cwd'))),
    'git/commit': (p) =>
      gitOp(() => git.commit(requireString(p, 'cwd'), requireString(p, 'message'))),
    'git/push': (p) =>
      gitOp(() =>
        git.push(requireString(p, 'cwd'), requireSafe(p, 'remote'), requireSafe(p, 'branch')),
      ),
    'git/pull': (p) =>
      gitOp(() =>
        git.pull(requireString(p, 'cwd'), optionalSafe(p, 'remote'), optionalSafe(p, 'branch')),
      ),
    'git/checkout': (p) =>
      gitOp(() => git.checkout(requireString(p, 'cwd'), requireSafe(p, 'branch'))),
    'git/createBranch': (p) =>
      gitOp(() => git.createBranch(requireString(p, 'cwd'), requireSafe(p, 'name'))),
    'git/createWorktree': (p) =>
      gitOp(() =>
        git.createWorktree(
          requireString(p, 'cwd'),
          requireSafe(p, 'branch'),
          requireSafe(p, 'path'),
        ),
      ),
  };

  for (const [method, handler] of Object.entries(handlers)) {
    router.register(method, handler);
  }
}

function optionalSafe(params: unknown, key: string): string | undefined {
  const value = optionalString(params, key);
  if (value === undefined) return undefined;
  if (value.startsWith('-')) throw RpcError.invalidParams(`invalid '${key}'`);
  return value;
}
