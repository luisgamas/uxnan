# Changelog — uxnan-relay

All notable changes to the relay server are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/). Versioning: [SemVer](https://semver.org/).

## [Unreleased]

### Added
- Initial relay server (TypeScript, ESM, Node ≥18) — Phase 2.
- `RelayServer`: pairs one `mac` and one `iphone` socket per `sessionId` (from the
  `x-role` / `x-session-id` headers or `?role=&sessionId=` query) and forwards
  opaque E2EE frames between them. The relay never sees plaintext.
- `GET /health` endpoint; non-WebSocket HTTP returns `426 Upgrade Required`.
- `uxnan-relay` CLI (`uxnan-relay [port]`, default 8787 or `$RELAY_PORT`).
- Tests (node:test): bidirectional forwarding, rejection of role-less
  connections, and the health endpoint.

### Deferred (see ../bridge/FOR-DEV.md)
- Rate limiting (HTTP/upgrade/push), pairing-code resolution, multi-session
  `mac` registration, and the push notification endpoints (`/push/*`).
