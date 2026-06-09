# Relay — deployment & hosting

The relay is a small, **stateless** WebSocket server that forwards **opaque E2EE
envelopes** between the phone and the bridge by `sessionId`. It never sees
plaintext, keys, code, or diffs — only encrypted frames. You deploy it **once**;
all phones/bridges point at its URL (baked into the pairing QR / the bridge's
`relayUrl`).

## Do you even need it?

The relay is **optional** — it's the remote fallback, not the only path. See
[`../../bridge/docs/connectivity.md`](../../bridge/docs/connectivity.md) for the
full picture.

- **Same network → no.** The phone connects **directly** to the bridge's LAN
  server. Zero hosting. Primary plug-and-play path.
- **Remote with a mesh VPN → no.** With **Tailscale** (or ZeroTier/WireGuard) the
  phone and PC share one virtual network, so the bridge's direct address works from
  anywhere — no hosted relay. **Recommended for remote.**
- **Remote without a VPN → yes.** Host a relay so the bridge has an internet-
  reachable fallback.

## Hosting options (free-tier friendly)

| Option | Effort | Notes |
|---|---|---|
| **LAN-only** | none | No relay deployed. Direct phone↔bridge on the same network. |
| **Tailscale / mesh VPN** | none | **Recommended for remote.** No relay at all — the bridge's direct address is reachable over the tailnet. See [`../../bridge/docs/connectivity.md`](../../bridge/docs/connectivity.md). |
| **Self-host + Cloudflare Tunnel** | low | Run the Node relay on your PC / a small box; `cloudflared` exposes it at a stable hostname with TLS. Free, **no code change**. |
| **Fly.io / Render / Koyeb** (Node) | low | Deploy the existing Node relay as an always-on service. **Fly.io** suits a long-lived WebSocket best; Render's free tier sleeps on idle (bad for an always-reachable relay). |
| **Cloudflare Workers + Durable Objects** | high | Serverless, generous free tier, but requires **rewriting** the relay from Node `ws` to the Workers/Durable-Objects model (one DO per `sessionId`). |

> **GitHub** does not run servers — use it for the code, Releases, CI, and (if
> wanted) a private npm registry, not for hosting the relay.

**Recommendation:** start **LAN-only** (no infra); when you want remote access, use
**Cloudflare Tunnel** or **Fly.io** without rewriting. Reach for Workers + Durable
Objects only if you later want serverless scale.

## Run & configure

```bash
uxnan-relay 8787          # or: RELAY_PORT=8787 uxnan-relay
# dev: node relay/dist/src/cli.js 8787
```

- **Port:** positional arg or `RELAY_PORT`.
- **TLS:** terminate at the tunnel/host (Cloudflare Tunnel, Fly, a reverse proxy).
  The phone/bridge use `wss://` against the public hostname; never disable TLS
  verification.
- **Rate limiting:** per-IP limits for HTTP and WebSocket upgrades are built in
  (`RelayServerOptions.rateLimits`); over-limit → HTTP 429 / dropped upgrade.
- **Point clients at it:** set the bridge's `relayUrl` to your `wss://…` URL (it is
  carried in the pairing QR).

## Push notifications (gated)

The relay exposes `POST /push/register` + `POST /push/notify` (Phase 6). Real
delivery is **gated** on a Firebase service account (`UXNAN_FCM_SERVICE_ACCOUNT`);
without it the sender is a no-op. Setup: [`../FOR-HUMAN.md`](../FOR-HUMAN.md).

## Security model

The relay only routes opaque frames by `sessionId` and exposes `GET /health`. It
cannot read user data (E2EE). Hardening still deferred (see
[`../FOR-DEV.md`](../FOR-DEV.md)): auth-on-forwarding (identity-key pinning /
notification-secret checks) and multi-session registration.
