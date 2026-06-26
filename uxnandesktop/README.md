# Uxnan Desktop — Agent Development Environment (ADE)

A lightweight, terminal-centric desktop app to **orchestrate multiple CLI AI
agents in parallel**, each isolated in its own git worktree and pseudoterminal.
Not an IDE — an orchestration, monitoring, and change-review layer.

Built with **Rust + Tauri 2** (backend) and **Svelte 5 / SvelteKit + Tailwind
CSS v4 + shadcn-svelte** (frontend). Terminals use xterm.js; diffs use
CodeMirror 6.

> Part of the [Uxnan](../) monorepo. The full specification is the source of
> truth — start at [`architecture/00-index.md`](architecture/00-index.md).
> The engineering roadmap and deferred work live in [`FOR-DEV.md`](FOR-DEV.md);
> human-provided assets in [`FOR-HUMAN.md`](FOR-HUMAN.md).

## Status

**ALPHA-FUNCTIONAL (standalone).** **Phases 0–5 + the cross-cutting track (S)
are complete.** The ADE is ready for alpha release as a standalone app
(manage repos / worktrees, multiplexed terminals, launch + monitor agents, full
git review with hunk staging & diffs, settings / i18n / theming). The only
remaining roadmap phase is **Phase 6 (bridge integration / mobile pairing)**,
which is *optional for standalone use* — required only if you want the ADE to
also act as the mobile bridge (otherwise, install `uxnan-bridge` standalone).

Highlights of what ships today:
- Three-panel resizable shell with atomic JSON persistence (5 rotating
  backups + sequential schema migrations).
- PTY terminals (`portable-pty 0.9`, xterm WebGL + DOM fallback) with tabs
  + nested splits that never remount on split, drag-to-reorder / move tabs
  across regions, `Ctrl+Tab` MRU cycling, a backend output ring buffer that
  restores a recreated pane's scrollback, and the Kitty/CSI-u keyboard protocol.
- Git worktrees with per-worktree terminal workspaces, hierarchical
  Projects tree, in-app directory picker, worktree palette
  (Ctrl/Cmd+P).
- Full git review (status / diff / stage / commit / push / pull with a
  3 s focus-paused Tokio watcher, CodeMirror 6 diff viewer, hunk-level
  staging, side-by-side toggle).
- **Agent monitoring** (Phase 4) — three layers: Layer 1 local HTTP hook
  server (`axum` with precise `working/blocked/waiting/done` and persistent
  cache) + Layer 2 terminal-title (OSC) + Layer 3 process-tree detection.
  Colored status dots, unread/done badges, custom agent logos, per-worktree
  agent override.
- **Multi-agent orchestration** (spec `02d` §3) — a console (status bar, shown
  with ≥2 live agents) that routes a message to all agents, to one type
  (fan-out), or to a coordinator's workers, with **backpressure** (each agent
  gets its next message only once it's free) and an in-memory coordinator→workers
  task graph.
- Cross-cutting (S): Settings (theme + terminal profiles w/ OS templates),
  design tokens, full **i18n (EN/ES)** + Language picker, agents
  registry + install detection + manual + auto-launch, **per-agent env vars** and
  a **configurable agent launch shell** (Command Prompt by default on Windows).
- Virtualized lists (`@tanstack/svelte-virtual`), opt-in keep-awake
  (Windows).

Pre-release gaps before distributing builds: branded icons + signing/
updater keys (`FOR-HUMAN.md`) and a CI/CD pipeline (see `FOR-DEV.md` →
*CI/CD — release builds*).

## Docs

Detailed docs live in [`docs/`](./docs/):
[development & running in debug](./docs/development.md) ·
[release builds & packaging](./docs/build.md) ·
[testing & verification](./docs/testing.md) ·
[architecture orientation](./docs/architecture.md) ·
[design tokens](./docs/design-tokens.md) ·
[theming & appearance](./docs/theming.md) ·
[internationalization (i18n)](./docs/i18n.md) ·
[agent hooks (precise states)](./docs/agent-hooks.md).

