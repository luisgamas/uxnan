# FOR-DEV — uxnan-desktop (ADE)

Technical development plan and deferred-work checklist for the Uxnan Desktop
**Agent Development Environment (ADE)**. This is the actionable engineering
roadmap derived from `architecture/` (the spec is the source of truth); each
deferred code item has, or will have, a greppable `FOR-DEV:` marker at its site.

> Distinct from [`FOR-HUMAN.md`](FOR-HUMAN.md) (assets only a human can provide:
> branded icons, signing keys, updater pubkey, relay URL).

**Stack:** Rust + Tauri 2 (backend) · Svelte 5 + SvelteKit (SPA) + Tailwind v4 +
shadcn-svelte (frontend) · xterm.js (terminals) · CodeMirror 6 (diffs).
**Package manager:** `npm` (the machine's home `pnpm-workspace.yaml` hijacks
`pnpm install` here; npm also matches the rest of the monorepo).

Conventions, the full planned Tauri command/event surface, and per-module data
models live in:
- `architecture/00-index.md` — index
- `architecture/02a-system-architecture.md` — three actors, data model, flows, persistence
- `architecture/02b-terminal-engine.md` — PTY engine, xterm.js, splits/tabs
- `architecture/02c-git-worktrees.md` — worktree lifecycle, diffs, staging
- `architecture/02d-agent-monitoring.md` — hooks, status, notifications, orchestration
- `architecture/02e-bridge-integration.md` — embedded vs standalone bridge
- `architecture/03-implementation-guide.md` — Rust/Svelte patterns, security, CI/CD
- `architecture/04-technical-reference.md` — MVP tiers, phases, glossary

---

## Status at a glance

| Phase | Theme | Status |
|---|---|---|
| **0** | Base infrastructure (3-panel shell, IPC, persistence) | ✅ **DONE** |
| **1** | Terminal core (PTY, tabs, splits) | ✅ **DONE** — terminals, region splits, copy/paste, file-drop, layout persistence, kill-on-exit (reorder/MRU = Tier 2; per-worktree assoc = Phase 2) |
| **2** | Git & worktrees | ✅ **DONE** — single-panel UI (search + collapsible Projects/Worktrees, cards, new-worktree dialog with base-branch picker), worktree create / list / safe remove, status/dirty + ahead/behind badges, in-app directory picker, **per-worktree terminal workspaces** (select a worktree → its terminals show, others keep running hidden). Agent auto-launch is the Settings **agents track** (S) |
| 3 | Git status & diffs | ☐ not started |
| 4 | Agent monitoring (hooks, notifications) | ☐ not started |
| 5 | Polish & UX (hunk staging, side-by-side, virtual scroll) | ☐ not started |
| 6 | Bridge integration (mobile pairing) | ☐ not started |
| **S** | Settings, design system & i18n (cross-cutting) | ◑ **IN PROGRESS** — Settings (theme + terminal profiles w/ OS templates), **design tokens**, **full i18n (EN/ES + Language picker)**, and the **agents registry + manual launch** (the ADE differentiator) done; agent **auto-launch on worktree create** + Phase-4 **status monitoring** pending |

Estimate (spec §2): 11–17 weeks for Phases 0–5 solo; +2–3 wk for Phase 6.

### Where we are (2026-06-12)

**Phases 0, 1 and 2 are complete** (terminal core + splits + per-worktree
terminal workspaces; full git-worktree management with the redesigned, i18n'd
panel). The cross-cutting track has Settings, design tokens, full i18n, and the
**agents registry + manual launch** done — you can register CLI agents in
Settings → Agents and launch one into any worktree (it runs in that worktree's
terminal workspace).

**Next up — Phase 3 (Git status & diffs):** the right-panel review experience
(status polling, diff viewer, stage/commit). The remaining Tier-1 pillar; will
pull in `git2`. This is the recommended next phase.

