# Changelog — uxnan-bridge

All notable changes to the bridge daemon are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/). Versioning: [SemVer](https://semver.org/).

## [Unreleased]

### Added — direct LAN/Tailscale transport (relay now optional)
- **Advertise direct addresses in the pairing QR**: `src/transport/local-hosts.ts`
  enumerates the bridge's non-internal IPv4s (LAN + a Tailscale `100.x` address) and
  `generatePairingQr` includes them as `hosts`. The phone tries these first and
  falls back to the relay. Verified on a real machine (QR carried the LAN + Tailscale
  addresses).
- **`relayEnabled` config** (`daemon-config.ts`, default `true`): set `false` for a
  pure LAN/Tailscale setup — the bridge skips the relay connection and the QR carries
  only `hosts`. `cli.ts start` prints the direct addresses and only dials the relay
  when enabled.
- This makes **LAN-direct the primary plug-and-play path**, **Tailscale (or any mesh
  VPN) the recommended remote option with no hosting**, and the **hosted relay
  optional**. Docs: [`docs/connectivity.md`](docs/connectivity.md).
- Tests: `localHostPorts` enumeration; QR includes/omits `hosts`/`relay`; shared
  pairing validation for the optional-transport contract.

### Added — autostart (install-service / uninstall-service)
- **`uxnan-bridge install-service` / `uninstall-service`** (`src/service-installer.ts`
  + `src/cli.ts`): register the bridge to start at user logon, **as the logged-in
  user and never elevated** (`node <cli.js> start`; works for a global install or a
  dev checkout). Per platform: Windows Task Scheduler logon task (`/SC ONLOGON /RL
  LIMITED`) with a **hidden Startup-folder `.vbs` fallback** when Task Scheduler is
  denied (restricted accounts/policy — no admin, no console window); macOS LaunchAgent
  (`RunAtLoad`+`KeepAlive`); Linux systemd `--user` unit. `buildServicePlan` is pure
  (unit-tested per platform); execution uses `execFile` (no shell). Validated
  end-to-end on Windows (Task-Scheduler-denied → Startup `.vbs` launches node hidden).
- Tests: per-platform plan shape + the Windows Startup fallback launcher.

### Added — plug-and-play directory browsing
- **`workspace/browseDirs`** (`src/workspace/browse-service.ts` +
  `src/handlers/workspace-handler.ts`): the phone navigates sub-directories under a
  configured base root (e.g. `Documents`), sees which are git repos, and picks ANY
  directory (git or not) as a thread's cwd — no per-project pre-configuration. The
  result includes the list of configured roots (for a root picker), the current
  path/parent (`parent` is `null` at the root — the phone cannot go above it), the
  absolute `cwd` to pass to `thread/start`, and the sub-directories. Confinement
  reuses `resolveWithinRoot` (rejects `..`/absolute escapes; excludes `.git` and
  sensitive names).
- **Config `browseRoots`** (`daemon-config.ts`): absolute base dirs the phone may
  browse; falls back to `workspaceRoots`, then the user's home directory. Exposed
  on `BridgeContext.browse` (`BrowseService`).
- **Security note:** this confines the phone-facing browse/workspace API, NOT the
  agent process — once a directory is chosen, the agent CLI runs there and acts on
  that subtree (writes bounded by each agent's sandbox posture). Documented in
  `FOR-HUMAN.md`.
- Tests: `BrowseService` (root listing, git-repo marking, `.git`/sensitive
  exclusion, descend path/parent/cwd, escape rejection, unknown-root rejection,
  empty-roots fallback).

### Added — Codex agent
- **Codex adapter** (`src/adapters/codex-adapter.ts`): real agent driven by
  `codex exec --json`. Spawns one process per turn with stdin closed (Codex blocks
  on an open stdin pipe), parses its JSONL event stream (`thread.started` /
  `item.completed` `agent_message` / `turn.completed` / `turn.failed`) into bridge
  events, keeps Codex's `thread_id` per thread for `exec resume <id>` continuity,
  and runs in the thread's cwd (`-C`). The prompt is an argv element
  (`shell:false`) — never shell-interpolated. Always passes `--skip-git-repo-check`
  so a thread can run in any directory. Codex emits complete `agent_message` items
  (no token deltas), so each is streamed as one chunk; `turn.completed` finalizes,
  `turn.failed` surfaces as a turn error. Resume continuity validated live against
  `codex-cli` 0.137.
- **Binary resolution** (`src/adapters/resolve-codex.ts`): runs the npm
  `@openai/codex/bin/codex.js` entry via `node` (keeps `shell:false`; the entry
  locates the right native binary), or the `codex` launcher on PATH.
- **Configurable headless sandbox posture** (reuses `AgentSettings.permissionMode`):
  `acceptEdits` (default — `-s workspace-write`), `default` (`-s read-only`), or
  `bypassPermissions` (`--dangerously-bypass-approvals-and-sandbox`).
- Codex is registered in `startBridge` alongside OpenCode and Claude Code and
  exposed via `agent/list`; no shared-contract or mobile change was needed (the
  `'codex'` AgentId already existed). Codex's `app-server`/`exec-server`/
  `mcp-server` modes are **not** used — `codex exec` is the one-shot entry point.
- Tests: Codex parser + adapter (delta/complete/error/thread resume, sandbox-flag
  mapping).

### Added — Claude Code agent
- **Claude Code adapter** (`src/adapters/claude-adapter.ts`): real agent driven by
  `claude -p --output-format stream-json --verbose --include-partial-messages`.
  Spawns one process per turn with stdin closed, parses its JSONL event stream
  (`system`/`stream_event` `content_block_delta` `text_delta`/`assistant`/`result`)
  into bridge events, keeps Claude's `session_id` per thread for `--resume`
  continuity, and runs in the thread's cwd. The prompt is an argv element
  (`shell:false`) — never shell-interpolated. Token deltas stream from
  `text_delta`; if no partials arrive, the complete `assistant` message is emitted
  as one chunk; the terminal `result` carries the authoritative final text (or
  surfaces `is_error` as a turn error). `listModels()` exposes the stable `--model`
  aliases (`opus`/`sonnet`/`haiku`) since Claude Code has no enumerate command.
- **Binary resolution** (`src/adapters/resolve-claude.ts`): prefers the native
  installer binary at `~/.local/bin/claude[.exe]`, then the npm-global
  `@anthropic-ai/claude-code/cli.js` run via `node` (keeps `shell:false`), then the
  `claude` launcher on PATH.
- **Configurable headless permission posture** (`AgentSettings.permissionMode`):
  `acceptEdits` (default — file edits auto-apply, other tools stay gated),
  `default` (no flag), or `bypassPermissions` (`--dangerously-skip-permissions`).
- Claude Code is registered in `startBridge` alongside OpenCode and exposed via
  `agent/list` / `agent/models`; no shared-contract or mobile change was needed
  (the `'claude-code'` AgentId already existed).
- Shared spawn helper extracted to `src/adapters/spawn.ts` (reused by the OpenCode
  and Claude Code adapters).
- Tests: Claude parser + adapter (delta/complete/error/session continuity,
  assistant-message fallback, permission-flag mapping, model aliases).

### Changed — test runner
- `npm test` now runs with `--test-concurrency=1` (serialized) to avoid
  CPU-starvation flakes in the bridge end-to-end tests on Windows: several suites
  boot a full bridge and/or spawn real child processes (git, fake agents), and
  running them in parallel starved the conversation tests' `waitFor` polling. The
  `waitFor` guards were also raised to 30s as a backstop.

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
- **Agent model discovery**: `agent/models` runs `opencode models` and parses the
  provider/model ids (`OpenCodeAdapter.listModels()` → `AgentManager.getModels()`;
  `IAgentAdapter.listModels` is optional, returns `[]` for agents without it).
- **Change a thread's model mid-conversation**: `thread/setModel`
  (`ThreadStore.setModel` + `thread-context-handler.ts`) repoints the thread's
  `model`; subsequent `turn/send`s use it.
- **Config**: `defaultAgent` (now `opencode`), `workspaceRoots`, per-agent
  `agents.<id>.{binaryPath,model}`.
- Tests: OpenCode parser + adapter (delta/complete/error/session continuity),
  `ProjectRegistry`, `agent/list`, project-scoped `thread/start`.

### Added — Phase 6 (push notifications, gated)
- **Push bridge** (`src/push/push-service.ts`): `notifications/register|update|
  unregister` handlers (`src/handlers/notifications-handler.ts`) register the FCM
  token with the relay; `AgentManager`'s `onTurnEnd` hook pushes a turn-end
  notification, and `session-handler.ts` marks the active relay session as the
  push target. End-to-end push stays **gated** behind relay-side Firebase creds
  (`config.push*`); the bridge no-ops cleanly without them. Follow-ups (FOR-DEV):
  persist the registration to `~/.uxnan/push-state.json`; multi-session support.

### Changed
- **Stable pairing session** (`src/bridge.ts`, `daemon-state.ts`): the pairing
  `sessionId` is persisted to `~/.uxnan/pairing-session.json` and reused across
  restarts (was a fresh UUID each boot), so a trusted phone keeps reconnecting to
  the same session.
- **Relay connection stays alive across phone reconnects** (`connectRelay` in
  `src/bridge.ts`): a background loop serves one phone session, then immediately
  re-arms on the relay — trusted-reconnect works without re-scanning a QR.

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
