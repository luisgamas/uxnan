# FOR-DEV — pending developer work

Deferred implementation work (code the team/agent will do later). Distinct from
`FOR-HUMAN.md` (assets only a human can provide). Search the codebase for
`FOR-DEV:` to jump to the exact deferral sites.

> Convention defined in the root `AGENTS.md` → "Pending developer work".

## Recommended next steps (mobile-only, no live bridge needed)

These can be built and unit/widget-tested locally; bridge calls degrade
gracefully until the other agent wires the handler. Suggested order:

1. ☑ **Advanced content `approval`/`plan`/`subagent`** (decode + read-only
   render) — DONE this round. Remaining: interactive approval (needs a bridge
   RPC) and verifying wire shapes against a real Codex/Claude turn.
2. ☑ **Archive thread** (+ an "Archived" screen) — DONE this round; see
   *Threads list → Archive / unarchive*.
3. ☑ **Settings screen + notification preferences** (`notifications/update`) —
   DONE this round; see *Push notifications → Notification preferences UI*.
4. ☑ **Remove device** (clear a stale paired PC) — DONE; see *Threads list*.
5. ☑ **Voice → text in the composer** — DONE and **verified on-device**
   (2026-06-11): `speech_to_text` wired to the composer mic (guarded
   `SpeechToTextService`, `speechToTextServiceProvider`, live partial→final
   dictation into the field, recording state, graceful "unavailable" snackbar).
   Android `RECORD_AUDIO` added. ☐ iOS Info.plist usage strings remain FOR-HUMAN
   (`FOR-HUMAN.md` §3).

Everything else below needs the bridge/relay (history pagination, per-file diff,
extended git actions, LAN discovery, manual-code pairing, APNs) and is best done
once a live bridge is reachable. (Real token usage, model discovery, the folder
browser and multi-PC connection correctness are now DONE — see below.)

---

## Pairing module

- ☐ **Manual-code pairing** — `ManualCodeScreen` + relay `GET /trusted-session/resolve?code=`
  (dio) to synthesize a `PairingPayload` (spec §5.5.3). Deferred: QR is the MVP
  method and the relay is not implemented yet.
- ☑ **Pairing/onboarding UI** — DONE: `OnboardingScreen` (Welcome/Features/
  Install/Pair), `QrScannerScreen` (`mobile_scanner` + permission gating),
  `UpdatePromptDialog`, routes and home CTA. Still open below.
- ☐ **iOS camera permission macro** — `permission_handler` needs
  `GCC_PREPROCESSOR_DEFINITIONS` `PERMISSION_CAMERA=1` in the iOS Podfile
  `post_install`. The Podfile is generated on the first macOS build; add the
  macro there or `Permission.camera` is compiled out on iOS.
- ☑ **`MyDevicesScreen` + `DeviceCard`** — DONE: the home is now the paired-PC
  list (`SliverAppBar.large`, per-device card with name, relay host, status
  badge, last-seen, rename via `TrustedDevice.copyWith`+`saveDevice`, and a
  Connect CTA → `SessionCoordinator.switchMac`). Reactive via the new
  `watchDevices()` / `trustedDevicesProvider`. Tapping a card sets the active
  device and opens its threads. Empty → the pair/onboarding state.
- ☑ **Connect UX polish — validated, truthful per-device status.** Per-device
  status now keys off the device that actually holds the live channel
  (`connectedDeviceProvider`) and the one being attempted
  (`connectingDeviceProvider`), not the global phase — so browsing a PC never
  fakes a connection. `switchMac` is **probe-then-commit**: it opens the target
  session and only swaps once the handshake completes, staying on the current PC
  (with an error message) if the target is unreachable. The Connect CTA shows a
  connecting state and surfaces failures; a **"Verify connection"** action still
  probes via encrypted `bridge/status`. ☐ Remaining: end-to-end verification on
  a live bridge across two PCs.
- ☑ **On-device pairing verification** — DONE: the QR happy path completes
  `processPairingPayload` end-to-end against a live bridge on a real Android
  device, over both **Tailscale** (`100.x`) and the **LAN** (once allowed through
  Windows Firewall). Trusted-reconnect on a later launch also works.
