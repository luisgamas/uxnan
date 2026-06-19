# Changelog

All notable changes to the `uxnanmobile` app are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- **Seq-based catch-up on reconnect (mobile half)** — the phone now persists the
  highest bridge→phone `seq` it has applied per device and advertises it on
  reconnect so the bridge replays only the outbound it missed (spec 02a §5.9.2).
  `ClientHello` gained a `resumeState` field
  (`{ lastAppliedBridgeOutboundSeq }`, omitted when 0) serialized into the
  handshake; `SecureTransportLayer.performHandshake` forwards it. The applied
  seq (tracked by `SecureChannel.decrypt` on `SecureSession.bridgeOutboundSeq`)
  is persisted on `TrustedDevice.lastAppliedBridgeOutboundSeq` — a new nullable
  drift column (schema **v5**, additive migration) read/written by
  `TrustedDeviceRepository`. `SessionCoordinator` loads it into the handshake and
  checkpoints it on every teardown (drop / disconnect / socket close) **and**
  periodically on the heartbeat, updating the in-memory active device
  synchronously so an immediate reconnect advertises the freshest value. With
  the bridge half already shipped, reconnects now resume the bridge→phone stream
  instead of silently dropping anything sent while the phone was briefly away.
  Covered by `handshake_messages_test.dart` (resumeState serialization),
  `trusted_device_repository_test.dart` (column round-trip + older-row default
  0), and `session_coordinator_test.dart` (persists on disconnect, advertises
  resumeState on reconnect, first connection sends none). Note: a bridge restart
  resets its in-memory outbound log, so a stale resume point yields no replay and
  the phone re-syncs via `turn/list` — acceptable and expected.