**Agent follow-ups (smaller, after the registry):** auto-launch the worktree's
agent on create (Tier-2 **T2.2**), and the whole of **Phase 4** (status
monitoring via hooks/OSC, native notifications, orchestration).

Smaller follow-ups that are NOT blockers (tracked below): backend debounced
persistence + rotating backups, `git2` migration, WSL paths, tab reorder/MRU,
branded icons (`FOR-HUMAN.md`).

---

## Settings, profiles & agents (cross-cutting track)

A Settings screen (`Settings.svelte`, gear in the title bar) is the home for
user configuration. Built incrementally alongside the phases.

**Done:**
- [x] **Settings foundation**: Dialog with a section nav; **General** (theme:
      System/Light/Dark, applied live + persisted).
- [x] **Terminal profiles**: `TerminalProfile { command, args }` in `AppSettings`,
      seeded with one empty starter (placeholders teach configuration; an
      untouched legacy auto-seed is replaced). Per-profile editor + default
      profile; **OS-grouped templates** (`terminalTemplates.ts`) to add presets
      (Windows/macOS/Linux). `pty_create` takes `args`; new terminals spawn from
      the chosen/default profile and the shell/args persist in the layout.
- [x] **Terminal theming**: xterm + terminal-area background follow light/dark
      (`app.terminalPalette()`), re-themed live; terminal content padding.
- [x] **Design tokens** (`src/lib/design.ts`, `docs/design-tokens.md`): reusable
      icon/text/control sizing & emphasis scale, applied across the panel +
      terminal bar to fix uneven density.
- [x] **Internationalization** (`src/lib/i18n/`, `docs/i18n.md`): English + Spanish,
      device-default with a **Settings → Language** picker
      (`AppSettings.language`). **Whole app translated** (panel, terminal area,
      right panel, status bar, every dialog incl. the shadcn dialog close, the
      profile editor, the title bar). **From here on, every new string must be
      added via `i18n.t` (a key in every locale) — non-negotiable.**

**Done — agents (in Settings):**
- [x] **Agents registry in Settings** — register agents (name, command, args) in
      **Settings → Agents**, from built-in templates (Claude Code, Codex, Gemini,
      Aider, opencode) or blank. Persisted in `AppSettings.agentProfiles` (Rust
      `AgentProfile` + `types.ts`, `#[serde(default)]`). `Settings.svelte` +
      `AgentProfileEditor.svelte` + `agentTemplates.ts`.
- [x] **Manual agent launch** — a Bot menu (`LaunchAgentMenu.svelte`) on every
      project header and worktree row launches the chosen agent into that
      worktree's terminal workspace (`app.launchAgent` → `terminals.create` with
      the agent's command/args), or deep-links to Settings → Agents when none are
      configured. Settings panes are deep-linkable via `app.openSettings(section)`.

**Pending — agents:**
- [ ] **Auto-launch on worktree create** — inject the (per-worktree) agent's
      command into a new PTY when a worktree is created (spec `02b §5.1`); needs a
      per-worktree agent selection. Closes Tier-2 **T2.2**. **FOR-DEV.**
- [ ] **Env vars per agent** + a **default agent**, if a launch flow needs them.

**Done (cross-cutting):**
- [x] **In-app directory picker** (`DirectoryPicker.svelte` + `browse_dirs`) —
      replaced the OS-native folder dialog (see Phase 2).

**Pending — Settings polish:**
- [ ] **Custom / import-export themes** — beyond the 3 built-ins, let users define
      custom color sets (component tokens) and **import/export** them as JSON, for
      deeper personalization. **FOR-DEV.**

---

## Phase 0 — Base infrastructure ✅ DONE

**Goal (delivered):** an empty native desktop window with the resizable
three-panel skeleton, a reactive Svelte store, Serde persistence, and a
validated Tauri command/event round-trip.

Done in this increment:
- [x] Tauri 2 + SvelteKit (SPA, `adapter-static`, `ssr=false`) scaffold,
      rebranded to `uxnan-desktop` / `com.uxnan.desktop`, window `1280×800`
      (min `880×560`).
