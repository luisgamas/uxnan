# Changelog — uxnan-desktop

All notable changes to the Uxnan Desktop ADE are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/). Versioning: [SemVer](https://semver.org/).

## [Unreleased]

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
