# Uxnan Desktop — Agent Development Environment (ADE)

A lightweight, terminal-centric desktop app to **orchestrate multiple CLI AI
agents in parallel**, each isolated in its own git worktree and pseudoterminal.
Not an IDE — an orchestration, monitoring, and change-review layer.

Built with **Rust + Tauri 2** (backend) and **Svelte 5 / SvelteKit + Tailwind
CSS v4 + shadcn-svelte** (frontend). Terminals use xterm.js; diffs use
CodeMirror 6.

> Part of the [Uxnan](../) monorepo. The full specification is the source of
> truth — start at [`architecture/00-index.md`](architecture/00-index.md).
> The engineering roadmap and deferred work live in [`FOR-DEV.md`](FOR-DEV.md).

## Status

**Phase 0 (base infrastructure) — done.** The app boots a native window with the
resizable three-panel shell, a reactive Svelte store, atomic Serde persistence,
and a validated Tauri command round-trip. Terminals, git/worktrees, diffs,
agent monitoring, and bridge integration are the subsequent phases (see
`FOR-DEV.md`).

## Docs

Detailed docs live in [`docs/`](./docs/):
[development & running in debug](./docs/development.md) ·
[release builds & packaging](./docs/build.md) ·
[testing & verification](./docs/testing.md) ·
[architecture orientation](./docs/architecture.md) ·
[design tokens](./docs/design-tokens.md) ·
[internationalization (i18n)](./docs/i18n.md) ·
[agent hooks (precise states)](./docs/agent-hooks.md).

The full product/engineering specification is in
[`architecture/`](architecture/00-index.md); the phased roadmap and deferred
work are in [`FOR-DEV.md`](FOR-DEV.md); human-provided assets in
[`FOR-HUMAN.md`](FOR-HUMAN.md).

## Layout

```
uxnandesktop/
├── architecture/          # Spec (source of truth)
├── src/                   # SvelteKit frontend (SPA)
│   ├── app.css            # Tailwind v4 + shadcn-svelte tokens
│   ├── lib/
│   │   ├── api.ts         # typed wrappers over Tauri commands
│   │   ├── types.ts       # TS mirror of the Rust model
│   │   ├── utils.ts       # cn() helper
│   │   └── state/app.svelte.ts   # global reactive store (runes)
│   └── routes/            # +layout.svelte, +page.svelte (three-panel shell)
├── src-tauri/             # Rust backend
│   └── src/
│       ├── lib.rs         # Tauri builder, state wiring, command registration
│       ├── model.rs       # AppData / RepoData / WorktreeData / settings
│       ├── persistence.rs # atomic JSON (write-rename) + migrations
│       ├── state.rs       # AppState (RwLock<AppData> + PersistenceManager)
│       ├── commands.rs    # get_app_state / update_settings / ping
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
npm run build          # build the SPA → build/
npm run tauri dev      # run the desktop app (compiles Rust on first run)
```

Backend (from `src-tauri/`):

```bash
cargo test             # unit tests
cargo clippy --all-targets
cargo fmt
```

## Conventions

- Rust: `snake_case` fns, `PascalCase` types, `Result` + `thiserror`, async I/O
  on Tokio, tests in-file with `#[cfg(test)]`.
- Svelte 5: runes (`$state`/`$derived`/`$effect`), `PascalCase.svelte`
  components, `camelCase` members.
- Tailwind: utility-first, dark via the `.dark` class, tokens in `app.css`.
- Commits: Conventional Commits with desktop scopes (`rust`, `svelte`,
  `terminal`, `git`, `agent`, `tauri`, `bridge-embed`, `ui`, `config`).