- [x] Tailwind v4 via `@tailwindcss/vite` + shadcn-svelte design tokens
      (`src/app.css`) + `cn()` helper (`src/lib/utils.ts`) + `components.json`
      (ready for `npx shadcn-svelte add …`).
- [x] **Rust data model** (`src-tauri/src/model.rs`): `AppData` → `RepoData` →
      `WorktreeData`, `AppSettings`, `AgentStateEntry`, `Theme`, `AgentStatus`,
      `SCHEMA_VERSION`. Serde `camelCase`; mirrored in `src/lib/types.ts`.
- [x] **Atomic JSON persistence** (`src-tauri/src/persistence.rs`):
      `PersistenceManager` write-rename + schema-version migration hook.
- [x] **Shared state + commands** (`state.rs`, `commands.rs`, `error.rs`):
      `AppState { RwLock<AppData>, PersistenceManager }`; commands
      `get_app_state`, `update_settings`, `ping`; typed `CommandError`.
- [x] **Three-panel UI** (`src/routes/+page.svelte`): left/center/right panels,
      pointer-drag resize handles (persisted widths), sidebar toggles, backend
      status bar. Reactive store in `src/lib/state/app.svelte.ts`.
- [x] Verified: `npm run check` (0/0), `npm run build` (SPA → `build/`),
      `cargo test` (8 passing), `cargo clippy` + `cargo fmt` clean.

Phase 0 follow-ups:
- [x] **shadcn-svelte components** — the component library (button, input, dialog,
      dropdown-menu, select, card, badge, separator, tooltip, collapsible) is
      installed under `src/lib/components/ui/` and used across the app.
- [ ] **Debounced async persistence** — current `save` is synchronous
      write-rename on the command thread. Add the 250 ms Tokio debounce +
      5 rotating backups described in spec §7 (`persistence.rs`). Defer until
      layout writes get frequent (Phase 1 tabs/splits). **FOR-DEV** (marker in
      `persistence.rs`).
- [ ] **Migration arms** — `persistence::migrate` only knows v1; add real
      `v1→v2…` arms when the schema first changes. **FOR-DEV** marker in place.
- [ ] **Branded icons + bundle identity** — replace the default Tauri icons.
      See `FOR-HUMAN.md`.

---

## Phase 1 — Terminal core ✅ DONE

**Goal (met):** run commands in an integrated terminal with tabs and splits;
multiple PTYs in parallel; bounded hidden buffers; layout persisted; processes
killed on close and on exit.

### Backend (Rust)
- [x] `portable-pty` `0.9`. `pty` module: `PtyManager` owning a
      `HashMap<String, PtySession>` (id → master/writer/child). Sinks-based
      `create(PtySpec, on_output, on_exit)` so it's unit-testable without an
      `AppHandle`. Default shell = PowerShell (Windows) / `$SHELL` else; default
      cwd = home.
- [x] Commands: `pty_create { id, cwd?, shell?, cols, rows }`, `pty_write
      { id, data }`, `pty_resize { id, cols, rows }`, `pty_close { id }`
      (`commands.rs`, registered in `lib.rs`). The frontend chooses `id` and
      subscribes before spawning so no early output is lost. Idempotent create.
- [x] Stream output: dedicated reader thread per PTY → `on_output` → emit
      `pty:output:{id}` (raw bytes); `pty:exit:{id}` on process end.
- [x] Kill child on `pty_close` (idempotent); slave dropped after spawn for
      clean EOF. **Kill all children on app exit** (`PtyManager::close_all` wired
      to `RunEvent::ExitRequested` in `lib.rs`).
- [x] **Layout persistence**: `set_terminal_layout` + `AppData.terminal_layout`
      (opaque JSON, atomic write) so the region/tab layout survives a restart.
