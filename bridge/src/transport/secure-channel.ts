/**
 * Encrypted channel over an established session (bridge side).
 *
 * Outbound (bridge → phone) sequence numbers are 1-based; inbound (phone →
 * bridge) envelopes must have a strictly increasing `seq` (replay protection),
 * matching the mobile `SecureChannel` (architecture/02a §5.9.1, 02b §5.3).
 *
 * `seq` and `sessionId` travel in the plain envelope (the receiver needs them
 * before it can even look up the key), so they are bound as AES-GCM
 * Additional Authenticated Data rather than encrypted: any tamper of either
 * field fails the tag instead of silently passing an unauthenticated replay
 * check. The AAD also binds a `direction` byte so a captured envelope cannot
 * be reflected back at its sender and pass as a legitimate inbound frame.
 */
import {
  ENVELOPE_DIRECTION_BRIDGE_TO_PHONE,
  ENVELOPE_DIRECTION_PHONE_TO_BRIDGE,
  type SecureEnvelope,
} from '@uxnan/shared';
import { aesGcmDecrypt, aesGcmEncrypt } from './crypto.js';
import type { OutboundLog } from './outbound-log.js';

export class ReplayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReplayError';
  }
}

/**
 * AAD direction bytes. Re-exported from `@uxnan/shared`, which is the single
 * source of truth for this cross-language wire contract (the mobile side
 * mirrors it in `ProtocolConstants`).
 */
export const DIRECTION_PHONE_TO_BRIDGE = ENVELOPE_DIRECTION_PHONE_TO_BRIDGE;
export const DIRECTION_BRIDGE_TO_PHONE = ENVELOPE_DIRECTION_BRIDGE_TO_PHONE;

/**
 * Which physical side a {@link BridgeSecureChannel} instance represents, for
 * AAD direction binding. Real bridge code always uses the default `'bridge'`
 * role (the class name says so); `'phone'` exists only so tests can drive an
 * independent, direction-correct stand-in for the phone side without a second
 * implementation of the channel (see `test/helpers/fake-phone.ts`).
 */
export type ChannelRole = 'bridge' | 'phone';

/**
 * Build the canonical AES-GCM AAD binding `sessionId`, `seq` and the sending
 * `direction` to the tag (architecture/02a §5.9.1):
 *
 *   AAD = utf8(sessionId) || 0x00 || u64_be(seq) || 0x00 || direction
 *
 * Both peers must derive byte-identical AAD for a given
 * `(sessionId, seq, direction)` — the mobile `secure_transport_layer.dart`
 * mirrors this exactly (UTF-8 sessionId, big-endian u64 seq, the same `0x00`
 * separators).
 */
export function buildEnvelopeAad(sessionId: string, seq: number, direction: number): Buffer {
  const seqBuf = Buffer.alloc(8);
  seqBuf.writeBigUInt64BE(BigInt(seq));
  return Buffer.concat([
    Buffer.from(sessionId, 'utf-8'),
    Buffer.from([0x00]),
    seqBuf,
    Buffer.from([0x00]),
    Buffer.from([direction]),
  ]);
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
  /** AAD direction this instance uses when it encrypts (sends). */
  readonly #outboundDirection: number;
  /** AAD direction this instance expects on the envelopes it decrypts (receives). */
  readonly #inboundDirection: number;
  #fallbackSeq: number;
  #lastInboundSeq: number;

  constructor(key: Buffer, sessionId: string, log?: OutboundLog, role: ChannelRole = 'bridge') {
    this.#key = key;
    this.#sessionId = sessionId;
    this.#log = log;
    this.#fallbackSeq = 1;
    this.#lastInboundSeq = 0;
    this.#outboundDirection =
      role === 'bridge' ? DIRECTION_BRIDGE_TO_PHONE : DIRECTION_PHONE_TO_BRIDGE;
    this.#inboundDirection =
      role === 'bridge' ? DIRECTION_PHONE_TO_BRIDGE : DIRECTION_BRIDGE_TO_PHONE;
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
    const aad = buildEnvelopeAad(this.#sessionId, seq, this.#outboundDirection);
    const parts = aesGcmEncrypt(this.#key, plaintext, aad);
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
    const aad = buildEnvelopeAad(envelope.sessionId, envelope.seq, this.#inboundDirection);
    const plaintext = aesGcmDecrypt(
      this.#key,
      {
        nonceHex: envelope.nonce,
        ciphertextB64: envelope.ciphertext,
        tagB64: envelope.tag,
      },
      aad,
    );
    this.#lastInboundSeq = envelope.seq;
    return plaintext;
  }
}
