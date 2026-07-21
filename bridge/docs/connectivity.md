# Connectivity — how the phone reaches the bridge

![LAN](https://img.shields.io/badge/LAN-direct-2ea44f?style=for-the-badge)
![Tailscale](https://img.shields.io/badge/Tailscale-direct_(recommended_off--LAN)-blue?style=for-the-badge&logo=tailscale&logoColor=white)
![Relay](https://img.shields.io/badge/relay-optional_%2F_self--hosted-lightgrey?style=for-the-badge)

The phone and bridge always speak the **same E2EE protocol**; only the *transport*
to reach the bridge differs. The pairing QR advertises the available transports and
the phone picks one. There are three modes — pick by where you need to use it.

| Mode | Hosting | When |
|---|---|---|
| **1. Direct LAN** | none | Phone + PC on the same network. **Primary plug-and-play path.** |
| **2. Tailscale (or any mesh VPN)** | none | Remote, recommended. Puts both devices on one virtual network so the direct path "just works". |
| **3. Self-hosted relay** | a server you run | Remote, **optional and off by default** — for users who don't want to install a VPN. |

The pairing QR carries:
- **`hosts`** — the bridge's direct `host:port` addresses (its non-internal IPv4s:
  LAN address(es) and, if Tailscale is up, the `100.x` tailnet address). The phone
  tries these **first**.
- **`relay`** — the relay URL, used as a **fallback**. Present **only when you
  enable a (self-hosted) relay** (`relayEnabled: true`); it is **off by default**.
  At least one of `hosts`/`relay` is always present.

## 1. Direct LAN (default, no hosting)

Just install and run the bridge. On the same Wi-Fi/LAN, the phone connects directly
to the bridge's LAN server (`hosts`) — no relay, nothing to deploy. Ideal for local
use and testing.

```bash
uxnan-bridge start        # prints the QR + "Direct addresses (LAN/Tailscale): …"
```

## 2. Tailscale — remote with no hosting (recommended)

[Tailscale](https://tailscale.com) (or ZeroTier / WireGuard) puts your phone and PC
on one private virtual network. The bridge already listens on all interfaces, so its
Tailscale `100.x` address is advertised in `hosts` automatically — a phone on the
same tailnet reaches the bridge directly from anywhere, **with no hosted relay**.

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

No extra config needed: the relay is **off by default**, so this mode is pure
direct (the QR carries only `hosts`).

## 3. Self-hosted relay (optional — off by default)

The relay is **disabled by default** (`relayEnabled: false`) — install-and-run is
LAN/Tailscale-direct with zero hosting. Enable it only if you'd rather not put a
VPN on the phone and want an internet-reachable fallback. **To turn it on:**

1. **Run your own relay** — it's the `uxnan-relay` package in this repo. Hosting
   options (Cloudflare Tunnel, Fly.io, a small VPS, …) are in
   [`../../relay/docs/deploy.md`](../../relay/docs/deploy.md). The relay only ever
   sees opaque E2EE envelopes, so it needs no secrets or trust.
2. **Point the bridge at it and enable it** — in [`configuration.md`](./configuration.md)
   set `relayEnabled: true` and `relayUrl` to your relay's `wss://…` URL.
3. Re-pair (or regenerate the QR): it now carries your `relay` as a fallback after
   the direct `hosts`.

## Notes

- **First-time pairing is time-boxed (LAN/Tailscale).** Enrollment of a *new*
  device is only accepted for 5 minutes after an operator action opens the
  window — showing the QR, showing the code, or a phone successfully looking the
  code up. This is what stops any peer that can reach the always-listening LAN
  port from enrolling itself as trusted. Already-paired devices reconnect at any
  time, unaffected. Against a console-less daemon (`install-service`), pair with
  the **manual code**: `uxnan-bridge qr`/`code` run in a separate process, and a
  scanned QR never contacts the daemon before the handshake.

- All modes are E2EE end-to-end; the relay only ever sees opaque envelopes.
- `hosts` may include virtual-NIC addresses (Docker/WSL/Hyper-V) the phone can't
  reach — harmless, it just tries the next one (each with a short timeout) and
  finally falls back to the relay when one is configured.
- **Mobile side:** the app consumes `hosts` (tries each direct address first,
  then the relay), tolerates a relay-less QR, and persists the hosts on the
  trusted device — implemented and verified on Android over LAN and Tailscale.

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
  is advertised in the QR, so it's the reliable fallback with no hosting.
