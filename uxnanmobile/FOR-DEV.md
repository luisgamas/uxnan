# FOR-DEV — pending developer work

Deferred implementation work (code the team/agent will do later). Distinct from
`FOR-HUMAN.md` (assets only a human can provide). Search the codebase for
`FOR-DEV:` to jump to the exact deferral sites.

> Convention defined in the root `AGENTS.md` → "Pending developer work".
> [`README.md`](README.md) carries the user-facing snapshot; **`## Status` below
> is this component's canonical implementation status** (the root `AGENTS.md`
> points here instead of keeping its own inventory), and the rest of this file
> tracks what's left.

## Status

**MVP wired — Android alpha-ready.** All core modules are implemented and
connected to live bridge data, validated on-device against a real bridge.

**Built (DONE):**

- **Updating the PC's bridge** (architecture/02a §5.8.18). `BridgeReplica`
  mirrors the bridge's own update (`stream/bridge/updated`, the answer to
  `bridge/update`); the notice atop the conversations and Settings → Updates →
  *Bridge on your PC* show it and offer **Update** when the bridge can update
  itself, the update under way, a failure with the command to run on the PC,
  and a bridge older than this app. Covered by `bridge_replica_test`,
  `bridge_status_test`, `bridge_update_test` and `bridge_update_notice_test`.
  **Not yet device-verified** against a live bridge updating itself.
