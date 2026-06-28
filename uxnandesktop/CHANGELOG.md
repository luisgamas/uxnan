# Changelog — uxnan-desktop

All notable changes to the Uxnan Desktop ADE are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/). Versioning: [SemVer](https://semver.org/).

## [Unreleased]

### Added — integrated developer browser
- **A lightweight in-app developer browser** to preview/debug the systems agents
  build and open the links agents produce — a new `browser` center tab (splittable
  beside terminals), **not** a general-purpose browser. Open one from the center
  "+" menu (*New browser tab*) or let a link route into it. Chrome: back / forward
  / reload / address bar / open-in-system-browser.
- **Rendered with a DOM `<iframe>`** (frontend `BrowserPane`): a real center tab
  that composes with the layout, can never freeze the app or paint over menus, and
  is very light (just another browsing context in the webview the ADE already
  runs). Ideal for `localhost` dev servers and most links; sites that refuse to be
  embedded (`X-Frame-Options` / `frame-ancestors`) render blank — the toolbar's
  *open in system browser* covers those. The `browser` tab is transient (never
  serialized).
- **One link-routing decision point** (`open_url` → `browser::route_url`): every
  link the ADE opens funnels through the user's policy — the in-app browser, the OS
  browser, or a per-link prompt — with the OS browser always available as a fallback
  (`open_external`).
- **`BrowserSettings` / `BrowserLinkPolicy`** in the persisted `AppSettings`
  (`enabled` · `linkPolicy` internal/external/ask · `allowAgents` · `terminalLinks`
  · `homepage`; all `#[serde(default)]` so older state loads unchanged) with a new
  **Settings → Browser** pane (EN/ES).
- **Agents open links in-app automatically.** When the browser is enabled and
  *allow agents* is on, each agent terminal gets `UXNAN_BROWSER_URL` +
  `UXNAN_BROWSER_TOKEN` and a `$BROWSER` shim (`static/hooks/uxnan-browser.{sh,cmd}`,
  written alongside the hook scripts). A URL the agent opens is POSTed to the hook
  server's new **`/browser`** route, which applies the same link policy. Agents can
  also open one explicitly: `curl -X POST "$UXNAN_BROWSER_URL" -H "X-Uxnan-Token:
  $UXNAN_BROWSER_TOKEN" -d '{"url":"…"}'`.
- **Clickable terminal links** (`@xterm/addon-web-links`): **Ctrl/Cmd-click** a URL
  printed in the terminal to open it through the link policy (a plain click is just
  text, like VS Code). Toggle in Settings → Browser.

## [0.0.1-alpha.20260627] - 2026-06-27

### Added — in-app auto-updater (Settings → Updates)
- **The ADE now checks GitHub Releases for a newer version, downloads it in the
  background and installs it on your terms** — built on `tauri-plugin-updater`.
  A slim, dismissible banner under the title bar announces an available version,
  shows download progress, and offers the install choices.
- **Download and install are separate, deliberate steps.** Downloading is
  non-disruptive and runs in the background; *installing restarts the app, which
  stops every running agent* (each agent is a PTY child of the app — a restart
  can't keep it alive). So the install is guarded: when an agent is working the
  banner offers **Install when idle** (auto-installs the moment all agents go
  quiet), **Install now** (with a clear "an agent is running" warning), or
  dismiss for later. Before installing, the backend closes terminals cleanly
  (same path as app exit) so nothing is killed mid-write.
- **Update channels: stable · nightly** (default *stable*), mapped to GitHub's
  **`prerelease` flag** — a normal Release feeds *stable*, a Release marked
  pre-release feeds *nightly* — **not** the tag. So a `…-alpha.YYYYMMDD` tag still
  ships to stable as long as the Release isn't flagged pre-release. The updater
  polls a rolling per-channel manifest
  (`…/releases/download/desktop-updater-<channel>/latest.json`). Version
  *comparison* uses the numeric base (`0.0.5`) the MSI bundles, so bump that base
  per release; the pre-release suffix is display-only.
- **Settings → Updates** pane: current version (the **full** release name via the
  new `app_version` command, e.g. `0.0.5-alpha.20260628`, not just the MSI base) +
  manual "Check now", release channel, check-automatically and
  download-automatically toggles (both on by default), and an install policy
  (*Ask me* / *Automatically when agents are idle* / *Only when I trigger it*;
  default *Ask me*). Full EN/ES i18n.
- **Backend** (`src-tauri/src/updater.rs`): `updater_check`, `updater_download`
  (stages the signed installer in memory, emits `updater:download-progress` +
  `updater:downloaded`), `updater_staged`, `updater_install` and `app_version`
  (full display version) commands; a per-channel `endpoint_for`; `UpdaterSettings`
  / `UpdateChannel` (stable/nightly) / `InstallPolicy` added to the persisted
  `AppSettings` (all defaulted, so older state loads unchanged). Signature
  verification uses a free minisign `pubkey` in `tauri.conf.json` (unrelated to OS
  code-signing).
- **Release CI**: `release-desktop.yml` now signs the updater artifacts when the
  `TAURI_SIGNING_PRIVATE_KEY` (+ password) secrets are present and injects the
  full release name as the `UXNAN_VERSION` build env (for `app_version`); a new
  `release-desktop-manifest.yml` reads the published release's `prerelease` flag
  and copies its `latest.json` onto the rolling stable/nightly release the updater
  polls. Both degrade cleanly until the signing key + a published, signed release
  exist (see [`docs/updates.md`](docs/updates.md) and `FOR-HUMAN.md`).
- **Tests**: +2 Rust (`updater.rs` per-channel endpoints) and +6 Vitest
  (`updaterLogic.test.ts` — progress fraction + install-policy decision), for
  **100 Rust + 25 Vitest**.

### Fixed — history log CLI fallback order
- The `git log` CLI fallback now uses `--date-order` (was `--topo-order`) so it
  matches the primary git2 path (`Sort::TOPOLOGICAL | TIME`). The fast path was
  already correct, so this only affects repos `git2` can't open. `src-tauri/src/git.rs`.

### Changed — history branch graph: VS Code swimlane curves
- **The History graph now uses the VS Code swimlane model + true arc
  connectors.** Lanes *compact* — when a branch merges, the extra lanes waiting
  for the commit collapse into the node and the lanes to their right shift one
  column left — so the graph narrows with flowing curves instead of leaving
  parallel gaps. Connectors are real circular arcs: a quarter-circle (radius ≈
  one lane) into/out of a node, and a gentle S when a passing lane shifts
  column — replacing the previous stable-lane layout and tiny rounded-step
  "L" connectors. Node dots are unchanged (solid dot, with a separate outer
  ring on merges). `src/lib/gitGraph.ts` (swimlane layout → per-row `GraphEdge`
  list) + `src/lib/components/HistoryPanel.svelte` (arc path geometry).

### Changed — file tree: dim git-ignored entries
- **The Files tab now dims git-ignored entries (muted + italic),** so files and
  folders git ignores (`node_modules`, `build`, `.env`, …) read as clearly apart
  from tracked/untracked ones — matching the convention an IDE file tree uses and
  the mobile app's file browser. The git *change* colours (untracked green,
  deleted red, modified/staged amber) are unchanged; "ignored" is a distinct
  concept layered on top, and it wins over a change colour (an ignored entry
  never has a git change anyway).
- **Backend (`fs.rs` + `gitfast.rs`).** `FsEntry` gained an `ignored: bool`;
  `list_dir` fills it per-listing via the new `gitfast::ignored_flags` (git2
  `is_path_ignored`, run on the blocking pool, best-effort so a non-repo
  directory just leaves every entry un-flagged). Mirrors `git check-ignore`:
  tracked files matching a rule are not flagged. Because the check is per-listing,
  an ignored directory's children are each flagged when it's expanded — no
  frontend ancestor-propagation needed. `git status` / the Changes panel are
  untouched (ignored entries never appear there).
- **Frontend** (`FileTreePanel.svelte`, `types.ts` `FsEntry.ignored`): ignored
  rows render muted + italic. Tests: +2 Rust (`gitfast`: `ignored_flags` matches a
  `.gitignore` for files + dirs; all-false outside a repo) → **98** backend tests.

### Added — git: visual image diffs
- **Image files now diff visually (before/after) instead of as binary text.**
  Opening the diff of a `.png`/`.jpg`/`.jpeg`/`.gif`/`.webp`/`.bmp`/`.ico`/
  `.svg`/`.avif`/`.tif(f)` change shows the two versions side by side on a
  checkerboard backing, with an "Added (new file)" / "Removed" placeholder for a
  one-sided change. New backend `git::image_diff` + `git_image_diff` command
  (base64-encoded blobs via the new `base64` dep; `HEAD`→index for the staged
  view, index→working-tree otherwise; routes through `wsl.exe` for WSL repos) and
  `image_mime`. Frontend: `isImagePath` (`src/lib/diff.ts`), `DiffViewerState`
  loads the image versions, and the new `ImageDiffView.svelte` renders them
  (DiffPane picks it for image files). 3 new backend tests + EN/ES strings.

### Added — git: optional AI commit-message generation
- **Draft commit messages from the staged diff with a local agent (opt-in).** A
  new **Settings → AI commit** section turns it on and keeps it
  non-technical: pick an **agent** (only the installed ones of Claude Code,
  Codex, Gemini, OpenCode, Pi are selectable) and a **model** from a
  **searchable shadcn-svelte Combobox** (`AiModelPicker.svelte`, Popover +
  Command — added the `command` + `input-group` ui primitives) with a fixed-width
  trigger, so the hundreds of models OpenCode/Pi can report stay filterable
  instead of overflowing: "Default" plus a live `opencode models` /
  `pi --list-models` / `codex app-server` `model/list`
  query, or Claude's exact concrete versions (`claude-opus-4-8`, …, maintained in
  `agentcli.rs::CLAUDE_MODELS` with a how-to-update guide) / Gemini's curated
  set, the message **language** (Automatic / English / Spanish), **Conventional
  Commits** subject on/off, **extended body** on/off, and free-form **extra
  instructions** — no command/flags to configure. When enabled, a **Generate**
  button appears in the commit composer; it runs the agent non-interactively (a
  one-shot subprocess — *not* a PTY — with stdin closed, a 120 s timeout and
  `kill_on_drop`; no provider API/SDK/keys, just the local CLI), feeds it the
  staged diff (capped at 24 KB) and fills the summary + body. New backend
  `src-tauri/src/agentcli.rs` (resolves each CLI the way the bridge does —
  `node <entry.js>` for npm installs, native binary otherwise, so the
  non-interactive run works on Windows) + `src-tauri/src/aicommit.rs` +
  `git_generate_commit_message` / `ai_commit_agents` / `ai_commit_models`
  commands + `git::staged_diff`; `which::resolve`; new `AiCommitSettings`
  (agent + model) on `AppSettings` (off by default, back-compat defaulted);
  `AppError::Agent` variant. Frontend: the settings section (agent + model
  pickers), the composer button (`git.generateMessage`), `aiCommitPresets.ts`
  (supported-agents list), and EN/ES strings. 14 new backend tests (CLI
  resolution / arg building / model-list parsing + prompt building / diff
  truncation / output sanitizing + settings round-trip).

