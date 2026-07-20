import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv } from 'node:crypto';
import {
  InMemorySecretStore,
  SecureDeviceState,
  aesGcmDecrypt,
  aesGcmEncrypt,
  buildEnvelopeAad,
  deriveSessionKey,
  generateEphemeralKeyPair,
  randomHex,
  verifyEd25519,
} from '../../src/index.js';

/**
 * Cross-language AES-256-GCM + AAD interop vector.
 *
 * Fixed (key, nonce, plaintext, sessionId="abc", seq=1, direction=phone→bridge
 * 0x01) → (ciphertext, tag), computed once with Node's `crypto` (the same
 * primitives `aesGcmEncrypt` uses) and duplicated verbatim in
 * `uxnanmobile/test/unit/infrastructure/envelope_crypto_test.dart` so mobile's
 * `EnvelopeCrypto.decrypt` (via the `cryptography` package's `AesGcm`) is
 * proven to consume bridge-produced ciphertext/tag/AAD byte-for-byte — the
 * decisive proof that bridge-encrypt / mobile-decrypt interoperate (not just
 * that each side round-trips against itself).
 */
const VECTOR = {
  key: Buffer.alloc(32, 0x42),
  nonceHex: Buffer.alloc(12, 0x24).toString('hex'),
  sessionId: 'abc',
  seq: 1,
  direction: 0x01, // phone -> bridge
  plaintext: 'uxnan-e2ee-aad-vector',
  ciphertextB64: 'YOmqIIfrowxDjQ/L3Fa+0AmYRx/E',
  tagB64: 'E3QCRRpfu+p+0gNndC5jOQ==',
};

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

test('AES-256-GCM with AAD round-trips when the same AAD is presented on decrypt', () => {
  const key = Buffer.from(randomHex(32), 'hex');
  const aad = Buffer.from('example-generic-aad-value', 'utf-8');
  const parts = aesGcmEncrypt(key, Buffer.from('secret payload'), aad);
  assert.equal(aesGcmDecrypt(key, parts, aad).toString(), 'secret payload');
});

test('AES-256-GCM decrypt fails when the AAD differs from encrypt (or is omitted)', () => {
  const key = Buffer.from(randomHex(32), 'hex');
  const aad = Buffer.from('aad-one');
  const parts = aesGcmEncrypt(key, Buffer.from('secret payload'), aad);
  assert.throws(() => aesGcmDecrypt(key, parts, Buffer.from('aad-two')));
  assert.throws(() => aesGcmDecrypt(key, parts));
});

test('cross-language vector: bridge aesGcmDecrypt reproduces the fixed AAD + plaintext', () => {
  const aad = buildEnvelopeAad(VECTOR.sessionId, VECTOR.seq, VECTOR.direction);
  assert.equal(aad.toString('hex'), '6162630000000000000000010001');
  const plaintext = aesGcmDecrypt(
    VECTOR.key,
    { nonceHex: VECTOR.nonceHex, ciphertextB64: VECTOR.ciphertextB64, tagB64: VECTOR.tagB64 },
    aad,
  );
  assert.equal(plaintext.toString('utf-8'), VECTOR.plaintext);
});

test('cross-language vector: re-encrypting the same inputs reproduces the fixed ciphertext/tag', () => {
  // aesGcmEncrypt draws a random nonce, so to reproduce the FIXED vector's
  // ciphertext/tag we call the underlying primitive with the fixed nonce
  // directly (mirrors what aesGcmEncrypt does internally) rather than calling
  // aesGcmEncrypt (which cannot take a caller-supplied nonce).
  const aad = buildEnvelopeAad(VECTOR.sessionId, VECTOR.seq, VECTOR.direction);
  const cipher = createCipheriv('aes-256-gcm', VECTOR.key, Buffer.from(VECTOR.nonceHex, 'hex'));
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(VECTOR.plaintext, 'utf-8')), cipher.final()]);
  assert.equal(ciphertext.toString('base64'), VECTOR.ciphertextB64);
  assert.equal(cipher.getAuthTag().toString('base64'), VECTOR.tagB64);
});

test('verifyEd25519 accepts a real signature and rejects a forgery', async () => {
  const ds = new SecureDeviceState(new InMemorySecretStore());
  const id = await ds.loadOrCreate();
  const message = Buffer.from('handshake transcript');
  const sigHex = ds.sign(message);

  assert.ok(verifyEd25519(message, sigHex, id.macIdentityPublicKey));
  assert.ok(!verifyEd25519(Buffer.from('other'), sigHex, id.macIdentityPublicKey));
});
