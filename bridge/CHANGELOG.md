# Changelog — uxnan-bridge

All notable changes to the bridge daemon are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/). Versioning: [SemVer](https://semver.org/).

## [Unreleased]

### Added
- **Agent plan / to-do lists mapped to `plan` content blocks.** A new
  `planBlock` builder + tolerant `extractPlanSteps` (content-blocks.ts) turn an
  agent's plan-tool input into the `{ type:'plan', state:{ title?, steps:[{
  description, status }] } }` block the phone renders as a checklist. Wired per
  agent: **Claude** `TodoWrite` (confident), **OpenCode** `todowrite`, **pi**
  `todo`, **Codex** `update_plan` item. Emits a block only when ≥1 step parses
  (a wrong/absent shape → no block, never a malformed one). Codex/OpenCode/pi
  tool names + shapes are ASSUMED and flagged `FOR-DEV:` for live confirmation;
  Claude is verified by shape. Covered by `test/adapters/plan-blocks.test.ts`.
- **Per-thread access mode is now enforced per turn (Claude).** `turn/send`
  reads the thread's persisted `accessMode` (`ThreadRuntime.accessMode` →
  `SendTurnOptions.accessMode`) and the Claude adapter maps it to the right CLI
  posture: `requestApproval` keeps the interactive `PreToolUse` hook,
  `approveForMe` → `--permission-mode acceptEdits` (hook suppressed),
  `fullAccess` → `--dangerously-skip-permissions`. Non-breaking: a thread with
  no mode keeps the adapter's configured posture (the validated interactive
  approvals are untouched), and `requestApproval` without a usable hook falls
  back to that posture instead of denying. Other agents accept the field and
  ignore it for now. Covered by four adapter tests + a runtime test.
- **Agent session id surfaced + per-thread access mode persisted.**
  `toThread` now includes `agentSessionId` (the agent's native session id) so
  `thread/read`/`thread/list` carry it for the phone's "resume from the CLI".
  New `thread/setAccessMode { threadId, mode }` handler + `ThreadStore.setAccessMode`
  (idempotent) persist the per-thread approval mode (`AccessMode`); `toThread`
  returns `accessMode`. Covered by `test/conversation/thread-store.test.ts`.
- **`turn/list` newest-first pagination.** The handler now accepts
  `fromEnd?: boolean` and the response carries `total` (full turn count).
  `ThreadStore.listTurns` (and the on-disk-history `paginateTurns` fallback)
  honour `fromEnd` by returning the last `limit` turns and always report
  `total`, so the phone can open a long thread at its newest messages and page
  backward by computing offsets instead of pulling the whole thread. Cursor
  semantics (forward offset, oldest→newest) are unchanged and backward
  compatible. Covered by `test/conversation/thread-store.test.ts`.

### Docs
- **Synced the spec (`architecture/02a-system-architecture.md` and
  `architecture/02b-contracts-and-requirements.md`) with the code.** This
  is a docs-only change in the bridge; no runtime behavior changed. Per
  `AGENTS.md` → *Spec drift control (non-negotiable)*, every `DONE` in
  this monorepo's `FOR-DEV.md` is now reflected in the spec. The spec was
  behind the code (relay was already optional, push was already
  bridge-direct, manual-code pairing was already bridge-first, Aider was
  the only remaining agent, the per-agent `auth/status` was already
  sanitized, etc.). The spec now matches.
  - `architecture/02a-system-architecture.md`: section 2 (topologies, with
    LAN/Tailscale-direct as primary and relay demoted to self-hosted
    fallback); section 3 (`IAgentAdapter` updated with `respondApproval`,
    `listModels` returning `AgentModel[]`, `nativeSessionId`,
    `SendTurnOptions`, `gitRevert`/`gitDeleteBranch`/`gitRemoveWorktree`,
    `browseDirs`, `exists`, and the 5 wired agents listed); section 5.5.3
    (manual-code pairing reframed as bridge-first);
    section 5.5.4 (`PairingPayload` v2 with optional `relay` + `hosts` +
    Base64 UTF-8 JSON encoding); section 5.10 (relay demoted to
    self-hosted; push split into bridge-direct primary + relay fallback).
  - `architecture/02b-contracts-and-requirements.md`: the canonical 59
    JSON-RPC methods (organized by domain: threads/turns 15, git 18,
    workspace 9, projects 2, agents 2, auth 3, notifications 3, bridge
    control 7) + 8 streaming notifications (`stream/turn/started`,
    `stream/message/delta`, `stream/thinking/delta`,
    `stream/content/block`, `stream/turn/completed`, `stream/turn/error`,
    `stream/turn/aborted`, `stream/model/resolved`) + cross-cutting
    shapes (`PairingPayload` v2, `TurnSendParams`, `TurnAttachment`,
    `ApprovalResponse`, `AgentModel`, `AgentCapabilities`, `TurnUsage`,
    `ApprovalRequestBlock`). Obsolete methods removed from the spec
    (with a note for each: `initialize`/`initialized`, `bridge/version`,
    `getAuthStatus`, `account/*`, `project/add`/`remove`,
    `git/branch/create`, `git/worktree/managed/create`,
    `git/stacked/publish`, `thread/turns/list`, `thread/turn/start`,
    `desktop/*`, etc.) — see the spec for the full list with
    replacements.
  - `architecture/00-index.md` (mobile side): implementation status
    table updated to the current state (Neural Expressive, manual-code
    pairing bridge-first, voice, image attachments, per-model run-option
    knobs, context-usage indicator, per-agent `auth/status`, interactive
    approval, full Git, etc.).
- **Updated this monorepo's `README.md`** to reflect the ALPHA state
  (status section, the 5 wired agents, the new push architecture, the
  manual-code pairing + mDNS, the new bridge-control methods, the
  test count).

### Changed
- **Gemini model list is the full `VALID_GEMINI_MODELS` set, plus `auto`.**
  The Gemini CLI has no headless enumerate command (only Codex via
  app-server and OpenCode/pi via their list commands can; Claude Code can't
  either), so `listModels()` returns a hand-kept table sourced from the CLI's
  own constants (`packages/core/src/config/models.ts` in
  google-gemini/gemini-cli): the `auto` routing alias and every id in the
  CLI's `VALID_GEMINI_MODELS` set. The concrete model a run resolves to is
  still surfaced via `model_resolved`. Curated ids:
  - `auto` *(default, → CLI picks the best model)*
  - Pro: `gemini-3-pro-preview`, `gemini-3.1-pro-preview`,
    `gemini-3.1-pro-preview-customtools`, `gemini-2.5-pro`
  - Flash: `gemini-3-flash-preview`, `gemini-3.5-flash`, `gemini-3-flash`,
    `gemini-2.5-flash`
  - Flash-Lite: `gemini-3.1-flash-lite`
  - *Experimental* (CLI's `experimentalGemma` flag): `gemma-4-31b-it`,
    `gemma-4-26b-a4b-it`
  `git/revert` (creates a revert commit, preserving history),
  `git/deleteBranch` (`git branch -d`, refuses an unmerged branch unless
  `force` → `-D`), `git/removeWorktree` (`git worktree remove`, refuses a dirty
  worktree unless `force` → `--force`, then prunes) in `git-service.ts` +
  `git-handler.ts`; and `workspace/exists` (`workspace-handler.ts`) probing
  whether a thread's `cwd` still exists (folders/worktrees removed outside the
  app). Deletion safety is git's own default; `force` is the explicit override.
  Covered by `git-service.test.ts` + `git-workspace-handlers.test.ts`.
- **Interactive approval intake** — `turn/send` now accepts a control-only
  `approvalResponse: { approvalId, decision }` (no new turn) and routes the
  decision to the agent via `AgentManager.respondApproval` →
  `IAgentAdapter.respondApproval`. Agents request approval by emitting an
  `approval` content block (`approvalBlock()` in `content-blocks.ts`).
  - **Echo dev-agent demo (works now, no real agent):** a turn whose text is
    `approval-demo` emits a sample high-risk approval and PAUSES until the phone
    replies, then completes with the decision — start an **`echo`** thread and
    send `approval-demo` to validate the mobile approval card end-to-end.
  - **Claude Code real approvals (opt-in) — DONE & validated end-to-end** against
    `claude` 2.1.177. Set `agents['claude-code'].interactiveApprovals: true` (needs
    `lanEnabled`): the adapter injects a **`PreToolUse` hook** via
    `--settings … --permission-mode default` so every tool round-trips to the
    bridge's local `POST /agent-hook/approval` endpoint (token-guarded). The
    bridge emits the `approval` block to the phone and **holds** the hook's
    response until the user answers (`turn/send { approvalResponse }`), then the
    hook returns `allow`/`deny` to the CLI. `src/hooks/claude-approval-hook.cjs`
    (written to `~/.uxnan/hooks/`) is the dependency-free hook; fail-safe → deny;
    5-min timeout → deny. Verified live: an allowed Write runs, a denied Write is
    blocked. (Earlier discovery: headless `claude -p` has **no**
    `control_request`/`control_response` channel — the hook is the real path.)
  - **Codex:** real approvals still need the app-server turn protocol
    (`codex exec` is non-interactive) — deferred, see `FOR-DEV.md`.
- **Turn image attachments delivered to the agent** — `turn/send` now accepts
  `attachments: TurnAttachment[]` (inline base64 images the phone picks in the
  composer) and allows an **image-only** message (empty/omitted `text`). The new
  `src/agents/attachments.ts` materializes each image **inside the thread's
  working directory** (`<cwd>/.uxnan-attachments/<turnId>/`) and
  `AgentManager.sendTurn` appends a **cwd-relative** reference to the prompt, so
  **every** file/vision-capable agent CLI (Claude, Codex, OpenCode, pi, Gemini)
  can open it within its sandbox — no per-adapter image handling. Writing under
  the cwd (not the OS temp dir) is required: sandboxed agents (Gemini, Codex
  `workspace-write`, Claude `acceptEdits`) reject a path outside the workspace.
  The dir is removed when the turn ends. The persisted user message stays
  faithful (original text, or a `[N image attachment(s)]` placeholder). Tolerant
  parser drops malformed attachments. Unblocks the mobile "Attach" composer.
  Covered by `test/agents/attachments.test.ts`, `agent-manager.test.ts`,
  `handlers/thread-handlers.test.ts`.
- **Manual-pairing code is shared + always visible** — the code now persists to
  `~/.uxnan/pairing-code.json`, so the **running daemon** (which serves
  `/pair/resolve`) and a separate `qr`/`code` command — or an autostarted,
  console-less daemon — hand out the **same** code (previously the code was
  per-process and the one printed by `qr` never matched the daemon's). `start`
  now **prints the pairing code** under the QR, and a new `uxnan-bridge code`
  command prints just the current code. Covered by `pairing-code-service.test.ts`.
- **Manual-code pairing (bridge-side)** — pair without scanning a QR by trading a
  short code shown on the PC for the pairing payload; reframes the relay's off-LAN
  `/trusted-session/resolve` as a bridge-first feature.
  - **Phase 1 — code + resolve:** `src/pairing/pairing-code-service.ts` issues a
    rotating, expiring (10 min), 8-char Crockford-base32 pairing code (shown by the
    `qr` CLI; `Bridge.currentPairingCode()`). The LAN server is now an `http.Server`
    with the WebSocket transport attached, and serves `GET /pair/resolve?code=<code>`
    — constant-time validated + per-IP rate-limited — returning the full
    `PairingPayload` (the same data the QR carries). The code is a consent gate, not
    a new secret.
  - **Phase 2 — mDNS discovery:** `src/transport/mdns-advertiser.ts` advertises the
    bridge on the LAN via DNS-SD (`_uxnan._tcp.local`, PTR/SRV/TXT/A) so the phone
    discovers it without typing the host. Hand-rolled over `node:dgram`
    (dependency-free — no third-party mDNS stack / native build). Toggle via
    `config.mdnsEnabled` (default true, LAN-only). Best-effort: a failed bind
    degrades silently. Verified with unit tests + a real multicast smoke.
- **Gemini CLI agent adapter** — `@google/gemini-cli` wired as a real agent
  (`src/adapters/gemini-adapter.ts`), driven via `gemini -p --output-format
  stream-json --approval-mode <mode> --skip-trust` (validated live, gemini-cli
  0.45.2). Parses the NDJSON stream for streamed text, paired `tool_use`/`tool_result`
  → structured diff/command/tool blocks (`gemini-tools.ts`, internal `update_topic`
  filtered), and `result.stats` → per-turn token usage (1M context window). Session
  continuity via a generated `--session-id <uuid>` then `--resume <uuid>`; the
  concrete model an alias resolves to (from `stats.models`) is surfaced as
  `model_resolved`. Curated model list (`gemini-2.5-pro`/`flash`/`flash-lite`).
  Approval posture configurable (`default`→`plan`, `acceptEdits`→`auto_edit`,
  `bypassPermissions`→`yolo`). Binary resolved via `resolve-gemini.ts`. Exposed
  through the existing `agent/list`/`agent/models` contract — no mobile change.
- **Per-phone push targeting + prune-on-untrust** — the secure transport now tags
  each request with its session identity (`RequestSession { sessionId, deviceId }`),
  threaded through `router.dispatch` to the handlers, so `notifications/register|
  update|unregister` act on the **requesting** phone instead of a single shared
  "active" session — several concurrent phones each manage their own registration
  (falls back to the active session for single-phone setups). `bridge/removeTrustedDevice`
  now also prunes that device's push registration (`PushService.unregisterDevice`),
  so a revoked phone stops receiving background push immediately instead of lingering.
- **On-disk session history fallback for `turn/list` (§5.8.8)** — when the store
  has no turns for a thread, the bridge now reads the agent's own session log from
  disk so the phone can still show history (e.g. the bridge missed the turns, or
  `threads.json` was lost). New `src/conversation/session-history.ts`
  (`SessionHistoryReader`) parses each agent's real on-disk format — Claude Code
  (`~/.claude/projects/<cwd>/<sessionId>.jsonl`), Codex
  (`~/.codex/sessions/.../rollout-*-<sessionId>.jsonl`), OpenCode (JSON
  message/part store under `~/.local/share/opencode/storage`, no SQLite dep) and
  pi (`~/.pi/agent/sessions/<cwd>/*_<sessionId>.jsonl`) — with a 60s path cache.
  To locate the file the agent's native session id is now persisted per thread:
  adapters expose `nativeSessionId(threadId)`, `AgentManager` records it via
  `ThreadStore.setAgentSession` on turn end, and the `turn/list` handler reads it
  through `getHistorySource`. Read-only and tolerant; returns nothing for
  unknown/unsupported agents. `turn/list` is unchanged on the wire.
- **Direct FCM push from the bridge (PRIMARY path; relay optional)** — background
  push is now delivered by the bridge itself over any transport (direct LAN,
  Tailscale, or relay), not only via a hosted relay. New `src/push/push-sender.ts`
  (`createBridgePushSender`) lazily loads `firebase-admin` (FCM HTTP v1) and reads
  the Firebase service account from `UXNAN_FCM_SERVICE_ACCOUNT`, defaulting to
  `~/.uxnan/firebase-service-account.json` (plug-and-play, no env var needed).
  `PushService` keeps the real device token and delivers direct-first, falling
  back to the relay `POST /push/notify` only when there's no local credential (or
  `relayEnabled`). `firebase-admin` is an `optionalDependency`: absent creds/module
  degrade to a silent no-op (foreground local notifications still work). Live FCM
  init validated against the real `uxnan-app` service account.

### Fixed
- **Push worked only with the relay enabled** — `register` previously always
  forwarded the token to the relay (and stored only the relay secret), so on the
  relay-off default nothing was stored and background push never fired. It now
  stores the device token locally for the direct path and contacts the relay only
  when that path is actually used.

### Fixed (agent wiring, validated live)
- **pi file edits now show as diffs** — pi's `edit` tool is
  `{ path, edits: [{ oldText, newText }] }` (verified live), not
  `old_string`/`new_string`; the mapper handles the `edits` array, so edits land
  in Changed files instead of an empty block.
- **Codex file changes now show a real per-line diff** — `file_change` reports
  only the path + kind, so the adapter runs `git diff HEAD -- <file>` to get the
  actual `−old/+new` hunks with accurate +/- counts (instead of painting the
  whole file green), falling back to the file's content as additions for new/
  untracked files or non-git dirs. (Caveat: `git diff HEAD` is the change since
  the last commit, so it includes any other uncommitted edits to that file.)
- **Context usage persists across re-open** — a turn's `usage` is now stored on
  its assistant message (`Message.usage`, via `ThreadStore.setUsage`) and
  returned in `turn/list`, so the phone restores the context meter instead of
  resetting it to 0.

### Added
- **Thinking + structured commands/tools/diffs for Codex, pi and OpenCode**
  (extends the Claude Code slices to every agent). A shared `content-blocks.ts`
  defines the `command_execution` / `diff` / generic `tool` block builders, and
  per-agent mappers (`codex-tools.ts`, `opencode-tools.ts`, `pi-tools.ts`)
  translate each CLI's events:
  - **Codex** (`exec --json` items): `reasoning` → thinking; `command_execution`
    → command block; `file_change` → per-file diff blocks; `mcp_tool_call` →
    tool block.
  - **OpenCode** (`run --format json` parts): `reasoning` → thinking (suffix
    deltas); `tool` parts (emitted at their terminal state) → command/diff/tool.
  - **pi** (`-p --mode json`): `thinking_delta` → thinking; tools paired from
    top-level `tool_execution_start` (args) + `tool_execution_end` (result) by
    `toolCallId` → command/diff/tool.

  > **Verified live** against codex-cli 0.139, opencode 1.17.4 and pi 0.79.1 by
  > running real turns and inspecting the JSON. This corrected the initial
  > guesses: OpenCode's event is `tool_use` (not `tool`); Codex `mcp_tool_call`
  > `result` is `{content:[{text}]}` (not a string); pi reports tools via paired
  > `tool_execution_*` events (not `tool_use` blocks in the message content).
  > Codex `file_change` carries the path only (no hunk/counts); pi/OpenCode
  > `reasoning` wiring is in place but those probe models didn't emit it.

### Fixed
- **Streamed answer no longer shrinks on re-sync.** On a tool-using turn,
  `claude`'s final `result.result` is often only the last segment of the answer;
  the adapter was storing that, so re-entering a conversation (which re-syncs
  from `turn/list`) dropped the earlier paragraphs. The completed turn now keeps
  the full streamed text (`full`) whenever partials were streamed, falling back
  to `result.result` only when nothing streamed.
- **Context usage reported even when the `result` event omits it.** The Claude
  adapter now also reads `usage` from each `assistant` message and uses the
  latest as a fallback, so the phone's context meter fills in instead of showing
  0 when `result.usage` is absent.

### Added
- **Structured tool / command / diff blocks** (second structured-content slice).
  The Claude adapter (`claude-adapter.ts` + new `claude-tools.ts`) parses the
  `tool_use` blocks from each `assistant` message and pairs them with the
  matching `tool_result` from the following `user` message, mapping them to
  MessageContent JSON: **Bash → `command_execution`**, **Edit/MultiEdit/Write/
  NotebookEdit → `diff`** (synthesized −old/+new hunks with +/- counts), and
  **everything else → a generic `tool`** block (output truncated to 4 KB). The
  `AgentManager` emits each as a new `stream/content/block` notification and
  `ThreadStore.appendBlock` persists it; `Message.blocks` is serialized so it
  survives `turn/list`. Contracts: `AgentStreamEvent 'block'`,
  `StreamNotification.ContentBlock` + `ContentBlockParams`, `Message.blocks?`.
  This is what populates the phone's Work log / Changed files. (Codex/pi next.)
- **Agent "thinking" streamed and persisted** (first structured-content slice).
  The Claude adapter (`claude-adapter.ts`) now parses extended-thinking
  `thinking_delta` blocks from the stream-json output and emits a new
  `thinking` agent event (kept separate from answer text). The `AgentManager`
  forwards it as a new `stream/thinking/delta` notification and accumulates it on
  the assistant message via `ThreadStore.appendThinking`; `Message.thinking` is
  serialized so it survives `turn/list`. Contracts: `AgentStreamEvent` gains
  `'thinking'`, `StreamNotification.ThinkingDelta` + `ThinkingDeltaParams`, and
  `Message.thinking?`. (Codex/pi thinking + structured commands/diffs are the
  next slices.)
- **pi agent wired** (`src/adapters/pi-adapter.ts`, `resolve-pi.ts`, registered in
  `bridge.ts`): drives the `pi` CLI (`@earendil-works/pi-coding-agent`) via
  `pi -p --mode json`, parsing its newline-JSON stream (streamed `text_delta`s,
  final text + `usage.totalTokens`, `session` id for `--session-id` continuity,
  `stopReason`/`errorMessage` and plain-text startup errors). Model selection
  (`--model provider/model`), reasoning effort (`--thinking`, advertised per model
  from `pi --list-models`' `thinking` column), and a tool posture
  (`permissionMode`: `acceptEdits` default / `default` read-only / `bypassPermissions`)
  are all wired. Auth detected by `~/.pi/agent/auth.json` existence. Reports
  `reportsContextUsage`. Validated against `pi` 0.79.1.
- **Agents advertise `reportsContextUsage`** (`claude-adapter.ts`,
  `codex-adapter.ts`): Claude and Codex set the new capability flag so the phone
  shows their context meter (at 0 before the first turn); OpenCode leaves it
  false (it reports no usage).
- **Per-model run-option knobs advertised + applied** (`src/adapters/run-options.ts`,
  `claude-adapter.ts`, `codex-adapter.ts`, `opencode-adapter.ts`,
  `agent-manager.ts`, `handlers/thread-context-handler.ts`): `agent/models` now
  advertises a `reasoning` effort enum per model, and `turn/send` accepts the
  chosen values under `options` (mapped to `--effort` / `-c
  model_reasoning_effort=` / OpenCode `--variant`). The legacy flat `effort`
  remains a fallback. The effort levels are the **real per-agent options**:
  **Codex** discovers them per model from the app-server `model/list`
  (`supportedReasoningEfforts` + `defaultReasoningEffort` — so each model offers
  exactly what it supports, e.g. `low/medium/high/xhigh` with the right default;
  the `config.toml` fallback uses a generic set); **Claude** uses the levels its
  `--effort` flag accepts (`low/medium/high/xhigh/max`, verified against `claude
  --help` — `ultrathink`-style keywords are prompt triggers, not effort levels).
  OpenCode advertises no knob yet (its `--variant`s are provider/model-specific,
  enumerated at runtime). Phase 2–3 of the per-model run-options seam (the phone
  renders whatever is advertised, so new levels need no app change).

### Fixed
- **pi model picker no longer empty** (`src/adapters/pi-adapter.ts`, `src/adapters/spawn.ts`):
  `pi --list-models` prints its table to **stderr**, but `listModels()` only read
  stdout, so `agent/models` returned `[]` and the phone's model selector showed no
  models when pi was the agent. The adapter now accumulates **both** stdout and
  stderr before parsing (stdin/stdout split verified against `pi` 0.79.1: `-p --mode
  json` events stay on stdout, so turn streaming is unaffected). `SpawnedProcess`
  gains an optional `stderr` stream.
- **Reasoning effort now reaches Claude Code and Codex** (`src/adapters/claude-adapter.ts`,
  `src/adapters/codex-adapter.ts`): `turn/send`'s `effort` was carried by the
  contract but silently dropped by both adapters (only OpenCode consumed it via
  `--variant`). Claude now passes `--effort <low|medium|high|xhigh|max>` and Codex
  passes `-c model_reasoning_effort=<low|medium|high>` (both flags verified against
  the installed CLIs' `--help`). Closes the silent-drop gap with the existing
  `effort` field — phase 1 of "Per-model run options" in `FOR-DEV.md`.

### Added
- **Claude Fable 5 model** (`src/daemon-config.ts`, `src/adapters/claude-adapter.ts`):
  seed Claude Code's picker with `claude-fable-5` ("Fable 5", the new top tier
  above Opus) and map it to a 1M context window in `claudeContextWindow()` so the
  phone shows context usage as a percentage. The `opus`/`sonnet`/`haiku` aliases
  still cover "latest" for their tiers.
- **`auth/status` sanitized, per-agent** (`src/account-status.ts`,
  `src/handlers/account-handler.ts`): replaces the not-implemented stub with a
  real handler that takes `{ agentId }` and returns a SANITIZED `AuthStatus`
  (`agentId`, `requiresLogin`, `loginInProgress`, `authenticatedProvider?`,
  `transportMode: 'local'`, `platform`) — **never** tokens/keys. Login is detected
  by the EXISTENCE only of each agent's well-known auth file (Codex
  `~/.codex/auth.json`, Claude `~/.claude/.credentials.json`/`~/.claude.json`,
  OpenCode `~/.local/share/opencode/auth.json`) — contents are never read; an
  agent without a mapping falls back to binary availability, an unknown agent is
  rejected with `-32602`. `AgentManager` gains `isAvailable(agentId)`.
  `auth/login`/`auth/logout` remain stubs (interactive CLI login is a follow-up).
- **Checkpoint retention (prune)** (`src/workspace/checkpoint-service.ts`,
  `src/daemon-config.ts`): each `workspace/checkpoint` now prunes old checkpoints
  beyond a per-project count cap (`checkpointMaxPerProject`, default 25) and/or an
  age TTL (`checkpointTtlDays`, default 0 = off), deleting both the
  `refs/uxnan/checkpoints/*` anchor and the `checkpoints.json` entry — so the set
  no longer grows unbounded.
- **Per-project agent/model pins** (`src/daemon-config.ts`,
  `src/projects/project-registry.ts`, `src/handlers/thread-context-handler.ts`):
  a new `projectAgents: AgentConfig[]` config (each entry's `cwd` identifies the
  project) lets a repo pin a default `agentId`/`model`. `ProjectRegistry` now
  consumes it — `project/list`/`resolve` surface the pin on `Project` and a new
  `agentConfigFor(cwd)` exposes it — and `thread/start` falls back to the pinned
  agent (then the global `defaultAgent`) when the phone omits `agentId`. The
  pinned model only applies when the resolved agent IS the pinned one, so an
  explicit agent override never inherits a foreign model. Consumes the shared
  `AgentConfig` that was previously defined-but-unused.
- **Push registrations persist + multi-session** (`src/push/push-service.ts`,
  `src/bridge.ts`): registrations are now keyed by relay `sessionId` and stored
  to `~/.uxnan/push-state.json` (atomic write), restored at startup via
  `PushService.load()`. Background push therefore survives a bridge restart
  WITHOUT the phone re-registering (the relay still holds its sessionId→token
  map; the bridge only needs `sessionId` + `notificationSecret` to notify). A
  turn-end now pushes to **every** registered phone, so multiple paired devices
  each receive background push. `register`/`updatePreferences`/`unregister` act
  on the active session.
- **`bridge/removeTrustedDevice` implemented** (`src/handlers/bridge-control-handler.ts`):
  revokes a phone's trust (`trustStore.remove`) and drops any live session/sink
  (`sessions.remove` + `sessionRegistry.unregister`) so a removed device is both
  untrusted and disconnected immediately. Idempotent — removing an absent device
  is not an error (the phone deletes locally first and calls this best-effort).
  Previously threw `methodNotImplemented`. Unblocks the device-management UI.
- **Thread lifecycle handlers** (`src/handlers/thread-context-handler.ts` +
  `src/conversation/thread-store.ts`): `thread/rename`, `thread/archive`,
  `thread/unarchive` and `thread/delete` are now wired. `ThreadStore` gains
  `renameThread` / `archiveThread` / `unarchiveThread` (status → `archived` /
  `active`, returning the updated `Thread`) and `deleteThread` (removes the
  thread and its turns, rejecting an unknown id with `-32008`). The mobile app
  already called these best-effort to mirror local changes; they now persist on
  the bridge so archive/rename/delete survive a phone reinstall or a second
  device. Closes the "Thread management" item in `FOR-DEV.md`.

### Changed
- **Checkpoint `apply` is now a true worktree restore**
  (`src/workspace/checkpoint-service.ts`): besides restoring the snapshot's file
  contents (recreating deleted files, overwriting modified ones), it now also
  DELETES files created after the checkpoint, so the working tree matches the
  snapshot exactly — full parity with the mobile `AiChangeSet` revert. Extras are
  detected by snapshotting the current tree into a temp index (HEAD + `add -A`,
  respecting `.gitignore`, leaving the user's real index untouched) and diffing
  snapshot → now; the op stays worktree-only and never removes gitignored files.
- **`bridge/status.relayConnected` reflects the real relay connection**
  (`src/bridge-context.ts`, `src/bridge.ts`, `src/handlers/bridge-control-handler.ts`):
  the handler previously hard-coded `false`. `BridgeContext` now exposes
  `relayConnected()`, backed by the live relay-serve state (`relayState.connected`),
  so the phone's `bridge/status` reports whether a relay session is actually
  serving. `bridge/trustedDevices` also reads through `ctx.trustStore` now.

### Fixed
- **`thread/start` on a browsed folder no longer fails with "unknown project".**
  `src/handlers/thread-context-handler.ts` required `projects.byId(projectId)`
  to resolve, but a directory picked via `workspace/browseDirs` is SYNTHESIZED
  into a project that isn't in `workspaceRoots`, so `byId` threw
  `ResourceNotFound` and the thread was never created — every later `turn/send`
  then failed with `-32008 thread not found`. The phone always sends the chosen
  `cwd`, so use it directly and only resolve the project by id as a cwd fallback
  when none is given. This unblocks the plug-and-play folder-browser flow.

### Changed
- **Relay is off by default** (`daemon-config.ts`): `relayEnabled` now defaults
  to `false`, so a fresh install is LAN/Tailscale-direct with **zero hosting**
  and the pairing QR carries only the direct `hosts`. The relay is **optional
  and self-hosted** — set `relayEnabled: true` + `relayUrl` to your own relay to
  add an off-LAN fallback. Docs updated with how to enable + self-host
  (`docs/connectivity.md`, `docs/configuration.md`, `relay/docs/deploy.md`).
- **Directory browsing defaults to the bridge's launch directory** — when no
  `browseRoots`/`workspaceRoots` are configured, `workspace/browseDirs` now
  roots at `process.cwd()` (where the bridge was started) instead of the user's
  home directory, matching `ProjectRegistry`. Zero-config plug-and-play: start
  the bridge in the folder you want the phone to reach and that folder (plus its
  sub-directories) is the root. (`workspace/browse-service.ts`.)

### Added — per-turn token usage
- **Context usage reporting** (`adapters/claude-adapter.ts`,
  `adapters/codex-adapter.ts`, `agents/agent-manager.ts`): Claude parses the
  `result` event's `usage` and reports `tokens` (input + cache + output) with
  the model's context window (Opus/Sonnet 1M, Haiku 200K); Codex sums
  input + output + reasoning tokens from `turn.completed.usage` (no window in
  exec mode). `AgentManager` forwards `usage` onto the `turn/completed`
  notification. Exposes `claudeContextWindow`/`claudeUsageTokens`/`codexUsageTokens`.

### Added — account-aware model discovery for Codex & Claude Code
- **Codex `listModels()`** (`adapters/codex-adapter.ts`): `codex exec` has no
  enumerate command, so the adapter drives the same protocol the desktop app
  uses — spawns `codex app-server` and runs the `initialize` → `model/list`
  JSON-RPC handshake (newline-delimited JSON over stdio). The list is
  account-aware (free vs paid changes it). Falls back to `~/.codex/config.toml`
  (`model` + the `[tui.model_availability_nux]` table) when the app-server is
  unavailable. Exposes `parseCodexModelList` / `parseCodexConfigModels`.
  Verified live against `codex-cli` 0.138 (returned `gpt-5.5` + `gpt-5.4-mini`).
- **Claude Code resolved-version surfacing** (`adapters/claude-adapter.ts`):
  `parseClaudeLine` now extracts `model` from the `system/init` event and the
  adapter emits a `model_resolved` stream event, so the phone can show the
  concrete version an alias mapped to (e.g. `opus` → `claude-opus-4-8`).
  `model_resolved` is forwarded as `stream/model/resolved` by `AgentManager`.

- **Pinned Claude Code models via config** (`daemon-config.ts`,
  `adapters/claude-adapter.ts`): new `agents.<id>.models` setting — an array of
  bare id strings or `{ id, displayName?, description? }` specs — surfaces
  concrete, versioned models in the picker **alongside** Claude Code's stable
  aliases. The aliases now render as `Opus (latest)` / `Sonnet (latest)` /
  `Haiku (latest)`; pinned ids that collide with an alias are dropped.
  `DEFAULT_DAEMON_CONFIG` seeds Claude Code with `claude-opus-4-8`/`-4-7`,
  `claude-sonnet-4-6`, `claude-haiku-4-5` so a fresh install shows exact
  versions out of the box. Docs: [`docs/agents.md`](docs/agents.md),
  [`docs/configuration.md`](docs/configuration.md).
- **Per-agent config merge** (`resolveDaemonConfig`): agent settings are now
  deep-merged one level, so a partial override (e.g. just `permissionMode`)
  preserves seeded defaults like `models` instead of replacing the whole agents
  map. Set an explicit empty value (`models: []`) to clear a seeded default.

### Changed
- **`listModels()` / `agent/models` return structured `AgentModel[]`** instead
  of bare id strings (Claude/OpenCode/Codex adapters + `AgentManager.getModels`).
  Claude exposes the stable aliases with readable labels (`Opus`/`Sonnet`/
  `Haiku`) and a description; OpenCode/Codex carry id + displayName + default.

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
