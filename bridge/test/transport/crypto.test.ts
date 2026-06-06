import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  InMemorySecretStore,
  SecureDeviceState,
  aesGcmDecrypt,
  aesGcmEncrypt,
  deriveSessionKey,
  generateEphemeralKeyPair,
  randomHex,
  verifyEd25519,
} from '../../src/index.js';

test('two parties derive the same X25519+HKDF session key', () => {
  const a = generateEphemeralKeyPair();
  const b = generateEphemeralKeyPair();
  const clientNonceHex = randomHex(32);
  const serverNonceHex = randomHex(32);

  const keyA = deriveSessionKey({
    privateKey: a.privateKey,
    peerPublicHex: b.publicKeyHex,
    clientNonceHex,
    serverNonceHex,
  });
  const keyB = deriveSessionKey({
    privateKey: b.privateKey,
    peerPublicHex: a.publicKeyHex,
    clientNonceHex,
    serverNonceHex,
  });
  assert.equal(keyA.length, 32);
  assert.ok(keyA.equals(keyB));
});

test('AES-256-GCM round-trips and rejects tampering', () => {
  const key = Buffer.from(randomHex(32), 'hex');
  const parts = aesGcmEncrypt(key, Buffer.from('secret payload'));
  assert.equal(aesGcmDecrypt(key, parts).toString(), 'secret payload');

  const tampered = { ...parts, tagB64: Buffer.alloc(16).toString('base64') };
  assert.throws(() => aesGcmDecrypt(key, tampered));
});

test('verifyEd25519 accepts a real signature and rejects a forgery', async () => {
  const ds = new SecureDeviceState(new InMemorySecretStore());
  const id = await ds.loadOrCreate();
  const message = Buffer.from('handshake transcript');
  const sigHex = ds.sign(message);

  assert.ok(verifyEd25519(message, sigHex, id.macIdentityPublicKey));
  assert.ok(!verifyEd25519(Buffer.from('other'), sigHex, id.macIdentityPublicKey));
});
