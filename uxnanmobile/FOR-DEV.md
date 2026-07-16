# FOR-DEV — pending developer work

Deferred implementation work (code the team/agent will do later). Distinct from
`FOR-HUMAN.md` (assets only a human can provide). Search the codebase for
`FOR-DEV:` to jump to the exact deferral sites.

> Convention defined in the root `AGENTS.md` → "Pending developer work".
> [`README.md`](README.md) carries the user-facing snapshot; the detailed status
> below is the developer record of what's working, and the rest of this file
> tracks what's left.

## Status

**MVP wired — Android alpha-ready.** All core modules are implemented and
connected to live bridge data, validated on-device against a real bridge.

**Built (DONE):**

- **E2EE crypto + secure transport** (X25519 + Ed25519 + HKDF + AES-256-GCM,
  handshake, seq/replay, outbound buffer, reconnect loop).
- **Pairing & onboarding** — `OnboardingScreen`, `QrScannerScreen`,
  `MyDevicesScreen`, **`ManualCodeScreen`** (bridge-first manual-code pairing,
  `GET /pair/resolve?code=`, host typed or via mDNS discover).
- **Direct LAN/Tailscale transport** — `DirectTransportSelector` tries each direct
  `hosts` entry from the QR first, falls back to the relay.
- **Multi-PC connection-targeting** — all live actions target the PC we actually
  hold a channel to; browsing is read-only. `bridge/status` consumed (Relay /
  Direct transport indicator). The devices card shows the **real connected
  endpoint** (the direct host that won the dial race, or the relay — carried on
  `connectedEndpointStream`), not the first advertised host, and **blurs it by
  default with tap-to-reveal** so the network topology isn't exposed at a glance.
- **Profile & metrics (bridge-owned, survivable).** A **Profile** screen (Devices
  app-bar avatar + a Settings header) aggregating activity across every paired PC
  — a GitHub-style contribution heatmap (Combined / Conversations / Messages /
  Work, per year, tap-a-day / tap-outside-to-clear), stat tiles (time connected,
  longest session, agents used, conversations, messages, sessions, git actions,
  most-used transport, models) and a per-agent breakdown — plus a **per-PC
  details** screen (device-card ▸ Statistics) and a customizable name + avatar.
  The metrics now come from the **bridge** (`metrics/get`), so they **survive an
  app uninstall** (re-fetched on re-pair); the phone keeps a per-PC snapshot
  display cache (`MetricsCacheStore`) and falls back to the local drift
  aggregation only when the cache is empty. A profile **"Backup"** section adds a
  "local data can be lost" note + **Export / Import** of a bridge-sealed,
  tamper-proof file (`metrics/export` / `metrics/import`), with EN/ES strings. The
  per-agent usage/credit view stays Phase B (the `agent/usageStats` item below).
- **Live streaming conversations** that survive leaving/re-entering the screen
  (per-thread in-memory buffers + `turn/list` re-sync) with a per-thread
  **"Responding…"** activity indicator. Timeline auto-follow yields to manual
  scrolling, stays detached while older content is being read, and resumes at
  the bottom or through an explicit jump/send action.
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
  disclosures (collapsed by default and exclusively expanded per turn),
  collapsible **Changed files (N) · +a −d** with per-file diffs, **Copy
  response**, **Last edits** strip above the composer; **Thinking** remains
  settings-gated. Long user text defaults to a ten-line expandable preview and
  still copies in full.
- **New conversation flow** — `project/list` + `agent/list` + `agent/models` +
  **folder browser** (`workspace/browseDirs`) to root a thread anywhere. The
  full-screen Neural Expressive dialog compares agents in one dynamic-corner
  card group; selecting an agent expands only its capability chips and
  collapses the previous selection.
- **Workspace file browser + viewer** — lazy git-aware tree, repo-wide fuzzy
  search with relative-path results, ancestor reveal and hidden pre-positioning
  of the selected row, selectable text/Markdown/diff viewing, inline editing,
  diff overlays and full-surface fit-to-screen image zoom.
- **Structured model picker** (readable names, default badge, Claude alias
  "(latest)" + pinned versions + resolved-version row, `thread/setModel`), with
  a **Settings ▸ Models** switch to hide Claude Code's `isLatestAlias` "(latest)"
  entries and show only pinned versions (display-only; persisted locally).
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
- **Per-agent sign-in status** (`auth/status`) — banner above the composer, red
  dot in the threads list, "Check sign-in" in the new-conversation card,
  auto-refresh on app resume.