### Added — git: WSL repos run through `wsl.exe`
- **Repos opened from a WSL distro now use the distro's own git.** When a repo
  path is a WSL UNC path (`\\wsl.localhost\<distro>\…` or the legacy `\\wsl$\…`,
  in either slash form), the git layer routes every command through
  `wsl.exe -d <distro> git -C <linux-path> …` instead of running the Windows
  `git.exe` against the slow 9P share (which can also disagree with Linux git on
  line endings / file modes / hooks). The new `src-tauri/src/wsl.rs` parses the
  UNC path, `git::git_command` builds the routed invocation (translating any
  WSL-path argument, e.g. a worktree path, to its Linux form), `worktree_list`
  translates the Linux paths git reports back to the registered UNC form so
  per-worktree workspace keys line up, and the `git2` fast path is skipped for
  WSL repos (libgit2 can't see them the way the in-distro git does). Windows-only
  routing; a no-op elsewhere. 8 new unit tests (`wsl` parse/round-trip +
  `worktree_path_for` under a WSL prefix).

### Added — git: squash-merged branch cleanup on worktree removal
- **Removing a worktree now cleans up a squash-merged branch.** After the safe
  `git branch -d` (which only deletes truly merged work), the backend now detects
  **patch-equivalence** for a squash merge — it synthesizes a dangling commit
  with the branch's tree on top of `merge-base(base, branch)` and asks
  `git cherry` whether the base already contains an equivalent patch — and, when
  confirmed, force-deletes the branch (`-D`); otherwise the branch is **kept** so
  no work is ever lost (`src-tauri/src/git.rs` `is_squash_merged` +
  `RemoveOutcome`; 2 new integration tests). `worktree_remove` now returns a
  `RemoveOutcome` (`branchDeleted` / `branchPreserved` / `squashMerged`), and the
  removal toast reflects what happened to the branch
  (`src/lib/state/projects.svelte.ts`, new `toast.worktreeRemoved*` strings).

### Changed — git & worktrees follow-ups
- **Commit composer fields use shadcn components.** The commit **summary** and
  **extended description** are now `shadcn-svelte` `Textarea`s, and each
  co-author row is a `shadcn-svelte` `Input`, replacing the hand-rolled
  `<textarea>`/`<input>` markup so the composer inherits the design-system
  focus ring, sizing and dark-mode tokens like the rest of the UI
  (`src/lib/components/ChangesPanel.svelte`).

### Added — agents: multi-agent orchestration, per-agent env vars, configurable launch shell
- **Multi-agent orchestration console (spec `02d` §3).** A new modal — opened
  from the status bar once **≥2 agents** are running — lists every live agent
  grouped by type and routes a message to them: to **all** agents, to **one type
  (fan-out)** (e.g. every `claude`), or to the **coordinator's workers**. Mark
  any agent as the **coordinator** (the in-memory task-graph root) to unlock the
  workers target. Delivery is **backpressured** — each agent receives its next
  queued message only once it reports free again (precise hook state when
  available, else coarse output activity), so a slow worker is never flooded.
  Per-agent queue depth, status dots and a "go to terminal" jump are shown
  inline. Pure routing/queue logic in `src/lib/orchestration.ts` (unit-tested);
  reactive store (live agents, backpressure timers, PTY delivery) in
  `src/lib/state/orchestration.svelte.ts`; UI in `OrchestrationConsole.svelte`.
- **Per-agent environment variables.** Each agent profile can now carry `env`
  vars (e.g. `ANTHROPIC_MODEL=…`, a proxy/host override), edited as key/value
  rows in **Settings → Agents**. They're set on the agent's shell at launch
  (inherited by the agent process); the ADE's own `UXNAN_*` hook vars always win
  on a key clash. New `EnvVar` model + `env` field on `AgentProfile` (Rust + TS),
  threaded through `launchAgent` → `pty_create` (new `env` param).
- **Configurable agent launch shell — Command Prompt by default on Windows.**
  Agents that don't pin their own shell now launch in a configurable default
  (**Settings → Agents → "Agent launch shell"**). The smart default is
  **`cmd.exe` on Windows** (agent CLIs start faster and quote more predictably
  than under PowerShell), else the default terminal profile. New
  `agentShellProfileId` setting + `app.agentShellProfile()` resolver.
- **Shell-aware argument quoting.** The agent launch command line is now quoted
  for the syntax of the shell it lands in (PowerShell / cmd / POSIX), so agent
  args with spaces or special characters (paths, `-p "a prompt"`) survive instead
  of breaking. New pure `src/lib/shell.ts` (`shellKind`, `quoteArg`,
  `buildRunCommand`), unit-tested, replacing the previous whitespace-only quoter.
- **Verified: agent auto-launch on worktree create.** The create-worktree flow
  already auto-launches the chosen agent (global default pre-selected, override
  or "None" per worktree); it now also benefits from the configurable launch
  shell. Removed from `FOR-DEV.md`.
- **End-user docs.** New [`docs/orchestration.md`](docs/orchestration.md) (what
  it is, where to find it, how to activate it, routing, the coordinator/worker
  graph, backpressure, caveats) and
  [`docs/agent-launch.md`](docs/agent-launch.md) (registering agents, per-agent
  env vars, the launch shell, auto-launch, quoting), both linked from the README
  Docs list and cross-linked with `docs/agent-hooks.md`.

### Added — frontend unit tests (Vitest)
- First **frontend test harness**: Vitest (`npm test`) with unit tests for the
  pure agent-launch and orchestration logic (`shell.test.ts`,
  `orchestration.test.ts` — 19 tests). Minimal `vitest.config.ts` (node env,
  `$lib` alias); no component tests yet.

### Added — terminal: tab reorder/MRU, backend ring buffer, CSI-u keyboard protocol
- **Tab reorder + drag between regions.** Tab chips can be dragged: drop one
  elsewhere in its strip to reorder it, or onto another region's strip to move
  it there (an insertion marker shows where it'll land, a label follows the
  pointer, and a region emptied by a move collapses). Implemented with **pointer
  events** (`pointerdown`/`move`/`up` + `elementFromPoint` hit-testing, like the
  split dividers) — **not** HTML5 drag-and-drop, which Tauri's native OS
  drag-drop (the file-drop-into-terminal feature) suppresses inside the WebView,
  so dragging didn't work at all. New `terminals.moveTab()` + the handlers in
  `TerminalArea.svelte`. Reordering within a region never remounts xterm;
  crossing regions remounts the pane, which transparently restores from the new
  backend snapshot (below). `src/lib/state/terminals.svelte.ts`.
- **MRU tab cycling + split focus, as configurable shortcuts.** `Ctrl+Tab` /
  `Ctrl+Shift+Tab` cycle the active region's tabs in most-recently-used order (a
  frozen order while you keep pressing; the landed tab becomes most-recent once
  the cycle settles), and `Ctrl+Alt+→` / `Ctrl+Alt+←` move focus between split
  regions. Both are **rebindable in Settings → Keyboard shortcuts** (new
  "Terminal tabs & splits" group: `cycleTabNext/Prev`, `focusSplitNext/Prev`),
  dispatched by the global handler and, while a terminal is focused, by
  `Terminal.svelte` via `matchAction` so they never reach the PTY.
  `terminals.cycleTab()` / `focusSplit()` + the per-tab MRU list in the store.
- **`Close tab` (Ctrl/⌘+W) now closes any tab — including a terminal —** with
  the usual save/discard/cancel prompt for an unsaved file (it previously only
  closed file/diff tabs and left Ctrl+W to the shell). Rebindable like the rest;
  rebinding it away restores the shell's `Ctrl+W` (delete-word).
- **Backend hidden-tab ring buffer.** Each PTY now keeps a bounded (256 KiB)
  ring of its most recent output in Rust (`OutputBuffer` in `pty.rs`), marked
  *stale* once it overflows. New `pty_snapshot` command returns it, and
  `pty_create` now reports whether the session was freshly spawned (`created`).
  A pane whose xterm is recreated (e.g. a tab dragged to another region) replays
  the snapshot so its scrollback isn't lost (`Terminal.svelte`). Supersedes the
  client-only `scrollback: 5000` reliance for the remount case.
- **Modern keyboard protocol (Kitty / CSI-u).** New `keyboardProtocol.ts`
  implements the terminal half of the progressive keyboard-enhancement protocol
  (flag stack, query/push/pop/set negotiation via `registerCsiHandler`, and a
  validated `CSI <code> ; <mods> [: <event>] u` encoder). It is **dormant until
  an app enables it**, so existing key handling is unchanged; when active it
  disambiguates `Ctrl+I`/Tab, `Esc`, modified specials and `Ctrl`/`Alt`+letter
  combos, and supports report-event-types / report-all-keys. Functional/nav keys
  fall through to xterm's legacy encoding (see `FOR-DEV.md`).
- **Alt-screen wheel scrolling** is provided by xterm.js (wheel → arrow keys in
  the alternate buffer); verified, no override added that would defeat it.
- **Tests:** +4 Rust unit tests for the ring buffer (now **69** backend tests);
  the CSI-u encoder was validated against known Kitty values during development.
- **Spec/docs:** `architecture/02b-terminal-engine.md` (PTY buffer §2, tab/MRU,
  keyboard protocol), `README.md` (test count), `FOR-DEV.md` (items removed),
  `keybindings.ts` + en/es shortcut strings (new "Terminal tabs & splits" group).

### Changed — history branch graph looks like VS Code
- **Branch-stable lane colors.** The history graph colored lanes by *column
  index*, so two unrelated branches that happened to share a column looked like
  the same branch. Each lane now carries a color id assigned when it's born and
  kept for its whole life (a reused lane gets a fresh one), so a branch keeps
  its color even as it shifts columns — matching VS Code. `src/lib/gitGraph.ts`.
- **Rounded-step connectors + ringed merge nodes.** Branch/merge edges are now
  drawn as VS Code-style rounded steps (vertical → quarter-arc → horizontal)
  instead of straight diagonals, and merge commits render as a solid dot with a
  separate outer ring. `src/lib/components/HistoryPanel.svelte`.
- The log itself was already correct (git2 `Sort::TOPOLOGICAL | TIME` / CLI
  `--topo-order`, offset paging, no merge-shortstat parsing) — only the graph's
  visuals changed. Docs: `architecture/02c-git-worktrees.md` §6.4.

### Changed — agent notifications: precise, hook-driven, enriched
- **No more "agent is idle" notifications.** The coarse output-activity inference
  no longer raises any notification or unread badge — it only drives the visual
  "working" dot (`agentMonitor.svelte.ts`). It used to fire ~12 s after an agent
  fell quiet, even when no task had run (just leaving an agent at its prompt).
- **Notifications now come from the precise hook layer** (`agentStatus.svelte.ts`)
  on meaningful transitions — `done` / `waiting` / `blocked` (never `working`):
  app in background → native OS notification; app focused → in-app toast; already
  looking at that terminal → nothing. Each non-`working` result also flags the
  worktree unread.
- **Enriched completion notifications.** The Claude Stop hook now reads the
  session transcript and sends the task (last user prompt) + a short **response
  preview** (`summary`, new field threaded through the hook payload → report →
  cache → `agent:status-changed` event). The `done` notification reads
  "{agent} finished the task" with the preview (or the task) as the body.
- **Spec/docs:** `architecture/02d-agent-monitoring.md` §1/§2.1 (payload `summary`,
  notification behavior), `docs/agent-hooks.md` (payload table).

