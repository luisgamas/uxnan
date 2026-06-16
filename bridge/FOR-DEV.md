# FOR-DEV — uxnan-bridge

Deferred developer work for the bridge. Each item has a greppable `FOR-DEV:`
marker at its site in the code. (Distinct from `FOR-HUMAN.md`, which tracks assets
only a human can provide.)

> **How to run/validate everything** (automated tests, real-mobile E2EE interop,
> adapter wiring, contract re-checks) is in [`docs/testing.md`](docs/testing.md).
> Each deferred item below says what to build; that doc says how to test it.
> Install/config/agents/deploy docs are alongside it in [`docs/`](docs/).

## MVP status — ALPHA-FUNCTIONAL (LAN/Tailscale-direct path)
> Snapshot 2026-06. The bridge is **functional for an alpha release** on its primary
> path: it builds clean and the full test suite is green (bridge 245, shared 29,
> relay 9). Nothing below blocks LAN/Tailscale-direct use.
>
> **DONE:** E2EE transport (LAN `http+ws` + optional relay); **5 real agents**
> (OpenCode, Claude Code, Codex, pi, **Gemini**) with per-thread/project agent+model,
> structured model discovery, per-turn token usage, thinking + structured
> commands/tools/diffs; git + workspace + checkpoints (true restore + pruning);
> thread lifecycle; on-disk `turn/list` **history fallback**; sanitized `auth/status`;
> **push** (direct FCM, persisted, per-phone target + prune-on-untrust); **pairing**
> (QR + **manual code** + **mDNS discovery**); autostart/`install-service` per OS;
> file logging.
>
> **PENDING that matters for a public release (not LAN alpha):**
> - **Packaging/publish prep** — pin `@uxnan/shared` deps, verify a packed install,
>   `version.ts` stamp (see *Packaging*). Required before `npm publish`.
> - **Real-device push validation** + iOS APNs key (FOR-HUMAN; needs a device).
>
> **PENDING optional / blocked-on-mobile (do not block alpha):** seq catch-up on
> reconnect + key rotation (await a mobile trigger); desktop embedded IPC (desktop
> Phase 6); per-model run-options *phase 4* (fast-mode/context — little to wire);
> Gemini in the history reader; Aider adapter; log size-rotation.

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
- [◑] **Manual-code pairing (bridge-side; relay's `/trusted-session/resolve` reframed
      for the bridge-first model).** The phone can pair WITHOUT scanning a QR by
      trading a short code shown on the PC for the pairing payload.
      **Phase 1 DONE:** `src/pairing/pairing-code-service.ts` issues a short,
      rotating, expiring (10 min) **pairing code** (8-char Crockford base32, shown by
      the `qr` CLI alongside the QR; `Bridge.currentPairingCode()`); the LAN server
      (now an `http.Server` + WS) exposes `GET /pair/resolve?code=<code>` which
      validates the code (constant-time, per-IP rate-limited) and returns the full
      `PairingPayload` (identical to the QR), after which the phone runs the normal
      E2EE handshake. The code is the **consent gate** (same trust posture as the QR
      — whoever sees the screen can pair; no new secret).
      **Phase 2 DONE:** `src/transport/mdns-advertiser.ts` advertises the bridge on
      the LAN via mDNS/DNS-SD (`_uxnan._tcp.local`) so the phone DISCOVERS it without
      typing the host. **Implemented dependency-free** (hand-rolled over `node:dgram`)
      rather than pulling `bonjour-service`/`multicast-dns` — keeps the packaged
      bridge (`npm i -g` / single binary) free of a third-party mDNS stack and avoids
      a native build. Records: PTR + SRV + TXT (`v`,`port`,`addr`,`id`=deviceId) + A,
      announced on start, goodbye (TTL 0) on stop, answers browse + DNS-SD meta
      queries. Best-effort: a failed bind (5353 busy) degrades silently. Toggle via
      `config.mdnsEnabled` (default true; effective only when `lanEnabled`). Verified
      by unit tests (fake socket) + a real on-machine multicast smoke (a DNS-SD
      querier received the full record set).
      **Mobile linkage (uxnanmobile):** the deferred `ManualCodeScreen` should
      (1) **browse `_uxnan._tcp` via mDNS** (Android `NsdManager` / iOS `NWBrowser`,
      e.g. the `nsd`/`multicast_dns` Flutter plugin) to list bridges + read the TXT
      `addr`/`port`, then (2) call
      `GET http://<addr>:<port>/pair/resolve?code=<code>` **on the bridge** (NOT the
      relay) to synthesize the `PairingPayload`, then reuse the existing QR pairing
      path. Typing the host stays a manual fallback when mDNS is unavailable.

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
      Follow-ups:
        - ☑ **True restore** — `apply` now deletes files created after the
          checkpoint AND restores snapshot contents (recreating deleted, overwriting
          modified), so the worktree matches the snapshot exactly. Extras are found
          by snapshotting the current tree into a temp index (HEAD + `add -A`) and
          diffing snapshot → now; worktree-only, never removes gitignored files.
          Full parity with the mobile `AiChangeSet` revert. **Mobile linkage:** no
          uxnanmobile change needed — `workspace/applyCheckpoint` is unchanged on
          the wire; verify on-device that a revert removes files the agent created.
        - ☑ **Prune/GC** — each `capture` prunes checkpoints beyond
          `checkpointMaxPerProject` (default 25, per `cwd`) and/or older than
          `checkpointTtlDays` (default 0 = off), deleting the `refs/uxnan/checkpoints/*`
          anchor + the `checkpoints.json` entry. See `docs/configuration.md`.
        - ☐ checkpoints require at least one commit (no HEAD → `-32003`); consider
          supporting checkpoints on an unborn branch if a use case appears.
