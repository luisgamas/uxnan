# FOR-DEV — uxnan-bridge

Deferred developer work for the bridge. Each item has a greppable `FOR-DEV:`
marker at its site in the code. (Distinct from `FOR-HUMAN.md`, which tracks assets
only a human can provide.)

## Transport & connectivity
- [x] **Secure transport / E2EE handshake** — `src/transport/` (Phase 2). Relay
      `mac` client + LAN server, handshake, AES-256-GCM channel; interoperable
      byte-for-byte with the mobile app.
- [x] **Relay package** — `relay/` builds and is in the root workspaces (Phase 2).
- [x] **Bridge → phone notifications** (Phase 2b) — `SessionRegistry` +
      `bridge.notify()`; offline messages buffered via `OutboundMessageBuffer`.
- [ ] **Seq-based catch-up on reconnect** — `src/transport/server-handshake.ts`.
      Read `clientHello.resumeState.lastAppliedBridgeOutboundSeq` and replay
      envelopes with a greater `seq`. **Blocked:** the mobile `clientHello` does
      not send `resumeState` yet — coordinate with the mobile side first.
- [ ] **Key rotation / keyEpoch advance** — blocked on a mobile trigger.

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
