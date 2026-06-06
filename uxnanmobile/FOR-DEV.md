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
- ☐ **`MyDevicesScreen` + `DeviceCard`** — list/switch trusted Macs
  (`SessionCoordinator.switchMac`), spec §5.5.6. Post-MVP-ish; not built yet.
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
- ☐ **Wire conversation controls to real bridge data** — the environment
  surfaces are currently fed by `SessionEnvironment.sample()` (FOR-DEV) and
  several controls are no-op `onTap`s. Each must be backed by live data/actions
  to be usable, not just visible:
  - **Model indicator + selector** (`ComposerBar._ModelChip`,
    `SessionStatusSheet` model row) → real model from bridge session state;
    tapping opens a model picker that issues the model-change RPC.
  - **Context badge** (`ComposerBar._ContextBadge`, status-sheet context row) →
    real token usage / window % from the bridge (`bridge/status` or turn usage),
    not the sampled fraction.
  - **Approval mode** (`ApprovalModeSheet`) → read current access mode from the
    session and persist the choice via the access-mode RPC (not local `setState`).
  - **Git branch / remote / local** (`_EnvironmentChip`, status-sheet git
    section) → real values from `git/status` via `gitRepoStateProvider`; the
    commit/push rows must call `GitActionManager.commit` / `.push` (manager and
    providers now exist — see the Git section below).
  - **Attach** (`ComposerBar` add button) → file/image picker → upload as
    `ImageContent` / attachment.
  - **Voice** (`ComposerBar` mic button) → speech-to-text into the composer.
  - Remove `SessionEnvironment.sample()`, `demo_seed.dart` and the home preview
    entry once the above are wired.

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
- ☐ **Resolve the active `cwd`** — git RPCs need the workspace directory; wire
  it from the active thread's `cwd`/`worktreePath` instead of a placeholder.
- ☐ **Extended git actions** — `pull`, `checkout`, `createBranch`,
  `createWorktree` (+ managed), `revert`, `stackedPublish` (commit+push+PR) per
  spec 02a §5.2.4 / §5.5; only `status`/`commit`/`push` are wired in the MVP.
- ☐ **Git UI** — `GitActionsBottomSheet` (repo state + actions), `CommitDialog`
  (message entry), `diff_viewer` (spec 02a §5.6 `conversation/git/`), push
  progress display from `gitActiveActionProvider`, and the action history from
  `IGitActionLogRepository.watchForThread`. Wire the conversation status sheet's
  git section to these (see Conversation wiring item above).

## Tooling

- ☐ Adopt `freezed`/`json_serializable` if/when entity boilerplate warrants it.
