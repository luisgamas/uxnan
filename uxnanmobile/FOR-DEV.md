# FOR-DEV — pending developer work

Deferred implementation work (code the team/agent will do later). Distinct from
`FOR-HUMAN.md` (assets only a human can provide). Search the codebase for
`FOR-DEV:` to jump to the exact deferral sites.

> Convention defined in the root `AGENTS.md` → "Pending developer work".

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
- ☐ **Connect UX polish** — `switchMac` is fire-and-forget from the card; surface
  a connecting spinner/result and errors (today only the status dot reflects it).
  Verify the switch flow end-to-end against a live bridge.
- ☐ **On-device pairing verification** — the QR happy path needs a running
  bridge/relay to complete `processPairingPayload`; verify end-to-end once the
  bridge exists.
- ☐ **Standalone pairing use cases** — the spec lists `StartPairing`,
  `RegisterTrustedDevice`, `RemoveTrustedDevice` under `domain/usecases/pairing/`.
  Currently folded into `SessionCoordinator.processPairingPayload` +
  `ITrustedDeviceRepository`; split out only if the indirection earns its keep.

## Connection / transport

- ☑ **IncomingMessageProcessor** — DONE (conversation managers).
- ☐ **TransportSelector LAN discovery** — prefer a direct LAN socket before the
  relay (spec §5.9.3); needs mDNS/Bonjour + the iOS local-network permission.
- ☐ **Live WebSocket integration test** against a real bridge (current tests use
  an in-memory simulated bridge).

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
- ☐ **Scope threads to the connected PC / project** — the list shows all local
  threads regardless of device; once the session exposes the active device/agent/
  project, scope it (and drive `loadThreads(projectId:)`). The `thread/list` JSON
  shape is still assumed (tolerant parser) — verify against the real bridge.
- ◑ **Thread actions** — **new thread DONE**: a "New conversation" FAB on
  `ThreadsScreen` opens `NewConversationSheet` (pick project via `project/list`,
  agent via `agent/list`, optional model) → `ThreadManager.startThread`
  (`thread/start`) → navigates to the conversation. Archive/delete and
  resume/fork remain post-MVP.

## Conversation / timeline

- ☐ **Advanced `MessageContent` types** — `approval`, `plan`, `subagent` (and
  their `ApprovalRequest` / `PlanState` / `SubagentState` payloads). Currently
  decoded as `UnknownContent` (lossless). Post-MVP per spec.
- ☑ **Application managers** — DONE: `ThreadManager` (timeline build + streaming
  reducer application, `loadThreads`, `sendUserMessage`) and
  `IncomingMessageProcessor`.
- ☐ **Remote history pagination** — `ThreadManager.loadMoreHistory` via
  `thread/turns/list` (cursor) → `TurnTimelineSnapshot.prependHistory`; plus
  `startNewThread`/`resumeThread`/`forkThread`. The bridge `thread/list` JSON
  shape is assumed (tolerant parser); verify against the real bridge.
- ☑ **Conversation UI (visual layer)** — DONE: `ConversationScreen`
  (`SliverAppBar.large`, floating + snap, auto-scroll), message renderers
  (`MessageBubble` + `MessageContentView`: markdown, code, command card, diff,
  system banner, streaming dots), floating `ComposerBar`, `SessionStatusSheet`
  and `ApprovalModeSheet`. Reviewable via the FOR-DEV home preview + `demo_seed`.
- ◑ **Wire conversation controls to real bridge data** — the environment is now
  built from the active `Thread` + live git state (no more
  `SessionEnvironment.sample()`); remaining items below need real RPCs:
  - ☑ **Model indicator** (`ComposerBar._ModelChip`, `SessionStatusSheet` model
    row) → shows the real thread model (from `Thread.model`, falling back to the
    agent label). ☐ The **selector** is still a no-op `onTap` (FOR-DEV) until a
    model-change RPC exists.
  - ☑ **Context badge** (`ComposerBar._ContextBadge`, status-sheet context row)
    → hidden / shown as a neutral `—` placeholder while the bridge does not
    report token usage (no fabricated fraction). ☐ Wire real usage from
    `bridge/status` or turn usage when available.
  - ◑ **Approval mode** (`ApprovalModeSheet`) → now an explicit local per-thread
    setting (no sampled value). ☐ Read/persist via an access-mode RPC when one
    exists.
  - ☑ **Git branch / remote / local** (`_EnvironmentChip`, status-sheet git
    section) → real values from `git/status` via `gitRepoStateProvider`; the
    commit/push rows call `GitActionManager.commit` / `.push` against the active
    thread's `cwd`.
  - ☐ **Attach** (`ComposerBar` add button) → file/image picker → upload as
    `ImageContent` / attachment. Currently a disabled placeholder (FOR-DEV).
  - ☐ **Voice** (`ComposerBar` mic button) → speech-to-text into the composer.
    Currently a disabled placeholder (FOR-DEV).
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

## Tooling

- ☐ Adopt `freezed`/`json_serializable` if/when entity boilerplate warrants it.
