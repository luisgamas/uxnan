# FOR-DEV — uxnan-bridge

Deferred developer work for the bridge. Each item has a greppable `FOR-DEV:`
marker at its site in the code. (Distinct from `FOR-HUMAN.md`, which tracks assets
only a human can provide.)

> **How to run/validate everything** (automated tests, real-mobile E2EE interop,
> adapter wiring, contract re-checks) is in [`../TESTING.md`](../TESTING.md).
> Each deferred item below says what to build; TESTING.md says how to test it.

## Plug-and-play "install and use" — remaining sequence
The goal is: install on the PC, log into the agents you want, point the phone at a
folder, and go. Tracked items, in order:
1. **Directory browsing** — DONE (bridge side: `workspace/browseDirs`); the mobile
   browser UI is the remaining half (see Handlers → Plug-and-play below).
2. **Autostart / `install-service`** — finish wiring the CLI to the platform scripts
   so the bridge runs on login without an open terminal (see Daemon lifecycle).
3. **Packaging / publish** — bundle `@uxnan/shared` (or publish it first) and ship
   the bridge as `npm i -g uxnan-bridge` / a single binary (see Packaging).
Remote access (off-LAN) needs a hosted relay; **LAN-only works today with zero
hosting** (the phone connects directly to the bridge on the same network).

## Transport & connectivity
- [x] **Secure transport / E2EE handshake** — `src/transport/` (Phase 2). Relay
      `mac` client + LAN server, handshake, AES-256-GCM channel; interoperable
      byte-for-byte with the mobile app.
- [x] **Relay package** — `relay/` builds and is in the root workspaces (Phase 2).
- [x] **Bridge → phone notifications** (Phase 2b) — `SessionRegistry` +
      `bridge.notify()`; offline messages buffered via `OutboundMessageBuffer`.
- [x] **Stable pairing session** — the pairing `sessionId` is persisted to
      `~/.uxnan/pairing-session.json` (`src/bridge.ts`, `daemon-state.ts`) and
      reused across restarts instead of a fresh UUID each boot.
- [x] **Relay connection survives phone reconnects** — `connectRelay`
      (`src/bridge.ts`) runs a background loop: serve one phone session, then
      immediately re-arm on the relay so trusted-reconnect works without re-scanning.
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
- [x] **Plug-and-play directory browsing (bridge side)** — `workspace/browseDirs`
      (`src/workspace/browse-service.ts` + `workspace-handler.ts`) lets the phone
      browse sub-directories under a configured base root (`config.browseRoots`,
      falling back to `workspaceRoots` → home), mark which are git repos, and pick
      ANY directory as a thread's cwd (`thread/start { cwd }`) — no per-project
      pre-config. Root-confined via `resolveWithinRoot`. `project/list`/`resolve`
      (the manual `workspaceRoots` list) stay as-is for explicitly configured
      projects. **Next steps (deja en FOR-DEV):**
        - **Mobile UI** (uxnanmobile branch): a directory-browser screen that calls
          `workspace/browseDirs`, shows the root picker + git-repo badges, navigates
          with `parent`/`dirs`, and opens a thread on the chosen `cwd`.
        - **Hard agent confinement** (optional): browseDirs confines the *phone API*,
          not the agent *process*. True read-confinement of the agent to the chosen
          subtree needs OS sandboxing (container/chroot) — out of MVP scope; for now
          writes are bounded by each agent's sandbox posture (Codex `workspace-write`,
          Claude `acceptEdits`). See FOR-HUMAN.md.
- [ ] **Per-project agent selection from `AgentConfig`** — the shared
      `AgentConfig` (`agentId`, `binaryPath`, `extraArgs`, `cwd`) is defined but
      not consumed: `thread/start` currently takes an explicit `agentId/model/cwd`.
      Resolve the default agent/model per project (from config) so a project can
      pin its own agent without the phone passing it every time.
- [ ] **Thread management** — `thread/archive` / `thread/delete` / `thread/rename`
      (`thread-context-handler.ts` + `thread-store.ts`); not yet contracted/wired.
