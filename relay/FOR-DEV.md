# FOR-DEV — uxnan-relay

Deferred developer work for the relay. (Human-only assets are in `relay/FOR-HUMAN.md`.)

## Status

The relay is **optional and self-hosted**. The product's primary paths are
LAN-direct and Tailscale-direct to the bridge; push is now sent **bridge-direct**
(see `bridge/FOR-DEV.md`). The relay is a pure E2EE-envelope forwarder and an
optional push fallback — alpha-functional, 30 tests green, **first npm release
shipped** (`uxnan-relay@0.0.1-alpha.20260627`, `alpha` dist-tag) through the same
CI matrix as the bridge.

**Implemented (DONE):**

- **E2EE envelope relay** — one `mac` + `iphone` per `sessionId`, forwarding every
  frame unchanged; `GET /health`.
- **Per-IP rate limiting** and reconnection support (peer-close + stale-socket
  handling).
- **CSWSH `Origin` check** on WebSocket upgrades.
- **Push endpoints** (`/push/register|notify`, FCM, gated on creds) with **atomic
  state persistence** to `~/.uxnan/relay-state.json` — token registry + dedupe
  window, TTL 7d + cap 10k — as a **fallback** (the bridge is the primary push
  path).

**Closed — do not rebuild:** `/trusted-session/resolve` (manual-code pairing moved
to the bridge's `GET /pair/resolve?code=`) and an APNs-direct sender (the decision
is FCM-for-both; iOS reaches FCM via the APNs key uploaded to Firebase).

## Pending — relay-only / optional

None of these block the bridge-first product; they matter **only for a hosted or
public relay**.

- [ ] **Multi-session `mac` registration** — today one `mac` socket per `sessionId`.
      Support several bridges/sessions on one hosted relay via `x-mac-device-id` +
      `x-pairing-code` headers. Deferred unless you run a shared relay.
- [ ] **Auth on forwarding** — add `x-notification-secret` checks + identity-key
      pinning before forwarding. Frames are already E2EE end-to-end, so a malicious
      forwarder can only DoS or inject garbage the endpoints reject. Worth doing for
      a **public** relay; unnecessary for a single-user self-hosted one.

## Deferred — packaging conveniences

- [ ] **Docker image (GHCR)** — a `Dockerfile` (`node:20-alpine`, copy `dist/`,
      `CMD ["uxnan-relay"]`, expose `8787`/`$RELAY_PORT`) + a CI job publishing to
      GHCR per release, so the relay self-hosts in one command. Env: `RELAY_PORT`,
      `UXNAN_FCM_SERVICE_ACCOUNT` (optional push), `UXNAN_RELAY_STATE`. Document
      `docker run` + a `docker-compose.yml` in `docs/deploy.md`. Until then: `npm i
      -g uxnan-relay` + manual host.
- [ ] **CLI version-update notice** — on startup, compare the installed version
      against the npm registry and print an upgrade hint. No auto-update.

## Shared with the bridge (not relay-specific)

- [ ] **Real-device push validation** — validates the bridge-direct FCM stack on a
      real device. Android needs no paid account; iOS needs the APNs `.p8` in
      Firebase (`relay/FOR-HUMAN.md` → cross-ref `bridge/FOR-HUMAN.md`).
