import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verify } from 'node:crypto';
import { createPublicKey } from 'node:crypto';
import { InMemorySecretStore, SecureDeviceState } from '../src/index.js';

test('loadOrCreate generates a hex Ed25519 public key and a device id', async () => {
  const ds = new SecureDeviceState(new InMemorySecretStore());
  const id = await ds.loadOrCreate();
  assert.match(id.macIdentityPublicKey, /^[0-9a-f]{64}$/);
  assert.ok(id.macDeviceId.length > 0);
});

test('loadOrCreate is stable across calls sharing a store', async () => {
  const store = new InMemorySecretStore();
  const first = await new SecureDeviceState(store).loadOrCreate();
  const second = await new SecureDeviceState(store).loadOrCreate();
  assert.deepEqual(first, second);
});

test('distinct stores yield distinct identities', async () => {
  const a = await new SecureDeviceState(new InMemorySecretStore()).loadOrCreate();
  const b = await new SecureDeviceState(new InMemorySecretStore()).loadOrCreate();
  assert.notEqual(a.macIdentityPublicKey, b.macIdentityPublicKey);
});

test('sign produces a signature verifiable with the public key', async () => {
  const ds = new SecureDeviceState(new InMemorySecretStore());
  const id = await ds.loadOrCreate();
  const message = Buffer.from('transcript-bytes', 'utf-8');
  const sigHex = ds.sign(message);
  assert.match(sigHex, /^[0-9a-f]{128}$/);

  const publicKey = createPublicKey({
    key: {
      kty: 'OKP',
      crv: 'Ed25519',
      x: Buffer.from(id.macIdentityPublicKey, 'hex').toString('base64url'),
    },
    format: 'jwk',
  });
  assert.ok(verify(null, message, publicKey, Buffer.from(sigHex, 'hex')));
});

test('sign throws before loadOrCreate', () => {
  const ds = new SecureDeviceState(new InMemorySecretStore());
  assert.throws(() => ds.sign('x'), /loadOrCreate/);
});
