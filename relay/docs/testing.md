# Relay — testing

![Runner](https://img.shields.io/badge/runner-node%3Atest-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![Runtime](https://img.shields.io/badge/runtime-workerd_via_Miniflare-F38020?style=for-the-badge&logo=cloudflare&logoColor=white)

## Automated

```bash
npm test -w uxnan-relay          # builds the bundle, then runs the suite
npm run typecheck -w uxnan-relay # Worker types + Node-side types
```

The suite runs against **the real Workers runtime** (workerd, through
Miniflare 4) with **the same bundle the bridge deploys** — not a stand-in
server. `startLocalRelay` (`src/local/start-local-relay.ts`) loads
`dist/worker/uxnan-relay.js` with a SQLite-backed `RELAY` Durable Object and the
test's host keys in `UXNAN_HOST_KEYS`. Every test uses its own routing id, so
each gets a fresh room.

**18 tests** (`test/relay.test.ts`, driven by real `ws` clients through
`test/helpers.ts`):

- `GET /v1/version`; `404` off-route and `426` without an upgrade;
- a phone and its bridge exchanging frames verbatim both ways; several phones at
  once, each on its own channel;
- host auth: an unknown host key refused, a forged signature refused, a routing
  id bound to the first host that claimed it, a newer control socket replacing
  the old one (`replaced`);
- phone auth: no allow-list entry and no ticket refused; a trusted phone told
  its bridge is offline (`bridgeOffline`); a pairing ticket admitting one phone,
  once; an expired ticket refused; removing a phone from the allow list cutting
  its live channel (`revoked`);
- channel auth: signed by the bound host and matching a waiting phone;
- `ping` → `pong`; a malformed control frame (`badFrame`); a socket that never
  answers the challenge (`authTimeout`); a phone the bridge never dials back
  (`bridgeTimeout`).

> **Local-runtime quirk, handled in the helpers.** When the local runtime closes
> a socket from a Durable Object **alarm** (the auth and dial deadlines), it
> sends the close frame but keeps the TCP connection open until disposal, so
> `ws` would only emit `close` after its own 30-second timeout.
> `Client.expectClose` therefore counts a close as received as soon as its close
> **frame** arrives. Cloudflare's edge ends the connection promptly — verified
> against a deployed relay.

## Against a relay deployed to Cloudflare

The same suite runs against a deployed relay:

```bash
UXNAN_RELAY_TEST_URL=wss://uxnan-relay.<subdomain>.workers.dev \
UXNAN_RELAY_TEST_HOST_KEYS='["-----BEGIN PRIVATE KEY-----\n…", "-----BEGIN PRIVATE KEY-----\n…"]' \
npm test -w uxnan-relay
```

`UXNAN_RELAY_TEST_HOST_KEYS` is a JSON array of **two** Ed25519 private keys
(PKCS#8 PEM) whose public keys that relay was deployed with in
`UXNAN_HOST_KEYS` — the suite needs a second host to prove a routing id stays
bound to the first. Deploy a dedicated test Worker for this (see
[`deploy.md`](deploy.md) → *Deploy it by hand*); never point it at a relay
your phones use. It needs your own Cloudflare account; nothing in CI runs it.

## With the bridge and the phone

- **Bridge.** `bridge/test/transport/relay-e2e.test.ts` runs a real bridge, this
  Worker on the local runtime and a fake phone that speaks the phone route and
  then the E2EE handshake: pairing through the relay with a ticket, trusted
  reconnect, cut-off on removal, a new phone without a ticket refused, and the
  endpoint as a shared setting that disconnects when switched off.
  `bridge/test/relay/` covers the Cloudflare deploy (against a fake of the API)
  and the relay service. See
  [`../../bridge/docs/testing.md`](../../bridge/docs/testing.md).
- **Phone.** `uxnanmobile/test/integration/relay_local_test.dart` drives the
  phone's relay client against this Worker on the local runtime (opt-in:
  `UXNAN_RELAY_E2E=1`) — see
  [`../../uxnanmobile/docs/testing.md`](../../uxnanmobile/docs/testing.md).

## Push

The relay carries no push, so there is nothing to test here: background push
is the bridge's, straight to FCM — see
[`../../bridge/docs/push-notifications.md`](../../bridge/docs/push-notifications.md).