### Changed — window chrome relocation: status bar + sidebar
- **Settings entry moved to the projects sidebar** (a full-width outline button
  with a Kbd shortcut hint, under the search button) and removed from the title
  bar. Closing still uses the Settings view's own back button.
- **Status bar reorganized.** The active-workspace **breadcrumb** (repo / branch)
  moved out of the center terminal strip to the **left** of the status bar
  (shared `projects.activeContext`). The **show/hide panel toggles** (left & right)
  now live at the **right** of the status bar and are selectable — the primary
  tint (`surface.tab`) shows when a panel is visible, mirroring the right-panel
  tabs. The left toggle left the title bar and the right toggle left the terminal
  strip.
- **Backend indicator is now an icon + popover** (`BackendStatus.svelte`, new
  shadcn `popover`). The color tracks the connection (green/amber/red) and the
  popover surfaces live detail (state, error, project count). The flat
  "N repositories" status-bar text was removed (the count lives in the popover).

### Changed — sidebar search palette, shortcuts & command-dialog polish
- **Sidebar search is now a full-width button** (`LeftSidebar.svelte`) that opens
  the command palette, with a `Kbd` shortcut hint (Ctrl/⌘+P). Removed the
  separate quick-switch (Zap) button — the search button is the single entry
  point. New reusable `Kbd.svelte` keycap for surfacing shortcuts on big actions.
- **Add-project keyboard shortcut** (`addProject`, default Ctrl/⌘+O, rebindable
  in Settings → Keyboard shortcuts). The directory picker is now mounted at the
  page root and opened via shared `projects.pickerOpen`, so the shortcut works
  even when the sidebar is collapsed.
- **Coherent command dialogs.** The quick-switch palette and the add-project
  picker share a navigation hint bar (`DialogHints.svelte`: ↑↓ navigate · ↵
  select · Esc exit). The palette gained an accessible `Dialog.Title`/
  `Description` (was missing), and the picker now supports ↑/↓ + Enter keyboard
  navigation over its folder list.
- **Spanish (MX) copy fixes.** Replaced "Saltar a un worktree" with "Buscar un
  proyecto o worktree"; reworded the palette/shortcut strings accordingly.
- **Settings → Keyboard shortcuts is grouped into sections** (General · Projects
  & navigation · Panels · Editor) instead of one flat unordered list, so a
  shortcut is easy to locate (`KeyAction.category` + `SHORTCUT_GROUPS`).

### Changed — left/right panel polish + any-folder projects + window state
- **Right-panel tabs (Files | Changes | History)** now show a clear, primary-
  tinted **active indicator** matching the left panel's selected card (shared
  `surface` design token in `design.ts`), instead of the easy-to-miss underline.
- **Selection language unified.** Project/worktree cards and the active tab use
  `surface.active` (`bg-primary/15` + primary ring); the selected **agent row**
  uses the lighter `surface.activeNested` (`bg-primary/10`) so it always reads as
  subordinate to its parent card (`ProjectCard`/`WorktreeRow`/`AgentSpace`).
- **Hooks indicator moved.** Removed the per-terminal-tab "install hooks" hint
  (`TerminalArea.svelte`). A single indicator now lives in the **status bar,
  bottom-right** (next to the repo count) and only appears when hooks actually
  need attention — not installed, unreadable, or the OS refused them. Backed by
  new `app` hook-health state (`hookInstall`/`claudeHooks`/`hooksNeedAttention`,
  refreshed on startup and after a Settings → Hooks toggle). Claude + generic
  hook scripts still auto-install on startup (`auto_install_hooks` default on).
- **Any folder is now a project.** `repo_add` accepts any directory (git or not)
  instead of rejecting non-git folders; `RepoData.is_git` records which. Non-git
  folders synthesize a single main worktree (`git::list_worktrees`), and
  `git_status`/`worktree_status` return empty/default for them (no error toast).
  The picker can add any folder; non-git project cards hide the worktree
  affordances and use a plain folder icon (`DirectoryPicker`/`ProjectCard`).
- **Window size remembered.** Added `tauri-plugin-window-state` so the window
  reopens at the last size/position/maximized state; bumped the first-run default
  to 1480×920 (`tauri.conf.json`).

### Added — filesystem watcher: file tree auto-refresh
- **Backend watcher** (`src-tauri/src/fswatch.rs`, `notify` +
  `notify-debouncer-full`): watches the active worktree root recursively
  (debounced ~300 ms, `.git` filtered) and emits a `fs:changed` event. New
  `fs_set_watch(path?)` command + `FsWatcher` in `AppState`; the watch is aimed
  at the active worktree centrally in `+page.svelte`.
- **File tree** reloads only the affected (already-loaded) directories on
  `fs:changed`, preserving expansion — files created/deleted on disk (e.g. by an
  agent) now appear without a manual refresh (`fileTree.svelte.ts`). Unit tests
  for the `.git` path filter. Closes the FOR-DEV "External-change watcher" item.

### Added — unified center tabs (terminal | file | diff) + mixed splits
- The center area's `GroupTab` is now a discriminated union
  (`terminal | file | diff`, `terminals.svelte.ts`); files and diffs are real
  tabs in the same region tree instead of full-size singleton overlays, enabling
  any mix of agents/files/diffs across tabs and **mixed splits** (e.g. terminal
  left, editor right). Realizes the already-documented mixed-content tab design
  (`architecture/02b-terminal-engine.md` §3.1/§3.3).
- Per-tab editor/diff live state lives in an id-keyed registry
  (`FileEditorState` in `files.svelte.ts`, self-contained `DiffViewerState` in
  `git.svelte.ts`) kept out of the serialized tree, so CodeMirror/xterm never
  remount on split/reorder and typing doesn't churn the persisted layout. File
  tabs are restored on startup (by path); diff tabs are transient.
- `DiffPanel.svelte` removed (overlay) → new `DiffPane.svelte`; `+page.svelte`
  no longer overlays the editor/diff; `Ctrl/Cmd+W` closes the active center tab.

### Added — unsaved-edit guard + external-change handling
- Closing a dirty file tab prompts **Save / Discard / Cancel**
  (`SaveDiscardDialog.svelte` + `confirm.svelte.ts` service); closing a region
  with several dirty files asks once. Every close path runs the guard and
  disposes per-tab state. Closes the FOR-DEV "Unsaved-edit guard" item.
- When an open file changes on disk while dirty, the editor offers **Reload /
  Keep my changes** (clean files reload silently; diffs reload). New EN/ES i18n
  keys.
- **Spec sync:** `architecture/02c-git-worktrees.md` §6 (file-tree watcher,
  editor-as-tab, unsaved-edit guard, external-change, `fs_set_watch`) and
  `architecture/02b-terminal-engine.md` §3.3 (editor/diff tabs implemented).

### Added — right-panel commit composer options + "History" tab with branch graph
- **Commit composer — optional fields (collapsed by default).** `ChangesPanel.svelte`
  now exposes an "Options" `Collapsible` under the summary box with: an **extended
  description** (commit body), one or more **`Co-authored-by:`** entries, an
  **amend last commit** toggle, and a **sign-off** (`Signed-off-by:`) toggle. The
  message is composed in the frontend (`git.svelte.ts → buildCommitMessage`):
  `subject` + blank line + body + blank line + `Co-authored-by:` trailers;
  sign-off is applied by git itself (`-s`) so it uses the configured identity.
- **New "History" tab** (`HistoryPanel.svelte`, third tab in `RightPanel.svelte`).
  Shows the active worktree's commit log (newest first), virtualized
  (`VirtualList`) and paginated ("Load more"), with per-commit ref badges
  (`HEAD`/branches/`tag:`), author and localized relative time. Filterable;
  empty/`not a repo`/`no commits` states handled. Clicking a commit opens its
  full diff as a center **tab** (`CommitPane.svelte`, read-only `DiffView`),
  backed by a self-contained `CommitViewerState` registered in the terminals
  store — consistent with how file/diff tabs now open.
- **Integrated branch graph.** A toggle in the History header draws a colored
  lane gutter (branches, merges, splits) left of each commit, computed purely on
  the frontend from each commit's parents (`gitGraph.ts → computeGraph`). The
  graph is shown only over the unfiltered log (a filter would break parent chains).
- **Backend (additive).** `git.rs`/`gitfast.rs`: new `CommitInfo`, `log(limit,
  skip)` (git2 revwalk + CLI fallback, topological order, unborn-HEAD tolerant)
  and `show(hash)` (first-parent diff; hex-validated). `commit()` gained `amend`
  and `sign_off` flags. New Tauri commands `git_log` / `git_show` and the extended
  `git_commit(amend, sign_off)`, registered in `lib.rs`. Unit tests cover
  `parse_log`/`parse_refs` and a real-repo `log`/`show`/pagination round-trip.
- **Spec + i18n updated.** `architecture/02c-git-worktrees.md` §3.5 (history/show
  commands) and §6 (the right panel is now three tabs + §6.4 History/graph). EN/ES
  strings added under `rightPanel.*` (composer) and a new `history.*` namespace.

### Changed — Tauri bundle id renamed `com.uxnan.desktop` → `dev.luisgamas.uxnandesktop`
- **`src-tauri/tauri.conf.json` `identifier` rewritten.** The Tauri 2 runtime
  derives its app-data directory from the bundle identifier, so the on-disk
  paths used by `app.path().app_data_dir()` change everywhere:
  - Windows: `%APPDATA%/dev.luisgamas.uxnandesktop/`
    (was `%APPDATA%/com.uxnan.desktop/`)
  - macOS: `~/Library/Application Support/dev.luisgamas.uxnandesktop/`
    (was `~/Library/Application Support/com.uxnan.desktop/`)
  - Linux: `~/.local/share/dev.luisgamas.uxnandesktop/`
    (was `~/.local/share/com.uxnan.desktop/`)
- **Spec updated.** `uxnandesktop/architecture/03-implementation-guide.md`
  §"Directorio de Datos de la Aplicacion", `uxnandesktop/docs/build.md` bundle
  identity note, and `uxnandesktop/docs/agent-hooks.md` per-OS hook-installer
  paths all reflect the new id. The Rust code paths are unaffected
  (`app.path().app_data_dir()` is the only thing the app uses, and it follows
  the new identifier automatically).
- **Visible product name unchanged.** `tauri.conf.json` `productName` stays
  `Uxnan Desktop` and the window title stays `Uxnan Desktop`.
- **No user data migration is included.** A pre-existing `com.uxnan.desktop`
  data directory (state JSON + backups + installed Claude hook scripts) is
  not migrated; the next launch starts fresh under the new directory. The
  `FOR-DEV.md` row that mentioned `com.uxnan.desktop` was kept untouched as
  a historical snapshot.

### Changed — brand icon, theme variants & startup splash
- **Refreshed brand mark + new dark variant.** `static/logo.svg` (black
  mark on a white, rounded surface) and `static/logo_nb.svg` (black
  stroke, light surfaces) were updated, and `static/logo_wnb.svg` (white
  stroke, dark surfaces) added. `static/favicon.png` and the whole
  `src-tauri/icons/*` set were regenerated from `logo.svg` (rounded,
  transparent corners — the Windows/menu icon keeps the PNG alpha).
