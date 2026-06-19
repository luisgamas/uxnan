# Changelog — uxnan-relay

All notable changes to the relay server are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/). Versioning: [SemVer](https://semver.org/).

## [Unreleased]

### Fixed — phone stuck "reconnecting" after a background resume
- When the phone returns from the background, its old WebSocket is often
  half-open (the OS never sent a FIN), so the reconnecting phone opens a **new**
  `iphone` socket that **supersedes** the lingering one for the same `sessionId`.
  The stale socket's eventual close is (correctly) ignored by the close-handler
  guard, but nothing then tore down the paired `mac` socket — so the bridge,
  which serves exactly one phone session per `mac` socket and only re-arms its
  handshake when that socket closes, kept serving the dead session and dropped
  the reconnecting phone's handshake as invalid encrypted traffic. The phone
  stayed stuck "reconnecting" until the app was force-killed (only then did its
  current socket close cleanly and free the session).
- Fix: `#register` now detects supersession (a new socket replacing an existing
  one for the same role+session) and tears down both the superseded socket and
  its paired peer immediately — the same teardown the stale-close guard skips —
  so the bridge re-arms a fresh handshake for the reconnecting phone. The LAN/
  direct path was unaffected (each reconnect is an independent connection).
- Regression test: `a reconnecting phone supersedes its stale socket and re-arms
  the bridge` (`test/relay-server.test.ts`).

### Fixed — FCM sender never activated (push delivery)
- `loadFcmSender` dereferenced the `firebase-admin` namespace directly, but under
  ESM dynamic `import()` the CommonJS module's API lands on the `.default` interop
  key — so `admin.credential` was `undefined`, init threw, and the relay silently
  fell back to the `NoopPushSender` (no push ever delivered even with valid
  credentials). Now reaches through `imported.default ?? imported`. Verified the
  real FCM sender loads and a dry-run send to FCM succeeds.

### Changed — reconnection support
- When one side of a paired session disconnects, the relay now closes the paired
  peer's socket (instead of leaving it half-open) so the phone detects a dead
  bridge and triggers reconnect rather than showing "connected" forever
  (`relay-server.ts` `#register` close handler).
- A **stale/replaced** socket closing no longer tears down the peer: if a newer
  socket has already taken the role for that `sessionId` (e.g. the bridge or the
  phone reconnected), the old socket's close is ignored, so a freshly
  reconnected peer's handshake is not killed ("message channel closed").

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