- [ ] **Account/auth** — `src/handlers/account-handler.ts` (sanitized, no tokens).
- [x] **Notifications** — `src/handlers/notifications-handler.ts` +
      `src/push/push-service.ts`. `notifications/register|update|unregister` wired;
      registers the token with the relay and pushes on turn-end (gated by
      `config.push*` + Firebase creds on the relay). Follow-ups: persist the
      registration to `~/.uxnan/push-state.json`; support multiple sessions.
- [ ] **Desktop** — `src/handlers/desktop-handler.ts` (embedded mode IPC).
- [ ] **bridge/removeTrustedDevice** — `src/handlers/bridge-control-handler.ts`.
- [ ] **bridge/status `relayConnected`** — reflect the real relay connection.

## Agent adapters
- [x] **Framework + reference** (Phase 5) — `ProcessAgentAdapter` (generic CLI
      stdio driver) + working `EchoAgentAdapter`; `AgentManager` orchestration.
- [x] **OpenCode** (MVP) — `src/adapters/opencode-adapter.ts`. WIRED and the
      bridge's default agent. Spawns `opencode run --format json` per turn,
      parses the NDJSON event stream, keeps the OpenCode `sessionID` per thread
      for `--session` continuity, runs in the thread's cwd. Picks the model from
      `service` (per-turn) → thread.model → `config.agents.opencode.model`.
      Binary resolved by `resolve-opencode.ts` (native `opencode.exe` on Windows).
- [x] **Per-thread agent selection** — `thread/start { agentId, model, cwd }`
      persists the choice; `turn/send` drives the thread's agent in its cwd.
      `agent/list` exposes registered agents + capabilities + availability.
- [x] **Agent model discovery** — `agent/models` runs `opencode models` via
      `OpenCodeAdapter.listModels()` → `AgentManager.getModels()` (optional
      `IAgentAdapter.listModels`; agents without it return `[]`).
- [x] **Change a thread's model mid-conversation** — `thread/setModel`
      (`ThreadStore.setModel` + `thread-context-handler.ts`).

### Adding the next agent (recipe — do these one by one)
The OpenCode adapter is the template for any "one-shot per-turn CLI" agent:
1. Run the real CLI by hand once and capture a turn's machine-readable stream
   (`<cli> ... --json|--format json`). **Watch for stdin:** OpenCode hangs on an
   open stdin pipe — spawn with `stdio:['ignore','pipe','pipe']`.
2. Copy `opencode-adapter.ts`; adjust the args builder (`run/exec`, model flag,
   session/continue flag, cwd flag) and `parseLine` for that CLI's event shape.
   Keep `shell:false` and pass the prompt as an argv element (no injection).
3. Register it in `startBridge` with display metadata + availability.
- [x] **Codex** — `src/adapters/codex-adapter.ts`. WIRED via `codex exec --json`
      (`exec resume <thread_id>` for continuity, `-m` model, `-C` cwd, always
      `--skip-git-repo-check`). Parses the JSONL stream (`thread.started` /
      `item.completed` `agent_message` / `turn.completed` / `turn.failed`), keeps
      the `thread_id` per thread. Sandbox posture is configurable via
      `agents['codex'].permissionMode` (default `acceptEdits` → `-s workspace-write`;
      also `default` → `-s read-only`, `bypassPermissions` →
      `--dangerously-bypass-approvals-and-sandbox`). Binary resolved by
      `resolve-codex.ts` (npm `@openai/codex/bin/codex.js` via node → PATH).
      **`codex-server` is NOT needed**: Codex's `app-server`/`exec-server`/
      `mcp-server` modes drive the desktop app / IDE / MCP — the bridge uses the
      one-shot `codex exec` entry point. No model-list command, so `agent/models`
      returns `[]` for Codex (use the default model or set `agents.codex.model`).
- [x] **Claude Code** — `src/adapters/claude-adapter.ts`. WIRED via
      `claude -p --output-format stream-json --verbose --include-partial-messages`
      (`--resume <session_id>`, `--model <alias|id>`). Parses the JSONL stream
      (`system`/`stream_event` `text_delta`/`assistant`/`result`), keeps the
      `session_id` per thread, runs in the thread's cwd. Headless permission
      posture is configurable via `agents['claude-code'].permissionMode`
      (default `acceptEdits`; also `default` / `bypassPermissions`). Binary
      resolved by `resolve-claude.ts` (native `~/.local/bin/claude[.exe]` → npm
      `cli.js` via node → PATH). `listModels()` returns the `opus`/`sonnet`/`haiku`
      aliases (no enumerate command). Follow-up: richer model discovery if a
      stable source appears.
