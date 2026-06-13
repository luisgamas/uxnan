# Desktop — development & running in debug

How to set up, run, and iterate on Uxnan Desktop locally. For release builds see
[`build.md`](build.md); for the verification gates see [`testing.md`](testing.md).

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| **Node.js** | ≥ 18 (dev/tested on 24) | Frontend toolchain. |
| **npm** | bundled with Node | **Use npm here, not pnpm** — see the gotcha below. |
| **Rust** | stable (dev/tested on 1.95) | Backend. Install via [rustup](https://rustup.rs/). |
| **Tauri 2 system deps** | per OS | WebView2 (Windows, preinstalled on Win 11), WebKitGTK + build-essential (Linux), Xcode CLT (macOS). See the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/). |

> **Gotcha — use `npm`, not `pnpm`, in this directory.** The machine has a
> `~/pnpm-workspace.yaml`, so `pnpm install` ascends to the home workspace and
> installs **nothing** locally (it prints "Already up to date" and creates no
> `node_modules`). npm also matches the rest of the monorepo. The Tauri
> `beforeDev`/`beforeBuild` commands are set to `npm run …` accordingly.

## First-time setup

```bash
cd uxnandesktop
npm install          # frontend deps (creates node_modules + package-lock.json)
```

Rust dependencies are fetched and compiled on the first `cargo`/`tauri` build —
expect a few minutes the first time (Tauri pulls a large dependency tree).

## Run the full app in debug

```bash
npm run tauri dev
```

This runs the `beforeDevCommand` (`npm run dev` → Vite dev server on
`http://localhost:1420`), compiles the Rust backend in debug, and launches the
native window with **hot reload**: edits to `src/**` reload the webview
instantly; edits to `src-tauri/**` rebuild and restart the app.

**DevTools:** debug builds enable the webview inspector — right-click → *Inspect
Element* (or your platform's devtools shortcut) to debug the Svelte UI, console,
and network.

## Iterate on UI only (fast, in a browser)

For pure visual/layout work you don't need the Rust backend:

```bash
npm run dev          # Vite dev server → open http://localhost:1420 in a browser
```

The three-panel shell renders normally. Because a plain browser has no Tauri
runtime, the backend commands (`get_app_state`, `ping`) can't resolve, so the
status bar shows **"Backend unreachable"** and settings won't persist — that's
expected. Use `npm run tauri dev` whenever you need real backend behavior
(persistence, future PTY/git/agent features).

## Type-check while developing

```bash
npm run check         # one-shot svelte-check (sync + type check)
npm run check:watch   # re-run on change
```

## Project layout (where things live)

```
uxnandesktop/
├── src/                      # SvelteKit frontend (SPA)
│   ├── app.css               # Tailwind v4 + shadcn-svelte tokens
│   ├── lib/{api,types,utils}.ts, lib/state/app.svelte.ts
│   └── routes/+layout.svelte, +page.svelte
├── src-tauri/                # Rust backend
│   ├── src/{lib,model,persistence,state,commands,error}.rs
│   ├── tauri.conf.json       # window, identifier, bundle, before-commands
│   └── capabilities/         # per-window permission allow-lists
├── components.json           # shadcn-svelte config (for `shadcn-svelte add`)
└── docs/                     # you are here
```

## Adding shadcn-svelte components

The foundation (`components.json`, tokens in `app.css`, `cn()` in
`src/lib/utils.ts`) is in place. Add components on demand:

```bash
npx shadcn-svelte@latest add button dialog
```

They land under `src/lib/components/ui/` and inherit the design tokens.

## Common issues

- **`pnpm install` does nothing / no `node_modules`** → use `npm install` (see
  the gotcha above).
- **Window opens but status bar says "Backend unreachable"** → you're running
  the frontend in a plain browser (`npm run dev`); use `npm run tauri dev` for
  the backend.
- **First `tauri dev` is slow** → the Rust dependency tree compiles once; later
  runs are incremental.
- **Port 1420 in use** → Vite is configured with `strictPort`; stop the other
  process (the port is fixed because Tauri points at it).
