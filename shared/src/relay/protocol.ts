/**
 * Relay protocol v1 — the control frames a bridge and a phone exchange with the
 * user's own relay (a Cloudflare Worker + Durable Object) BEFORE the relay turns
 * into a blind pipe for the E2EE handshake and envelopes.
 *
 * Source: architecture/02a-system-architecture.md §5.10.
 *
 * Shape of a connection:
 *
 *   1. The client opens one of the three WebSocket routes below.
 *   2. The relay sends {@link RelayChallenge}.
 *   3. The client answers with the auth frame for its route, signing
 *      {@link relaySigningMessage} with its Ed25519 identity key.
 *   4. The relay answers {@link RelayReady} or closes with a {@link RELAY_CLOSE}
 *      code.
 *   5. Host route: control frames for the life of the socket. Phone and channel
 *      routes: once both are ready, every further frame is forwarded verbatim —
 *      the relay never parses it.
 *
 * Everything here is runtime-agnostic (no Node built-ins, no Ajv: Workers
 * forbid code generation), so the Worker, the bridge and the tests share it.
 * The phone mirrors it in Dart.
 */

/** Wire version of this control protocol (independent of the E2EE version). */
export const RELAY_PROTOCOL_VERSION = 1;

/** Name of the Worker the bridge deploys into the user's account. */
export const RELAY_WORKER_NAME = 'uxnan-relay';

/** Workers compatibility date the relay is deployed (and tested) with. */
export const RELAY_COMPATIBILITY_DATE = '2026-07-01';

/** URL path prefix of every relay route. */
export const RELAY_PATH_PREFIX = '/v1';

/** Max bytes of any control frame (challenge, auth, allow list, ticket, dial). */
export const RELAY_MAX_CONTROL_FRAME_BYTES = 64 * 1024;

/** Max phone keys in an allow list (one per trusted phone). */
export const RELAY_MAX_ALLOWED_PHONES = 64;

/** Max phones connected (or connecting) through one relay at once. */
export const RELAY_MAX_PHONE_CONNECTIONS = 8;

/** Max sockets of any kind one relay room holds, authenticated or not. */
export const RELAY_MAX_SOCKETS = 32;

/** How long a client has to answer the challenge. */
export const RELAY_AUTH_TIMEOUT_MS = 10_000;

/** How long a phone waits for the bridge to open its channel. */
export const RELAY_DIAL_TIMEOUT_MS = 10_000;

/** Keepalive text frame the relay answers without waking (`pong`). */
export const RELAY_PING = 'ping';
export const RELAY_PONG = 'pong';

/** Close codes the relay uses (4000–4999 are application-defined). */
export const RELAY_CLOSE = {
  /** The auth frame was malformed or its signature did not verify. */
  authFailed: 4001,
  /** No auth frame within {@link RELAY_AUTH_TIMEOUT_MS}. */
  authTimeout: 4002,
  /** The key is not allowed here (unknown host key, untrusted phone, bad ticket). */
  notAllowed: 4003,
  /** No bridge is connected to this relay right now. */
  bridgeOffline: 4004,
  /** The bridge did not open the phone's channel in time. */
  bridgeTimeout: 4005,
  /** The other end of a paired channel went away. */
  peerClosed: 4006,
  /** A control frame was too large or not valid JSON. */
  badFrame: 4008,
  /** A newer connection of the same host replaced this one. */
  replaced: 4009,
  /** The phone's key was removed from the allow list. */
  revoked: 4010,
  /** Too many phones connected at once. */
  full: 4011,
} as const;

export type RelayCloseCode = (typeof RELAY_CLOSE)[keyof typeof RELAY_CLOSE];

/** The three routes a relay serves. */
export type RelayRoute = 'host' | 'phone' | 'channel';