- ☐ **Standalone pairing use cases** — the spec lists `StartPairing`,
  `RegisterTrustedDevice`, `RemoveTrustedDevice` under `domain/usecases/pairing/`.
  Currently folded into `SessionCoordinator.processPairingPayload` +
  `ITrustedDeviceRepository`; split out only if the indirection earns its keep.

## Connection / transport

- ☑ **IncomingMessageProcessor** — DONE (conversation managers).
- ☑ **Consume `bridge/status.relayConnected`** — DONE: `BridgeStatus` entity +
  `bridgeStatusProvider` (refreshes when the connected device changes) drive a
  **Relay / Direct** transport indicator on the connected PC card. Previously
  `bridge/status` was only used as a reachability ping and the field was
  ignored. ☐ On-device: verify it reads Relay over a hosted-relay session and
  Direct on a LAN/Tailscale session.
- ☑ **Direct LAN/Tailscale transport (hosts-first, relay fallback)** — DONE:
  the bridge advertises its direct `host:port` addresses in the pairing QR
  (`hosts`), so the phone no longer needs mDNS/Bonjour discovery.
  `DirectTransportSelector` tries each direct host (`ws://host:port`, short
  timeout) before falling back to the relay (spec §5.9.3); `PairingPayload`/
  `TrustedDevice`/the drift `trusted_devices` table (v4) carry `hosts`, and
  `relay` is now optional. **Still open:**
  - ☑ **On-device verification (Android)** — DONE: paired end-to-end against a
    live bridge over **Tailscale** (`100.x`), and over the **LAN** once allowed
    through **Windows Firewall** (the block was the sole connection failure — the
    phone couldn't even ping the PC; the fix was enabling *File and Printer
    Sharing (Echo Request - ICMPv4-In)* plus the TCP LAN port — see
    `bridge/docs/connectivity.md` Troubleshooting). iOS still pending (below).
  - ☐ **iOS local-network permission** (`NSLocalNetworkUsageDescription`) — a
    direct LAN socket on iOS prompts for local-network access; add the Info.plist
    key (FOR-HUMAN once the iOS build exists) so direct LAN works on iPhone.
    Tailscale/relay are unaffected.
  - ☐ **mDNS/Bonjour discovery** — only needed for a bridge that did NOT
    advertise reachable `hosts` (e.g. dynamic IPs); the QR `hosts` cover the
    common case, so this is now optional.
- ◑ **Live WebSocket integration test** against a real bridge — the real-bridge
  interaction is now **manually validated on-device** (pairing, `thread/list`,
  `thread/start`, `turn/send` + streamed `stream/*` replies, `turn/list`
  re-sync). ☐ Still: an **automated** integration test (current automated tests
  use an in-memory simulated bridge).

## Persistence

- ☑ **Message drift repository + `MessageContent`** — DONE (conversation domain
  layer).
- ☐ **Project drift repository** — `projects` table exists; the repository plus
  the `AgentConfig` type land with the projects module.

## Threads list

- ☑ **Threads screen** — DONE: `ThreadsScreen` (route `/device/:deviceId/
  threads`) lists the active PC's threads (`SliverAppBar.large`, agent logo via
  `AgentLogoChip` + `AgentVisuals`, title, last-activity time, status dot,
  agent·cwd subtitle), with **per-agent filter chips** (shown when >1 agent is
  present), and navigates to `/conversation/:id`. Pull-to-refresh calls
  `ThreadManager.loadThreads` **only when connected** (guarded + 15s timeout, so
  the indicator no longer spins forever offline).
- ☑ **Search / sort / density + unread style** — DONE (new, beyond the original
  scope): shared `thread_list_controls.dart` powers both the active and archived
  lists. **Search** is the M3 full-screen `SearchAnchor` (title / id / agent /
  folder); **sort** is an M3 menu (creation date — newest first by default —,
  name, folder); a **compact** density toggle; all kept to the M3 ≤3-actions
  app-bar guideline (Search + Sort visible, density + Archived in a `⋮` overflow
  menu). Threads with an **unread agent reply** are emphasized (tint + bold +
  dot), cleared on open. Sort/density preference is in-memory (☐ persistence is
  an optional follow-up).
