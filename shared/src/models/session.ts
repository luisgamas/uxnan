/**
 * Session and trust models.
 *
 * Dart equivalents: `uxnanmobile/lib/domain/entities/{secure_session,trusted_device}.dart`.
 */

export type HandshakeMode = 'qr_bootstrap' | 'trusted_reconnect';

export interface ConnectedPhone {
  deviceId: string;
  displayName: string;
  connectedAt: number;
  lastSeen: number;
}

export interface TrustedDevice {
  deviceId: string;
  displayName: string;
  /** Phone Ed25519 identity public key (hex). */
  publicKey: string;
  pairedAt: number;
  lastSeen?: number;
}

export interface BridgeStatus {
  version: string;
  relayConnected: boolean;
  lanEnabled: boolean;
  activeSessions: number;
  platform: NodeJS.Platform | string;
  uptimeMs: number;
}
