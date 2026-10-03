/**
 * Pairing QR payload (version 3: `relay` is an object).
 *
 * Source: architecture/02a-system-architecture.md §5.9.1 (Phase 1) and
 * uxnandesktop/architecture/02e-bridge-integration.md §5.3.
 *
 * The bridge GENERATES this payload; the mobile app parses it
 * (`PairingPayload.fromQrString`). The wire field names below are the contract.
 *
 * QR string encoding: **Base64 of the UTF-8 JSON** — verified against the mobile
 * `PairingPayload.fromQrString` (spec 02a §5.5.4), which does
 * `base64.decode(base64.normalize(qr))` then `jsonDecode`.
 */
import { MAX_PAIRING_AGE_MS, PAIRING_QR_VERSION } from '../constants.js';
import { isPairingTicket, isRelayId } from '../relay/protocol.js';

export interface PairingPayload {
  /** Payload version. Always {@link PAIRING_QR_VERSION}. */
  v: number;
  /**
   * The bridge's own relay — the transport when the phone is on another
   * network. OPTIONAL: present only while a relay is set up and enabled; a
   * LAN/Tailscale setup pairs over {@link hosts} alone.
   */
  relay?: PairingRelay;
  /**
   * Direct `host:port` addresses where the bridge's LAN server listens (the bridge's
   * non-internal IPv4s — LAN and e.g. a Tailscale `100.x` address). The phone should
   * try these FIRST and fall back to {@link relay}. At least one of `hosts`/`relay`
   * must be present.
   */
  hosts?: string[];
  sessionId: string;
  macDeviceId: string;
  /** Bridge Ed25519 identity public key (hex, 32 bytes). */
  macIdentityPublicKey: string;
  /** Unix epoch ms when this payload expires. */
  expiresAt: number;
  displayName: string;
}

/** How a phone reaches the bridge's relay, as the pairing QR carries it. */
export interface PairingRelay {
  /** `wss://…` base URL of the relay. */
  url: string;
  /** The bridge's room on that relay (32 lowercase hex chars). */
  routingId: string;
  /**
   * One-time pairing ticket (32 random bytes, base64url) the relay accepts
   * while this pairing window is open, so a phone that is NOT on the LAN can
   * pair through the relay for the first time. Absent once the window closed.
   */
  ticket?: string;
}

/**
 * The bridge's current manual-pairing code (`bridge/pairingCode`, local control
 * channel only): what a phone types to fetch the {@link PairingPayload} from
 * `GET /pair/resolve`. Asking for it opens that bridge's pairing window, like
 * showing the QR does.
 */
export interface PairingCode {
  /** The code, grouped for reading (`ABCD-EFGH`). */
  code: string;
  /** How long until it rotates, in ms (an age, not a timestamp). */
  expiresInMs: number;
}

export type PairingValidationError =
  | 'invalid_json'
  | 'not_an_object'
  | 'unsupported_version'
  | 'missing_field'
  | 'missing_transport'
  | 'expired';

export type PairingValidationResult =
  | { valid: true; payload: PairingPayload }
  | { valid: false; error: PairingValidationError; detail?: string };

const REQUIRED_STRING_FIELDS: (keyof PairingPayload)[] = [
  'sessionId',
  'macDeviceId',
  'macIdentityPublicKey',
  'displayName',
];

/** Serialize a pairing payload to the QR string: Base64 of the UTF-8 JSON. */
export function encodePairingQr(payload: PairingPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64');
}

/**
 * Validate a decoded pairing payload object against the current contract ({@link PAIRING_QR_VERSION}).
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

  // Transport fields: `relay` (object) and/or `hosts` (string[]) — at least one.
  const relay = obj['relay'];
  if (relay !== undefined && !isPairingRelay(relay)) {
    return { valid: false, error: 'missing_field', detail: 'relay' };
  }
  const hosts = obj['hosts'];
  if (
    hosts !== undefined &&
    (!Array.isArray(hosts) || hosts.some((h) => typeof h !== 'string' || h.length === 0))
  ) {
    return { valid: false, error: 'missing_field', detail: 'hosts' };
  }
  const hasRelay = relay !== undefined;
  const hasHosts = Array.isArray(hosts) && hosts.length > 0;
  if (!hasRelay && !hasHosts) {
    return { valid: false, error: 'missing_transport' };
  }

  return { valid: true, payload: obj as unknown as PairingPayload };
}

/** Parse a QR string (Base64 of UTF-8 JSON) and validate it in one step. */
export function parsePairingQr(qr: string, now: number): PairingValidationResult {
  let decoded: unknown;
  try {
    const json = Buffer.from(qr.trim(), 'base64').toString('utf-8');
    decoded = JSON.parse(json);
  } catch {
    return { valid: false, error: 'invalid_json' };
  }
  return validatePairingPayload(decoded, now);
}

/** Convenience: the default expiry for a freshly generated payload. */
export function defaultPairingExpiry(now: number): number {
  return now + MAX_PAIRING_AGE_MS;
}

function isPairingRelay(value: unknown): value is PairingRelay {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const relay = value as Record<string, unknown>;
  return (
    typeof relay['url'] === 'string' &&
    /^wss?:\/\/[^/\s]+$/.test(relay['url']) &&
    isRelayId(relay['routingId']) &&
    (relay['ticket'] === undefined || isPairingTicket(relay['ticket']))
  );
}