- ◑ **Scope threads to the connected PC / project** — **PC scoping DONE +
  connection-targeting DONE**: `Thread.deviceId` tags each thread with its PC and
  the list filters by it. Crucially, **all live actions now target the PC we
  actually hold a channel to**, not merely the one being browsed: the threads
  online dot, the new-conversation FAB and refresh are gated on
  `connectedDeviceProvider == this PC` (with an offline banner offering a
  validated Connect), and the conversation composer is disabled unless connected
  to the thread's PC — so a message can never be sent over a *different*
  connected PC's channel. Browsing a PC no longer changes the connection target
  (`setActiveDevice` removed from the browse path). ☐ Still open:
  **project**-level scoping (drive `loadThreads(projectId:)` once the session
  exposes the active project). The `thread/list` JSON shape is still assumed
  (tolerant parser) — verify against the real bridge.
- ◑ **Thread actions** — **new thread DONE**: a "New conversation" FAB on
  `ThreadsScreen` opens `NewConversationSheet` (pick project via `project/list`,
  agent via `agent/list`, model via `agent/models`) → `ThreadManager.startThread`
  (`thread/start`) → navigates to the conversation. Threads are scoped to the
  selected PC (`Thread.deviceId`). The sheet also offers a **"Browse…"** action
  (folder browser, see *Conversation / timeline → Folder browser* below) to root
  a thread in any directory; the chosen folder is resolved to a project
  (`project/resolve`) and started via `thread/start { cwd }`.
  - ☑ **Delete thread** — DONE (mobile): long-press menu on `ThreadsScreen` →
    `ThreadManager.deleteThread` removes locally + calls `thread/delete`
    (best-effort, degrades gracefully).
  - ☑ **Archive / unarchive thread + "Archived" screen** — DONE (mobile):
    `ThreadManager.archiveThread`/`unarchiveThread` flip the local
    `ThreadStatus` (best-effort `thread/archive`/`thread/unarchive`, graceful
    degradation; nothing deleted). `ThreadsScreen` hides archived threads + an
    **Archived** app-bar action → `ArchivedThreadsScreen`
    (`/device/:deviceId/archived`, per-PC) where they're reopened / unarchived /
    deleted. Shared `ThreadTile` (`thread_tile.dart`) backs both lists. Archived
    threads are derived from `threadsProvider` filtered by
    `status == archived` (no new repo query needed — the watch already streams
    all threads). Bridge `thread/archive`/`thread/unarchive` handlers are the
    other agent's side.
  - ☑ **Rename thread** — DONE (mobile): long-press menu → rename dialog →
    `ThreadManager.renameThread` (local-first + `thread/rename`, graceful
    degradation). Bridge `thread/rename` handler is the other agent's side.
  - ◑ **Expose the thread id in the UI** — **thread id DONE**: long-press "Copy
    thread ID" + a copyable **Thread ID** row in `SessionStatusSheet` (resume a
    conversation from the CLI on the PC). ☐ Still: surface the agent's **session
    id** (e.g. OpenCode `sessionID`) once the bridge exposes it via `thread/read`.
  - ☑ **Remove device** — DONE: a destructive "Remove device" action in the PC
    card's overflow menu (`my_devices_screen.dart`). After a confirm dialog it
    calls `SessionCoordinator.removeTrustedDevice` (sends
    `bridge/removeTrustedDevice` with the phone's OWN id — the bridge keys trust
    by phone — best-effort, only while connected to that PC; then disconnects),
    deletes the device's local threads/messages/turns
    (`IThreadRepository.deleteThreadsByDeviceId`) and the `TrustedDevice`. Lets
    the user clear a stale PC and fully unpair. ☐ On-device: verify a removed PC
    disappears, its threads are gone, and the bridge drops trust (no
    trusted-reconnect afterwards).

## Conversation / timeline

- ◑ **Advanced `MessageContent` types** — `approval`, `plan`, `subagent`:
  - ☑ **Decode + read-only render** — DONE: `ApprovalContent`/`PlanContent`/
    `SubagentContent` + value objects (`ApprovalRequest`, `PlanState`/`PlanStep`,
    `SubagentState`/`SubagentAction`) + enums (`ApprovalRisk`, `PlanStepStatus`,
    `SubagentActionKind`); tolerant codec (nested or flat) with graceful enum
    fallback. Renderers: approval card, plan checklist, subagent card
    (`message_content_view.dart`). Covered by round-trip + render tests.
  - ☐ **Interactive approval** — the Approve/Reject buttons are disabled; wiring
    a response needs a bridge RPC (`turn/send { approvalResponse: { approvalId,
    approved } }`, spec 01 §283). Add an `approvalRespond` seam on `ThreadManager`
    when the bridge exposes it; then enable the buttons.
  - ☐ **Verify wire shapes** against a real Codex/Claude turn (field names for
    plan steps / subagent actions are assumed; the parser is tolerant).
