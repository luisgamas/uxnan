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
- [x] **OS-keychain SecretStore** (Phase 3) — `src/keyring-secret-store.ts` via
      `@napi-rs/keyring`, with in-memory fallback. NOTE: on headless Linux without
      a running Secret Service it falls back to in-memory (no persistence) — wire a
      CI/service alternative there before relying on persistence on Linux.

## Handlers
- [x] **Git** (Phase 4) — `src/git/` + `src/handlers/git-handler.ts`.
- [x] **Workspace** reads/list/applyPatch (Phase 4) — `src/workspace/`.
- [x] **Workspace checkpoints** (Phase 4b) — `src/workspace/checkpoint-service.ts`
      (full-tree snapshot via temp index + `commit-tree`, anchored ref + metadata).
      Follow-ups still needed:
        - `apply` restores contents but does NOT delete files created after the
          checkpoint — implement a true restore (diff current vs snapshot, remove
          extras) for full revert parity with the mobile `AiChangeSet` revert.
        - prune/GC old checkpoint refs + `checkpoints.json` entries (TTL or count
          cap) so `refs/uxnan/checkpoints/*` doesn't grow unbounded.
        - checkpoints require at least one commit (no HEAD → `-32003`); consider
          supporting checkpoints on an unborn branch if a use case appears.
- [x] **Thread/turn** (Phase 5) — `src/handlers/thread-context-handler.ts` +
      `src/conversation/thread-store.ts` + `src/agents/agent-manager.ts`.
- [ ] **Project** — `src/handlers/project-handler.ts`.
- [ ] **Account/auth** — `src/handlers/account-handler.ts` (sanitized, no tokens).
- [ ] **Notifications** — `src/handlers/notifications-handler.ts` (+ add contracts).
- [ ] **Desktop** — `src/handlers/desktop-handler.ts` (embedded mode IPC).
- [ ] **bridge/removeTrustedDevice** — `src/handlers/bridge-control-handler.ts`.
- [ ] **bridge/status `relayConnected`** — reflect the real relay connection.

## Agent adapters
- [x] **Framework + reference** (Phase 5) — `ProcessAgentAdapter` (generic CLI
      stdio driver) + working `EchoAgentAdapter`; `AgentManager` orchestration.
- [ ] **Codex** (MVP) — `src/adapters/codex-adapter.ts`. Scaffolded as a
      `ProcessAgentAdapter` subclass but NOT wired: override `formatTurn`/`parseLine`
      to translate the real Codex CLI invocation + streaming output (its
      `exec`/proto JSON) into the bridge agent IPC, then register it in
      `startBridge`. **Needs the real Codex CLI contract (not in the arch docs).**
- [ ] **OpenCode** (MVP) — `src/adapters/opencode-adapter.ts`. Same as Codex,
      for OpenCode's stream/SQLite output. **Needs the real OpenCode contract.**
- [ ] **JSONL history fallback** (`session-jsonl-history`) — read agent session
      JSONL/SQLite from disk for `turn/list` when the runtime has no fresh data
      (§5.8.8). Needs each agent's real on-disk format.
- [ ] **Per-project agent selection** — resolve the agent from the project's
      `AgentConfig` instead of `AgentManager`'s single `defaultAgent: 'echo'`.
- [ ] Later: Claude Code, Gemini CLI, pi-agent, Aider.

## Daemon lifecycle & ops
- [x] **Single-instance lock + `stop`** (Phase 3) — `src/lock-file.ts`,
      `src/cli.ts` (`bridge.lock` + SIGTERM).
- [ ] **`install-service`** — flesh out `scripts/install-service-*`.
- [ ] **File logging** — `src/logger.ts` (`~/.uxnan/logs/` with rotation + redaction).
- [ ] **Version** — `src/version.ts` (source from package.json at build).

## Relay hardening
- [x] **Per-IP rate limiting** (Phase 3) — `relay/src/relay-server.ts`.
- [ ] **Pairing-code resolution** (`/trusted-session/resolve`) and **multi-session
      `mac` registration** — need protocol/mobile coordination (§5.10.1).
- [ ] **Push endpoints** (`/push/*`, APNs/FCM) — Phase 6.

## Contracts verified
- [x] **Pairing QR encoding** — `@uxnan/shared` now emits Base64 JSON matching the
      mobile `PairingPayload.fromQrString` (Phase 3).
