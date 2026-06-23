# FOR-DEV — pending developer work

Deferred implementation work (code the team/agent will do later). Distinct from
`FOR-HUMAN.md` (assets only a human can provide). Search the codebase for
`FOR-DEV:` to jump to the exact deferral sites.

> Convention defined in the root `AGENTS.md` → "Pending developer work".

## FOR-DEV: Bug A — relink latency after returning from "recents" (URGENT, immediate)

**Status:** open. Diagnostic instrumentation is in place (Option 1); the actual
fix is pending the captured logs.

**Symptom (user-reported, remote/Tailscale LAN-direct setup,
`relayEnabled:false` on the bridge):** a full app kill → reopen reconnects fast,
but leaving the app in "recents" for a while → reopen often fails to relink the
phone↔bridge session for a long time (feels like it never relinks), so the user
force-kills to get an instant reconnect. The bridge log shows LAN reconnects DO
happen repeatedly, so this is **relink latency**, not a hard "never reconnects".

**Suspected cause (to confirm with logs):** on resume, `SessionCoordinator.resume`
runs a 6 s `bridge/status` probe; on a half-open socket it times out → reconnect
loop with backoff (up to 60 s). Each attempt may also waste time on the
`DirectTransportSelector` **relay fallback** (`relay.uxnan.io`, 10 s connect +
15 s handshake) which has no bridge behind it (relay disabled), and/or sit in a
slow handshake step (15 s) while `resume`'s `_reconnecting` early-return only
wakes the backoff (a no-op mid-`_establish`).

**Where (deferral sites, all `// FOR-DEV` tagged):**
- `lib/application/coordinators/session_coordinator.dart` — `resume`,
  `verifyConnection`, `_runReconnectLoop`, `_dropAndReconnect`, `_heartbeatTick`.
- `lib/infrastructure/transport/transport_selector.dart` — `DirectTransportSelector.select`.

**Option 1 (prepared, in this commit):** temporary `[reconn]` diagnostic logs at
the sites above time every step (probe, each reconnect attempt, each transport
attempt + relay fallback). **To capture:** build with
`--dart-define=ENABLE_LOGGING=true` (logs are suppressed otherwise — see
`AppConstants.enableLogging`) and read `adb logcat` while reproducing
(background → wait → reopen). Then pin the dominant cost and fix
(candidates: skip/parallelize the dead relay fallback, interrupt a stuck
`_establish` on resume, shorten the first post-resume backoff). **Remove the
`[reconn]` logs once root-caused.**

**Recovery context (in case the uxnanmobile chat history is lost — so this can be
resumed from a new session):**
- Claude Code session ID: `24aeeeb5-11fc-4a2f-9cb3-8e9362280d44`
- uxnanmobile thread ID: `09b6668e-6b41-41cc-80a4-9c7e78790260`
- Related prior evidence (the original report session): Claude Code
  `71698c0b-6e8d-4207-8dda-9dae48e043db` / mobile thread
  `4fadeb99-ab18-4ee1-9eb9-535b1fcff3aa`; pi
  `019eeb97-72cb-7045-9573-478ae5e21ed4` / mobile thread
  `2d352d74-6e20-4cfd-8205-972f66443930`.
- The companion bug (tool approvals auto-rejecting while backgrounded) is already
  FIXED on this branch — see `bridge/CHANGELOG.md` "keep tool approvals pending
  while the phone is offline".

## FOR-DEV: keep the R8 keep rules complete (release minification is ON)

`android/app/build.gradle.kts` keeps `isMinifyEnabled = true` +
`isShrinkResources = true` for `release` (smaller APK). R8 full mode (AGP 9
default) had stripped the no-arg constructors of the reflectively-instantiated
ML Kit (`BarcodeRegistrar`) and Firebase (`FirebaseMessagingKtxRegistrar`)
component registrars (`NoSuchMethodException: <init>[]`), breaking the QR
scanner (mobile_scanner NPE) and background push in `--release`.
`android/app/proguard-rules.pro` now keeps those.

Watch for regressions: if a **new** reflective dependency works in debug but
breaks only in `--release`, add its keep rule to `proguard-rules.pro` (debug
doesn't minify, so it won't catch it). Always re-test a real QR scan **and** a
background push in a `--release` build before shipping.

## Recommended next steps (mobile-only, no live bridge needed)

These can be built and unit/widget-tested locally; bridge calls degrade
gracefully until the other agent wires the handler. Suggested order:

1. ☑ **Advanced content `approval`/`plan`/`subagent`** (decode + render) —
   DONE; interactive approval is now wired on the app side (Approve / Reject /
   allow-session via `turn/send { approvalResponse }`) but **dormant until the
   bridge emits/accepts approvals** — see *Conversation / timeline → Interactive
   approval* for the bridge contract. Plan/subagent confirmed informational.
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

- ☑ **Manual-code pairing** — DONE (2026-06-16): `ManualCodeScreen`
  (`/pairing/manual`, reachable from the onboarding pair page) + a
  `ManualPairingService` (`infrastructure/pairing/`, dio) that calls the
  **bridge's** `GET /pair/resolve?code=` (the bridge-first endpoint — NOT the
  relay `/trusted-session/resolve`) to synthesize a `PairingPayload`, then runs
  the existing `SessionCoordinator.processPairingPayload`. Tolerant host parsing
  (`host`/`host:port`, default 19850) + classified errors. Pure helpers
  unit-tested. ☐ Still open:
  - ☐ **On-device verification** against a live bridge (type the host + code the
    `qr` CLI prints, confirm the handshake completes).
  - ☑ **mDNS browse — DONE (2026-06-18).** A **Browse nearby bridges** action on
    `ManualCodeScreen` opens `BridgeDiscoverySheet`, which streams bridges
    advertising `_uxnan._tcp` (`BridgeDiscoveryService` over the native `nsd`
    plugin — NsdManager / Bonjour, which handles the Android multicast lock).
    Picking one pre-fills the host (the user still types the code); manual host
    entry stays the fallback. TXT/addr parsing (`parseDiscoveredBridge`) is
    unit-tested. Android `INTERNET` + `CHANGE_WIFI_MULTICAST_STATE` added; iOS
    `NSBonjourServices` + `NSLocalNetworkUsageDescription` added (copy review is
    `FOR-HUMAN.md` §4). ☐ On-device: verify discovery lists a real bridge on the
    same Wi-Fi.
  - ☐ **UI visual review** — the screen is a minimal M3 form; restyle to the
    Neural Expressive language after the maintainer reviews it on-device
    (AGENTS.md "UI changes").
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

