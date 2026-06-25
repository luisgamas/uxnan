# FOR-DEV — pending developer work

Deferred implementation work (code the team/agent will do later). Distinct from
`FOR-HUMAN.md` (assets only a human can provide). Search the codebase for
`FOR-DEV:` to jump to the exact deferral sites.

> Convention defined in the root `AGENTS.md` → "Pending developer work". The
> implemented surface is documented in [`README.md`](README.md) + [`docs/`](docs/);
> this file tracks only what's left.

## FOR-DEV: Bug A — relink latency after returning from "recents" (URGENT)

**Status:** open. Diagnostic instrumentation is in place (Option 1); the actual
fix is pending the captured logs. The `[reconn]` logs must be removed once fixed.

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

**Option 1 (in place):** temporary `[reconn]` diagnostic logs time every step
(probe, each reconnect attempt, each transport attempt + relay fallback).
**To capture:** build with `--dart-define=ENABLE_LOGGING=true` (logs are
suppressed otherwise — see `AppConstants.enableLogging`) and read `adb logcat`
while reproducing (background → wait → reopen). Then pin the dominant cost and fix
(candidates: skip/parallelize the dead relay fallback, interrupt a stuck
`_establish` on resume, shorten the first post-resume backoff). **Remove the
`[reconn]` logs once root-caused.**

**Recovery context (so this can be resumed from a new session):**
- Claude Code session ID: `24aeeeb5-11fc-4a2f-9cb3-8e9362280d44`
- uxnanmobile thread ID: `09b6668e-6b41-41cc-80a4-9c7e78790260`
- Prior evidence: Claude `71698c0b-6e8d-4207-8dda-9dae48e043db` / mobile thread
  `4fadeb99-ab18-4ee1-9eb9-535b1fcff3aa`; pi `019eeb97-72cb-7045-9573-478ae5e21ed4`
  / mobile thread `2d352d74-6e20-4cfd-8205-972f66443930`.
- The companion bug (tool approvals auto-rejecting while backgrounded) is already
  FIXED — see `bridge/CHANGELOG.md` "keep tool approvals pending while the phone is
  offline".

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

## On-device verification backlog

These features are code-complete but not yet maintainer-verified on a real device
against a live bridge. Verify and tick off:

- Manual-code pairing (type host + code) and mDNS "browse nearby bridges"
  (discovery lists a real bridge).
- Background→resume reconnection (minimize+reopen connected, not stuck) and
  the Relay-vs-Direct indicator reading over a hosted-relay session.
- Remote history scroll-up paging on a long real thread; scroll-position landing
  on repeated opens; *Jump to latest* after a restore.
- Reasoning-effort knobs changing a real turn; per-agent auth-status banners
  clearing once the agent is logged in; multi-PC remove-device flow.
- Git "force" paths (delete unmerged branch / remove dirty worktree) and
  vanished-cwd ("folder no longer exists") gating.

## UI polish (Neural Expressive)

- [ ] **Manual-code pairing screen** is a minimal M3 form — restyle to the Neural
      Expressive language (see `docs/neural-expressive-design.md`).

## iOS (all blocked on the first macOS build + FOR-HUMAN assets)

iOS has never been compiled (the Podfile is generated on the first macOS build).
The following are pending and tracked as assets in `FOR-HUMAN.md`:

- [ ] iOS camera permission macro (`permission_handler` Podfile `PERMISSION_CAMERA=1`).
- [ ] `NSLocalNetworkUsageDescription` + `NSBonjourServices` (LAN/Tailscale direct).
- [ ] `NSPhotoLibraryUsageDescription` (+ camera) for image attach.
- [ ] `NSMicrophoneUsageDescription` + `NSSpeechRecognitionUsageDescription` (voice).
- [ ] iOS APNs end-to-end (paid Apple account + APNs `.p8` in Firebase).

## Spec drift owed

- [ ] **Sync the architecture spec to the theme rework** — `architecture/00-index.md`
      still describes the old collapsible-in-Personalization custom-theme model;
      the app now ships single/dual themes + a dedicated Theme Manager. Per
      `AGENTS.md` → *Spec drift control*, reflect the rework in the spec.

## Release / CI-CD

- [ ] **First signed release run** — `.github/workflows/{ci-mobile,release-mobile}.yml`
      both exist (verify gate + AAB → Google Play **internal** track via
      `r0adkll/upload-google-play`); signing is wired in `build.gradle.kts` and the
      secrets are loaded (`ANDROID_KEYSTORE_B64`, key password/alias,
      `GOOGLE_SERVICES_JSON`, `PLAY_SERVICE_ACCOUNT_JSON_BASE64`). What remains is
      executing the first tagged release and confirming the Play upload.
- [ ] **In-app version checker** (deferred) — notify on a newer version and let the
      user decide (no silent install): APK → poll GitHub Releases + banner; Play →
      the In-App Updates API. iOS waits for the App Store path.
