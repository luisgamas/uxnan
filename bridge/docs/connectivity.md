# Connectivity — how the phone reaches the bridge

![LAN](https://img.shields.io/badge/LAN-direct-2ea44f?style=for-the-badge)
![Tailscale](https://img.shields.io/badge/Tailscale-direct-blue?style=for-the-badge&logo=tailscale&logoColor=white)
![Relay](https://img.shields.io/badge/relay-your_own_Cloudflare_account-F38020?style=for-the-badge&logo=cloudflare&logoColor=white)

The phone and bridge always speak the **same E2EE protocol**; only the *transport*
to reach the bridge differs. There are three ways, and the phone uses the first
that answers — direct addresses first, the relay last. (The user-facing version
of this page is [`docs/connecting.md`](../../docs/connecting.md).)

| Way | What you set up | When |
|---|---|---|
| **1. Same network (direct LAN)** | nothing | Phone and PC on the same Wi-Fi/LAN. The default. |
| **2. Tailscale (direct)** | Tailscale on both devices | Away from home, if you already use Tailscale or are happy to install it. Lowest latency off the LAN, nothing to deploy. |
| **3. Your own relay** | `uxnan-bridge relay setup` — a free Cloudflare account | Away from home with no VPN on the phone. The bridge deploys the relay into **your** account; paired phones then reach the PC from any network. |

The pairing QR (v3) carries:
- **`hosts`** — the bridge's direct `host:port` addresses (its non-internal IPv4s:
  LAN address(es) and, if Tailscale is up, the `100.x` tailnet address). The phone
  tries these **first**.
- **`relay`** — `{ url, routingId, ticket? }`, present **only while a relay is
  set up and enabled**. `ticket` is a one-time pairing ticket, there while the
  pairing window is open, so a phone that is not on the PC's network can pair
  through the relay. At least one of `hosts`/`relay` is always present.

A phone paired on the LAN does not need a new QR when a relay is set up later:
the relay is a **shared setting** (`BridgeSettings.relay`), so every paired phone
learns it the next time it syncs with the bridge.

## 1. Direct LAN (default, no hosting)

Just install and run the bridge. On the same Wi-Fi/LAN, the phone connects directly
to the bridge's LAN server (`hosts`) — no relay, nothing to deploy. Ideal for local
use and testing.

```bash
uxnan-bridge start        # prints the QR + "Direct addresses (LAN/Tailscale): …"
```

### Nearby bridge discovery (mDNS / Bonjour)

The manual-code screen's **Browse nearby bridges** action browses the link-local
DNS-SD service `_uxnan._tcp.local` over multicast UDP `224.0.0.251:5353`.
The bridge publishes PTR/SRV/TXT/A records containing only discovery hints:
display name, bridge id, LAN address and LAN port. It joins and sends through
each eligible advertised IPv4 explicitly, which matters on PCs with Wi-Fi plus
lower-metric Ethernet, Tailscale, Hyper-V, WSL, Docker or other adapters.

Discovery and authorization are deliberately separate:

1. An mDNS result is unauthenticated and spoofable; it is treated only as a host
   suggestion.
2. The user explicitly selects one result. That action fills the host field; it
   does not contact every discovered machine and does not trust anything.
3. The pairing code is never present in mDNS. The phone sends it only to the one
   selected/typed host through `GET /pair/resolve?code=...`.
4. A valid code opens the bridge's short-lived enrollment window, after which
   the documented Ed25519/X25519 E2EE bootstrap authenticates the bridge and
   creates the trusted-device record. A nearby device cannot self-enroll merely
   by advertising or discovering the service.

If direct `192.168.x.x:19850` pairing works but the list stays empty, test the
discovery layer separately from TCP:

```powershell
# The bridge should own a reusable UDP 5353 endpoint.
Get-NetUDPEndpoint -LocalPort 5353

# The startup log should include the Wi-Fi IPv4 after "via".
Select-String "$HOME\.uxnan\logs\bridge-*.log" -Pattern "mDNS advertising"

# Inspect which adapter Windows would otherwise prefer for multicast.
Get-NetRoute -AddressFamily IPv4 |
  Where-Object DestinationPrefix -eq '224.0.0.0/4' |
  Sort-Object InterfaceMetric
```

Also confirm that both devices are on the same non-guest LAN and that the access
point does not enable client/AP isolation. Windows Firewall must allow inbound
UDP 5353 for the bridge on the active network profile; the bridge does not add
an elevated firewall rule automatically. A blocked/unsupported mDNS path never
weakens pairing: scan the QR or type the printed host and code instead.

## 2. Tailscale — direct from anywhere, no hosting

[Tailscale](https://tailscale.com) puts your phone and PC on one private
virtual network. The bridge already listens on all interfaces, so its
Tailscale `100.x` address is advertised in `hosts` automatically — a phone on the
same tailnet reaches the bridge directly from anywhere, **with no relay**.

1. Install Tailscale on the **PC** and the **phone**; sign both into the same
   tailnet (free for personal use).
2. Run `uxnan-bridge start` and pair. The QR's `hosts` includes the `100.x` address
   (confirm it's listed in the "Direct addresses" line).
3. Off-LAN, the phone connects over Tailscale exactly like it would on the LAN.

> **"Browse nearby bridges" does not work over Tailscale — type the address.**
> Discovery is mDNS (`_uxnan._tcp`), which is link-local multicast and does not
> traverse a tailnet by design. Over Tailscale, enter the PC's `100.x` address
> (it is printed as a "Direct address" when the bridge starts). This is inherent
> to mDNS, not a bug — and once paired, reconnecting needs no discovery at all.

No extra config needed: with no relay set up, the QR carries only `hosts`.

## 3. Your own relay

For a phone on another network with no VPN. The relay is a Cloudflare Worker
that **the bridge deploys into your own Cloudflare account** (the free plan is
enough); Uxnan hosts nothing. Off until you set it up.

**Set it up** (the bridge must be running — these commands ask it over the
local control channel):

1. In Cloudflare, create an **API token from the "Edit Cloudflare Workers"
   template** for your account, and copy your **account id** (*Workers & Pages*
   overview).
2. Run:

   ```bash
   uxnan-bridge relay setup --account <account-id>   # prompts for the token (not echoed)
   ```

   Add `--remember` to keep the token in the system keyring for later
   `relay update` / `relay remove --delete-worker`; otherwise it is used once and
   dropped. It is never an argument, never written to a file or a log.
3. The bridge deploys the Worker, waits for `wss://uxnan-relay.<subdomain>.workers.dev`
   to answer, saves the endpoint as the shared setting `relay` and connects.
   Phones already paired learn it at their next sync; a new pairing QR carries
   it with a ticket.

**Manage it:**

```bash
uxnan-bridge relay status                  # state, endpoint, versions, connected phones, hostKey
uxnan-bridge relay disable | enable        # stop / resume serving phones through it
uxnan-bridge relay update [--remember]     # deploy the relay version this bridge ships
uxnan-bridge relay rotate                  # new routing id; the old one stops working
uxnan-bridge relay remove [--delete-worker]
uxnan-bridge relay use wss://<host>        # a relay you deployed yourself (same Worker)
```

The same actions are JSON-RPC methods every client can call — `relay/status`,
`relay/setup`, `relay/use`, `relay/set`, `relay/update`, `relay/rotate`,
`relay/remove` — and every change is announced as `stream/relay/updated`
(architecture/02a §5.10). The desktop and phone screens for them are not built
yet; the CLI is the way in today.

**How it works.** The bridge keeps one control socket open to its room on the
relay (`/v1/host/<routingId>`), signs the relay's challenge with its Ed25519
identity, sends it the trusted phones' keys, and pings every 30 s (answered
without waking the relay). It reconnects on its own, backing off from 2 s to
60 s. When a trusted phone dials in, the relay asks the bridge to open a
channel for it; the bridge runs **the same secure session as on the LAN** over
that channel. Showing the QR or the pairing code also hands the relay the hash
of a one-time ticket, so a new phone can pair from another network while the
pairing window is open.

**What the relay can and cannot see.** It sees the bridge's and phones' public
keys, when they connect and how large the encrypted frames are. It never sees
content: everything after its auth step is the E2EE handshake and AES-256-GCM
envelopes. It stores only the bound bridge key, the trusted phone keys and the
hash of an open ticket. Removing a trusted phone cuts its relay channel at once.

Deployment details, the manual path and free-plan limits:
[`../../relay/docs/deploy.md`](../../relay/docs/deploy.md).

## 4. Uxnan Desktop on the same machine (local control channel)

Uxnan Desktop does not pair like a phone. When the bridge runs
(`uxnan-bridge start`, or as a service) it also opens a **loopback-only**
WebSocket on a free port and writes how to reach it to
`~/.uxnan/local-control.json`:

```json
{ "protocol": 1, "port": 51234, "token": "…", "pid": 4242, "bridgeVersion": "…", "instanceId": "…" }
```

- The file is the credential: owner-only (`0600`; on Windows the profile ACL),
  written atomically, a **fresh token every start**, removed on stop.
- A connection must come from loopback, carry **no `Origin` header** (every
  browser sends one — no web page can reach the socket), and present
  `Authorization: Bearer <token>`. URL: `/control?client=<id>`.
- **One live connection per client id** — a newer one supersedes the older.
  Each Uxnan Desktop profile connects as its own `desktop-<profile>`, so the
  installed app and a development build share one bridge without knocking each
  other off; each gets its own replay log and presence, and keeps the tools it
  attached for the bridge's agents (a turn runs with the tools of the desktop
  that sent it). CLI commands connect as `cli`.
- The desktop is served by the **same** JSON-RPC router as the phones and gets
  every `stream/*` notification with its own `seq` (replayed after a reconnect),
  so a conversation started on either shows up on both
  (architecture/02a §5.8.15–§5.8.16).
- It never leaves this machine and is not the E2EE protocol: it is a local
  route with a token, the same trust model as the agent approval hook.
- `bridge/status` reports `features.localControl: true` while it listens.
  Turn it off with `"localControlEnabled": false` in `~/.uxnan/daemon-config.json`.

In the desktop: **Settings → Bridge & mobile** (see
`uxnandesktop/docs/chat.md`).

## Notes

- **First-time pairing is time-boxed — on every path.** Enrollment of a *new*
  device is only accepted for 5 minutes after an operator action opens the
  window — showing the QR, showing the code, or a phone successfully looking the
  code up. This is what stops any peer that can reach the always-listening LAN
  port, or the relay, from enrolling itself as trusted. Through the relay a new
  phone also needs the one-time ticket from the QR. Already-paired devices
  reconnect at any time, unaffected. Against a console-less daemon
  (`install-service`), `uxnan-bridge qr` asks the running bridge for its payload
  over the local control channel (`bridge/generatePairingQr`), which opens THAT
  bridge's window — the same thing Uxnan Desktop's "Pair a phone" does. The
  service itself never prints a QR or a code: its output goes to a log file.
- **Pairing by typed code needs a direct path.** The phone resolves a code with
  `GET /pair/resolve?code=` on the LAN or Tailscale address; away from the PC's
  network, pair by scanning the QR (it carries the relay ticket).
- All ways are E2EE end-to-end; the relay only ever forwards opaque envelopes.
- `hosts` may include virtual-NIC addresses (Docker/WSL/Hyper-V) the phone can't
  reach — harmless, it just tries the next one (each with a short timeout) and
  finally dials the relay when one is set up.
- **Mobile side:** the app tries each direct address first, then the PC's relay,
  tolerates a relay-less QR, keeps the hosts and the relay on the trusted device,
  and keeps the relay current from the bridge's shared settings. Verified on
  Android over LAN and Tailscale; the relay path is tested against the real
  relay runtime and still owes a device run (`relay/FOR-DEV.md`).

## Troubleshooting Direct LAN

If the phone can't reach the bridge on the **LAN** (it works over Tailscale but
not on the same Wi-Fi, or the phone can't even ping the PC), it's almost always
**Windows Firewall**. Two distinct rules matter — check both:

- **ICMP echo (ping) — the usual culprit for "can't even reach the PC".** Windows
  blocks inbound ping by default, so the phone can't reach the PC at all on the
  LAN. Enable **File and Printer Sharing (Echo Request - ICMPv4-In)** for the
  active profile (this is the exact toggle that fixed it here):
  *Windows Security → Firewall & network protection → Advanced settings →
  Inbound Rules*, or run once (admin):
  ```powershell
  Enable-NetFirewallRule -DisplayName "File and Printer Sharing (Echo Request - ICMPv4-In)"
  ```
- **The LAN port itself (TCP 19850).** On the first `start`, Windows prompts to
  allow `node.exe` on private networks; if that was dismissed/denied, inbound TCP
  to the LAN port is blocked. Allow **Node.js** on **Private** under *Allow an app
  through firewall*, or:
  ```powershell
  New-NetFirewallRule -DisplayName "uxnan-bridge LAN" -Direction Inbound `
    -Action Allow -Protocol TCP -LocalPort 19850 -Profile Private
  ```
- **Confirm reachability** from the phone: `ping <PC-LAN-IP>` should answer, and
  `http://<PC-LAN-IP>:19850` in the browser should connect (a blank/"Upgrade
  Required" page is fine — the port is open). Also check both devices are on the
  same subnet (guest/AP-isolated Wi-Fi blocks device-to-device traffic).
- **Tailscale always works** even when the LAN is blocked — its `100.x` address
  is advertised in the QR — and so does your own relay, once set up.
