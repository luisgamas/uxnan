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
2. ☐ **Archive thread** (+ an "Archived" screen to recover them) — see
   *Threads list → Archive thread* for the full plan.
3. ☐ **Settings screen + notification preferences** (`notifications/update`) —
   see *Push notifications*.
4. ☐ **Remove device** (clear a stale paired PC) — see *Threads list*.
5. ☐ **Voice → text in the composer** — pure device feature, but verification
   needs a real mic (defer while remote).

Everything else below needs the bridge/relay (history pagination, real token
usage, per-file diff, extended git actions, LAN discovery, manual-code pairing,
APNs) and is best done once a live bridge is reachable.

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
- ◑ **Connect UX polish** — a per-device **"Verify connection"** action now
  probes the bridge (`SessionCoordinator.verifyConnection` → encrypted
  `bridge/status`, reconnecting first when disconnected) and reports the result.
  ☐ Still: `switchMac` itself is fire-and-forget from the card; surface a
  connecting spinner/errors on the Connect CTA, and verify the switch flow
  end-to-end against a live bridge.
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
- ◑ **Scope threads to the connected PC / project** — **PC scoping DONE**:
  `Thread.deviceId` tags each thread with the active device and the list filters
  by it (drift v3 migration purged the old demo data). ☐ Still open:
  **project**-level scoping (drive `loadThreads(projectId:)` once the session
  exposes the active project). The `thread/list` JSON shape is still assumed
  (tolerant parser) — verify against the real bridge.
- ◑ **Thread actions** — **new thread DONE**: a "New conversation" FAB on
  `ThreadsScreen` opens `NewConversationSheet` (pick project via `project/list`,
  agent via `agent/list`, model via `agent/models`) → `ThreadManager.startThread`
  (`thread/start`) → navigates to the conversation. Threads are now scoped to the
  selected PC (`Thread.deviceId`).
  - ☑ **Delete thread** — DONE (mobile): long-press menu on `ThreadsScreen` →
    `ThreadManager.deleteThread` removes locally + calls `thread/delete`
    (best-effort, degrades gracefully).
  - ☐ **Archive thread** still pending. Plan (mobile-only, degrades without the
    bridge `thread/archive`):
    - **Where they go:** `ThreadManager.archiveThread` sets the local thread's
      `status` to `ThreadStatus.archived` (via `Thread.copyWith` + `saveThread`)
      and sends `thread/archive { threadId }` best-effort. Nothing is deleted —
      the row stays in drift, only its status changes.
    - **How they're hidden:** `ThreadsScreen` filters out
      `ThreadStatus.archived` from the main list (active threads only), so
      archiving just removes it from the default view.
    - **How they're recovered:** a future **"Archived" screen/section** reads the
      same drift repo filtered to `status == archived` (add an
      `IThreadRepository.watchThreads(status:)`/a derived provider) with an
      **Unarchive** action (set status back to `active`). Build that screen
      together with this implementation so archive can be exercised end-to-end
      (control + functionality verification). Until that screen exists, archived
      threads are simply hidden but never lost.
  - ☑ **Rename thread** — DONE (mobile): long-press menu → rename dialog →
    `ThreadManager.renameThread` (local-first + `thread/rename`, graceful
    degradation). Bridge `thread/rename` handler is the other agent's side.
  - ◑ **Expose the thread id in the UI** — **thread id DONE**: long-press "Copy
    thread ID" + a copyable **Thread ID** row in `SessionStatusSheet` (resume a
    conversation from the CLI on the PC). ☐ Still: surface the agent's **session
    id** (e.g. OpenCode `sessionID`) once the bridge exposes it via `thread/read`.
  - ☐ **Remove device** (deferred — user-requested): a "Remove" action on the PC
    card that deletes the `TrustedDevice` (+ its local threads) and calls
    `bridge/removeTrustedDevice`. Also lets the user clear a stale PC.

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
  - ☑ **Model indicator + selector** (`ComposerBar._ModelChip`,
    `SessionStatusSheet` model row) → shows the real thread model (from
    `Thread.model`, falling back to the agent label) and the chip now opens
    `ModelPickerSheet` (`agent/models`) → `ThreadManager.setThreadModel`
    (`thread/setModel`), persisting the pick locally. DONE.
  - ☑ **Context badge** (`ComposerBar._ContextBadge`, status-sheet context row)
    → hidden / shown as a neutral `—` placeholder while the bridge does not
    report token usage (no fabricated fraction). ☐ Wire real usage from
    `bridge/status` or turn usage when available.
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
- ☐ **Notification preferences UI** — `preferences` is hard-coded to
  `{turnCompleted:true,turnError:true}`; add a settings toggle that calls
  `notifications/update`.
- ☐ **iOS APNs** — verify end-to-end on a real device once the Firebase project
  + APNs key exist (FOR-HUMAN).

## Tooling

- ☐ Adopt `freezed`/`json_serializable` if/when entity boilerplate warrants it.
