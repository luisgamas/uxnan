# Bridge — installation & autostart

How to install, run, and auto-start the uxnan bridge daemon on a PC.

## Prerequisites

- **Node.js ≥ 18** (developed/tested on Node 24).
- One or more **agent CLIs**, installed and logged in with your own account —
  see [`../FOR-HUMAN.md`](../FOR-HUMAN.md) (OpenCode, Claude Code, Codex). A
  missing/logged-out agent just shows as `available: false`; the others keep
  working.

The bridge needs no secrets from you: its Ed25519 identity is generated and stored
in the OS keychain at first run.

## Install

**From a checkout (current):**

```bash
npm install        # at the repo root (installs the workspaces)
npm run build      # builds shared → relay → bridge
node bridge/dist/src/cli.js start
```

**As a global package (after publish — see [`deploy.md`](./deploy.md)):**

```bash
npm install -g uxnan-bridge
uxnan-bridge start
```

## Run

```bash
uxnan-bridge start     # boot the daemon: LAN server + relay + print the pairing QR
uxnan-bridge qr        # just print the pairing QR
uxnan-bridge status    # print status as JSON
uxnan-bridge stop      # signal the running daemon to stop
```

Scan the QR with the Uxnan mobile app to pair (once). After pairing, the phone
reconnects to the trusted device without re-scanning.

- **Same network (LAN):** the phone connects **directly** to the bridge — no relay,
  no hosting. (Primary plug-and-play path.)
- **Remote (off-LAN):** recommended is **Tailscale** (or any mesh VPN) — also no
  hosting; the bridge's Tailscale address is advertised automatically. A hosted
  relay is the optional alternative.

See [`connectivity.md`](./connectivity.md) for the three modes.

## Autostart (run at logon, no open terminal)

```bash
uxnan-bridge install-service     # start the bridge automatically at logon
uxnan-bridge uninstall-service   # remove the autostart entry
```

It registers autostart **as the logged-in user, never elevated**:

| OS | Mechanism |
|---|---|
| Windows | Task Scheduler logon task (`/SC ONLOGON /RL LIMITED`); **falls back to a hidden Startup-folder `.vbs`** if Task Scheduler is denied (restricted account/policy) — no admin, no console window. |
| macOS | per-user LaunchAgent in `~/Library/LaunchAgents` (`RunAtLoad` + `KeepAlive`). |
| Linux | systemd `--user` unit; run `loginctl enable-linger $USER` so it survives logout. |

The legacy `scripts/install-service-*` files remain as a manual reference; the CLI
commands above supersede them.

## Where things live

`~/.uxnan/` holds the daemon config, pairing session, trusted-phones list, thread
store, checkpoints metadata, the single-instance lock, and daily-rotated logs.
Configuration reference: [`configuration.md`](./configuration.md).
