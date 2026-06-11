# Changelog — uxnan-desktop

All notable changes to the Uxnan Desktop ADE are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/). Versioning: [SemVer](https://semver.org/).

## [Unreleased]

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
