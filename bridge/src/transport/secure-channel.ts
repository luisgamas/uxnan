/**
 * Encrypted channel over an established session (bridge side).
 *
 * Outbound (bridge → phone) sequence numbers are 1-based; inbound (phone →
 * bridge) envelopes must have a strictly increasing `seq` (replay protection),
 * matching the mobile `SecureChannel` (architecture/02a §5.9.1, 02b §5.3).
 */
import type { SecureEnvelope } from '@uxnan/shared';
import { aesGcmDecrypt, aesGcmEncrypt } from './crypto.js';
import type { OutboundLog } from './outbound-log.js';

export class ReplayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReplayError';
  }
}

export class BridgeSecureChannel {
  readonly #key: Buffer;
  readonly #sessionId: string;
  /**
   * Per-device outbound log that owns the seq counter + retains plaintext for
   * catch-up. When present, `encrypt` records here and the seq continues across
   * reconnects. When absent (tests, the phone-side peer), an internal 1-based
   * counter is used and nothing is retained.
   */
  readonly #log: OutboundLog | undefined;
  #fallbackSeq: number;
  #lastInboundSeq: number;

  constructor(key: Buffer, sessionId: string, log?: OutboundLog) {
    this.#key = key;
    this.#sessionId = sessionId;
    this.#log = log;
    this.#fallbackSeq = 1;
    this.#lastInboundSeq = 0;
  }

  get sessionId(): string {
    return this.#sessionId;
  }

  get nextOutboundSeq(): number {
    return this.#log ? this.#log.nextSeq : this.#fallbackSeq;
  }

  get lastInboundSeq(): number {
    return this.#lastInboundSeq;
  }

  /**
   * Encrypt a plaintext payload into the next outbound envelope. The seq is
   * drawn from (and the plaintext retained in) the outbound log when one is
   * attached, so the message can be replayed after a reconnect.
   */
  encrypt(plaintext: Buffer): SecureEnvelope {
    const seq = this.#log ? this.#log.record(plaintext) : this.#fallbackSeq++;
    return this.#seal(seq, plaintext);
  }

  /**
   * Re-encrypt a retained plaintext under THIS channel's (new) key with its
   * ORIGINAL seq, for seq-based catch-up after a reconnect. Does NOT advance the
   * counter or record into the log — the entry already lives there.
   */
  encryptReplay(seq: number, plaintext: Buffer): SecureEnvelope {
    return this.#seal(seq, plaintext);
  }

  #seal(seq: number, plaintext: Buffer): SecureEnvelope {
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
