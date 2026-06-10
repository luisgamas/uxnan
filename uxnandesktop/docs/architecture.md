# Desktop — architecture orientation

A short map of how the code is organized and where it sits in the Uxnan
monorepo. The **authoritative specification** is in
[`../architecture/`](../architecture/00-index.md) — this file is a quick
orientation, not a replacement.

## What it is

Uxnan Desktop is the **Agent Development Environment (ADE)**: a terminal-centric
desktop app that orchestrates multiple CLI AI agents in parallel, each isolated
in its own git worktree and pseudoterminal. It is an orchestration / monitoring /
change-review layer, **not** an IDE.

## Three actors

The system keeps three sources of truth in sync (spec §1 of
`architecture/02a-system-architecture.md`):

```
Rust backend (Tauri core)  ──Tauri commands (invoke) + events (emit/listen)──►  Svelte webview
   repos/worktrees, PTY,                                                          UI state, layout,
   git2+CLI, persistence,                                                         active selection
   agent-hook HTTP server                                                              │
        ▲                                                                              │
        └───────────────────────── Tauri events (PTY I/O streaming) ◄─────────────────┘
                                            │
                                   PTY processes (CLI agents)
```

- **Commands** (`invoke`) — request/response (`get_app_state`, future
  `worktree_create`, `pty_write`, `git_stage`, …).
- **Events** (`listen`) — streaming (`pty:output:{id}`, `git:status-changed`,
  `agent:status-changed`).

## Backend modules (`src-tauri/src/`)

| File | Responsibility |
|---|---|
| `lib.rs` | Tauri builder: loads state at startup, registers commands. |
| `model.rs` | Persisted data model: `AppData → RepoData → WorktreeData`, settings, agent state, `SCHEMA_VERSION`. |
| `persistence.rs` | Atomic JSON (write-rename) + schema migration. |
| `state.rs` | `AppState { RwLock<AppData>, PersistenceManager }` (managed by Tauri). |
| `commands.rs` | The `#[tauri::command]` surface. |
| `error.rs` | `AppError` (internal) + serializable `CommandError`. |

Phase 1+ adds `pty`, `git`, and agent-hook modules — see
[`../FOR-DEV.md`](../FOR-DEV.md).

## Frontend (`src/`)

- `lib/types.ts` — TS mirror of the Rust model (Serde emits `camelCase`).
- `lib/api.ts` — typed wrappers over the Tauri commands.
- `lib/state/app.svelte.ts` — global reactive store (Svelte 5 runes).
- `routes/+layout.svelte` — global styles, store hydration, theme sync.
- `routes/+page.svelte` — the three-panel shell (left/center/right + resize).

State lives in runes (`$state`/`$derived`); no external state library.

## Where the desktop sits in the monorepo

| Component | Relationship |
|---|---|
| [`bridge/`](../../bridge/) | Node daemon that connects the **mobile app** to the PC's agents over E2EE. Implemented; it's the contract reference. The desktop can **embed** it as a Tauri sidecar (Phase 6) so the phone connects directly to the desktop. |
| [`relay/`](../../relay/) | Relay server for off-LAN (WAN) connectivity; forwards opaque E2EE envelopes. Optional. |
| [`uxnanmobile/`](../../uxnanmobile/) | Flutter remote control for the agents running on the PC. |
| [`shared/`](../../shared/) | Shared JSON-RPC/type contracts between bridge, relay, and mobile. The embedded bridge reuses these. |

## Key conventions

- **Terminal-centric:** agents are plain CLI processes in a PTY — no agent SDKs,
  no per-agent adapters in the desktop. Any CLI agent works unmodified.
- **Worktrees as isolation:** parallelism comes from git worktrees, not branch
  switching.
- See [`development.md`](development.md) for run/build and the code conventions
  recap in [`../README.md`](../README.md).
