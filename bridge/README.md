# uxnan-bridge

Local control-plane daemon that connects the Uxnan mobile app to the developer's
PC over an end-to-end-encrypted channel. It runs Git, reads the workspace, and
drives AI coding agents on behalf of the phone, routing JSON-RPC methods to
per-domain handlers.

> **Status: Phase 4.** The daemon core, the **live E2EE transport** (relay `mac`
> client + direct-LAN server, handshake, AES-256-GCM channel, byte-for-byte
> compatible with the mobile app), bridge→phone notifications, **OS-keychain
> identity persistence**, a **single-instance lock**, and the **real Git and
> Workspace handlers** (path-traversal-safe, including working-tree checkpoints)
> are in place. The agent adapters (streaming conversations) are the next major
> piece — see [FOR-DEV.md](./FOR-DEV.md) and [../ROADMAP.md](../ROADMAP.md).

## Install (later, as a global package)

```bash
npm install -g uxnan-bridge
```

## CLI

```bash
uxnan-bridge start            # start the daemon core (no live transport yet)
uxnan-bridge status           # print current status as JSON
uxnan-bridge qr               # print the pairing QR in the terminal
uxnan-bridge stop             # stop the running daemon (via the lock file)
uxnan-bridge install-service  # (FOR-DEV) configure autostart
```

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
