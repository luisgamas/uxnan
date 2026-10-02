# Relay — testing

![Runner](https://img.shields.io/badge/runner-node%3Atest-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![Coverage](https://img.shields.io/badge/forwarding_%7C_rate--limit_%7C_CSWSH-tested-2ea44f?style=for-the-badge)

## Automated

```bash
npm run test -w uxnan-relay     # or `npm test` at the root for all packages
```

Covers (server started on an ephemeral port, driven with real `ws` clients):
forwarding frames both ways between a paired `mac` + `iphone` on the same
`sessionId`; rejection of a bad/missing role or `sessionId`; `GET /health`; per-IP
rate limiting (HTTP 429 / dropped upgrade); peer-close + stale-socket reconnection
handling; CSWSH `Origin` checks on WebSocket upgrades (server-to-server,
same-origin, cross-origin, allowlist); and the bounded per-IP rate limiter.
16 tests: `relay-server` 6, `origin-check` 7, `rate-limiter` 3.

> `mac` / `iphone` are protocol **roles**, not operating systems — `mac` is the
> bridge side, `iphone` is the mobile side.

## Manual smoke

```bash
node relay/dist/src/cli.js 8787
curl http://127.0.0.1:8787/health         # -> {"ok":true}
```

## End-to-end with the bridge

`bridge/test/transport/relay-e2e.test.ts` runs the relay + bridge + an independent
Node "fake phone" over a real WebSocket. For the real-device flow (relay + bridge +
the Flutter app), see [`../../bridge/docs/testing.md`](../../bridge/docs/testing.md)
§2.

## Push

The relay carries no push traffic, so there is nothing to test here: background
push is the bridge's, straight to FCM — see
[`../../bridge/docs/push-notifications.md`](../../bridge/docs/push-notifications.md).
