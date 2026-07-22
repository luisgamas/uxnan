# Release versions

Tracks which version of each Uxnan component shipped, and when. Components
version **independently** (each has its own patch), but a shared
`-alpha.YYYYMMDD` date suffix marks releases cut on the same day, so you can tell
which versions "go together".

## Convention

- Base SemVer starts at `0.0.1` (pre-1.0 = unstable; breaking changes allowed).
- Alpha builds use `0.0.PATCH-alpha.YYYYMMDD`. The `YYYYMMDD` date orders
  correctly under SemVer/npm.
- **Desktop channels are intentionally different.** The tag is the channel's
  source of truth, not a manual GitHub Release checkbox:
  - **Stable:** `desktop-stable-v0.0.PATCH` (for example,
    `desktop-stable-v0.0.10`). It produces a normal GitHub Release and feeds the
    stable updater manifest.
  - **Nightly:** `desktop-nightly-v0.0.PATCH-nightly.YYYYMMDD.N` (for example,
    `desktop-nightly-v0.0.11-nightly.20260712.1`). `N` starts at `1` and only
    distinguishes multiple nightlies cut on the same date. It produces a GitHub
    pre-release and feeds the nightly updater manifest.
  - The numeric `0.0.PATCH` base must be **new for every Desktop build in either
    channel**. Windows MSI and Tauri's updater compare only that numeric base, so
    reusing it would make a newer nightly invisible. Choose a base greater than
    every already-shipped Desktop build; switching from a higher nightly build to
    an older stable build is a downgrade and is intentionally not automatic.
- Per-component git tags drive releases:
  `shared-v*`, `bridge-v*`, `relay-v*`, `desktop-stable-v*`,
  `desktop-nightly-v*`, `mobile-v*`
  (mobile may append `+<buildNumber>`, e.g. `mobile-v0.0.1-alpha.20260621+5`).
- **Source tracks the tag — bump EVERY version file AND its lockfile in the same
  commit.** A stale lockfile is silent drift: the npm/desktop release workflows
  re-apply the version at build time with `--allow-same-version`, which **masks**
  an un-bumped source lock (that is exactly how `uxnandesktop/package-lock.json`
  sat at `0.0.2` while the app shipped `0.0.3`/`0.0.4`). So bump **all** of a
  component's version-bearing files, and re-sync the lockfile, before tagging:
  - **npm (shared / bridge / relay):** `package.json` **and the root
    `package-lock.json`** — use `npm version <v> -w <ws> --no-git-tag-version`
    (it updates **both**), not a hand edit of `package.json`.
  - **desktop:** the **numeric base** (`0.0.PATCH`, MSI-safe — the Windows MSI
    rejects a non-numeric pre-release id; the full version rides the tag + the
    compiled-in `UXNAN_VERSION`) in **all five**: `src-tauri/tauri.conf.json`,
    `src-tauri/Cargo.toml`, **`src-tauri/Cargo.lock`** (the `uxnan-desktop`
    entry), `uxnandesktop/package.json`, **and `uxnandesktop/package-lock.json`**
    (`npm install --package-lock-only` to re-sync the lock). Do **not** rely on
    the CI `npm version` step to fix the lock — that leaves the committed lock
    drifting.
  - **mobile:** `pubspec.yaml` (its `pubspec.lock` carries no app version).
    `release-mobile.yml` **fails** the release on a pubspec↔tag mismatch.
  - **Verify before tagging:** each manifest version **equals** its lockfile
    counterpart (`node -p "require('./uxnandesktop/package-lock.json').version"`
    etc.). Never commit a manifest/lock version mismatch.
