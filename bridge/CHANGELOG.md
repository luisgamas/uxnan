# Changelog — uxnan-bridge

All notable changes to the bridge daemon are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/). Versioning: [SemVer](https://semver.org/).

## [Unreleased]

### Added — Phase 2 (live E2EE transport + relay)
- **Secure transport** (`src/transport/`) implementing the bridge (server) side
  of the E2EE protocol, interoperable byte-for-byte with the mobile app:
  - `crypto.ts`: X25519 + HKDF-SHA256 key derivation, AES-256-GCM
    encrypt/decrypt, Ed25519 verification — all via `node:crypto` (no external
    crypto deps).
  - `server-handshake.ts`: clientHello → serverHello → clientAuth → ready, with
    transcript signing/verification and `qr_bootstrap` / `trusted_reconnect`.
  - `secure-channel.ts`: AES-256-GCM envelopes with 1-based outbound seq and
    replay-protected inbound seq.
  - `session-handler.ts`: decrypts envelopes, dispatches JSON-RPC through the
    router, returns encrypted responses.
  - `relay-client.ts` / `lan-server.ts`: live `ws` transports (relay `mac`
    connection and direct-LAN server), adapted via a shared `MessageIO`.
  - `trust-store.ts`: trusted-phone persistence (`trusted-phones.json`),
    written on `qr_bootstrap` and read by `bridge/trustedDevices`.
- `startBridge` now exposes `connectRelay(sessionId)` and `startLan()`; the CLI
  `start` boots the LAN server and connects to the relay for a pairing session.
- Depends on the new `uxnan-relay` package for end-to-end tests.
- Tests: crypto round-trips, secure-channel replay/seq, an in-memory two-party
  handshake, a real-WebSocket LAN exchange, and a full phone ↔ relay ↔ bridge
  end-to-end (handshake + encrypted `bridge/status`). 33 bridge tests total.

### Added — Phase 1 (skeleton)
- Initial bridge daemon **skeleton** (TypeScript, ESM, Node ≥18).
- Daemon state under `~/.uxnan/` with atomic JSON writes (`DaemonState`) and
  config defaults/merge (`DaemonConfig`, `resolveDaemonConfig`).
- Ed25519 identity (`SecureDeviceState`) with a pluggable `SecretStore`
  (in-memory implementation) and message signing.
- JSON-RPC `HandlerRouter` with envelope validation and typed error mapping
  (unknown → -32601, malformed → -32600, `RpcError` → its code, other → -32603).
- Real bridge-control handlers (`bridge/status`, `bridge/generatePairingQr`,
  `bridge/connectedPhones`, `bridge/trustedDevices`, `bridge/disconnectPhone`).
- Stub handlers for git/workspace/thread/project/account domains (clear,
  greppable `FOR-DEV` not-implemented errors).
- Pairing QR generation (`generatePairingPayload`, `renderPairingQr`).
- Agent adapter base class plus Codex and OpenCode stubs.
- `uxnan-bridge` CLI: `start`, `status`, `qr`, `stop`, `install-service`, `help`.
- In-memory session registry, bridge status snapshot, leveled logger.
- Tests (node:test): daemon state, identity (sign/verify), router, QR, and an
  end-to-end `startBridge` wiring test.

### Deferred (see FOR-DEV.md)
- Outbound buffer + catch-up on reconnect; key rotation / epoch advance.
- OS-keychain-backed identity persistence (required before real pairing).
- Real git/workspace/thread/account handlers and Codex/OpenCode adapters.
- Daemon process manager (`stop`), autostart scripts, file logging.
- Relay hardening (rate limiting, pairing-code resolution, push endpoints).

### Notes
- Built on TypeScript (the architecture sketches `.js`); same file names, `.ts`
  sources compiled to `dist/`. Justified by end-to-end type-safety with the
  `@uxnan/shared` contracts.
- The bridge identity is in-memory only this increment, so no secret is written
  to disk in plaintext (per AGENTS.md security rules).