The full product/engineering specification is in
[`architecture/`](architecture/00-index.md).

## Layout

```
uxnandesktop/
├── architecture/          # Spec (source of truth) — Phase 0-5+S status; Phase 6 pending
├── docs/                  # Task-focused docs (install, build, test, i18n, hooks, ...)
├── src/                   # SvelteKit frontend (SPA)
│   ├── app.css            # Tailwind v4 + shadcn-svelte tokens
│   ├── lib/
│   │   ├── api.ts         # typed wrappers over Tauri commands
│   │   ├── types.ts       # TS mirror of the Rust model
│   │   ├── state/         # reactive Svelte 5 stores (runes)
│   │   ├── i18n/          # EN/ES translations
│   │   ├── components/    # shadcn-svelte primitives + app components
│   │   └── ...            # diff.ts, clipboard.ts, agentCatalog.ts, etc.
│   └── routes/            # +layout.svelte, +page.svelte (three-panel shell)
├── src-tauri/             # Rust backend
│   └── src/
│       ├── lib.rs         # Tauri builder, state wiring, command registration
│       ├── main.rs        # entrypoint
│       ├── model.rs       # AppData / RepoData / WorktreeData / settings
│       ├── persistence.rs # atomic JSON (write-rename) + 5 rotating backups + migrations
│       ├── state.rs       # AppState (RwLock<AppData> + PersistenceManager)
│       ├── commands.rs    # Tauri commands (git, pty, worktree, browse, agent, ...)
│       ├── pty.rs         # portable-pty manager
│       ├── git.rs         # git CLI wrapper (worktrees, branches, status, commit)
│       ├── gitfast.rs     # git2 fast path (status / diff / numstat / log / show)
│       ├── hooks.rs       # axum HTTP hook server (Layer 1 agent monitoring)
│       ├── agent_hooks.rs # per-agent hook configs (Claude auto-install + wrappers)
│       ├── procscan.rs    # process-tree detection (Layer 3)
│       ├── power.rs       # keep-awake (Win; macOS/Linux untested)
│       ├── browse.rs      # in-app directory picker
│       ├── fs.rs          # file read/write for the center editor
│       ├── fswatch.rs     # filesystem watcher (file-tree auto-refresh)
│       ├── which.rs       # agent/shell install detection
│       └── error.rs       # AppError / CommandError
├── components.json        # shadcn-svelte config
└── package.json
```

## Develop

Prereqs: Node ≥ 18, Rust (stable), and the Tauri 2 system deps (WebView2 on
Windows). This sub-project uses **npm** (the machine's home `pnpm-workspace.yaml`
makes `pnpm install` no-op here).

```bash
cd uxnandesktop
npm install            # frontend deps
npm run check          # svelte-check (type check)
npm test               # Vitest unit tests (pure logic — 19 passing)
npm run build          # build the SPA → build/  (required by `cargo build`'s generate_context!)
npm run tauri dev      # run the desktop app (compiles Rust on first run)
```

Backend (from `src-tauri/`):

```bash
cargo test             # unit tests (69 passing)
cargo clippy --all-targets
cargo fmt
```

For a frontend-only browser flow (no Tauri shell): see
[`docs/development.md`](./docs/development.md).

## Conventions

- Rust: `snake_case` fns, `PascalCase` types, `Result` + `thiserror`, async I/O
  on Tokio, tests in-file with `#[cfg(test)]`.
- Svelte 5: runes (`$state`/`$derived`/`$effect`), `PascalCase.svelte`
  components, `camelCase` members.
- Tailwind: utility-first, dark via the `.dark` class, tokens in `app.css`.
- Commits: Conventional Commits with desktop scopes (`rust`, `svelte`,
  `terminal`, `git`, `agent`, `tauri`, `bridge-embed`, `ui`, `config`).
