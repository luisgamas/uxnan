# Bridge — installation & autostart

![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A518-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![Platforms](https://img.shields.io/badge/Windows_%7C_macOS_%7C_Linux-lightgrey?style=for-the-badge)
![Autostart](https://img.shields.io/badge/autostart-at_logon,_never_elevated-2ea44f?style=for-the-badge)

How to install, run, and auto-start the uxnan bridge daemon on a PC.

## Prerequisites

- **Node.js ≥ 18** (developed/tested on Node 24).
- One or more **agent CLIs**, installed and logged in with your own account —
  see [`agents.md`](./agents.md) / [`../FOR-HUMAN.md`](../FOR-HUMAN.md) (OpenCode,
  Claude Code, Codex, pi, Gemini CLI, Antigravity, Zero, Grok). A
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

> **Pair within 5 minutes of showing the QR or code.** First-time enrollment is
> only accepted while a pairing window is open, so a device that never saw your
> screen cannot enroll itself over the LAN. Showing the QR or the code opens the
> window, and so does a phone successfully looking up the code. If the window
> lapsed, just run `uxnan-bridge qr` (or `code`) again.
>
> **Running as a service?** `install-service` starts the daemon with no console,
> and `uxnan-bridge qr`/`code` then run in a *separate* process — so **pair with
> the manual code**, not the QR. Looking the code up reaches the daemon that
> serves the handshake; a scanned QR does not. Re-pairing an already-trusted
> phone is never gated.

- **Same network (LAN):** the phone connects **directly** to the bridge — no relay,
  no hosting. (Primary plug-and-play path.)
- **Remote (off-LAN):** recommended is **Tailscale** (or any mesh VPN) — also no
  hosting; the bridge's Tailscale address is advertised automatically. A hosted
  relay is the optional alternative.

See [`connectivity.md`](./connectivity.md) for the three modes.

## Staying up to date

The bridge is the ecosystem's core engine, so it checks whether a newer build
has been published to npm (under the `latest` dist-tag) and nudges you to update.
`start`, `status`, `qr` and `code` print a one-line notice to **stderr** when the
running version is behind:

```
A newer bridge is available: <version> (you have <current>).
Update with: npm install -g uxnan-bridge@latest
```

The check is best-effort (silent when offline / up to date), cached in
`~/.uxnan/update-check.json` with a 24h TTL, and the running daemon refreshes it
in the background. **`start` always re-checks** (it ignores the cache), so a
release published inside the 24h window is announced the next time you start the
bridge instead of up to a day later; the short-lived `status`/`qr`/`code`
commands keep using the cache so they stay fast. The paired phone learns the
same thing via `bridge/status`
(`latestVersion`/`updateAvailable`) and shows an informational hint — see the
mobile app. Update with `npm install -g uxnan-bridge@latest` (or `git pull` +
`npm install` for a source checkout).

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
store, checkpoints metadata, the update-check cache (`update-check.json`), the
single-instance lock, and daily-rotated logs.
Configuration reference: [`configuration.md`](./configuration.md).
