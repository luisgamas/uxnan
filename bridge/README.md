# uxnan-bridge

Local control-plane daemon that connects the Uxnan mobile app to the developer's
PC over an end-to-end-encrypted channel. It runs Git, reads the workspace, and
drives AI coding agents on behalf of the phone, routing JSON-RPC methods to
per-domain handlers.

> **Status: Phase 6.** The daemon core, the **live E2EE transport** (relay `mac`
> client + direct-LAN server, handshake, AES-256-GCM channel, byte-for-byte
> compatible with the mobile app, with a background reconnect loop and a stable
> pairing session), bridge→phone notifications, **OS-keychain identity
> persistence**, a **single-instance lock**, the **real Git and Workspace
> handlers** (path-traversal-safe, including working-tree checkpoints), and the
> **conversation engine** (threads/turns + streaming) are in place. The **real
> OpenCode agent** is wired as the default (per-turn `opencode run --format json`,
> session continuity, runs in the thread's cwd), with **per-thread agent/project
> selection** (`thread/start`, `agent/list`, `agent/models`, `thread/setModel`,
> `project/list`/`resolve`) and a **push bridge** (`notifications/*`, gated behind
> relay Firebase creds). Codex/Claude/Gemini adapters are the next piece — see
> [FOR-DEV.md](./FOR-DEV.md).

## Install (later, as a global package)

```bash
npm install -g uxnan-bridge
```

## CLI

```bash
uxnan-bridge start            # start the daemon: LAN server + relay pairing session
uxnan-bridge status           # print current status as JSON
uxnan-bridge qr               # print the pairing QR in the terminal
uxnan-bridge stop             # stop the running daemon (via the lock file)
uxnan-bridge install-service  # autostart: see scripts/install-service-*
```

Logs are written to `~/.uxnan/logs/bridge-YYYY-MM-DD.log` (daily rotation, with a
secret-redaction pass) and to stderr. Autostart at login is configured by the
platform scripts under `scripts/` (Task Scheduler / LaunchAgent / systemd).

The Ed25519 identity is stored in the OS keychain (Windows Credential Manager /
macOS Keychain / Linux Secret Service). If no keychain is available the bridge
still runs with an in-memory identity (not persisted across restarts).

## Architecture

- **Contracts:** consumes [`@uxnan/shared`](../shared) for JSON-RPC and E2EE types
  and runtime validators.
- **State:** non-secret JSON under `~/.uxnan/` (atomic writes). The Ed25519
  identity is a secret and is kept in a `SecretStore`, never written in plaintext.
- **Routing:** `HandlerRouter.dispatchRaw()` validates the envelope and routes to
  registered handlers; errors map to JSON-RPC error codes.

See `architecture/02a-system-architecture.md` §5.8 and
`uxnandesktop/architecture/02e-bridge-integration.md`.

## Develop

```bash
# from the repo root (workspaces):
npm run build      # build @uxnan/shared then uxnan-bridge
npm test           # build + run all node:test suites
npm run typecheck  # tsc --noEmit across packages
npm run format     # prettier --write
```

Requires Node ≥18. ESM-only.
