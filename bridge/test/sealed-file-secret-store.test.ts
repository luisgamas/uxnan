import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmrf } from './helpers/fs.js';
import {
  InMemorySecretStore,
  SealedFileSecretStore,
  SealedSecretsError,
  parseSecretKey,
  startBridge,
} from '../src/index.js';

const dir = (): string => join(tmpdir(), `uxnan-sealed-${randomUUID()}`);

test('secrets survive a reopen with the same key, and never sit in the file in the clear', async () => {
  const base = dir();
  const path = join(base, 'secrets.sealed');
  const key = randomBytes(32);
  try {
    const store = await SealedFileSecretStore.open(path, key);
    await store.set('secure-device-state', 'PRIVATE-KEY-MATERIAL');
    await store.set('relay.cloudflare-token', 'cf-token');
    await store.delete('relay.cloudflare-token');

    // What a reboot leaves: the file, and the key handed in again.
    const again = await SealedFileSecretStore.open(path, key);
    assert.equal(await again.get('secure-device-state'), 'PRIVATE-KEY-MATERIAL');
    assert.equal(await again.get('relay.cloudflare-token'), null);

    const raw = await readFile(path, 'utf-8');
    assert.ok(!raw.includes('PRIVATE-KEY-MATERIAL'), 'sealed, not plaintext');
    if (process.platform !== 'win32') {
      assert.equal((await stat(path)).mode & 0o777, 0o600);
    }
  } finally {
    await rmrf(base);
  }
});

test('a file sealed by another key is refused, never replaced', async () => {
  const base = dir();
  const path = join(base, 'secrets.sealed');
  try {
    const store = await SealedFileSecretStore.open(path, randomBytes(32));
    await store.set('secure-device-state', 'mine');
    await assert.rejects(SealedFileSecretStore.open(path, randomBytes(32)), SealedSecretsError);
    // Still there for the key that sealed it.
    assert.ok((await readFile(path, 'utf-8')).length > 0);
  } finally {
    await rmrf(base);
  }
});

test('the first open keeps what the keychain held, so the identity does not change', async () => {
  const base = dir();
  try {
    const keychain = new InMemorySecretStore();
    await keychain.set('secure-device-state', 'the-identity');
    await keychain.set('metrics-seal-key', 'seal');
    const store = await SealedFileSecretStore.open(join(base, 's'), randomBytes(32), keychain);
    assert.equal(await store.get('secure-device-state'), 'the-identity');
    assert.equal(await store.get('metrics-seal-key'), 'seal');
  } finally {
    await rmrf(base);
  }
});

test('a bridge started with a secret key keeps the same identity across restarts', async () => {
  const base = dir();
  const key = randomBytes(32);
  try {
    const first = await startBridge({ baseDir: base, secretKey: key, logLevel: 'error' });
    const id = first.generatePairingQr().macDeviceId;
    await first.stop();
    const second = await startBridge({ baseDir: base, secretKey: key, logLevel: 'error' });
    assert.equal(second.generatePairingQr().macDeviceId, id);
    await second.stop();
  } finally {
    await rmrf(base);
  }
});

test('the key travels as 64 hex digits, nothing else', () => {
  assert.equal(parseSecretKey('ab'.repeat(32)).length, 32);
  assert.throws(() => parseSecretKey('short'), SealedSecretsError);
});
