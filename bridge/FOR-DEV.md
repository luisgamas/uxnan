# FOR-DEV — uxnan-bridge

Deferred developer work for the bridge. Each item has a greppable `FOR-DEV:`
marker at its site in the code. (Distinct from `FOR-HUMAN.md`, which tracks assets
only a human can provide.)

> **How to run/validate everything** (automated tests, real-mobile E2EE interop,
> adapter wiring, contract re-checks) is in [`docs/testing.md`](docs/testing.md).
> Each deferred item below says what to build; that doc says how to test it.
> Install/config/agents/deploy docs are alongside it in [`docs/`](docs/).

## Plug-and-play "install and use" — remaining sequence
The goal is: install on the PC, log into the agents you want, point the phone at a
folder, and go. Tracked items, in order:
1. **Directory browsing** — DONE (bridge `workspace/browseDirs` **and** the mobile
   browser UI: a `WorkspaceBrowserSheet` with root picker / breadcrumb / git-repo
   badges wired into the new-conversation flow → `thread/start { cwd }`). See
   Handlers → Plug-and-play below.
2. **Autostart / `install-service`** — DONE (`install-service`/`uninstall-service`
   run the bridge at logon per platform; see Daemon lifecycle).
3. **Packaging / publish** — bundle `@uxnan/shared` (or publish it first) and ship
   the bridge as `npm i -g uxnan-bridge` / a single binary (see Packaging). NEXT.
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
- [x] **Direct LAN/Tailscale addressing (relay optional)** —
      `src/transport/local-hosts.ts` advertises the bridge's non-internal IPv4s
      (LAN + Tailscale `100.x`) as `hosts` in the pairing QR; `relay` is optional in
      the contract; `relayEnabled` config skips the relay for a pure direct setup.
      LAN-direct is the primary path, Tailscale the recommended remote option (no
      hosting), relay optional. See `docs/connectivity.md`. **Next steps:**
        - **Mobile (uxnanmobile branch):** consume `hosts` — try the direct
          addresses first, fall back to `relay`; tolerate a missing `relay` (the
          current Dart parser requires it). This is the half that makes direct/
          Tailscale actually used by the app.
        - **Bind the LAN server to chosen interface(s)** — today it binds all
          interfaces (good for Tailscale; advertise virtual-NIC IPs too). Optionally
          let the user restrict which interfaces are served/advertised.
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
      projects. **Status / next steps:**
        - **Mobile UI** — DONE (uxnanmobile): `WorkspaceBrowserSheet` calls
          `workspace/browseDirs`, shows the root picker + git-repo badges, navigates
          with `parent`/`dirs`, and opens a thread on the chosen `cwd` (resolved to
          a project via `project/resolve`). Remaining: on-device verification.
        - **Hard agent confinement** (optional): browseDirs confines the *phone API*,
          not the agent *process*. True read-confinement of the agent to the chosen
          subtree needs OS sandboxing (container/chroot) — out of MVP scope; for now
          writes are bounded by each agent's sandbox posture (Codex `workspace-write`,
          Claude `acceptEdits`). See FOR-HUMAN.md.