- ☑ **Application managers** — DONE: `ThreadManager` (timeline build + streaming
  reducer application, `loadThreads`, `sendUserMessage`) and
  `IncomingMessageProcessor`.
- ☑ **Live conversations survive navigation + per-thread activity** — DONE:
  `ThreadManager` (a singleton) buffers each thread's in-flight turn in memory
  and applies streaming events for **all** threads, not just the on-screen one,
  so leaving and re-entering a conversation keeps the streaming response
  rendering/updating. Answers that complete off-screen are persisted (keyed by
  the deterministic `stream-<turnId>` id) and shown on return; entering a thread
  re-syncs it from the bridge (`turn/list`) to recover anything missed (e.g.
  after an app restart). A new `ThreadActivity` (running/error/idle) is exposed
  per thread (`threadActivityProvider`) and the list card shows a **"Responding…"
  spinner** while a conversation is working.
- ☑ **Folder browser (`workspace/browseDirs`)** — DONE (the mobile half the
  bridge `FOR-DEV.md` was waiting on): `BrowseRoot`/`BrowseDirEntry`/
  `BrowseResult` entities (tolerant parsers), a `WorkspaceBrowser` manager +
  provider, and a `WorkspaceBrowserSheet` (root picker, breadcrumb, git-repo
  badges, "Open here"). Wired into `NewConversationSheet` as **"Browse…"** →
  resolve the chosen `cwd` to a project (`project/resolve`) → `thread/start
  { cwd }`. The configured `project/list` stays as the shortcut. ☑ **On-device
  verification DONE**: browsing a real root, picking a folder and starting a
  thread there works against a live bridge. (This flow surfaced a bridge bug —
  `thread/start` required a *registered* project, failing for a browsed,
  synthesized one — fixed in `bridge/`; the phone also no longer fabricates a
  phantom local thread when `thread/start` errors.)
- ◑ **Remote history pagination** — `ThreadManager.selectThread` now **re-syncs**
  a thread from the bridge (`turn/list`) on open, persisting any assistant answer
  not stored locally (keyed by `stream-<turnId>`, so it never duplicates) — this
  recovers in-flight turns after an app restart. ☐ Still open: true paged
  back-history (`loadMoreHistory` with a cursor → `prependHistory`) and
  `resumeThread`/`forkThread`. The `turn/list` JSON shape is assumed (tolerant
  parser); verify against the real bridge.
- ☑ **Conversation UI (visual layer)** — DONE: `ConversationScreen`
  (`SliverAppBar.large`, floating + snap, auto-scroll), message renderers
  (`MessageBubble` + `MessageContentView`: markdown, code, command card, diff,
  system banner, streaming dots), the `ComposerBar`, `SessionStatusSheet` and
  `ApprovalModeSheet`. **Refined since (M3):** the composer is now a
  **bottom-anchored bar** (`surfaceContainer` + hairline, no floating card); the
  app-bar git affordance is a single commit `IconButton` (the redundant branch
  chip was dropped); and the header shows a **"Responding…"** spinner while the
  agent works (the per-thread activity, also on the list).
- ☑ **Agent thinking (reasoning) — first structured-content slice** — DONE
  (Claude Code, end-to-end): the bridge parses `thinking_delta` and emits
  `stream/thinking/delta` (persisted via `Message.thinking`); the phone decodes a
  `ThinkingContent` block and renders a **collapsible "Thinking" section**
  (default collapsed) at the top of the turn, gated by **Settings → Conversation
  → "Show agent thinking"** (`showAgentThinkingProvider` + on-device store).
  Streams live; kept out of copy/previews. Extended to **all agents** (below).