- **Approval decisions persist across scroll + restart** — the user's
  decision on every interactive approval card (Approve / Reject / "always
  allow this session") is now stored on-device via
  `ApprovalResponseStore` (`infrastructure/storage/approval_response_store.dart`,
  SharedPreferences) as soon as the card is tapped. The next time the same
  card scrolls into view — even after a full app restart — it renders its
  **resolved** state (`Decision recorded · Answered 14:32`) with no
  action buttons, so an answered prompt can never be re-answered. The
  resolved view also picks up a risk-tinted outline (success / warning /
  error / neutral) and a muted body text, so the "already decided" state
  reads at a glance in line with the Neural Expressive design language.
  Two new l10n strings: `approvalDecidedTitle` ("Decision recorded" /
  "Decisión registrada") and `approvalAnsweredAt` ("Answered" /
  "Respondido"). Covered by
  `test/unit/infrastructure/storage/approval_response_store_test.dart`
  (9 cases: round-trip, persistence across store instances, idempotency,
  forget, defensive decoding of corrupt/malformed blobs) and two new
  widget tests in `conversation_widgets_test.dart` that pre-seed the
  store and assert the action buttons are absent after hydration.

### Docs
- **Synced the spec (`architecture/00-index.md`,
  `architecture/02a-system-architecture.md`,
  `architecture/02b-contracts-and-requirements.md`) with the code.** This
  is a docs-only change in the mobile app; no runtime behavior changed.
  Per `AGENTS.md` → *Spec drift control (non-negotiable)*, every `DONE` in
  this monorepo's `FOR-DEV.md` is now reflected in the spec. The spec was
  behind the code (Neural Expressive, manual-code pairing bridge-first,
  voice, image attachments, per-model run-option knobs, context-usage
  indicator, per-agent `auth/status`, interactive approval, full Git,
  etc.). The spec now matches.
  - `architecture/00-index.md`: status table updated to the live
    Android-alpha-ready state (Neural Expressive added, the full repo
    set, manual-code pairing bridge-first, voice, stop-the-turn, attach,
    per-model run-option knobs, context-usage indicator, per-agent
    `auth/status`, interactive approval, per-PC threads with
    connection-targeted live actions, thread lifecycle actions, Remove
    device, full Git with per-file diff, push with deep-link +
    preferences + persistence). `architecture.old/` removed from the
    monorepo tree (archived in git tag `pre-architecture-old-archive`);
    relay marked as optional / self-hosted.
  - `architecture/02a-system-architecture.md`: section 2 (topologies
    re-ranked: LAN-direct and Tailscale-direct as primary/recommended;
    relay demoted to self-hosted fallback); section 3 (`IAgentAdapter`
    updated with the methods and capabilities that the app actually
    consumes today); section 5.5.3 (manual-code pairing reframed as
    bridge-first); section 5.5.4 (`PairingPayload` v2 with optional
    `relay` + `hosts`); section 5.10 (push split into bridge-direct
    primary + relay fallback).
  - `architecture/02b-contracts-and-requirements.md`: the canonical 59
    JSON-RPC methods + 8 streaming notifications the app consumes (or
    may consume) today + cross-cutting shapes (`PairingPayload` v2,
    `TurnSendParams`, `TurnAttachment`, `ApprovalResponse`, `AgentModel`,
    `AgentCapabilities`, `TurnUsage`).
- **Updated this monorepo's `README.md`** to reflect the Android
  alpha-ready state (status section, the full MVP, the iOS pending
  FOR-HUMAN list, the test count, the new i18n + Neural Expressive
  stack entries).

### Fixed
- **App-bar menu buttons ripple as circles, not squares.** The sort / more /
  pairing / conversation / git overflow menus wrapped a round surface in a
  `PopupMenuButton`, whose internal `InkWell` is rectangular — so the press
  ripple read as a square over the circle. New shared `IconSurfaceMenu` drives
  `showMenu` from a real `IconSurface`, so the ripple is clipped to the circle
  and the M3E press-scale spring plays, matching the standalone bar actions.
- **"Remove worktree" now appears** for worktree-backed threads: the app
  persists the `worktreePath` it created (the bridge doesn't track it), which is
  what gates the action.
- **Branch delete protects the primary branch** (`main`/`master`) and the
  current branch, and only offers deletion for local branches (never remotes).
- **Conversation auto-scroll reaches the true bottom.** It jumped to a stale
  `maxScrollExtent` (captured before streaming/late layout finished), landing
  just short and fighting a manual drag-down. It now jumps to the live bottom
  and re-checks next frame to catch late layout.

### Added
- **Git revert + branch/worktree deletion wiring.** `GitActionManager` gains
  `revert` (`git/revert`), `deleteBranch` (`git/deleteBranch`, `force`) and
  `removeWorktree` (`git/removeWorktree`, `force`) now that the bridge implements
  them. The git screen's overflow menu adds **"Revert last commit"** (creates a
  revert commit, preserving history — distinct from Undo commit). Branch-delete /
  worktree-management UI + cwd-vanished composer disable (`workspace/exists`) are
  follow-ups (see `FOR-DEV.md`).

### Fixed
- **Foreground push no longer fires for the conversation on screen.** The
  bridge-direct FCM push raised a foreground notification even while the user
  was viewing that conversation (the per-thread suppression only covered the
  local domain-event path). `PushNotificationService` now suppresses a
  foreground FCM whose `threadId` is the active conversation and — while
  connected — defers to the live WS/domain-event path so a push never
  duplicates the notification it already raises; a disconnected foreground (the
  devices list) still shows it. Covered by `foreground_push_suppression_test.dart`.

### Changed
- **Devices app-bar pairing entry is a floating menu** offering **Scan QR** or
  **Enter manual code**, instead of a single scan button. Uses the same
  `PopupMenuButton` + Icon-Surface style as the threads sort/more menus.

### Added
- **Manual-code pairing (`ManualCodeScreen`).** Pair without scanning a QR by
  typing the bridge **host** + the short **pairing code** shown on the PC. A new
  `ManualPairingService` (`infrastructure/pairing/`, dio) calls the bridge's
  `GET /pair/resolve?code=` directly, decodes the returned `PairingPayload`, and
  hands it to the normal `SessionCoordinator.processPairingPayload` handshake.
  Tolerant host parsing (`host` or `host:port`, default port 19850, scheme/path
  stripped) and classified errors (bad/expired code, rate-limited, unreachable,
  malformed). Reachable from the onboarding pair page ("Enter a code instead",
  route `/pairing/manual`). Covered by `manual_pairing_service_test.dart`.
  **UI pending the maintainer's on-device review** (AGENTS.md "UI changes").
  mDNS auto-discovery is a follow-up (`FOR-DEV.md`).
- **History windowing + conversation fork/resume.** The conversation timeline
  now renders only the most-recent page and offers a **"Show earlier messages"**
  header to load older history on demand (`ThreadManager.loadMoreHistory`),
  bounding widget build for long threads. A **"Fork conversation"** overflow
  action deep-copies the thread on the bridge (`thread/fork`) and opens the new
  one; opening a conversation now best-effort **resumes** it on the bridge
  (`thread/resume`, skipping archived threads). Incremental *remote* back-paging
  is a documented follow-up (the bridge's `turn/list` cursor is forward-only).
- **Image attachments in the composer (app side).** The "+" turn-tools sheet's
  Attach action (shown for `images`-capable agents) now picks an image from the
  **photo library** or **camera** (`image_picker`, downscaled to 2048 px / q85).
  Pending images appear as a removable thumbnail strip above the composer, an
  image-only message (empty text) can be sent, and sent/received images render
  inline. The image rides on `turn/send` as `attachments` and is echoed locally.
  **Dormant for delivery until the bridge accepts attachments** (no
  `TurnSendParams.attachments` / `AgentManager.sendTurn` forwarding yet) — the
  contract is documented in `FOR-DEV.md`.
- **Interactive approval prompts (app side).** The in-timeline approval card is
  now interactive: **Approve**, **Reject**, and **Always allow this session**,
  with a spring morph into a settled status row, an in-flight spinner, and
  re-enable on failure. `ThreadManager.respondApproval` sends the decision via
  `turn/send { approvalResponse: { approvalId, decision } }`; an in-memory
  `ApprovalResponses` provider tracks the per-request sending/resolved/failed
  state. **Dormant until the bridge supports approvals** — the Claude adapter
  runs headless and Echo doesn't emit requests, so this can't fire on-device
  yet; the exact bridge contract (emit + accept + route) is documented in
  `FOR-DEV.md`. Plan/subagent blocks were verified to be informational, not
  approval gates.
- **Extended git actions (branch & remote).** `GitActionManager` gains `pull`
  (`git/pull`), `checkout` (`git/checkout`), `createBranch` (`git/createBranch`)
  and `createWorktree` (`git/createWorktree`), surfaced in the git screen where
  each belongs rather than in a catch-all sheet:
  - **Pull** is a badged app-bar action that appears only when the branch is
    behind its remote (the badge counts the incoming commits).
  - **Switch branch** and **New branch** (create + checkout) live in the
    three-dots overflow menu.
  - The commit composer **morphs into a push control** once the working tree is
    clean and the branch is ahead — the commit button becomes a badged Push and
    the extra-options toggle becomes Undo-last-commit — so push and undo are no
    longer buried in the overflow menu.
  - **Worktree creation moved to the new-conversation dialog**: an optional "Run
    in a worktree" toggle creates an isolated branch checkout from the chosen
    working dir and starts the conversation in it. The phone derives a sibling
    path (the bridge needs an explicit path — no managed/auto-path yet); a "Let
    the bridge pick the location" switch forwards `managed` for the future.
  - Not wired yet, all blocked on missing bridge support (tracked in
    `FOR-DEV.md`): revert (`git/revert`), safe branch/worktree **deletion**
    (`git/deleteBranch` / `git/removeWorktree`), and detecting a vanished
    cwd/worktree to disable the threads that lived in it.
- **Branding footer on the devices list.** The home screen now shows a small
  footer at the bottom: the localized app name ("Uxnan Mobile" / "Uxnan
  Móvil") and an "ALPHA" release-stage pill. The footer uses
  `SliverFillRemaining(hasScrollBody: false)` so it pins to the bottom of
  the screen with few paired PCs, and shrinks to its natural size right
  after the last card when the list is long — it never leaves a
  screen-sized white gap when you scroll. The pill is a neutral,
  non-interactive label (modeled on the existing `_RiskBadge` /
  `_TokenChip` pattern) so the alpha status is always visible without
  standing out across theme changes.
- **"Scroll to latest on send" setting** (Settings → Conversation, on by
  default). When you send a message the conversation jumps to your message even
  if you'd scrolled up; turn it off to keep your manual scroll position on send.
  (Auto-scroll still follows the stream while you're near the bottom.)

### Changed
- **Neural Expressive UI redesign — pilot: the conversation screen.** Reworked
  the conversation surface to the Material 3 Expressive / Neural Expressive
  design language (see `docs/neural-expressive-design.md`), cutting the visual
  noise the old layout accumulated **while preserving every function**:
  - The large two-line app bar is gone. A lean **56 dp transparent top bar with
    a scroll veil** carries only the **model-picker pill**, the git action and
    the overflow menu — each on the neutral circular **Icon Surface** tone (the
    overflow menu now matches the git action; the connection dot was dropped, as
    earlier screens already show online state).
  - **Context usage and the turn's numeric diff moved out of the chrome** to a
    compact, right-aligned info row just above the composer: `+a −d` (numbers
    only — the Git screen has the detail) next to the context indicator, both on
    the same neutral surface as the Icon Surfaces.
  - The composer is now a **fully-rounded floating pill** (matching the model
    pill and Icon Surfaces) with only the essentials: a "+", the text field, and
    a mic that swaps to Send (and to Stop while a turn runs). Its controls share
    one vertical baseline; it stays editable while offline (draft now, send when
    reconnected) — only *sending* is gated.
  - The "+" opens a unified **turn-tools sheet** (attach + run-option knobs +
    approval mode), replacing the always-on options strip above the composer.
  - Agent activity now reads as a **morphing polygon loader** at the *start of
    each streaming response* (not a bar across the top).
  - **Floating menus are rounded and roomier** (16 dp corners, min width) — the
    overflow menu and the run-option knob menus, plus 28 dp bottom-sheet corners.
  - The **work log** and the **reasoning ("Thinking")** section share one light
    **borderless** container (hairline outline, no fill). The work log shows its
    first few **commands inline (one truncated line each)**, in order, under the
    message that triggered them; its **header is always tappable** (even a single
    command expands to its full text + output), with a "+N" hint when collapsed.
    Thinking stays collapsed by default, gated to the Settings → Conversation
    toggle.
  - A matching **bottom scroll veil** sits above the composer (mirroring the top
    bar): the last messages fade into the surface as they reach it.
  - New shared building blocks for the rollout: spring-motion tokens
    (`theme/motion.dart`), `IconSurface`, `NeTopBar`, `PolygonLoader`, and the
    pill composer + turn-tools sheet.

  This is a UI proposal pending on-device review (per the propose → review →
  adjust → approve workflow). The remaining screens (devices, threads + the
  navigation drawer, git, settings) follow in later increments. The context
  meter moved out of the composer, so its two composer-level widget tests were
  retired; all other conversation tests still pass.

### Fixed
- **Streaming turns now truly interleave the work log with the response.** The
  live turn buffer preserves the order text and command/diff blocks arrive in,
  instead of accumulating all text in one string and all blocks in another and
  rendering every command above the answer. The activity now sits under the
  message that triggered it, in execution order. Persisted turns keep that order
  across a `turn/list` re-sync (the split text runs reconcile to the same full
  answer); a turn loaded purely from history can't interleave yet — the wire
  `blocks` array carries no per-block text offset (tracked as `FOR-DEV` in
  `thread_manager`).
- **Agent responses no longer collapse into one block.** An assistant turn now
  renders its work logs and responses **in chronological order** (a work log
  sits just above the response it precedes) instead of stacking every work log
  on top of one merged prose block — interleaved responses read as separate
  paragraphs again. Thinking stays at the top; the Changed files summary at the
  end. (No functionality lost.)
- **Context meter persists when you re-open a chat** — the bridge now stores a
  turn's token usage and returns it in history, and the phone restores the meter
  on re-sync, so it no longer resets to 0 on leaving and returning to the same
  conversation.

### Added

- **Stop the agent mid-turn.** While the agent is producing a turn, the composer
  Send button becomes a red **Stop** button that cancels the in-flight turn
  (`turn/cancel`, via `ThreadManager.cancelTurn`) without closing the thread — so
  a message sent by mistake can be stopped and rewritten.
- **Copy your own message.** Tapping a user (right-side) bubble toggles a **Copy
  message** action beneath it (hidden by default), mirroring the agent turn's
  copy action. The user bubble's text is no longer selectable (the tap toggles
  the copy affordance instead of placing a cursor).
- **Work log / Changed files / thinking now also populate for Codex, pi and
  OpenCode** (the phone already decodes the structured events; the bridge now
  emits them for every agent — see `bridge/CHANGELOG.md`). Pending on-device
  verification of each CLI's tool shapes.

### Changed

- **Conversation centers within a max width on wide screens (tablets).** The
  message list, the above-composer chrome (login banner, run-options strip,
  "Last edits" strip) and the composer content are now constrained to
  `UxnanSpacing.maxContentWidth` and centered, so extra horizontal space becomes
  side margins instead of over-wide messages and a composer whose right-hand
  controls floated far from the edge. The app bar and the composer's surface
  still span the full width.

### Fixed

- **Part of an agent reply no longer disappears after leaving and re-opening a
  conversation.** Fixed in the bridge (it was storing only the final segment of a
  tool-using turn); see `bridge/CHANGELOG.md`. The phone already kept the full
  streamed text live.
- **Context meter no longer stuck at 0** for turns where the agent's `result`
  event omitted token usage (bridge fallback to per-message usage).

### Added

- **Work log & Changed files now populate (structured commands/tools/diffs).**
  The bridge emits the agent's shell commands, file edits and tool calls as
  structured `stream/content/block` events; the phone decodes each into a
  `MessageContent` (`ContentBlockEvent` → timeline reducer) and folds it into the
  turn, so the collapsible **Work log** (Bash → command cards, other tools →
  rows) and **Changed files** (Edit/Write → per-file diffs with +/- counts) — and
  the green/red **Last edits** strip above the composer — finally fill in. Blocks
  stream live and are persisted (survive `turn/list`). Claude Code today; Codex/pi
  next.
- **Agent "thinking" (reasoning) in conversations — first structured-content
  slice.** Claude Code's extended-thinking output now flows end-to-end: the
  bridge parses `thinking_delta` blocks and emits a new `stream/thinking/delta`
  event (persisted on the message), and the phone renders it in a **collapsible
  "Thinking" section** at the top of the agent's turn (`ThinkingContent` block,
  default collapsed). A **Settings → Conversation → "Show agent thinking"**
  toggle (persisted) controls whether it appears. Thinking is kept out of the
  copied response / previews. (Commands, tools and diffs are the next slices —
  they still arrive as text until the bridge emits structured blocks for them.)
- **Workspace browser: "up one folder" button.** The folder-picker sheet now has
  an explicit up-one-level button to the left of the breadcrumb (disabled at a
  root); the breadcrumb still navigates on tap.
- **Voice → text in the composer.** The composer mic now dictates into the
  message field via on-device speech-to-text (`speech_to_text`): tap to start,
  tap again (or a final result) to stop, with recognized words streaming in
  live and a recording state on the mic chip. A guarded `SpeechToTextService`
  (+ `speechToTextServiceProvider`) no-ops without the plugin / mic permission,
  so the app and tests run unaffected; an "unavailable" snackbar covers the
  denied/unsupported case. Android `RECORD_AUDIO` is wired; iOS Info.plist
  usage strings are FOR-HUMAN. On-device verification is deferred (needs a mic).
- **Structured agent turns in the conversation (work log, changed files,
  copy).** An assistant reply now renders as a structured, full-width turn
  (`AssistantTurnView`): a collapsible **Work log (N)** of the commands/tools it
  ran, the prose answer, a collapsible **Changed files (N) · +a −d** summary at
  the end (each file expands to its diff), and a **Copy response** action that
  copies the full text. A compact green/red **Last edits** strip above the
  composer mirrors the latest turn's `+a −d · N files`. Diff +/- counters are now
  colored (green additions / red deletions) everywhere.
- **Settings screen + notification preferences (`notifications/update`).** A new
  `SettingsScreen` (route `/settings`, reached via a gear action in the devices
  app bar) lets the user toggle the **Replies** (`turnCompleted`) and **Errors**
  (`turnError`) notification channels with M3 `SwitchListTile`s. A
  `NotificationPreferences` value object, an on-device `NotificationPreferencesStore`
  (`shared_preferences`) and `notificationPreferencesProvider` are now the source
  of truth: the `PushRegistrar` sends them as `preferences` on
  `notifications/register` and gates the local notifications it raises, replacing
  the hard-coded `{turnCompleted:true, turnError:true}`. Toggling persists locally
  and best-effort calls `notifications/update` while a PC is connected (a silent
  no-op offline / against an older bridge). Covered by unit + widget tests.
- **pi agent support.** The `pi` CLI is now a fully wired agent on the bridge,
  so it appears in the app like the others through the existing data-driven UI
  (model picker, reasoning-effort knob via `--thinking`, context meter, sign-in
  status). Added its monochrome logo (`assets/images/agents/pi.svg`, tinted via
  `currentColor`) and wired `AgentVisuals` (logo/label "pi"/accent). No UI code
  changes were needed — the app already renders any agent the bridge advertises.

### Changed

- **Agent replies no longer sit in a chat bubble.** Only the user's own
  messages keep a (right-aligned) bubble; assistant turns render full-width, so
  the whole answer is one clean selectable surface and consecutive text is merged
  into a single selectable region instead of many fragments that copied as if
  they were separate messages.
- **Model picker grouped by provider + no inline-dropdown jank.** The model
  picker (`model_picker_sheet.dart`) now groups models under provider headers
  (M3 list subheaders) for multi-provider agents like pi/OpenCode, flattened
  into one lazy `ListView.builder` so hundreds of models stay cheap; agents with
  a single provider (Claude/Codex) render flat without headers. Grouping is a
  pure domain helper (`groupModelsByProvider` in `agent_model.dart`, unit-tested).
  The new-conversation dialog's model field no longer builds a giant inline
  `DropdownMenu` (which stalled for pi's ~326 models) — it's a tappable field
  that opens the same sheet, showing the selected model and a spinner while the
  list loads.
- **Conversation app bar scrolls away for more reading room.** The large app
  bar drops `snap` (keeps `floating`, stays non-pinned), so it scrolls fully out
  of the way with the content and returns proportionally on scroll-up instead of
  snapping the tall header open — more clean space for messages.
- **Consistent `.large` app-bar title height across screens.** The conversation
  app bar used a two-line `Column` title (title + connection/"Responding…"
  status), which sat at a different level/size than the single-line titles on
  the devices, threads and archived screens. Its title is now a single-line
  `Text` like the others, and the live connection / responding state moved to a
  compact dot/spinner indicator in the actions (tooltip carries the label) — so
  all four `.large` bars align at the same title level and size.
- **Conversation options strip: coherent spacing + collapsible.** The reasoning
  (run-option) and approval-mode controls are now one strip above the composer
  with consistent vertical rhythm (fixes the run-option chip sitting flush
  against the composer for pi, and the over-large gap when both showed). A
  `tune` toggle in the composer toolbar collapses/expands the strip
  (`AnimatedSize`), shown only when there's something to toggle.
- **Manual "Check sign-in" on the not-signed-in surfaces.** Both the
  new-conversation agent card and the **conversation login banner** now offer a
  **Check sign-in** `TextButton` that re-queries `auth/status` on tap (spinner
  while checking), so the user can verify sign-in without leaving the screen —
  complementing the on-resume refresh. The card also gains a soft error tint
  (replacing its static "Sign in required" text); the banner keeps its
  error-container strip (the M3 alert-with-action shape — not a `MaterialBanner`,
  which is a top-of-content component) and adds the action at the end. Both
  reuse `authStatusProvider` + `ref.invalidate` and un-resolve once signed in.

### Fixed

- **Agent sign-in status refreshes after a PC-side login.** `auth/status` is
  cached per agent and the PC's sign-in state can change with no phone-side
  reconnect, so a re-login on the PC left the app showing the agent as "not
  signed in". The app now re-queries `auth/status` on **app resume** (a new
  `authStatusRefreshProvider` tick that `authStatusProvider` watches; `_PushHost`
  bumps it on `AppLifecycleState.resumed`), clearing the stale banner / red dot.

### Added

- **Context meter always visible for usage-reporting agents.** The composer's
  context meter now shows for any agent that reports token/context usage (new
  per-agent `reportsContextUsage` capability — Claude/Codex true, OpenCode
  false), at a **0 baseline** until the first turn reports usage (then the
  percentage ring once the window is known, or the raw token count). Agents that
  report no usage show nothing, as before.
- **Data-driven run-option knobs.** The conversation screen now renders the
  per-model run options the bridge advertises on `agent/models` (today a
  **Reasoning effort** enum on Claude/Codex models) as a generic control bar
  above the composer, and sends the chosen values on `turn/send` via `options`
  (persisted per thread, in memory). The renderer is fully data-driven —
  `AgentModelOption`/`AgentModelOptionValue` entities, an `activeModelOptions`
  provider that resolves the thread's model, and a `runOptionSelections`
  notifier — so a new knob (or a new agent) needs **no app change**; `enum`
  renders as a value menu, `toggle` as a filter chip, and unknown kinds are
  ignored. Phase 3 of the per-model run-options seam.
- **Relay-vs-direct transport indicator.** The connected PC's card now shows how
  the live channel runs — **Relay** or **Direct** (LAN/Tailscale) — read from
  the bridge's `bridge/status.relayConnected`, which the app previously ignored
  (it used `bridge/status` only as a reachability ping). New `BridgeStatus`
  entity (tolerant parser) and a `bridgeStatusProvider` that refreshes whenever
  the connected device changes and short-circuits to nothing while offline.
- **Remove device.** The paired-PC card's overflow menu now has a destructive
  **Remove device** action: after a confirmation dialog it tells the bridge to
  revoke this phone's trust (`bridge/removeTrustedDevice` with the phone's own
  id, best-effort and only when connected to that PC), tears down the session if
  it was the connected one, and wipes the PC's local data — the `TrustedDevice`
  plus all its threads, messages and turns (new
  `IThreadRepository.deleteThreadsByDeviceId` and
  `SessionCoordinator.removeTrustedDevice`). Lets the user clear a stale PC and
  fully unpair. Menu labels are now `Flexible` so long entries never overflow.
- **Agent sign-in banner (`auth/status`).** The conversation screen now queries
  the bridge's sanitized per-agent `auth/status` for the active thread's agent
  and shows a warning banner above the composer when that agent is **not signed
  in on the PC** (turns won't run until the user logs into its CLI there). New
  `AuthStatus` entity (tolerant parser, never carries tokens),
  `ThreadManager.loadAuthStatus(agentId)` and an `authStatusProvider`
  `FutureProvider.family`, mirroring the existing `agentModels`/
  `agentCapabilities` providers. The banner is gated on actually holding this
  thread's PC channel (`connectedHere`) and degrades to nothing while offline or
  against an older bridge. Informational only for now — there is no in-app login
  yet (the bridge's `auth/login` is still a stub), so it points the user to the
  PC; it also renders a "Signing in…" state for `loginInProgress`.
- **Sign-in status before entering a conversation.** The agent's sign-in state
  (`auth/status`) is now surfaced earlier, reusing `authStatusProvider`: the
  **new-conversation** agent card shows a red "Sign in required" marker when the
  agent is installed but not signed in (distinct from "Unavailable" — the card
  stays selectable), and a thread's **status dot in the list turns red** (with a
  tooltip) when its agent is not signed in, instead of the usual active green.
  Both degrade to no marker while offline or against an older bridge.

### Fixed

- **Crash when leaving a conversation (`Tried to modify a provider while the
  widget tree was building`).** The conversation screen cleared the foreground
  marker by mutating `foregroundThreadProvider` synchronously in `dispose()`,
  which Riverpod rejects during unmount. It now defers the clear to the next
  event-loop tick (`leave()` stays a no-op if another thread is already in
  front), so back-navigation no longer throws.
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
