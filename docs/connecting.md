# Connecting your phone to your PC

The Uxnan app talks to the **bridge** running on your PC. There are three ways
for the phone to reach it, and you can use more than one: the phone always tries
the direct ones first and uses the relay only when none of them answers.
Whichever way it goes, everything is end-to-end encrypted between the phone and
the bridge.

| | Same network | Tailscale | Your own relay |
|---|---|---|---|
| **Works from** | the same Wi-Fi / LAN as the PC | anywhere both devices are on your tailnet | anywhere with internet |
| **You set up** | nothing | Tailscale on the PC **and** the phone | a free Cloudflare account, once, on the PC |
| **On the phone** | nothing | the Tailscale app, connected | nothing |
| **Goes through** | your network only | your tailnet | a Worker in **your** Cloudflare account |
| **Pick it when** | you are at home or at your desk | you already use Tailscale, or don't mind installing it | you want the phone to just work on mobile data, with no VPN |

> Today the relay is set up from the PC's terminal (`uxnan-bridge relay …`).
> Screens for it in Uxnan Desktop and in the phone app are coming.

## 1. Same network

Install and start the bridge, then scan the QR it shows (or type the short code):

```bash
npm install -g uxnan-bridge
uxnan-bridge start
```

The QR carries the PC's local addresses; the phone connects straight to them.
Nothing else to do — and nothing to redo when the PC moves: the bridge keeps
every paired phone told where it is now (a laptop taken from home to the office
included), and a phone that cannot reach the addresses it knows looks for its
PC on the local network before it uses your relay. If the phone cannot reach the PC on the same Wi-Fi, see
[`bridge/docs/connectivity.md`](../bridge/docs/connectivity.md) →
*Troubleshooting Direct LAN* (usually a firewall rule, or a guest Wi-Fi that
keeps devices apart).

## 2. Tailscale

Install [Tailscale](https://tailscale.com) on the PC and on the phone and sign
both into the same tailnet. The bridge advertises its Tailscale (`100.x`)
address in the QR automatically, so a phone paired at home keeps working
wherever the Tailscale app is connected. Nothing to configure in Uxnan.

## 3. Your own relay

For a phone on any network, with no VPN. The bridge deploys a small relay — a
Cloudflare Worker — into **your own** Cloudflare account. Uxnan runs no server
in between, and on Cloudflare's free plan it costs nothing.

### Set it up (once, on the PC)

1. **Create a free Cloudflare account** at [cloudflare.com](https://www.cloudflare.com)
   if you don't have one, and open **Workers & Pages** once (that gives the
   account its `workers.dev` subdomain).
2. **Copy your account id** — 32 characters, shown on the Workers & Pages
   overview.
3. **Create an API token** (*My Profile → API Tokens → Create Token*) from the
   **"Edit Cloudflare Workers"** template, limited to your account. Copy it.
4. **With the bridge running**, run:

   ```bash
   uxnan-bridge relay setup --account <your-account-id>
   ```

   Paste the token when asked — it is not shown as you type, and it is never
   written to a file. Add `--remember` if you want the bridge to keep it in your
   system keychain for later updates; otherwise it is used once and forgotten.

The bridge deploys the relay (it takes a few seconds, then waits for the new
address to come online — usually 5 to 15 seconds) and connects to it.
`uxnan-bridge relay status` should then show `"state": "connected"`.

### After that

- **Phones you already paired learn the relay by themselves** the next time
  they connect to the PC (on the same network or over Tailscale). From then on
  they reach the PC from any network — no new QR.
- **A new phone can pair from anywhere**: a QR shown while the relay is on
  carries a one-time ticket, so scanning it works even on mobile data. (Typing
  the short code still needs the same network or Tailscale — scan the QR
  instead.)

### Manage it

```bash
uxnan-bridge relay status                  # is it connected, how many phones use it
uxnan-bridge relay disable                 # stop serving phones through it (enable to resume)
uxnan-bridge relay update                  # deploy the relay version your bridge ships
uxnan-bridge relay rotate                  # give your PC a new address on the relay
uxnan-bridge relay remove                  # stop using it (the Worker stays in your account)
uxnan-bridge relay remove --delete-worker  # also take it off Cloudflare
```

- **After updating the bridge**, `relay status` shows `bundledVersion` (what the
  bridge ships) and `deployedVersion` (what runs in your account). If they
  differ, run `relay update` (it asks for the token unless you used
  `--remember`).
- **Rotate** if you think the address leaked: the old one stops working at once.
  Paired phones pick up the new one the next time they reach the PC on its
  network or over Tailscale.
- **Several PCs** can use the same Cloudflare account: run `relay setup` on each;
  they share one Worker and each gets its own address on it. `remove
  --delete-worker` deletes the Worker only when the last PC leaves it.
- **Removing a phone** from your trusted devices cuts its relay connection
  immediately.

### What it costs

Nothing on Cloudflare's free plan: it allows 100,000 requests a day (incoming
WebSocket messages count 1 per 20; outgoing ones are free), and an idle bridge
costs almost nothing because the relay sleeps between messages. If a daily limit
is ever exceeded, the relay stops answering until the next day — Cloudflare
never charges a free account for it.