- ☑ **Structured commands / tools / diffs (second slice) — Work log & Changed
  files now populate** — DONE (Claude Code, end-to-end): the bridge pairs each
  `tool_use` with its `tool_result` and emits a `stream/content/block`
  (`command_execution` for Bash, `diff` for Edit/Write, generic `tool`
  otherwise; persisted via `Message.blocks`). The phone decodes it
  (`ContentBlockEvent` → reducer → `_LiveTurn.blocks`) and `AssistantTurnView`
  already routes those into the **Work log** / **Changed files** sections and the
  **Last edits** strip — so they fill in live and after a re-sync. Covered by
  unit tests both sides.
- ☑ **Thinking + structured blocks for Codex, pi & OpenCode** — DONE &
  **verified live** (codex-cli 0.139 / opencode 1.17.4 / pi 0.79.1, by running
  real turns and inspecting the JSON). Bridge-only (the phone was already
  generic): shared `content-blocks.ts` builders + per-agent mappers
  (`codex-tools.ts`, `opencode-tools.ts`, `pi-tools.ts`). Codex `command_execution`
  /`file_change`/`mcp_tool_call`; OpenCode `tool_use` parts; pi paired
  `tool_execution_start`+`_end`. End-to-end checked against captured logs — all
  produce the right command/diff/tool blocks. ☐ Remaining: Codex `file_change`
  carries the path only (no hunk/counts); Codex/OpenCode `reasoning`→thinking is
  wired but the probe models didn't emit reasoning (re-verify with a reasoning
  model); richer per-file diff via a `git/diff` viewer.
- ☑ **Structured agent turns (no bubble) + work log / changed files / copy** —
  DONE: assistant replies render full-width without a bubble (`AssistantTurnView`)
  — only user messages keep a bubble — so the whole answer is one clean
  selectable surface (consecutive text merged, fixing the fragmented-selection
  copy bug). A collapsible **Work log (N)** groups the turn's command/tool runs;
  a collapsible **Changed files (N) · +a −d** lists the turn's diffs (each file
  expands to its unified diff); a **Copy response** action copies the full prose;
  and a compact green/red **Last edits** strip above the composer mirrors the
  latest turn's totals. Diff +/- counters are color-coded. Covered by widget
  tests. ☐ Follow-ups: default-expanded work log while a turn streams; tap the
  Last-edits strip to jump to the changed-files section; per-file diff viewer
  (`git/diff`, see *Git*) for richer diffs.
- ◑ **Wire conversation controls to real bridge data** — the environment is now
  built from the active `Thread` + live git state (no more
  `SessionEnvironment.sample()`); remaining items below need real RPCs:
  - ☑ **Model indicator + selector** (`ComposerBar._ModelChip`,
    `SessionStatusSheet` model row) → shows the real thread model (from
    `Thread.model`, falling back to the agent label) and the chip opens
    `ModelPickerSheet` (`agent/models`) → `ThreadManager.setThreadModel`
    (`thread/setModel`), persisting the pick locally. DONE. **Enhanced since:**
    `agent/models` is now a structured `AgentModel[]` (`id`/`displayName`/
    `description`/`version`/`isDefault`); the picker shows readable names, a
    **Default** badge and id/version/description. Claude Code exposes the
    `opus`/`sonnet`/`haiku` aliases as **"(latest)"** plus any concrete versions
    pinned in `agents.claude-code.models`, and the **resolved** version of an
    alias (from the `stream/model/resolved` event) shows as an "Active version"
    row in the status sheet. Codex enumerates its account-aware models via
    `codex app-server` (`model/list`).
  - ☑ **Context badge — wired to real token usage.** The bridge now reports a
    turn's `usage { tokens, contextWindow? }` on `stream/turn/completed`
    (Claude parses the `result` event + maps the tier window — Opus/Sonnet 1M,
    Haiku 200K; Codex sums `turn.completed.usage`, no window in exec mode).
    `ThreadManager` tracks it per-thread (`contextUsageProvider`); the composer
    shows a **percentage ring** when the window is known and a **raw token
    count** otherwise (Codex), and the status-sheet context row mirrors it.
    The meter is now **always visible at a 0 baseline** for agents that report
    usage — gated on the per-agent `reportsContextUsage` capability (Claude/Codex
    true, OpenCode false) — so it no longer only appears after the first turn.
    OpenCode reports no usage and shows nothing. (Verified the Codex/Claude
    `usage` shapes against a real turn.)
  - ☑ **Per-model run-option knobs (data-driven).** DONE (phase 3 of the bridge
    seam): a generic control bar above the composer renders the knobs the bridge
    advertises on `agent/models` (`AgentModel.options`) for the thread's model —
    today a `reasoning` effort enum on Claude/Codex — and sends the chosen values
    on `turn/send` via `options` (`runOptionSelections` notifier, per thread).
    `enum` → value menu, `toggle` → filter chip, unknown kinds ignored, so new
    knobs/agents need no app change. ☐ On-device: verify picking an effort
    changes the agent's behavior on a live bridge. (Phase 4 — fast-mode/context —
    has no validated CLI argv flag yet; the renderer is already forward-ready.)
  - ◑ **Approval mode** (`ApprovalModeSheet`) → now an explicit local per-thread
    setting (no sampled value); the status-sheet row is **gated by the agent's
    `approvals` capability** (`agentCapabilitiesProvider`). ☐ Read/persist via an
    access-mode RPC when one exists.
  - ☑ **Git branch / remote / local** (`_EnvironmentChip`, status-sheet git
    section) → real values from `git/status` via `gitRepoStateProvider`; the
    commit/push rows call `GitActionManager.commit` / `.push` against the active
    thread's `cwd`.
  - ◑ **Attach** (`ComposerBar` add button) → the button is now **gated by the
    agent's `images` capability** (hidden when unsupported). ☐ Still a disabled
    placeholder when shown: file/image picker → upload as `ImageContent` /
    attachment (FOR-DEV).
  - ☑ **Voice** (`ComposerBar` mic button) → DONE: on-device speech-to-text
    dictates into the composer (`speech_to_text`, guarded `SpeechToTextService`),
    live partial→final with a recording state; verified on-device. See
    *Recommended next steps → Voice → text*.
  - ☑ **Stop the turn** (`ComposerBar`) → DONE: while a turn streams, Send
    becomes a Stop button that cancels it (`turn/cancel` via
    `ThreadManager.cancelTurn`) without closing the thread.
  - ☑ Removed `SessionEnvironment.sample()`, `demo_seed.dart` and the home
    preview entry from the default UX.

