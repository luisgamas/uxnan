# uxnan-relay

Stateless WebSocket relay that forwards **opaque E2EE envelopes** between the
Uxnan mobile app and the bridge. It only ever sees encrypted frames — never
plaintext, keys, code, or diffs.

> **Status: ALPHA-FUNCTIONAL — OPTIONAL / self-hosted.**
>
> The product is **bridge-first**: the primary paths are LAN-direct and
> Tailscale-direct (zero hosting, zero credentials). The relay is the
> hosted off-LAN fallback for users who want to run their own.
> **Push notifications are sent by the bridge directly** (FCM HTTP v1, lazy
> `firebase-admin`); the relay's `/push/*` endpoints stay as a hosted
> fallback. See `bridge/FOR-DEV.md` → *Direct FCM from the bridge*.
>
> **DONE:** E2EE envelope relay (one `mac`+`iphone` per `sessionId`),
> `GET /health`, per-IP rate limiting, reconnection support (peer-close +
> stale-socket handling), **CSWSH `Origin` check on upgrades**, push
> endpoints (`/push/register|notify`, FCM, gated on creds) with
> **atomic state persistence** to `~/.uxnan/relay-state.json` (token registry
> + dedupe window, with TTL 7d + cap 10k).
>
> **PENDING — relay-only / optional** (does not block the bridge-first
> product): multi-session `mac`, auth-on-forwarding (only for a
> hosted/public relay). See [`FOR-DEV.md`](FOR-DEV.md).

> **`mac` / `iphone` are ROLES, not platforms.** `mac` = the PC/bridge side
> (runs on Windows, macOS or Linux); `iphone` = the mobile app side (Android or
> iOS). The names come from the protocol spec and are fixed by the wire contract
> with the mobile app — they do not restrict the operating system.

## Run

```bash
uxnan-relay 8787        # or: RELAY_PORT=8787 uxnan-relay
```

## Protocol

A client connects via WebSocket presenting:

| Header | Query fallback | Values |
|---|---|---|
| `x-role` | `?role=` | `mac` (bridge) or `iphone` (app) |
| `x-session-id` | `?sessionId=` | the shared session id |

The relay pairs the `mac` and `iphone` sockets that share a `sessionId` and
forwards every frame from one to the other unchanged. `GET /health` returns
`{"ok":true}`.

See `architecture/02a-system-architecture.md` §5.10.

## Develop

```bash
# from the repo root (workspaces):
npm run build && npm test
```

Requires Node ≥18. ESM-only. The relay consumes `@uxnan/shared` for the
JSON-RPC envelope types; the bridge-side `relay-e2e.test.ts` exercises the
full end-to-end (relay + bridge + a fake phone over a real WebSocket).

## Docs

See [`docs/`](./docs/): [deployment & hosting](./docs/deploy.md) (LAN-only vs
Cloudflare Tunnel / Fly.io / Workers) · [testing](./docs/testing.md).

Push notifications are **bridge-first** now (the relay is only an optional
delivery fallback) — see
[`bridge/docs/push-notifications.md`](../bridge/docs/push-notifications.md).
