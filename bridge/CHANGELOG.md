# Changelog — uxnan-bridge

All notable changes to the bridge daemon are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/). Versioning: [SemVer](https://semver.org/).

## [Unreleased]

### Added
- Initial bridge daemon **skeleton** (TypeScript, ESM, Node ≥18) — Phase 1.
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
- Live relay/LAN transport and the E2EE handshake (next increment).
- OS-keychain-backed identity persistence (required before real pairing).
- Real git/workspace/thread/account handlers and Codex/OpenCode adapters.
- Daemon process manager (`stop`), autostart scripts, file logging.

### Notes
- Built on TypeScript (the architecture sketches `.js`); same file names, `.ts`
  sources compiled to `dist/`. Justified by end-to-end type-safety with the
  `@uxnan/shared` contracts.
- The bridge identity is in-memory only this increment, so no secret is written
  to disk in plaintext (per AGENTS.md security rules).
