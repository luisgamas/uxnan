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
    'git/diff': (p) => gitOp(() => git.diff(requireString(p, 'cwd'), optionalSafe(p, 'path'))),
    'git/commit': (p) =>
      gitOp(() =>
        git.commit(requireString(p, 'cwd'), requireString(p, 'message'), optionalPaths(p, 'paths')),
      ),
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
    'git/stage': (p) => gitOp(() => git.stage(requireString(p, 'cwd'), requirePaths(p, 'paths'))),
    'git/unstage': (p) =>
      gitOp(() => git.unstage(requireString(p, 'cwd'), requirePaths(p, 'paths'))),
    'git/discard': (p) =>
      gitOp(() => git.discard(requireString(p, 'cwd'), requirePaths(p, 'paths'))),
    'git/createPr': (p) =>
      gitOp(() =>
        git.createPr(
          requireString(p, 'cwd'),
          requireString(p, 'title'),
          optionalString(p, 'body'),
          optionalSafe(p, 'base'),
          optionalSafe(p, 'head'),
        ),
      ),
    'git/undoCommit': (p) => gitOp(() => git.undoCommit(requireString(p, 'cwd'))),
    'git/branches': (p) => gitOp(() => git.branches(requireString(p, 'cwd'))),
    'git/switchBranch': (p) =>
      gitOp(() =>
        git.switchBranch(
          requireString(p, 'cwd'),
          requireSafe(p, 'target'),
          requireBool(p, 'carryChanges'),
        ),
      ),
    'git/revert': (p) => gitOp(() => git.revert(requireString(p, 'cwd'), requireSafe(p, 'commit'))),
    'git/deleteBranch': (p) =>
      gitOp(() =>
        git.deleteBranch(
          requireString(p, 'cwd'),
          requireSafe(p, 'branch'),
          requireBool(p, 'force'),
        ),
      ),
    'git/removeWorktree': (p) =>
      gitOp(() =>
        git.removeWorktree(
          requireString(p, 'cwd'),
          requireSafe(p, 'path'),
          requireBool(p, 'force'),
        ),
      ),
    'git/log': (p) => {
      const cwd = requireString(p, 'cwd');
      const limit = optionalNumber(p, 'limit');
      const cursor = optionalString(p, 'cursor');
      const ref = optionalString(p, 'ref');
      return gitOp(() =>
        git.log(cwd, {
          ...(limit !== undefined ? { limit } : {}),
          ...(cursor ? { cursor } : {}),
          ...(ref ? { ref } : {}),
        }),
      );
    },
    'git/commitShow': (p) =>
      gitOp(() => git.commitShow(requireString(p, 'cwd'), requireSafe(p, 'sha'))),
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

/**
 * Reads a `string[]` of repository-relative paths, rejecting non-arrays,
 * non-strings, empty values, and leading-dash entries (option-injection guard).
 */
function requirePaths(params: unknown, key: string): string[] {
  const raw = (params as Record<string, unknown> | null)?.[key];
  if (!Array.isArray(raw) || raw.length === 0) {
    throw RpcError.invalidParams(`'${key}' must be a non-empty array`);
  }
  return raw.map((entry) => {
    if (typeof entry !== 'string' || entry === '' || entry.startsWith('-')) {
      throw RpcError.invalidParams(`invalid path in '${key}'`);
    }
    return entry;
  });
}

function optionalPaths(params: unknown, key: string): string[] | undefined {
  const raw = (params as Record<string, unknown> | null)?.[key];
  if (raw === undefined || raw === null) return undefined;
  return requirePaths(params, key);
}

function requireBool(params: unknown, key: string): boolean {
  const raw = (params as Record<string, unknown> | null)?.[key];
  if (typeof raw !== 'boolean') {
    throw RpcError.invalidParams(`'${key}' must be a boolean`);
  }
  return raw;
}

function optionalNumber(params: unknown, key: string): number | undefined {
  const raw = (params as Record<string, unknown> | null)?.[key];
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    throw RpcError.invalidParams(`'${key}' must be a finite number`);
  }
  return raw;
}
