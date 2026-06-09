# Connectivity — how the phone reaches the bridge

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

- All modes are E2EE end-to-end; the relay only ever sees opaque envelopes.
- `hosts` may include virtual-NIC addresses (Docker/WSL/Hyper-V) the phone can't
  reach — harmless, it just tries the next one and falls back to the relay.
- **Mobile side:** consuming `hosts` (try direct → relay) is a change on the
  `uxnanmobile` branch — see [`../FOR-DEV.md`](../FOR-DEV.md).
