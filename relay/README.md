# uxnan-relay

Stateless WebSocket relay that forwards **opaque E2EE envelopes** between the
Uxnan mobile app and the bridge. It only ever sees encrypted frames — never
plaintext, keys, code, or diffs.

> **Status: Phase 6 (gated).** Forwarding by `sessionId`, `/health`, per-IP rate
> limiting, reconnection support (peer-close + stale-socket handling) and the
> push endpoints (`/push/register`, `/push/notify` — real delivery gated on a
> Firebase service account) are implemented. Pairing-code resolution,
> multi-session `mac` registration and auth-on-forwarding remain deferred (see
> [`FOR-DEV.md`](FOR-DEV.md)).

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

Requires Node ≥18. ESM-only.
