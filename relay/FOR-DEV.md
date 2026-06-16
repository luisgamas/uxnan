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

## Direction (2026-06-12): push is moving to the bridge; the relay is optional
The product is **bridge-first**: background push should be sent **by the bridge**
so it works on **any** transport (direct LAN, **Tailscale**, or relay), not only
when a hosted relay is in the loop. The relay is now **optional and self-hosted**
(for hosted off-LAN access). The relay's push endpoints below stay valid and
supported as a **fallback** for anyone who prefers to keep the Firebase
credential on a hosted relay — but they are no longer the primary path. The
bridge must keep working (securely, E2EE) **with or without** the relay. See
`bridge/FOR-DEV.md` → *Direct FCM from the bridge*.

## Done — push (Phase 6, gated; now the optional relay-hosted path)
- [x] `POST /push/register` + `POST /push/notify`, `PushRegistry`, `PushSender`
      seam (noop default; lazy `firebase-admin` FCM sender via
      `UXNAN_FCM_SERVICE_ACCOUNT`). Unit-tested with a fake sender. Real delivery
      needs the user's Firebase project (`relay/FOR-HUMAN.md`).

## Deferred — routing/hardening (reclassified for the bridge-first model)
> DIRECTION (2026-06): with the relay now **optional/self-hosted** and push moved
> to the bridge, these items are reclassified. They matter ONLY for a hosted/shared
> relay; the primary LAN/Tailscale-direct path does not need them.
- [→bridge] **Pairing-code resolution** — `GET /trusted-session/resolve` was the
      OFF-LAN equivalent of manual-code pairing. The bridge-first version is built on
      the **bridge** (`bridge/src/pairing/pairing-code-service.ts` +
      `GET /pair/resolve?code=` on the LAN server — see `bridge/FOR-DEV.md` →
      *Manual-code pairing*). Keep this relay endpoint ONLY if you want hosted
      off-LAN pairing-by-code through a relay; otherwise it's superseded.
- [ ] **Multi-session `mac` registration** (relay-only) — one `mac` socket per
      `sessionId` today; multi-session via `x-mac-device-id` + `x-pairing-code`
      headers (§5.10.1). Needed ONLY if a hosted relay serves several bridges/sessions.
      Deferred unless you run a shared relay.
- [ ] **Auth on forwarding** (relay-only hardening) — add `x-notification-secret`
      checks + identity-key pinning before forwarding. The frames are already E2EE
      end-to-end (the handshake pins bridge↔phone identities), so a malicious
      forwarder can only DoS/inject garbage the endpoints reject. Worth doing for a
      **public** relay; unnecessary for a single-user self-hosted one.

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
> DIRECTION (2026-06): push now ships **from the bridge** (direct FCM, registrations
> persisted in `~/.uxnan/push-state.json`). The relay push path is a FALLBACK for
> setups that keep the Firebase credential on a hosted relay, so the two
> persistence items below matter ONLY for that variant.
- [ ] **Dedupe store persistence** (relay-only fallback) — dedupe is in-memory;
      persist to `push-dedupe-keys.json` with TTL (7 days) + max keys (§5.10.4). The
      bridge-direct path fires once per turn and needs no dedupe.
- [ ] **Token persistence** (relay-only fallback) — the per-session token registry
      is in-memory; persist so registrations survive a relay restart. The bridge
      already persists its own registrations.
- [~] **APNs-direct path** (no Firebase for iOS) — **superseded.** The decision is
      FCM-for-both (iOS via FCM once the APNs key is uploaded to Firebase), so a
      separate APNs path is redundant. Close unless that decision changes.
- [ ] **Real-device validation** — STILL REQUIRED (not relay-specific): it validates
      the **bridge-direct** FCM stack. Android needs no paid account; iOS needs the
      APNs `.p8` key in Firebase (`FOR-HUMAN.md`).

## How to test the relay
- Unit/integration (current): `npm run test -w uxnan-relay` — starts the server on
  an ephemeral port and drives it with `ws` clients (forwarding both ways,
  role/sessionId rejection, `/health`, rate-limit 429).
- Manual smoke: `node relay/dist/src/cli.js 8787`, then `curl http://127.0.0.1:8787/health`.
- End-to-end with the bridge: see `bridge/test/transport/relay-e2e.test.ts`
  (relay + bridge + a fake phone over a real WebSocket) and the manual plan in
  `docs/testing.md` / `../bridge/docs/testing.md`.
- Push (Phase 6): test endpoints with a fake `PushSender`; real delivery needs a
  device + Firebase project (see `relay/FOR-HUMAN.md`).
