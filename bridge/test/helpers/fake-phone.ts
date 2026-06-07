/**
 * A faithful, independent implementation of the PHONE side of the E2EE protocol,
 * built only from the documented byte contract + node:crypto. Used to test that
 * the bridge server handshake/transport interoperate end-to-end.
 */
import { generateKeyPairSync, randomUUID, sign as edSign } from 'node:crypto';
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

export class FakePhone {
  private constructor(
    private readonly io: MessageIO,
    private readonly queue: ReturnType<typeof queueFor>,
    private readonly channel: BridgeSecureChannel,
    readonly sessionId: string,
    readonly deviceId: string,
    readonly sessionKey: Buffer,
  ) {}

  static async connect(
    io: MessageIO,
    options: { sessionId: string; mode?: 'qr_bootstrap' | 'trusted_reconnect' },
  ): Promise<FakePhone> {
    const queue = queueFor(io);
    const send = (msg: unknown): void => io.send(Buffer.from(JSON.stringify(msg), 'utf-8'));

    const identity = generateKeyPairSync('ed25519');
    const phoneIdentityPublicKey = Buffer.from(
      (identity.publicKey.export({ format: 'jwk' }) as { x: string }).x,
      'base64url',
    ).toString('hex');
    const phoneDeviceId = randomUUID();
    const ephemeral = generateEphemeralKeyPair();
    const clientNonce = randomHex(32);

    send({
      kind: 'clientHello',
      protocolVersion: 1,
      sessionId: options.sessionId,
      handshakeMode: options.mode ?? 'qr_bootstrap',
      phoneDeviceId,
      phoneIdentityPublicKey,
      phoneEphemeralPublicKey: ephemeral.publicKeyHex,
      clientNonce,
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
      phoneDeviceId,
      keyEpoch: serverHello['keyEpoch'] as number,
      phoneSignature,
    });

    const ready = await nextJson(queue);
    if (ready['kind'] !== 'ready') throw new Error(`expected ready, got ${String(ready['kind'])}`);

    const channel = new BridgeSecureChannel(sessionKey, options.sessionId);
    return new FakePhone(io, queue, channel, options.sessionId, phoneDeviceId, sessionKey);
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
