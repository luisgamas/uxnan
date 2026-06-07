/**
 * Protocol-wide constants shared by the bridge, relay and mobile app.
 *
 * These mirror the mobile side's `lib/core/constants/protocol_constants.dart`
 * and MUST stay byte-for-byte compatible with it.
 *
 * Source: architecture/02a-system-architecture.md §5.9.1.
 */

/** Secure transport protocol version negotiated in the handshake. */
export const SECURE_PROTOCOL_VERSION = 1;

/** Version stamped into the pairing QR payload. */
export const PAIRING_QR_VERSION = 2;

/** HKDF `info` tag used when deriving the session key. */
export const HKDF_INFO_TAG = 'uxnan-e2ee-v1';

/** Maximum age of a pairing payload before it is rejected (5 minutes). */
export const MAX_PAIRING_AGE_MS = 300_000;

/** Allowed clock skew during handshake validation (60 seconds). */
export const CLOCK_SKEW_TOLERANCE_MS = 60_000;

/** Allowed clock skew during trusted reconnect (90 seconds). */
export const TRUSTED_RECONNECT_SKEW_MS = 90_000;

/** Bridge outbound buffer cap (messages) for catch-up on reconnect. */
export const MAX_BRIDGE_OUTBOUND_MESSAGES = 500;

/** Bridge outbound buffer cap (bytes) for catch-up on reconnect — 10 MiB. */
export const MAX_BRIDGE_OUTBOUND_BYTES = 10_485_760;

/** Default relay endpoint. */
export const DEFAULT_RELAY_URL = 'wss://relay.uxnan.io';

/** Default LAN port for direct WebSocket connections. */
export const DEFAULT_LAN_PORT = 19850;

/** JSON-RPC protocol version string. */
export const JSONRPC_VERSION = '2.0';