- npm packages publish to the **`latest`** dist-tag, so `npm install`
  (`npm install -g uxnan-bridge`) and the bridge's self-update check always
  resolve the **newest** release. Pre-release channels (`alpha`/`beta`) are
  **opt-in** — the maintainer adds them manually per build when wanted, e.g.
  `npm dist-tag add uxnan-bridge@<version> beta`. (Historically the workflow
  published under `alpha`, which left `latest` stuck at the very first version;
  see *Fixing an already-published package's `latest`* below.)
- Mobile ships to **Google Play** (open testing / beta); desktop to **GitHub
  Releases** (draft).

## Release checklist

Cutting a release for component `<comp>` (tag `<comp>-v<version>`; Desktop uses
the channel-specific forms above):

1. **Pre-flight** — the commit you will tag is green on CI (`ci-*.yml`) and its
   `CHANGELOG.md [Unreleased]` accurately describes what ships.
2. **Mobile only — bump the source version FIRST (non-negotiable)** — set
   `uxnanmobile/pubspec.yaml` `version:` to the release `<name>+<build>` (e.g.
   `0.0.1-alpha.20260621+5`), then **commit and push it**, so the *tagged commit*
   carries the matching version and the Flutter source never lags a tag.
   `release-mobile.yml` **fails the release** if pubspec and the tag disagree.
3. **Mobile only — refresh the Play "What's new" notes** — rewrite
   `.github/whatsnew/whatsnew-en-US` and `whatsnew-es-ES` as a short,
   **non-technical**, user-facing summary of this version's CHANGELOG,
   **≤ 500 characters each**. The release workflow validates both (missing / empty /
   placeholder / over-limit → the release fails). Commit + push before tagging.
4. **Tag & push** — `git tag <comp>-v<version> && git push origin <comp>-v<version>`,
   which triggers `release-<comp>.yml`.
5. **Validate the deploy** — wait for the `release-*.yml` run to go **green** and
   confirm the artifact actually landed: npm shows the new version on the `latest`
   dist-tag (`npm view <pkg> dist-tags.latest`) / the Play **open-testing** (beta)
   track has the new build / the desktop **GitHub Release** draft exists. A red or
   half-finished run is **not** a release — fix it.
6. **Record it** — add the row to the *History* table below (date + the component's
   new version) and commit it to `main`, as the last release step (see the
   automation note under the table).

## Fixing an already-published package's `latest`

The workflow **used to** publish under the `alpha` dist-tag. Because npm only sets
`latest` on a package's **first** publish and `--tag alpha` never moves it, the
already-published packages have `latest` stuck at their first version
(`0.0.1-alpha.20260627`) even though newer versions exist under `alpha`. So
`npm install -g uxnan-bridge` installs the *oldest* build.

The workflow is now fixed (publishes to `latest`), but the **existing** packages
need a one-time manual `latest` move — this requires npm publish rights and is
**not** something CI does. From an `npm login`'d shell, point `latest` at the
newest published version (see the *History* table for the current newest):

```bash
npm dist-tag add @uxnan/shared@0.0.3-alpha.20260702 latest
npm dist-tag add uxnan-bridge@0.0.3-alpha.20260702 latest
# relay's latest is already its newest (0.0.1-alpha.20260627) — nothing to do.
```

Verify with `npm view <pkg> dist-tags`. Optionally drop the now-redundant `alpha`
tag (`npm dist-tag rm uxnan-bridge alpha`) — leaving it is harmless. From the next
release onward the workflow keeps `latest` current automatically.

## History

| Date (YYYY-MM-DD) | shared | bridge | relay | desktop | mobile |
| ----------------- | ------ | ------ | ----- | ------- | ------ |
| 2026-07-22 | — | — | — | 0.0.21-nightly.20260722.1 | — | <!-- desktop: nightly — EXPERIMENTAL unsigned macOS installer (PR #110): two separate ad-hoc-signed DMGs — Apple Silicon `aarch64` (native) + Intel `x86_64` (cross-compiled on `macos-14`, since GitHub's Intel runners are being retired); `signingIdentity "-"`, `hardenedRuntime false`, `minimumSystemVersion 11.0` — no Apple account, users clear Gatekeeper by hand (`uxnandesktop/docs/install-macos.md`). New `path_env` module enriches the process PATH on a macOS Finder/Dock launch (time-bounded login+interactive shell probe + well-known dirs) so agent/`gh`/`git`/editor detection and PTY shells find Homebrew/npm/version-manager CLIs; seeded terminal profile is a real login shell (`-l`), `zsh` fallback on macOS. CI verifies macOS (Apple Silicon) via `verify-desktop.yml`'s new `os-list` input; the release gate stays `{ubuntu, windows}`; the release matrix builds both mac DMGs with `fail-fast:false`. `latest.json` on `desktop-updater-nightly` now carries `darwin-aarch64` + `darwin-x86_64`. 266 Rust (+5) + 225 Vitest. Base 0.0.21 > every shipped build (nightly 0.0.20). From PR #110 (admin-merged, CI green; a transient Linux AppImage-download flake was re-run) — nightly channel -->
| 2026-07-21 | — | — | — | 0.0.20-nightly.20260721.2 | — | <!-- desktop: nightly — VSCode-style file-tree UX + tab & editor-selection fixes (PR #109): inline file/folder creation (an editable draft row inside the tree, intercalated `folder/file.js` paths via `mkdir -p`, a toolbar "…" New file/folder, and Esc-deselect + empty-area project-root actions), inline rename in the tree (shared `TreeInlineInput`; the old `FileNamePromptDialog` removed), file-tree keyboard shortcuts (F2 rename, Del/Cmd+Backspace → OS trash, Enter/Space open — never while typing), VSCode-style focus (opening a tab no longer steals focus from the tree, so Esc deselects and the tree stays keyboard-operable) with the row highlight tracking the selection rather than "open in a tab", theme-tinted text-shaped editor/diff `::selection` that never hides glyphs (native caret via `caret-color`), and a right-click (or mere focus) no longer switches tabs (right-panel tabs default to `activationMode="manual"`; a center-tab right-click only opens its context menu). Backend `fs_create_file`/`fs_create_dir` accept guarded relative intercalated paths. 261 Rust + 225 Vitest (no tests added by #109). Base 0.0.20 > every shipped build (nightly 0.0.19). From PR #109 (admin-merged, CI green) — nightly channel -->
| 2026-07-21 | 0.0.9-alpha.20260721 | 0.0.11-alpha.20260721 | — | — | 0.0.12-alpha.20260721+20260722 | <!-- shared/bridge/mobile: complete durable activity ledger, LAN-discovery fix, and restore-clone hardening (PR #108). bridge: `~/.uxnan/metrics.json` becomes a v2 global ledger — conversations, turn message/day buckets, reported tokens, connection sessions and mutating Git actions — projected incrementally with an idempotent `threads.json` backfill and five rotating `.bak` generations; deleting a thread no longer subtracts its historical conversations/messages/tokens from `metrics/get`; `metrics/export`+`import` now seal & merge the whole ledger (legacy v1 backups still importable); and the dependency-free mDNS advertiser joins `224.0.0.251:5353` on every eligible IPv4 and sets the outbound multicast interface, so LAN discovery works on multi-homed Windows hosts (a disconnected Ethernet/Tailscale/Hyper-V/WSL route no longer steals it) — still advertising only discovery hints, never the pairing code. mobile: Android Auto Backup + device-transfer now exclude both secure-storage prefs and iOS Keychain uses a this-device-only accessibility class, so a restored install can't clone the Ed25519 identity/notification secret (it re-pairs); the metrics controller stays alive from startup so the full ledger is fetched on every (re)connection. shared: the `metrics/*` backup wire shapes are documented as the complete durable ledger (`imported` counts every advanced row); shapes/method names unchanged, so the bridge release pins @uxnan/shared 0.0.9-alpha.20260721. Mobile build 20260722 > last 20260721. From PR #108 (admin-merged, CI green) -->
| 2026-07-21 | — | — | — | 0.0.19-nightly.20260721.1 | — | <!-- desktop: nightly — flexible worktree creation & safe, opt-in removal (PR #105): a New-branch/Existing-branch toggle with a friendly collision-proof branch-name generator and an optional custom location backed by an in-app folder browser (manual refresh + live change detection); removal is worktree-only by default, with opt-in delete-local (`-d`/force, squash-merge safety net preserved) and delete-remote, and RemoveOutcome reports each branch's fate. Plus configurable per-terminal scrollback (Settings → Terminal, 1k–200k, default raised to 20k) and one-time Windows junction/Redirection-Guard (`os error 448`) failure guidance (PR #98), and in-place pending-action spinners across the async filesystem/Git/GitHub/agent-hook surfaces. 261 Rust + 225 Vitest. Base 0.0.19 > every shipped build (stable 0.0.18). From PRs #98, #105 (admin-merged, CI green) — nightly channel -->
| 2026-07-21 | — | 0.0.10-alpha.20260721 | — | — | 0.0.11-alpha.20260721+20260721 | <!-- bridge/mobile: manual-pairing hardening from real-device reports (PR #107). bridge: `uxnan-bridge start` now bypasses the 24h update-check cache (a bridge that checked while an older build was newest stayed silent for up to a day, so a version-incompatible pair was never told to update); `/pair/resolve` logs accepted/rejected/rate-limited per client IP (never the code) so a Tailscale connect-timeout is no longer misdiagnosed as a bad pairing code; and a refused atomic-write `rename` is retried with a capped backoff (~410ms) so a spurious Windows EPERM/EBUSY/EACCES can no longer strand a turn at `streaming` forever — AgentManager also now fails the turn on a terminal-event throw (defense in depth); suite 535/535. mobile: manual pairing over Tailscale no longer aborts before the tunnel comes up (connectTimeout 5s→20s), and a version-mismatched bridge now says "update the bridge" instead of blaming the pairing code (distinct incompatibleVersion error kind). shared unchanged, so the bridge release pins @uxnan/shared 0.0.8-alpha.20260720. Mobile build 20260721 > last 20260720. From PR #107 (admin-merged, CI green) -->
| 2026-07-20 | 0.0.8-alpha.20260720 | 0.0.9-alpha.20260720 | 0.0.2-alpha.20260720 | — | 0.0.10-alpha.20260720+20260720 | <!-- shared/bridge/relay/mobile: security hardening pass. **Breaking wire change** — the E2EE envelope now binds sessionId/seq/direction as AES-GCM AAD, so replay and reflection are cryptographically enforced instead of resting on an unauthenticated seq counter; SECURE_PROTOCOL_VERSION goes 1 -> 2 and BOTH sides now validate it at the handshake, turning a version-skewed pair from a silent hang (connected, every frame dropped) into a clear 'update both' error. bridge/mobile therefore MUST be installed together. Also: LAN qr_bootstrap enrollment now requires an operator-armed pairing window (any reachable LAN/Tailscale peer could previously self-enroll as trusted), armed by showing the QR/code or by a successful /pair/resolve — the last is what keeps a console-less autostarted daemon pairable, and the window is tied to MAX_PAIRING_AGE_MS so it never expires under the QR it gates; the mobile pairing code is now sent to ONLY the user-chosen host (it was raced against spoofable mDNS candidates, disclosing the code and letting a rogue responder be trusted as the PC); per-IP rate-limiter maps bounded against IP-rotation memory exhaustion (relay + bridge); relay reconnect backs off on accept-then-close. Plus a mobile network-path badge (LAN/Tailscale/Direct/Relay) and path-guard unit tests. Suites: bridge 529, shared 36, relay 30, mobile 702. shared changed, so the bridge and relay releases pin @uxnan/shared 0.0.8-alpha.20260720. Mobile build 20260720 > last 20260719. First relay release since 0.0.1-alpha.20260627. From PRs #99, #100, #101, #102, #103, #104 (admin-merged, CI green) -->
| 2026-07-19 | 0.0.7-alpha.20260719 | 0.0.8-alpha.20260719 | — | — | 0.0.9-alpha.20260719+20260719 | <!-- shared/bridge/mobile: Antigravity (Google's `agy`) wired as the 8th real bridge agent (one-shot per turn, client-owned --conversation UUID + --add-dir, autonomous/plan postures, models via `agy models`) and rendered as a branded choice in the mobile picker while the deprecated Gemini CLI is hidden (wiring kept for easy re-enable); plus a mobile session-recovery fix — a mid-turn app reopen now recovers the FULL agent reply (unconditional turn/list re-seed + resync on every reconnect + authoritative finalize + turn/read reconcile), and beforeText-flagged parallel-subagent blocks no longer split a sentence with an activity card. shared adds `antigravity-cli` AgentId + `ContentBlockParams.beforeText`; bridge also clears `activeTurnId` before a turn's terminal status is observable (fixes a turn/list race). Suites: bridge 493, shared 36, relay 27, mobile 670. shared changed, so the bridge release pins @uxnan/shared 0.0.7-alpha.20260719. Mobile build 20260719 > last 20260718. From PRs #95, #96 (admin-merged, CI green) -->
| 2026-07-19 | — | — | — | 0.0.18 | — | <!-- desktop: stable — agent session resume actually works end-to-end (0.0.17's on-device QA found it dead): the agent:status-changed event now carries the captured session (omitting it silently disabled resume while the backend cache captured fine), the OpenCode plugin forwards the ROOT session's sessionID and the Pi extension forwards explicit session_id/session_file fields, waking a session-less tab clears its leftover launch command instead of starting a fresh agent conversation, and an auto-resumed pane skips the old-screen replay (the TUI redraws its own conversation). Codex capture pinned with a golden test from a real intercepted hook payload (session_id rides every lifecycle event — no agent-specific wiring needed). Resume set: Claude, Codex, OpenCode, Pi. Suites: 257 Rust + 212 Vitest. Base 0.0.18 > every shipped build. From PR #94 (admin-merged, CI green) -->
| 2026-07-18 | — | — | — | 0.0.17 | — | <!-- desktop: stable — workspace session lifecycle: the restored session re-binds to its project at boot (selection/watchers follow with zero clicks; stale workspace keys purged; only the active workspace spawns at startup), workspace sleep/wake (processes stopped, tabs/splits kept; parsed-screen snapshots in an atomic terminal-buffers.json sidecar make scrollback survive restarts), and agent CLI session auto-resume (hook-captured provider ids; claude/codex/opencode/pi TUIs relaunch themselves when they were alive at close). Plus two production bug fixes: the orphaned body pointer-lock that froze all mouse input now self-heals on the next click (and the menu→dialog flows defer opens to prevent it), and the packaged-build file editor renders again (style-src exempted from Tauri's CSP nonce rewriting, which voided 'unsafe-inline' per spec). Suites: 256 Rust + 212 Vitest. Base 0.0.17 > every shipped build (stable 0.0.16, nightly 0.0.15). From PRs #91, #92, #93 (admin-merged, CI green) -->
| 2026-07-18 | — | — | — | 0.0.16 | — | <!-- desktop: first STABLE (`desktop-stable-v*`) since 0.0.9 — promotes the whole 0.0.10→0.0.15 nightly line (multi-agent orchestration + broadcast rework, provider usage incl. Grok/Codex resets, precise agent status + Claude/OpenCode sub-agents, quick commands, `gh`-backed GitHub integration, xterm.js 6 terminal-render fixes) to the stable channel, plus the new 0.0.16 work: "Open with" external editors/IDEs, the window Close-button fix, main-window CSP + http(s)-only in-app browser, hardened local hook/MCP server, bounded always-on backend watchers, and git-mutation characterization tests (backend suite 251). Base 0.0.16 is greater than every shipped nightly (0.0.15), so the updater/MSI accepts it as an upgrade. From PR #90 (`feat/desktop-open-with-panel-ux`, admin-merged) -->
| 2026-07-17 | — | — | — | 0.0.15-nightly.20260717.1 | — | <!-- desktop: terminal rendering — the three root causes fixed by construction: the shared WebGL glyph atlas is never cleared on reveal (it is shared across instances, so clearing it corrupted co-visible panes), xterm instances stay alive and are re-parented on a tab move (destroy+replay and the PTY output ring buffer + `pty_snapshot` are gone), and the spawn/resize race that left the shell on a stale 80x24 grid is removed (`requestPtyResize` is the only path to `pty_resize`; pre-spawn requests are stashed and flushed, a failed resize no longer poisons the dedupe); plus the revealed-pane scroll fix now calls the real xterm 6 API (`core.viewport.syncScrollArea()` — the previous `queueSync()` does not exist in 6.0.0, so optional chaining made it a silent no-op). Also: the `gh`-backed GitHub integration — a full-screen section + right-panel tab, PR review/merge/diff with protection-aware merging (repo settings ∩ base-branch rulesets, auto-merge then admin bypass), issue triage/create, Actions logs, worktree-native `gh pr checkout` / `gh issue develop`, GitHub-flavored Markdown, and optional AI PR-body drafting; no token is stored or read by the app (`gh` owns it). Its write side is implemented but largely unexercised against real GitHub data (PRs #76, #77) — nightly channel -->
| 2026-07-16 | — | 0.0.7-alpha.20260716 | — | — | 0.0.8-alpha.20260716+20260718 | <!-- bridge: an omitted JSON-RPC `params` no longer fails methods whose fields are all optional — the phone omits it when every field is unset, so the default no-passphrase `metrics/export` was answered -32602 (surfaced on the phone as "make sure a PC is connected") and `thread/list` with no projectId silently no-op'd; mobile: profile stats gain a manual refresh + a persisted refresh mode (automatic on open / 5-60 min poll / manual), a rejected export now quotes the bridge's real reason, a Neural Expressive pass over files, Git history, onboarding and the composer, and every remaining spinner adopts the shared M3 Expressive loader (PRs #72, #73, #74). shared unchanged (no source change), so the bridge release pins @uxnan/shared 0.0.6-alpha.20260716. Build 20260718: Play's versionCode must strictly increase and 0.0.7 took 20260717 earlier the same day -->
| 2026-07-16 | — | — | — | — | 0.0.7-alpha.20260716+20260717 | <!-- mobile: fixes the Play in-app update flow — a started update could never be finished and then reported "up to date" forever, stranding a downloaded APK; a check now resumes it from the stage Play reports (PR #71). Build number borrows the next day: 0.0.6 took 20260716 earlier the same day and Play's versionCode must strictly increase -->
| 2026-07-16 | 0.0.6-alpha.20260716 | 0.0.6-alpha.20260716 | — | — | 0.0.6-alpha.20260716+20260716 | <!-- shared/bridge: agent slash commands (agent/commands), provider usage (agent/usageStats), and durable tamper-proof profile metrics (metrics/*) with a per-day per-agent breakdown (byAgentDay); mobile: profile stats + contribution heatmap with an Activity/Tokens lens, encrypted metrics backup, usage & credit, slash-command palette, workspace file search + previews (PR #69) -->
| 2026-07-16 | — | — | — | 0.0.14-nightly.20260716.1 | — | <!-- desktop: terminal render fixes — xterm.js 6.0 upgrade fixes deformed/ghosted text (shared WebGL glyph atlas, #4065/#4480) + reveal viewport re-sync (queueSync) so scroll reaches the true end + slim hover-only scrollbar restored; agent detection stops mislabeling non-agent processes that spawn agent helpers (foreground-job discipline) (PRs #66, #67) — nightly channel -->
| 2026-07-15 | — | — | — | 0.0.13-nightly.20260715.1 | — | <!-- desktop: terminal reliability — blank-pane launch fix (ConPTY startup query race) + ghost/doubled-text fix (xterm addon/core realign) + renderer hardening (PR #65) — nightly channel -->
| 2026-07-14 | — | — | — | 0.0.12-nightly.20260714.1 | — | <!-- desktop: precise agent status (done/waiting fix) + Claude & OpenCode sub-agents + configurable terminal keyboard arbitration + interrupt inference + quick commands + left-panel polish (PR #63) — nightly channel -->
| 2026-07-13 | — | — | — | 0.0.11-nightly.20260713.2 | — | <!-- desktop: richer provider usage — reset time, Codex resets + redeem, account type, Grok $ (PR #62) — nightly channel -->
| 2026-07-13 | — | — | — | 0.0.11-nightly.20260713.1 | — | <!-- desktop: multi-agent orchestration run engine + broadcast rework (PR #61) — nightly channel -->
| 2026-07-11 | — | — | — | 0.0.10-nightly.20260711.1 | — | <!-- desktop: Grok provider usage statistics (PR #60) — nightly channel -->
| 2026-07-11 | 0.0.5-alpha.20260711 | 0.0.5-alpha.20260711 | — | 0.0.9-alpha.20260711 | 0.0.5-alpha.20260711+20260711 | <!-- shared/bridge: interactive ACP question/approval workflows plus Zero and Grok; desktop: file workspace, smart sidebar, agent views and provider usage; mobile: Zero/Grok, question cards and clearer turn errors (PRs #56-#58) -->
| 2026-07-05 | — | — | — | 0.0.8-alpha.20260705 | — | <!-- desktop: tooltip system, project cards/icons/tabs, batch theme import, bulk add projects, worktree gating (PRs #47-#52) -->
| 2026-07-05 | — | — | — | 0.0.7-alpha.20260705 | — | <!-- desktop: update toast redesign with elevated card + release notes link (PR #53) -->
| 2026-07-04 | — | — | — | 0.0.6-alpha.20260704 | — | <!-- desktop: browser MCP server for agents (PR #50) -->
| 2026-07-03 | — | — | — | 0.0.5-alpha.20260703 | — | <!-- desktop-only hotfix: blank-screen (rune in plain .ts) -->
| 2026-07-03 | 0.0.4-alpha.20260703 | 0.0.4-alpha.20260703 | — | 0.0.4-alpha.20260703 | 0.0.4-alpha.20260703+20260703 |
| 2026-07-02 | 0.0.3-alpha.20260702 | 0.0.3-alpha.20260702 | — | 0.0.3-alpha.20260702 | 0.0.3-alpha.20260702+20260702 |
| 2026-06-28 | 0.0.2-alpha.20260628 | 0.0.2-alpha.20260628 | — | 0.0.2-alpha.20260628 | 0.0.2-alpha.20260628+20260629 |
| 2026-06-28 | — | — | — | — | 0.0.1-alpha.20260628+20260628 |
| 2026-06-27 | 0.0.1-alpha.20260627 | 0.0.1-alpha.20260627 | 0.0.1-alpha.20260627 | 0.0.1-alpha.20260627 | 0.0.1-alpha.20260627+20260627 |

> FOR-DEV: once the release pipeline is validated end-to-end, a final step in
> each release workflow can append/update the matching cell here automatically
> (commit the row back to `main`). Until then, add rows by hand at release time.