/** `routingId` and `channelId`: 32 lowercase hex chars (128 random bits). */
const ID_RE = /^[0-9a-f]{32}$/;
/** Ed25519 public key: 32 bytes, hex. */
const KEY_RE = /^[0-9a-f]{64}$/;
/** Ed25519 signature: 64 bytes, hex. */
const SIG_RE = /^[0-9a-f]{128}$/;
/** Challenge nonce: 32 bytes, hex. */
const NONCE_RE = /^[0-9a-f]{64}$/;
/** SHA-256 digest, hex. */
const HASH_RE = /^[0-9a-f]{64}$/;
/** Pairing ticket: 32 bytes, base64url without padding. */
const TICKET_RE = /^[A-Za-z0-9_-]{43}$/;

export function isRelayId(value: unknown): value is string {
  return typeof value === 'string' && ID_RE.test(value);
}

export function isEd25519PublicKeyHex(value: unknown): value is string {
  return typeof value === 'string' && KEY_RE.test(value);
}

export function isPairingTicket(value: unknown): value is string {
  return typeof value === 'string' && TICKET_RE.test(value);
}

/** Path of a route, e.g. `/v1/channel/<routingId>/<channelId>`. */
export function relayRoutePath(route: RelayRoute, routingId: string, channelId?: string): string {
  const base = `${RELAY_PATH_PREFIX}/${route === 'phone' ? 'connect' : route}/${routingId}`;
  return route === 'channel' ? `${base}/${channelId ?? ''}` : base;
}

/** Parse a request path into its route, or `null` if it is not a relay route. */
export function parseRelayPath(
  pathname: string,
): { route: RelayRoute; routingId: string; channelId?: string } | null {
  const parts = pathname.split('/');
  // ['', 'v1', <segment>, <routingId>, <channelId>?]
  if (parts[0] !== '' || `/${parts[1] ?? ''}` !== RELAY_PATH_PREFIX) return null;
  const segment = parts[2];
  const routingId = parts[3];
  if (!isRelayId(routingId)) return null;
  if (segment === 'host' && parts.length === 4) return { route: 'host', routingId };
  if (segment === 'connect' && parts.length === 4) return { route: 'phone', routingId };
  if (segment === 'channel' && parts.length === 5 && isRelayId(parts[4])) {
    return { route: 'channel', routingId, channelId: parts[4] };
  }
  return null;
}

/**
 * The exact UTF-8 string a client signs to answer a challenge. Binding the
 * route, the relay host (`hostname[:port]` of the URL dialled), the routing id
 * and (for a channel) the channel id means a signature cannot be replayed on
 * another route, relay or channel; the nonce makes it single-use.
 */
export function relaySigningMessage(options: {
  route: RelayRoute;
  host: string;
  routingId: string;
  channelId?: string;
  nonce: string;
}): string {
  return [
    `uxnan-relay-v${RELAY_PROTOCOL_VERSION}`,
    options.route,
    options.host,
    options.routingId,
    options.channelId ?? '',
    options.nonce,
  ].join('|');
}

// --- Relay → client -----------------------------------------------------------

export interface RelayChallenge {
  t: 'challenge';
  v: number;
  nonce: string;
}

export interface RelayReady {
  t: 'ready';
}

/** Relay → host: a trusted phone is waiting; open `/v1/channel/<routingId>/<channel>`. */
export interface RelayDial {
  t: 'dial';
  channel: string;
}

// --- Client → relay -----------------------------------------------------------

/** Host route: the bridge proves it holds a host key the relay was deployed with. */
export interface RelayHostAuth {
  t: 'host-auth';
  key: string;
  sig: string;
}

/** Channel route: the bridge proves it is the host bound to this routing id. */
export interface RelayChannelAuth {
  t: 'channel-auth';
  sig: string;
}

/**
 * Phone route: the phone proves it holds `key`. A trusted phone's key is on the
 * allow list; a phone pairing for the first time also presents the one-time
 * `ticket` from the QR, accepted only while the bridge's pairing window is open.
 */
export interface RelayPhoneAuth {
  t: 'phone-auth';
  key: string;
  sig: string;
  ticket?: string;
}

/** Host → relay: the full set of trusted phone keys (replaces the previous set). */
export interface RelayAllow {
  t: 'allow';
  keys: string[];
}

