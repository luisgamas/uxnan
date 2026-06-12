# Changelog — uxnan-desktop

All notable changes to the Uxnan Desktop ADE are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/). Versioning: [SemVer](https://semver.org/).

## [Unreleased]

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