- [x] **Per-project agent selection from `AgentConfig`** — a `projectAgents:
      AgentConfig[]` config (keyed by each entry's absolute `cwd`) pins a
      project's default `agentId`/`model`. `ProjectRegistry` consumes it
      (`agentConfigFor(cwd)` + the pin surfaced on `Project.agentId`/`model`), and
      `thread/start` falls back to the pinned agent → global `defaultAgent` when
      the phone omits `agentId`; the pinned model applies only when the resolved
      agent matches the pin. **Still not consumed:** `AgentConfig.binaryPath` /
      `extraArgs` (per-project binary/arg overrides) — wire them into the adapter
      spawn if a use case appears. **Mobile linkage (no uxnanmobile change
      required):** `project/list`/`resolve` now return `agentId`/`model` on each
      `Project`; the phone MAY pre-select them in `NewConversationSheet` (today it
      lets the user pick) — purely optional UX. Server-side resolution already
      makes omitting them work.
- [x] **Thread management** — `thread/rename` / `thread/archive` /
      `thread/unarchive` / `thread/delete` (`thread-context-handler.ts` +
      `thread-store.ts`, contracted in `@uxnan/shared`). Rename/archive/unarchive
      return the updated `Thread`; delete removes the thread + its turns (unknown
      id → `-32008`). The mobile app already called these best-effort; they now
      persist on the bridge so the change survives a phone reinstall / second
      device.
      **Mobile linkage (no uxnanmobile code change needed):** the phone already
      calls all four local-first and degrades gracefully, so nothing new is
      required there. To VALIDATE on-device once a live bridge is reachable: after
      archive/rename a `thread/list` re-sync should reflect the new status/title,
      and a deleted thread must not reappear — confirm the mobile `thread/list`
      parser maps `status: 'archived'`. The bridge now RETURNS the updated
      `Thread` on rename/archive/unarchive; the phone currently ignores it (keeps
      its optimistic copy) — optional future reconcile against the returned value.
- [ ] **Account/auth** — `src/handlers/account-handler.ts` (sanitized, no tokens).
- [x] **Notifications** — `src/handlers/notifications-handler.ts` +
      `src/push/push-service.ts`. `notifications/register|update|unregister` wired;
      registers the token with the relay and pushes on turn-end (gated by
      `config.push*` + Firebase creds on the relay). **Persistence + multi-session
      DONE:** registrations are keyed by relay `sessionId` and persisted to
      `~/.uxnan/push-state.json` (atomic), loaded at startup via
      `PushService.load()`, so background push survives a bridge restart WITHOUT
      the phone re-registering (the relay keeps its own sessionId→token map; the
      bridge only needs `sessionId` + `notificationSecret` to call `/push/notify`).
      A turn-end pushes to **every** registered phone, so multiple paired devices
      each get background push. Remaining follow-ups:
        - `register`/`updatePreferences`/`unregister` act on the *active* session
          (exact with `maxConcurrentSessions: 1`); to target a specific phone when
          several sessions are concurrent, thread per-request session identity
          through the router to the handler. **FOR-DEV.**
        - prune registrations for devices removed via `bridge/removeTrustedDevice`
          (today they linger until `unregister`/overwrite) — wire trust-removal to
          drop the matching push registration.
        - **Mobile linkage:** no uxnanmobile change needed — the phone already
          calls `notifications/register` on connect. To VALIDATE end-to-end needs
          the Firebase/APNs creds (FOR-HUMAN) + a real device; confirm a turn-end
          push arrives while backgrounded, and still arrives after restarting the
          bridge (without reopening the app).
- [ ] **(OPT-IN — explicit developer request ONLY) Direct FCM from the bridge,
      push without the relay.** Today background push **requires a running relay**:
      the bridge holds no FCM credentials and `POST`s `/push/notify` to the relay,
      which owns the Firebase service account and calls FCM. This is intentional —
      it keeps the bridge credential-free and the relay optional for *everything
      except* background push (foreground local notifications already work
      relay-free; see `relay/docs/push-notifications.md` → "Do I need the relay?").
      If — and only if — a developer explicitly asks for background push in a pure
      relay-less (LAN/Tailscale-direct) setup, add an alternative `PushSender` in
      the bridge that calls FCM directly via `firebase-admin` using a local
      `UXNAN_FCM_SERVICE_ACCOUNT`, selected when `relayEnabled === false`. **Do NOT
      build this by default**: the relay-based path stays the default so the bridge
      ships with no push secrets. Implement strictly on request.
- [ ] **Desktop** — `src/handlers/desktop-handler.ts` (embedded mode IPC).
- [x] **bridge/removeTrustedDevice** — `src/handlers/bridge-control-handler.ts`.
      Revokes trust (`ctx.trustStore.remove`) and drops any live session/sink
      (`sessions.remove` + `sessionRegistry.unregister`) so a removed device is
      both untrusted and disconnected now. Idempotent (removing an absent device
      is not an error). `bridge/trustedDevices` now reads through `ctx.trustStore`
      too. **Mobile linkage:** the uxnanmobile "Remove device" card action is
      still DEFERRED (its `FOR-DEV.md` → *Threads list → Remove device*); the
      bridge side is now ready, so when that UI lands it just calls this method
      (`{ deviceId }`) after deleting the local `TrustedDevice` + threads. No
      further bridge work needed.
- [x] **bridge/status `relayConnected`** — reflects the real relay connection.
      `BridgeContext.relayConnected()` reads the live relay-serve state (the
      `relayState.connected` holder in `src/bridge.ts`, true while a relay
      connection is serving a phone), so the `bridge/status` handler no longer
      hard-codes `false`. **Mobile linkage:** the phone's `bridge/status` parser
      already consumes `relayConnected`; verify on-device that it flips true while
      a relay session is live and false on LAN-only/idle.

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
- [x] **Agent model discovery** — `agent/models` now returns a **structured
      `AgentModel[]`** (`id`/`displayName`/`description?`/`version?`/`isDefault?`),
      account-aware per agent: OpenCode runs `opencode models`; **Codex** drives
      `codex app-server` (`initialize` → `model/list`, the desktop app's source)
      with a `~/.codex/config.toml` fallback; **Claude Code** exposes the stable
      `opus`/`sonnet`/`haiku` aliases (labelled "(latest)") plus any concrete
      versions pinned in `agents.claude-code.models`. The concrete model an alias
      resolves to is reported per-run via the `stream/model/resolved` notification
      (`model_resolved` adapter event).
- [x] **Per-turn token usage** — `stream/turn/completed` now carries
      `usage { tokens, contextWindow? }`: Claude parses the `result` event's
      `usage` and maps the tier context window (Opus/Sonnet 1M, Haiku 200K);
      Codex sums `turn.completed.usage` (no window in exec mode); `AgentManager`
      forwards it. Lets the phone show a context-usage indicator.
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
      Turns use the one-shot `codex exec` entry point. **Model discovery (done):**
      `codex exec` has no enumerate command, so `listModels()` briefly spawns
      `codex app-server` and runs the `initialize` → `model/list` JSON-RPC
      handshake (account-aware, the desktop app's source), falling back to
      `~/.codex/config.toml`. `turn.completed.usage` is parsed for the context
      indicator.
- [x] **Claude Code** — `src/adapters/claude-adapter.ts`. WIRED via
      `claude -p --output-format stream-json --verbose --include-partial-messages`
      (`--resume <session_id>`, `--model <alias|id>`). Parses the JSONL stream
      (`system`/`stream_event` `text_delta`/`assistant`/`result`), keeps the
      `session_id` per thread, runs in the thread's cwd. Headless permission
      posture is configurable via `agents['claude-code'].permissionMode`
      (default `acceptEdits`; also `default` / `bypassPermissions`). Binary
      resolved by `resolve-claude.ts` (native `~/.local/bin/claude[.exe]` → npm
      `cli.js` via node → PATH). **Model discovery (done):** `listModels()`
      exposes the `opus`/`sonnet`/`haiku` aliases (labelled "(latest)") plus any
      concrete versions pinned in `agents.claude-code.models`; the version an
      alias resolves to is captured from the `system/init` event and emitted as
      `model_resolved`. `result.usage` is parsed (with the tier context window)
      for the context indicator.
- [ ] **Gemini CLI** — capture its non-interactive JSON stream first. New scaffold.
- [ ] **JSONL history fallback** (`session-jsonl-history`) — read agent session
      JSONL/SQLite from disk for `turn/list` when the runtime has no fresh data
      (§5.8.8). Needs each agent's real on-disk format.
- [ ] Later: pi-agent, Aider.

## Daemon lifecycle & ops
- [x] **Single-instance lock + `stop`** (Phase 3) — `src/lock-file.ts`,
      `src/cli.ts` (`bridge.lock` + SIGTERM).
- [x] **`install-service` / `uninstall-service` autostart** — `src/service-installer.ts`
      + `src/cli.ts`. Runs the bridge at logon **as the logged-in user, never
      elevated** (`node <cli.js> start`, works global-install or dev). Per platform:
        - **Windows:** a **Task Scheduler** logon task (`schtasks /SC ONLOGON /RL
          LIMITED`); **falls back to a hidden Startup-folder `.vbs`** when Task
          Scheduler is denied (restricted accounts/policy) — no admin, no console
          window. Validated end-to-end on Windows.
        - **macOS:** a per-user **LaunchAgent** (`RunAtLoad` + `KeepAlive`).
        - **Linux:** a **systemd `--user`** unit (`loginctl enable-linger` tip
          printed). `buildServicePlan` is pure (unit-tested per platform).
      Follow-ups (FOR-DEV): **relay autostart** (only needed for remote/off-LAN —
      LAN-only needs no relay); bind the LAN server to the LAN iface only.
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
