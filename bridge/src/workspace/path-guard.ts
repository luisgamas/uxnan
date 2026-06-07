/**
 * Path-traversal protection and sensitive-file filtering for workspace access.
 *
 * Source: architecture/02a-system-architecture.md §5.8.9 (sanitization). The
 * bridge never serves files outside the project root, nor secrets (.env, keys,
 * credentials) or the .git internals.
 */
import { isAbsolute, relative, resolve, sep } from 'node:path';
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

/**
 * Resolve `relPath` against `root` and ensure the result stays inside `root`.
 * Rejects traversal (`..`), absolute escapes, the `.git` directory and sensitive
 * file names. Returns the absolute path.
 */
export function resolveWithinRoot(root: string, relPath: string): string {
  const resolvedRoot = resolve(root);
  const target = resolve(resolvedRoot, relPath);
  const rel = relative(resolvedRoot, target);

  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw denied('path escapes the project root');
  }
  const segments = rel.split(sep);
  if (segments.includes('.git')) {
    throw denied('access to the .git directory is not allowed');
  }
  const name = segments[segments.length - 1] ?? '';
  if (isSensitiveName(name)) {
    throw denied('access to a sensitive file is not allowed');
  }
  return target;
}
