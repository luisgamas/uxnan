/**
 * Bridge-side E2EE primitives, mirroring the mobile app's audited
 * `infrastructure/crypto/` exactly (architecture/02a §5.9.1). No cryptographic
 * variants: X25519 + HKDF-SHA256 → AES-256-GCM; Ed25519 transcript signatures.
 *
 * All byte fields cross the wire as lowercase hex, except AES ciphertext/tag
 * which are base64 (see {@link SecureEnvelope}).
 */
import {
  createCipheriv,
  createDecipheriv,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  verify,
  type KeyObject,
} from 'node:crypto';
import { HKDF_INFO_TAG } from '@uxnan/shared';

export interface EphemeralKeyPair {
  /** X25519 public key as lowercase hex (32 bytes). */
  publicKeyHex: string;
  privateKey: KeyObject;
}

/** Generate a fresh X25519 ephemeral key pair for a single handshake. */
export function generateEphemeralKeyPair(): EphemeralKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('x25519');
  const jwk = publicKey.export({ format: 'jwk' }) as { x?: string };
  if (typeof jwk.x !== 'string') throw new Error('failed to export X25519 public key');
  return { publicKeyHex: Buffer.from(jwk.x, 'base64url').toString('hex'), privateKey };
}

export interface DeriveSessionKeyOptions {
  /** Our X25519 ephemeral private key. */
  privateKey: KeyObject;
  /** Peer X25519 ephemeral public key (hex). */
  peerPublicHex: string;
  clientNonceHex: string;
  serverNonceHex: string;
}

/**
 * Derive the 32-byte AES-256 session key.
 * `salt = clientNonce || serverNonce` (raw bytes), `info = "uxnan-e2ee-v1"`.
 */
export function deriveSessionKey(options: DeriveSessionKeyOptions): Buffer {
  const peerPublic = createPublicKey({
    key: {
      kty: 'OKP',
      crv: 'X25519',
      x: Buffer.from(options.peerPublicHex, 'hex').toString('base64url'),
    },
    format: 'jwk',
  });
  const shared = diffieHellman({ privateKey: options.privateKey, publicKey: peerPublic });
  const salt = Buffer.concat([
    Buffer.from(options.clientNonceHex, 'hex'),
    Buffer.from(options.serverNonceHex, 'hex'),
  ]);
  return Buffer.from(hkdfSync('sha256', shared, salt, Buffer.from(HKDF_INFO_TAG, 'utf-8'), 32));
}

/** Cryptographically secure random bytes as lowercase hex. */
export function randomHex(byteLength: number): string {
  return randomBytes(byteLength).toString('hex');
}

/** Verify an Ed25519 signature (hex) over `message` against a public key (hex). */
export function verifyEd25519(
  message: Buffer,
  signatureHex: string,
  publicKeyHex: string,
): boolean {
  try {
    const publicKey = createPublicKey({
      key: {
        kty: 'OKP',
        crv: 'Ed25519',
        x: Buffer.from(publicKeyHex, 'hex').toString('base64url'),
      },
      format: 'jwk',
    });
    return verify(null, message, publicKey, Buffer.from(signatureHex, 'hex'));
  } catch {
    return false;
  }
}

export interface AesGcmParts {
  /** Per-message nonce (hex, 12 bytes). */
  nonceHex: string;
  /** Ciphertext (base64). */
  ciphertextB64: string;
  /** GCM auth tag (base64, 16 bytes). */
  tagB64: string;
}

/**
 * Encrypt with AES-256-GCM. When [aad] is given, it is bound to the GCM tag
 * as Additional Authenticated Data (mirrors `metrics-seal.ts`'s `gcmEncrypt`):
 * any tamper of the authenticated-but-not-encrypted fields it covers (see
 * {@link buildEnvelopeAad} in `secure-channel.ts`) fails the tag.
 */
export function aesGcmEncrypt(key: Buffer, plaintext: Buffer, aad?: Buffer): AesGcmParts {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  if (aad) cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    nonceHex: nonce.toString('hex'),
    ciphertextB64: ciphertext.toString('base64'),
    tagB64: cipher.getAuthTag().toString('base64'),
  };
}

/** Decrypt with AES-256-GCM. [aad] must equal what was passed to encrypt. */
export function aesGcmDecrypt(key: Buffer, parts: AesGcmParts, aad?: Buffer): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(parts.nonceHex, 'hex'));
  if (aad) decipher.setAAD(aad);
  decipher.setAuthTag(Buffer.from(parts.tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(parts.ciphertextB64, 'base64')),
    decipher.final(),
  ]);
}
