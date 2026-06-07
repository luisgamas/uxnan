# Changelog — uxnan-relay

All notable changes to the relay server are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/). Versioning: [SemVer](https://semver.org/).

## [Unreleased]

### Added — Phase 6 (push notifications, gated)
- `POST /push/register` (stores a device token per session, returns a
  `notificationSecret`) and `POST /push/notify` (validates the secret, dedupes by
  `(sessionId,turnId)`, fans out to the session's tokens). `PushRegistry` +
  `PushSender` seam: `NoopPushSender` by default; a lazy `firebase-admin` FCM
  sender activates only when `UXNAN_FCM_SERVICE_ACCOUNT` is set
  (`firebase-admin` is an optionalDependency). Unit-tested with a fake sender.

### Added — Phase 3
- Per-IP fixed-window rate limiting for HTTP requests and WebSocket upgrades
  (defaults 120/min and 60/min; configurable via `RelayServerOptions.rateLimits`).
  Over-limit HTTP gets `429`; over-limit upgrades are dropped.

### Changed
- `RelayServer` constructor now takes a `RelayServerOptions` object
  (`{ logger, rateLimits, now }`) instead of a bare logger.

### Added — Phase 2
- Initial relay server (TypeScript, ESM, Node ≥18).
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
