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
  Direct transport indicator).
- **Live streaming conversations** that survive leaving/re-entering the screen
  (per-thread in-memory buffers + `turn/list` re-sync) with a per-thread
  **"Responding…"** activity indicator.
- **Structured agent turns** — assistant replies without a bubble, consecutive
  text merged, collapsible **Work log (N)**, collapsible **Changed files (N) ·
  +a −d** with per-file diffs, **Copy response**, **Last edits** strip above the
  composer; **Thinking** section (settings-gated, default off).
- **New conversation flow** — `project/list` + `agent/list` + `agent/models` +
  **folder browser** (`workspace/browseDirs`) to root a thread anywhere.
- **Structured model picker** (readable names, default badge, Claude alias
  "(latest)" + pinned versions + resolved-version row, `thread/setModel`), with
  a **Settings ▸ Models** switch to hide Claude Code's `isLatestAlias` "(latest)"
  entries and show only pinned versions (display-only; persisted locally).
- **Per-model run-option knobs** (data-driven: `enum` / `toggle`, generic
  renderer).
- **Context-usage indicator** (percentage when the model window is known, raw
  token count otherwise; **0 baseline** for agents with `reportsContextUsage`).
- **Per-agent sign-in status** (`auth/status`) — banner above the composer, red
  dot in the threads list, "Check sign-in" in the new-conversation card,
  auto-refresh on app resume.
- **Interactive approval** (Approve / Reject / "always allow this session") with a
  spring `AnimatedSize` morph; validated end-to-end against Echo, Claude Code
  (`PreToolUse` hook), Codex (`app-server`) and Gemini (`BeforeTool` hook).
  OpenCode/pi have no headless pre-tool channel yet.
- **Composer** — bottom-anchored bar; **stop-the-turn** mid-run; **voice → text**
  (`speech_to_text`); **image attachments** (photo library / camera, downscaled to
  2048 px / q85, image-only message allowed, gated by the agent's `images`
  capability).
- **Per-PC threads** (`Thread.deviceId`) with per-agent filter chips, search /
  sort / density, archived-thread screen, per-thread actions (rename / archive /
  unarchive / delete / copy id), **Remove device** (unpair), **Copy thread ID**
  for CLI resume.
- **Full Git** — full-screen `GitScreen` (per-file `git/diff`, branch switch with
  auto-stash, smart PR dialog, undo-commit, `git/revert`, `git/deleteBranch`,
  `git/removeWorktree`, etc.).
- **FCM push** (gated) — Android LIVE; deep-link to conversation; **personalized
  copy** + foreground suppression; per-channel notification preferences (Replies /
  Errors).
- **Settings** — theme mode (System/Light/Dark) + a **custom-theme library** with a
  dedicated Theme Manager (single/dual-brightness themes, live-preview grid,
  multi-select bulk delete/export, JSON import/export); language (EN/ES, follows
  device or picker); notification preferences.
- **In-app update checker** (code-complete; *no silent install*) — check on
  launch/resume throttled by a **configurable interval** (every launch / 6h / 12h
  / 24h default / 48h / weekly / monthly), the installed **current version**, a
  *Check now* action, and an **in-section download → install** flow in
  **Settings → Updates** (plus the dismissible *Update available* banner on
  Threads, in sync). Android = Play In-App Update **flexible** flow (background
  download with real % + in-app install); iOS = App Store version lookup (`dio`
  iTunes) + StoreKit `SKStoreProductViewController` overlay. Single package
  `in_app_update_flutter` behind a guarded `AppUpdateService`. **Not yet
  device-verified** (Android needs a Play open-testing (beta) track build — Play
  only reports updates for Play-distributed builds; iOS needs an App Store
  listing) — see below.
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
- [ ] **File-browser search (reuse `workspace/searchFiles`).** The repo-wide
      fuzzy search is **ready end-to-end** — the bridge method `workspace/
      searchFiles` and `FileBrowserManager.searchFiles(cwd, query)` already exist
      (they back the composer's `@` picker). What's missing is the UI: add a
      search affordance to `FileBrowserScreen` (presentation/conversation/files)
      that calls `searchFiles` and shows the flat path matches (tap → open in the
      file viewer), mirroring the threads/commit-history search style. No
      bridge/contract work — purely the mobile screen.
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
      **code-complete** (`infrastructure/updates/app_update_service.dart` +
      `presentation/providers/update_providers.dart`, wrapping
      `in_app_update_flutter`): an interval-throttled check on launch/resume
      (configurable: every launch / 6h / 12h / 24h default / 48h / weekly /
      monthly), the installed **current version**, a *Check now* action, and an
      **in-section download → install** flow in **Settings → Updates** (plus the
      dismissible *Update available* banner on the threads list, in sync). Android
      drives the **Play In-App Update** API (**flexible** flow: background download
      with real % + in-app install); iOS looks up the **App Store** version
      (`dio`) and presents the store page via StoreKit. **Still pending:** Android
      In-App Updates only report a real update from a build installed via **Google
      Play** — verify against a **Play open-testing (beta) track** build (a
      sideloaded APK always reports "no update"). The iOS path is inert until the
      App Store listing exists (`FOR-HUMAN.md`).
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
