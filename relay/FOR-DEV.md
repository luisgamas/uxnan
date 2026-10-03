# FOR-DEV — uxnan-relay

Deferred developer work for the relay. (Human-only assets are in `relay/FOR-HUMAN.md`.)

> **`## Status` below is this component's canonical implementation status** — the
> root `AGENTS.md` points here instead of keeping its own inventory.

## Status

The relay is a **Cloudflare Worker + SQLite-backed Durable Object** that each
user's bridge deploys into the user's **own** Cloudflare account
(`uxnan-bridge relay setup`). It is optional: LAN and Tailscale stay direct and
need no relay. Alpha-functional, **18 tests green** on the real Workers runtime
(Miniflare), and the same suite passed against a relay deployed to a free
Cloudflare account (2026-10-02). The package is private — its bundle ships
inside the bridge package — so there is no relay npm release any more.

**Implemented (DONE):**

- **Routes and protocol** (`@uxnan/shared/relay`, architecture/02a §5.10) —
  `/v1/host/<routingId>`, `/v1/connect/<routingId>`,
  `/v1/channel/<routingId>/<channelId>`, `GET /v1/version`; challenge →
  Ed25519-signed auth bound to route, relay host, routing id, channel and nonce
  → `ready`; close codes 4001–4011.
- **Authentication before forwarding** — host keys from the Worker's
  `UXNAN_HOST_KEYS`, a routing id bound to the first host that claimed it, one
  live control socket per bridge (`replaced`), phones admitted by the bridge's
  allow list or a one-time pairing ticket (SHA-256 only, single use, ≤ 15 min).
- **Revocation** — a phone removed from the allow list loses its live channel
  at once (`revoked`).
- **Several phones per bridge** — one channel per phone (`dial`), up to 8 at
  once; **several PCs per Worker** — one room per routing id.
- **Hibernation** — per-socket state in attachments, the room's state in
  SQLite (`meta`, `allowed`, `tickets`), alarms for the auth and dial deadlines,
  `ping`/`pong` answered by the runtime without waking the object (2 wake-ups
  in 3 idle minutes, measured).
- **Deploy by the bridge** — REST upload, `workers.dev` route, token never
  stored unless remembered (in the bridge: `bridge/src/relay/`).
- **Tested against the real runtime** — `startLocalRelay` runs the deployed
  bundle on workerd; the bridge's relay e2e and the phone's opt-in integration
  test use it too.

**Closed — do not rebuild:** the Node relay server (`x-role` / `x-session-id`
pairing by session id, per-IP rate limiting, CSWSH `Origin` check, the
`uxnan-relay` CLI and `RELAY_PORT`), `/trusted-session/resolve` (manual-code
pairing lives in the bridge's `GET /pair/resolve?code=`), and **any push on the
relay** (the bridge delivers push to FCM itself). The items once listed here —
multi-session `mac` registration, auth on forwarding, a Docker image for the
Node server, a CLI update notice — are done by the new design or no longer
apply: one room per bridge, signed auth on every socket, nothing to host, and
the bridge reports the deployed relay's version (`relay/status`) and deploys
the one it ships (`relay/update`).

## Pending

- [ ] **Device validation.** The relay passed its suite against a deployed
      relay, and the bridge and phone each passed against the local runtime;
      the full path — a real phone on mobile data pairing by QR through a relay
      the bridge deployed, then reconnecting as trusted — still has to be run
      on a device and recorded here.
- [ ] **Self-hosting the same Worker outside Cloudflare.** Run this bundle on the
      open-source Workers runtime (workerd) on a machine the user controls, for
      people who do not want a Cloudflare account. Same Worker, same protocol;
      what is owed is the packaging (config, TLS in front, how the bridge is
      pointed at it — `relay use` already accepts any `wss://` relay) and its
      docs. Maintainer decision: later.
