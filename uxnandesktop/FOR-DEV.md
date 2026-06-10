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
| **0** | Base infrastructure (3-panel shell, IPC, persistence) | ✅ **DONE** (this increment) |
| 1 | Terminal core (PTY, tabs, splits) | ☐ not started |
| 2 | Git & worktrees | ☐ not started |
| 3 | Git status & diffs | ☐ not started |
| 4 | Agent monitoring (hooks, notifications) | ☐ not started |
| 5 | Polish & UX (hunk staging, side-by-side, virtual scroll) | ☐ not started |
| 6 | Bridge integration (mobile pairing) | ☐ not started |

Estimate (spec §2): 11–17 weeks for Phases 0–5 solo; +2–3 wk for Phase 6.

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

Phase 0 follow-ups (do next, before/with Phase 1):
- [ ] **shadcn-svelte components** — run `npx shadcn-svelte@latest add button
      dialog` etc. as real UI lands (Phase 1+). Foundation (`components.json`,
      tokens, `cn`) is in place; no components generated yet to keep Phase 0
      minimal. **FOR-DEV.**
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

## Phase 1 — Terminal core ☐

**Goal:** run commands in an integrated terminal with tabs and splits.

### Backend (Rust)
- [ ] Add `portable-pty` (`0.9+`). New `pty` module: `PtyManager` owning a
      `HashMap<String, PtySession>` (id → master/child/writer).
- [ ] Commands: `pty_create { cwd, cols, rows, shell? }`, `pty_write { id,
      data }`, `pty_resize { id, cols, rows }`, `pty_close { id }`.
- [ ] Stream output: reader task per PTY → `tokio::sync::mpsc` → emit
      `pty:output:{id}` (raw bytes) via `AppHandle::emit`.
- [ ] Hidden-tab buffering: bounded ring buffer (spec: 2 MB/hidden PTY) with a
      snapshot/restore on re-show (`VecDeque<u8>`, drain oldest 4 KB blocks).
- [ ] Kill child on `pty_close` and on app exit; reap zombies.

### Frontend (Svelte)
- [ ] `@xterm/xterm` + `@xterm/addon-fit` + `@xterm/addon-webgl` in a
      `Terminal.svelte` component; `onData → invoke('pty_write')`,
      `listen('pty:output:{id}') → term.write`. `ResizeObserver → pty_resize`.
- [ ] Terminal tab bar per TabGroup (create/close/reorder, MRU).
- [ ] Recursive binary split tree for panes inside a tab (drag-to-resize).
- [ ] Persist the tab/split layout per worktree (via backend Serde + the
      debounced writer from the Phase 0 follow-up).

### Notes / gotchas
- Some CLI agents block on an open stdin pipe — match the bridge's lesson and
  manage stdin deliberately.
- WebGL addon must fall back to the canvas renderer when unavailable.

---

## Phase 2 — Git & worktrees ☐

**Goal:** create, list, and manage git worktrees.

### Backend (Rust)
- [ ] Add `git2` (`0.20+`). `git` module: open repo, list branches, statuses.
- [ ] Worktree ops via **git CLI** (`tokio::process::Command`, `shell:false`):
      `git worktree add/remove/list` (libgit2's worktree support is limited).
- [ ] Base-branch resolution (probe `origin/HEAD` → `main` → `master`).
- [ ] Remove preflight: dirty-changes check via `git2::statuses()`; safe branch
      cleanup on worktree removal.
- [ ] WSL path detection (`\\wsl.localhost\…`) → route through `wsl.exe`.
- [ ] Commands: `repo_add`, `repo_remove`, `repo_list`, `worktree_create`,
      `worktree_remove`, `worktree_list`. Persist repos/worktrees via `AppState`.

### Frontend (Svelte)
- [ ] Left sidebar: hierarchical repos → worktrees (shadcn-svelte Sidebar/Tree),
      worktree cards with branch + indicators.
- [ ] Active-worktree switch (click → show/hide associated terminals; PTYs keep
      running in the background).
- [ ] "Create Worktree" dialog (repo, base branch, agent); auto-launch a
      terminal (and optionally the chosen agent) on create.

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

## Documentation discrepancies to confirm with the maintainer
- `architecture/00-index.md` and `01-product-vision.md` link to filenames that
  don't exist: `02b-terminals-and-pty.md`, `02c-git-worktrees-diffs.md` /
  `02c-git-and-worktrees.md`, `02d-orchestration-and-monitoring.md`,
  `02e-implementation-guide.md`. The actual files are `02b-terminal-engine.md`,
  `02c-git-worktrees.md`, `02d-agent-monitoring.md`, `02e-bridge-integration.md`.
  Content is consistent; only the cross-links are stale. **Flagged, not silently
  fixed** (per AGENTS.md conflict-resolution rule) — confirm before editing the
  spec.
