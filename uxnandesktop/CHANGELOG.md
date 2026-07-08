# Changelog — uxnan-desktop

All notable changes to the Uxnan Desktop ADE are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/). Versioning: [SemVer](https://semver.org/).

## [Unreleased]

### Fixed — reporters must be silent on the agent's side (no warnings / prompts)

- **Claude Code no longer warns on startup.** The pre-relay installer wrote a
  `hooks.__uxnan_managed_hooks__` marker that current Claude Code flags as an
  "Unknown hook event". Install/uninstall now sweep that legacy marker (and the
  legacy dedicated `uxnan-claude-hook.cjs` entries) so the config is clean and
  self-heals on the next launch.
- **OpenCode no longer rejects its config.** The installer wrote an invalid
  `plugins` key into `opencode.json` ("Unrecognized key: plugins"). OpenCode
  auto-discovers plugins from its `plugins/` directory, so we now **only** drop
  the plugin file there and **never touch `opencode.json`** — and repair a bad
  `plugins` key an earlier build may have written. The plugin exports a single
  named factory (loaded once).
- **Codex trust hardened.** The managed `hooks.json` entry now omits `timeout`
  (Codex applies its 600 s default), and the reproduced `trusted_hash` is folded
  at that default — the exact identity our golden vectors verify — to maximize
  the chance Codex auto-trusts the hook instead of prompting. (Unlike a
  tool that launches agents itself with a managed `CODEX_HOME`, the ADE writes
  trust into the user's real `~/.codex`; if a Codex version still prompts, accept
  once — Codex then records its own trust.)
- Legacy sweep: Codex install now also removes a prior node-relay Codex entry so
  the old and new reporters don't double-report.

### Changed — precise per-agent status hooks (Claude Code, Codex, Gemini CLI, OpenCode, Pi)

- **Reworked the Layer-1 reporters for shell-robust, out-of-the-box precise
  states** across every common shell (cmd, PowerShell, PowerShell 7, Git Bash,
  WSL, bash, zsh, fish). Each agent now uses the reporter that best sidesteps
  "which shell runs the hook":
  - **Claude Code** — a dependency-free Node relay invoked in **exec form**
    (`command:"node", args:[…]`), which bypasses the shell entirely (Claude *is*
    Node, so `node` is guaranteed). Merged **per-event** into
    `~/.claude/settings.json`, **preserving the user's existing hooks** (the old
    install replaced the whole `hooks` block). `done` now enriches its
    notification from the session transcript **server-side** (no dedicated Node
    hook script needed).
  - **Gemini CLI** — the same relay via `node "<relay>"`; correct turn events
    (`BeforeAgent`/`AfterAgent`/`BeforeTool`/`AfterTool`, previously wrong) and a
    **milliseconds** timeout. Emits `{}` on stdout (Gemini parses hook stdout).
  - **Codex** — a `curl` hook (`.sh`/`.cmd`; Codex is a Rust binary with no Node
    guarantee) **plus a reproduced `trusted_hash`** written to
    `~/.codex/config.toml` (`codex_trust.rs`). Codex 0.129+ gates hooks on this
    trust, so the previous `source_paths` approach never fired; the hash is
    pinned to known-good golden vectors.
  - **OpenCode** — the status plugin rewritten to OpenCode's real event API
    (async factory returning an `event` hook; re-labels the native bus).
  - **Pi / OMP** — a **new** in-process status extension installed into
    `~/.pi/agent/extensions/` (Pi has no JSON hook surface). Reports
    `working`/`done`.
- **Endpoint file for restart survival.** The hook server writes
  `endpoint.env` / `endpoint.cmd` (live url + token) on start and injects
  `UXNAN_ENDPOINT_FILE`; every reporter prefers it, so a terminal that outlived
  an app restart still reaches the live server instead of a dead port.
- **Shell reporters no longer build JSON.** The agent id / kind / state ride in
  HTTP headers (`X-Uxnan-Agent-Id` / `-Type` / `-Status`) and the raw event is
  forwarded as the body — removing a class of cross-shell quoting bugs. The hook
  server (`hooks.rs`) accepts three report shapes (JSON envelope, raw-body +
  headers, header-only direct status), caps the body at 1 MiB, and normalizes +
  reads the Claude transcript itself.
- **WSL (basic).** `WSLENV` now carries the `UXNAN_*` vars (with `/p`
  path-translation for the endpoint file) into WSL. Note: WSL2's `127.0.0.1`
  still targets the WSL VM, not the Windows host — a documented limitation.
- **Hardened terminal-title inference (Layer 2 fallback).** Word-boundary
  lookarounds stop a status keyword inside a path (`~/codex/ready`) or a longer
  word (`already` ⊃ `ready`) from minting a false state.
- **Fixed** the generic launcher wrapper dropping the `done` report (it `exec`'d
  the agent, so the exit report never ran) and clobbering across shells.
- **Settings → Agents → Hooks** now has a card per agent including **Pi**, with
  honest install/uninstall status per agent.
### Added — AI-provider usage statistics (Settings → Providers)

- **New Settings section "Providers"** to surface AI-provider usage: quota/rate
  windows (percent **consumed** + reset countdown), plan/account, and credit
  balance, for **only the providers the user activates** (nothing is polled
  otherwise, to save resources). Mirrors the Agents catalog pattern.
- **Native Rust reader** (`src-tauri/src/usage.rs`, commands `usage_read` /
  `usage_detect`) — reads each CLI's own stored token and calls the provider's
  **official usage API**. Wired providers: **Codex** (`~/.codex/auth.json` →
  chatgpt backend; monthly/weekly windows + credits + email), **Claude**
  (`~/.claude/.credentials.json` → `api.anthropic.com/api/oauth/usage`; parses
  the `limits[]` array — session/weekly + model-scoped windows — with ISO-8601
  reset parsing), **Copilot** (token from `gh auth token` → `api.github.com`;
  quota snapshots + GitHub login via `/user`), **Gemini** (`~/.gemini/oauth_creds.json`
  → cloudcode-pa; best-effort, no client-secret harvesting). Each provider
  degrades to a `status` (`ok`/`authRequired`/`notInstalled`/`error`) with a
  message, so a slow/broken provider never sinks the others. **Posture:** never
  browser cookies, never pasted API keys.
- **UI:** a coherent container with an "add provider" combobox (detects which
  CLIs are present) and a **tab per activated provider**; each tab shows its live
  windows (each bar labeled "% used" with a caption clarifying it's the consumed
  percent), credit, and **account identity** ("Authenticated as …" with a
  **click-to-reveal blur** on the email/login). Per-provider refresh interval and
  **status-bar visibility** options (which windows / plan / credit to surface)
  live inside each tab.
- **Status-bar indicator** — a gauge button + popover (next to the backend
  indicator) showing the chosen providers/windows; the primary %-bar is opted-in
  by default; tinted amber/red as usage nears the limit. Global refresh interval
  and a master on/off toggle in the section header.
- **Config:** `AppSettings.usageProviders` / `usageRefreshMinutes` /
  `usageStatusBarEnabled` (persisted). **Contract-first:** the wire shape mirrors
  the new `shared` `agent/usageStats` method so the bridge can serve the same
  payload to the phone later (Phase 6). Full EN/ES i18n. Tests: 7 Rust unit tests
  (`usage::tests`) + `usageFormat` frontend tests.