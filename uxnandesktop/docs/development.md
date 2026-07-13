# Desktop — development & running in debug

![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A518-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![Rust](https://img.shields.io/badge/Rust-stable-000000?style=for-the-badge&logo=rust&logoColor=white)
![Package manager](https://img.shields.io/badge/use-npm,_not_pnpm-CB3837?style=for-the-badge&logo=npm&logoColor=white)
![Dev server](https://img.shields.io/badge/Vite-localhost%3A1420-646CFF?style=for-the-badge&logo=vite&logoColor=white)

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

The Projects sidebar performs a lightweight worktree reconciliation every 3
seconds while the shell is mounted. This also discovers worktrees created by an
agent CLI or another Git process; the manual refresh button remains available
for an immediate pass.

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
npm run check         # rune guard + svelte-check (sync + type check)
npm run check:watch   # re-run on change
npm run check:runes   # just the rune guard (see below)
```

> **Runes must live in `.svelte` / `.svelte.ts` files (not plain `.ts`).**
> Svelte 5 runes (`$state`, `$derived`, `$effect`, `$props`, …) are compiled by
> the Svelte compiler, which only processes `.svelte` and `.svelte.ts`/`.svelte.js`
> files. Put a rune in a plain `.ts` and it is left as a bare identifier that
> throws a `ReferenceError` at runtime (a blank white screen — it crashes the
> component that imports it). Neither `svelte-check` (runes are ambient types)
> nor `vite build` catches this, so `npm run check` runs a guard
> (`scripts/check-runes.mjs`, also in desktop CI) that **fails** if a rune appears
> in a plain `.ts`. Fix: name the module `*.svelte.ts` (e.g. `state/*.svelte.ts`,
> `updateToast.svelte.ts`) and import it accordingly.

## Project layout (where things live)

```text
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
