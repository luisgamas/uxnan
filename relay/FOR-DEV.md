# FOR-DEV — uxnan-relay

Deferred developer work for the relay. (Human-only assets are in `relay/FOR-HUMAN.md`.)

> **`## Status` below is this component's canonical implementation status** — the
> root `AGENTS.md` points here instead of keeping its own inventory.

## Status

The relay is **optional and self-hosted**. The product's primary paths are
LAN-direct and Tailscale-direct to the bridge; background push is sent **only by
the bridge**, straight to FCM (see `bridge/FOR-DEV.md`). The relay is a pure,
stateless E2EE-envelope forwarder with no push endpoints and no state on disk —
alpha-functional, 16 tests green, **first npm release
shipped** (`uxnan-relay@0.0.1-alpha.20260627`, `alpha` dist-tag) through the same
CI matrix as the bridge.

**Implemented (DONE):**

- **E2EE envelope relay** — one `mac` + `iphone` per `sessionId`, forwarding every
  frame unchanged; `GET /health`.
- **Per-IP rate limiting** and reconnection support (peer-close + stale-socket
  handling).
- **CSWSH `Origin` check** on WebSocket upgrades.

**Closed — do not rebuild:** `/trusted-session/resolve` (manual-code pairing moved
to the bridge's `GET /pair/resolve?code=`) and **any push on the relay** — the
`/push/register` + `/push/notify` endpoints, their token/dedupe state file and the
FCM sender were removed because they showed the relay the phone's push token and
the notification text in plaintext; the bridge delivers push to FCM itself.

## Pending — relay-only / optional

None of these block the bridge-first product; they matter **only for a hosted or
public relay**.

- [ ] **Multi-session `mac` registration** — today one `mac` socket per `sessionId`.
      Support several bridges/sessions on one hosted relay via `x-mac-device-id` +
      `x-pairing-code` headers. Deferred unless you run a shared relay.
- [ ] **Auth on forwarding** — add a per-session secret check + identity-key
      pinning before forwarding. Frames are already E2EE end-to-end, so a malicious
      forwarder can only DoS or inject garbage the endpoints reject. Worth doing for
      a **public** relay; unnecessary for a single-user self-hosted one.

## Deferred — packaging conveniences

- [ ] **Docker image (GHCR)** — a `Dockerfile` (`node:20-alpine`, copy `dist/`,
      `CMD ["uxnan-relay"]`, expose `8787`/`$RELAY_PORT`) + a CI job publishing to
      GHCR per release, so the relay self-hosts in one command. Env: `RELAY_PORT`
      (the relay keeps no state, so no volume is needed). Document
      `docker run` + a `docker-compose.yml` in `docs/deploy.md`. Until then: `npm i
      -g uxnan-relay` + manual host.
- [ ] **CLI version-update notice** — on startup, compare the installed version
      against the npm registry and print an upgrade hint. No auto-update.
