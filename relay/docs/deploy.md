# Relay — deployment

![Deploy](https://img.shields.io/badge/deployed_by-the_bridge-2ea44f?style=for-the-badge)
![Cloudflare](https://img.shields.io/badge/your_own-Cloudflare_account_(free)-F38020?style=for-the-badge&logo=cloudflare&logoColor=white)
![TLS](https://img.shields.io/badge/TLS-workers.dev-0a0a0a?style=for-the-badge&logo=letsencrypt&logoColor=white)

The relay is deployed **by the bridge**, into **the user's own Cloudflare
account**, through Cloudflare's REST API — no repository checkout, no extra CLI,
nothing hosted by Uxnan. This page is the reference for what that deploy does
and for the manual path developers use. The user-facing guide is
[`docs/connecting.md`](../../docs/connecting.md).

## Do you need it?

Only for a phone on **another network** without a VPN. Same Wi-Fi and Tailscale
are direct and need nothing (see
[`bridge/docs/connectivity.md`](../../bridge/docs/connectivity.md)). The phone
always tries the direct addresses first and dials the relay only when none
answers.

## Deploy it with the bridge (the normal path)

What you need:

1. **A Cloudflare account** (the free plan is enough) with a **`workers.dev`
   subdomain**. A new account gets one the first time you open *Workers & Pages*
   in the dashboard; the bridge says so if it is missing.
2. **Your account id** — 32 hexadecimal characters, shown on the *Workers &
   Pages* overview.
3. **An API token** created from the **"Edit Cloudflare Workers"** template,
   scoped to that account.

Then, with the bridge running:

```bash
uxnan-bridge relay setup --account <account-id>              # asks for the token, without echo
uxnan-bridge relay setup --account <account-id> --remember   # also keep the token for later updates
```

The token is read from the terminal (or piped stdin), never from an argument,
and goes to the **running** bridge over its local control channel
(`relay/setup`). The bridge then:

1. checks the account's `workers.dev` subdomain;
2. reads the hosts the `uxnan-relay` Worker already serves, if it exists (a
   second PC on the same account);
3. uploads the Worker it ships (`dist/relay-worker/uxnan-relay.js`) with two
   bindings — the `RELAY` Durable Object namespace (class `RelayRoom`) and
   `UXNAN_HOST_KEYS`, a plain-text list of the bridges allowed to host, to which
   it adds its own Ed25519 public key — plus, on the first deploy only, the
   migration that creates the SQLite-backed `RelayRoom` class;
4. enables the Worker on `workers.dev`, which gives
   `wss://uxnan-relay.<subdomain>.workers.dev`;
5. waits (up to 60 s) until that address answers `GET /v1/version` — a new
   `workers.dev` route took 5–15 s in our measurements;
6. stores the endpoint `{ url, routingId, enabled }` as the shared setting
   `relay` (in `~/.uxnan/daemon-config.json`, announced to every client) and how
   it was set up in `~/.uxnan/relay.json` (provider, account id, deployed
   version), then opens its control socket.

The token is dropped after the call unless `--remember` keeps it in the system
keyring (entry `relay.cloudflare-token`). It is never written to a file, a log,
a response or a notification, and Cloudflare's error text is shown without it.
Errors are phrased for the person who has to fix them (rejected token, missing
permission, unknown account id, no `workers.dev` subdomain).

**Several PCs, one account.** Running `relay setup` on another PC with the same
account re-uploads the same Worker with both keys in `UXNAN_HOST_KEYS`; each PC
gets its own room (routing id) on it.

### Afterwards

```bash
uxnan-bridge relay status                  # endpoint, state, versions, phones connected, hostKey (JSON)
uxnan-bridge relay disable | enable        # stop / resume serving phones through it
uxnan-bridge relay update [--remember]     # deploy the relay version this bridge ships
uxnan-bridge relay rotate                  # new routing id: the old address stops working
uxnan-bridge relay remove                  # stop using it (the Worker stays in the account)
uxnan-bridge relay remove --delete-worker  # also take this PC off the Worker; deletes it if no PC is left
```

`update` and `remove --delete-worker` need the token again unless it was
remembered; the CLI asks for it only then. `relay status` compares
`bundledVersion` (what this bridge ships) with `deployedVersion` (what the relay
reports): after updating the bridge, run `relay update` when they differ.

## Deploy it by hand (developers)

For a relay you deploy yourself — another Cloudflare account, a staging Worker,
the deployed test run — use **the same Worker**:

```bash
npm run build -w uxnan-relay     # → relay/dist/worker/uxnan-relay.js
```

Upload that file as an ES module Worker with:

| Setting | Value |
|---|---|
| Main module | `uxnan-relay.js` (already bundled; upload it as is) |
| Compatibility date | `RELAY_COMPATIBILITY_DATE` from `shared/src/relay/protocol.ts` (`2026-07-01`) |
| Durable Object binding | `RELAY` → class `RelayRoom` |
| Migration (first deploy only) | tag `v1`, `new_sqlite_classes: ["RelayRoom"]` |
| Plain-text binding | `UXNAN_HOST_KEYS` = comma-separated Ed25519 public keys (hex) of the bridges allowed to host |

With Cloudflare's own deploy tool, the equivalent configuration is:

```toml
name = "uxnan-relay"
main = "dist/worker/uxnan-relay.js"
compatibility_date = "2026-07-01"
no_bundle = true
workers_dev = true

[[durable_objects.bindings]]
name = "RELAY"
class_name = "RelayRoom"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["RelayRoom"]

[vars]
UXNAN_HOST_KEYS = "<the bridge's hostKey>"
```

**A hand-deployed relay must list the bridge's key.** Take `hostKey` from
`uxnan-bridge relay status` (the bridge's public identity key — public, safe to
copy) and put it in `UXNAN_HOST_KEYS`; otherwise the relay closes the bridge
with `notAllowed` (4003). Then point the bridge at it:

```bash
uxnan-bridge relay use wss://<your-relay-host>
```

`relay use` accepts `wss://` (an `https://` address is rewritten to `wss://`),
drops any path, and checks that `GET /v1/version` answers as the Uxnan relay
before saving. Plain `ws://` is accepted only for `localhost` / `127.0.0.1`.
A relay set up with `relay use` is updated and deleted where it was deployed:
`relay update` refuses it, and `relay remove` only stops using it (with or
without `--delete-worker`).

## Free plan: what it costs

On Cloudflare's free plan the relay costs nothing, and exceeding a daily limit
makes requests fail until the next day — it never charges. The limits that
matter (as of 2026-10): **100,000 requests per day**, where incoming WebSocket
messages count **20:1** and outgoing ones are free, and **13,000 GB-s of
Durable Object duration per day**.

Measured on a free account (2026-10-02):

| What | Measured |
|---|---|
| Deploy through the REST API | ~0.6 s |
| A new `workers.dev` route starts answering | ~5–15 s |
| Idle bridge control socket (30 s pings) | 2 object wake-ups in 3 idle minutes — the pings are answered without waking it |
| Relay `ready` for a phone | ~360–540 ms |
| E2EE handshake through the relay | ~210 ms |
| Encrypted request round trip (p50) | ~80 ms |

## Security model

- The relay authenticates every socket with an Ed25519 challenge before it
  forwards anything, and binds each routing id to the first host key that
  claimed it.
- After that it forwards frames verbatim and parses none of them: it sees
  public keys, timing and sizes — never content, never keys that could open it.
- It stores only the bound host key, the trusted phone keys and the SHA-256 of
  an open pairing ticket.
- A phone removed from the bridge's trusted devices is cut off at once.
- TLS is `workers.dev`'s; nothing disables certificate verification.

Spec: [`architecture/02a-system-architecture.md`](../../architecture/02a-system-architecture.md)
§5.10.