- **Interactive approval** (Approve / Reject / "always allow this session") with a
  spring `AnimatedSize` morph; validated end-to-end against Echo, Claude Code
  (`PreToolUse` hook), Codex (`app-server`), Gemini (`BeforeTool` hook) and
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
  data-driven reasoning options and color-coded approval mode;
  a compact in-turn circular **Agent responding…** cue; **image attachments**
  in an anchored two-row "+" menu (photo library / camera, downscaled to 2048
  px / q85, image-only message allowed, gated by the agent's `images`
  capability).
- **Per-PC threads** (`Thread.deviceId`) with per-agent filter chips, search /
  sort / density, archived-thread screen, per-thread actions (rename / archive /
  unarchive / delete / copy id), **Remove device** (unpair), **Copy thread ID**
  for CLI resume.
- **Full Git** — full-screen `GitScreen` (per-file `git/diff`, branch switch with
  auto-stash, smart PR dialog, undo-commit, `git/revert`, `git/deleteBranch`,
  `git/removeWorktree`, etc.) with a focus-responsive commit composer aligned
  to the conversation composer's Neural Expressive geometry and elevation.
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

- [ ] **Bridge-update: fixed "About" row in Settings.** The bridge-outdated
      **banner** (thread list) and its data are done — `bridgeUpdateProvider`
      exposes `{ currentVersion, latestVersion }` from `bridge/status`
      (`updateAvailable`/`latestVersion`), and `BridgeStatus` parses both. What's
      left is a **fixed, always-visible row** in **Settings → About** showing the
      bridge version and an "update available" hint. It was intentionally **not**
      added on the current Settings screen to avoid a large collision with the
      in-flight settings overhaul on `feat/settings-updates-overhaul` (which
      rebuilds the settings landing + adds About/Licenses screens). **Unblocks
      when that overhaul merges:** add the row to the new About section, reading
      `bridgeUpdateProvider` (no new data/contract work needed).
- [ ] **Project drift repository** — the `projects` table exists; the repository +
      `AgentConfig` wiring lands with the projects module.
- [ ] **Work-log auto-expand while streaming; tap Last-edits strip to jump.** Low.
- [ ] **Arbitrary (non-image) file attach** — deferred; no bridge contract/model
      exists for it yet.
- [ ] **Adopt `freezed`/`json_serializable`** if/when entity boilerplate warrants it.
      Optional.

## App+bridge seams (need a live bridge to finish/verify)

- [ ] **Access-mode enforcement for non-Claude agents** — Claude, **Gemini and
      Codex** now enforce the per-turn access mode (see `bridge/CHANGELOG.md`
      "per-turn access-mode enforcement"). Remaining: **Codex mid-thread re-apply**
      — the posture is set at `thread/start`, so changing the access mode partway
      through an existing Codex thread only affects threads started afterward
      (tracked in `bridge/FOR-DEV.md`). pi/OpenCode can't gate tools (no headless
      pre-tool channel), so they don't map `accessMode`. Verify the live behavior
      per agent.
- [ ] **Plan/to-do block per-agent on-device validation** — decode + render are
      done; the tool names/shapes are still ASSUMED for Codex/OpenCode/pi. Verify
      against a real turn per agent and adjust the mappers.
- [ ] **Automated integration test against a real bridge** — today the tests drive
      a simulated in-memory bridge. Add a real-bridge integration test for
      regression safety.
- [ ] **OpenCode/pi interactive approvals** — blocked on the bridge side (their
      headless modes expose no pre-tool channel; see `bridge/FOR-DEV.md`). The app
      already renders approvals for Echo/Claude/Codex/Gemini.
- [ ] **AI-provider usage stats (`agent/usageStats`) — live verification.** The
      **bridge reader** (`bridge/src/usage/usage-reader.ts`) and the **mobile
      "Usage & credit" section** (profile: per-provider quota windows, plan,
      credit; `usageStatsProvider` + `ProviderUsage`, shown only when connected)
      are **implemented**. Remaining: **verify on-device against a real bridge**
      with signed-in providers — confirm each provider's live response maps
      correctly (Codex / Claude / Copilot / Gemini / Grok) and the offline /
      not-installed / auth-required / error states render right.

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
