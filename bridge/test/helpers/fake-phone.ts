/**
 * A faithful, independent implementation of the PHONE side of the E2EE protocol,
 * built only from the documented byte contract + node:crypto. Used to test that
 * the bridge server handshake/transport interoperate end-to-end.
 */
import { generateKeyPairSync, randomUUID, sign as edSign, type KeyObject } from 'node:crypto';
import { buildHandshakeTranscript, makeRequest, type JsonRpcResponse } from '@uxnan/shared';
import {
  BridgeSecureChannel,
  deriveSessionKey,
  generateEphemeralKeyPair,
  queueFor,
  randomHex,
  verifyEd25519,
  type MessageIO,
} from '../../src/index.js';

/** Reusable phone identity so a reconnect presents the SAME device. */
export interface PhoneIdentity {
  privateKey: KeyObject;
  publicKeyHex: string;
  deviceId: string;
}

/** Generate a fresh phone identity (Ed25519 keypair + random deviceId). */
export function newPhoneIdentity(): PhoneIdentity {
  const keys = generateKeyPairSync('ed25519');
  const publicKeyHex = Buffer.from(
    (keys.publicKey.export({ format: 'jwk' }) as { x: string }).x,
    'base64url',
  ).toString('hex');
  return { privateKey: keys.privateKey, publicKeyHex, deviceId: randomUUID() };
}

export class FakePhone {
  private constructor(
    private readonly io: MessageIO,
    private readonly queue: ReturnType<typeof queueFor>,
    private readonly channel: BridgeSecureChannel,
    readonly sessionId: string,
    readonly identity: PhoneIdentity,
    readonly sessionKey: Buffer,
  ) {}

  get deviceId(): string {
    return this.identity.deviceId;
  }

  /** Highest bridge→phone seq applied on this connection (persist for resume). */
  get lastAppliedSeq(): number {
    return this.channel.lastInboundSeq;
  }

  static async connect(
    io: MessageIO,
    options: {
      sessionId: string;
      mode?: 'qr_bootstrap' | 'trusted_reconnect';
      /** Reuse an identity (e.g. for a trusted reconnect). Fresh when omitted. */
      identity?: PhoneIdentity;
      /** Sent in clientHello so the bridge replays missed outbound (seq > N). */
      resumeState?: { lastAppliedBridgeOutboundSeq: number };
    },
  ): Promise<FakePhone> {
    const queue = queueFor(io);
    const send = (msg: unknown): void => io.send(Buffer.from(JSON.stringify(msg), 'utf-8'));

    const identity = options.identity ?? newPhoneIdentity();
    const ephemeral = generateEphemeralKeyPair();
    const clientNonce = randomHex(32);

    send({
      kind: 'clientHello',
      protocolVersion: 1,
      sessionId: options.sessionId,
      handshakeMode: options.mode ?? 'qr_bootstrap',
      phoneDeviceId: identity.deviceId,
      phoneIdentityPublicKey: identity.publicKeyHex,
      phoneEphemeralPublicKey: ephemeral.publicKeyHex,
      clientNonce,
      ...(options.resumeState !== undefined ? { resumeState: options.resumeState } : {}),
    });

    const serverHello = await nextJson(queue);
    if (serverHello['kind'] !== 'serverHello') {
      throw new Error(`expected serverHello, got ${String(serverHello['kind'])}`);
    }
    const transcript = buildHandshakeTranscript({
      clientNonce,
      phoneEphemeralPublicKey: ephemeral.publicKeyHex,
      macEphemeralPublicKey: serverHello['macEphemeralPublicKey'] as string,
      serverNonce: serverHello['serverNonce'] as string,
      sessionId: options.sessionId,
      keyEpoch: serverHello['keyEpoch'] as number,
      expiresAtForTranscript: serverHello['expiresAtForTranscript'] as number,
    });
    const transcriptBytes = Buffer.from(transcript, 'utf-8');
    const signatureOk = verifyEd25519(
      transcriptBytes,
      serverHello['macSignature'] as string,
      serverHello['macIdentityPublicKey'] as string,
    );
    if (!signatureOk) throw new Error('bridge signature verification failed');

    const sessionKey = deriveSessionKey({
      privateKey: ephemeral.privateKey,
      peerPublicHex: serverHello['macEphemeralPublicKey'] as string,
      clientNonceHex: clientNonce,
      serverNonceHex: serverHello['serverNonce'] as string,
    });

    const phoneSignature = edSign(null, transcriptBytes, identity.privateKey).toString('hex');
    send({
      kind: 'clientAuth',
      sessionId: options.sessionId,
      phoneDeviceId: identity.deviceId,
      keyEpoch: serverHello['keyEpoch'] as number,
      phoneSignature,
    });

    const ready = await nextJson(queue);
    if (ready['kind'] !== 'ready') throw new Error(`expected ready, got ${String(ready['kind'])}`);

    // 'phone' role: this channel's own AAD direction is phone→bridge on
    // encrypt and it expects bridge→phone on decrypt — the mirror image of
    // the real bridge's own BridgeSecureChannel (architecture/02a §5.9.1).
    const channel = new BridgeSecureChannel(sessionKey, options.sessionId, undefined, 'phone');
    return new FakePhone(io, queue, channel, options.sessionId, identity, sessionKey);
  }

  /** Read and decrypt the next inbound envelope (e.g. a server notification). */
  async receive(): Promise<Record<string, unknown>> {
    const envelope = await nextJson(this.queue);
    const plaintext = this.channel.decrypt(envelope as never);
    return JSON.parse(plaintext.toString('utf-8')) as Record<string, unknown>;
  }

  /** Send a JSON-RPC request encrypted, and await the decrypted response. */
  async request(method: string, params?: unknown): Promise<JsonRpcResponse> {
    const request = makeRequest(randomUUID(), method, params);
    this.io.send(
      Buffer.from(
        JSON.stringify(this.channel.encrypt(Buffer.from(JSON.stringify(request)))),
        'utf-8',
      ),
    );
    const envelope = await nextJson(this.queue);
    const plaintext = this.channel.decrypt(envelope as never);
    return JSON.parse(plaintext.toString('utf-8')) as JsonRpcResponse;
  }

  close(): void {
    this.io.close();
  }
}

async function nextJson(queue: ReturnType<typeof queueFor>): Promise<Record<string, unknown>> {
  const raw = await queue.next();
  return JSON.parse(raw.toString('utf-8')) as Record<string, unknown>;
}
