# Changelog — uxnan-desktop

All notable changes to the Uxnan Desktop ADE are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/). Versioning: [SemVer](https://semver.org/).

## [Unreleased]

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