- **One layer: a replica of the PC's bridge** (architecture/02a §5.8.17).
  `BridgeReplica` is the only writer of what the bridge owns: per-PC cursor
  (`replica_cursors`), `sync/changes` on connect / resume / a skipped `rev`,
  snapshot or incremental apply, and every notification checked against the
  applied revision (`stream/thread/*`, `stream/project/*`,
  `stream/settings/updated`, `stream/presence/updated`,
  `stream/agents/updated`). Threads reach the store only through
  `ThreadManager.applyReplicaThreads`; messages sort by `Turn.seq`; titles are
  the bridge's. The list shows the PC's project registry (empty projects
  included, remove from the long-press sheet); "New conversation" opens on
  the project it was started from (or the PC's start folder) and folds the
  other projects and `project/add` under it; the PC screen shows and changes the
  shared start folder; a "Linked with Uxnan Desktop on <machine>" line and a
  desktop-origin mark tell the two setups apart. Another client's prompt is
  placed above its answer (`stream/turn/created` + `clientTurnId`), and a card
  answered elsewhere settles here (`stream/approval|question/resolved`).
  A rename, archive, unarchive or delete — or a PC rename — made while the PC
  is out of reach waits in `ActionOutbox` and is sent, dated (`ageMs`), before
  the next sync; the latest action wins, whichever device took it. The phone
  describes itself on connecting (`device/describe`) and keeps one name on
  every PC (`PhoneNameManager`, "This phone" card in My devices).
  Covered by `bridge_replica_test`, `bridge_replica_names_test`,
  `thread_manager_test`, `action_outbox_test`, `thread_manager_outbox_test`,
  `phone_name_manager_test`,
  `incoming_message_processor_test`, `workspace_grouping_test`,
  `threads_list_test` and `new_conversation_card_test`, and by the bridge's
  own end-to-end tests. **Not yet device-verified against a running desktop** —
  see *Pending* below.

- **Large screens: one route table, two layouts.** Past 840 dp the app stops
  being a stack of screens — a **permanent navigation drawer** (the PC, its
  work, and you) with the routed screen as the content pane beside it. The
  route table does not change: a single `ShellRoute` wraps the flat routes and
  `AppShell` decides *where* each screen draws, so every deep link and push
  notification keeps working at both widths. What changes is the meaning of a
  tap (`pane_navigation.dart`: opening **replaces** the pane instead of
  stacking). **Two panes is the ceiling** — Settings splits internally into its
  own two, and nested splits measure their own constraints rather than the
  window. Files and git deliberately stay a stack inside the pane: a third
  column helps nobody on a tablet. The new-conversation form is a full-screen
  dialog on a phone and a bounded 560×720 one on a wide window.

  `UxnanBreakpoint` implements the guide's five window classes and is the single
  place a width becomes a layout decision; `NeScaffold` clamps every screen to
  its class's content width, and `TwoPaneScaffold` serves both the shell and the
  nested splits.

- **Spaces: projects ▸ worktrees ▸ conversations, with per-folder git.** The
  conversation list is grouped by the folder work runs in, and a **repository**
  level appears over folders that `git/worktrees` relates to each other (never
  guessed from path prefixes — a worktree can live anywhere, and grouped ones
  share a prefix across repositories). Each level has
  its own ordering (status / activity / created / name) through a nested menu
  whose submenus open beside their row (`NeSubmenuRow`). Folder rows carry git indicators (uncommitted, ahead, behind)
  from `git/status` per cwd, throttled and only while visible; the breakdown
  lives in the long-press sheet.

- **Overview + precise agent state.** The home screen is an **overview** (brand
  + avatar in the bar, a two-row greeting over live badges, PC cards built from
  `NeBadge`), and the profile screen no longer duplicates its identity card. The
  thread row shows the desktop's five agent states — **derived** from turn
  events, queue state, sign-in and the pending approval/question blocks, never
  reported by the bridge (see `architecture/02a` §5.4.2). Icons throughout are
  Hugeicons via the `UxIcons` catalogue and the `UxIcon` primitive, matching the
  desktop app and the website.

- **E2EE crypto + secure transport** (X25519 + Ed25519 + HKDF + AES-256-GCM,
  handshake, seq/replay, outbound buffer, reconnect loop).
- **Pairing & onboarding** — `OnboardingScreen`, `QrScannerScreen`,
  `MyDevicesScreen`, **`ManualCodeScreen`** (bridge-first manual-code pairing,
  `GET /pair/resolve?code=`, host typed or picked from mDNS discovery; the
  code is sent to **only** the host the user chose — never fanned out to
  discovered candidates, since it is a shared secret and mDNS records are
  spoofable). The connected PC wears a **route badge** — LAN / Tailscale /
  Relay (`ConnectionRoute`, the `shared/` contract's three, with
  `isTailscaleAddress` mirrored and tested on the shared vectors) — on the
  home card, the drawer and the PC's details, classified once by the session
  from the endpoint the channel settled on (never from `bridge/status
  .relayConnected`, which is the bridge's own relay link).
- **Direct LAN/Tailscale transport** — `DirectTransportSelector` tries each direct
  `hosts` entry from the QR first, falls back to the PC's own relay.
- **The PC's own relay** (architecture/02a §5.10). Pairing QR v3 carries the
  relay as `{url, routingId, ticket?}`; a v2 QR reads as an unsupported version.
  `RelayClient` speaks the relay's phone route (`/v1/connect/<routingId>`:
  challenge → `phone-auth` signed with the phone's identity key → `ready`) and
  hands the socket to the unchanged E2EE layer; the relay's close codes come
  back as a typed `RelayException` (`RelayFailure`: PC offline, phone not
  paired / revoked, relay full, …). The QR's one-time ticket goes with the
  first dial only and is never stored. Each PC record keeps its
  `RelayEndpoint` (drift v12), written only by `BridgeReplica` from the
  bridge's shared settings (`sync/changes`, `stream/settings/updated`) and
  re-read before every dial — a PC paired on the LAN is reachable away from
  home without pairing again. `RelayManager` mirrors `relay/status` /
  `stream/relay/updated` and wraps the `relay/*` actions. **Remote access**
  on a PC's details (`remote_access_section.dart`) shows the three ways to
  reach the PC and the PC's relay — address, state and the bridge's
  `lastError`, phones through it, on/off switch, update (when the deployed
  version is not the bundled one), new address, remove (optionally deleting
  the Worker) — asking for the Cloudflare token only when the PC remembers
  none; `RelaySetupScreen` deploys it (`relay/setup`, with a 120 s wait
  instead of the default 30 s). The token goes to the bridge in the E2EE
  channel and is cleared from the phone when the call returns. The switch,
  turned while the PC is out of reach, is kept in the `ActionOutbox`
  (`PendingActionKind.setRelay`) and sent dated (`relay/set { ageMs }`). The
  reconnect loop carries the typed `RelayFailure`
  (`ConnectionRecoveryState.lastRelayFailure`), and every Connect snackbar
  and the threads' offline banner say it in words (`connect_failure_text.dart`),
  including "no route from this network" (no direct host answered and the PC
  has no relay on: `TransportErrorKind.noRoute`). **Back home is back to
  direct:** on a network change (`NetworkChangeMonitor`, `connectivity_plus`)
  or a resume, a session on the relay dials the PC's direct hosts once and
  moves there when one answers, keeping the relay session live until the
  direct handshake completes (`SessionCoordinator._tryDirectRoute`).
  **The PC is followed across networks:** `BridgeReplica` replaces the PC
  record's direct addresses with the bridge's live `BridgeSettings.hosts`
  (absent field = an older bridge, kept; empty = LAN off, stored) and tells
  the session, which tries them from the relay (debounced, single-flight with
  one follow-up). On a Wi-Fi/Ethernet network `DirectTransportSelector` also
  looks for the PC by mDNS (`MdnsLanBridgeFinder` over
  `BridgeDiscoveryService`, TXT `id` = `macDeviceId`, ≤ 2.5 s, only during a
  dial) and races what it reveals with the stored addresses. A direct
  address only wins once the E2EE handshake over it succeeds (run inside the
  selection, one candidate at a time, stored before announced); one that
  fails is skipped and the same attempt goes on to the next and then the
  relay, so a LAN spoofer cannot keep the phone off its relay
  (`RelayReason.directHandshakeFailed`, not shown). When the browse saw the
  PC but nothing answered, PC details says why it is on the relay
  (`RelayReason.sameNetworkUnreachable`). A PC
  reached on the LAN/Tailscale with no relay (or one switched off) shows a
  dismissible *set up / turn on remote access* card on its home card
  (`RemoteAccessHintCard`, dismissal remembered per PC). Covered by
  `session_coordinator_test` (*route and the way back home*),
  `transport_selector_test` (*looking for the PC on the local network*),
  `lan_bridge_finder_test`, `bridge_replica_names_test` (*where the PC
  listens*), `network_change_monitor_test`, `connection_route_test`,
  `transport_badge_test`, `my_devices_screen_test`, `pc_details_screen_test`,
  `threads_list_test` and `connect_failure_text_test`. **Not yet
  device-verified:** the relay → LAN move on a real phone walking into the
  PC's Wi-Fi, and the hint's *Turn on* against a live bridge (see the relay
  UI item under *App+bridge seams*).
  Covered by `relay_client_test`, `transport_selector_test`,
  `session_coordinator_test`, `bridge_replica_names_test`, `relay_manager_test`,
  `remote_access_section_test`, `relay_setup_screen_test`, the pairing tests,
  the v11 → v12 migration test, and `test/integration/relay_local_test.dart`
  against the real relay on the Workers runtime (opt-in, see
  [`docs/testing.md`](docs/testing.md)). **Not yet device-verified** against a
  relay deployed to Cloudflare.
- **Multi-PC connection-targeting** — all live actions target the PC we actually
  hold a channel to; browsing is read-only. The devices card shows the **real connected
  endpoint** (the direct host that won the dial race, or the relay — carried on
  `connectedEndpointStream`), not the first advertised host, and **blurs it by
  default with tap-to-reveal** so the network topology isn't exposed at a glance.
- **Profile & metrics (bridge-owned, survivable).** A **Profile** screen (Devices
  app-bar avatar + a Settings header) aggregating activity across every paired PC
  — a GitHub-style contribution heatmap (Combined / Conversations / Messages /
  Work, per year, tap-a-day / tap-outside-to-clear), activity highlights
  (conversations and messages leading; time connected, longest session,
  sessions, agents, models, Git actions below) and the agents ranked — plus
  **what the agents spent** (`usage/summary`, per PC cached in
  `UsageSummaryCacheStore`, stacked daily chart with agent focus, top models,
  7/30/90 days, cost or tokens), a **Your PCs** list and a **per-PC
  details** screen with the same sections plus that PC's **plan limits**
  (live while it is the connected PC, with pace and Codex reset redeem — a
  plan's limits belong to one PC's accounts, so the profile that adds every
  PC up does not show them). The one name is this phone's (`shownPhoneNameProvider`); the
  picture stays a profile avatar.
  The metrics now come from the bridge's complete global ledger (`metrics/get`),
  so they survive app uninstall, device restore and conversation deletion. The
  root app shell keeps the controller alive and re-fetches on every connection,
  before Profile is opened. Android backup excludes secure-storage files and iOS
  uses a non-migrating Keychain class, preventing a trusted phone identity from
  being cloned onto another device. The phone keeps a per-PC snapshot display
  cache (`MetricsCacheStore`) and falls back to local drift aggregation only when
  the cache is empty. A profile **"Backup"** section adds **Export / Import** of a
  complete bridge-sealed, tamper-proof ledger (`metrics/export` /
  `metrics/import`), with EN/ES strings; a
  rejected export surfaces the **bridge's own reason** verbatim. The stats carry
  a **manual refresh** button (always available) and a persisted **refresh mode**
  — automatic (on every profile open, the default), a 5/15/30/60-min poll, or
  manual-only — in Settings ▸ *Metrics & provider usage*, which also names and
  explains the provider-usage group (each provider's remaining limits).
- **Live streaming conversations** that survive leaving/re-entering the screen
  (per-thread in-memory buffers + `turn/list` re-sync) with a per-thread
  **"Responding…"** activity indicator. Timeline auto-follow yields to manual
  scrolling, stays detached while older content is being read, and resumes at
  the bottom or through an explicit jump/send action. **Full mid-turn recovery**:
  closing/killing the app during a turn and reopening restores everything the
  agent produced while away — the resync **re-seeds the live buffer
  unconditionally** from the bridge's accumulated record (which persists before
  notifying, so replacing never loses data), a resync also fires on **every
  (re)established connection** (the bridge's catch-up replay window is bounded),
  the finalized bubble always carries the **authoritative final text**, and every
  completed turn **reconciles via `turn/read`** so the stored message converges
  to the bridge's exact text↔work-log interleave. `beforeText`-flagged blocks
  (parallel/subagent activity) slot before the open text run, never splitting a
  sentence mid-word. The connected active idle conversation also polls its
  newest `turn/list` page every three seconds, so completed turns written from a
  supported native agent client appear without reopening the screen. Both the
  external user prompt and assistant reply persist; Mobile-authored prompts are
  matched by turn id instead of duplicated. This is completed-turn convergence,
  not cross-client token streaming; Antigravity has no readable history source.
- **Message queue** — a follow-up sent while the agent is working joins the
  thread's queue (owned by the bridge, so it drains with the app closed) instead
  of being blocked. A floating **"Queue message"** action appears above the
  composer only when a draft is waiting on a busy thread; it shares one slot with
  jump-to-latest and the turn-context shelf, so exactly one of the three shows at
  a time, and the composer's own Send/Stop button and Enter-inserts-a-newline
  behaviour are unchanged. A waiting message is **pinned to the bottom** of the
  timeline (below the streaming reply) as an ordinary user bubble wearing a
  **dashed outline** (`NeDashedBorder`), with **send now** + **edit** +
  **cancel** in its corner on every queued message the bridge is not handing
  over — the first one included; the text is padded for the three buttons —
  and a line under it saying where it sits in
  line: it keeps the user's own tone and its whole message, and only that edge
  says "not sent yet". On delivery the dashes dissolve in place, so the bubble
  never changes colour — it just stops being provisional. Every message sent
  while a turn runs waits in the queue; on agents whose CLI has an input
  channel mid-turn (Claude Code, OpenCode, Codex, pi) the first one is handed
  to the agent **when the step it is in ends**, without waiting for the turn to
  end — until then it stays editable and cancellable. During the hand-off the
  bridge marks it `deliveringTurnId` (`stream/queue/updated`, `queue/*`;
  `queueDeliveringTurnId` on `turn/list`): the bubble keeps its dashes and
  place, drops its actions and reads **"Reaching the agent"**, and the
  composer's hint above the pill says the
  message *reaches it at its next pause* (on other agents, *goes out when it
  finishes*). When the agent takes it, the bridge ends the running turn there
  with `turn/completed { continuedIn }` and starts this one (`turn/started`),
  and `turn/list` keeps `Turn.continuedIn` on the earlier turn. The phone stores it on that turn's messages (`messages_table.continued_in`,
  schema v10): the interrupted reply stays whole and ends with **"Continues
  below, with your next message"**, and the message the agent took says **"Reached the agent while it
  was working"**. On every other agent it settles when the queue drains,
  exactly as before.
  **Edit** withdraws it to the composer — text, images and files (an
  attachment held only by reference is fetched first; if it cannot be, the
  message stays queued) — leaving no trace; **cancel** leaves the bubble
  marked; **send now** runs it next on every agent — while a turn runs the
  bridge stops that turn first, and the action's label says so (*Stop the agent
  and send this now*). A refused edit, cancel or send now says so in a snackbar. Editing over a busy composer saves that text as a draft, behind
  a **Drafts** pill beside the queue button that opens the shared
  `ComposerPaletteCard` (two lines each, restore/delete/clear-all) and restores
  **only into an empty composer**. A banner
  offers *Send them* / *Discard* when the bridge holds the queue after a stop or
  a failure. Gated on `bridge/status` → `features.messageQueue`, so an older
  bridge keeps the pre-queue behaviour. Resync re-reads
  `queuedTurnIds`/`queuePaused`/`queueDeliveringTurnId` and settles every waiting bubble against the
  bridge's view, so a message whose fate we missed never stays waiting.
- **Message scroll rail** — a reusable, dependency-free right-edge minimap
  (`message_scroll_rail.dart`, one faint tick per user message) that is hidden
  while the timeline sits at the bottom and slides in from the right edge when
  the user scrolls up (the same signal that reveals *Jump to latest* and hides
  the composer ribbon). A slight drag reveals a dock-style fisheye + a message
  preview and, on release, glides (ease-in/out with a final settle) to that
  user bubble. Fed by a memoized `railAnchorsProvider`; honors reduced-motion.
  The centered floating **Jump to latest** (down) and git-history **Back to top**
  (up) shortcuts pair with it.
- **Structured agent turns** — assistant replies without a bubble, consecutive
  text merged, borderless tonal **Work log (N)** / **Thinking** process
  disclosures (collapsed by default and exclusively expanded per turn; an
  open work log lists each step on one line, a command's output opening on
  its own row),
  durable native response boundaries that keep every progress/final message,
  a settled answer's earlier replies folded behind one quiet line that says
  how long the turn worked (**Worked for 5m 52s**, from `Turn.completedAt −
  createdAt`, stored as `messages_table.turn_duration_ms`, schema v11) or,
  without a duration, **N previous messages** — opened, they lay out through
  the same segment builder as the answer (prose + collapsed work-log groups),
  context compaction as a quiet divider line (**Context compacted**) whose tap
  unfolds the reason and token counts,
  collapsible **Changed files (N) · +a −d** with per-file diffs, **Copy
  response**, **Last edits** strip above the composer; **Thinking** remains
  settings-gated. Long user text defaults to a ten-line expandable preview and
  still copies in full.
- **New conversation flow** — one folder card: the project the dialog was
  opened from (a project's "+"), else the PC's start folder (`bridgeHomeProvider`);
  its round button unfolds the PC's project registry, the start folder and
  **add a project** (the folder browser, `workspace/browseDirs` → `project/add`) +
  `agent/list` + `agent/models`. The thread starts in the chosen folder; the
  bridge decides its project. The
  full-screen Neural Expressive dialog compares agents in one dynamic-corner
  card group; selecting an agent expands only its capability chips and
  collapses the previous selection. Starting one in a fresh worktree sends
  **no path**: the bridge places the checkout under the folder it manages, the
  same one the desktop uses, gated on `features.managedWorktrees`. Against an
  older bridge (which requires a path) the phone derives one, now spelled the
  way the desktop spells it — the two used to disagree, so one project's
  worktrees ended up in two folder schemes.
- **Workspace file browser + viewer** — lazy git-aware tree, repo-wide fuzzy
  search with relative-path results, ancestor reveal and hidden pre-positioning
  of the selected row; editable highlighted text, selectable diffs,
  GitHub-flavored Markdown with guarded relative resources, README HTML
  (including tables, `<kbd>`, `<sub>`/`<sup>`), **alert callouts**, **`<details>`
  disclosures**, task lists, `:emoji:`, and syntax-highlighted, horizontally
  scrollable fences; remote README shields typed by their response rather than
  their URL and drawn by `jovial_svg` so their labels are legible; animated GIF,
  raster/SVG zoom, SVG Preview / Source / Changes parity, and native Android/iOS
  PDF preview. A file an agent cites in a response is tappable (Markdown link,
  bare path or inline code) and opens in that same viewer — resolved on the PC
  via `workspace/resolveFileLink`, so a citation into another worktree works.
  See `docs/file-viewer.md` for the exact matrix and boundaries.
- **Structured model picker** (readable names, default badge, resolved-version
  row, `thread/setModel`); models the CLI calls older (`isLegacy` — today only
  Claude Code's) fold under one *Older models* row.
- **Per-model run-option knobs** (data-driven: `enum` / `toggle`, generic
  renderer).
- **Agent slash commands in the `/` palette** — the agent's own commands
  (`agent/commands`, `AgentCommand` + `agentCommandsProvider`) are listed above
  the client-side entries; picking one inserts `/<name> ` and a matching
  `/name args` send is routed as a real command (`turn/send` `command`), any
  other text sent verbatim. Generic renderer (unknown/`headlessSupported:false`
  hidden), so new agent commands appear with no app change.
- **Context-usage indicator** (percentage when the model window is known, raw
  token count otherwise; **0 baseline** for agents with `reportsContextUsage`).
- **Context-compaction milestones** — durable `CompactionContent` blocks render
  at their real segment position with localized cause/token metadata. Codex,
  Claude, OpenCode and pi report them; Zero/Grok ACP and Antigravity do not
  expose a trustworthy signal, so mobile never guesses.
- **Active-agent contract only** — the shared contract no longer exposes
  retired standalone CLIs, so mobile needs no product-specific legacy filters.
- **Per-agent sign-in status** (`auth/status`) — banner above the composer, red
  dot in the threads list, "Check sign-in" in the new-conversation card,
  auto-refresh on app resume.
- **Interactive approval** (Approve / Reject / "always allow this session") with a
  spring `AnimatedSize` morph; validated end-to-end against Echo, Claude Code
  (`PreToolUse` hook), Codex (`app-server`) and
  OpenCode (`opencode serve` `permission.asked`). Only pi has no pre-tool channel
  (it runs autonomously).
- **Interactive question** (the agent's multiple-choice `question` tool) —
  single/multi-select option card that morphs to a resolved summary, persisted
  per `questionId`; answered via `turn/send { questionResponse }`. Validated
  end-to-end against OpenCode's `question` tool.
- **Composer** — focus-responsive floating pill (narrower/shorter idle,
  expanded and subtly elevated while active, without a focus outline);
  **independent voice → text**
  (`speech_to_text`) beside contextual Send/Stop; a collapsible turn-context
  icon shelf with a left-aligned 38 dp visual rhythm (48 dp touch targets) for
  data-driven reasoning options and the access mode, listing only the modes the agent offers (with a notice when the conversation kept one it no longer offers);
  a compact in-turn circular **Agent responding…** cue; **image attachments**
  in an anchored two-row "+" menu (photo library — **multi-selection**, up to
  10 per message — / camera, downscaled to 2048 px / q85, image-only message
  allowed, gated by the agent's `images` capability). Pending images sit
  **inside** the pill above the field as a 56 dp horizontally scrolling strip
  with a per-image ✕, and the pill morphs from its stadium ends to a 24 dp
  rounded surface while they are there; once sent, the same strip (72 dp)
  renders **above** the user bubble — tap to open the image full size.
- **Per-PC threads** (`Thread.deviceId`) with per-agent filter chips, search /
  sort / density, archived-thread screen, per-thread actions (rename / archive /
  unarchive / delete / copy id), **Remove device** (unpair), **Copy thread ID**
  for CLI resume.
- **Full Git** — full-screen `GitScreen` (per-file `git/diff`, branch switch with
  auto-stash, smart PR dialog, undo-commit, `git/revert`, `git/deleteBranch`,
  `git/removeWorktree`, etc.) with a focus-responsive commit composer aligned
  to the conversation composer's Neural Expressive geometry and elevation.
  `GitScreen` and the file browser are the folder's own routes
  (`AppRoutes.workspaceGit` / `workspaceFiles`), opened from a conversation or
  straight from a folder row in the threads list; git state is kept per `cwd`.
- **FCM push** (gated) — Android LIVE; deep-link to conversation; **personalized
  copy** + foreground suppression; per-channel notification preferences (Replies /
  Errors).
- **Settings** — theme mode (System/Light/Dark) + a **custom-theme library** with a
  dedicated Theme Manager (single/dual-brightness themes, live-preview grid,
  multi-select bulk delete/export, JSON import/export); language (EN/ES, follows
  device or picker); notification preferences.
- **In-app update checker** (*no silent install*) — check on launch/resume
  throttled by a **configurable interval** (every launch / 6h / 12h / 24h default
  / 48h / weekly / monthly), the installed **current version**, a *Check now*
  action, and an **in-section download → install** flow in **Settings → Updates**
  (plus the dismissible *Update available* banner on Threads, in sync). Android =
  Play In-App Update **flexible** flow (background download with real % + in-app
  install); iOS = App Store version lookup (`dio` iTunes) + StoreKit
  `SKStoreProductViewController` overlay. Single package `in_app_update_flutter`
  behind a guarded `AppUpdateService`. A flexible update is **resumable**: the
  download outlives the app that starts it, so a check re-reads the stage Play
  reports (`AppUpdateStatus.installStage`) and picks the flow back up — an update
  left downloaded returns as *Install now*, and a pending one bypasses the check
  interval on every foreground. **Partially device-verified** (Android: the first
  real Play test exposed the stuck-flow bug now fixed — see `CHANGELOG.md`; the
  fixed flow still needs a full re-run on a Play build. iOS is inert until the
  App Store listing exists) — see below.
- **i18n** — full app translated (EN + ES) via `flutter gen-l10n`.

iOS is **not yet built** (the Podfile is generated on the first macOS build) and is
blocked on the Apple assets in [`FOR-HUMAN.md`](FOR-HUMAN.md). Everything still
pending is below.

## FOR-DEV: keep the R8 keep rules complete (release minification is ON)

`android/app/build.gradle.kts` keeps `isMinifyEnabled = true` +
`isShrinkResources = true` for `release`. R8 full mode (AGP 9 default) had stripped
the no-arg constructors of the reflectively-instantiated ML Kit (`BarcodeRegistrar`)
and Firebase (`FirebaseMessagingKtxRegistrar`) registrars
(`NoSuchMethodException: <init>[]`), breaking the QR scanner and background push in
`--release`; `android/app/proguard-rules.pro` now keeps those. Watch for
regressions: if a **new** reflective dependency works in debug but breaks only in
`--release`, add its keep rule (debug doesn't minify, so it won't catch it). Always
re-test a real QR scan **and** a background push in a `--release` build before
shipping.

## App-side pending work (no live bridge needed)

- [ ] **Mermaid diagrams in the Markdown preview.** A ```` ```mermaid ```` fence
      renders as highlighted source (the honest fallback); GitHub draws the
      diagram. Needs a pure-Dart renderer or an explicit diagram placeholder in
      `MarkdownCodeBlockBuilder`
      (`presentation/screens/workspace/files/widgets/markdown_blocks.dart`);
      deferred because the mobile stack deliberately carries no WebView
      (`architecture/02a` §5.4.7).
- [ ] **Project drift repository** — the `projects` table exists; the repository +
      `AgentConfig` wiring lands with the projects module.
- [ ] **OPTIONAL — a display buffer for streamed prose, decoupled from arrival.**
      Nothing is broken; this is *perception*, not throughput, and it is written
      down only so the reasoning is not lost. On a long reply the text lands at
      roughly **6 repaints per second**, because that is how fast it arrives, and
      that can read as slightly stepped even though each repaint is now cheap.
      The idea: put incoming deltas in a queue and consume it at a steady rate,
      taking more characters per frame as the backlog grows (e.g. 2 under 30
      queued chars, 7 at 80, 12 at 200, 20+ past 500) — and **drain the queue
      hard on `turn/completed`**, so the UI never mimes typing an answer that
      already finished, which is the failure mode this pattern usually ships
      with. Site: `ThreadManager._rebuildActiveTimelineCoalesced` /
      `_streamCoalesceWindow` (`application/managers/thread_manager.dart`).
      **Prerequisite met:** it was correctly deferred until a rebuild was cheap,
      and after the settled-chunk split (2026-08-11) it is — p95 11 ms and flat
      in reply length. **Do not instead lower the coalescing window:** measured
      across twelve samples the repaint rate already sits well under what the
      window allows, so that change buys nothing (see `docs/architecture.md`).
      Decide it with the app in hand, and re-measure with the recipe in
      [`docs/testing.md`](docs/testing.md).
- [ ] **Settings survives a rotation.** Settings is two layouts — a list whose
      sections are pushed screens on a phone, and a list with the section in a
      pane that has its own navigator past 840 dp — and neither hands its state
      to the other when a tablet rotates:
      - wide → narrow drops the pane's navigator, so an open sub-screen (the
        theme editor, the licences) is gone, and with it any unsaved edits;
      - narrow → wide leaves a section pushed on the phone covering the whole
        window, over the two-pane Settings it came from;
      - `/profile` pushed on a phone becomes Settings-with-Profile once wide,
        stacked on the Settings below it (Settings inside Settings).
      Site: `_SettingsScreenState` (`presentation/screens/settings/settings_screen.dart`,
      inline `FOR-DEV:` at the pane navigator). Real fix: one Settings location
      (`/settings?section=…`, sub-screens as routes) that both layouts rebuild
      from, instead of each keeping its own stack. Deferred by the maintainer
      (2026-09-29): rotation mid-Settings is rare and nothing is lost outside
      the theme editor. Smaller, same family: back from **Manage PCs**
      (`/devices`) after rotating wide → narrow lands on the same screen once.
- [ ] **Work-log auto-expand while streaming; tap Last-edits strip to jump.** Low.
- [ ] **Arbitrary (non-image) file attach** — deferred; no bridge contract/model
      exists for it yet.
- [ ] **Adopt `freezed`/`json_serializable`** if/when entity boilerplate warrants it.
      Optional.

## App-side pending work (needs relay/bridge changes to start)

- [ ] **Manual-code pairing over the relay for a phone with no direct path
      to the PC at all.** Scanning the QR already pairs through the relay (its
      one-time ticket), but `ManualPairingService.resolve`
      (`infrastructure/pairing/manual_pairing_service.dart`) still needs a
      direct HTTP path (LAN or Tailscale) to the chosen host to turn a typed
      code into the payload. A phone with neither — cellular data only, the PC
      not yet joined to Tailscale — can't resolve a pairing code. Resolving it
      through the relay needs a new relay+bridge+shared contract (the relay
      forwards nothing but the phone route's E2EE pipe today). Not started.

- [ ] **Using a relay the person deployed by hand (`relay/use`).** The
      phone's *Remote access* section sets the relay up through Cloudflare
      only; `RelayManager.use` exists but no screen offers pasting the URL of
      a relay deployed by hand, and the phone does not read
      `RelayStatus.hostKey` (the key such a relay must list in
      `UXNAN_HOST_KEYS`). Left out
      of the relay UI step on purpose (it covers the Cloudflare path);
      add a "Use my own relay" entry to `remote_access_section.dart` (URL
      field + the host key to copy) if the hand-deployed path is to be
      offered from the phone too.

- [ ] **`git/statusBatch(cwds[])`, if the per-folder git turns out to cost
      too much.** The folder list asks `git/status` once per visible folder;
      fifteen folders on screen is fifteen requests. It is bounded already
      (connected PC only, visible folders only, one per folder per 15 s, and
      the real refresh arrives on the status bus rather than by polling), so
      this is deliberately **not** built yet — measure on a real PC with many
      folders first. If it does bite, one batched method replaces N round
      trips without changing anything in the UI: `workspaceGitProvider` is the
      only caller. Written down so the option is remembered, not so it is
      implemented on spec.

- [ ] **Pull-request indicators (number, checks, merged / integrated /
      abandoned).** `uxnandesktop` derives these from `gh` running locally;
      the bridge can only **create** PRs (`git/createPr`) and has no way to
      query them. Showing them on the phone needs a new `shared/` + `bridge/`
      method (and `gh` present on the PC) — not another provider on mobile.
      **Not scheduled in any phase**, and left out of the folder-git work on
      purpose: inventing a PR state the bridge cannot report would be worse
      than not showing one.

- [ ] **Manual ordering, as a fifth option on each level (OPTIONAL).** The
      three levels of the threads list — projects, worktrees and agents — offer
      status / activity / created / name today. A hand-arranged order was asked
      for and deliberately left out: unlike the other four it is not a
      comparator but a *stored* per-item position, so it needs somewhere to
      persist (per PC, since paths mean nothing across machines), a drag mode
      on a three-level tree, and a rule for where a newly-arrived item lands.
      It **layers on without rework**: one more value in `ListSort` plus a
      reorder mode; nothing about the current sorting has to change to make
      room for it. Marked optional on purpose — the four comparators cover the
      questions the list is actually asked.

## App+bridge seams (need a live bridge to finish/verify)

- [ ] **Relay UI — on-device verification and visual review.** Remote access,
      the setup page, the token / remove dialogs and the relay reasons in the
      connection errors are implemented and widget-tested against a fake that
      answers in the `shared/` shape (renders for review in
      `~/Pictures/Uxnan/relay-ui-review/mobile/`). Remaining: the maintainer's
      visual review, then on a device against a bridge that deploys a real
      relay — set up, switch off and on (also with the PC asleep, confirming the
      kept switch lands dated on reconnect), update, new address (a phone away
      from home reconnects after its next LAN connection), remove with and
      without deleting the Worker, and see each connection error's words by
      stopping the bridge, revoking the phone and leaving the network.
      Also on a device: walk from mobile data into the PC's Wi-Fi with the app
      open (and with it backgrounded, then resumed) and confirm the badge
      turns from Relay to LAN without the conversation dropping; with the
      relay off, leave the network and read the "remote access is off"
      reason; tap the home card's *Set up* / *Turn on* hint and close it.

- [ ] **The PC followed across networks — on-device verification.** Hosts
      convergence (`BridgeSettings.hosts` → `TrustedDevice.hosts`), the
      relay → direct try when they change, the mDNS look-up in
      `DirectTransportSelector` and the *same Wi-Fi, but the PC didn't
      answer* line in PC details are unit/widget tested against fakes in the
      `shared/` and `mdns-advertiser.ts` shapes (render:
      `~/Pictures/Uxnan/relay-ui-review/smart-route/`). Remaining, on a real
      phone (the maintainer's A55) with a bridge that publishes `hosts`:
      (1) a phone paired on one network, the PC moved to another and the
      phone on the PC's new Wi-Fi — it must land on LAN without re-pairing;
      (2) with the app open on the relay, move the PC to the phone's Wi-Fi
      and watch it go direct within ~20 s (bridge poll 15 s + debounce);
      (3) a guest/isolated Wi-Fi where the PC is announced but unreachable —
      the reason line shows; (4) cellular only — no mDNS browse (logcat
      `NsdManager` quiet); (5) that Android's `NsdManager` resolves the
      service within the 2.5 s window on a cold browse (if not, widen
      `mdnsWindow` in `DirectTransportSelector`).

- [ ] **Replica mirror — on-device verification with Uxnan Desktop.** The
      replica, project registry, start folder, presence line and origin mark are
      implemented and unit/widget tested (see `## Status`). Remaining: on a
      device against a bridge running as the user's service with the desktop
      open — add and remove a project on each side, archive and start
      conversations with the phone away and confirm they appear on reconnect,
      rename / archive / delete on the phone with the PC out of reach (and the
      same conversation changed on the desktop meanwhile) and confirm the
      latest action wins on both after reconnecting,
      change the start folder on each side, open a conversation from a push, and
      confirm the "Linked with Uxnan Desktop" line follows the desktop opening
      and closing. The screens are also pending the maintainer's visual review.

- [ ] **Plan/to-do block per-agent on-device validation** — decode + render are
      done; the tool names/shapes are still ASSUMED for Codex/OpenCode/pi. Verify
      against a real turn per agent and adjust the mappers.
- [ ] **Automated integration test against a real bridge** — today the tests drive
      a simulated in-memory bridge. Add a real-bridge integration test for
      regression safety.
- [ ] **OpenCode/pi interactive approvals** — blocked on the bridge side (their
      headless modes expose no pre-tool channel; see `bridge/FOR-DEV.md`). The app
      already renders approvals for Echo/Claude/Codex/OpenCode/Zero/Grok.
- [ ] **Profile spend and plan limits — on-device verification.** The bridge
      readers (`bridge/src/usage/`) are verified live on the maintainer's Mac,
      and the phone's sections (`spend_section.dart`, `usage_section.dart`) are
      covered by widget tests against the `shared/` shapes and reviewed as
      rendered screenshots. Remaining: **run them on a phone against a real
      bridge** — the spend of every agent on a PC, a second PC from the cache,
      each provider's limits (Codex / Claude / Copilot / Grok), a Codex reset
      redeemed, and the offline / not-signed-in / error states.

## iOS (all blocked on the first macOS build + FOR-HUMAN assets)

iOS has never been compiled (the Podfile is generated on the first macOS build).
The following are pending and tracked as assets in `FOR-HUMAN.md`:

- [ ] iOS camera permission macro (`permission_handler` Podfile `PERMISSION_CAMERA=1`).
- [ ] `NSLocalNetworkUsageDescription` + `NSBonjourServices` (LAN/Tailscale direct).
- [ ] `NSPhotoLibraryUsageDescription` (+ camera) for image attach.
- [ ] `NSMicrophoneUsageDescription` + `NSSpeechRecognitionUsageDescription` (voice).
- [ ] iOS APNs end-to-end (paid Apple account + APNs `.p8` in Firebase).

## Release / CI-CD

- [ ] **First signed release run** — `.github/workflows/{ci-mobile,release-mobile}.yml`
      both exist (verify gate + AAB → Google Play **open-testing** (beta) track via
      `r0adkll/upload-google-play`); signing is wired in `build.gradle.kts` and the
      secrets are loaded (`ANDROID_KEYSTORE_B64`, key password/alias,
      `GOOGLE_SERVICES_JSON`, `PLAY_SERVICE_ACCOUNT_JSON_BASE64`). What remains is
      executing the first tagged release and confirming the Play upload.
- [ ] **In-app version checker — on-device verification.** The checker is
      implemented (`infrastructure/updates/app_update_service.dart` +
      `presentation/providers/update_providers.dart`, wrapping
      `in_app_update_flutter`): an interval-throttled check on launch/resume
      (configurable: every launch / 6h / 12h / 24h default / 48h / weekly /
      monthly), the installed **current version**, a *Check now* action, and an
      **in-section download → install** flow in **Settings → Updates** (plus the
      dismissible *Update available* banner on the threads list, in sync). Android
      drives the **Play In-App Update** API (**flexible** flow: background download
      with real % + in-app install); iOS looks up the **App Store** version
      (`dio`) and presents the store page via StoreKit. The first real Play run
      surfaced the **stuck-flow bug** (a started update could never be finished and
      then read as "up to date"), fixed with the resume path — see `CHANGELOG.md`.
      **Still pending:** re-run the **whole** Android flow on a **Play
      open-testing (beta) track** build (a sideloaded APK always reports "no
      update"), covering what unit tests can't: that a real *Install now*
      **restarts into the new version**; that an update left downloaded comes back
      as installable after force-stopping the app; and that killing the app
      mid-download still resumes. The iOS path is inert until the App Store
      listing exists (`FOR-HUMAN.md`).
- [ ] **APK / GitHub-Releases update channel** (not built) — for users on a
      sideloaded `.apk` (no Play), poll the GitHub Releases API and show the same
      banner with a download/install action. `in_app_update_flutter` does **not**
      cover this channel (it only does Play In-App Updates + the iOS StoreKit
      path), so it needs its own checker behind the existing `AppUpdateService`
      seam.
- [ ] **Settings restructure + update flow — functional validation on device.**
      The sectioned settings (General / Workspace / System landing → per-section
      screens, About with the app logo, open-source licenses) and the reworked
      update flow (in-section download → install, configurable interval) pass
      analyze + widget/unit tests, but their **runtime behaviour** hasn't been
      exercised on a real device yet (the maintainer is reviewing the UI). Verify
      the license list actually populates on-device (the provider now surfaces a
      load error with a retry instead of a blank list), navigation into each
      section, and the update download/install states, in the next build.
