# FOR-DEV — uxnan-relay

Deferred developer work for the relay. (Human-only assets — Firebase/APNs creds —
are in `relay/FOR-HUMAN.md`.)

## Done
- [x] WebSocket relay that pairs one `mac` + one `iphone` per `sessionId` and
      forwards opaque E2EE frames (Phase 2).
- [x] `GET /health`; per-IP rate limiting for HTTP + upgrades (Phase 3).

## Deferred — routing/hardening (needs protocol/mobile coordination)
- [ ] **Pairing-code resolution** — `GET /trusted-session/resolve` to map a short
      pairing code → session (architecture §5.10.1). Needs the mobile manual-code
      pairing flow to be defined first.
- [ ] **Multi-session `mac` registration** — today one `mac` socket per
      `sessionId`. Support a bridge advertising several sessions / reconnect
      identity via `x-mac-device-id` + `x-pairing-code` headers (§5.10.1).
- [ ] **Auth on forwarding** — the relay currently forwards any `mac`/`iphone`
      that present a matching `sessionId`. Add the documented header checks
      (`x-notification-secret`, identity-key pinning) before forwarding.

## Phase 6 — Push notifications (implementation plan)
Endpoints (architecture §5.10.1–§5.10.4):
- [ ] `POST /push/register` — body `{ sessionId, pushToken, platform }` → store the
      token per session; return `{ registered, notificationSecret }`.
- [ ] `POST /push/notify` — body `{ sessionId, notificationSecret, threadId,
      turnId, title, body }` → validate the secret, dedupe by `(sessionId,turnId)`,
      deliver via the `PushSender`.
- [ ] **`PushSender` interface** (inject the real FCM/APNs client; use a fake in
      tests) so all endpoint/dedupe logic is testable without real creds — see
      `relay/FOR-HUMAN.md` "test without devices".
- [ ] **Dedupe store** with TTL (7 days) + max keys, persisted to disk
      (`push-dedupe-keys.json`) to survive restarts (§5.10.4).
- [ ] FCM sender via `firebase-admin` (recommended) and/or APNs HTTP/2 + JWT.
- [ ] Add `notifications/*` contracts to `@uxnan/shared` (already sketched in
      `bridge/src/handlers/notifications-handler.ts`).
- [ ] Bridge side: detect turn-completed (already emitted by `AgentManager`),
      apply user push prefs + dedupe, then `POST /push/notify`
      (`bridge/src/handlers/notifications-handler.ts` + a push tracker).

## How to test the relay
- Unit/integration (current): `npm run test -w uxnan-relay` — starts the server on
  an ephemeral port and drives it with `ws` clients (forwarding both ways,
  role/sessionId rejection, `/health`, rate-limit 429).
- Manual smoke: `node relay/dist/src/cli.js 8787`, then `curl http://127.0.0.1:8787/health`.
- End-to-end with the bridge: see `bridge/test/transport/relay-e2e.test.ts`
  (relay + bridge + a fake phone over a real WebSocket) and the manual plan in
  `../TESTING.md`.
- Push (Phase 6): test endpoints with a fake `PushSender`; real delivery needs a
  device + Firebase project (see `relay/FOR-HUMAN.md`).
