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
  /**
   * Latest bridge version published to npm (dist-tag `alpha`), as discovered by
   * the bridge's own background update check. Absent when the check hasn't run
   * yet or couldn't reach the registry (offline) — never blocks status.
   */
  latestVersion?: string;
  /**
   * True when {@link latestVersion} is strictly newer than {@link version}
   * (SemVer precedence). Lets the phone show a "bridge update available" hint
   * without querying npm itself. Absent/false when unknown or up to date.
   */
  updateAvailable?: boolean;
}
