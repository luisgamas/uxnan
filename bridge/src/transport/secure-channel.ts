/**
 * Encrypted channel over an established session (bridge side).
 *
 * Outbound (bridge → phone) sequence numbers are 1-based; inbound (phone →
 * bridge) envelopes must have a strictly increasing `seq` (replay protection),
 * matching the mobile `SecureChannel` (architecture/02a §5.9.1, 02b §5.3).
 */
import type { SecureEnvelope } from '@uxnan/shared';
import { aesGcmDecrypt, aesGcmEncrypt } from './crypto.js';

export class ReplayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReplayError';
  }
}

export class BridgeSecureChannel {
  readonly #key: Buffer;
  readonly #sessionId: string;
  #nextOutboundSeq: number;
  #lastInboundSeq: number;

  constructor(key: Buffer, sessionId: string, startOutboundSeq = 1) {
    this.#key = key;
    this.#sessionId = sessionId;
    this.#nextOutboundSeq = startOutboundSeq;
    this.#lastInboundSeq = 0;
  }

  get sessionId(): string {
    return this.#sessionId;
  }

  get nextOutboundSeq(): number {
    return this.#nextOutboundSeq;
  }

  get lastInboundSeq(): number {
    return this.#lastInboundSeq;
  }

  /** Encrypt a plaintext payload into the next outbound envelope. */
  encrypt(plaintext: Buffer): SecureEnvelope {
    const seq = this.#nextOutboundSeq;
    this.#nextOutboundSeq += 1;
    const parts = aesGcmEncrypt(this.#key, plaintext);
    return {
      kind: 'encryptedEnvelope',
      sessionId: this.#sessionId,
      seq,
      nonce: parts.nonceHex,
      ciphertext: parts.ciphertextB64,
      tag: parts.tagB64,
    };
  }

  /** Decrypt an inbound envelope, enforcing session and replay checks. */
  decrypt(envelope: SecureEnvelope): Buffer {
    if (envelope.sessionId !== this.#sessionId) {
      throw new Error('envelope sessionId mismatch');
    }
    if (envelope.seq <= this.#lastInboundSeq) {
      throw new ReplayError(`envelope seq ${envelope.seq} <= last applied ${this.#lastInboundSeq}`);
    }
    const plaintext = aesGcmDecrypt(this.#key, {
      nonceHex: envelope.nonce,
      ciphertextB64: envelope.ciphertext,
      tagB64: envelope.tag,
    });
    this.#lastInboundSeq = envelope.seq;
    return plaintext;
  }
}