- ☑ **Background → resume reconnection + cold-start auto-connect** — DONE
  (2026-06-18). The app no longer gets stuck "disconnected" after the OS
  suspends/drops the socket on background. `SessionCoordinator.resume()` (called
  from `_PushHost.didChangeAppLifecycleState` on `resumed`): wakes a pending
  reconnect backoff so it retries **immediately** (new `_reconnectWake`
  Completer + `_waitForRetry` race — the existing single-flight loop is
  untouched), else `verifyConnection()` (round-trips `bridge/status` when
  believed-connected, kicks a reconnect when disconnected). The open
  conversation re-syncs via `ThreadManager.resyncActive()`. On launch,
  `_PushHost._autoConnectLastDevice()` reconnects to the most-recently-used PC
  (`lastSeen`, best-effort + backoff fallback), so reopening after an unexpected
  close restores the session and the `turn/list` re-sync recovers the thread's
  history (drift preserves it across restarts; reconciled by the deterministic
  assistant id). Covered by coordinator (resume/wake/no-op) + `resyncActive`
  tests. ☐ On-device: minimize+reopen shows connected (not stuck); kill+reopen
  auto-reconnects and the thread history is intact. **Note:** a *truly* always-on
  background socket (vs. fast resume-reconnect) would need an Android foreground
  service / iOS background mode — out of scope; resume-reconnect is the mobile-
  appropriate approach.
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
  - ☑ **mDNS/Bonjour discovery — DONE (2026-06-18)** via the manual-pairing
    **Browse nearby bridges** flow (see *Pairing module → mDNS browse*). Lets the
    user pick a bridge without the QR `hosts`; manual host stays the fallback.
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
  dot), cleared on open. ☑ **Sort/density now persisted** (2026-06-18):
  `ThreadListPreferencesStore` (`uxnan.threads.sort`/`uxnan.threads.compact`)
  + `threadSortProvider`/`threadDensityCompactProvider`; both the active and
  archived lists share the persisted choice (survives restart). Store
  round-trip tested.
