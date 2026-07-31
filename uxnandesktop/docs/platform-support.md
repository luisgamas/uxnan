# Platform support matrix

![Windows](https://img.shields.io/badge/Windows_11_x64-smoke-brightgreen?style=for-the-badge&logo=windows&logoColor=white)
![macOS](https://img.shields.io/badge/macOS-builds-orange?style=for-the-badge&logo=apple&logoColor=white)
![Linux](https://img.shields.io/badge/Linux-builds-orange?style=for-the-badge&logo=linux&logoColor=black)

What each platform has actually demonstrated, with the evidence that
demonstrates it. **"Supported" is never used without a level, and a level is
never claimed without evidence.**

The source of truth is machine-readable:
[`../tests/platform-support.json`](../tests/platform-support.json) — every
platform×feature cell records a level, a date, a commit, the hardware and the
tester. This page is the human-readable view of that file, and the two cannot
drift apart quietly: [`../tests/platform-support.test.mjs`](../tests/platform-support.test.mjs)
runs in the required `npm test` gate and fails when a citation points at
nothing, a claimed run has no date/sha/hardware/tester, or this page disagrees
with the source about an announced level. The release workflow additionally runs
`node scripts/platform-support.mjs gate` before building installers, so a
release cannot announce a state that exceeds the recorded evidence.

## The levels

Escalating; each presumes the previous. These are the only six words the
project uses for platform state:

| Level | Meaning |
|---|---|
| `code-only` | Pure/unit tests exist; the OS-specific interaction has never executed on that platform. |
| `builds` | The platform artifact compiles green (and, where a CI runner exists, the automated suites pass on it). The feature has not been exercised as a running app there. |
| `smoke` | The app was installed/run on the platform and the flow was walked at least once, with the run recorded (date, sha, hardware, tester). |
| `validated` | The full suite/walkthrough passed and resources were measured (an approved baseline). |
| `signed` | Artifacts carry a valid OS code-signing identity. |
| `release-ready` | Install/upgrade/uninstall + rollback approved on real hardware, configuration preserved, no leftovers. |

A green CI build is **never** promoted to `smoke` — a build proves the artifact
compiles, not that anyone ran it. And evidence ages: when a platform's recorded
evidence no longer describes the current release line (a major dependency bump,
a rewritten subsystem, or evidence older than ~6 months), the claim is
**degraded** back to what current evidence supports, not defended.

## Summary (updated 2026-07-31)

| Platform | Minimum version | Announced level | Why not higher |
|---|---|---|---|
| `windows-x64` — Windows 11 x64 | Windows 10 + WebView2 Evergreen | `smoke` | `validated` blocked by: unscripted install/upgrade/uninstall cycle, wake-fidelity checked only by hand, R07/R08/R10 unmeasured. `signed` needs the paid Authenticode cert (`FOR-HUMAN.md`). |
| `macos-aarch64` — macOS Apple Silicon | macOS 11.0 | `builds` | Experimental ad-hoc-signed DMG; CI compiles + runs the full suites on `macos-14`, but the app has never been launched on real Apple hardware. |
| `macos-x64` — macOS Intel | macOS 11.0 | `builds` | Cross-compiled on an Apple Silicon runner; the x86_64 binary has never executed anywhere, not even its test suite. |
| `linux-x64` — Ubuntu LTS reference | WebKitGTK 4.1 distro (Ubuntu 22.04+) | `builds` | Full suites pass on `ubuntu-latest` and installers ship, but no human has installed or launched any of them; the E2E driver supports Linux and has never been run. |

WSL2 is a **repository environment inside Windows**, not a GUI platform — it
appears as the `wsl` feature row on `windows-x64` (currently `code-only`).

Per-platform release checklists are generated from the source, never
hand-kept:

```bash
node scripts/platform-support.mjs checklist            # all platforms
node scripts/platform-support.mjs checklist linux-x64  # one platform
node scripts/platform-support.mjs gate                 # what the release runs
```

## Feature × platform

The full per-cell evidence (date, sha, hardware, tester, gaps) lives in the
JSON; this table is the level at a glance.

| Feature | windows-x64 | macos-aarch64 | macos-x64 | linux-x64 |
|---|---|---|---|---|
| Clean first launch | `validated` | `builds` | `builds` | `builds` |
| Install / upgrade / uninstall | `smoke` | `builds` | `builds` | `builds` |
| Terminals, splits, keyboard | `validated` | `builds` | `builds` | `builds` |
| Sleep/wake + scrollback | `smoke` | `builds` | `builds` | `builds` |
| Git, worktrees, review | `validated` | `builds` | `builds` | `builds` |
| Agent launch + hooks | `smoke` | `builds` | `builds` | `builds` |
| Integrated browser + DevTools | `smoke` | `builds` | `builds` | `builds` |
| Pet companion (layer/overlay) | `smoke` | `builds` | `builds` | `builds` |
| Keep-awake | `smoke` | `code-only` | `code-only` | `code-only` |
| Automations + OS scheduler | `validated` | `code-only` | `code-only` | `code-only` |
| In-app updater | `smoke` | `builds` | `builds` | `builds` |
| Paths with spaces / non-ASCII | `code-only` | `code-only` | `code-only` | `code-only` |
| Shutdown with agents / persistence | `smoke` | `builds` | `builds` | `builds` |
| Resource footprint (R00–R11) | `validated` | `code-only` | `code-only` | `code-only` |
| WSL repositories | `code-only` | — | — | — |

Key Windows evidence anchors: the E2E suite (8 journeys, 24 tests) green
locally on 2026-07-30 (`docs/testing.md`); the approved resource baseline
(11 scenarios, `scripts/resources/baselines/windows/`, commit `54d935e8`,
2026-07-30); the maintainer's installed daily-driver build self-updating on
both channels each release. Key macOS/Linux evidence anchors: the
`ci-desktop.yml` verify legs (compile + full Rust/Vitest suites on
`ubuntu-latest` and `macos-14`) and the installers shipped in
`desktop-stable-v0.0.24` (2026-07-29, `039866bb`).

## Where CI ends and hardware begins

CI already gives every platform what a runner can give it:

- **Build + test per OS** — `verify-desktop.yml` compiles and runs the full
  Rust + Vitest suites on `{ubuntu-latest, windows-latest, macos-14}` for every
  PR (`ci-desktop.yml`), and `release-desktop.yml` bundles installers for all
  four targets on tags.
- **Smoke on a runner** — the E2E suite (`e2e-desktop.yml`) runs the real
  release binary on `windows-latest`, on demand and nightly. `tauri-driver`
  supports Linux (WebKitWebDriver) but the harness — driver fetch, preflight,
  teardown — is Windows-specific today and has never executed on Linux; wiring
  a Linux leg without being able to run it once would be exactly the
  speculative platform code this matrix exists to prevent, so it stays on the
  `linux-x64` checklist. `tauri-driver` does not support macOS at all.
- **Everything past that needs hardware** — the maintainer has Windows
  hardware only, which is precisely why macOS and Linux sit at `builds`: their
  remaining items (Gatekeeper walkthrough, LaunchAgent/systemd registration,
  keep-awake, self-update, resource collection) are recorded as per-platform
  checklists in the JSON, ready for whoever first holds the hardware.

## Negative scenarios

Where each hostile condition is handled, and what covers it:

| Scenario | Behavior | Coverage |
|---|---|---|
| Data dir not writable / obstructed | `PersistenceManager::save` returns an error instead of panicking; a relative `UXNAN_DATA_DIR` is refused and the platform default used | `src-tauri/src/persistence.rs` tests (save into a file-obstructed dir), `src-tauri/src/datadir.rs` tests |
| Corrupt/truncated state on disk | Load errors (or degrades) instead of panicking; 5 rotating backups retain the previous good copy | `src-tauri/src/persistence.rs` (corrupt-load test, backup ring), `src-tauri/tests/automations_store.rs` (truncated file) |
| Forced close during a write | Write-rename atomicity: the previous good copy survives an interrupted write | `src-tauri/src/persistence.rs` (no temp file left behind); design in the module header |
| Hook port occupied | Impossible by design: the hook server binds an ephemeral `127.0.0.1:0` port; if binding fails the app runs without precise hook reporting | `src-tauri/src/hooks.rs` (bind at :0; error path documented in `spawn`) |
| Missing agent CLI / `gh` / editor | Detection reports not-installed and the UI degrades (install state in Settings; GitHub view says it needs `gh`) | `src-tauri/src/which.rs`, `src-tauri/src/agentcli.rs`, `src-tauri/src/editors.rs` tests; fake-`gh` fixtures (`tests/fixtures/`) |
| Missing `caffeinate` / `systemd-inhibit` | Spawn failure is a silent no-op (keep-awake simply doesn't hold) | `src-tauri/src/power.rs` (spawn is `.ok()`); efficacy on the checklist — never executed on real macOS/Linux hardware |
| Scheduler unavailable / registration fails | `SchedulerStatus::Failed` carries the OS's own message; the automation stays runnable in-app (honest degradation) | `src-tauri/src/automations/oscheduler/mod.rs` tests (support probe, Failed serde); real-OS registration on the mac/linux checklists |
| Corrupt update manifest / bad signature | `tauri-plugin-updater` verifies the minisign signature against the bundled pubkey and refuses; the installed version keeps running (`docs/updates.md` → failure & rollback) | Plugin-owned verification; per-channel endpoints + stale-staged guard in `src-tauri/src/updater.rs`; a recorded hostile-artifact run is on the `windows-x64` checklist |
| Channel crossing (stable↔nightly) | The tag is the channel; CI rejects a release whose pre-release flag disagrees | `src/lib/desktop-release-tag.test.ts`, `.github/workflows/release-desktop-manifest.yml` |
| Monitor unplugged with the pet off-screen | A saved position not on any live monitor falls back to resting near the primary's bottom-right corner | `src-tauri/src/commands.rs` (pure placement helpers + tests) |
| Old / missing webview runtime | Windows: WebView2 Evergreen updates itself; Linux: WebKitGTK is a package dependency of the .deb/.rpm (AppImage assumes the host's); macOS: WKWebView ships with the OS (min 11.0) | Environment property — on each platform's checklist, not testable from code |
| Gatekeeper / SmartScreen | Documented, expected warnings while unsigned (`docs/install-macos.md`; SmartScreen on Windows) | Removed only by the paid certificates (`FOR-HUMAN.md`) |
| Notification permission denied | Notifications simply do not appear; no functional loss | On each platform's smoke checklist |

## OS-specific code inventory

The per-OS branches in the codebase, and what covers each. Anything marked
*checklist* is covered by a manual item in the JSON, not by an automated test —
adding OS-specific fixes without a reproduced failure is out of bounds, so
uncovered branches get evidence before they get changes.

### Backend (Rust)

| Area | Branches | Automated coverage | Uncovered → where tracked |
|---|---|---|---|
| `power.rs` (keep-awake) | Windows `SetThreadExecutionState`; macOS `caffeinate -i`; Linux `systemd-inhibit`; no-op elsewhere | Worker state machine (flip-on-change, auto-release cap, release-on-drop) unit-tested against a fake inhibitor; a host-OS test toggles the real inhibitor once on each CI runner | Real sleep prevention on macOS/Linux hardware → checklists |
| `wsl.rs` + `git.rs` WSL routing | UNC parse/translate (pure); `cfg!(windows)` routing through `wsl.exe -d`; case-insensitive path compare | Parse/round-trip fully tested (7 tests) | Live routing (`git.rs:133/851`) has no automated run → `wsl` feature row (`code-only`) + L5 checklist row 9 |
| `winproc.rs` | `CREATE_NO_WINDOW` on spawned commands (Windows) | Command identity test; the flag itself is opaque to assertions | Behavior visible only by eye (no flashing consoles) — daily use |
| `automations/oscheduler/` | Dispatch per OS; Task Scheduler XML; LaunchAgent plist; systemd user units | All three document builders fully unit-tested on every platform (hostile text included); support probe + `Failed` serde tested; Windows has an `#[ignore]`d round-trip against the real scheduler | Real registration on macOS (`launchctl`) and Linux (`systemctl --user`) never executed → checklists |
| `automations/store.rs` / `graph.rs` | Per-OS data dir bases; `cmd /C` vs `sh -c` for shell steps | Store integration suite (12 tests, incl. non-ASCII paths); graph logic (10 tests) | Shell-step branch runs only on its host OS |
| `updater.rs` | No OS branches in code; Windows `installMode: passive` + MSI numeric-version constraint in config | Per-channel endpoints tested; stale-staged guard code-reviewed; channel parsing tested (`desktop-release-tag`) | Signed round trip is L5 by nature → checklists |
| `editors.rs`, `fonts.rs`, `agentcli.rs`, `agent_hooks.rs`, `hooks.rs`, `browse.rs`, `zero.rs`, `codex_trust.rs`, `which.rs` | Home-dir/`PATHEXT`/`%VAR%` expansion, per-OS probe paths, `.cmd` vs `.sh` reporters, `chmod 0755/0600` on Unix, `WSLENV` injection, 8.3 short paths | Host-OS halves covered by their module suites (each runs on all three CI runners); Windows-gated cases in `editors.rs` | `fonts.rs` enumeration (3 per-OS impls) has no tests — output feeds a font picker, degrades to empty list; macOS-only branches execute on the `macos-14` leg only |
| `path_env.rs` (macOS Finder PATH) | macOS-only enrichment; no-op elsewhere | Merge/dedupe logic + the off-macOS no-op tested | The macOS ON-branch (login-shell probe) needs real hardware → mac checklist (agent/`gh` detection item) |
| `pty.rs`, `model.rs` | Default shell per OS (PowerShell / zsh / bash), profile seeds | Lifecycle + seed tests run per-OS on each runner | Interactive behavior per OS → smoke checklists |
| `main.rs`, `Cargo.toml`, `tauri.conf.json`, `capabilities/` | `windows_subsystem`, `windows-sys` deps, `macOSPrivateApi`, ad-hoc signing identity, bundle targets, per-window capabilities (no platform filters) | Config is exercised by every build; capabilities audit is a standing FOR-DEV item | — |

### Frontend (TS/Svelte)

| Area | Branches | Coverage |
|---|---|---|
| `platform.ts` | User-agent OS detection; the status-bar "untested platform" badge for macOS/Linux | Unit-tested (`platform.test.ts`) |
| `keybindings.ts`, `Terminal.svelte`, dialogs | `isMac` modifier mapping (⌘ vs Ctrl), chord rendering | Untested — behavior is visible on first keypress; verified as part of each platform's smoke checklist |
| `shell.ts`, `terminalTemplates.ts` | Per-shell quoting (PowerShell/cmd/POSIX), per-OS profile templates | Quoting fully tested; templates are data |
| `windowsJunctionGuard.ts` | Windows-only Redirection-Guard detection | Pure detector fully tested; the OS gate is a one-line guard |
| `pathid.ts` | Case-insensitive path identity (Windows semantics applied everywhere, deliberately) | Tested, including UNC/WSL spellings |

## Updating the matrix

1. Ran something on real hardware? Record it in
   `tests/platform-support.json` — level, ISO date, commit sha, hardware
   description, tester — and cite the artifact (a baseline file, a suite, a
   release) in `evidence`.
2. Keep this page's summary table in step (the test fails if they disagree).
3. Never raise `announced` past the weakest core feature cell — the gate
   refuses the release if you do.
4. When evidence stops describing the current code (rewrite, major bump, age),
   degrade the cell and say why in `gaps`.
5. Signing evidence (`signed` and above) additionally needs a `signing` block
   on the platform entry — certificates themselves live outside the repo, only
   their fingerprint/procedure references belong here (`FOR-HUMAN.md`).
