# uxnan-bridge

Local control-plane daemon that connects the Uxnan mobile app to the developer's
PC over an end-to-end-encrypted channel. It runs Git, reads the workspace, and
drives AI coding agents on behalf of the phone, routing JSON-RPC methods to
per-domain handlers.

> **Status: Phase 1 skeleton.** The daemon core (state, identity, JSON-RPC
> router, CLI) is in place. The live relay/LAN transport, the E2EE handshake and
> the real handlers/agent adapters are deferred — see [FOR-DEV.md](./FOR-DEV.md).

## Install (later, as a global package)

```bash
npm install -g uxnan-bridge
```

## CLI

```bash
uxnan-bridge start            # start the daemon core (no live transport yet)
uxnan-bridge status           # print current status as JSON
uxnan-bridge qr               # print the pairing QR in the terminal
uxnan-bridge stop             # (FOR-DEV) stop a running daemon
uxnan-bridge install-service  # (FOR-DEV) configure autostart
```

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