- [x] **Thread/turn** (Phase 5) — `src/handlers/thread-context-handler.ts` +
      `src/conversation/thread-store.ts` + `src/agents/agent-manager.ts`.
- [◑] **Interactive approval intake** — generic plumbing DONE; real per-agent
      routing partial. `turn/send` accepts a control-only `approvalResponse:
      { approvalId, decision }` (no new turn) and routes it via
      `AgentManager.respondApproval` → `IAgentAdapter.respondApproval`. Agents
      request approval by emitting an `approval` content block
      (`approvalBlock()`), which the phone already renders interactively.
        - ☑ **Echo demo** (validatable now): text `approval-demo` emits a sample
          approval and pauses until the phone replies — for end-to-end UI
          validation without a real agent.
        - ◑ **Claude Code (opt-in):** `agents['claude-code'].interactiveApprovals:
          true` runs turns via `--input-format stream-json`, surfaces
          `control_request can_use_tool` as an approval block and writes the
          decision back as a `control_response` (`src/adapters/claude-approvals.ts`,
          pure + unit-tested; default off, one-shot path untouched). **FOR-DEV:
          validate the stream-json input + control field names against a live
          `claude` CLI** (documented-but-unverified here); also map
          `approveSession` to a real session-scoped `updatedPermissions` instead
          of a plain allow.
        - ☐ **Codex:** `codex exec` is non-interactive and emits no approval
          requests, so real Codex approvals need turn execution moved onto the
          **app-server** protocol (the bridge already speaks it for
          `model/list`) where `applyPatchApproval`/`execCommandApproval`
          elicitations exist. Larger refactor — deferred. Until then Codex turns
          run under their sandbox posture (`-s workspace-write`, etc.).
        - ☐ **OpenCode / pi / Gemini:** add `respondApproval` + an interactive
          invocation per CLI when their headless modes expose a permission
          channel (verify per CLI).