## Git

- ☑ **Git logic layer** — DONE: `GitActionManager` (status/commit/push with
  per-phase push progress from `stream/git/progress`), `GitRepoState` +
  `GitDiffTotals` / `GitChangedFile`, `GitActionProgress` / `GitActionPhase`,
  commit/push params + results, `GitProgressEvent` (classified by
  `IncomingMessageProcessor`), and `DriftGitActionLogRepository` recording each
  action to the `git_action_log` table. Providers: `gitActionManagerProvider`,
  `gitRepoStateProvider`, `gitActiveActionProvider`,
  `gitActionLogRepositoryProvider`. Covered by unit tests.
- ☐ **Verify the `git/status` JSON shape against a real bridge** — the parser
  (`GitRepoState.fromJson`) is tolerant but assumes a shape (`branch`,
  `upstream`, `isDirty`, `ahead`, `behind`, `diffTotals`, `changedFiles`);
  confirm field names/types once the bridge git handler is reachable. Same for
  the `git/commit` (`sha`, `message`) and `git/push` (`branch`, `remote`)
  results and the `stream/git/progress` (`phase`, `status`) params.
- ☑ **Resolve the active `cwd`** — DONE: `ConversationScreen` reads the active
  thread's `cwd` (via `threadByIdProvider`) and drives
  `GitActionManager.refreshStatus(cwd)` + `GitActionsSheet`. `worktreePath`
  fallback can be added when worktree-backed threads land.
- ☐ **Extended git actions** — `pull`, `checkout`, `createBranch`,
  `createWorktree` (+ managed), `revert`, `stackedPublish` (commit+push+PR) per
  spec 02a §5.2.4 / §5.5; only `status`/`commit`/`push` are wired in the MVP.
- ☑ **Git UI (visual layer)** — DONE: `GitActionsSheet` (branch state, changed
  files, commit/push actions, live push progress, recent activity) + `CommitSheet`
  (message entry), opened from the conversation status sheet's git rows. Push
  progress reads `gitActiveActionProvider`; history reads
  `gitActionHistoryProvider`. Reviewable via `GitRepoState.sample()` (FOR-DEV
  preview) — in preview mode push runs a local phase animation and commit is a
  visual-only flow.
