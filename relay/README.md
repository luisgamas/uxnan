# uxnan-relay

Stateless WebSocket relay that forwards **opaque E2EE envelopes** between the
Uxnan mobile app and the bridge. It only ever sees encrypted frames — never
plaintext, keys, code, or diffs.

> **Status: Phase 2.** Forwarding by `sessionId` + `/health` are implemented.
> Rate limiting, pairing-code resolution and push endpoints are deferred.

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