- [~] **Hidden-tab buffering**: per-terminal memory is bounded by xterm
      `scrollback: 5000` (hidden tabs stay mounted, so that's the effective cap)
      — the functional "limited buffer + recovery" requirement is met. The
      backend 2 MB ring buffer + unmount/snapshot-restore is a further memory
      optimization, **deferred** (only needed if we later unmount hidden tabs or
      want a tighter cap). **FOR-DEV** (marker in `pty.rs` module doc).

### Frontend (Svelte)
- [x] `@xterm/xterm` + `@xterm/addon-fit` + `@xterm/addon-webgl` in
      `Terminal.svelte`: `onData → pty_write`, `listen('pty:output:{id}') →
      term.write`, `ResizeObserver → pty_resize`, WebGL with DOM fallback,
      bounded `scrollback`.
- [x] **TabGroup region layout** (`TerminalArea.svelte` +
      `lib/state/terminals.svelte.ts`): the center area is a tree of regions
      (`AreaNode = TabGroup | AreaSplit`). Each region has its own tab strip
      (each tab = one PTY) + "+ New" button; **Split right/down** divides a
      region into two with a draggable ratio. Terminals render in a flat,
      id-keyed layer positioned from `computeAreaLayout`, so splitting/closing
      **never remounts xterm or restarts a PTY** (backed by the idempotent
      `pty_create`). Background/hidden tabs stay mounted (lossless).
- [x] **Terminal interaction**: copy (`Ctrl+C` with selection) / paste
      (`Ctrl+V`) and a right-click context menu (Copy/Paste · Split · New/Close
      terminal); clipboard via `tauri-plugin-clipboard-manager`
      (`lib/clipboard.ts`, web fallback). Native **file drag-and-drop** inserts
      quoted paths into the terminal under the cursor (`onDragDropEvent`).
- [x] **Persist + restore the region/tab layout** (`serializeArea` / `restore`
      in the store, debounced save via `setTerminalLayout`, restored in
      `app.init`). Structure-only (fresh shells spawn on restore); the UI waits
      for `hydrated` before mounting terminals so no shell is spawned then
      discarded.

### Deferred beyond Phase 1 (tracked, not blocking)
- **Tab/region reorder, drag tabs between regions, MRU** — these are spec
  **Tier 2** (T2.2 "Drag & drop de tabs entre TabGroups"), not Phase 1 Tier 1.
  **FOR-DEV.**
- **Backend hidden-tab ring buffer** — memory optimization (see `[~]` above).
- ✅ **Per-worktree terminal association** — DONE in Phase 2 (per-worktree
  terminal workspaces; layout persisted per workspace).

### Notes / gotchas
- ConPTY (Windows) queries cursor position (`ESC[6n`) at startup and waits for a
  reply; a live xterm.js answers automatically (the unit test answers it
  manually). PowerShell hangs without that answer — hence the test uses
  `cmd.exe`, while the app uses PowerShell against a real xterm.
- Restructuring the layout must not remount the affected `Terminal` (it would
  re-run `pty_create` and restart the shell). Keep terminals in the flat,
  id-keyed layer; `pty_create` is idempotent as a backstop.
- Keyboard copy uses `Ctrl+C`/`Ctrl+V` (NOT `Ctrl+Shift+C/V`): `Ctrl+Shift+C` is
  the webview DevTools shortcut and can't be reliably suppressed; the Shift
  paste also double-pasted (manual `term.paste` + native paste). `Ctrl+V` calls
  `preventDefault` to drop the duplicate native paste.
- Some CLI agents block on an open stdin pipe — match the bridge's lesson and
  manage stdin deliberately.
- WebGL addon falls back to the DOM renderer when unavailable.

---

## Phase 2 — Git & worktrees ✅ DONE

**Goal (met):** register git repos; create / list / safely remove worktrees;
tie terminals to the active worktree. The left panel was **redesigned** (per
review) from two flat lists into a single hierarchical Projects tree — the
earlier "superficial UX" warning is resolved.

### Backend (Rust)
- [x] `git` module (`src-tauri/src/git.rs`) via the git **CLI** (`tokio::process`,
      `shell:false`): `is_git_repo`, `repo_name`, `worktree_path_for`,
      `add_worktree`, `list_worktrees` (`--porcelain`, incl. agent-created),
      `branch_list` + `default_base` (probe `origin/HEAD` → `main` → `master` →
      `HEAD`), `worktree_status` (dirty + ahead/behind), and a safe
      `remove_worktree` (dirty preflight + prune + `git branch -d`). Tested.
- [x] `browse.rs` — `browse_dirs` for the in-app directory picker.
- [x] Commands: `repo_add/remove/list`, `worktree_create` (optional `base`,
      `--no-track`), `worktree_list`, `worktree_status`, `branch_list`,
      `worktree_remove`, `browse_dirs`.
- [ ] Move high-frequency status/diff to `git2` (`0.20+`). **FOR-DEV** (Phase 3 will use it).
- [ ] WSL path detection (`\\wsl.localhost\…`) → route through `wsl.exe`. **FOR-DEV.**
- [ ] Aggressive branch cleanup for squash-merged branches (patch-equivalence). **FOR-DEV.**

### Frontend (Svelte)
- [x] **Single hierarchical Projects tree** (`LeftSidebar.svelte`,
      `ProjectCard.svelte`, `WorktreeRow.svelte`): a project header is its own
      "main" context and **expands to show its non-main worktrees as nested
      sub-rows**. Search filters projects + worktrees and auto-expands matches.
      (Replaced the two flat Projects/Worktrees lists + `WorktreeCard.svelte`.)
- [x] **Selectable contexts**: clicking a project (= its main) or a worktree makes
      it the active context — the row highlights and its terminals show.
- [x] **Per-row indicators**: dirty / ahead / behind status badges and a
      "running terminals" count on each project/worktree.
- [x] **New-worktree dialog** (`NewWorktreeDialog.svelte`): branch + shadcn
      `Select` base-branch picker (preloaded default) + folder-path preview.
      Confirm-on-remove (`ConfirmDialog`); worktree remove escalates to forced
      when dirty.
- [x] **In-app directory picker** (`DirectoryPicker.svelte`): a shadcn Dialog that
      browses sub-folders (click or type/paste a path), flags git repos — replaces
      the OS-native folder dialog.
- [x] **Per-worktree terminal workspaces** (`terminals.svelte.ts`,
      `TerminalArea.svelte`): one terminal set per worktree (+ a Global space);
      selecting a worktree shows its terminals and hides the others (which keep
      running, mounted). A read-only `repo / branch` breadcrumb shows the active
      context (the left panel is the single selector).

### Deferred (Settings **agents track**, not Phase 2)
- ✅ **Manual "Launch agent"** — DONE in the agents track (`LaunchAgentMenu` on
  project/worktree rows; registry in Settings → Agents).
- **Agent auto-launch on worktree create** — still pending (needs a per-worktree
  agent selection). **FOR-DEV.**

---

## Phase 3 — Git status & diffs ☐

**Goal:** see and act on file changes in real time.

### Backend (Rust)
- [ ] `git2::Repository::statuses()` polled every 3 s with `tokio::time::interval`
      (coalesce; **pause when the window is hidden** via Tauri focus events).
- [ ] Emit `git:status-changed { worktreeId, files, ahead, behind }`.
- [ ] Ops: `git_stage`, `git_unstage`, `git_discard`, `git_commit`, `git_status`,
      `git_diff` (hunks/lines via `git2::Diff`), plus `git_push`/`git_pull` (CLI,
      retry-with-backoff for idempotent reads only; never retry push).
### Frontend (Svelte)
- [ ] Right sidebar: file tree by area (Changes / Staged / Untracked).
- [ ] CodeMirror 6 inline diff viewer (lazy per-file; 30 s compute timeout).
- [ ] Per-file stage/unstage/discard; commit composer (message textarea +
      contextual primary action: Commit/Push/Sync/Publish).

---

## Phase 4 — Agent monitoring ☐

**Goal:** know what each agent is doing in each worktree.

### Backend (Rust)
- [ ] Local HTTP hook server (`axum`, async on Tokio) accepting POST status
      reports; normalize `working/waiting/blocked/done`.
- [ ] Persistent last-state cache (the existing `AppData.agent_cache`, TTL 7 d,
      30 min → stale); emit `agent:status-changed`.
- [ ] `tauri-plugin-notification` on `done`; `notification:agent-completed`.
- [ ] Fallbacks: terminal-title (OSC) parsing addon; foreground-process
      detection per PTY (Phase 2 of monitoring, spec §5/02d).

### Frontend (Svelte)
- [ ] Status dots on worktree cards + terminal tab bars; "unread" badge on
      completed worktrees; clear on focus.

---

## Phase 5 — Polish & UX ☐

- [ ] Hunk-level (partial) staging (`git2::Diff::foreach` + index manipulation).
- [ ] Rotating backups + schema migrations hardening (closes Phase 0 follow-up).
- [ ] System-suspension prevention while an agent is `working` (per-OS; opt-in;
      2 h auto-release).
- [ ] Stronghold/keyring for any secret (never plaintext JSON).
- [ ] Side-by-side diffs (two synced CodeMirror views); TanStack Virtual for
      sidebar + diff lists; quick worktree search; TabGroup-level splits.
- [ ] E2E tests (Playwright/WebdriverIO) for the main flows.

---

## Phase 6 — Bridge integration ☐

**Goal:** let the desktop act as the mobile bridge (single-install).
The standalone bridge (`../bridge/`) is already implemented and is the contract
reference; this phase embeds it.

### Backend (Rust)
- [ ] Tauri **sidecar** for the Node bridge process; manage lifecycle
      (start/stop/restart/health).
- [ ] IPC (stdin/stdout JSON-RPC) between Rust and the bridge process; keep E2EE
      keys **inside** the bridge process (never exposed to the Rust core — spec
      §4.1).
- [ ] Commands: `bridge_start`, `bridge_stop`, `bridge_status`,
      `bridge_generate_qr`. Events: `bridge:connection-changed`,
      `bridge:mobile-connected`.
### Frontend (Svelte)
- [ ] Settings → Mobile connection: QR pairing dialog, connected-phone
      indicator, trusted-device management (reuses bridge
      `bridge/removeTrustedDevice`, already implemented).

---

## Cross-cutting / standing rules
- [ ] **Tests for every public function** (AGENTS.md, ALPHA). Rust: `#[cfg(test)]`
      in-file + `tests/`. Svelte: Vitest component tests.
- [ ] **Lint/format gate before "done":** `cargo clippy` + `cargo fmt`,
      `npm run check` (svelte-check), and a Svelte/TS formatter.
- [ ] **Tauri capabilities:** expose only the commands a window needs; no
      arbitrary FS/network from the frontend (spec §4.2).
- [ ] **No plain `TODO`/`FIXME`** — only `FOR-DEV:` (code) / `FOR-HUMAN:`
      (assets) markers. Don't break the build when deferring (stubs throw or are
      unwired).

## Documentation cross-links — FIXED
The stale internal links in `architecture/00-index.md`, `01-product-vision.md`
and `02d-agent-monitoring.md` were corrected so every reference resolves to an
existing file. They came from the pre-reorganization numbering; mapped by topic:
`02b-terminals-and-pty.md` → `02b-terminal-engine.md`,
`02c-git-worktrees-diffs.md` / `02c-git-and-worktrees.md` → `02c-git-worktrees.md`,
`02d-orchestration-and-monitoring.md` → `02d-agent-monitoring.md`, and the old
`02e-implementation-guide.md` → `03-implementation-guide.md` (the "Guía de
Implementación" nav) or `04-technical-reference.md` (where the context was
"fases, MVP, estimaciones", which is doc 04). `01`'s "Ver también" header was
also completed to list all sibling docs.
