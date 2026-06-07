/**
 * Bridge cryptographic identity (Ed25519) — generation, persistence (via a
 * {@link SecretStore}) and signing.
 *
 * Source: architecture/02a-system-architecture.md §5.8.3 (secure-device-state)
 * and §5.9.1 (handshake signatures).
 */
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomUUID,
  sign as edSign,
  type KeyObject,
} from 'node:crypto';
import type { SecretStore } from './secret-store.js';

const STORE_KEY = 'secure-device-state';

/** Non-secret identity safe to share (e.g. inside the pairing QR). */
export interface PublicIdentity {
  macDeviceId: string;
  /** Ed25519 identity public key as lowercase hex (32 bytes). */
  macIdentityPublicKey: string;
}

interface StoredIdentity {
  macDeviceId: string;
  /** Ed25519 private key in JWK form (OKP/Ed25519). */
  privateKeyJwk: Record<string, unknown>;
}

function publicKeyHexFromPrivate(privateKey: KeyObject): string {
  const publicJwk = createPublicKey(privateKey).export({ format: 'jwk' }) as { x?: string };
  if (typeof publicJwk.x !== 'string') {
    throw new Error('failed to derive Ed25519 public key');
  }
  return Buffer.from(publicJwk.x, 'base64url').toString('hex');
}

export class SecureDeviceState {
  readonly #store: SecretStore;
  #privateKey: KeyObject | undefined;
  #identity: PublicIdentity | undefined;

  constructor(store: SecretStore) {
    this.#store = store;
  }

  /** Load the persisted identity, or generate and persist a new one. */
  async loadOrCreate(): Promise<PublicIdentity> {
    const raw = await this.#store.get(STORE_KEY);
    if (raw) {
      const stored = JSON.parse(raw) as StoredIdentity;
      this.#privateKey = createPrivateKey({ key: stored.privateKeyJwk, format: 'jwk' });
      this.#identity = {
        macDeviceId: stored.macDeviceId,
        macIdentityPublicKey: publicKeyHexFromPrivate(this.#privateKey),
      };
      return this.#identity;
    }

    const { privateKey } = generateKeyPairSync('ed25519');
    const macDeviceId = randomUUID();
    const privateKeyJwk = privateKey.export({ format: 'jwk' }) as Record<string, unknown>;
    const stored: StoredIdentity = { macDeviceId, privateKeyJwk };
    await this.#store.set(STORE_KEY, JSON.stringify(stored));

    this.#privateKey = privateKey;
    this.#identity = {
      macDeviceId,
      macIdentityPublicKey: publicKeyHexFromPrivate(privateKey),
    };
    return this.#identity;
  }

  get identity(): PublicIdentity {
    if (!this.#identity) {
      throw new Error('SecureDeviceState.loadOrCreate() must be called first');
    }
    return this.#identity;
  }

  /** Sign a message with the Ed25519 identity key; returns lowercase hex. */
  sign(message: Buffer | string): string {
    if (!this.#privateKey) {
      throw new Error('SecureDeviceState.loadOrCreate() must be called first');
    }
    const data = typeof message === 'string' ? Buffer.from(message, 'utf-8') : message;
    return edSign(null, data, this.#privateKey).toString('hex');
  }
}
