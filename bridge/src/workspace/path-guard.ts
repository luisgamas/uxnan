/**
 * Path-traversal protection and sensitive-file filtering for workspace access.
 *
 * Source: architecture/02a-system-architecture.md §5.8.9 (sanitization). The
 * bridge never serves files outside the project root, nor secrets (.env, keys,
 * credentials) or the .git internals.
 */
import { isAbsolute, parse, relative, resolve, sep } from 'node:path';
import { JsonRpcErrorCode, RpcError } from '@uxnan/shared';

const SENSITIVE_PATTERNS: RegExp[] = [
  /^\.env(\..+)?$/i,
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /\.keystore$/i,
  /^id_rsa/i,
  /^id_ed25519/i,
  /^id_ecdsa/i,
  /^credentials\.json$/i,
  /^\.npmrc$/i,
];

export function isSensitiveName(name: string): boolean {
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(name));
}

function denied(message: string): RpcError {
  return new RpcError(JsonRpcErrorCode.WorkspaceAccessDenied, message);
}

/** Whether [target] is [root] itself or a descendant of it. */
export function isWithinRoot(root: string, target: string): boolean {
  const rel = relative(resolve(root), resolve(target));
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
}

/**
 * Reject `.git` internals and sensitive names in every segment of `target`
 * below `from` (the filesystem root when omitted).
 *
 * Link resolution has no project root to anchor to, so it scans the whole
 * canonical path. A workspace read scans only what lies below its own root:
 * the ancestors of a root the user configured are not the bridge's to judge,
 * and denying them would make every read of that project fail.
 */
export function assertSafeWorkspacePath(target: string, from?: string): void {
  const absolute = resolve(target);
  const base = from === undefined ? parse(absolute).root : resolve(from);
  const segments = relative(base, absolute).split(sep).filter(Boolean);
  if (segments.includes('.git')) {
    throw denied('access to the .git directory is not allowed');
  }
  if (segments.some(isSensitiveName)) {
    throw denied('access to a sensitive file is not allowed');
  }
}

/**
 * Resolve `relPath` against `root` and ensure the result stays inside `root`.
 * Rejects traversal (`..`), absolute escapes, the `.git` directory and sensitive
 * file names. Returns the absolute path.
 */
export function resolveWithinRoot(root: string, relPath: string): string {
  const resolvedRoot = resolve(root);
  const target = resolve(resolvedRoot, relPath);

  if (!isWithinRoot(resolvedRoot, target)) {
    throw denied('path escapes the project root');
  }
  assertSafeWorkspacePath(target, resolvedRoot);
  return target;
}
