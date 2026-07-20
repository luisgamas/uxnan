/**
 * Direct unit tests for the workspace path-traversal guard
 * (`resolveWithinRoot` / `isSensitiveName`, `src/workspace/path-guard.ts`).
 *
 * Previously only one traversal case (`../../etc/hosts`) was exercised, and
 * only indirectly through a handler test. These tests lock in every escape
 * branch, the `.git` rejection, and every `SENSITIVE_PATTERNS` entry as a
 * regression guard, so a refactor that silently loosens the filter fails
 * fast instead of shipping a data-exposure regression.
 *
 * Both functions are pure path-string logic (no filesystem access), so no
 * fixture directories are created on disk — a stable resolved root string is
 * enough to exercise every branch on both POSIX and Windows.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { JsonRpcErrorCode, RpcError } from '@uxnan/shared';
import { isSensitiveName, resolveWithinRoot } from '../../src/workspace/path-guard.js';

const root = resolve(tmpdir(), 'uxnan-path-guard-fixture');

function assertDenied(fn: () => void): void {
  assert.throws(
    fn,
    (err: unknown) => err instanceof RpcError && err.code === JsonRpcErrorCode.WorkspaceAccessDenied,
  );
}

test('resolveWithinRoot denies parent and multi-level path escapes', () => {
  assertDenied(() => resolveWithinRoot(root, '../etc/hosts'));
  assertDenied(() => resolveWithinRoot(root, '../../secret.txt'));
});

test('resolveWithinRoot denies an absolute path resolved outside the root', () => {
  // `resolve(resolvedRoot, relPath)` ignores `resolvedRoot` once `relPath` is
  // itself absolute (Node resolves right-to-left), so this still lands on
  // the same escape check as a relative `..` traversal.
  const outsideAbsolute = resolve(root, '..', 'outside-sibling', 'other.txt');
  assertDenied(() => resolveWithinRoot(root, outsideAbsolute));
});

test('resolveWithinRoot denies the .git directory as a leading and a nested segment', () => {
  assertDenied(() => resolveWithinRoot(root, '.git/config'));
  assertDenied(() => resolveWithinRoot(root, 'sub/.git/HEAD'));
});

test('resolveWithinRoot denies every sensitive-name pattern family by relative path', () => {
  const cases = [
    '.env',
    '.env.production',
    'secrets/id_rsa',
    'config/credentials.json',
    '.npmrc',
    'server.key',
    'cert.pem',
  ];
  for (const relPath of cases) {
    assertDenied(() => resolveWithinRoot(root, relPath));
  }
});

test('resolveWithinRoot returns the resolved path for allowed relative paths', () => {
  for (const relPath of ['src/index.ts', 'README.md', 'deep/nested/file.txt']) {
    assert.equal(resolveWithinRoot(root, relPath), resolve(root, relPath));
  }
});

test('resolveWithinRoot allows a name that merely contains a sensitive token', () => {
  // `/\.key$/i` only matches a `.key` *suffix*; "my.key.notes.md" ends in
  // `.md`, so it does not match and is allowed. This asserts the guard's
  // real current behavior, not an intended design — it is not a bypass
  // because the token is not the file's actual extension.
  const relPath = 'my.key.notes.md';
  assert.equal(resolveWithinRoot(root, relPath), resolve(root, relPath));
});

test('isSensitiveName matches every SENSITIVE_PATTERNS entry', () => {
  const sensitive = [
    '.env',
    '.env.local',
    'x.pem',
    'x.key',
    'x.p12',
    'x.pfx',
    'x.keystore',
    'id_rsa',
    'id_rsa.pub',
    'id_ed25519',
    'id_ecdsa',
    'credentials.json',
    '.npmrc',
  ];
  for (const name of sensitive) {
    assert.equal(isSensitiveName(name), true, `expected "${name}" to be sensitive`);
  }
});

test('isSensitiveName does not match benign names that merely resemble a pattern', () => {
  const benign = ['index.ts', 'keyboard.md', 'envelope.ts', 'credentials.md'];
  for (const name of benign) {
    assert.equal(isSensitiveName(name), false, `expected "${name}" to be benign`);
  }
});
