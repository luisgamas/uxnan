# FOR-DEV — uxnan-bridge

Deferred developer work for the bridge. Each item has a greppable `FOR-DEV:`
marker at its site in the code. (Distinct from `FOR-HUMAN.md`, which tracks assets
only a human can provide.)

## Transport & connectivity (highest priority — next increment)
- [ ] **Secure transport / E2EE handshake** — `src/bridge.ts`. Connect to the relay
      (WebSocket), start the LAN server, perform the handshake
      (clientHello→serverHello→clientAuth→ready) and pump encrypted envelopes
      through `router.dispatchRaw`. Must interoperate byte-for-byte with the
      mobile app (see the transcript contract in `@uxnan/shared` `handshake.ts`).
- [ ] **Outbound buffer & catch-up** — replay messages with `seq > lastApplied`
      on trusted reconnect (caps already in `@uxnan/shared` constants).
- [ ] **Relay package** — build `relay/` and add it back to the root workspaces.

## Identity & security
- [ ] **OS-keychain SecretStore** — `src/secret-store.ts`. Persist the Ed25519
      identity in Windows Credential Manager / macOS Keychain / libsecret. Until
      then the identity is in-memory only (regenerated per run) and real pairing
      is intentionally not possible.

## Handlers (currently stubbed → return `-32000`)
- [ ] **Git** — `src/handlers/git-handler.ts` (`child_process`).
- [ ] **Workspace** — `src/handlers/workspace-handler.ts` (path-traversal safe).
- [ ] **Thread/turn** — `src/handlers/thread-context-handler.ts` (+ JSONL fallback).
- [ ] **Project** — `src/handlers/project-handler.ts`.
- [ ] **Account/auth** — `src/handlers/account-handler.ts` (sanitized, no tokens).
- [ ] **Notifications** — `src/handlers/notifications-handler.ts` (+ add contracts).
- [ ] **Desktop** — `src/handlers/desktop-handler.ts` (embedded mode IPC).
- [ ] **bridge/removeTrustedDevice** — `src/handlers/bridge-control-handler.ts`.
- [ ] **bridge/status `relayConnected`** — reflect the real relay connection.

## Agent adapters (stubbed)
- [ ] **Codex** (MVP) — `src/adapters/codex-adapter.ts`.
- [ ] **OpenCode** (MVP) — `src/adapters/opencode-adapter.ts`.
- [ ] Later: Claude Code, Gemini CLI, pi-agent, Aider.

## Daemon lifecycle & ops
- [ ] **`start` event loop** — `src/cli.ts` (replace the idle wait).
- [ ] **`stop`** — daemon process manager (lock file + IPC) — `src/cli.ts`.
- [ ] **`install-service`** — flesh out `scripts/install-service-*`.
- [ ] **File logging** — `src/logger.ts` (`~/.uxnan/logs/` with rotation + redaction).
- [ ] **Version** — `src/version.ts` (source from package.json at build).

## Contracts to verify
- [ ] **Pairing QR encoding** — confirm `@uxnan/shared` `encodePairingQr` matches
      the mobile `PairingPayload.fromQrString` exactly before enabling pairing.