- ◑ **Scope threads to the connected PC / project** — **PC scoping DONE +
  connection-targeting DONE**: `Thread.deviceId` tags each thread with its PC and
  the list filters by it. Crucially, **all live actions now target the PC we
  actually hold a channel to**, not merely the one being browsed: the threads
  online dot, the new-conversation FAB and refresh are gated on
  `connectedDeviceProvider == this PC` (with an offline banner offering a
  validated Connect), and the conversation composer is disabled unless connected
  to the thread's PC — so a message can never be sent over a *different*
  connected PC's channel. Browsing a PC no longer changes the connection target
  (`setActiveDevice` removed from the browse path). ◑ **Project-level scoping —
  implemented, DISABLED in the UI (2026-06-18).** The client-side filter is
  fully built — a `_ProjectFilterBar` on `ThreadsScreen` slicing by a project
  key (`projectId` ?? `cwd`, labelled by the folder basename), composing with
  the agent filter — and the bridge scopes too (`loadThreads(projectId:)`). But
  it is **intentionally not shown**: a flat chip bar isn't the right surface
  (maintainer call). Gated behind `_ThreadsScreenState._projectFilterEnabled`
  (a getter returning `false`, with a `FOR-DEV:` note). ☐ **To enable:** surface
  it from a proper **advanced filters / organization view** and flip the flag —
  no other code/back change needed. The `thread/list` JSON shape is still
  assumed (tolerant parser) — verify against the real bridge.
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
  - ☑ **Expose the thread id + agent session id in the UI — DONE both sides
    (2026-06-18).** The conversation overflow menu's **Session info** item opens a
    sheet with the copyable **Thread ID** plus the agent's **native session id**
    (Claude `session_id`, OpenCode `sessionID`, …) and a "resume from the CLI"
    hint. The bridge now surfaces it: `toThread` includes `agentSessionId` (shared
    `Thread.agentSessionId`), so `thread/read`/`thread/list` carry it; the phone
    fetches it lazily via `ThreadManager.readAgentSessionId` (no drift migration —
    transient, online-only, which is the resume context anyway). ☐ On-device:
    confirm a real agent's session id shows and resumes from the CLI.
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
  - ☑ **Interactive approval** — APP SIDE DONE; **bridge wired 2026-06-16** (no
    mobile change needed). The approval card is interactive
    (`message_content_view.dart`): Approve / Reject / "always allow this
    session", a spring `AnimatedSize` morph into a settled status row, an
    in-flight spinner, and re-enable on failure.
    `ThreadManager.respondApproval({threadId, approvalId, decision})` sends the
    response; `ApprovalResponses` (`approval_providers.dart`) holds the local
    sending/resolved/failed state per `approvalId`; decisions are the
    `ApprovalDecision` enum (`approve` / `reject` / `approveSession`).
    - **CONTRACT — DONE bridge-side.** `shared` added `ApprovalDecision` /
      `ApprovalResponse` / `ApprovalRequestBlock` + `TurnSendParams.approvalResponse?`
      (and `text` is now optional). The bridge:
      1. **Emits** approval requests as an `approval` content block on
         `stream/content/block` (`{ approvalId, action, risk, detail? }`) — the
         form the app already decodes (nested or flat).
      2. **Accepts** `turn/send { approvalResponse }` (no new turn) and routes the
         decision via `AgentManager.respondApproval` → the agent adapter.
      3. **Routing:** the **Echo** dev-agent emits a sample approval for the text
         `approval-demo`, AND **Claude Code** now drives real tool approvals
         (opt-in `agents['claude-code'].interactiveApprovals` on the bridge — a
         `PreToolUse` hook round-trips each tool to the phone). Both validated
         end-to-end. **Codex** real approvals are still deferred (needs the
         app-server turn protocol — see `bridge/FOR-DEV.md`).
    - ☑ **On-device paths — VALIDATED (2026-06-18):** (a) any agent → start an
      **`echo`** thread, send `approval-demo`; (b) **Claude** with
      `interactiveApprovals` (opt-in `PreToolUse` hook) enabled → ask it to run a
      tool (e.g. write a file) and the card → Approve/Reject gates it. Both
      confirmed on-device. No mobile change was needed; the app is generic.
    - ☑ **On-device paths that work today:** (a) any agent → start an **`echo`**
      thread, send `approval-demo`; (b) **Claude** with `interactiveApprovals`
      enabled → ask it to run a tool (e.g. write a file) and the card →
      Approve/Reject gates it. No mobile change was needed; the app is generic.
    - ☑ **Decisions persist across scroll + app restart** — DONE 2026-06-18.
      `ApprovalResponseStore` (`infrastructure/storage/approval_response_store.dart`,
      SharedPreferences) persists the user's decision per `approvalId` as
      soon as the card is tapped, so the resolved view (`Decision recorded ·
      Answered 14:32`) survives scroll, app backgrounding, and full restart.
      `ApprovalResponses` (`approval_providers.dart`) hydrates the in-memory
      map from the store on `build()` and stamps each entry with the
      original `decidedAtMs`. Action buttons are gone forever for an
      answered card; the card renders a settled status row with a
      "Answered" timestamp (Neural Expressive: muted text, no fill) and
      a risk-tinted outline (success / warning / error / neutral) so the
      "already decided" state reads at a glance. New l10n strings
      `approvalDecidedTitle` and `approvalAnsweredAt` (en + es). The
      card UI reuses the existing `_ApprovalResolved` widget — the
      "before/after" is the persistence and the muted styling. Covered
      by `test/unit/infrastructure/storage/approval_response_store_test.dart`
      and two new widget tests
      (`a resolved approval card stays resolved after scroll/restart` +
      `... while the user scrolls past it`) that pre-seed SharedPreferences
      and assert the action buttons are absent after hydration.
    - ☑ **Bridge now routes Gemini + Codex approvals too** — 2026-06-18.
      `agents['gemini-cli'].interactiveApprovals: true` makes the bridge
      write `<cwd>/.gemini/settings.json` with a `BeforeTool` hook and
      set `--approval-mode default`; every tool the CLI wants to run
      round-trips to the phone through the same `requestApproval` flow
      Claude + Codex use. No mobile change. The Codex adapter was
      refactored to the long-lived `codex app-server` turn protocol
      (the prior one-shot `codex exec --json` couldn't gate tools); its
      elicitations (`item/commandExecution/requestApproval`,
      `item/fileChange/requestApproval`, `item/permissions/requestApproval`,
      `mcpServer/elicitation/request`, `item/tool/requestUserInput`, plus
      the legacy `applyPatchApproval` / `execCommandApproval`) all map
      to the same `approval` content block the phone already renders. **OpenCode
      / pi remain a known gap** (their headless modes don't expose a
      pre-tool protocol the bridge can intercept) — see
      `bridge/FOR-DEV.md`.
  - ☑ **Verify wire shapes (plan/subagent)** — DONE: confirmed `plan` and
    `subagent` content blocks are **informational** status updates, NOT approval
    gates — only `approval` blocks gate actions. Field names for plan steps /
    subagent actions remain assumed; the parser is tolerant.
  - ◑ **Plan / to-do lists rendered (plan mode) — bridge mapping added
    (2026-06-18).** The phone already decoded+rendered `plan` blocks
    (`PlanContent` → `_PlanCard`); the gap was the bridge emitting them. New
    `planBlock` + tolerant `extractPlanSteps` (`adapters/content-blocks.ts`) now
    map each agent's plan tool: **Claude** `TodoWrite` (verified by shape),
    **OpenCode** `todowrite`, **pi** `todo`, **Codex** `update_plan` item. Safe:
    a block is emitted only when ≥1 step parses (wrong/absent shape → no block).
    ☐ **On-device per agent (the maintainer's validation):** Claude (available),
    **OpenCode + pi** (minimax-m3 via tokenrouter, free — validate first), and
    **Codex** (single monthly use — validate last/sparingly). The Codex/OpenCode/
    pi tool **names + input shapes are ASSUMED** (`FOR-DEV:` markers at each
    mapper) — if a real turn shows a different name/shape, it's a one-line tweak.
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
- ◑ **Remote history pagination + resume/fork** — `ThreadManager.selectThread`
  re-syncs a thread from the bridge (`turn/list`) on open, persisting any
  assistant answer not stored locally (keyed by `stream-<turnId>`, so it never
  duplicates) — recovers in-flight turns after an app restart.
  - ☑ **Windowed history (DONE).** The timeline renders only the most-recent
    page (`_renderLimit`, 40); a **"Show earlier messages"** header
    (`conversationLoadEarlier`) grows the window by a page via
    `ThreadManager.loadMoreHistory()`. Bounds widget build for long threads.
  - ☑ **Resume / fork (DONE, bridge-supported).** `resumeThread` (`thread/resume`,
    called best-effort on open; skips archived so viewing doesn't un-archive)
    and `forkThread` (`thread/fork` → persists the returned thread with the
    source's `deviceId`, opens it). Fork is a **"Fork conversation"** item in the
    conversation overflow menu.
  - ☑ **Incremental remote paging — DONE both sides (2026-06-18).** The bridge
    `turn/list` now reports `total` and accepts `fromEnd` (shared
    `TurnList.total`, `TurnListParams.fromEnd`; `ThreadStore.listTurns` +
    `paginateTurns`). On open, `ThreadManager._resyncThread` pulls only the
    **newest** page (`fromEnd:true`, `_turnPageSize=20`) instead of the oldest
    page, and `loadMoreHistory` pages **backward** remotely — widening the local
    window first, then fetching the previous turn page by an explicit offset
    cursor derived from `total`, persisting older assistant answers **below** the
    current min `orderIndex`. `hasMore` reflects local-window OR remote-offset.
    Backward-compatible: an older bridge omits `total`, disabling remote paging
    (local windowing only). Covered by a store test (bridge) + a back-paging
    test (mobile). ☐ On-device: verify scroll-up paging on a long real thread.
- ☑ **Conversation UI (visual layer)** — DONE: `ConversationScreen`
  (`SliverAppBar.large`, floating + snap, auto-scroll), message renderers
  (`MessageBubble` + `MessageContentView`: markdown, code, command card, diff,
  system banner, streaming dots), the `ComposerBar`, `SessionStatusSheet` and
  `ApprovalModeSheet`. **Refined since (M3):** the composer is now a
  **bottom-anchored bar** (`surfaceContainer` + hairline, no floating card); the
  app-bar git affordance is a single commit `IconButton` (the redundant branch
  chip was dropped); and the header shows a **"Responding…"** spinner while the
  agent works (the per-thread activity, also on the list). A **jump-to-latest**
  button (`_JumpToBottomButton`) springs in over the timeline when the user
  scrolls up and jumps to the newest message in one tap (2026-06-18).
- ☑ **Conversation scroll position persists across opens** — DONE
  (2026-06-18). Opening a thread used to yank the timeline back to the top,
  forcing users who had scrolled up to read older context to re-scroll every
  time they left and re-entered. A session-scoped
  `ConversationScrollStore` (`lib/presentation/providers/conversation_scroll_store.dart`,
  in-memory `Map<threadId, { offset, atBottom }>`) records the pixel offset
  + an `atBottom` flag while the user scrolls, and `ConversationScreen`
  restores it once on first content (`_restoreScroll`, guarded by
  `_restoredScroll`, re-applied on the next frame to catch late layout —
  variable-height messages / images that grow `maxScrollExtent`). When the
  user was at (or near) the bottom on close, the restore follows the
  newest message instead of pinning a now-stale offset. In-memory only (per
  session): a saved pixel offset only maps cleanly onto the same rendered
  content, which a cross-restart resync can change. Pairs with the existing
  *Jump to latest* button — the button still gets you to the newest
  message manually; the restore makes the common case (returning to a
  thread) just work. Covered by
  `conversation_scroll_store_test.dart` (null until saved, round-trip,
  overwrite). ☐ On-device: verify a thread opened repeatedly lands at the
  same spot and that *Jump to latest* still works after the restore.
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
  - ☑ **Approval (access) mode — persisted server-side, DONE both sides
    (2026-06-18).** `ApprovalModeSheet` is gated by the agent's `approvals`
    capability; the chosen mode now **persists on the bridge** via the new
    `thread/setAccessMode { threadId, mode }` RPC (shared `AccessMode` +
    `Thread.accessMode`; `ThreadStore.setAccessMode`, idempotent). The phone
    seeds the picker from the bridge on open (`ThreadManager.readAccessMode` via
    `thread/read`, the source of truth) and persists on change
    (`ThreadManager.setAccessMode`, best-effort). ☑ **Enforcement — DONE
    (2026-06-18, Claude).** The bridge applies the persisted mode per turn: the
    `turn/send` handler reads it from the thread runtime (`ThreadRuntime.accessMode`
    → `SendTurnOptions.accessMode`) and the **Claude adapter** maps it —
    `requestApproval` keeps the interactive `PreToolUse` hook in play,
    `approveForMe` → `--permission-mode acceptEdits` (hook suppressed),
    `fullAccess` → `--dangerously-skip-permissions`. **Non-breaking by design:**
    when a thread has **no** mode set, the adapter's configured posture is used
    unchanged (the validated interactive-approval flow is untouched), and
    `requestApproval` without a usable hook falls back to the configured posture
    (never denies wholesale). Covered by four adapter tests + a runtime test.
    ☐ **Follow-up:** map `accessMode` for the other agents that gate tools
    (Codex `--ask-for-approval`/`--full-auto`, etc.); today they accept the
    field and ignore it (Claude is the agent with the validated approval flow).
  - ☑ **Git branch / remote / local** (`_EnvironmentChip`, status-sheet git
    section) → real values from `git/status` via `gitRepoStateProvider`; the
    commit/push rows call `GitActionManager.commit` / `.push` against the active
    thread's `cwd`.
  - ☑ **Attach** (`ComposerBar` "+" → turn-tools sheet) → DONE end-to-end
    (bridge wired 2026-06-16; on-device verification pending). Gated by the
    agent's `images` capability. The Attach tile offers **Photo library / Take a
    photo** (`AttachmentPickerService` + `image_picker`, downscaled to 2048 px /
    q85, inline base64 `ImageContent`); pending images show as a removable
    thumbnail strip above the composer (`_AttachmentStrip`) and the composer
    sends with an empty text field (image-only message allowed). `sendUserMessage`
    echoes them locally (rendered inline via `_ImageBlock`) and rides them on
    `turn/send`.
    - **CONTRACT — DONE bridge-side.** `shared` added `TurnAttachment` +
      `TurnSendParams.attachments?` and made `text` optional; the bridge
      `turn/send` handler reads `attachments`, allows an empty `text`, and
      `AgentManager.sendTurn` **materializes each image to a temp file and
      references it in the prompt** (`bridge/src/agents/attachments.ts`) so every
      file/vision-capable agent CLI can open it (no per-CLI image flag needed).
      The app already sends `attachments: [{type:'image', mimeType, base64Data}]`,
      so no further mobile change is required.
    - ☑ **On-device verification — DONE (2026-06-18):** picked a photo, sent an
      image-only message, and confirmed the agent reads/acts on the image
      against a live bridge.
    - ☐ **Native CLI image flags (bridge follow-up, optional):** some agents may
      accept images more richly via a dedicated flag/MCP than a file-path
      reference; the temp-file path is the CLI-agnostic MVP. Tracked in
      `bridge/FOR-DEV.md`.
    - ☐ **Camera permission caveat (Android):** `mobile_scanner` already declares
      `CAMERA`, so `image_picker`'s camera capture may need a runtime grant on
      some devices — the service fails safe (returns null) if denied. Verify
      on-device; wire `permission_handler` for camera if it doesn't prompt.
    - ☐ **iOS:** `NSPhotoLibraryUsageDescription` (+ camera) Info.plist strings —
      FOR-HUMAN §4.
    - ☐ **Arbitrary (non-image) file attach** — no bridge contract/model exists
      (only `ImageContent` + `workspace/readImage`); deferred until one does.
  - ☑ **Voice** (`ComposerBar` mic button) → DONE: on-device speech-to-text
    dictates into the composer (`speech_to_text`, guarded `SpeechToTextService`),
    live partial→final with a recording state; verified on-device. See
    *Recommended next steps → Voice → text*.
  - ☑ **Stop the turn** (`ComposerBar`) → DONE: while a turn streams, Send
    becomes a Stop button that cancels it (`turn/cancel` via
    `ThreadManager.cancelTurn`) without closing the thread.
  - ☑ Removed `SessionEnvironment.sample()`, `demo_seed.dart` and the home
    preview entry from the default UX.

## Personalization / appearance

- ☑ **Theme mode + language** — DONE: dedicated `PersonalizationScreen`
  (`Settings → Appearance`) with a System/Light/Dark `SegmentedButton`
  (`themeModeSettingProvider`, wired to `MaterialApp.themeMode`) and a language
  list built dynamically from `AppLocalizations.supportedLocales` + a
  "System default" option (`localeSettingProvider` → `MaterialApp.locale`; null
  follows the device). Persisted via `AppearancePreferencesStore`. A newly added
  locale shows up automatically. Covered by `personalization_screen_test.dart`.
- ☑ **Custom themes (full M3 ColorScheme editor + JSON import/export) — DONE
  (2026-06-19) & supersedes the previous 7-swatch accent picker.** The
  personalization screen now offers a 4-segment `SegmentedButton`:
  *System / Light / Dark / Custom*. While no custom theme is persisted the
  *Custom* segment is disabled; once the user authors one, picking *Custom*
  flips `themeSourceSettingProvider` to `ThemeSource.custom` and the whole
  `ColorScheme` for both light and dark is sourced from the user's
  `CustomTheme` (`buildUxnanTheme(themeSource: ThemeSource.custom, customTheme: …)`).
  The full editor (`CustomThemeEditorScreen`) exposes **every public Material 3
  color role** (46, grouped Primary/Secondary/Tertiary/Error/Surface/Outline)
  for both brightnesses, with an inline HSV picker (`ColorPickerSheet`) per
  role, *Reset brightness* / *Derive from seed* helpers per side, and
  *Export* (clipboard JSON + selectable pretty-print dialog) / *Import*
  (paste any previously-exported JSON). JSON shape is stable + versioned
  (`schemaVersion`); roles are `#AARRGGBB` hex strings (integer ARGB accepted
  for legacy exports); unknown / missing roles degrade to safe defaults so
  hand-edited or older documents still load. The previous 7-swatch picker
  (`AccentPalette` / `AccentColorId`, the `accentSettingProvider`, the
  `uxnan.appearance.accentId` storage key, and the `accentBlue..accentTeal`
  ARB keys) is removed — see `CHANGELOG.md → [Unreleased] → Changed` for the
  full diff. Persisted under `uxnan.appearance.customTheme` as a single JSON
  document. See `architecture/02c-implementation-guide.md` §3.1 for the spec.
  ☐ On-device visual review of the new editor (role list spacing, picker
  ergonomics, import copy) — same on-device loop as the rest of the UI.
- ☑ **Custom themes as a library (multi-selectable + JSON import/export of
  many themes)** — DONE (2026-06-19, supersedes the previous single-theme
  picker): the personalization screen's 4-segment picker becomes a
  3-segment `SegmentedButton<ThemeModeOption>` (System / Light / Dark) plus
  a master **"Use a custom theme"** switch + a collapsible library with
  **2 built-in example themes** ("Midnight" — leans dark, "Sandstone" —
  leans light) seeded on first run. Each row in the library exposes an
  `IconSurfaceMenu` with **Edit** (opens the existing
  `CustomThemeEditorScreen` against that theme), **Export JSON** (copies
  the theme to the clipboard) and **Delete** (built-ins are protected).
  Below the per-theme rows, three library-level actions:
  **Import theme** (accepts a single theme JSON OR an array of themes —
  the typical *Export all* payload — and assigns fresh ids when an
  imported id collides with an existing library entry), **Export all
  themes** (serializes the whole library to the clipboard as a JSON
  array), and **Reset library** (drops every authored theme and restores
  the built-in seed + flips the master switch off). State model:
  `customThemesLibraryProvider` (`List<CustomTheme>`, seeded with the
  built-ins on first hydrate), `activeCustomThemeIdProvider`
  (`String?`), `useCustomThemeProvider` (`bool`) — the existing
  `customThemeSettingProvider` is now a derived `Provider<CustomTheme?>`
  that resolves to the active theme when the switch is on and an id is
  selected, so `app.dart` and `themeSourceSettingProvider` keep their
  existing contract. Legacy `uxnan.appearance.customTheme` is migrated
  into the library on first hydrate (single-shot; key is removed after
  migration). New persistence keys: `uxnan.appearance.customThemes`
  (JSON array), `uxnan.appearance.activeCustomThemeId`, and
  `uxnan.appearance.useCustomTheme`. Spec: see
  `architecture/02c-implementation-guide.md` §3.1 (rewritten to reflect
  the library model).

## Git

- ☑ **Git logic layer** — DONE: `GitActionManager` (status/commit/push with
  per-phase push progress from `stream/git/progress`), `GitRepoState` +
  `GitDiffTotals` / `GitChangedFile`, `GitActionProgress` / `GitActionPhase`,
  commit/push params + results, `GitProgressEvent` (classified by
  `IncomingMessageProcessor`), and `DriftGitActionLogRepository` recording each
  action to the `git_action_log` table. Providers: `gitActionManagerProvider`,
  `gitRepoStateProvider`, `gitActiveActionProvider`,
  `gitActionLogRepositoryProvider`. Covered by unit tests.
- ☑ **Verify the `git/status` JSON shape against a real bridge** — DONE
  (maintainer-validated on device): the bridge sends `files` (with per-file
  `additions`/`deletions`) plus `diffTotals`, and `GitRepoState.fromJson` reads
  `files ?? changedFiles` and derives totals when absent (bridge side test-backed
  in `git-service.test.ts`). `git/commit`, `git/push` and `stream/git/progress`
  shapes confirmed against the live bridge.
- ☑ **Resolve the active `cwd`** — DONE: `ConversationScreen` reads the active
  thread's `cwd` (via `threadByIdProvider`) and drives
  `GitActionManager.refreshStatus(cwd)` + the full-screen `GitScreen`.
  `worktreePath` fallback can be added when worktree-backed threads land.
- ☑ **Extended git actions (mobile-wired set)** — DONE (maintainer-validated):
  `GitActionManager` wires `discard` (`git/discard`), `createPr` (`git/createPr`,
  smart PR with head/base branch selection + auto-push of the head + precondition
  validation), `undoCommit` (`git/undoCommit`, soft reset) and `switchBranch`
  (`git/switchBranch`, per-branch auto-stash so each branch stays independent),
  plus the `branches` (`git/branches`) read.
- ☑ **Extended git actions (branch & remote set)** — DONE: `GitActionManager`
  now also wires `pull` (`git/pull`), `checkout` (`git/checkout`), `createBranch`
  (`git/createBranch`) and `createWorktree` (`git/createWorktree`). Surfaced in
  `GitScreen` where each action belongs (no separate "branch & remote" sheet):
  - **Pull** is a badged app-bar action that only appears when `state.behind > 0`
    (the badge shows the incoming-commit count).
  - **Switch branch** / **New branch** live in the three-dots overflow menu; new
    branch does `createBranch` + `checkout`.
  - The commit composer **morphs to a push affordance** once the tree is clean
    and the branch is ahead: the commit button becomes Push (badged with the
    ahead count) and the extra-options toggle becomes Undo-last-commit. Push and
    undo-commit are therefore no longer overflow-menu items.
  - **Worktree creation moved to the new-conversation dialog** (`NewConversationScreen`):
    an optional "Run in a worktree" toggle creates the worktree from the chosen
    working dir and points the new thread's `cwd` at the resulting checkout — so
    it no longer duplicates work inside the per-thread git screen.
  - ☑ **`git/revert` — DONE both sides + on-device validated (2026-06-18).**
    Bridge `GitService.revert` + `git/revert`; phone `GitActionManager.revert` +
    a **"Revert last commit"** item in the git-screen overflow (reverts `HEAD`,
    preserving history — distinct from Undo commit's soft reset). Verified
    on-device against a live bridge.
  - ☑ **Safe branch/worktree deletion — DONE both sides** (phone landed
    2026-06-18 review pass; confirmed already wired). Bridge `git/deleteBranch`
    (refuses unmerged unless `force`) + `git/removeWorktree` (refuses dirty
    unless `force`); `GitActionManager.deleteBranch`/`removeWorktree`. **Phone
    UI:** the branch picker (`_BranchPicker` in `git_screen.dart`) has a delete
    affordance per branch (`_deleteBranch`) that, on the unmerged-error, offers
    an explicit **forced delete** behind an error-styled confirm; the git-screen
    overflow exposes **Remove worktree** (`_removeWorktree`, force-on-dirty) when
    the thread runs in a worktree. ☐ On-device: verify the force path against a
    live bridge.
  - ☑ **Vanished-cwd detection — DONE both sides** (phone confirmed wired,
    2026-06-18). Bridge `workspace/exists` (`{ exists, isGitRepo? }`);
    `ThreadManager.workspaceExists` (fail-open) is probed once per cwd by
    `ConversationScreen._checkCwd` on open, and the composer is gated
    `enabled: connectedHere && !_cwdMissing` with a `_CwdMissingBanner`
    ("folder no longer exists") above it. ☐ On-device: verify against a removed
    folder/worktree on a live bridge.
  - FOR-DEV: **managed worktrees** — the bridge's `git/createWorktree` requires an
    explicit `path` (no auto-path). The phone derives a sibling path from `cwd`
    (`_worktreePath` in `NewConversationScreen`) so the user only types a branch
    name; the optional "Let the bridge pick the location" switch forwards
    `GitWorktreeParams.managed` for when the bridge gains auto-path support — at
    which point the derived path can be dropped.
- ☑ **Git UI (visual layer)** — DONE (maintainer-validated): replaced the old
  `GitActionsSheet` + `CommitSheet` bottom sheets with a full-screen **`GitScreen`**
  (M3): collapsible per-file diff cards (collapsed by default, lazy-loaded
  `git/diff`), selection checkboxes (include-in-commit) + select-all, discard
  selected/all (confirmed), branch switcher (carry/leave changes), a borderless
  commit composer (title + description + Co-author, conversation-composer style,
  rises with the keyboard, inline commit + push-mode buttons), undo-commit, and a
  full-screen smart-PR dialog. Push/PR confirmations are user-toggleable in
  Settings (default on). `git_diff_view.dart` renders the per-file unified diff.
- ◑ **Git commit history screen** — **DONE (2026-06-21, four PRs).** The
  `git/log` RPC is wired end-to-end (shared contract + bridge handler +
  mobile manager) and the mobile UI (`GitHistoryScreen` in
  `lib/presentation/screens/conversation/git/git_history_screen.dart`)
  is in place: two views with the same data — a chronological **list**
  and a GitKraken-style **graph** (lanes assigned by parent continuation,
  Bézier curves connecting commits) — built on the Neural Expressive
  design system (`ExpressiveCard` for the rows, `PolygonLoader` for the
  spinner, `ConnectedButtonGroup` for the list↔graph toggle). Cursor
  pagination with a *Load older commits* footer, pull-to-refresh, empty
  + error states. Tapping a row opens a bottom sheet with the full
  message, author, committer, parents, stats, and **Copy SHA** /
  **Copy message** actions. The `Icons.history_rounded` button lives
  in `GitScreen`'s app bar (visible only when a repo is open) and
  pushes the new screen. Spec: `architecture/02a` §5.8.6 documents
  `git/log` + the UI; `architecture/02b` lists it in the git-section
  table.
- ☑ **Wire the git UI to a live session** — DONE: `GitScreen` reads
  `gitRepoStateProvider` and runs real commit/push/discard/PR/switch against the
  active thread's `cwd`. `GitRepoState.sample()` is retained only as a widget-test
  fixture (`git_screen_test.dart`).
- ☑ **Per-file diff viewer** — DONE (maintainer-validated) via
  `conversation/git/git_diff_view.dart` (`GitDiffView`) →
  `GitActionManager.fileDiff` → the `git/diff` RPC (with a `path`, incl.
  untracked-file synthesis on the bridge). The changed-files list also shows
  per-file +/- counts from `git/status`.

- ☑ **Workspace file browser (`workspace/list` + `workspace/readFile` +**
  **`workspace/readImage` + `git/diff`)** — DONE: a new
  `FileBrowserScreen` reachable from a `folder_open` `IconSurface` in the
  conversation top bar (next to the git action). Lists every file and folder
  in the active thread's `cwd` (incl. hidden dotfiles, with a toggle),
  colored by git status (`added`/`modified`/`deleted`/`renamed`/`untracked`
  each get a distinct color; tracked files stay neutral — matching the rest of
  the app's git chrome). Lazy tree: directories fetch their children on
  first expand via `workspace/list { cwd: <dir> }`. A new **`FileViewerScreen`**
  pushed from a file tile decides the rendering by extension:
  - **Images** → `workspace/readImage` → `Image.memory` inside an
    `InteractiveViewer` (pinch-zoom / pan).
  - **Markdown** (`.md`/`.markdown`) → a **preview** (`flutter_markdown` with
    M3 chrome — code blocks, blockquotes, …) **or the raw source** (toggle in
    the top bar; preserves indent / escape sequences).
  - **Code / text** → `flutter_highlight` with the `atom-one-{dark,light}`
    themes (matches the message-content renderer); per-extension language
    detection (Dart/TypeScript/JavaScript/Python/Swift/Kotlin/Java/Go/Rust/
    C/C++/CSS/SCSS/HTML/JSON/YAML/TOML/XML/Bash/SQL/Markdown).
  - **Git diff overlay** — for files that report a `git status`, the viewer
    fetches `git/diff { path }` and renders the unified diff with the same
    +/- coloring as `GitDiffView`; a top-bar toggle switches back to the raw
    content. The footer status pill paints the file's git state.
  - **Binary placeholder** for base64 payloads.
  - **Copy file** action (clipboard).
  New `FileBrowserManager` (`application/managers/`) + per-cwd stream
  provider; entity layer in `domain/entities/file_browser.dart`. Lazy walk is
  pure RPC — no native file APIs; the bridge's `path-guard` keeps reads
  confined to the workspace root (spec 02a §5.8.9). i18n strings added in EN
  + ES. Covered by `file_browser_manager_test.dart` (loadRoot + git-status
  paint, lazy expand, readFile/readImage/fileDiff, soft-fail on non-git
  cwds). Sits next to `GitScreen` in the conversation top bar — together
  they cover both the "what changed" and the "show me the file" questions.
  - ☑ **Live git-status colours across the app (DONE 2026-06-18).** The
    file browser's per-cwd `git/status` cache used to only refresh on
    `loadRoot` / `toggleDirectory` / `writeFile`, so a commit made
    elsewhere (the git screen, a CLI `git commit` on the PC) left the
    browser painting stale colours. The manager now subscribes to the
    shared `GitStatusBus` (`gitStatusBusProvider`,
    `application/services/git_status_bus.dart`); every successful
    `git/status` fetch from any producer (`GitActionManager` after every
    action, `FileBrowserManager` on its own refresh) publishes a
    `GitStatusChange { cwd, state }` and every manager holding that cwd
    repaints from the payload. No new RPC, no per-screen lifecycle
    gymnastics — the bus is generic so any future consumer can subscribe.
    Documented in `architecture/02c-implementation-guide.md` (§3.x —
    managers) and `architecture/03-technical-reference.md` (provider
    tree). **CHANGELOG.md → [Unreleased] → Fixed.**

## Push notifications

- ☑ **FCM token registration + local notifications** — DONE (gated):
  `PushNotificationService` (guarded firebase_core/messaging + local
  notifications) and `PushRegistrar` (registers the token via
  `notifications/register` on connect, raises local notifications on
  turn-completed/error). Builds/runs with no Firebase config. Native config is
  FOR-HUMAN (`FOR-HUMAN.md` §2). **No mobile change for the bridge-first push
  direction** — the phone registers an FCM token via `notifications/register`
  and whichever side holds the Firebase service account (bridge directly, or a
  self-hosted relay) delivers; works on direct LAN / Tailscale / relay alike.
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

## Alpha release readiness & CI/CD (prep)

> Status snapshot taken 2026-06-16. The mobile app is **functional for an alpha
> release on Android**: every core flow is wired and **maintainer-validated
> on-device** (pairing/E2EE, devices list, threads, new conversation, live
> streaming conversation, git screen, model picker, context meter, run-option
> knobs, auth-status surfaces, push on Android, personalization, voice). Quality
> gates are green: `flutter analyze lib test` → no issues, `flutter test` →
> 265 passing, `dart format` clean. **iOS is NOT alpha-ready** — it has never
> been built (the Podfile is generated on the first macOS build) and is blocked
> on FOR-HUMAN assets (APNs key, Info.plist usage strings, signing). So: ship
> Android alpha now; iOS follows once the human assets + a first macOS build
> land.

### What still blocks a *complete* MVP (not an Android alpha)

Nothing below blocks an Android alpha build; these are the remaining feature/
polish gaps, ordered by importance:

- **App-side, buildable now (no bridge needed):**
  - ☑ **Attach (image picker)** — DONE & **on-device validated (2026-06-18)**:
    photo-library / camera capture → inline base64 `ImageContent`, image-only
    messages ride `turn/send { attachments }`; the agent reads the image. Arbitrary
    (non-image) file attach stays deferred (no bridge contract). See *Attach* above.
  - ☑ **Persist sort/density** — DONE (2026-06-18). ◑ **Project-level thread
    scoping** — implemented (chips + filter + bridge), **disabled in the UI**
    (2026-06-18); flip `_projectFilterEnabled` from a future advanced-filters
    view to enable.
  - ☐ **Work-log auto-expand while streaming; tap Last-edits strip to jump.** Low.
- **App-side seam, needs a live bridge to finish/verify:**
  - ☑ **Remote history pagination** — DONE both sides (2026-06-18): newest-page
    open (`fromEnd`) + remote back-paging via `total`. ☐ On-device: verify
    scroll-up paging on a long real thread.
  - ☐ **Automated integration test against a real bridge** (today: simulated
    in-memory bridge). Medium importance for regression safety.
- **Bridge-blocked (documented contracts above; not the app's fault):** none
  outstanding for the items tracked here. (Interactive approval intake,
  `git/revert`, safe branch/worktree deletion, vanished-cwd detection, remote
  history pagination, **agent session-id surfacing** and the **access-mode
  persistence RPC** are now **DONE both sides** — see the sections above. The
  remaining access-mode *enforcement* per turn is an app+bridge follow-up, not a
  missing contract.)
- **FOR-HUMAN assets (gate iOS + live push):** iOS APNs key (paid Apple
  account), iOS Info.plist permission strings (camera, local network, mic),
  Firebase config (`google-services.json` / `GoogleService-Info.plist`), Android
  signing keystore, iOS signing cert/provisioning. See `FOR-HUMAN.md`.

### CI/CD prep — GitHub Actions (to author when we green-light it)

Target platforms are **Android + iOS only** (`pubspec.yaml`: `android/`,
`ios/`). Proposed pipeline — NOT YET CREATED; author `.github/workflows/` when
the maintainer approves:

1. **`verify` job (ubuntu-latest) — runs on every push/PR; the build gate:**
   - `flutter pub get`
   - `flutter gen-l10n` then fail if `lib/l10n` drifted (generated l10n is
     committed — `git diff --exit-code lib/l10n`).
   - `dart format --output=none --set-exit-if-changed lib test`
   - `flutter analyze lib test` (must report no issues)
   - `flutter test` (must be all-green; consider `--coverage`)
   - Pin the Flutter version (`subosito/flutter-action`) to the toolchain we
     develop on; cache pub + Gradle.
2. **`build-android` job (ubuntu-latest) — needs: `verify`:**
   - `flutter build apk --release` and `flutter build appbundle --release`.
   - Signing keystore + `key.properties` from repo **secrets** (base64-decoded at
     runtime); until those exist, build unsigned/debug artifacts.
   - Upload the APK/AAB as workflow artifacts (do NOT auto-publish to Play in
     alpha — produce downloadable builds only).
3. **`build-ios` job (macos-latest) — needs: `verify`; can start unsigned:**
   - `flutter build ios --release --no-codesign` (works without signing assets,
     so iOS at least *compiles* in CI before the human assets land). Real `.ipa`
     export waits on the signing cert/provisioning + APNs (FOR-HUMAN).
4. **Triggers:** PR + push to the dev branch for `verify`; tag push
   (`v*`) or manual `workflow_dispatch` for the build jobs. Gate every build job
   on `verify` so a failing test/analyze/format **blocks the build**.
5. **Secrets/assets the workflow will need (FOR-HUMAN):** `ANDROID_KEYSTORE_B64`
   + `ANDROID_KEY_PROPERTIES`, Firebase config files, iOS signing
   cert/provisioning profile + APNs key. List them in `FOR-HUMAN.md` when we
   wire the workflow.

**Status (2026-06-21):** the **verify** workflow is DONE
(`.github/workflows/ci-mobile.yml`: gen-l10n + l10n drift check, dart format,
analyze, test — validated locally, 375 tests green). Release signing is wired in
`android/app/build.gradle.kts` (reads `key.properties`, debug fallback). The
signed **release** job (AAB → Google Play **internal** track via
`r0adkll/upload-google-play`) is the remaining piece (`release-mobile.yml`).
Secrets already loaded: `ANDROID_KEYSTORE_B64`, keystore password/alias/key
password, `GOOGLE_SERVICES_JSON`, `PLAY_SERVICE_ACCOUNT_JSON_BASE64`. Mobile is
distributed via **Google Play**, not GitHub Releases.

### Deferred — in-app version checker
- [ ] Notify the user when a newer app version is available and let them decide
  to update (no silent install). Paths: (a) while distributed as an APK → poll
  the GitHub Releases API + show a banner with the download link; (b) on Google
  Play → the In-App Updates API (flexible/immediate). iOS waits for the App
  Store path when Apple resumes.