/**
 * Host → relay: open a pairing window. `hash` is the SHA-256 (hex) of the
 * ticket's ASCII bytes; the ticket itself never reaches the relay before a
 * phone presents it. `ttlMs` is an age, not a timestamp (clocks disagree).
 */
export interface RelayTicket {
  t: 'ticket';
  hash: string;
  ttlMs: number;
}

export type RelayClientFrame =
  | RelayHostAuth
  | RelayChannelAuth
  | RelayPhoneAuth
  | RelayAllow
  | RelayTicket;

export type RelayServerFrame = RelayChallenge | RelayReady | RelayDial;

/** Longest pairing window a ticket may hold open. */
export const RELAY_MAX_TICKET_TTL_MS = 15 * 60_000;

/**
 * Parse a control frame a client sent. Returns `null` for anything that is not
 * exactly one of the client frames (unknown kind, extra fields, wrong types).
 */
export function parseRelayClientFrame(raw: string): RelayClientFrame | null {
  if (raw.length > RELAY_MAX_CONTROL_FRAME_BYTES) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const frame = data as Record<string, unknown>;
  switch (frame['t']) {
    case 'host-auth':
      return onlyKeys(frame, ['t', 'key', 'sig']) &&
        isEd25519PublicKeyHex(frame['key']) &&
        isSig(frame['sig'])
        ? { t: 'host-auth', key: frame['key'], sig: frame['sig'] }
        : null;
    case 'channel-auth':
      return onlyKeys(frame, ['t', 'sig']) && isSig(frame['sig'])
        ? { t: 'channel-auth', sig: frame['sig'] }
        : null;
    case 'phone-auth': {
      if (!onlyKeys(frame, ['t', 'key', 'sig', 'ticket'])) return null;
      if (!isEd25519PublicKeyHex(frame['key']) || !isSig(frame['sig'])) return null;
      const ticket = frame['ticket'];
      if (ticket === undefined) return { t: 'phone-auth', key: frame['key'], sig: frame['sig'] };
      return isPairingTicket(ticket)
        ? { t: 'phone-auth', key: frame['key'], sig: frame['sig'], ticket }
        : null;
    }
    case 'allow': {
      const keys = frame['keys'];
      if (!onlyKeys(frame, ['t', 'keys']) || !Array.isArray(keys)) return null;
      if (keys.length > RELAY_MAX_ALLOWED_PHONES || !keys.every(isEd25519PublicKeyHex)) {
        return null;
      }
      return { t: 'allow', keys: [...new Set(keys)] };
    }
    case 'ticket': {
      const ttlMs = frame['ttlMs'];
      return onlyKeys(frame, ['t', 'hash', 'ttlMs']) &&
        typeof frame['hash'] === 'string' &&
        HASH_RE.test(frame['hash']) &&
        typeof ttlMs === 'number' &&
        Number.isInteger(ttlMs) &&
        ttlMs > 0 &&
        ttlMs <= RELAY_MAX_TICKET_TTL_MS
        ? { t: 'ticket', hash: frame['hash'], ttlMs }
        : null;
    }
    default:
      return null;
  }
}

/** Parse a control frame the relay sent (the bridge and phone side). */
export function parseRelayServerFrame(raw: string): RelayServerFrame | null {
  if (raw.length > RELAY_MAX_CONTROL_FRAME_BYTES) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const frame = data as Record<string, unknown>;
  switch (frame['t']) {
    case 'challenge':
      return typeof frame['v'] === 'number' &&
        typeof frame['nonce'] === 'string' &&
        NONCE_RE.test(frame['nonce'])
        ? { t: 'challenge', v: frame['v'], nonce: frame['nonce'] }
        : null;
    case 'ready':
      return { t: 'ready' };
    case 'dial':
      return isRelayId(frame['channel']) ? { t: 'dial', channel: frame['channel'] } : null;
    default:
      return null;
  }
}

function isSig(value: unknown): value is string {
  return typeof value === 'string' && SIG_RE.test(value);
}

function onlyKeys(frame: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(frame).every((k) => allowed.includes(k));
}