- **In-app marks swap by theme instead of inverting.** `TitleBar.svelte`
  and the empty-terminal placeholder in `TerminalArea.svelte` now render
  `logo_nb` on light themes and `logo_wnb` on dark themes (toggled by the
  `.dark` class) rather than applying a `dark:invert` filter to a single
  black mark.
- **Startup splash.** A brand splash is painted by `app.html` the instant
  the webview loads — before SvelteKit hydrates — so the previously blank
  startup window now shows the animated mark (70% → 100% scale while
  untwisting a half-turn). It is theme-aware via `prefers-color-scheme`
  and dismissed on first paint by `+layout.svelte`
  (`window.__uxnanSplashDone`), with a 4 s fallback.

### Added — brand mark across every desktop surface
- **Brand assets**: `static/logo.svg` (with white bg, splash fallback) +
  `static/logo_nb.svg` (no bg, the brand mark used in-app and in the
  Tauri icon set); `static/favicon.png` regenerated from the SVG
  (256×256). `src-tauri/icons/*` regenerated from the same source:
  `32x32 / 128x128 / 128x128@2x / Square* / StoreLogo / icon.png /
  icon.ico (16/24/32/48/64/128/256) / icon.icns (16/32/64/128/256/512)`.
- **Title bar brand mark** (`TitleBar.svelte`): the brand mark now
  sits to the left of the "Uxnan Desktop" label, inside the existing
  drag region (so it doesn't break window-dragging). Theme-aware via
  Tailwind's `dark:invert` filter — no second SVG variant. The ALPHA
  pill is unchanged.
- **Empty terminal state** (`TerminalArea.svelte`): when an active
  workspace has no terminals, the centered placeholder is now the
  brand mark (`size-24`, `dark:invert`) and the single "+ New
  terminal" button becomes **two actions**:
  - **New terminal** — always available (unchanged).
  - **New worktree here** — enabled when the active workspace is
    inside a registered repo's context (resolved from
    `terminals.activeWorkspace`); opens `NewWorktreeDialog` pre-pointed
    at that repo. In the Global workspace the button is disabled with
    a tooltip ("Pick a project or worktree in the left panel to enable
    this.").

### Added — agent state toasts + auto-installed hooks
- **Agent state toasts**: when an agent's hook reports a meaningful transition,
  a toast fires — **done** (success), **blocked** (warning), **waiting** (info),
  named by the agent. `working` is skipped (too noisy). Gated by the existing
  **Settings → Agents → Idle notifications** toggle. (`agentStatus.svelte.ts`.)
- **Auto-installed Claude Code hooks**: the ADE-managed `hooks` block is merged
  into `~/.claude/settings.json` on startup by default (idempotent; self-heals a
  moved script path), so precise states work out of the box. **Settings → Agents
  → Hooks** now has an **Install agent hooks** switch: turning it off removes the
  block and stops re-installing it next launch (`AppSettings.autoInstallHooks`,
  honored in `lib.rs` setup). Docs: `docs/agent-hooks.md`.

### Fixed — agent launch command re-typed after visiting Settings
- Opening Settings used to unmount the whole three-panel body, so returning
  remounted every terminal — re-running each agent tab's launch command (e.g.
  `opencode` typed again into the already-running agent) and blanking xterm.
  Settings now **overlays** the still-mounted body (`+page.svelte`), and the
  launch command is guarded to be sent **once per terminal id** (`Terminal.svelte`).

### Added — in-app toasts (svelte-sonner)
- A `<Toaster/>` (shadcn-svelte `sonner`, themed from the active app theme) mounted
  in `+page.svelte`, with a `$lib/toast.ts` wrapper (`toast`, `toastError`).
- The inline dismissible **error banners** (left sidebar `projects.error`, right
  panel `git.error`) are replaced by non-blocking error toasts, plus **success
  toasts** for commit / push / pull / worktree-removed / project-removed.
  Dialog-scoped inline errors (new-/remove-worktree, directory picker) stay inline.

### Changed — git2 fast path for status/diff
- **`gitfast.rs`** (git2 / vendored libgit2): `status_files`, `worktree_status`,
  `diff_file`, `diff_head` and `numstat` now run through libgit2 (off the async
  runtime via `spawn_blocking`), avoiding a `git` subprocess on every 3 s status
  poll and per diff. Each keeps a **CLI fallback** in `git.rs` (spec `02c` §3.1:
  git2 + CLI fallback); worktree management, branch listing, staging, commit,
  push/pull and patch-apply stay on the git CLI. 2 git2 integration tests.

### Changed — pointer cursor on interactive elements
- Buttons and other clickable controls (roles: button / menuitem / tab / option /
  switch / …, links, `summary`, associated labels) now show the hand cursor;
  disabled controls show `not-allowed`. A global base rule in `app.css` (native
  buttons otherwise default to the arrow cursor).

### Added — separate terminal theme per light/dark app theme
- A **switch** in the Terminal themes section: off (default) keeps the single
  grid (Inherit + presets, click to select). On splits the presets into two
  subsections — **for the dark app theme** (top) and **for the light app theme**
  (bottom) — and you pick one terminal theme in each; it applies by the resolved
  app-theme base. (`AppSettings.terminalThemeMode` + `terminalThemeLightId` /
  `terminalThemeDarkId`; `resolveActiveTerminalTheme` chooses by base.)
- Terminal themes carry a **`base`** tag (light/dark, set in the editor; default
  dark) used only to group them into those subsections — additive, it doesn't
  change any existing behavior.

### Changed — appearance layout + global terminal fonts + settings hierarchy
- **Settings → Appearance** is now one scrolling page (no tabs): an **Interface**
  heading then a **Terminal** heading, each starting with its **Fonts** section
  then its **Themes** grid.