## Troubleshooting

### The phone can't connect through the relay

The relay refuses or ends a phone's connection with one of these codes (the
phone's relay screens, still to come, will put them in words):

| What you see / code | Meaning | What to do |
|---|---|---|
| PC offline (4004) | No bridge is connected to the relay right now | Check the PC is on and the bridge is running; `uxnan-bridge relay status` should say `connected`. If you just ran `relay rotate`, connect the phone once on the PC's network or over Tailscale so it learns the new address. |
| Phone not paired (4003) | The relay doesn't know this phone, or the pairing ticket was already used or expired | Pair again: show a fresh QR on the PC and scan it within 5 minutes. |
| Revoked (4010) | This phone was removed from the PC's trusted devices | Pair it again if that was a mistake. |
| Relay full (4011, or HTTP 503) | More than 8 phones are connected at once, or too many connections are open | Disconnect a phone, or retry in a moment. |
| PC didn't answer (4005) | The bridge did not open the phone's connection in time | Usually a slow or flaky PC network; retry. |
| Nothing answers at all | The relay's daily free-plan limit was exceeded, or the relay was removed | Wait until the next day, or check `relay status` on the PC. |

### `relay setup` fails

- *"Cloudflare rejected the API token"* — create a new token with the **"Edit
  Cloudflare Workers"** template and run setup again.
- *"The API token cannot edit Workers on this account"* — the token is limited
  to another account, or lacks the Workers permission.
- *"Cloudflare does not know this account id"* — copy it again from the Workers
  & Pages overview.
- *"This Cloudflare account has no workers.dev subdomain yet"* — open Workers &
  Pages in the dashboard once, then retry.
- *"the bridge is not running"* — start it first (`uxnan-bridge start`, or the
  service).

### `relay status` shows `"state": "error"`

`lastError` says why. *"The relay refused this bridge"* means the Worker no
longer lists this PC's key — for example the Worker was replaced, or it is a
relay you deployed by hand without this PC's `hostKey`. Run `relay setup` again
(or add the `hostKey` shown by `relay status` to your hand-deployed relay).

## Privacy

The relay runs in your Cloudflare account and only checks who is connecting,
then passes sealed envelopes along. It sees the public keys of your PC and
phones, when they connect and how large the encrypted messages are — **never
their content**, your code, your conversations or your notifications (push
notifications go from the bridge straight to Firebase, not through the relay).
It stores only your PC's public key, your trusted phones' public keys and a
fingerprint of an open pairing ticket.

## More detail

- How each way works, for developers: [`bridge/docs/connectivity.md`](../bridge/docs/connectivity.md)
- The relay itself, and deploying it by hand: [`relay/README.md`](../relay/README.md),
  [`relay/docs/deploy.md`](../relay/docs/deploy.md)
- The protocol: [`architecture/02a-system-architecture.md`](../architecture/02a-system-architecture.md) §5.10
