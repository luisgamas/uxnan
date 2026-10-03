# Changelog — uxnan-relay

All notable changes to the relay are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/). Versioning: [SemVer](https://semver.org/).

## [Unreleased]

### Changed
- **The relay is now a Cloudflare Worker that each user's bridge deploys into
  the user's own Cloudflare account.** One SQLite-backed Durable Object
  (`RelayRoom`) per bridge routing id holds that bridge's sockets, using the
  WebSocket Hibernation API: an idle control socket costs nothing, and the
  bridge's `ping` is answered `pong` without waking the object (2 wake-ups in
  3 idle minutes, measured on a free account). Routes: `/v1/host/<routingId>`
  (bridge), `/v1/connect/<routingId>` (phone),
  `/v1/channel/<routingId>/<channelId>` and `GET /v1/version`. The protocol
  lives in `@uxnan/shared/relay`. `npm run build` bundles the Worker with
  esbuild into `dist/worker/uxnan-relay.js`, which the bridge ships and
  uploads; `uxnan-relay/local` (`startLocalRelay`) runs that same bundle on the
  real Workers runtime through Miniflare 4 for tests.
- **The package is private.** It is no longer published to npm: the bundle
  ships inside `uxnan-bridge`.
- **Tests** run on the real Workers runtime, and the same suite runs against a
  deployed relay (`UXNAN_RELAY_TEST_URL` + `UXNAN_RELAY_TEST_HOST_KEYS`).
  18 tests (`test/relay.test.ts`), replacing the 16 of the Node server.

### Added
- **Authentication before any forwarding.** Every socket gets a challenge; the
  bridge and phones answer with an Ed25519 signature bound to the route, relay
  host, routing id, channel and nonce. Host keys come from the Worker's
  `UXNAN_HOST_KEYS`, and a routing id stays bound to the first host that
  claimed it; a newer control socket of the same bridge replaces the old one.
- **Trusted phones and one-time pairing tickets.** The bridge sends its trusted
  phone keys (`allow`) and, while its pairing window is open, the SHA-256 of a
  one-time ticket (`ticket`, at most 15 minutes) that admits one new phone,
  once.
- **Revocation.** A phone removed from the allow list loses its live channel at
  once (close code 4010).
- **Several phones per bridge** (one channel each, `dial`; up to 8 at once) and
  **several PCs per Worker** (one room each).
- **Limits and deadlines:** control frames ≤ 64 KiB, ≤ 64 trusted keys, ≤ 32
  sockets per room, 10 s to authenticate, 10 s for the bridge to answer a dial.

### Removed
- **The Node relay server** (`relay-server.ts`), its CLI `uxnan-relay` and
  `RELAY_PORT`, the `x-role` / `x-session-id` session pairing, `GET /health`,
  the per-IP rate limiter, the CSWSH `Origin` check, the constant-time helper,
  and the `ws` runtime dependency (now a test-only dev dependency).
- **Push, entirely.** The `POST /push/register` and `POST /push/notify`
  endpoints, `PushRegistry` and the FCM sender (`relay/src/push.ts`), the
  token/dedupe state file `~/.uxnan/relay-state.json` and its
  `UXNAN_RELAY_STATE` override, the relay's `UXNAN_FCM_SERVICE_ACCOUNT`, and the
  optional `firebase-admin` dependency. They let the relay see the phone's push
  token and every notification's title and body in plaintext; background push
  is now sent only by the bridge, straight to FCM, and the relay only forwards
  sealed envelopes. (`push.test.ts` and `push-persistence.test.ts` deleted.)

## [0.0.2-alpha.20260720] - 2026-07-20

### Security
- Use constant-time comparisons for push notification secrets.
- Bound the per-IP `RateLimiter` (`#httpLimiter`/`#upgradeLimiter`) against
  unbounded memory growth from IP rotation — trivial over an allocated IPv6
  /64 — which previously grew the `#windows` map by one entry per new source
  address forever, turning the anti-abuse control into a memory sink. `allow`
  now sweeps expired windows whenever it opens a new window for a key, and
  enforces a hard `maxKeys` cap
  (default 10,000; oldest entry evicted first) as a backstop against a burst
  of still-unexpired keys. A single IP's own throttling budget is unaffected.
  Covered by `test/rate-limiter.test.ts` (3 tests: single-key behavior
  preserved, the tracked-key count never exceeds `maxKeys`, expired windows
  are swept instead of accumulating).

## [0.0.1-alpha.20260627] - 2026-06-27

### Changed — push notifications doc moved to the bridge
- `relay/docs/push-notifications.md` was **moved to
  `bridge/docs/push-notifications.md`** and rewritten bridge-first (push is
  bridge-direct by default; the relay is only an optional delivery fallback).
  The relay README "Docs" section now links to the bridge copy.

### Changed — push docs refer to new mobile bundle id
- No code changes in the relay itself (it does not carry a bundle id; the
  bridge LaunchAgent label and the mobile app id are the relevant namespaces).
- `relay/FOR-HUMAN.md` APNs-config checklist and `relay/docs/push-notifications.md`
  bundle-id references (`com.uxnan.mobile` → `dev.luisgamas.uxnanmobile`)
  updated to match the new mobile bundle id; the Firebase CLI examples and
  the "another person using the project" note now point at the new id.

### Added — push state persistence
- `PushRegistry` now persists the per-session token map AND the
  `(sessionId,turnId)` dedupe window to `~/.uxnan/relay-state.json` (override
  with `UXNAN_RELAY_STATE`), atomic temp+rename. The CLI calls `load()` at
  startup so background push survives a relay restart WITHOUT the phone
  re-registering — the self-hosted fallback's most important hardening gap
  for the bridge-first model. Persistence failures are logged and never fail
  a request; missing/corrupt files leave the registry empty.
- Dedupe enforcement is now in-memory on every insertion: TTL 7 days + cap
  10 000 keys (spec §5.10.5) — the dedupe map never grows unbounded, even
  before a write to disk. New `flush()` test seam awaits the serialized
  persist chain. Covered by `test/push-persistence.test.ts` (9 tests:
  token + dedupe round-trip across restarts, TTL eviction on load, cap,
  missing/corrupt file tolerance, in-memory prune, unregister).

### Added — CSWSH defense on WebSocket upgrades
- `RelayServer` now validates the `Origin` header on upgrade requests to
  prevent cross-site WebSocket hijacking (a browser page on `evil.com`
  opening a WS to the relay). Default behavior: reject upgrades whose
  `Origin` host does not match the request's `Host` header with HTTP 403;
  server-to-server `ws` clients (no `Origin`) are accepted. Operators behind
  a tunnel/proxy that mangles the `Host` header can set the new
  `allowedOrigins: string[]` option to an explicit allowlist (e.g.
  `['https://relay.example.com']`). Covered by `test/origin-check.test.ts`
  (7 tests: Origin-less, same-origin, cross-origin, malformed Origin,
  allowlist hit + miss, /health unaffected).

### Closed — superseded by bridge-first
- `/trusted-session/resolve` (manual-code pairing on the relay) — the
  endpoint was never built; manual-code pairing lives on the bridge as
  `GET /pair/resolve?code=` (`bridge/FOR-DEV.md` → *Manual-code pairing*).
  Spec updated: `architecture/02a §5.5.3` + `§5.10.1`.
- **APNs-direct path** — FCM-for-both is the decided route (iOS reaches
  FCM via the APNs key uploaded to Firebase). No relay-specific APNs sender
  is built or planned. Spec updated: `architecture/02a §5.10.4`.

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
