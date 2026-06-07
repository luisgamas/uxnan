# FOR-DEV — uxnan-relay

Deferred developer work for the relay. (Human-only assets — Firebase/APNs creds —
are in `relay/FOR-HUMAN.md`.)

## Done
- [x] WebSocket relay that pairs one `mac` + one `iphone` per `sessionId` and
      forwards opaque E2EE frames (Phase 2).
- [x] `GET /health`; per-IP rate limiting for HTTP + upgrades (Phase 3).
- [x] **Reconnection support** — on a peer disconnect the relay closes the paired
      socket so the other side detects a dead peer (phone reconnect); a
      stale/replaced socket's close is ignored so it doesn't tear down a freshly
      reconnected peer's handshake (`relay-server.ts` `#register`).

## Done — push (Phase 6, gated)
- [x] `POST /push/register` + `POST /push/notify`, `PushRegistry`, `PushSender`
      seam (noop default; lazy `firebase-admin` FCM sender via
      `UXNAN_FCM_SERVICE_ACCOUNT`). Unit-tested with a fake sender. Real delivery
      needs the user's Firebase project (`relay/FOR-HUMAN.md`).

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

## Phase 6 — Push notifications (IMPLEMENTED — gated on creds)
Endpoints (architecture §5.10.1–§5.10.4), in `src/push.ts` + `src/relay-server.ts`:
- [x] `POST /push/register` — body `{ sessionId, pushToken, platform }` → stores the
      token per session; returns `{ registered, notificationSecret }`.
- [x] `POST /push/notify` — body `{ sessionId, notificationSecret, threadId,
      turnId, title, body }` → validates the secret (403 otherwise), dedupes by
      `(sessionId,turnId)`, delivers via the `PushSender`.
- [x] **`PushSender` interface** + `NoopPushSender` (default) so all endpoint/
      dedupe logic is unit-tested without real creds (`test/push.test.ts`).
- [x] FCM sender via `firebase-admin` (optionalDependency, lazy dynamic import),
      enabled only when `UXNAN_FCM_SERVICE_ACCOUNT` is set; else noop.
- [x] Add `notifications/*` contracts to `@uxnan/shared` and wire the bridge
      handlers + turn-completed hook (`bridge/src/push/push-service.ts`).

### Remaining follow-ups
- [ ] **Dedupe store persistence** — dedupe is in-memory; persist to
      `push-dedupe-keys.json` with TTL (7 days) + max keys to survive restarts (§5.10.4).
- [ ] **Token persistence** — the per-session token registry is in-memory; persist
      so registrations survive a relay restart.
- [ ] **APNs-direct path** (no Firebase for iOS) — optional, see `relay/FOR-HUMAN.md`.
- [ ] **Real-device validation** — needs the user's Firebase project + a device
      (see `relay/FOR-HUMAN.md`).

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
