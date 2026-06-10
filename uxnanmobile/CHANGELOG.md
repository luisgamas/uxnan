# Changelog

All notable changes to the `uxnanmobile` app are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

- **Notifications wrongly suppressed on the threads list.** The "currently
  viewing" thread was cleared inside `dispose()` via `ref`, which is unreliable
  in Riverpod — the clear could be dropped, leaving the last-opened thread
  marked as foreground and suppressing its notifications even after leaving the
  conversation. The conversation screen now captures the notifier in `initState`
  and clears on leave, so suppression applies only while its conversation is on
  screen.

### Added

- **Unread thread indicator.** When an agent reply lands in a thread you're not
  viewing, its row in the threads list is emphasized — a primary-tinted surface,
  a **bold title** and a small **unread dot** — so it's easy to spot without
  tapping the notification. Cleared when you open (or return to) the
  conversation. In memory only (resets on restart). `ThreadManager` tracks the
  unread set, gated by the foreground thread.

### Changed

- **Personalized turn notifications.** A turn-end local notification is now
  titled with the **thread name** and its body reads **"{agent} replied"** /
  **"{agent} reported an error"** (e.g. *"Cambio de rutina" — "Opencode te
  respondió"*) — was a generic "Turn completed / Your agent finished a turn."
  The agent label + thread title are resolved per event; copy is parameterized
  in l10n.

### Added

- **Threads list: search, sort and density controls (active + archived).**
  Shared `thread_list_controls.dart` so both lists behave identically:
  - **Search** — the M3 full-screen `SearchAnchor` view, matching by title, id,
    agent (label or wire id) and working folder; tapping a result opens it.
  - **Sort** — an M3 menu (check on the active order): creation date (newest
    first, the **new default**), name, or folder. The per-agent filter chips are
    unchanged.
  - **Density** — a compact, single-line tile variant (the full tile stays the
    default).
  - App-bar kept to the M3 ≤3-actions guideline: **Search + Sort** stay visible;
    **Density** (checkable) and **Archived** (navigation) live in a `⋮` overflow
    menu. The archived screen gained the same search/sort/density controls.
  - Preferences are in-memory per screen (not yet persisted).

- **"Responding…" header in the conversation.** While the agent is producing a
  turn, the conversation app-bar shows a small spinner + "Responding…" (primary
  colour) in place of the connection label, so a reply is clearly on the way
  even before the first streamed delta. Driven by the per-thread activity that
  already powers the threads list.

### Fixed

- **No redundant local notification for the conversation you're watching.** A
  turn-end (completed/error) local notification is now **suppressed while that
  thread's conversation is on screen in the foreground** — you already see the
  reply live. It still fires for a turn that ends in a *different* thread, and
  while the app is backgrounded (you're no longer watching). Wired via a new
  `foregroundThreadProvider` the conversation screen sets on enter and clears on
  leave / app-background; `PushRegistrar` reads it before raising the notice.

- **Thread `createdAt`/last-activity now parsed from the bridge.** The parser
  read `json['lastActivity']`, a field the wire never carries, so a thread's
  last-activity time was always null (blank in the list). It now maps the
  bridge's `updatedAt` to last-activity and keeps `createdAt` — exposed on the
  `Thread` entity and persisted by the drift repo (which previously stamped
  `now()` on every save, clobbering the real creation time). Enables a stable
  "newest first" ordering.

- **No more phantom threads or silent send failures** (chat was broken: messages
  sent, no responses). `ThreadManager.startThread` fabricated a local `uuid`
  thread whenever `thread/start` returned an error or no result — so the bridge
  never had that thread and every `turn/send` failed with `-32008 thread not
  found`, silently. It now surfaces the error (the new-conversation flow reports
  it) instead of inventing an id, and `sendUserMessage` marks the user's message
  **failed** when the bridge rejects the turn, so a failure is visible rather
  than swallowed. (Pairs with the bridge `thread/start` browsed-cwd fix.)

### Changed

- **Conversation composer + app bar aligned to Material 3.** The composer was a
  floating rounded card (`elevation`/shadow + `circular(24)`) — replaced with a
  **bottom-anchored bar** on `surfaceContainer` with a top `outlineVariant`
  hairline (no card, no shadow), so it reads as screen chrome and lets the
  thread breathe (the M3 surface-tone pattern over a custom floating surface).
  The app-bar git affordance dropped the redundant branch `ActionChip` (chips
  aren't an app-bar action widget) for a single `IconButton` with a commit icon
  that opens the git sheet; the branch now shows in its tooltip.

- **Drop the unused `RELAY_URL` compile-time define.** The bridge address comes
  entirely from the pairing QR (`PairingPayload` `hosts`/`relay`, persisted on
  the `TrustedDevice`), so the `AppConstants.relayUrl` `--dart-define` was dead
  (never read). Removed the constant and the `--dart-define=RELAY_URL=…` from the
  README run command + build-flavors table, with a note that a fresh bridge is
  LAN/Tailscale-direct (relay optional, only for background push).

- **New-conversation flow redesigned (Material 3).** It is now a **full-screen
  M3 dialog** (roomier than a bottom sheet for a multi-input creation task)
  with: a **working-directory card** that defaults to the bridge's root and a
  "Browse…" action to pick any sub-folder (the manual project list is gone — the
  bridge auto-roots at its launch dir), **agent cards** that clearly show each
  agent's logo, name and **capability chips** (Streaming / Plan / Approvals /
  Forking / Images) with a selected state, and the model field. The built-in
  **Echo (dev) agent is hidden** from the picker.

### Added

- **Android push notifications activated (Firebase project `uxnan-app`).** The
  `com.uxnan.mobile` Android app is registered in Firebase, `google-services.json`
  is provisioned (gitignored), and the **Google Services Gradle plugin is wired
  conditionally** — `settings.gradle.kts` keeps it on the classpath (`apply
  false`) and `app/build.gradle.kts` applies it only `if
  (file("google-services.json").exists())`, so the build stays green without the
  config. iOS is registered in the same project (`GoogleService-Info.plist`
  placed) but push remains **pending** the APNs key (macOS + Apple Developer);
  see `FOR-HUMAN.md`.

- **Folder browser for new conversations (`workspace/browseDirs`)** — a
  plug-and-play way to root a thread anywhere under the bridge's configured
  browse roots, alongside the configured project list. New `BrowseRoot` /
  `BrowseDirEntry` / `BrowseResult` entities (tolerant parsers), a
  `WorkspaceBrowser` manager + provider, and a `WorkspaceBrowserSheet` (root
  picker, breadcrumb, git-repo badges, "Open here"). The new-conversation sheet
  gains a **"Browse…"** action: the chosen folder is resolved to a project
  (`project/resolve`) and started via `thread/start { cwd }`.

### Fixed

- **Everything now targets the PC we are actually connected to.** Browsing a
  paired PC's threads no longer implies a connection: the threads-screen online
  dot, the new-conversation FAB, and refresh are gated on holding *that* PC's
  live channel (`connectedDeviceProvider`), not the global phase — and an
  offline banner offers a validated "Connect" here. The conversation composer is
  disabled unless connected to the thread's PC, so messages can never be sent
  over a different connected PC's channel. Tapping a PC to browse no longer
  changes the connection/reconnect target (`setActiveDevice` removed from the
  browse path).
- **Codex context usage is now visible in the composer** — the context chip
  showed only Claude's percentage; it now also renders the raw token count when
  the model's window is unknown (Codex).

- **Context-usage indicator** — consumes the new `turn/completed` `usage`:
  `ThreadManager` tracks per-thread token usage (`contextUsageProvider`) and the
  session environment shows a **percentage** when the model's context window is
  known (Claude tiers) or the **raw token count** otherwise (Codex), replacing
  the FOR-DEV placeholder in the status sheet. OpenCode reports no usage.
- **Live conversations survive leaving the screen + per-thread activity** — the
  `ThreadManager` now buffers each thread's in-flight turn in memory (it is a
  singleton) and applies streaming events for **all** threads, not just the one
  on screen. Leaving and re-entering a conversation keeps the streaming response
  rendering and updating; an answer that completes off-screen is persisted
  (keyed by the deterministic `stream-<turnId>` id) and shown on return.
  Entering a thread also re-syncs it from the bridge (`turn/list`) to recover
  anything missed (e.g. after an app restart). A new `ThreadActivity`
  (`running`/`error`/idle) is exposed per thread and the list card shows a
  **"Responding…" spinner** while a conversation is working — replacing the
  unclear static dot for active turns (`threadActivityProvider`).

### Fixed

- **Switching PCs no longer fakes the connection status** — tapping a paired PC
  to browse its threads previously flipped it to "connected" (and the current PC
  to "disconnected") because the indicator keyed off the *selected* device plus
  the stale global phase. Status now follows the device that actually holds the
  live channel (`connectedDeviceProvider`) and the one being attempted
  (`connectingDeviceProvider`). The **Connect** action validates reachability
  first (`SessionCoordinator.switchMac` probes then commits): if the target is
  unreachable it stays on the current PC and surfaces a message, instead of
  optimistically switching. Browsing a PC never implies a connection.

### Added

- **Structured model picker + resolved-version display** — consumes the
  bridge's richer `agent/models` contract so model selection is plug-and-play
  across Claude Code, Codex and OpenCode:
  - New `AgentModel` entity (`domain/entities/agent_model.dart`) parsing the
    structured contract (`id`, `displayName`, `description?`, `version?`,
    `isDefault?`) and tolerating bare-string responses from older bridges.
    `ThreadManager.loadModels` / `agentModelsProvider` now return
    `List<AgentModel>`.
  - The model picker and the new-conversation model field show readable names,
    a "Default" badge, and a secondary line with the wire id / resolved version
    / description; selection still routes by `id`.
  - **Resolved-version surfacing**: a new `stream/model/resolved`
    (`ModelResolvedEvent`) updates an in-memory `resolvedModelsProvider`; the
    session status sheet shows the concrete version an alias resolved to (e.g.
    `opus` → `claude-opus-4-8`) under a new "Active version" row.

### Added

- **Direct LAN/Tailscale transport (relay now optional)** — consumes the
  bridge's pairing-QR `hosts` so the phone connects directly, with the relay as
  a fallback (spec 02a §5.9.3; bridge `docs/connectivity.md`):
  - `PairingPayload` now parses `hosts: List<String>` and treats `relay` as
    optional (a pure LAN/Tailscale QR carries only `hosts`); the structural
    parser is tolerant and `PairingValidator` enforces "at least one transport"
    — mirroring `shared` `validatePairingPayload`. **Fixes** the old parser,
    which threw on a relay-less QR.
  - `TrustedDevice` carries `hosts`, persisted by `TrustedDeviceRepository`
    (drift schema → v4: additive, nullable `trusted_devices.hosts` column,
    newline-separated; relay-only devices load with empty hosts).
  - `DirectTransportSelector` (now the default `transportSelectorProvider`)
    tries each direct host as a plain `ws://host:port` endpoint (the bridge's
    LAN server needs no relay routing headers) with a short per-host timeout,
    then falls back to the relay with the `x-role`/`x-session-id` headers.
    `processPairingPayload` carries the scanned `hosts` onto the device.
  - UI (proposal, pending on-device review): the `MyDevicesScreen` card shows
    the first direct host when a device has no relay (instead of a blank).
  - Tests: payload hosts parse + relay-optional, validator transport rule,
    repository hosts round-trip, and `DirectTransportSelector` (direct-first,
    host→host→relay fallback, per-host timeout, no-transport error, scheme
    passthrough).

- **Archive / unarchive threads + an "Archived" screen** — completes the
  thread-actions set (rename/delete already shipped):
  - `ThreadManager.archiveThread` / `unarchiveThread` flip the local
    `ThreadStatus` first (archived threads leave the active list immediately),
    then call `thread/archive` / `thread/unarchive` best-effort — **nothing is
    deleted**; degrades gracefully if the bridge lacks the method.
  - UI (proposal, pending on-device review): the long-press menu gains
    **Archive** (active threads) / **Unarchive** (archived threads); the
    `ThreadsScreen` hides archived threads and gets an **Archived** app-bar
    action → a new per-PC `ArchivedThreadsScreen` (route
    `/device/:deviceId/archived`) where archived threads can be reopened,
    unarchived or deleted. The thread row + actions menu were extracted to a
    shared `ThreadTile` (`thread_tile.dart`) reused by both screens. New en/es
    strings. Archived threads are **per-PC** (not in the future app Settings).

- **Advanced message content: `approval` / `plan` / `subagent`** — these blocks
  used to fall through to the generic `UnknownContent` placeholder; they now
  decode and render properly (exactly what Codex/Claude emit for plan mode &
  approvals):
  - Domain: `ApprovalContent`/`PlanContent`/`SubagentContent` + value objects
    `ApprovalRequest`, `PlanState`/`PlanStep`, `SubagentState`/`SubagentAction`
    and enums `ApprovalRisk`, `PlanStepStatus`, `SubagentActionKind`. The codec
    is tolerant of both nested (`{request|state:{…}}`) and flat payloads and
    falls back gracefully on unknown enum values; JSON round-trips.
  - UI (proposal, pending on-device review): an approval card (action + risk
    badge + **disabled** Approve/Reject — FOR-DEV: the response RPC needs the
    bridge), a plan checklist (per-step status icons), and a subagent card
    (name/status + its actions). Read-only for now.

- **Capability-aware conversation UI** (proposal, pending on-device review) —
  the conversation now adapts to the active agent's advertised
  `AgentCapabilities` (from `agent/list`):
  - `agentCapabilitiesProvider` resolves a thread's agent capabilities, falling
    back to an all-permissive default (`AgentCapabilities.permissive()`) when the
    agent list isn't loaded yet, so controls are never hidden spuriously.
  - The `SessionStatusSheet` approval-mode row is shown only when the agent
    advertises `approvals`; the `ComposerBar` attach button only when it
    advertises `images` (the picker itself stays FOR-DEV). OpenCode (no
    approvals/images) hides both; Codex/Claude will surface them once the bridge
    exposes those agents. Verify on-device when they land.

- **New threads default their title to the thread id** — when a conversation is
  started without an explicit title, `ThreadManager.startThread` sets the local
  title to the new thread's own id (instead of a generic "New thread"), so it's
  identifiable in the list and resumable from the CLI on the PC. The user can
  rename it afterwards (see thread actions). An explicit title is preserved.

- **Thread management — rename, delete & copy id** — user-requested:
  - `ThreadManager.renameThread` mirrors the new title locally first (immediate
    UI), then calls `thread/rename { threadId, title }`; ignores a blank title.
  - `ThreadManager.deleteThread` removes the thread locally (clearing the active
    timeline when it was active), then calls `thread/delete { threadId }`.
  - Both are best-effort over the bridge and degrade gracefully when the method
    is not yet implemented (the local change is kept).
  - UI (proposal, pending on-device review): long-pressing a thread on
    `ThreadsScreen` opens an actions sheet (Rename / Copy thread ID / Delete)
    with a rename dialog and a delete confirmation. The conversation
    `SessionStatusSheet` gains a copyable **Thread ID** row (shortened display,
    copies the full id) so the same conversation can be resumed from the CLI on
    the PC. New en/es strings.

- **Notification tap → deep-link to the conversation** — closes the push loop:
  - `PushNotificationService` now exposes `onNotificationTap` (a `threadId`
    stream from foreground / background-resume taps) and `initialThreadId()`
    (the `threadId` that cold-started the app). Wires the local-notification
    `onDidReceiveNotificationResponse`, FCM `onMessageOpenedApp`, plus
    `getNotificationAppLaunchDetails()` / `getInitialMessage()` for cold start.
  - `PushRegistrar` re-exposes both; `_PushHost` (`app.dart`) subscribes and
    deep-links taps to `/conversation/:threadId` (cold start navigates after the
    first frame). Fully guarded: a no-op when Firebase config is absent.

- **Per-thread model picker (`thread/setModel`)** — spec 02a §5.4:
  - `ThreadManager.setThreadModel` calls `thread/setModel { threadId, model }`
    and mirrors the new model onto the local `Thread`; `loadAgentModels`
    (`agent/models`) feeds the picker.
  - `ModelPickerSheet` (`conversation/support/model_picker_sheet.dart`): a
    searchable M3 bottom sheet that lists the agent's models and resolves with
    the pick. Wired into the composer model chip and the `SessionStatusSheet`
    model row (`ConversationScreen` → `setThreadModel`).
  - The real model picker is also used by `NewConversationSheet` (the agent's
    `defaultModel` preselected); onboarding is skipped when a PC is already
    paired (straight to the devices list).

- **"Verify connection" device action** — spec 02c §11:
  - `SessionCoordinator.verifyConnection` actively probes the bridge with an
    encrypted `bridge/status` (timeout), and reconnects first when the session is
    disconnected. Surfaced as a per-device action on `MyDevicesScreen`
    (`deviceVerifyConnection`, EN + ES).

### Changed

- **Threads scoped to the selected PC** — `Thread` now carries `deviceId`;
  `thread/list` results are tagged with the active device and the threads screen
  filters by it. Drift schema → v3: additive `threads.device_id` column + a
  migration that purges the old UI demo data (`demo-thread*`, `demo-mac`).

- **Robust reconnection + liveness** — spec 02c §11:
  - `turn/send` now sends `text` at the top level (was nested under `content`,
    which produced no response).
  - `WebSocketChannelTransport` sets a 20s `pingInterval` so a dead socket is
    detected; the relay closes the paired peer when one side drops (see
    `relay/CHANGELOG.md`).
  - `SessionCoordinator` runs a 25s `bridge/status` app heartbeat that detects a
    dead bridge behind a still-open relay socket and triggers reconnect; a
    single-flight reconnect guard prevents overlapping loops; `verifyConnection`
    reconnects when disconnected; last-seen is updated on connect.

### Fixed

- **Seq-replay race on outbound envelopes** — the secure transport reserves the
  outbound sequence number **synchronously** (before the `await` on encryption),
  and `SessionCoordinator` serializes encrypt+send onto a single `_sendChain`, so
  concurrent sends can no longer interleave and trip the bridge's replay
  rejection.
- **Model picker overflow + keyboard** — fixed the model-picker layout overflow
  and dismiss the keyboard when tapping the chat surface.

### Added

- **Push notifications (FCM) — gated** — spec 02a §5.10:
  - `PushNotificationService` (infrastructure): fully guarded `firebase_core` +
    `firebase_messaging` + `flutter_local_notifications`. The app builds and runs
    with **no** Firebase native config — `Firebase.initializeApp()` and every FCM
    call are try/caught; when config is absent `isAvailable` is `false` and push
    silently degrades to a no-op.
  - `PushRegistrar` (application): on `ConnectionPhase.connected` it fetches the
    FCM token and calls `notifications/register { pushToken, platform,
    preferences }` over the session RPC; re-registers on token refresh; raises a
    local notification on `TurnCompleted`/`TurnError` domain events.
  - `main.dart` guarded Firebase init + `@pragma('vm:entry-point')` background
    handler; `_PushHost` (under `MaterialApp.builder`) keeps the registrar alive
    and feeds it localized copy. EN + ES strings.
  - Android: core-library desugaring enabled (required by
    `flutter_local_notifications`). Native Firebase config is **FOR-HUMAN**
    (`FOR-HUMAN.md`): `google-services.json` / `GoogleService-Info.plist` + the
    google-services gradle plugin + iOS push capability.
  - Tests: `PushRegistrar` (register-on-connect, no-reregister, token refresh,
    local notification on turn end) with a fake push service.

- **MVP wiring — real bridge data + new-conversation flow** — spec 02a §5.2 /
  §5.4 / §5.6:
  - `Thread` entity now carries `model` (alongside `agentId`/`cwd`), parsed from
    `thread/list` / `thread/start` and persisted (drift schema → v2, additive
    `threads.model` column + migration).
  - New bridge catalog entities `Project` (`project/list`) and `AgentDescriptor`
    + `AgentCapabilities` (`agent/list`) with tolerant parsers; `ThreadManager`
    gains `loadProjects`, `loadAgents` and `startThread` (`thread/start`).
    Providers: `projectsProvider`, `agentsProvider`, `threadByIdProvider`.
  - **New-conversation flow**: a "New conversation" / "Nueva conversación" FAB on
    the threads screen opens `NewConversationSheet` (M3 bottom sheet matching the
    existing `*_sheet.dart` patterns) to pick a project (name + cwd subtitle), an
    agent (only `available` ones selectable, capability hints, `AgentLogoChip`/
    `AgentVisuals` icon or a generic fallback) and an optional model (the agent's
    `defaultModel` preselected); `thread/start` then navigates to the
    conversation. FAB is disabled while disconnected.
  - **Conversation wired to real data**: the model/agent indicator is driven by
    the active `Thread`, connection state by `connectionPhaseProvider`, and the
    git branch/state by `gitRepoStateProvider` fed with the thread's `cwd`
    (refreshed via `GitActionManager.refreshStatus(cwd)`); `GitActionsSheet` runs
    real commit/push against that `cwd`. Removed `SessionEnvironment.sample()`,
    `GitRepoState.sample()` from the UI, and the `previewState` / `_simulatePush`
    FOR-DEV git paths.
  - **Composer/status controls**: the model indicator shows the real thread
    model; the context badge is hidden until the bridge reports real token usage
    (no fabricated 42%); approval mode is an explicit local per-thread setting
    (FOR-DEV note, no sampled value); attach/voice stay disabled placeholders
    (FOR-DEV).
  - **Removed demo seeding** from the default UX: deleted `demo_seed.dart` and
    the home preview button.
  - Tests: `Project`/`AgentDescriptor` parsers, `ThreadManager` `loadProjects`/
    `loadAgents`/`startThread`, the `model` thread round-trip, and updated
    composer/git-sheet widget tests to the real-data shape.

- **Conversation/timeline — application managers** — spec 02a §5.2.2 / §5.2.5:
  - `DomainEvent` hierarchy and `IncomingMessageProcessor` that classifies
    inbound bridge notifications (`stream/turn/started`, `stream/message/delta`,
    `stream/turn/completed`, `…/error`, `…/aborted`) into typed events; other
    `stream/*` notifications map to `UnknownDomainEvent`.
  - `ThreadManager`: builds the active thread's `TurnTimelineSnapshot` from the
    local message repository and applies streaming events through the reducer
    (start → delta → complete, persisting the finalized message); `loadThreads`
    (`thread/list`) and `sendUserMessage` (`turn/send`) over the injected RPC
    sender; dedup via `MessageDeduplicator`.
  - Providers: `incomingMessageProcessorProvider`, `threadManagerProvider`,
    `threadsProvider`, `activeTimelineProvider`.
  - Tests: event classification, and a `ThreadManager` driven by an in-memory
    DB + a controllable event stream (timeline build, full streaming turn,
    thread loading, send).
  - The conversation **UI** (`ConversationScreen`, renderers, composer) is the
    remaining piece (FOR-DEV), built next for visual review.

- **Conversation/timeline — domain & data layer** — spec 02a §5.6 / §6.2:
  - `MessageContent` sealed hierarchy with a JSON codec: `text`, `code`,
    `image`, `tool`, `diff`, `mermaid`, `system`, `command_execution`, plus an
    `UnknownContent` fallback so unmodeled/newer types round-trip losslessly.
  - `Message` and `Turn` entities; `MessageDeliveryState`, `SystemContentKind`
    and `CommandStatus` enums.
  - `IMessageRepository` + `DriftMessageRepository` (content stored as JSON in
    the existing `messages` table; ascending reads, limit + `beforeId`
    pagination, reactive `watch`). `messageRepositoryProvider` wired.
  - `MessageDeduplicator` (fingerprint/id dedup for replays, §5.6.5) and the
    immutable `TurnTimelineSnapshot` with a streaming reducer
    (reconcile / prependHistory / startStreaming / appendStreamingDelta /
    completeStreaming) per §5.4.6.
  - Tests: content codec round-trips + unknown fallback, repository
    CRUD/pagination/watch, deduplicator, and the timeline reducer.
  - Advanced content (`approval`/`plan`/`subagent`) and the application managers
    (`ThreadManager` timeline, `IncomingMessageProcessor`) + the conversation UI
    are deferred (FOR-DEV) to the next increments.

- **Pairing / onboarding UI** — spec 02a §5.5.1–5.5.2, M3 design tokens:
  - `OnboardingScreen`: a 4-page flow (Welcome → Features → Install bridge →
    Pair) with a page indicator, Skip/Back/Next controls and a copyable
    `CommandCardWidget` (`npx uxnan-bridge`); width-constrained for tablets.
  - Onboarding visual treatment: an `OnboardingBackground` (soft square grid +
    top-transparent → deeper-bottom gradient) and `FloatingAgents` — bundled
    coding-agent logos (`flutter_svg`, `assets/images/agents/`) that gently
    float on soft dark chips, with a different size/position preset per page.
    Implemented efficiently (one controller per page, GPU transforms,
    `RepaintBoundary`).
  - `QrScannerScreen`: camera permission gating (request / settings fallback),
    `mobile_scanner` preview with a scan window, validates the QR via
    `PairingValidator`, drives `SessionCoordinator.processPairingPayload`, and
    shows `UpdatePromptDialog` on an unsupported QR version.
  - Routes `/onboarding` and `/pairing`; the home "Pair a device" button now
    launches the flow. English + Spanish strings.
  - `mobile_scanner` and `permission_handler` dependencies; Android `CAMERA`
    permission and iOS `NSCameraUsageDescription` configured.
  - Widget test covering onboarding page navigation.
  - **FOR-DEV** (deferred): iOS `permission_handler` Podfile macro
    (`PERMISSION_CAMERA=1`), live on-device camera pairing against a real bridge.

- **Pairing logic (QR)** — spec 02a §5.5:
  - `PairingPayload` entity with `fromQrString` (Base64-JSON QR decode) and
    `PairingValidator` (domain service): checks QR version, required fields and
    expiry with clock-skew tolerance, returning a typed result.
  - `ITrustedDeviceRepository` + `TrustedDeviceRepository`: split storage —
    device metadata in drift, the bridge identity key in `SecureStore`.
  - `SessionCoordinator.processPairingPayload` (validate → persist
    `TrustedDevice` → set active → QR-bootstrap connect) and `cancelPairing`,
    with optional pairing dependencies so existing wiring is unaffected.
  - Providers: `trustedDeviceRepositoryProvider`, `pairingValidatorProvider`,
    wired into `sessionCoordinatorProvider`.
  - Tests: payload parse/round-trip + malformed/missing-field, validator
    (valid/expired/unsupported-version/malformed), repository split-storage
    round-trip, and an end-to-end `processPairingPayload` over the simulated
    bridge.
  - **FOR-DEV** (deferred): manual-code pairing (relay REST), the pairing/
    onboarding UI (next increment), and standalone pairing use-case classes.
    See `FOR-DEV.md`.

- **SessionCoordinator + connection orchestration** — spec 02a §5.2.1 / 02c §11:
  - `SessionCoordinator` (application layer): drives the connection lifecycle
    (connect / disconnect / switchMac), runs the handshake via
    `SecureTransportLayer`, opens a `SecureChannel`, and exposes
    `connectionPhase`, `recoveryState`, `activeMac` and inbound `incomingMessages`
    as streams.
  - `sendRequest`: encrypts + sends when connected, otherwise buffers for replay;
    inbound envelopes are decrypted and routed to the `RequestCorrelator`
    (responses) or the `incomingMessages` stream (requests/notifications).
  - Automatic reconnection: on an unexpected drop, retries with
    `BackoffCalculator` up to a max (default 10) before entering the terminal
    error phase; intentional `disconnect()` does not reconnect.
  - `TransportSelector` interface + `RelayTransportSelector` (relay via
    `relayUrl` with `x-role`/`x-session-id` headers; LAN discovery deferred).
  - `SecureStore` interface + `FlutterSecureStore`, and `PhoneIdentityStore`
    (load-or-create the persistent Ed25519 identity — spec 02b RF-PAIR-08).
  - Riverpod 3.x providers: `secureStoreProvider`, `phoneIdentityStoreProvider`,
    `secureTransportLayerProvider`, `transportSelectorProvider`,
    `sessionCoordinatorProvider`, and the `connectionPhaseProvider` /
    `connectionRecoveryProvider` / `activeMacProvider` `StreamProvider`s.
  - Tests: a persistent **simulated bridge over an in-memory transport** drives
    a full connect, an encrypted `sendRequest` round-trip, inbound notification
    delivery, intentional disconnect, and **automatic reconnect after a drop**;
    plus `PhoneIdentityStore` load-or-create against an in-memory store.
  - Deferred: `IncomingMessageProcessor` (domain-event classification, with the
    conversation module), `TransportSelector` LAN discovery, and live WebSocket
    integration against a real bridge.

- **Secure transport + connection mechanics** — spec 02a §5.9 / 02c §11:
  - `WebSocketTransport` interface + `WebSocketChannelTransport`
    (`web_socket_channel`, `IOWebSocketChannel` so the relay's `x-role` /
    `x-session-id` upgrade headers are honored).
  - `SecureTransportLayer.performHandshake`: the phone side of the
    clientHello → serverHello → clientAuth → ready flow, verifying the nonce
    echo, transcript expiry (with clock-skew tolerance), the trusted bridge
    identity, and the Ed25519 signature before deriving the session key.
  - `SecureChannel`: AES-256-GCM encrypt/decrypt with 1-based outbound
    sequencing and replay rejection (`seq <= lastApplied` ⇒
    `TransportException(replay)`).
  - `RequestCorrelator` (JSON-RPC request/response matching + timeout),
    `BackoffCalculator` (exp. 1→60s with ±30% jitter), `OutboundMessageBuffer`
    (sliding window) and `classifyRaw` message triage.
  - Value objects/entities: `RpcMessage` (+`RpcError`), `PhoneIdentity`,
    `TrustedDevice`, `ConnectionRecoveryState`; added `web_socket_channel` dep
    and a `TransportErrorKind.replay`.
  - Tests: a full **two-party handshake over an in-memory transport pair**
    (phone + simulated bridge derive the same key; untrusted-identity rejected),
    channel round-trip + replay rejection, correlator, backoff bounds, buffer
    sliding window, and RpcMessage JSON.
  - Deferred to the next increment: `SessionCoordinator` orchestration
    (ConnectionPhase state machine + reconnection loop + Riverpod wiring),
    `TransportSelector` LAN discovery, `IncomingMessageProcessor`, and live
    WebSocket integration against a real bridge.

- **E2EE cryptography** — spec 02a §5.9 / 02b §5:
  - `KeyGeneration`: Ed25519 identity key pairs, X25519 ephemeral key pairs,
    CSPRNG nonces.
  - `HandshakeCrypto`: canonical transcript builder, Ed25519 bilateral
    sign/verify, and X25519 + HKDF-SHA256 session-key derivation
    (`salt = clientNonce || serverNonce`, `info = "uxnan-e2ee-v1"`).
  - `EnvelopeCrypto`: AES-256-GCM authenticated encryption with the documented
    envelope wire format (12-byte nonce, 16-byte tag); decryption failures
    surface as `TransportException(decryption)`.
  - `SecureSession` entity (in-memory key + seq counters) and `SecureEnvelope`
    value object.
  - `MessageFingerprinter` (SHA-256 via pointycastle) + `TextFingerprint`.
  - Tests against published vectors: Ed25519 (RFC 8032), X25519 (RFC 7748),
    HKDF-SHA256 (RFC 5869), AES-256-GCM (NIST all-zero), a full two-party
    handshake that proves both sides derive the same key, plus tamper/wrong-key
    rejection and SHA-256 known-answer checks.
  - Contract note: the transcript is the UTF-8 of the fields' wire strings
    concatenated in order (hex for byte fields, raw string for `sessionId`,
    decimal for integers); the bridge must mirror this exactly.
  - Library choice: AES-256-GCM uses the `cryptography` package (native
    acceleration via `cryptography_flutter`); the algorithm/params are exactly
    per spec — no variant. `pointycastle` remains for synchronous SHA-256.
  - Deferred to the connection module: WebSocket transport, secure-transport
    seq/replay enforcement, request correlator, LAN/relay transport selector,
    and the `SessionCoordinator` handshake orchestration (they need the live
    message flow / bridge).

- **Local persistence (drift / SQLite)** — spec 02c §10:
  - Full schema (`schemaVersion` 1): `threads`, `messages`, `turns`,
    `projects`, `trusted_devices`, `composer_drafts`, `git_action_log` tables,
    with WAL + foreign-keys pragmas.
  - `UxnanDatabase` (drift) with an in-memory `forTesting` constructor.
  - `Thread` domain entity + `IThreadRepository` / `IComposerDraftRepository`
    contracts.
  - `DriftThreadRepository` (faithful to spec §10.3) and
    `DriftComposerDraftRepository`.
  - DI providers: `databaseProvider`, `threadRepositoryProvider`,
    `composerDraftRepositoryProvider` (spec 03 §1.5 / §3.6 levels 1–2).
  - In-memory repository tests for the full thread CRUD + watch surface.
  - Table indexes use the real drift `@TableIndex` annotation (the spec's
    `List<Index> get indexes` sketch is not the actual drift API).
  - `Message`/`Turn`/`Project`/`TrustedDevice` repositories are deferred to
    their modules (they depend on the `MessageContent` sealed hierarchy,
    `AgentConfig`, or split storage with `SecureStore`); their tables already
    exist in the schema.

### Changed

- Migrated state management to **Riverpod 3.x** (`^3.0.0`), reconciling the
  spec's "Riverpod 3.x manual" guidance (AGENTS.md / 00-index). The state layer
  will use the modern `Notifier`/`NotifierProvider` API.
- Updated the Material 3 theme to provide both light and dark variants and
  follow `ThemeMode.system` instead of forcing dark mode. The shared design
  tokens now expose brightness-aware semantic colors, and existing screens were
  updated to consume theme-derived muted text colors.

### Added (foundation)

- Initial Flutter project scaffold (Android + iOS), package name `uxnan`,
  application id `com.uxnan.mobile`.
- Clean Architecture skeleton: `core/`, `domain/`, `application/`,
  `infrastructure/`, `presentation/` directory layers (per spec 02a §7).
- `core/` layer:
  - `protocol_constants.dart` and `app_constants.dart` (compile-time
    `--dart-define` configuration, spec 03 §3.3 / 02a §5.9.1).
  - Typed errors: `AppException`, `RpcException` (JSON-RPC code table),
    `TransportException`.
  - Extensions on `String`, `DateTime`, `Uint8List` (hex/base64).
  - `AppLogger` (gated by `ENABLE_LOGGING`) and `Debouncer` utilities.
- Domain enums: `MessageRole`, `TurnStatus`, `ThreadStatus`,
  `ThreadSyncState`, `HandshakeMode`, `ConnectionPhase`, `GitActionKind`,
  `AgentId` (with stable wire-id mapping).
- Material 3 design system: `colors.dart`, `typography.dart`, `spacing.dart`
  and the adaptive `buildUxnanTheme()` builder (spec 02c §3.1).
- App fonts bundled: Inter (400/500/600/700) and JetBrains Mono (400/500) under
  `assets/fonts/`, declared in `pubspec.yaml` (resolves the FOR-HUMAN item).
- App entry point: minimal `main.dart` (`ProviderScope`), `app.dart`
  (`MaterialApp.router` + theme + l10n), `app_router.dart` (`go_router`
  provider) and the home empty-state screen.
- Internationalization (`flutter_localizations` + ARB): English and Spanish.
- `analysis_options.yaml` based on `very_good_analysis` (spec 02c §15.1).
- Foundation tests: core extensions, `AgentId` mapping, and an app smoke test.
- iOS deployment target 15.0; Android `minSdk` 24 (spec 02b §3.4).

### Notes / deferred

- The following spec packages are added in their respective module increments
  to keep the build green until native configuration exists:
  Firebase (`firebase_core`, `firebase_messaging`, `flutter_local_notifications`),
  QR scanner (`mobile_scanner`, `permission_handler`), SSH terminal
  (`dartssh2`, `xterm`), rich media (`flutter_inappwebview`, `lottie`,
  `cached_network_image`, `shimmer`), `image_picker`, `file_picker`, `vibration`,
  and `freezed`/`json_serializable` (added when entities need them).
- Riverpod is pinned to `^3.0.0` (see the Changed entry above). The spec's 2.x
  `StateNotifierProvider` examples (02b §2.1) are adapted to the modern
  `Notifier`/`NotifierProvider` API when the state layer is built.
- `analysis_options.yaml` omits the spec's `prefer_relative_imports` rule
  because it contradicts `always_use_package_imports`; the project enforces
  full package imports (spec 03 §1.5).
