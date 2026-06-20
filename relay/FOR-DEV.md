# FOR-DEV — uxnan-relay

Deferred developer work for the relay. (Human-only assets — Firebase/APNs creds —
are in `relay/FOR-HUMAN.md`.)

## MVP status — ALPHA-FUNCTIONAL (optional / self-hosted)
> Snapshot 2026-06. The relay builds clean and its tests are green (27/27). It is
> **optional and self-hosted**: the product's primary path is LAN/Tailscale-direct
> to the bridge, and push is now bridge-direct. The relay is alpha-functional for
> anyone who wants hosted off-LAN access.
>
> **DONE:** E2EE envelope relay (one `mac`+`iphone` per `sessionId`), `GET /health`,
> per-IP rate limiting, reconnection support, CSWSH Origin defense on upgrades,
> push endpoints (`/push/register|notify`, FCM, gated on creds) with **atomic
> persistence** of the token registry + dedupe window (survives restarts).
>
> **CLOSED (superseded; not built):** `/trusted-session/resolve` (manual-code
> pairing on the relay — replaced by the bridge's `/pair/resolve?code=`,
> `bridge/FOR-DEV.md` → *Manual-code pairing*) and APNs-direct (FCM-for-both is
> the decided path; iOS reaches FCM via the APNs key uploaded to Firebase).
> See `architecture/02a-system-architecture.md` §5.5.3 + §5.10.1 for the
> matching spec sync.
>
> **PENDING — relay-only / optional** (none block the bridge-first product):
> multi-session `mac`, auth-on-forwarding, only for a hosted/public relay.
> Real-device push validation is shared with the bridge (not relay-specific).
>
> **CI/CD:** same pipeline as the bridge — see `bridge/FOR-DEV.md` → *CI/CD & release*.
> The relay is a pure Node package; it ships via `npm publish` and is exercised by
> the same OS×Node CI matrix (build → typecheck → prettier → test) before release.

## Done
- [x] WebSocket relay that pairs one `mac` + one `iphone` per `sessionId` and
      forwards opaque E2EE frames (Phase 2).
- [x] `GET /health`; per-IP rate limiting for HTTP + upgrades (Phase 3).
- [x] **Reconnection support** — on a peer disconnect the relay closes the paired
      socket so the other side detects a dead peer (phone reconnect); a
      stale/replaced socket's close is ignored so it doesn't tear down a freshly
      reconnected peer's handshake (`relay-server.ts` `#register`).
- [x] **CSWSH defense** — upgrade requests with `Origin` whose host does not
      match `Host` (or the explicit `allowedOrigins` allowlist) are rejected
      with 403. Server-to-server `ws` clients (no Origin) are accepted.
      Covers the most common browser-initiated CSWSH attempt without requiring
      operator config.
- [x] **Push state persistence** — token registry + dedupe window are written
      atomically to `~/.uxnan/relay-state.json` (override with
      `UXNAN_RELAY_STATE`). Reload via `PushRegistry.load()` at startup.
      Dedupe TTL 7 days + cap 10 000 keys, enforced in-memory on every
      insertion (`push.ts` `#pruneDedupe`). Persistence failures are logged
      but never fail a request.

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

## Closed — superseded by bridge-first
- [x] **`/trusted-session/resolve` (manual-code pairing on the relay)** —
      CLOSED (never built). The bridge's `GET /pair/resolve?code=` on the LAN
      server covers manual-code pairing (`bridge/FOR-DEV.md` →
      *Manual-code pairing*). For off-LAN manual pairing, Tailscale (or any
      mesh VPN) reaches the bridge's LAN server directly. No relay endpoint
      needed; the spec is updated (`architecture/02a §5.5.3` + `§5.10.1`).
- [x] **APNs-direct path** — CLOSED. The decision is FCM-for-both (iOS reaches
      FCM once the APNs key is uploaded to Firebase). No relay-specific APNs
      sender is planned or built. See `architecture/02a §5.10.4`.

## Deferred — routing/hardening (reclassified for the bridge-first model)
> DIRECTION (2026-06): with the relay now **optional/self-hosted** and push moved
> to the bridge, these items are reclassified. They matter ONLY for a hosted/shared
> relay; the primary LAN/Tailscale-direct path does not need them.
- [ ] **Multi-session `mac` registration** (relay-only) — one `mac` socket per
      `sessionId` today; multi-session via `x-mac-device-id` + `x-pairing-code`
      headers. Needed ONLY if a hosted relay serves several bridges/sessions.
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
- [x] **Atomic persistence** of token registry + dedupe window to
      `~/.uxnan/relay-state.json` (override via `UXNAN_RELAY_STATE`). Reload via
      `PushRegistry.load()` on startup; mutations are serialized through a
      promise chain so concurrent register/unregister/notify never race.
- [x] **Dedupe cap (spec §5.10.5):** TTL 7 days + max 10 000 keys, oldest-first
      eviction, enforced in-memory on every insertion (capped map never grows
      unbounded).

### Remaining follow-ups
> DIRECTION (2026-06): push now ships **from the bridge** (direct FCM, registrations
> persisted in `~/.uxnan/push-state.json`). The relay push path is a FALLBACK for
> setups that keep the Firebase credential on a hosted relay, so the two
> persistence items below matter ONLY for that variant — both are DONE.
- [~] **APNs-direct path** — CLOSED (see *Closed — superseded* above).
- [ ] **Real-device validation** — STILL REQUIRED (not relay-specific): it validates
      the **bridge-direct** FCM stack. Android needs no paid account; iOS needs the
      APNs `.p8` key in Firebase (`FOR-HUMAN.md`).

## How to test the relay
- Unit/integration (current): `npm run test -w uxnan-relay` — starts the server on
  an ephemeral port and drives it with `ws` clients (forwarding both ways,
  role/sessionId rejection, `/health`, rate-limit 429, CSWSH Origin checks,
  push state persistence + dedupe TTL + cap).
- Manual smoke: `node relay/dist/src/cli.js 8787`, then `curl http://127.0.0.1:8787/health`.
- End-to-end with the bridge: see `bridge/test/transport/relay-e2e.test.ts`
  (relay + bridge + a fake phone over a real WebSocket) and the manual plan in
  `docs/testing.md` / `../bridge/docs/testing.md`.
- Push (Phase 6): test endpoints with a fake `PushSender`; real delivery needs a
  device + Firebase project (see `relay/FOR-HUMAN.md`).