- [x] **Turn image attachments** — `turn/send` accepts `attachments:
      TurnAttachment[]` and an **image-only** message (empty/omitted `text`).
      `src/agents/attachments.ts` materializes each inline image to a temp file
      (`<tmp>/uxnan-attachments/<turnId>/`) and `AgentManager.sendTurn` appends a
      path reference to the prompt, so any file/vision-capable CLI can open it —
      **no per-adapter image handling**. Tolerant parser; best-effort write (a
      failure degrades to a text turn). Mobile half was already wired; this closes
      the seam. **Follow-ups (FOR-DEV):** (1) native per-CLI image input (a
      dedicated flag / MCP image part) where an agent supports it richer than a
      file path — the `attachments` are already threaded to `adapter.sendTurn`
      via `SendTurnOptions.attachments` for an adapter that wants to consume them
      natively; (2) temp-file GC/retention (today they linger in the OS temp dir);
      (3) on-device verification that an agent reads the delivered image.
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
- [◑] **Account/auth** — `src/handlers/account-handler.ts` + `src/account-status.ts`.
      **`auth/status` DONE (sanitized, per-agent):** takes `{ agentId }`, returns a
      sanitized `AuthStatus` (never tokens — login is detected by auth-file
      EXISTENCE only, contents never read; unmapped agent → availability; unknown
      agent → `-32602`). **Still deferred:** `auth/login`/`auth/logout` (driving a
      CLI's interactive login/logout flow) remain stubs — and an authoritative
      `requiresLogin` would run the CLI's own `whoami`/auth command instead of the
      file-existence heuristic (slower, per-CLI). **Mobile linkage:** the spec's
      `authStatusProvider` already calls `getAuthStatus(agentId)` per the active
      project's agent; the bridge now answers it. On-device: verify the
      requires-login banner appears when the agent CLI is logged out on the PC.
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
      each get background push. Follow-ups **DONE**:
        - ☑ **Per-request session target** — the secure transport now tags each
          request with its `RequestSession` (`{ sessionId, deviceId }`), threaded
          `session-handler → router.dispatch → handler`. `notifications/register|
          update|unregister` act on **that** session (falling back to the active
          session for single-phone setups), so when several phones are concurrent
          each manages its own registration. `PushService.register` takes an
          explicit `{ sessionId, deviceId? }` instead of reading a single "active"
          session.
        - ☑ **Prune on untrust** — `bridge/removeTrustedDevice` now calls
          `PushService.unregisterDevice(deviceId)`, dropping every registration
          owned by that device (the registration records its `deviceId`), so a
          revoked phone stops receiving background push immediately instead of
          lingering until it re-registers or is overwritten.
        - **Mobile linkage (no uxnanmobile change needed):** the phone already
          calls `notifications/register` on connect (per-session target works as-is)
          and its **"Remove device" action is already DONE** (uxnanmobile
          `FOR-DEV.md` → *Threads list → Remove device* sends `bridge/removeTrustedDevice`
          with its own id), so prune-on-untrust is wired end-to-end — no deferred
          mobile work. **VERIFY (device):** (1) per-session — with
          `maxConcurrentSessions > 1`, two paired phones each get their own
          background push; `unregister` on one leaves the other receiving. (2) prune
          — "Remove device" on a phone → that phone stops receiving background push
          immediately. Both need the Firebase creds (FOR-HUMAN) + a real device.
- [x] **Direct FCM from the bridge — the PRIMARY push path (relay optional).**
      DIRECTION (decided 2026-06-12): background push is sent **by the bridge
      itself**, so it works on **any** transport — direct LAN, **Tailscale**, or
      relay — not only when a hosted relay is in the loop. The relay is now
      **optional and self-hosted** (for those who want hosted off-LAN access); the
      bridge keeps working — securely, E2EE end-to-end — **with or without it**.
      **DONE:**
      - **Build:** `src/push/push-sender.ts` adds `createBridgePushSender` — a lazy
        `firebase-admin` FCM HTTP v1 `PushSender` (named app `uxnan-bridge`,
        `android.priority=high` / `apns-priority:10`). It reads
        `UXNAN_FCM_SERVICE_ACCOUNT`, **falling back to the documented
        `~/.uxnan/firebase-service-account.json`** so it's plug-and-play (drop the
        JSON in place, no env var needed). `PushService` now keeps the **real device
        token + platform** per registration and, on turn-end, delivers **direct via
        FCM first**, regardless of `relayEnabled`; the `POST /push/notify`→relay path
        is the **fallback** (used when there's no local credential, or `relayEnabled`).
        Wired in `bridge.ts`; `register` only hits the relay when it's enabled or
        there is no direct sender (fixes the old always-forward, which broke push on
        the relay-off default).
      - **Guarding:** with no service account and no relay, push is a silent no-op
        (foreground local notifications still work, relay-free). `firebase-admin` is
        an `optionalDependency` — a missing module degrades to relay/noop, never a
        build/start failure.
      - **Security:** payloads carry title + short turn summary (already truncated,
        same as the relay path) + thread/turn ids — no further conversation content.
        The bridge owning the FCM service account is the same trust model as the
        relay owning it: a local, gitignored credential the user provides (`FOR-HUMAN.md`).
      - **Mobile:** no change — the phone registers an FCM token via
        `notifications/register` and the bridge delivers; works whichever side
        holds the credential.
      - **Validated:** `bridge/test/push/push-service.test.ts` covers the direct
        path (relay untouched on the default, FCM delivery, restart persistence,
        relay-enabled coexistence). A live init smoke against the real `uxnan-app`
        service account authenticated to FCM (bogus token → `messaging/invalid-argument`,
        i.e. creds OK). **Remaining:** a real device to confirm an actual token
        delivers while backgrounded.
      - **Follow-up (optional):** the payload `body` still carries the truncated turn
        summary for a useful notification; if a stricter "title + thread id only"
        policy is wanted, drop `body` in `buildNotification` for the direct path.
- [ ] **Desktop** — `src/handlers/desktop-handler.ts` (embedded mode IPC).
- [x] **bridge/removeTrustedDevice** — `src/handlers/bridge-control-handler.ts`.
      Revokes trust (`ctx.trustStore.remove`) and drops any live session/sink
      (`sessions.remove` + `sessionRegistry.unregister`) so a removed device is
      both untrusted and disconnected now. Idempotent (removing an absent device
      is not an error). `bridge/trustedDevices` now reads through `ctx.trustStore`
      too. It also now prunes the device's push registration
      (`pushService.unregisterDevice` — see *Notifications → Prune on untrust*).
      **Mobile linkage:** the uxnanmobile "Remove device" card action is **DONE**
      (its `FOR-DEV.md` → *Threads list → Remove device* already calls this method
      with `{ deviceId }` after deleting the local `TrustedDevice` + threads), so
      this is wired end-to-end. No further bridge work needed.
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
- [◑] **Per-model run options (reasoning effort / context / fast mode) — advertise
      + apply, data-driven.** Phases 1–3 DONE (effort wired + per-model option schema
      + mobile renderer); only phase 4 (fast-mode/context variants) remains, with
      little to wire today. IMPORTANT (not urgent): this is the next big seam to
      link with mobile. The phone should let the user pick a model's *run knobs*
      (reasoning/thinking level, and where it applies a context-window variant or a
      "fast mode"), but these differ **per agent AND per model**, and some are only
      knowable at runtime (OpenCode depends on the provider/model). So the phone
      must NOT hardcode any of it — the bridge advertises the available knobs per
      model and translates the chosen values into each CLI's real flags.

      **This is bridge-first** (a small `shared/` contract change + the real work
      in the adapters; mobile is a generic renderer afterwards).

      **Current state (what exists today):**
        - The contract already carries a flat `effort?: string` on `TurnSendParams`
          (+ `service?` as a per-turn model override). `agent/models` returns
          `AgentModel[]` (id/displayName/description/version/isDefault).
        - **Effort is now wired for all three adapters (phase 1 DONE).** OpenCode
          maps it to `--variant <effort>`; **Claude** passes `--effort
          <low|medium|high|xhigh|max>`; **Codex** passes `-c
          model_reasoning_effort=<low|medium|high>` (each flag verified against the
          installed CLI's `--help`). The flat `effort` on `TurnSendParams` is still
          the wire field; phase 2 generalizes it to a per-model option schema.
        - Context *usage* is already shown as a % (`claudeContextWindow`, Codex/
          Claude usage). That is DISPLAY, distinct from *choosing* a context window.
        - `AgentCapabilities` (shared) only declares `planMode/streaming/approvals/
          forking/images` — there is no schema for run-option knobs.

      **Per-agent reality (verify each flag against the installed CLI — versions
      differ; follow the "Adding the next agent" capture recipe below):**
        - **Claude Code**: reasoning = `effort` (low→max) + adaptive thinking;
          models = `opus/sonnet/haiku` aliases + pinned ids; context window is fixed
          by the model EXCEPT narrow beta cases (e.g. 1M context); **fast mode** is a
          Claude-Code-specific toggle. (Confirm the exact CLI flags for effort/fast —
          they may be config, not argv.)
        - **Codex**: reasoning = `model_reasoning_effort` low/med/high (via
          `-c model_reasoning_effort=...`); models via `model/list`; context fixed by
          model; no fast mode.
        - **OpenCode**: reasoning/variant already wired (`--variant`); everything is
          provider/model-dependent and must be enumerated at runtime, never assumed.
        - **pi**: reasoning = `--thinking` (off/minimal/low/medium/high/xhigh),
          advertised per model (the `thinking` column of `--list-models`).
        - **Gemini / aider**: TBD when those adapters land.

      **Proposed design (3 layers):**
        1. **`shared/`** — extend per-model discovery so each `AgentModel` (or a
           sibling shape returned by `agent/models`) declares a list of typed
           **option knobs**: `{ key, kind: 'enum'|'toggle'|'select', label, values?,
           default? }` (e.g. `enum reasoning [low,medium,high]`, `toggle fastMode`,
           `select context [200k,1m]`). Plus fields on `turn/send` (and/or a
           per-thread settings RPC) to carry the chosen values. Keep `effort` working
           for back-compat, or fold it into the generic options.
        2. **`bridge/`** — the real work: per adapter, (a) DISCOVER the knobs for a
           given agent/model (Codex + OpenCode by real CLI enumeration; Claude by a
           known table) and surface them via `agent/models`; (b) TRANSLATE the chosen
           values into the right CLI flag at turn time (`-c model_reasoning_effort=…`
           for Codex, `--variant` for OpenCode, the effort/fast flags for Claude).
           Start by wiring the `effort` that Codex/Claude currently ignore.
        3. **`uxnanmobile/`** — a **data-driven** renderer (reuse the existing
           capability-gated-control pattern): show only the knobs the bridge
           advertises for the active model, send the chosen values on `turn/send`.
           Zero per-agent knowledge in the app → future agents work with no app
           change. **Mobile linkage:** nothing to build on the phone until the
           contract lands; then it's purely additive UI.

      **Recommendations:**
        - Model knobs **per (agent, model)**, not per agent — the same agent's
          models differ (a Codex reasoning model vs a non-reasoning one; OpenCode
          varies by provider). Returning them on `agent/models` keeps it per-model.
        - **Do NOT build a generic context-window selector by default** — the window
          is almost always fixed by the model. Model `context` as an option that
          appears ONLY on models that genuinely offer a choice (Claude 1M beta).
          Keep the existing usage-% display as-is.
        - Make the option schema **tolerant/forward-compatible** (unknown `kind`
          ignored by the phone) so adding a knob never breaks an older app — same
          discipline as the tolerant `AgentModel` parser.
        - Capture each CLI's real flags first (don't trust a flag unseen in the
          installed CLI's `--help`/stream); some "options" are config-file, not argv.
        - Phase it: **(1) DONE** — `effort` wired end-to-end for Codex + Claude;
          **(2) DONE** — generic per-model option schema in `shared/` +
          `agent/models`; **(3) DONE** — mobile data-driven renderer; **(4)**
          fast-mode + context-variant as opt-in knobs where the CLI supports them.
          The advertised levels are the **real per-agent options**: Codex
          discovers them per model from the app-server `model/list`
          (`supportedReasoningEfforts`/`defaultReasoningEffort`, incl. `xhigh`);
          Claude uses its validated `--effort` set (`low/medium/high/xhigh/max`).
          NOTE (validated): Claude has **no** fast-mode/context argv flag (`claude
          --help`), `ultrathink`-style keywords are prompt triggers not effort
          levels, and context variants aren't simple flags — phase 4 has little to
          wire today; keep the schema forward-compatible and only advertise knobs
          that map to a real flag.

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
- [x] **pi** — `src/adapters/pi-adapter.ts`. WIRED via `pi -p --mode json`
      (`--session-id <id>` for continuity, `--model <provider/model>`,
      `--thinking <off|minimal|low|medium|high|xhigh>` for reasoning effort).
      Parses the newline-JSON stream (`session` → captures the session id;
      `message_update`/`text_delta` → streamed text; `message_end` assistant →
      final text + `usage.totalTokens` + `stopReason`/`errorMessage`; `agent_end`
      → completion). `thinking_*` events are NOT emitted as answer text. Tool
      posture via `agents['pi-agent'].permissionMode` (default `acceptEdits` →
      pi's built-in read/bash/edit/write; `default` → `--tools read,grep,find,ls`
      read-only; `bypassPermissions` → `--approve`). Binary resolved by
      `resolve-pi.ts` (`node <@earendil-works/pi-coding-agent/dist/cli.js>`).
      **Model discovery:** `pi --list-models` table → `AgentModel[]`
      (id `provider/model`; the reasoning knob advertised for models whose
      `thinking` column is `yes`). Validated live against `pi` 0.79.1.
      **Auth:** detected by the existence of `~/.pi/agent/auth.json` (per-provider
      credentials; multi-provider, so no single public provider name).
      **FOR-DEV follow-ups:** map the resolved model's context window for a `%`
      context ring (today pi reports raw `totalTokens`, shown as a count like
      Codex).
- [x] **Structured content (thinking + commands/tools/diffs) for ALL agents** —
      DONE & verified live. Adapters emit `thinking` and `block` events that the
      phone folds into a collapsible "Thinking" section, the Work log and Changed
      files. Shared `content-blocks.ts` builders + per-agent mappers
      (`claude-tools.ts`, `codex-tools.ts`, `opencode-tools.ts`, `pi-tools.ts`)
      translate each CLI's events: Claude `tool_use`+`tool_result` and
      `thinking_delta`; Codex `reasoning`/`command_execution`/`file_change`/
      `mcp_tool_call`; OpenCode `reasoning`/`tool_use` parts; pi `thinking_delta`
      + paired `tool_execution_start`/`_end`. Contracts: `stream/thinking/delta`,
      `stream/content/block`, `AgentStreamEvent 'thinking'|'block'`,
      `Message.thinking?`/`blocks?` (persisted, survive `turn/list`). Verified by
      running real turns (codex-cli 0.139, opencode 1.17.4, pi 0.79.1) and
      inspecting the JSON. Codex `file_change` now renders a real per-line diff
      (the adapter runs `git diff HEAD -- <path>`). Richer per-file diff via a
      dedicated `git/diff` viewer is DONE (maintainer-validated): `git/diff`
      takes an optional `path` (with untracked-file synthesis) and the phone
      renders it in `GitDiffView` — test-backed in
      `bridge/test/git/git-service.test.ts`. The git handler also gained
      `stage`/`unstage`/`discard`/`createPr`/`undoCommit`/`branches`/
      `switchBranch` for the mobile source-control screen.
- [x] **Gemini CLI** — `src/adapters/gemini-adapter.ts`. WIRED via
      `gemini -p <prompt> --output-format stream-json --approval-mode <mode> --skip-trust`
      (validated live against gemini-cli 0.45.2 with flash-lite). Parses the NDJSON
      stream (`init` → captures `session_id` + requested model; `message`
      `role:assistant` `delta:true` → streamed text; `tool_use`+`tool_result` paired
      by `tool_id` → structured blocks; `result` → completion with
      `stats.total_tokens` usage). **Session continuity:** first turn opens a session
      under a generated UUID (`--session-id <uuid>`); later turns `--resume <uuid>`
      (verified: a fact set on turn 1 is recalled on turn 2). The native session id
      is tracked per thread (`nativeSessionId`). **Model discovery:** the CLI has no
      enumerate command, so `listModels()` returns a curated set
      (`gemini-2.5-pro`/`flash`(default)/`flash-lite`); the CONCRETE model an alias
      resolves to (e.g. `gemini-3.1-flash-lite`) is read from `stats.models` and
      emitted as `model_resolved`. **Usage:** `stats.total_tokens` + a 1M context
      window → the context meter. **Diffs/tools:** `gemini-tools.ts` maps
      `write_file`→write-diff, `replace`→edit-diff, `run_shell_command`→command
      block, others→generic tool block; the internal `update_topic` tool is filtered.
      Sandbox posture via `agents['gemini-cli'].permissionMode` (default `acceptEdits`
      → `--approval-mode auto_edit`; `default` → `plan` read-only; `bypassPermissions`
      → `yolo`). Binary resolved by `resolve-gemini.ts` (`node <@google/gemini-cli/
      bundle/gemini.js>`). **Mobile linkage:** none — Gemini is exposed through the
      generic `agent/list`/`agent/models` contract the phone already renders (model
      picker, context meter, Work log/diffs); the phone needs no change to show it.
      To VERIFY on device: pick Gemini for a thread, confirm streaming + the context
      meter + a write/edit diff render. **Follow-ups (FOR-DEV):** (1) no reasoning
      knob is advertised — the CLI exposes no `--thinking`/effort flag; revisit if one
      appears (Gemini 2.5 has thinking budgets but no headless flag in 0.45.2). (2)
      add Gemini to the `session-jsonl-history` reader (its on-disk session format) —
      the adapter already persists the native session id, so the locator is ready.
- [x] **JSONL history fallback** (`session-jsonl-history`) — `turn/list` now falls
      back to each agent's own on-disk session log when the `ThreadStore` has no
      turns (bridge missed them / `threads.json` lost / session driven from a
      terminal). `src/conversation/session-history.ts` (`SessionHistoryReader`)
      reads the **real** per-agent formats (verified live on this machine, no
      SQLite dep):
        - **Claude Code** — `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`;
          lines `{type:'user'|'assistant', message:{role, content:[{type:'text'|
          'thinking'|…}]}}` (locates by scanning project dirs for the UUID file —
          no need to reproduce Claude's lossy cwd-encoding).
        - **Codex** — `~/.codex/sessions/<Y>/<M>/<D>/rollout-<ts>-<sessionId>.jsonl`;
          `response_item` payloads `{type:'message', role, content:[{type:'input_text'|
          'output_text', text}]}` (developer/system priming skipped).
        - **OpenCode** — JSON store (not one file): `…/storage/message/<sessionId>/
          <msgId>.json` + `…/storage/part/<msgId>/<partId>.json` (`{type:'text',text}`),
          ordered by `time.created`. No `better-sqlite3` dependency.
        - **pi** — `~/.pi/agent/sessions/<encoded-cwd>/<ts>_<sessionId>.jsonl`;
          lines `{type:'message', message:{role, content:[{type:'text',text}]}}`.
      Locating the file needs the agent's **native** session id, so it is now
      persisted per thread: adapters expose `nativeSessionId(threadId)`,
      `AgentManager` writes it via `ThreadStore.setAgentSession` on turn end, and
      the `turn/list` handler reads `getHistorySource` → `SessionHistoryReader`
      (path cache, 60s TTL; paginated like the store). Best-effort + read-only:
      tolerant of malformed lines, returns `null` (keeps the empty store result)
      for unknown/unsupported agents or a missing log. Tested with per-format
      fixtures **and** smoked against real on-disk logs for all four agents.
      **Mobile linkage:** none — `turn/list` is unchanged on the wire; the phone
      just sees history it previously couldn't. **Follow-ups:** Gemini/Aider when
      those adapters land; richer block/tool reconstruction (today the fallback
      carries text + thinking, not the live path's structured blocks).
- [ ] Later: Aider.

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

## CI/CD & release (planned — FOR-DEV; decided 2026-06)
> Clarification (the recurring "build per platform vs npm packaging?" question):
> the bridge/relay/shared are **pure Node.js/TypeScript** packages — NOT
> per-platform compiled binaries. The only native bits (`@napi-rs/keyring`,
> `firebase-admin`) are `optionalDependencies` with JS fallbacks. So `tsc` output is
> identical on every OS and the **distribution artifact is the npm package**, not an
> OS-specific binary. "Build for each platform" in the compiled-binary sense does
> NOT apply here (that's the Tauri desktop / Flutter mobile world).
>
> **Recommended GitHub Actions (do these, in order):**
> 1. **CI — on push / PR.** Matrix `os: [ubuntu, macos, windows] × node: [20, 22]`:
>    `npm ci` → `npm run build` (tsc across workspaces) → `npm run typecheck` →
>    `prettier --check` → `npm test` per package. The **OS matrix is the point** —
>    the bridge has per-OS code (`service-installer`, path handling, mDNS, keyring),
>    so green-on-all-three is the real gate. This is the "verify tests + no errors
>    before build" step you want; a release must not run if this fails.
> 2. **Release — on tag `v*`.** Re-run the gate (1), then `npm publish` in dependency
>    order: `@uxnan/shared` first, then `uxnan-bridge` + `uxnan-relay` (pin their
>    `"@uxnan/shared": "*"` → the published `^0.x` first — see *Packaging*). Use an
>    `NPM_TOKEN` secret; enable npm provenance.
> 3. **Optional, later — standalone single binary.** ONLY if a no-Node install is
>    wanted: Node SEA (`--experimental-sea-config`) or an equivalent bundler emits
>    per-OS executables (win/mac/linux) as GitHub Release assets. This is the only
>    part that needs a real per-platform build matrix; it is polish, not required for
>    alpha.
>
> **Verdict:** the professional baseline for this Node monorepo is **(1) CI matrix +
> (2) npm release**, not per-OS binaries. Add (3) only if you decide to ship to users
> without Node installed. Workflows are NOT created yet — this annotation prepares
> the ground; implement `.github/workflows/{ci,release}.yml` when ready.

## Relay hardening (relay-only; see `relay/FOR-DEV.md` for the authoritative list)
- [x] **Per-IP rate limiting** (Phase 3) — `relay/src/relay-server.ts`.
- [x] **Push endpoints** (`/push/*`, FCM) — DONE (Phase 6). Push is now bridge-direct
      by default; the relay endpoints are the optional hosted fallback.
- [→bridge] **Pairing-code resolution** — manual-code pairing is now a **bridge**
      feature (`src/pairing/` + `/pair/resolve` + mDNS); the relay
      `/trusted-session/resolve` is superseded except for hosted off-LAN pairing.
- [ ] **Multi-session `mac` registration** — relay-only; deferred unless you host a
      shared relay (`relay/FOR-DEV.md`).

## Contracts verified
- [x] **Pairing QR encoding** — `@uxnan/shared` now emits Base64 JSON matching the
      mobile `PairingPayload.fromQrString` (Phase 3).
