# Relay — testing

![Runner](https://img.shields.io/badge/runner-node%3Atest-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![Coverage](https://img.shields.io/badge/forwarding_%7C_rate--limit_%7C_CSWSH_%7C_push-tested-2ea44f?style=for-the-badge)

## Automated

```bash
npm run test -w uxnan-relay     # or `npm test` at the root for all packages
```

Covers (server started on an ephemeral port, driven with real `ws` clients):
forwarding frames both ways between a paired `mac` + `iphone` on the same
`sessionId`; rejection of a bad/missing role or `sessionId`; `GET /health`; per-IP
rate limiting (HTTP 429 / dropped upgrade); peer-close + stale-socket reconnection
handling; CSWSH `Origin` checks on WebSocket upgrades (server-to-server,
same-origin, cross-origin, allowlist); the push endpoints (`/push/register`,
`/push/notify`) with a fake `PushSender` (register → notify → secret validation
→ dedupe); and push state persistence + dedupe TTL + cap (`~/.uxnan/relay-state.json`),
so all logic is tested without real Firebase creds.

> `mac` / `iphone` are protocol **roles**, not operating systems — `mac` is the
> bridge side, `iphone` is the mobile side.

## Manual smoke

```bash
node relay/dist/src/cli.js 8787
curl http://127.0.0.1:8787/health         # -> {"ok":true}

# push (noop sender, no creds): register then notify with the returned secret
curl -X POST http://127.0.0.1:8787/push/register \
  -d '{"sessionId":"s","pushToken":"t","platform":"android"}'
# -> { "registered": true, "notificationSecret": "..." }
curl -X POST http://127.0.0.1:8787/push/notify \
  -d '{"sessionId":"s","notificationSecret":"<secret>","threadId":"t1","turnId":"u1","title":"hi","body":"x"}'
```

## End-to-end with the bridge

`bridge/test/transport/relay-e2e.test.ts` runs the relay + bridge + an independent
Node "fake phone" over a real WebSocket. For the real-device flow (relay + bridge +
the Flutter app), see [`../../bridge/docs/testing.md`](../../bridge/docs/testing.md)
§2.

## Push — real delivery

Gated on the user's Firebase project; setup in [`../FOR-HUMAN.md`](../FOR-HUMAN.md).
