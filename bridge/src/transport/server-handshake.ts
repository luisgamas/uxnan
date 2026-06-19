/**
 * Server (bridge) side of the E2EE handshake
 * (architecture/02a §5.9.1, Phase 2): clientHello → serverHello → clientAuth →
 * ready. Interoperates byte-for-byte with the mobile `SecureTransportLayer`.
 */
import {
  MAX_PAIRING_AGE_MS,
  SECURE_PROTOCOL_VERSION,
  buildHandshakeTranscript,
  type HandshakeMode,
} from '@uxnan/shared';
import type { SecureDeviceState } from '../secure-device-state.js';
import type { MessageQueue } from './message-io.js';
import type { TrustStore } from './trust-store.js';
import { BridgeSecureChannel } from './secure-channel.js';
import type { OutboundLog } from './outbound-log.js';
import { deriveSessionKey, generateEphemeralKeyPair, randomHex, verifyEd25519 } from './crypto.js';

export class HandshakeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HandshakeError';
  }
}

export interface ServerHandshakeOptions {
  queue: MessageQueue;
  send: (message: unknown) => void;
  deviceState: SecureDeviceState;
  trustStore: TrustStore;
  displayName: string;
  now: () => number;
  /** If set, the clientHello sessionId must match (active pairing session). */
  expectedSessionId?: string;
  /** Key epoch to advertise (default 1). */
  keyEpoch?: number;
  /**
   * Resolve the per-device outbound log (seq counter + catch-up window) for the
   * phone identified in the clientHello. The channel is built over it so its
   * `seq` continues across reconnects and every outbound message is retained.
   * Omitted in tests that don't exercise catch-up (channel uses its fallback
   * counter, nothing retained).
   */
  outboundLogFor?: (phoneDeviceId: string) => OutboundLog;
}

export interface ServerHandshakeResult {
  sessionId: string;
  phoneDeviceId: string;
  phoneIdentityPublicKey: string;
  mode: HandshakeMode;
  keyEpoch: number;
  channel: BridgeSecureChannel;
  /**
   * Highest bridge→phone `seq` the phone reports having applied, from
   * `clientHello.resumeState` (0 when absent/invalid). The caller replays the
   * outbound log's entries with a greater seq.
   */
  lastAppliedBridgeOutboundSeq: number;
}

function requireString(obj: Record<string, unknown>, key: string): string {
  const value = obj[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new HandshakeError(`clientHello missing field: ${key}`);
  }
  return value;
}

export async function performServerHandshake(
  options: ServerHandshakeOptions,
): Promise<ServerHandshakeResult> {
  const { queue, send, deviceState, trustStore, now } = options;

  const helloRaw = await queue.next();
  const hello = parseJson(helloRaw);
  if (hello['kind'] !== 'clientHello') {
    throw new HandshakeError(`expected clientHello, got ${String(hello['kind'])}`);
  }

  const sessionId = requireString(hello, 'sessionId');
  if (options.expectedSessionId && sessionId !== options.expectedSessionId) {
    throw new HandshakeError('sessionId does not match the active pairing session');
  }
  const phoneDeviceId = requireString(hello, 'phoneDeviceId');
  const phoneIdentityPublicKey = requireString(hello, 'phoneIdentityPublicKey');
  const phoneEphemeralPublicKey = requireString(hello, 'phoneEphemeralPublicKey');
  const clientNonce = requireString(hello, 'clientNonce');
  const lastAppliedBridgeOutboundSeq = parseResumeSeq(hello['resumeState']);
  const mode: HandshakeMode =
    hello['handshakeMode'] === 'trusted_reconnect' ? 'trusted_reconnect' : 'qr_bootstrap';

  if (mode === 'trusted_reconnect') {
    const trusted = await trustStore.get(phoneDeviceId);
    if (!trusted || trusted.publicKey !== phoneIdentityPublicKey) {
      throw new HandshakeError('trusted reconnect: phone identity is not trusted');
    }
  }

  const ephemeral = generateEphemeralKeyPair();
  const serverNonce = randomHex(32);
  const keyEpoch = options.keyEpoch ?? 1;
  const expiresAtForTranscript = now() + MAX_PAIRING_AGE_MS;
  const identity = deviceState.identity;

  const transcript = buildHandshakeTranscript({
    clientNonce,
    phoneEphemeralPublicKey,
    macEphemeralPublicKey: ephemeral.publicKeyHex,
    serverNonce,
    sessionId,
    keyEpoch,
    expiresAtForTranscript,
  });
  const transcriptBytes = Buffer.from(transcript, 'utf-8');
  const macSignature = deviceState.sign(transcriptBytes);

  send({
    kind: 'serverHello',
    protocolVersion: SECURE_PROTOCOL_VERSION,
    sessionId,
    macDeviceId: identity.macDeviceId,
    macIdentityPublicKey: identity.macIdentityPublicKey,
    macEphemeralPublicKey: ephemeral.publicKeyHex,
    serverNonce,
    keyEpoch,
    expiresAtForTranscript,
    macSignature,
    clientNonce,
    displayName: options.displayName,
  });

  const authRaw = await queue.next();
  const auth = parseJson(authRaw);
  if (auth['kind'] !== 'clientAuth') {
    throw new HandshakeError(`expected clientAuth, got ${String(auth['kind'])}`);
  }
  if (auth['sessionId'] !== sessionId) {
    throw new HandshakeError('clientAuth sessionId mismatch');
  }
  const phoneSignature = requireString(auth, 'phoneSignature');
  if (!verifyEd25519(transcriptBytes, phoneSignature, phoneIdentityPublicKey)) {
    throw new HandshakeError('phone signature verification failed');
  }

  const key = deriveSessionKey({
    privateKey: ephemeral.privateKey,
    peerPublicHex: phoneEphemeralPublicKey,
    clientNonceHex: clientNonce,
    serverNonceHex: serverNonce,
  });

  if (mode === 'qr_bootstrap') {
    await trustStore.upsert({
      deviceId: phoneDeviceId,
      displayName: phoneDeviceId,
      publicKey: phoneIdentityPublicKey,
      pairedAt: now(),
      lastSeen: now(),
    });
  }

  send({ kind: 'ready', sessionId, keyEpoch, macDeviceId: identity.macDeviceId });

  // Build the channel over this phone's persistent outbound log so its seq
  // continues across reconnects and every outbound message is retained for
  // catch-up.
  const outboundLog = options.outboundLogFor?.(phoneDeviceId);

  return {
    sessionId,
    phoneDeviceId,
    phoneIdentityPublicKey,
    mode,
    keyEpoch,
    channel: new BridgeSecureChannel(key, sessionId, outboundLog),
    lastAppliedBridgeOutboundSeq,
  };
}

/**
 * Read `clientHello.resumeState.lastAppliedBridgeOutboundSeq` defensively: a
 * non-negative integer is honored, anything else (absent, NaN, negative, wrong
 * type) means "no catch-up" → 0.
 */
function parseResumeSeq(resumeState: unknown): number {
  if (!resumeState || typeof resumeState !== 'object') return 0;
  const value = (resumeState as Record<string, unknown>)['lastAppliedBridgeOutboundSeq'];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

function parseJson(bytes: Buffer): Record<string, unknown> {
  const decoded = JSON.parse(bytes.toString('utf-8')) as unknown;
  if (typeof decoded !== 'object' || decoded === null) {
    throw new HandshakeError('handshake frame is not a JSON object');
  }
  return decoded as Record<string, unknown>;
}