- **Global terminal typography override** (`AppSettings.terminalFonts`,
  `mergeTerminalTypography`): font family/size/line-height/letter-spacing/weight/
  ligatures applied on top of every terminal theme (wins over each preset's font).
- **Visual hierarchy** via new design tokens (`text.heading`, `text.subheading`):
  every Settings pane now leads with a consistent larger/bolder section heading
  (Appearance, Language, Keyboard shortcuts, Agents, Hooks, Terminal) for coherence.

### Added — custom themes + terminal appearance (personalization)
- **Theming engine** (`src/lib/theme.ts`): a `Theme` is a single palette with a
  declared `base` (light/dark) covering every shadcn token, the corner radius,
  and the title/body/mono fonts. `applyTheme` writes the values as CSS variables
  on `<html>` (instant, no rebuild) and toggles `.dark` from the base. Built-ins:
  System, Light, Dark, Midnight, Latte.
- **Settings → Appearance** (`ThemeSettings.svelte`), two sub-tabs (shadcn Tabs):
  - **Interface**: theme grid (applies live), **New theme** / **Edit** open an
    editable **draft** previewed live and **saved only on Save** (Cancel/closing
    discards); **Duplicate**, **Delete**, **import/export** as JSON via file
    (native dialog) or clipboard (partial imports fill from the base); and a
    **global font override** (title/body/mono) that wins over each theme's fonts.
  - **Terminal**: terminal themes are saved **presets** that override the app
    theme *in the terminal only* — Inherit + presets, draft Save/Cancel,
    import/export, and per-field **overrides** dots (with the inherited value as
    placeholder). Covers font family/size/line-height/letter-spacing/weight,
    **ligatures** (`@xterm/addon-ligatures`, DOM renderer), cursor style + blink,
    and the full color set (background, text, cursor, selection + 16 ANSI).
- **Themeable fonts**: `--ux-font-body` (UI), `--ux-font-title` (titles, via the
  `font-title` design token) and `--ux-font-mono` (editor + diffs) routed through
  Tailwind's font utilities. Fonts are referenced by installed family name
  (importing font *files* is a tracked follow-up — `FOR-DEV.md`).
- **Editors** (`ThemeEditor.svelte`, `TerminalThemeEditor.svelte`) built from
  shadcn-svelte components (Input, Textarea, Switch, Label, Select, Tabs, Dialog).
- **Model**: `AppSettings.activeThemeId` + `customThemes` + `fonts` +
  `terminalThemes` + `activeTerminalThemeId` (frontend-owned shapes, persisted
  opaquely in Rust like `terminalLayout`).
- **Docs**: `docs/theming.md` (app + terminal theme JSON templates).

### Changed — agent-hooks docs enriched
- **`docs/agent-hooks.md` rewritten as a guided installer.** Now opens with a
  TL;DR, a state-table ("what do I get"), the ready-made scripts and the
  env-injection contract, then step-by-step install for **Claude Code** (one
  click) and **any other agent** via the generic wrapper, with a
  per-platform breakdown:
  - **Windows — PowerShell** (`uxnan-hook-wrapper.ps1`): the
    `-Type / -Command / -Args` argument shape and the quoting caveats.
  - **Windows — cmd / batch** (`uxnan-hook-wrapper.cmd`): when to fall back
    from PowerShell and the `%2`–`%9` arg-list limit.
  - **macOS / Linux — Bash** (`uxnan-hook-wrapper.sh`): exact app-data
    paths for both platforms.
  - **WSL** and **Git Bash on Windows**: which wrapper applies in each
    shell context.
  - **Verify** checklist for all platforms + a **Troubleshooting** section
    covering stale tokens, dimmed (`stale`) reports, "401" from the
    wrapper, and "dot never changes from `working`".
- Adds **app-data path table** per OS (Windows / macOS / Linux) and a
  **reference** section with the full request contract + env vars moved
  here for one-stop lookup.

### Added — precise agent states in the terminal tab bar + hooks-discovery hint
- **Tab bar now uses the precise `AgentStatusDot`** (`TerminalArea.svelte`):
  every terminal tab in a region shows the four-state dot (working green /
  blocked amber / waiting orange / done blue / idle gray; stale dimmed) driven
  by `resolveAgentDisplay`, with the same priority as the sidebar
  (hook › title › output-activity). The coarse pulsing dot from
  `tab.working` is gone — a plain terminal with no agent and no activity now
  shows no dot at all.
- **Install-hooks hint** on agent tabs that aren't being driven by the hook
  server: a subtle `Webhook` icon button next to the status dot, only when
  `display.source !== "hook"` and the tab is an *agent* terminal (so plain
  shells and already-hook-driven agents don't see it). Clicking opens
  **Settings → Hooks** so users discover the ready-made per-agent hook
  configs and can wire them up. EN/ES (`monitor.installHooksHint`).

### Added — configurable keyboard shortcuts
- **Settings → Keyboard shortcuts**: rebind the app's shortcuts (click a chord to
  record a new one, reset to default, or disable). Persisted in
  `AppSettings.keybindings` (Rust + `types.ts`). Actions: close file/diff
  (`Ctrl/Cmd+W`), save file (`Ctrl/Cmd+S`), quick-switch worktree (`Ctrl/Cmd+P`),
  open settings (`Ctrl/Cmd+,`), toggle left / right sidebar (`Ctrl/Cmd+B` / `J`).
- **`keybindings.ts`**: platform-agnostic chords (`Mod` = Ctrl/⌘), an event→chord
  matcher, and a CodeMirror-key converter (for the editor's save key). The global
  handler in `+page.svelte` routes shortcuts (skipping terminal focus + the
  settings view); `Ctrl/Cmd+W` only closes the center overlay when one is open.

### Changed — right-panel + settings polish (review feedback)
- **Tabs** now carry icons (file tree / git compare), sized from the design tokens.
- **Changes tab header reworked**: dropped the "Changes · worktree" label for a
  **changed-file count**, plus a **search/filter** and refresh. **Stage all** /
  **Unstage all** stay in their section headers as secondary (outline) buttons.
  Each file row now shows its **`+added −deleted`** line counts (`git_numstat` →
  `git diff --numstat HEAD`, live with the status watcher).
- **File-tree "expand all"** now loads + expands the tree level by level (capped
  at 1500 folders so it can't freeze on a giant tree).
- **File-tree tab**: dropped the redundant "Files" label (worktree name only) and
  added a toolbar — **search/filter**, **collapse all**, **expand all**, **reveal
  in the OS file manager** (`reveal_path` command, via the opener plugin), and
  refresh. The active worktree (left panel) and the open file/diff now use a
  clearer selected style (primary tint + ring).
- **Changes tab**: removed the "view diff" eye button — **clicking a file row**
  opens its diff (matching the file tree); the stage/unstage/discard actions stay
  on hover.
- **Settings (full-screen)**: section content is centered in a column (text stays
  left-aligned), **Hooks moved to its own nav item** (fixes the agents-pane scroll
  and declutters it), and a **Keyboard shortcuts** item was added.

### Added — right-panel file tree + center file editor
- **Tabbed right panel** (`RightPanel.svelte`, shadcn-svelte Tabs): the existing
  version-control view is now the **Changes** tab (`ChangesPanel.svelte`,
  extracted verbatim), and a new **Files** tab is first, left-to-right. The
  active worktree's git status is loaded by the always-mounted parent so the
  Files tab is colored even while the Changes tab is unmounted.
- **File-tree tab** (`FileTreePanel.svelte` + `fileTree.svelte.ts` store): the
  whole working tree of the selected project/worktree, **lazily expanded one
  folder at a time** (`node_modules`/`target` never load until opened); folders
  first then files, `.git` hidden. Files with a git-tracked change are colored
  (untracked green / deleted red / modified amber) and the **parent folders that
  contain changes** are colored too, reusing the right-panel git status. Tree
  expansion survives tab switches; clicking a file opens it in the center editor.
- **File editor** (`FileEditor.svelte`, overlays the center panel like the diff
  viewer): editable **CodeMirror 6** with **syntax highlighting** per file
  extension (`editorLang.ts`: JS/TS/JSON/CSS/HTML/Markdown/Rust/Python/YAML/XML/
  C++/Java/PHP/SQL/Go), line numbers and undo/redo. A **git change gutter** shows
  added lines (vs `HEAD`) with a light highlight and a small left-edge marker
  that **peeks only the removed lines** on demand — never the full diff. **Save**
  with the button or **Ctrl/Cmd+S** writes the file and refreshes the gutter +
  git status. Binary / too-large (> 2 MiB) files show a notice instead of loading.
- **Backend** (`src-tauri/src/fs.rs` + `git::diff_head`): new commands
  `fs_list_dir`, `fs_read_file` (binary / too-large guards), `fs_write_file`
  (atomic temp-write + rename), and `git_diff_head` (working-tree-vs-`HEAD` diff
  for the editor gutter). 3 new unit tests cover the listing order / `.git`
  hiding, the binary / too-large flags, and the atomic overwrite.
- **i18n**: EN/ES strings for the tabs, the file tree, and the editor.
- **Dependencies**: `@codemirror/language`, `@codemirror/commands`,
  `@lezer/highlight`, and the per-language `@codemirror/lang-*` packages for
  syntax highlighting; the `tabs` shadcn-svelte component.
- **Spec**: `architecture/02c-git-worktrees.md` §6 (file-tree tab + editor + the
  new filesystem Tauri commands).

### Added — ready-made per-agent hook configs (Phase 4 follow-up)
- **Bundled hook scripts** (`static/hooks/`, embedded in the binary at compile
  time and written to `<app-data>/hooks/` on every startup, idempotent):
  - `uxnan-claude-hook.cjs` — Node CJS, no deps, cross-platform. Maps Claude
    Code's `UserPromptSubmit` / `PreToolUse` / `PreCompact` / `Notification`
    / `PermissionRequest` / `Stop` / `SessionEnd` events to the ADE's
    `working` / `waiting` / `done` / `blocked` states, POSTing each to
    `UXNAN_HOOK_URL` with `X-Uxnan-Token` + `UXNAN_AGENT_ID`.
  - `uxnan-hook-wrapper.sh` / `.ps1` / `.cmd` — generic wrapper for any CLI
    agent. Posts `working` before exec and `done` on exit (with
    `interrupted: true` if the agent crashed). Bash for Unix + Git Bash +
    WSL, PowerShell for Windows, cmd / batch as the no-PowerShell fallback.
- **Settings → Agents → Hooks** (`AgentHooksPanel.svelte`): a one-click
  **Install** for Claude Code that merges an ADE-managed `hooks` block into
  `~/.claude/settings.json` (preserves every other key, marks the block with
  `__uxnan_managed_hooks__: true` so Uninstall only touches ours), plus
  the platform wrappers and their absolute paths so users can wire any
  other agent as the launch command. Honest "Installed" / "Not installed" /
  "Unavailable" badge, "Show JSON config" disclosure with copy-to-clipboard,
  and EN/ES translations.
- **Backend** (`src-tauri/src/agent_hooks.rs`): idempotent install of the
  four scripts to `<app-data>/hooks/`, atomic read/modify/write of
  `~/.claude/settings.json` (sibling-temp + rename), and the
  `__uxnan_managed_hooks__` marker that scopes Install / Uninstall to the
  ADE's own block (user-installed `hooks` survive). New commands:
  `get_hook_install`, `get_claude_hooks_status`, `install_claude_hooks`,
  `uninstall_claude_hooks`, `get_hook_scripts`. 6 new unit tests cover the
  marker detection, the `{{HOOK_SCRIPT}}` substitution, the install
  idempotency, and the camelCase serialization of the Tauri surface.

### Added — keep-awake on macOS/Linux + untested-platform notice
- **Keep-awake now covers all three platforms** (`power.rs`): Windows
  (`SetThreadExecutionState`), macOS (`caffeinate -i`), Linux (`systemd-inhibit`),
  each held by the keep-awake worker and released on exit. **macOS/Linux are
  implemented but UNTESTED** (developed on Windows).
- **Untested-platform notice**: when running on macOS/Linux, the status bar shows
  an amber "Untested on <os>" badge (`platform.ts`), and the prevent-sleep setting
  notes the same. The app is only validated on Windows so far (alpha).

### Added — Phase 5 (UI batch B): palette, split buttons, virtual lists, sleep toggle
- **Quick worktree switcher** (`WorktreeSearch`): a command-palette opened with
  **Ctrl/Cmd+P** or the sidebar ⚡ button — type to filter every worktree across
  projects (branch / path / project), ↑/↓ to move, Enter to jump (activates it).
- **TabGroup split buttons**: each terminal region's tab bar now has visible
  split-right (columns) and split-down (rows) buttons, not just the right-click
  menu.
- **Virtualized lists** (`VirtualList`, `@tanstack/svelte-virtual`): the worktree
  palette and the right-panel changed-files list render only visible rows, so a
  huge changeset (e.g. an agent that touched hundreds of files) stays smooth.
  The right panel is now a single virtualized scroll (Staged + Changes sections
  with headers). The diff is already virtualized via CodeMirror; the hierarchical
  project tree is intentionally left non-virtualized (FOR-DEV).
- **Prevent-sleep toggle** (Settings → Agents): exposes `AppSettings.preventSleep`
  (the keep-awake feature added earlier); default off.

### Added — Phase 5: full-size diff panel + side-by-side + hunk staging (UI)
- **Diff opens full-size in the center panel** (`DiffPanel`), overlaying the
  terminals (which stay mounted underneath — no PTY/xterm torn down). Replaces
  the cramped, fixed-size modal. Header shows the file + Staged/Working badge +
  close; closing returns to the terminals.
- **Right-panel file list**: rows are no longer click-anywhere — only the
  buttons act. Each file has an **eye** button to open its diff, a **revert**
  (↺) button to discard (clearer than a trash can), and stage/unstage (+/−). The
  changed file's **name is colored** by status (modified/added/deleted/renamed)
  and the open file's row is highlighted.
- **Unified + side-by-side toggle** (`DiffView`): unified is one column;
  side-by-side is two synced CodeMirror views (old left / new right). Both stay
  mounted; CodeMirror is remeasured on reveal/resize so neither renders blank.
- **Per-hunk staging**: a bar above the diff lists each hunk (`#1, #2…`,
  click to scroll to it) with stage / unstage / discard actions, built on the
  `git_apply` backend below. Kept outside the CodeMirror render so it can't
  blank the editor.

### Added — Phase 5: hunk-level staging (backend)
- **`git_apply` command** (`git::apply_patch`): applies a unified-diff patch fed
  on stdin, with `cached` (index) and `reverse` flags — the backend half of
  hunk-level staging (stage / unstage / discard a single hunk).

### Added — Phase 5: keep system awake while an agent works (opt-in)
- **Prevent sleep** (`power.rs`, `AppSettings.preventSleep`, default off): while
  enabled and an agent is working, the ADE asks the OS not to sleep, and releases
  it when no agent is working. A long-lived worker thread owns the request
  (Windows `SetThreadExecutionState` is thread-affine) and **auto-releases after
  2 h** as a safety cap. Windows implemented; macOS/Linux are a no-op for now
  (FOR-DEV). Command `set_prevent_sleep`; the frontend drives it from
  `preventSleep && anyAgentWorking()`. The Settings toggle ships with the UI batch.

### Added — Phase 5: rotating backups + schema-migration hardening
- **5 rotating backups** (`persistence.rs`): before each atomic write, the live
  `state.json` is rotated into a numbered ring (`state.bak.1` … `state.bak.5`,
  oldest dropped), so a bad write or migration can be recovered. Rotation is
  best-effort — a backup error never blocks the save. Closes a Phase 0 follow-up.
- **Sequential schema migrations**: `migrate` now applies one `v → v+1` step at a
  time up to `SCHEMA_VERSION` (each future bump is an independent, testable
  transform) and rejects a future version. A missing `version` is still treated
  as current. (Debounced async writes remain a follow-up; the frontend already
  debounces the high-frequency layout writes.)

### Added — Phase 4 (Layer 1): local agent hook server + precise states
- **HTTP hook server (`axum`).** The backend binds a small server to an
  ephemeral `127.0.0.1` port at startup (`hooks.rs`). An agent's hook `POST`s a
  JSON state report to `/hook` — `{ agentId, status, agentType?, prompt?, tool?,
  interrupted? }`, `status ∈ working|blocked|waiting|done` — and the ADE
  normalizes it, caches it, and broadcasts `agent:status-changed` to the
  frontend. Unlike the coarse output-activity inference, this distinguishes the
  four precise states. Requests must present the per-launch token in the
  `X-Uxnan-Token` header (rejects stray local processes).
- **Env injection.** Every terminal is spawned with `UXNAN_HOOK_URL`,
  `UXNAN_HOOK_TOKEN` and `UXNAN_AGENT_ID` (the PTY id), inherited by any agent
  run inside it, so a hook knows where to report and which terminal it is
  (`PtySpec.env`, applied in `pty_create`).
- **Persistent cache (TTL 7 d / stale 30 min, spec §1.5).** Reports upsert into
  `AppData.agent_cache` (now keyed by `agentId`, carrying status/type/prompt/
  tool/interrupted + first-seen/last-update), persisted atomically and
  TTL-pruned on load (`prune_agent_cache`). New commands `get_hook_info` and
  `agent_states`; the frontend hydrates from the cache and stays live via the
  event (`agentStatus` store; `isStale` after 30 min).
- Wiring a specific agent to call the hook is per-agent configuration — see
  [`docs/agent-hooks.md`](docs/agent-hooks.md). Consuming the precise state in
  the sidebar/tab indicators lands in a follow-up increment.

### Added — Phase 4 (Layer 2): terminal-title state inference
- **OSC title → state (fallback).** Agents that update the terminal title
  (OSC 0/2, surfaced by xterm's `onTitleChange`) get their state inferred from
  it — "thinking…/running…" → working, "waiting/approval/review" → waiting,
  "error/failed" → blocked, "done/finished/✓" → done (`agentTitle.ts`,
  `agentMonitor.noteTitle`). Unknown titles (a plain cwd or `user@host`) are
  ignored. Needs no hook setup; complements Layer 1 for agents that don't report.
- **Unified status resolver** (`agentDisplay.ts`, `resolveAgentDisplay`): merges
  the layers with a clear priority — hook (precise) › title › output-activity —
  so the sidebar/tab indicators have one effective state to render.

### Added — Phase 4: precise status dots + unread/done badges
- **Colored status dots** (`AgentStatusDot.svelte`) on each agent sidebar row,
  driven by `resolveAgentDisplay`: working = green (pulsing), blocked = amber,
  waiting = orange (pulsing), done = blue, idle = gray; a stale report
  (no update >30 min) is dimmed, with the state + "stale" in the tooltip.
  Replaces the single green working spinner with the four precise states.
- **Unread / done badge** (`unread` store, spec §2): when an agent finishes
  (`done`, or settles idle while you're not looking at it), its worktree is
  flagged — a red dot on the worktree row and on the project header (so a
  collapsed project still surfaces a child worktree's result). The flag clears
  when you open that worktree or refocus the window; the dock/taskbar shows the
  count via `setBadgeCount` (best-effort per OS). The hook server owns this when
  it's driving a tab, so the coarse inference doesn't double-fire.

### Added — Phase 4: custom agent logos
- **Custom logo per agent** (Settings → Agents): the logo is now a button —
  pick any image and it's stored inline as a 64×64 PNG `data:` URL on
  `AgentProfile.icon` (`logo.ts`), so it persists with no filesystem path to
  resolve; a small ✕ resets to the catalog logo. Custom logos render everywhere
  catalog logos do (`agentLogoSrc` now passes `data:`/`http`/absolute through).

### Changed — agents: per-worktree agent override
- **Choose the agent when creating a worktree** (New worktree dialog): a "Launch
  agent" picker (None + your configured agents, with logos) preselects the global
  default and overrides what launches into that worktree
  (`projects.createWorktree` gains an `agentId`: a specific id, `null` for none,
  or omit for the global default).

### Changed — agents: detect in any terminal + close-on-exit
- **Process detection (any terminal).** A background scan (every 2 s, `procscan`
  + `sysinfo`) walks each terminal's process tree and reports the agent running
  in it — matching the catalog + your configured agents by exe name or
  command-line token (incl. `cmd-cli` package folders like `gemini-cli`), so it
  covers real exes (`claude.exe`) *and* node-shim CLIs (`codex`/`gemini`/…). A
  terminal that starts an agent — even one you typed by hand — gets its agent
  sidebar row + tab name; when the agent exits, the row disappears and the tab
  reverts to the shell name. The tab title follows the current agent
  (`agentName ?? base title`), so re-running a different agent renames it. The
  frontend syncs the commands to look for via `set_agent_commands`.
- **Accurate terminal close.** Shell exit is now detected by waiting on the
  shell process (`try_wait`) instead of the PTY's read-EOF, which on Windows
  ConPTY was unreliable — it could fire during a full-screen agent's teardown
  (closing the tab when the shell was still alive) or *not* fire when the shell
  exited (leaving an unwritable pane). Now running `exit` closes the tab
  completely, while an agent quitting just drops you back to the shell. Added a
  close shortcut: **Cmd+W** (mac) / **Ctrl+Shift+W** (plain Ctrl+W stays the
  shell's delete-word).

### Changed — sidebar: per-agent rows + collapsible agent spaces
- **Cards declutter into agent rows.** The generic activity dot and the
  open-terminal count are gone from project/worktree card headers (only the git
  diff badge stays). Each project and worktree now shows a **collapsible list of
  its agent terminals** (`AgentSpace`): one clickable row per *agent* terminal
  (plain terminals get no row), with the agent's logo, a spinner while it's
  working, and click-to-jump to that terminal. Collapsed, it shows a count + a
  working spinner.
- **Space-aware notifications.** An agent-idle notification now fires when you're
  not looking at that terminal (a different workspace/tab is showing, or the
  window is unfocused) — not just on window blur. New **Settings → Agents → Idle
  notifications** toggle (`AppSettings.agentNotifications`, default on).
- Agent terminals are tagged at launch (`tab.agentName` + `tab.agentIcon`) so the
  rows and monitoring know which terminals are agents.

### Added — Phase 4 (increment 1): agent activity monitoring
- **Activity inference** (universal, no agent setup): a terminal producing output
  is "working", quiet for 3 s is idle, exited is done. A pulsing dot shows on the
  worktree row/card and the terminal tab while it's working (`agentMonitor` +
  `tab.working`).
- **Native notification** (`tauri-plugin-notification`) when an *agent* terminal
  settles idle (≥ 12 s) while the app is **unfocused** — i.e. an agent likely
  finished/paused while you were away. One per idle period, re-armed on new
  output; permission is requested lazily on first use.
- Precise per-state monitoring (working/blocked/waiting/done) is deferred to a
  hook-based approach — see FOR-DEV.

### Fixed — terminal: fewer resize jumps + multi-line key
- **No redundant PTY resizes.** `fitToPane` resizes the PTY only when cols/rows
  actually change, and the `ResizeObserver` is debounced — so a spurious SIGWINCH
  no longer makes a full-screen agent TUI repaint and the viewport jump (e.g.
  while dragging a split divider). Scrolling *inside* a live full-screen agent is
  still disabled by the agent's alternate screen buffer (standard, like vim/htop).
- **Shift+Enter / Alt+Enter insert a newline** (xterm otherwise collapses them to
  a plain Enter) for multi-line agent prompts. `Ctrl+←/→` word-nav already passes
  through to the shell/agent.

### Added — terminal shell detection + working default profiles
- **Seeded profiles** on a fresh install are now the platform's guaranteed shells
  (Windows: **Windows PowerShell** with `-ExecutionPolicy Bypass` + **Command
  Prompt**; Unix: login shell + bash) instead of one empty placeholder. An
  untouched empty-starter install is upgraded to this seed on load.
- **PowerShell launches with `-ExecutionPolicy Bypass`** (process-scoped) so
  npm-installed agent shims (`.ps1`) run under Windows' default Restricted policy
  — fixes agents that wouldn't start in Windows PowerShell.
- **Shell detection in Settings → Terminal**: the Add-profile template picker
  greys out shells that aren't installed and offers **"Add detected shells"** to
  seed every installed one in one click (PowerShell 7, Git Bash, WSL surface only
  when present). Reuses the command-detection backend.

### Fixed — worktrees, status sync & error banners
- **Robust worktree removal.** The worktree's terminals/agents are now killed
  *before* removal — on Windows a shell whose CWD was inside the worktree held
  the folder open and blocked deletion, leaving half-removed worktrees ("not a
  working tree" / "not a git repository", empty leftover folders, and a sibling
  vanishing when prune then swept it up). Backend removal is best-effort now:
  graceful → forced → prune → delete any leftover directory (with retry), and it
  tolerates an already-broken worktree instead of erroring.
- **Canonical worktree paths** (forward slashes, matching `git worktree list`).
  A freshly-created worktree's per-worktree terminal-workspace key now lines up
  with its sidebar row — fixing the auto-launched **default agent** opening in an
  invisible workspace (it looked like it didn't launch).
- **Live project-card status.** The git review panel pushes the worktree's
  dirty/ahead/behind to the project card, so the badge clears right after a
  commit — no manual "Refresh worktrees & status".
- **Dismissible error banners** (left sidebar + right panel) with an ×, so a git
  error no longer sticks until the next refresh.

### Added — auto-launch a default agent on worktree create
- **Default agent** setting (Settings → Agents → "Default agent", `None` by
  default): when set, creating a worktree auto-launches that agent in the new
  worktree's terminal workspace. Opt-in — `None` never starts an agent unasked.
  New `AppSettings.defaultAgentId`; `projects.createWorktree` calls
  `app.launchAgent` after the worktree is created and selected.

### Changed — Phase 3 closed: diff viewer on CodeMirror 6
- **Diff viewer rebuilt on CodeMirror 6** (`@codemirror/state` + `@codemirror/
  view`): read-only, **virtual-scrolls large diffs**, supports text selection,
  and colorizes add/remove/hunk lines via line decorations (replacing the
  hand-rolled renderer). Diff fetches now abort after **30 s** so the UI can't
  hang on a pathological diff.
- This closes Phase 3 (status + diffs + live watcher + push/pull + diff viewer).
  Side-by-side view, hunk/line staging and virtual-scroll polish move to Phase 5;
  the `git2` migration and AI commit messages remain tracked in FOR-DEV.

### Added — Phase 3 (increment 2): live status + push / pull
- **Real-time status.** A background watcher (Tokio interval, 3 s) polls the
  worktree the right panel is reviewing and emits `git:status-changed` only when
  it changes; the panel updates live as an agent edits files. The watcher
  **pauses while the window is unfocused** (Tauri `WindowEvent::Focused`). The
  frontend sets the watched worktree via `git_set_watch` and applies events for
  the worktree it's showing (skipping mid-action to avoid flicker).
- **Push / pull.** `git_push` and `git_pull --ff-only` with an ahead/behind bar
  in the commit composer (counts + Pull/Push buttons, enabled per ahead/behind).
  Push is never retried; pull is fast-forward-only so it can't start a surprise
  merge.

### Added — Phase 3 (first increment): git status & diffs in the right panel
- **Right-panel review** (`RightPanel`): the active worktree's changed files split
  into **Staged** and **Changes** (untracked included), each row showing its
  status code; click a file to see its diff.
- **Diff viewer** (`DiffView`): a colorized unified diff in a dialog (added/removed/
  hunk lines). CodeMirror 6 is a follow-up.
- **Staging & commit**: per-file stage / unstage / discard (discard confirms
  first), stage-all / unstage-all, and a commit composer (message + Commit).
- **Backend** (git CLI, `git.rs`): `git_status` (porcelain v1 `-z`, rename-aware),
  `git_diff` (tracked + untracked via `--no-index`), `git_stage`/`git_unstage`/
  `git_stage_all`/`git_unstage_all`/`git_discard`/`git_commit`. New `FileChange`
  type (`types.ts`), `api.ts` wrappers, and a `git` store keyed by the active
  worktree (reloads on switch / after each action / manual refresh).
- Deferred (FOR-DEV): real-time 3 s status polling + Tauri events, CodeMirror,
  hunk/line-level staging, AI commit message, image diffs, push/pull/sync, the
  `git2` migration.

### Changed — agents: shell-aware launch, install detection, brand logos
- **Agents now launch inside a shell.** Instead of spawning the bare command —
  which only worked for real `.exe` agents (`claude`, `agy`) and failed for npm
  `.ps1`/`.cmd` shims (`codex`, `gemini`, `opencode`, `pi`) — the ADE opens the
  agent's terminal profile and types the command into it, so PATH/PATHEXT shims
  resolve. Fixes agents not starting under Windows PowerShell.
- **Per-agent terminal.** Each agent picks which terminal profile (shell) to
  launch in — any built-in or user-added profile — defaulting to the default
  terminal profile. New `AgentProfile.terminalProfileId`. The command is typed
  into the freshly-started shell (transient, never persisted/re-run on restore).
- **Install detection + catalog.** Settings → Agents shows a catalog of known
  agents (Claude Code, Codex, Gemini CLI, OpenCode, Pi, Antigravity, Goose,
  Grok, Kilo Code, Kimi, Qwen Code); the backend (`agents_detect`, PATH+PATHEXT)
  reports which are installed and only those are addable — one-click, or "Add all
  installed". Replaces the old static template list. "Add custom agent" remains.
- **Brand logos** (`static/agents/*.svg`, `AgentLogo`) in the catalog, the agent
  editor and the launch menu. New `AgentProfile.icon` stores the logo key; logos
  also resolve by command (`agentLogoKey`), so agents added before icons existed
  still show their brand mark.

### Fixed
- **Project sort menu**: relabel the default ordering "Default" (was the awkward
  "Added order"), and widen the menu (`min-w-44`) to match the other dropdowns.

### Added — agents track (registry + launch)
- **Agents registry** in **Settings → Agents**: register CLI coding agents
  (name + command + args) from built-in templates (Claude Code, Codex, Gemini,
  Aider, opencode) or a blank entry. Persisted in `AppSettings.agentProfiles`
  (Rust `AgentProfile` + `types.ts`), round-tripped through `update_settings`
  with a `#[serde(default)]` so older state still loads.
- **Launch an agent into a worktree**: a Bot menu on every project header and
  worktree row (`LaunchAgentMenu`) lists the configured agents and runs the
  chosen one in a terminal inside that worktree's checkout (its workspace), or
  deep-links to **Settings → Agents** when none are configured yet.
- Settings panes are now deep-linkable (`app.openSettings(section)`).
- Fully internationalized (EN/ES) and built on the design tokens.
- Out of scope here (Phase 4): agent **status** monitoring, hooks server,
  notifications, and auto-launch on worktree create.

### Changed — full i18n coverage + icon-only panel toggles
- **i18n now covers the whole UI**: the right "Changes" panel, the status bar
  (backend state + repository count), the terminal-profile editor, the Settings
  terminal section, the "exited" tab badge, the "Alpha" tooltip, and the shadcn
  dialog close labels are translated. From here on every new string goes through
  `i18n.t`.
- **Panel toggles use Lucide icons** (`PanelLeft` / `PanelRight`) instead of the
  hardcoded `☰` / `⇆` glyphs, matching the other toolbar buttons.

### Added — internationalization (i18n)
- **Multilingual UI** (English default + Spanish): a dependency-free i18n layer
  (`src/lib/i18n/`) with one dictionary file per locale (`en.ts` is the
  source-of-truth `MessageKey` type; other locales are
  `Record<MessageKey, string>`, so a missing key fails to compile). `i18n.t(key,
  params)` interpolates `{placeholders}` and is reactive to the language setting;
  `i18n.plural(n, …)` handles counts.
- **Language follows the device** (`navigator.language`) by default and can be
  set manually in **Settings → Language** (System / English / Español). Persisted
  in `AppSettings.language` (backend `model.rs` + `types.ts`).
- Translated the main surfaces: left panel (sidebar/project/worktree cards +
  menus + dialogs), terminal area (top bar, breadcrumb, context menu, empty
  state), the new-worktree and directory-picker dialogs, the title bar and
  Settings. Adding a language is one file + one line — see `docs/i18n.md`.

### Added — design tokens (sizing & emphasis)
- **Reusable sizing/emphasis scale** in `src/lib/design.ts` (icon sizes, ghost
  icon-button footprint, text roles) documented in `docs/design-tokens.md`.
  Informational text/icons are intentionally smaller and muted; control icons
  and titles get their own role. Applied across the left panel
  (`LeftSidebar`, `ProjectCard`, `WorktreeRow`), the terminal top bar
  (`TerminalArea`) and the directory picker to fix the uneven density (oversized
  header/card icons, too-large floating-menu text, over-bold informational text).

### Changed — left panel redesign: projects with nested worktrees
- **Single hierarchical Projects tree** (`LeftSidebar.svelte`, `ProjectCard.svelte`,
  new `WorktreeRow.svelte`; `WorktreeCard.svelte` removed) replaces the two flat
  Projects/Worktrees lists that were confusing (duplicate "main"s, unclear
  parent/child). Each **project header is its own "main" context** (selectable)
  and **expands to show its non-main worktrees as nested sub-rows**. Selecting a
  project or worktree makes it the active terminal context (its terminals show);
  the row is highlighted. Search filters projects and their worktrees and
  auto-expands matches.
- **Per-row status + "running terminals" indicators**: each project/worktree
  shows its dirty/ahead/behind badges and, when it has live terminals, a
  terminal-count indicator — so you always see where your shells are.
- **Terminal context is read-only in the top bar** (`TerminalArea.svelte`): the
  confusing workspace-selector dropdown is replaced by a `repo / branch`
  breadcrumb; the **left panel is the single place to switch context**. Creating
  a worktree selects it.

### Added — Phase 2: per-worktree terminal workspaces (completes Phase 2)
- **Terminals are now grouped into workspaces** (`terminals.svelte.ts`): one per
  worktree (keyed by its path) plus a **Global** space (`""`) for unassigned
  terminals. Selecting a worktree shows its terminal set and hides the others,
  while every workspace (and every region/tab) stays mounted so background
  worktrees keep streaming and their PTYs keep running. The store gained a
  workspace layer (proxying the existing region/split logic to the active
  workspace via getters), `setWorkspace`/`dropWorkspace`, all-workspace
  serialize/restore, and cross-workspace `markExited`.
- **Workspace switcher** in the terminal top strip (`TerminalArea.svelte`): a
  dropdown listing Global + each worktree that has terminals, showing the active
  one. Clicking a worktree card (`projects.setActiveWorktree`) or its "open
  terminal" / a project's "open terminal" switches to that workspace; removing a
  worktree drops its workspace (killing its PTYs).
- **Persistence** now stores every workspace's layout + the active key
  (`SavedTerminalLayout`); restored on startup.

### Changed — directory picker: manual path entry
- The in-app directory picker's current-path display is now an editable input:
  type or paste any path and press Enter to jump there (git repos in the listing
  are still flagged). Complements click-to-navigate.

### Added — Phase 2: in-app directory picker
- **In-app project picker** (`DirectoryPicker.svelte`) replaces the OS-native
  folder dialog: a shadcn `Dialog` that browses sub-folders (up/down), flags git
  repositories, and adds the current or any listed repo. Backed by a new
  `browse_dirs` command + `browse` module (lists dirs, marks `.git`, hidden
  folders excluded, sorted; +1 test, 25 passing). The projects store gains
  `addProjectPath`; the unused `pickDirectory`/`@tauri-apps/plugin-dialog`
  frontend wrapper is removed.

### Added — Phase 2: worktree status badges
- **Status badges on worktree cards** (`WorktreeCard.svelte`): each worktree
  shows its uncommitted-change count and ahead/behind-upstream counts. Backed by
  a new `worktree_status` command + `git::worktree_status` (parses
  `git status --porcelain=v1 --branch`); the projects store keeps a
  `statusByPath` map refreshed on load and after create/remove. +2 tests
  (`parse_status_porcelain`), 24 passing.

### Added — Settings screen & terminal profiles
- **Settings screen** (`Settings.svelte`, opened from a gear in the title bar):
  a dialog with a section nav — **General** (theme: System/Light/Dark, applied
  live and persisted) and **Terminal**. New `app.settingsOpen` state.
- **Configurable terminal profiles** (`TerminalProfile { command, args }` in
  `AppSettings`): each new terminal is spawned from a profile, so PowerShell,
  Command Prompt and WSL (Windows) — or any shell — are first-class. The backend
  seeds a single **empty starter profile** (placeholders teach configuration) and
  replaces an untouched legacy auto-seed; a blank command falls back to the
  platform default shell. `pty_create` now accepts `args` (`PtySpec.args`).
- **OS-grouped profile templates** (`terminalTemplates.ts`): Settings → Terminal
  → **"Add profile ▾"** offers presets grouped by Windows / macOS / Linux (plus a
  blank profile); a per-profile editor (name, command, args) and a default-profile
  picker.
- **Profile-aware new terminals**: the title-strip **+ Terminal** opens the
  default profile and its ▾ caret picks any profile; region "+", splits, the
  context menu and project/worktree "open terminal" all use the default profile.
  The chosen shell/args **persist in the saved layout**.

### Changed
- **Terminal follows the app theme**: xterm colors and the terminal-area
  background switch with light/dark (`app.terminalPalette()`) and re-theme live —
  fixing unreadable text on a forced-dark surface in light mode.
- **Terminal content padding**: panes get inner padding (the FitAddon accounts
  for it) so output no longer touches the edges.

### Added — Phase 2 (git & worktrees) — left-panel UX rework
- **shadcn-svelte component library**: real components from the official registry
  under `src/lib/components/ui/` (button, input, dialog, dropdown-menu,
  collapsible, separator, badge, card, tooltip, select), plus the canonical
  `WithElementRef` / `WithoutChild*` type helpers in `utils.ts`. `tailwind-merge`
  bumped to v3 (correct for Tailwind v4); `bits-ui`, `tailwind-variants` and
  `@lucide/svelte` added. The monorepo `AGENTS.md` now scopes the Svelte/desktop
  skills (shadcn-svelte, svelte-code-writer, svelte-core-bestpractices) to
  `uxnandesktop/` and the Flutter skills to `uxnanmobile/`.
- **Redesigned left panel** (`LeftSidebar.svelte`): the Projects/Worktrees tabs
  are gone. One panel with a top **search** box (filters projects *and* worktrees
  together) over two **collapsible** sections — Projects and Worktrees (collapsed
  by default). Either section expands to fill the remaining height while the
  other is collapsed, or they share it 50/50.
- **Project cards** (`ProjectCard.svelte`): name, path and a worktree-count badge,
  with top-right actions — open a terminal in the repo, **New worktree…**, and a
  ⋯ menu (copy path, remove project with confirmation).
- **New-worktree dialog** (`NewWorktreeDialog.svelte`): branch name + a
  **base-branch picker** (shadcn `Select`, preloaded with the resolved default)
  + a live preview of the worktree folder path.
- **Worktree cards** (`WorktreeCard.svelte`): branch (+ `main` badge), owning
  repo and path; click to mark active; actions to open a terminal there and a ⋯
  menu (copy path, remove). Removal **escalates to a forced remove** when the
  worktree has uncommitted changes.
- **Worktree backend** (`git.rs`, `commands.rs`): `branch_list` (local branches +
  resolved default base `origin/HEAD` → `main` → `master` → `HEAD`);
  `worktree_create` now takes a `base` and uses `--no-track` (avoids a false
  "behind upstream" before first push); `worktree_remove` with a dirty-changes
  preflight, `prune`, and a safe branch delete. +1 test (17 → 18 passing).

### Changed
- **The app starts with no terminal open** (`terminals.svelte.ts`,
  `TerminalArea.svelte`): the center area begins empty with a "New terminal"
  empty-state and a global **+ Terminal** button in the top strip; terminals are
  opened from a project/worktree or that button. A persisted layout from a
  previous session is still restored, and closing the last terminal now leaves
  the area empty instead of respawning a shell.
- **Webview default context menu suppressed** (`+page.svelte`): the browser/dev
  right-click menu no longer appears (kept on text fields for paste); the
  terminal's own tab/pane menus are unaffected.

### Added — Phase 1 completion (persistence & lifecycle)
- **Terminal layout persistence**: the region/tab layout is serialized
  (structure only — splits, ratios, per-tab title/cwd, active tab) and saved
  (debounced, atomic) via a new `set_terminal_layout` command into
  `AppData.terminal_layout`; restored on startup in `app.init` (`serializeArea`
  / `restore` in the store). Fresh shells spawn on restore; the UI waits for the
  store to hydrate before mounting terminals so none is spawned then discarded.
- **Kill all PTYs on app exit** (`PtyManager::close_all` wired to
  `RunEvent::ExitRequested` in `lib.rs`) so no shell/agent is left running after
  the window closes.
- **Bounded terminal scrollback** (`scrollback: 5000`) caps per-terminal memory
  — the effective limit for hidden terminals (which stay mounted).
- With this, **Phase 1 (terminal core) is complete**; remaining terminal items
  (tab reorder / drag-between-regions / MRU, the backend ring buffer, and
  per-worktree terminal association) are Tier 2 / Phase 2 and tracked in
  `FOR-DEV.md`.

### Added — Phase 1 (terminal splits & interaction)
- **TabGroup region layout** (`src/lib/state/terminals.svelte.ts`,
  `TerminalArea.svelte`): the center area is now a tree of regions
  (`AreaNode = TabGroup | AreaSplit`). Each region has its own tab strip (each
  tab = one PTY) and "+ New" button; **Split right/down** divides a region into
  two with a draggable ratio (nestable). Terminals render in a flat,
  PTY-id-keyed layer positioned from `computeAreaLayout`, so splitting/closing
  **never remounts xterm or restarts a process** — fixing the earlier bug where
  the first pane reprinted its shell startup and running processes were killed
  on split/close.
- **Terminal copy/paste**: `Ctrl+C` (copies when there's a selection, else
  SIGINT) / `Ctrl+V`, plus a right-click context menu (Copy · Paste · Split
  right/down · New terminal · Close terminal) on both the terminal and the tab.
  Clipboard via `tauri-plugin-clipboard-manager` (`src/lib/clipboard.ts`, with a
  `navigator.clipboard` fallback for the web preview).
- **File drag-and-drop**: dropping files onto a terminal inserts their quoted
  paths into the terminal under the cursor (Tauri `onDragDropEvent`).

### Fixed
- **`pty_create` is idempotent** (`src-tauri/src/pty.rs`): re-creating an
  existing PTY id is a no-op instead of spawning a replacement, so a stray
  double-create can never restart a live shell/agent. +1 test (16 → 17 passing).

### Changed — UI
- **Right-panel toggle relocated** out of the title bar (next to min/max/close)
  into a slim strip at the top-right of the center panel, so it stays visible
  when the right panel is hidden.
- **Slim themed scrollbars** for the terminal viewport and sidebars
  (`.xterm-viewport` / `.uxnan-scroll` in `app.css`) instead of the chunky OS
  default.

### Added — Phase 2 (git & worktrees, in progress)
- **Git backend** (`src-tauri/src/git.rs`): repo/worktree ops via the git CLI
  (`tokio::process::Command`, `shell:false`) — `is_git_repo`, `repo_name`,
  `worktree_path_for`, `add_worktree` (`git worktree add -b`), and
  `list_worktrees` with a `--porcelain` parser that surfaces **worktrees created
  by CLI agents**, not just ADE-created ones. Commands: `repo_add` /
  `repo_remove` / `repo_list` (repos persisted in `AppData`), `worktree_create`,
  `worktree_list`. New `AppError::Git` / `AppError::Invalid`; Tokio `process`
  feature enabled; `tauri-plugin-dialog` added for the native folder picker.
- **Tabbed left sidebar** (`LeftSidebar.svelte`): **Projects** tab (add a repo
  via the native folder picker → `repo_add`, list, remove) and **Worktrees** tab
  (create on a new branch via a minimal form → `worktree_create`, list per repo,
  and an "Open terminal here" action that spawns a shell in the worktree's cwd).
  Terminals now accept an optional `cwd` (`terminals.create({ cwd })`).
- ⚠️ The add-project / create-worktree **UX is intentionally superficial** for
  this review pass and must be reworked (proper dialog, validation, feedback,
  base-branch picker, richer cards). Tracked as the top Phase 2 item in
  `FOR-DEV.md`.

### Changed — UI
- **Custom title bar** (`TitleBar.svelte`): the OS window chrome is disabled
  (`decorations: false`) and replaced with an in-app bar matching the app's
  surfaces — drag region, sidebar toggles, an **ALPHA** badge (neutral, readable
  in light and dark), and minimize / maximize / close controls
  (`@tauri-apps/api/window`; capability permissions added). Degrades gracefully
  in a plain browser.
- **Layout fix**: the center terminal area and its tab stack are now
  `overflow-hidden`, so the xterm canvas can no longer paint over the right
  panel when the left sidebar is toggled (was visible in the web build).

### Added — Phase 1 (terminal core, in progress)
- **PTY backend** (`src-tauri/src/pty.rs`): `PtyManager` over `portable-pty` 0.9
  (ConPTY on Windows). `create(PtySpec, on_output, on_exit)` spawns a shell in a
  pseudoterminal and streams stdout/stderr from a dedicated reader thread via
  caller-supplied sinks (so it's unit-testable without an `AppHandle`); plus
  `write`, `resize`, and idempotent `close` (kills the child). Default shell =
  PowerShell on Windows / `$SHELL` elsewhere; default cwd = home.
- **PTY commands** (`commands.rs`, registered in `lib.rs`): `pty_create`,
  `pty_write`, `pty_resize`, `pty_close`. The frontend picks the `id` and
  subscribes to `pty:output:{id}` before spawning, so no early output is lost;
  `pty:exit:{id}` fires when the process ends. `AppState` now owns the
  `PtyManager`. New `AppError::Pty` / `AppError::NotFound` variants.
- **Terminal UI**: `Terminal.svelte` (xterm.js + fit + WebGL-with-DOM-fallback,
  bidirectional PTY wiring, refit on resize/activate) and `TerminalArea.svelte`
  (tab bar: create / close / switch; hidden tabs stay mounted so their PTYs keep
  streaming). Wired into the center panel; tab state in
  `src/lib/state/terminals.svelte.ts`. Deps: `@xterm/xterm`,
  `@xterm/addon-fit`, `@xterm/addon-webgl`.
- Tests: 4 PTY unit tests (lifecycle incl. real shell write→echo→read→close with
  a ConPTY `ESC[6n` responder, unknown-id `NotFound`, idempotent close, default
  shell). Backend `cargo test` 12 passing, clippy + fmt clean; frontend
  `npm run check` 0/0, `npm run build` OK.
- Deferred to later Phase 1 increments (see `FOR-DEV.md`): pane splits
  (recursive binary tree), tab reorder/MRU, tab/split layout persistence,
  backend hidden-tab ring buffer, kill-all-on-exit.

### Fixed — docs
- **Stale internal cross-links in the architecture spec** corrected so every
  reference resolves to an existing file (`architecture/00-index.md`,
  `01-product-vision.md`, `02d-agent-monitoring.md`). The broken targets came
  from the pre-reorganization numbering; mapped by topic to
  `02b-terminal-engine.md`, `02c-git-worktrees.md`, `02d-agent-monitoring.md`,
  and the old `02e-implementation-guide.md` → `03-implementation-guide.md` (the
  "Guía de Implementación" nav) / `04-technical-reference.md` (the "fases, MVP,
  estimaciones" reference). `01`'s "Ver también" header now lists every sibling
  doc.

### Added — docs
- **`docs/` directory**: `development.md` (prerequisites, running in debug, UI
  iteration, the npm-not-pnpm gotcha), `build.md` (release builds, bundle
  targets, signing pointers), `testing.md` (verification gates), and
  `architecture.md` (orientation + monorepo context). Linked from a `## Docs`
  section in the README. The monorepo `AGENTS.md` now requires a `docs/` per
  component (development / build / testing / component-specific).

### Added — Phase 0 (base infrastructure)
- **Project scaffold**: Tauri 2 + SvelteKit (SPA via `adapter-static`,
  `ssr=false`) + Svelte 5, branded as `uxnan-desktop` / `com.uxnan.desktop`.
  Window `1280×800` (min `880×560`). Uses **npm** (the host's home
  `pnpm-workspace.yaml` hijacks `pnpm install` in this directory).
- **Styling foundation**: Tailwind CSS v4 via `@tailwindcss/vite` +
  shadcn-svelte design tokens (`src/app.css`, neutral/oklch, `.dark` variant),
  `cn()` helper (`src/lib/utils.ts`), and `components.json` so
  `shadcn-svelte add` works later. No components generated yet (kept minimal).
- **Rust data model** (`src-tauri/src/model.rs`): `AppData` → `RepoData` →
  `WorktreeData`, plus `AppSettings`, `AgentStateEntry`, `Theme`, `AgentStatus`,
  and `SCHEMA_VERSION`. Serde `camelCase`, mirrored in `src/lib/types.ts`.
- **Atomic persistence** (`src-tauri/src/persistence.rs`): `PersistenceManager`
  with crash-safe write-rename and a schema-version migration hook (v1).
- **Shared state + IPC** (`state.rs`, `commands.rs`, `error.rs`): managed
  `AppState { RwLock<AppData>, PersistenceManager }`; Tauri commands
  `get_app_state`, `update_settings`, `ping`; serializable `CommandError` with
  stable `code`s. State is loaded from the OS app-data dir at startup.
- **Three-panel UI** (`src/routes/+page.svelte`, `+layout.svelte`): resizable
  left/center/right panels (pointer-drag handles, persisted widths), sidebar
  toggles, theme sync, and a backend-status bar. Global reactive store in
  `src/lib/state/app.svelte.ts` hydrates from the backend on mount.
- Verified: `npm run check` (0 errors/0 warnings), `npm run build` (SPA →
  `build/`), `cargo test` (8 passing), `cargo clippy` + `cargo fmt` clean.

### Notes
- The full engineering roadmap (Phases 1–6) and deferred items are tracked in
  [`FOR-DEV.md`](FOR-DEV.md); human-provided assets in [`FOR-HUMAN.md`](FOR-HUMAN.md).
- Default Tauri placeholder icons are in `src-tauri/icons/` — branded icons are
  a `FOR-HUMAN` asset.
