/**
 * Params readers for methods whose fields are all optional.
 *
 * JSON-RPC 2.0 makes the `params` member itself optional, and the mobile app
 * omits it whenever every field is unset (`if (params != null) 'params': params`
 * in `rpc_message.dart`). The router hands that through to handlers untouched,
 * so the readers below are what stands between an omitted params and a bogus
 * -32602 on a perfectly valid call.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { JsonRpcErrorCode, makeRequest } from '@uxnan/shared';
import {
  optionalBoolean,
  optionalNumber,
  optionalString,
  requireString,
} from '../../src/handlers/params.js';
import { InMemorySecretStore, startBridge, type Bridge } from '../../src/index.js';
import { rmrf } from '../helpers/fs.js';

async function boot(): Promise<{ bridge: Bridge; baseDir: string }> {
  const baseDir = join(tmpdir(), `uxnan-params-${randomUUID()}`);
  const bridge = await startBridge({
    baseDir,
    secretStore: new InMemorySecretStore(),
    logLevel: 'error',
  });
  return { bridge, baseDir };
}

test('optional readers treat an omitted params as "no field set"', () => {
  for (const absent of [undefined, null]) {
    assert.equal(optionalString(absent, 'passphrase'), undefined);
    assert.equal(optionalBoolean(absent, 'flag'), undefined);
    assert.equal(optionalNumber(absent, 'limit'), undefined);
  }
});

test('optional readers still reject a params that is present but not an object', () => {
  for (const malformed of ['nope', 42, ['a']]) {
    assert.throws(() => optionalString(malformed, 'passphrase'), /params must be an object/);
  }
});

test('optional readers still type-check a field that IS present', () => {
  assert.throws(() => optionalString({ passphrase: 7 }, 'passphrase'), /must be a string/);
  assert.equal(optionalString({ passphrase: 'x' }, 'passphrase'), 'x');
});

test('a required field still rejects an omitted params', () => {
  assert.throws(() => requireString(undefined, 'blob'), /params must be an object/);
});

test('metrics/export seals a backup when the phone sends no passphrase', async () => {
  const { bridge, baseDir } = await boot();

  // The exact shape the mobile app puts on the wire with no passphrase set:
  // `params` omitted entirely.
  const res = await bridge.router.dispatch(makeRequest('1', 'metrics/export'));

  assert.ok('result' in res, `expected a sealed backup, got ${JSON.stringify(res)}`);
  const result = res.result as { blob: string; filename: string; passphraseProtected: boolean };
  assert.ok(result.blob.length > 0);
  assert.match(result.filename, /\.uxmetrics$/);
  assert.equal(result.passphraseProtected, false);

  await bridge.stop();
  await rmrf(baseDir);
});

test('metrics/export still honours a passphrase when one is sent', async () => {
  const { bridge, baseDir } = await boot();

  const res = await bridge.router.dispatch(
    makeRequest('1', 'metrics/export', { passphrase: 'correct horse' }),
  );

  assert.ok('result' in res);
  assert.equal((res.result as { passphraseProtected: boolean }).passphraseProtected, true);

  await bridge.stop();
  await rmrf(baseDir);
});

test('thread/list and workspace/browseDirs accept an omitted params', async () => {
  const { bridge, baseDir } = await boot();

  for (const method of ['thread/list', 'workspace/browseDirs']) {
    const res = await bridge.router.dispatch(makeRequest('1', method));
    assert.ok('result' in res, `${method} rejected an omitted params: ${JSON.stringify(res)}`);
  }

  await bridge.stop();
  await rmrf(baseDir);
});

test('a malformed params is still rejected with -32602', async () => {
  const { bridge, baseDir } = await boot();

  const res = await bridge.router.dispatch(makeRequest('1', 'metrics/export', 'not-an-object'));

  assert.ok('error' in res);
  assert.equal(res.error?.code, JsonRpcErrorCode.InvalidParams);

  await bridge.stop();
  await rmrf(baseDir);
});
