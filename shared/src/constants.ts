/**
 * Protocol-wide constants shared by the bridge, relay and mobile app.
 *
 * These mirror the mobile side's `lib/core/constants/protocol_constants.dart`
 * and MUST stay byte-for-byte compatible with it.
 *
 * Source: architecture/02a-system-architecture.md §5.9.1.
 */

/**
 * Secure transport protocol version negotiated in the handshake. Both sides
 * reject a mismatch during `clientHello`/`serverHello`, so an incompatible pair
 * fails fast and legibly instead of completing the handshake and then dropping
 * every encrypted frame.
 *
 * **Bump this whenever the encrypted-frame format changes** (envelope shape,
 * AAD layout, key derivation) — not just when the handshake JSON changes. The
 * handshake is the only place the two sides can still talk, so it is the only
 * place a version gap can be reported.
 *
 * - `1` — initial: AES-256-GCM over the envelope's ciphertext only.
 * - `2` — `sessionId`/`seq`/direction bound as GCM AAD (`buildEnvelopeAad`).
 */
export const SECURE_PROTOCOL_VERSION = 2;

/**
 * AAD direction bytes for {@link SECURE_PROTOCOL_VERSION} ≥ 2. The session key
 * is shared by both directions, so the direction is bound into the AAD to stop
 * a frame being reflected back at its own sender as apparently-inbound traffic.
 * Mirrored in the mobile `ProtocolConstants`.
 */
export const ENVELOPE_DIRECTION_PHONE_TO_BRIDGE = 0x01;
export const ENVELOPE_DIRECTION_BRIDGE_TO_PHONE = 0x02;

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
