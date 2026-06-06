/**
 * Pairing QR payload (version 2).
 *
 * Source: architecture/02a-system-architecture.md §5.9.1 (Phase 1) and
 * uxnandesktop/architecture/02e-bridge-integration.md §5.3.
 *
 * The bridge GENERATES this payload; the mobile app parses it
 * (`PairingPayload.fromQrString`). The wire field names below are the contract.
 *
 * FOR-DEV: verify the QR string encoding (this module uses compact JSON) against
 * the mobile `PairingPayload.fromQrString` implementation on the `uxnanmobile`
 * branch before enabling real pairing — see bridge/FOR-DEV.md.
 */
import { MAX_PAIRING_AGE_MS, PAIRING_QR_VERSION } from '../constants.js';

export interface PairingPayload {
  /** Payload version. Always {@link PAIRING_QR_VERSION}. */
  v: number;
  /** Relay WebSocket URL. */
  relay: string;
  sessionId: string;
  macDeviceId: string;
  /** Bridge Ed25519 identity public key (hex, 32 bytes). */
  macIdentityPublicKey: string;
  /** Unix epoch ms when this payload expires. */
  expiresAt: number;
  displayName: string;
}

export type PairingValidationError =
  | 'invalid_json'
  | 'not_an_object'
  | 'unsupported_version'
  | 'missing_field'
  | 'expired';

export type PairingValidationResult =
  | { valid: true; payload: PairingPayload }
  | { valid: false; error: PairingValidationError; detail?: string };

const REQUIRED_STRING_FIELDS: (keyof PairingPayload)[] = [
  'relay',
  'sessionId',
  'macDeviceId',
  'macIdentityPublicKey',
  'displayName',
];

/** Serialize a pairing payload to the QR string (compact JSON). */
export function encodePairingQr(payload: PairingPayload): string {
  return JSON.stringify(payload);
}

/**
 * Validate a decoded pairing payload object against the v2 contract.
 *
 * @param now current time in epoch ms (injected for testability)
 */
export function validatePairingPayload(value: unknown, now: number): PairingValidationResult {
  if (typeof value !== 'object' || value === null) {
    return { valid: false, error: 'not_an_object' };
  }
  const obj = value as Record<string, unknown>;

  if (obj['v'] !== PAIRING_QR_VERSION) {
    return { valid: false, error: 'unsupported_version', detail: String(obj['v']) };
  }
  for (const field of REQUIRED_STRING_FIELDS) {
    if (typeof obj[field] !== 'string' || (obj[field] as string).length === 0) {
      return { valid: false, error: 'missing_field', detail: field };
    }
  }
  if (typeof obj['expiresAt'] !== 'number') {
    return { valid: false, error: 'missing_field', detail: 'expiresAt' };
  }
  if ((obj['expiresAt'] as number) <= now) {
    return { valid: false, error: 'expired' };
  }

  return { valid: true, payload: obj as unknown as PairingPayload };
}

/** Parse a QR string and validate it in one step. */
export function parsePairingQr(qr: string, now: number): PairingValidationResult {
  let decoded: unknown;
  try {
    decoded = JSON.parse(qr);
  } catch {
    return { valid: false, error: 'invalid_json' };
  }
  return validatePairingPayload(decoded, now);
}

/** Convenience: the default expiry for a freshly generated payload. */
export function defaultPairingExpiry(now: number): number {
  return now + MAX_PAIRING_AGE_MS;
}