- [ ] **Gemini CLI** — capture its non-interactive JSON stream first. New scaffold.
- [ ] **JSONL history fallback** (`session-jsonl-history`) — read agent session
      JSONL/SQLite from disk for `turn/list` when the runtime has no fresh data
      (§5.8.8). Needs each agent's real on-disk format.
- [ ] Later: pi-agent, Aider.

## Daemon lifecycle & ops
- [x] **Single-instance lock + `stop`** (Phase 3) — `src/lock-file.ts`,
      `src/cli.ts` (`bridge.lock` + SIGTERM).
- [~] **`install-service` / autostart (so the terminals don't need to stay open)**
      — scripts exist (`scripts/install-service-{windows.ps1,macos.sh,linux.sh}`),
      but the CLI command only prints their paths. TO FINISH + recommended SECURE
      design (run as the logged-in user, NEVER elevated — the Ed25519 identity is
      already per-user in the OS keychain, so no root/SYSTEM is needed):
        - **Windows:** a **Task Scheduler** task `At log on` for the current user
          (`schtasks /Create /SC ONLOGON /RL LIMITED`), running
          `node <path>/cli.js start` (or the packed `uxnan-bridge start`). LIMITED
          run level = the user's normal token, no admin.
        - **macOS:** a **LaunchAgent** plist in `~/Library/LaunchAgents/`
          (`RunAtLoad` + `KeepAlive`), loaded with `launchctl` — runs as the user,
          not a root LaunchDaemon.
        - **Linux:** a **systemd `--user`** unit (`~/.config/systemd/user/`,
          `systemctl --user enable --now`) + `loginctl enable-linger` so it
          survives logout. User scope, no system unit.
      Wire the CLI to invoke the right script per `process.platform`, add an
      `uninstall-service`, and keep the **relay** similarly autostartable (or use
      the deployed relay) — both the relay and bridge must be running for the
      phone to (re)connect. Security notes: bind the LAN server to the LAN iface
      only, keep logs redacted (done), never run elevated.
- [x] **File logging** (Phase 7) — `src/logger.ts` `createFileLogger`
      (`~/.uxnan/logs/bridge-YYYY-MM-DD.log`, daily rotation + secret redaction).
      Follow-up: size-based rotation + retention/pruning of old log files.
- [ ] **Version** — `src/version.ts` (source from package.json at build).

## Packaging (Phase 7 — npm publish readiness)
- [x] `bin`, `files`, `engines`, `repository`, `prepublishOnly: tsc` set on all
      three packages.
- [ ] **Before `npm publish`:** publish `@uxnan/shared` first, then change the
      bridge/relay dep `"@uxnan/shared": "*"` → the real `"^0.x"` version (the `*`
      workspace spec does NOT resolve from the public registry). Same for the
      bridge's `"uxnan-relay": "*"` devDependency (drop it or pin it; it's only
      used by the e2e test).
- [ ] Verify a packed install end-to-end: `npm pack` each package, then
      `npm install -g ./uxnan-bridge-*.tgz` and run `uxnan-bridge qr`.
- [ ] Ensure the `scripts/*.sh` keep their executable bit when published
      (npm preserves mode; verify on a packed tarball).

## Relay hardening
- [x] **Per-IP rate limiting** (Phase 3) — `relay/src/relay-server.ts`.
- [ ] **Pairing-code resolution** (`/trusted-session/resolve`) and **multi-session
      `mac` registration** — need protocol/mobile coordination (§5.10.1).
- [ ] **Push endpoints** (`/push/*`, APNs/FCM) — Phase 6.

## Contracts verified
- [x] **Pairing QR encoding** — `@uxnan/shared` now emits Base64 JSON matching the
      mobile `PairingPayload.fromQrString` (Phase 3).