- ☑ **Wire the git UI to a live session** — DONE: dropped the `previewState` /
  `_simulatePush` FOR-DEV paths; `GitActionsSheet` reads `gitRepoStateProvider`
  and runs real commit/push against the active thread's `cwd`. `GitRepoState.
  sample()` is no longer used by the UI (retained only as a widget-test fixture;
  remove if the test is reworked).
- ☐ **Per-file diff viewer** — `conversation/git/diff_viewer.dart` (spec 02a
  §5.6) needs the `git/diff` RPC (not in the MVP manager); the changed-files
  list currently shows only per-file +/- counts from `git/status`.

## Push notifications

- ☑ **FCM token registration + local notifications** — DONE (gated):
  `PushNotificationService` (guarded firebase_core/messaging + local
  notifications) and `PushRegistrar` (registers the token via
  `notifications/register` on connect, raises local notifications on
  turn-completed/error). Builds/runs with no Firebase config. Native config is
  FOR-HUMAN (`FOR-HUMAN.md` §2) + the relay needs the matching service account.
- ☑ **Notification tap → deep link** — DONE: `PushNotificationService` exposes
  `onNotificationTap` + `initialThreadId()` (wired to
  `onDidReceiveNotificationResponse`, FCM `onMessageOpenedApp`,
  `getNotificationAppLaunchDetails()` / `getInitialMessage()`); `_PushHost`
  routes taps to `/conversation/:threadId` (incl. cold start after first frame).
  Verify on a real device once Firebase creds exist (FOR-HUMAN).
- ☑ **Personalized copy + foreground suppression** — DONE (new, beyond the
  original scope): the turn-end notification is titled with the **thread name**
  and bodied **"{agent} replied" / "{agent} reported an error"** (resolved per
  event). A notification is **suppressed while its conversation is on screen**
  (foreground), and still fires for other threads / while backgrounded — tracked
  via `foregroundThreadProvider`. Pairs with the unread-thread style above.
- ☑ **Notification preferences UI** — DONE: a `SettingsScreen` (route
  `/settings`, opened from a gear action in the `MyDevicesScreen` app bar) with
  M3 `SwitchListTile`s for the **Replies** (`turnCompleted`) and **Errors**
  (`turnError`) channels. A `NotificationPreferences` value object +
  `NotificationPreferencesStore` (persisted via `shared_preferences`) +
  `notificationPreferencesProvider` (a `Notifier`) are now the **source of
  truth**: the `PushRegistrar` reads them for the `preferences` it sends on
  `notifications/register` AND gates the local notifications it raises. Toggling
  persists locally and, while connected, best-effort calls `notifications/update`
  (degrades to a no-op offline / against an older bridge — the prefs still ride
  along on the next register). Covered by unit + widget tests. ☐ On-device:
  verify a toggled-off channel stops both the background push and the local
  notification against a live bridge + Firebase.
- ☐ **iOS APNs** — verify end-to-end on a real device once the Firebase project
  + APNs key exist (FOR-HUMAN).

## Account / auth

- ☑ **Sign-in status surfaced everywhere (`auth/status`)** — DONE: `AuthStatus`
  entity + `ThreadManager.loadAuthStatus` + `authStatusProvider` family drive,
  for an agent not signed in on the PC: a warning **banner** above the composer
  (gated on `connectedHere`), a **red status dot** on its threads in the list,
  and on the **new-conversation card** a soft error tint plus a **"Check
  sign-in"** button that re-queries `auth/status` (`ref.invalidate`, spinner
  while checking). Stale state also auto-refreshes on **app resume**
  (`authStatusRefreshProvider` bumped by `_PushHost`), since a PC-side login
  doesn't change anything phone-side. All degrade to nothing offline / against
  an older bridge. ☐ On-device: verify each surface clears once the agent is
  signed in on the PC (via resume or the manual button).
- ⊘ **Interactive login from the app — OUT OF SCOPE (product decision).** The
  banner is informational by design: signing an agent in/out is done on the PC
  (each agent's own CLI login), not from the phone. The app deliberately does
  NOT drive `auth/login`/`auth/logout`. The `loginInProgress` state is still
  rendered for completeness if a bridge ever reports it, but no in-app login
  action is planned.

## Tooling

- ☐ Adopt `freezed`/`json_serializable` if/when entity boilerplate warrants it.
