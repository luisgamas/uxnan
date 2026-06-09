/**
 * Pairing QR generation.
 *
 * Source: architecture/02a-system-architecture.md §5.8.2 (qr) and §5.9.1 (Phase 1).
 */
import { randomUUID } from 'node:crypto';
import qrcode from 'qrcode-terminal';
import {
  PAIRING_QR_VERSION,
  defaultPairingExpiry,
  encodePairingQr,
  type PairingPayload,
} from '@uxnan/shared';

export interface GeneratePairingOptions {
  /** Relay URL (remote fallback). Omit for a LAN/Tailscale-only QR. */
  relayUrl?: string;
  /** Direct `host:port` addresses the phone should try first (LAN/Tailscale). */
  hosts?: string[];
  macDeviceId: string;
  macIdentityPublicKey: string;
  displayName: string;
  /** Current time in epoch ms (injected for testability). */
  now: number;
  /** Optional explicit session id; a random UUID is used otherwise. */
  sessionId?: string;
}

export function generatePairingPayload(options: GeneratePairingOptions): PairingPayload {
  const payload: PairingPayload = {
    v: PAIRING_QR_VERSION,
    sessionId: options.sessionId ?? randomUUID(),
    macDeviceId: options.macDeviceId,
    macIdentityPublicKey: options.macIdentityPublicKey,
    expiresAt: defaultPairingExpiry(options.now),
    displayName: options.displayName,
  };
  if (options.relayUrl) payload.relay = options.relayUrl;
  if (options.hosts && options.hosts.length > 0) payload.hosts = options.hosts;
  return payload;
}

/** Render a pairing payload as an ASCII QR code (for terminal display). */
export function renderPairingQr(payload: PairingPayload): Promise<string> {
  const data = encodePairingQr(payload);
  return new Promise((resolve) => {
    qrcode.generate(data, { small: true }, (output: string) => resolve(output));
  });
}
