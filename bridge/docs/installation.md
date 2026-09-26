# Bridge — installation & autostart

![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A518-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![Platforms](https://img.shields.io/badge/Windows_%7C_macOS_%7C_Linux-lightgrey?style=for-the-badge)
![Autostart](https://img.shields.io/badge/autostart-at_logon,_never_elevated-2ea44f?style=for-the-badge)

How to install, run, and auto-start the uxnan bridge daemon on a PC.

## Prerequisites

- **Node.js ≥ 18** (developed/tested on Node 24).
- One or more **agent CLIs**, installed and logged in with your own account —
  see [`agents.md`](./agents.md) / [`../FOR-HUMAN.md`](../FOR-HUMAN.md) (OpenCode,
  Claude Code, Codex, pi, Antigravity, Zero, Grok). A
  missing/logged-out agent just shows as `available: false`; the others keep
  working. Antigravity is the supported Google CLI integration.

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
uxnan-bridge qr        # print the pairing QR (the running bridge's, when one runs)
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
> and it prints no QR or code (its output is a log file). Run `uxnan-bridge qr`:
> it asks the running bridge for its own payload over the local control
> channel and opens that bridge's pairing window, so the scan pairs with the
> service. Uxnan Desktop's **Pair a phone** does the same. The manual code
> (`uxnan-bridge code`) keeps working too. Re-pairing an already-trusted phone
> is never gated.

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

The check is best-effort (silent when offline / up to date). The short-lived
`status`/`qr`/`code` commands use a cache in `~/.uxnan/update-check.json` (24h)
so they stay fast; `start` re-checks. **The running bridge asks the registry
itself every hour**, and tells every connected client the moment a newer version
appears (`stream/bridge/updated`; `bridge/status` → `update`).

**It updates itself** (architecture/02a §5.8.18). When the bridge runs as your
user's service from a global npm install, any client can ask it to update —
Uxnan Desktop's sidebar or Settings → *Bridge & mobile*, or the phone's notice
and Settings → *Updates* (`bridge/update`). It refuses while a turn is running on
any client. Otherwise it hands over to a helper (`uxnan-bridge self-update`,
internal) and stops; the helper waits for it to exit, runs
`npm install --global --prefix <the same prefix> uxnan-bridge@<version>` with the
npm installed beside the bridge, writes the outcome to
`~/.uxnan/update-result.json` and starts the service again. The bridge that comes
back reports a failure (npm's last lines, and the command to run by hand) or
simply runs the new version. Installing only once the bridge has stopped is what
makes this work on Windows, where a running process keeps its native modules
locked.

From a terminal, `uxnan-bridge update` asks the running bridge the same way
(one more client of the same owner; it never installs anything itself).

A bridge you started in a terminal, or one run from a source checkout, cannot
replace itself (`update.canApply: false` says why): update it with
`npm install -g uxnan-bridge@latest` (or `git pull` + `npm install`).
`uxnan-bridge version` prints the installed version without starting anything.

**From Uxnan Desktop, before the bridge could do it.** Uxnan Desktop keeps its
own npm path only for what the bridge cannot do for itself: installing it when
there is none, and updating a bridge older than updating itself
(`bridge/status` without `update`). *Update automatically* uses the same owner:
it asks the bridge, and only while no conversation is running on any device.

## Run it as your user's service (the normal way)

```bash
uxnan-bridge install-service     # run as your service: at logon, and now
uxnan-bridge service-status      # {"supported","installed","running","pid"} as JSON
uxnan-bridge service-start       # start the installed service after a deliberate stop
uxnan-bridge uninstall-service   # remove the service (and the Antigravity entry, below)
```

This is how the bridge is meant to live: **Uxnan Desktop installs it for you
(Settings → Bridge & mobile, mode *Managed*) and from then on only connects to
it**, and it keeps serving the phone while the desktop is closed. It registers
`<node> <cli.js> start --service` with absolute paths, **as the logged-in user,
never elevated**, with your home as its working directory, and it is restarted
when it crashes — not when you stop it on purpose:

| OS | Mechanism |
|---|---|
| Windows | Task Scheduler logon task (`/SC ONLOGON /RL LIMITED`); **falls back to a hidden Startup-folder `.vbs`** if Task Scheduler is denied (restricted account/policy) — no admin, no console window. |
| macOS | per-user LaunchAgent in `~/Library/LaunchAgents` (`RunAtLoad`, `KeepAlive` on a failed exit, `WorkingDirectory` = home). |
| Linux | systemd `--user` unit (`Restart=on-failure`); run `loginctl enable-linger $USER` so it survives logout. |

A service gets the service manager's minimal `PATH` (`/usr/bin:/bin` on macOS),
where Homebrew, npm's global bin and every agent CLI are missing. At start the
bridge therefore asks your login shell for its `PATH` (`$SHELL -ilc`) and adds
what is missing, so it finds the same agents your terminal does.

The legacy `scripts/install-service-*` files remain as a manual reference; the CLI
commands above supersede them.

## Where things live

`~/.uxnan/` holds the daemon config, pairing session, trusted-phones list, thread
store, the project registry (`projects.json`), the sync revision ledger
(`sync.json`), checkpoints metadata, the update-check cache
(`update-check.json`), the single-instance lock, and daily-rotated logs.

## The start folder

```bash
uxnan-bridge config get          # the shared settings as JSON
uxnan-bridge config set home ~/Projects
```

`home` is where exploring for a new project begins, on the phone and in Uxnan
Desktop alike, whatever directory the bridge was started from. With a bridge
running, the command changes it live (through the local control channel) and
every connected client is told; otherwise it is written to the config for the
next start.

## Names

```bash
uxnan-bridge config set name "Studio"   # what every client calls this PC
```

The PC's name is the one the pairing QR carries and the one the phone and the
desktop show; empty goes back to the machine's name. Each paired phone has a
name too: it reports its model when it connects, and anyone can rename it —
on the phone, or from Uxnan Desktop — with the latest rename winning
everywhere. Several phones can be paired to one PC.

Configuration reference: [`configuration.md`](./configuration.md).
