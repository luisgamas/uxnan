# Changelog — uxnan-bridge

All notable changes to the bridge daemon are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/). Versioning: [SemVer](https://semver.org/).

## [Unreleased]

### Added — Phase 5b (real OpenCode agent + agent/project selection)
- **OpenCode adapter** (`src/adapters/opencode-adapter.ts`): real agent driven by
  `opencode run --format json`. Spawns one process per turn with stdin closed
  (OpenCode blocks on an open stdin pipe), parses its NDJSON event stream
  (`step_start`/`text`/`step_finish`/`error`), keeps the OpenCode `sessionID` per
  thread for `--session` continuity, and runs in the thread's cwd. The prompt is
  an argv element (`shell:false`) — never shell-interpolated. `resolve-opencode.ts`
  locates the native `opencode.exe` on Windows. OpenCode is now the default agent.
- **Per-thread agent + project selection**: `thread/start` accepts
  `{ agentId, model, cwd }` and persists them; `turn/send` drives the thread's
  agent/model in its cwd. `ProjectRegistry` + real `project/list`/`project/resolve`
  from `config.workspaceRoots` (fallback: the bridge cwd). `agent/list` exposes
  registered agents, capabilities and availability.
- **Config**: `defaultAgent` (now `opencode`), `workspaceRoots`, per-agent
  `agents.<id>.{binaryPath,model}`.
- Tests: OpenCode parser + adapter (delta/complete/error/session continuity),
  `ProjectRegistry`, `agent/list`, project-scoped `thread/start`.

### Added — Phase 7 (ops & packaging)
- **File logging** (`src/logger.ts` `createFileLogger`): daily-rotated logs at
  `~/.uxnan/logs/bridge-YYYY-MM-DD.log` with a secret-redaction pass
  (`redactSecrets`: JWTs, `token=`/`secret=` values, PEM key blocks). `startBridge`
  now logs to file + stderr. Logging never throws.
- **Autostart scripts**: real `scripts/install-service-{windows.ps1,macos.sh,
  linux.sh}` (Task Scheduler / LaunchAgent / systemd user unit).
- **npm packaging**: `repository` + `prepublishOnly` on all packages; publish
  checklist (publish `@uxnan/shared` first, pin the `*` deps) in FOR-DEV.md.

### Added — Phase 5 (conversation engine + agent adapters)
- **Conversation store** (`src/conversation/thread-store.ts`): persistent
  threads → turns → messages in `~/.uxnan/threads.json`, with serialized
  mutations.
- **Real thread/turn handlers** (`thread/list|read|start|resume|fork`,
  `turn/list|read|send|cancel`) replacing the stubs.
- **AgentManager** (`src/agents/agent-manager.ts`): routes `turn/send` to an
  adapter, persists the streamed reply, and broadcasts `stream/*` notifications
  to connected phones.
- **Adapter framework**: `ProcessAgentAdapter` (drives a CLI over newline-JSON
  stdio) and a working `EchoAgentAdapter` reference agent that exercises the full
  turn pipeline end-to-end. Codex/OpenCode are `ProcessAgentAdapter` subclasses
  (metadata only — their real CLI protocol is FOR-DEV) and are not wired by
  default; only `echo` is registered.
- Tests: thread-store CRUD/pagination, AgentManager + echo end-to-end,
  ProcessAgentAdapter against a fake agent, and a router-level
  `thread/start` → `turn/send` flow.

### Added — Phase 4b (workspace checkpoints)
- `workspace/checkpoint`, `workspace/diffCheckpoint`, `workspace/applyCheckpoint`
  (`src/workspace/checkpoint-service.ts`). A checkpoint snapshots the whole
  working tree — tracked changes AND untracked files — without touching the
  user's index (temp `GIT_INDEX_FILE` + `commit-tree`), anchored under
  `refs/uxnan/checkpoints/<id>` and recorded in `~/.uxnan/checkpoints.json`.
  `diff` returns the unified diff + per-file status; `apply` restores file
  contents via `git restore`. Unknown ids → `-32008`.
- Limitations (see FOR-DEV.md): `apply` restores contents but does not delete
  files created after the checkpoint; snapshot commits use a fixed internal
  identity and are never pushed.

### Added — Phase 4 (real Git + Workspace handlers)
- **Git handlers** (`src/git/`): `git/status`, `git/diff`, `git/commit`,
  `git/push`, `git/pull`, `git/checkout`, `git/createBranch`,
  `git/createWorktree`, run via `child_process.execFile` (no shell → no command
  injection). Failures map to `-32003 GitOperationFailed`; git output is stripped
  of the project cwd and home dir before being sent to the phone.
- **Workspace handlers** (`src/workspace/`): `workspace/readFile` (utf-8 or
  base64 for binaries), `workspace/readImage`, `workspace/list`,
  `workspace/applyPatch`. All access is **confined to the project root**
  (path-traversal → `-32004 WorkspaceAccessDenied`), the `.git` directory and
  sensitive files (`.env`, keys, credentials) are denied/excluded, and returned
  paths are relative — never absolute (§5.8.9). Read size caps: 5 MB / 10 MB.
- Untrusted-param validators (`src/handlers/params.ts`) reject bad types and
  option-injection (leading `-`) in git refs/paths.

### Added — Phase 3 (identity persistence + pairing hardening)
- **OS-keychain identity persistence** (`KeyringSecretStore`) via the optional
  `@napi-rs/keyring` native module (Windows Credential Manager, macOS Keychain,
  Linux Secret Service). `createDefaultSecretStore()` uses it by default and
  falls back to an in-memory store (with a warning) when the keychain is
  unavailable, so the daemon still runs. The Ed25519 identity now survives
  restarts — a prerequisite for real pairing.
- **Single-instance lock** (`LockFile`, `~/.uxnan/bridge.lock`): `start` refuses
  to launch if another live daemon holds the lock; stale locks (dead pid) are
  taken over. `stop` reads the lock and signals the running daemon (SIGTERM).
- Pairing QR now matches the mobile contract end-to-end (Base64 JSON; the fix
  lives in `@uxnan/shared`).

### Added — Phase 2b (bridge → phone notifications + outbound buffer)
- `SessionRegistry`: tracks the live encrypted sink per connected device so the
  bridge can push JSON-RPC notifications (e.g. streamed agent events).
- `OutboundMessageBuffer`: sliding-window buffer (spec caps
  MAX_BRIDGE_OUTBOUND_MESSAGES / _BYTES) for messages sent while a device is
  offline; flushed in FIFO order on (re)connect.
- `bridge.notify(deviceId, method, params)` and `BridgeContext.sessionRegistry`
  for handlers/managers to push to a phone; returns whether it was sent live or
  buffered.
- Tests: buffer eviction caps, registry buffer→flush, and an end-to-end
  `bridge.notify` delivered to and decrypted by a connected phone.

### Clarified
- `mac` / `iphone` are protocol ROLE names, not platforms. The bridge and relay
  run on Windows, macOS and Linux (developed/tested on Windows); the mobile role
  covers Android and iOS.

### Added — Phase 2 (live E2EE transport + relay)
- **Secure transport** (`src/transport/`) implementing the bridge (server) side
  of the E2EE protocol, interoperable byte-for-byte with the mobile app:
  - `crypto.ts`: X25519 + HKDF-SHA256 key derivation, AES-256-GCM
    encrypt/decrypt, Ed25519 verification — all via `node:crypto` (no external
    crypto deps).
  - `server-handshake.ts`: clientHello → serverHello → clientAuth → ready, with
    transcript signing/verification and `qr_bootstrap` / `trusted_reconnect`.
  - `secure-channel.ts`: AES-256-GCM envelopes with 1-based outbound seq and
    replay-protected inbound seq.
  - `session-handler.ts`: decrypts envelopes, dispatches JSON-RPC through the
    router, returns encrypted responses.
  - `relay-client.ts` / `lan-server.ts`: live `ws` transports (relay `mac`
    connection and direct-LAN server), adapted via a shared `MessageIO`.
  - `trust-store.ts`: trusted-phone persistence (`trusted-phones.json`),
    written on `qr_bootstrap` and read by `bridge/trustedDevices`.
- `startBridge` now exposes `connectRelay(sessionId)` and `startLan()`; the CLI
  `start` boots the LAN server and connects to the relay for a pairing session.
- Depends on the new `uxnan-relay` package for end-to-end tests.
- Tests: crypto round-trips, secure-channel replay/seq, an in-memory two-party
  handshake, a real-WebSocket LAN exchange, and a full phone ↔ relay ↔ bridge
  end-to-end (handshake + encrypted `bridge/status`). 33 bridge tests total.

### Added — Phase 1 (skeleton)
- Initial bridge daemon **skeleton** (TypeScript, ESM, Node ≥18).
- Daemon state under `~/.uxnan/` with atomic JSON writes (`DaemonState`) and
  config defaults/merge (`DaemonConfig`, `resolveDaemonConfig`).
- Ed25519 identity (`SecureDeviceState`) with a pluggable `SecretStore`
  (in-memory implementation) and message signing.
- JSON-RPC `HandlerRouter` with envelope validation and typed error mapping
  (unknown → -32601, malformed → -32600, `RpcError` → its code, other → -32603).
- Real bridge-control handlers (`bridge/status`, `bridge/generatePairingQr`,
  `bridge/connectedPhones`, `bridge/trustedDevices`, `bridge/disconnectPhone`).
- Stub handlers for git/workspace/thread/project/account domains (clear,
  greppable `FOR-DEV` not-implemented errors).
- Pairing QR generation (`generatePairingPayload`, `renderPairingQr`).
- Agent adapter base class plus Codex and OpenCode stubs.
- `uxnan-bridge` CLI: `start`, `status`, `qr`, `stop`, `install-service`, `help`.
- In-memory session registry, bridge status snapshot, leveled logger.
- Tests (node:test): daemon state, identity (sign/verify), router, QR, and an
  end-to-end `startBridge` wiring test.

### Deferred (see FOR-DEV.md)
- Outbound buffer + catch-up on reconnect; key rotation / epoch advance.
- OS-keychain-backed identity persistence (required before real pairing).
- Real git/workspace/thread/account handlers and Codex/OpenCode adapters.
- Daemon process manager (`stop`), autostart scripts, file logging.
- Relay hardening (rate limiting, pairing-code resolution, push endpoints).

### Notes
- Built on TypeScript (the architecture sketches `.js`); same file names, `.ts`
  sources compiled to `dist/`. Justified by end-to-end type-safety with the
  `@uxnan/shared` contracts.
- The bridge identity is in-memory only this increment, so no secret is written
  to disk in plaintext (per AGENTS.md security rules).
