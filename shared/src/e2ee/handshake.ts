/**
 * E2EE handshake message types.
 *
 * Source: architecture/02a-system-architecture.md §5.9.1.
 *
 * Canonical transcript encoding (the bytes that get signed) — the bridge MUST
 * reproduce this byte-for-byte to interoperate with the mobile app:
 *
 *   transcript = clientNonce || phoneEphemeralPublicKey || macEphemeralPublicKey
 *              || serverNonce || sessionId || keyEpoch || expiresAtForTranscript
 *
 * Each field is encoded in its *wire* form and UTF-8 concatenated, in order:
 *   - byte fields (nonces, ephemeral keys): lowercase hex
 *   - sessionId: the string as-is
 *   - integers (keyEpoch, expiresAtForTranscript): decimal string
 */
import type { HandshakeMode } from '../models/session.js';

export interface ClientHello {
  kind: 'clientHello';
  protocolVersion: number;
  sessionId: string;
  handshakeMode: HandshakeMode;
  phoneDeviceId: string;
  /** Ed25519 identity public key (hex, 32 bytes). */
  phoneIdentityPublicKey: string;
  /** X25519 ephemeral public key (hex, 32 bytes). */
  phoneEphemeralPublicKey: string;
  /** Random nonce (hex, 32 bytes). */
  clientNonce: string;
  resumeState?: ResumeState;
}

export interface ResumeState {
  lastAppliedBridgeOutboundSeq: number;
}

export interface ServerHello {
  kind: 'serverHello';
  protocolVersion: number;
  sessionId: string;
  handshakeMode: HandshakeMode;
  macDeviceId: string;
  /** Ed25519 identity public key (hex, 32 bytes). */
  macIdentityPublicKey: string;
  /** X25519 ephemeral public key (hex, 32 bytes). */
  macEphemeralPublicKey: string;
  /** Random nonce (hex, 32 bytes). */
  serverNonce: string;
  keyEpoch: number;
  expiresAtForTranscript: number;
  /** Ed25519 signature over the transcript (hex, 64 bytes). */
  macSignature: string;
  /** Echo of the client nonce (hex). */
  clientNonce: string;
  displayName: string;
}

export interface ClientAuth {
  kind: 'clientAuth';
  sessionId: string;
  phoneDeviceId: string;
  keyEpoch: number;
  /** Ed25519 signature over the same transcript (hex, 64 bytes). */
  phoneSignature: string;
}

export interface HandshakeReady {
  kind: 'ready';
  sessionId: string;
  keyEpoch: number;
  macDeviceId: string;
}

export type HandshakeMessage = ClientHello | ServerHello | ClientAuth | HandshakeReady;

/**
 * Build the canonical transcript string that both peers sign. See the module
 * docstring for the exact encoding contract.
 */
export function buildHandshakeTranscript(fields: {
  clientNonce: string;
  phoneEphemeralPublicKey: string;
  macEphemeralPublicKey: string;
  serverNonce: string;
  sessionId: string;
  keyEpoch: number;
  expiresAtForTranscript: number;
}): string {
  return (
    fields.clientNonce +
    fields.phoneEphemeralPublicKey +
    fields.macEphemeralPublicKey +
    fields.serverNonce +
    fields.sessionId +
    String(fields.keyEpoch) +
    String(fields.expiresAtForTranscript)
  );
}
