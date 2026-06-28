# FOR-DEV — uxnandesktop

Deferred developer work for the desktop ADE. Each deferred code item has, or will
have, a greppable `FOR-DEV:` marker at its site. (Distinct from `FOR-HUMAN.md`,
which tracks assets only a human can provide.)

> The implemented surface is documented in [`README.md`](README.md) +
> [`docs/`](docs/) and the phase plan in
> [`architecture/04-technical-reference.md`](architecture/04-technical-reference.md);
> this file tracks only what's left.

## Status

**Phases 0–5 + cross-cutting (S) are DONE — the ADE is alpha-functional as a
standalone app** (three-panel shell, PTY terminals + splits, git worktrees, git
status/diff/stage/commit/history, agent monitoring with the axum hook server +
OSC/process layers, settings/themes/i18n, multi-agent orchestration,
**in-app auto-updater**). 100 Rust backend tests + 25 frontend Vitest unit tests
(pure logic); **no Svelte component or E2E tests yet**. macOS is **unvalidated**
(developed on Windows; CI is `{ubuntu, windows}`). **Phase 6 (embedded bridge /
mobile pairing) is NOT started.**

**Built (DONE), in detail:**

- **Three-panel resizable shell** with atomic JSON persistence (5 rotating
  backups + sequential schema migrations).
- **PTY terminals** (`portable-pty 0.9`, xterm WebGL + DOM fallback) — tabs +
  nested splits that never remount on split, drag-to-reorder / move tabs across
  regions, `Ctrl+Tab` MRU cycling, a backend output ring buffer that restores a
  recreated pane's scrollback, and the Kitty/CSI-u keyboard protocol.
- **Git worktrees** — per-worktree terminal workspaces, hierarchical Projects
  tree, in-app directory picker, worktree palette (Ctrl/Cmd+P), squash-merged
  branch cleanup on removal, WSL repos routed through `wsl.exe`.
- **Full git review** — status / diff / stage / commit / push / pull with a 3 s
  focus-paused Tokio watcher, CodeMirror 6 diff viewer, hunk-level staging,
  side-by-side toggle, visual image diffs, and optional AI commit-message
  generation via a local CLI agent.
- **Agent monitoring (Phase 4)** — Layer 1 local HTTP hook server (`axum`, precise
  `working/blocked/waiting/done` + persistent cache) + Layer 2 terminal-title
  (OSC) + Layer 3 process-tree detection; colored status dots, unread/done badges,
  custom agent logos, per-worktree agent override.
- **Multi-agent orchestration** (spec `02d` §3) — a console (status bar, shown with
  ≥2 live agents) routing a message to all agents, one type (fan-out), or a
  coordinator's workers, with backpressure + an in-memory coordinator→workers task
  graph.
- **Cross-cutting (S)** — Settings (theme + terminal profiles w/ OS templates),
  design tokens, full EN/ES i18n + Language picker, agents registry + install
  detection + manual + auto-launch, per-agent env vars, a configurable agent
  launch shell (Command Prompt by default on Windows), virtualized lists
  (`@tanstack/svelte-virtual`), opt-in keep-awake (Windows).
- **In-app auto-updater** (`tauri-plugin-updater`) — Settings → Updates with
  stable/nightly channels (mapped to GitHub's pre-release flag), background
  download + agent-idle-guarded install (a restart stops agents, so the install
  waits for the safe window or explicit consent), banner UI, EN/ES i18n. Endpoint
  per channel + signing/CI in [`docs/updates.md`](docs/updates.md); signing key is
  a `FOR-HUMAN.md` item.

## Phase 6 — Bridge integration (embedded bridge / mobile pairing) ☐

**Goal:** let the desktop act as the mobile bridge (single-install). The standalone
bridge (`../bridge/`) is already implemented and is the contract reference
(`architecture/02e-bridge-integration.md`); this phase embeds it. **Nothing exists
yet on either side** — the bridge's `desktop/*` handler is also an empty stub
(`bridge/FOR-DEV.md`).

### Backend (Rust)
- [ ] Tauri **sidecar** for the Node bridge process; manage lifecycle
      (start/stop/restart/health).
- [ ] IPC (stdin/stdout JSON-RPC) between Rust and the bridge process; keep E2EE
      keys **inside** the bridge process (never exposed to the Rust core — spec §4.1).
- [ ] Commands: `bridge_start`, `bridge_stop`, `bridge_status`, `bridge_generate_qr`.
      Events: `bridge:connection-changed`, `bridge:mobile-connected`.

### Frontend (Svelte)
- [ ] Settings → Mobile connection: QR pairing dialog, connected-phone indicator,
      trusted-device management (reuses the bridge's `bridge/removeTrustedDevice`).

## Deferred follow-ups (non-blocking) — by area

**Terminal**
- [ ] Keyboard protocol — extend the Kitty/CSI-u surface beyond the current
      encoder: functional/navigation keys as CSI-u (arrows, F-keys, Home/End,
      keypad — they fall through to xterm's legacy encoding today), the
      alternate-keys (4) and associated-text (16) flags, and super/hyper/meta
      modifiers. Needs validation against a real Kitty-protocol TUI. The base
      protocol (negotiation + disambiguate / event-types / all-keys) is
      implemented in `src/lib/terminal/keyboardProtocol.ts`.
- [ ] Dispose hidden xterm renderers and rely solely on the backend ring buffer
      (today both coexist: the buffer restores recreated panes, but hidden tabs
      keep their xterm mounted). Would cut memory for many background terminals
      at the cost of a replay on every show.

**Agents** — env vars per agent, shell-aware quoting, the configurable Windows
launch shell (cmd by default), auto-launch on worktree create, and multi-agent
orchestration (in-memory task graph, @type/@all routing, fan-out, backpressure)
are **done** (see `CHANGELOG.md` + `architecture/02d` §3). Remaining follow-ups:
- [ ] **Orchestration lineage in the *main* sidebar.** The coordinator→workers
      task graph is surfaced in the orchestration console today (spec `02d` §3.4
      updated to match). Moving the nested lineage into the left project tree is
      a larger sidebar-tree refactor, deferred.
- [ ] **Agent-driven worker creation.** §3.1's "a coordinator *creates* worker
      agents in their own worktrees" needs an agent→ADE control channel that
      doesn't exist yet (agents are opaque CLIs). Today the user creates the
      worktrees/agents and designates the coordinator/workers. Unblocks with the
      embedded bridge / a local control API.
- [ ] Persist the per-worktree launch agent onto `WorktreeData.agentId` (today
      the choice drives the one-shot launch but isn't recorded on the worktree).

**File tree / mixed tabs**
- [ ] Tree virtualization (TanStack Virtual) for very large folders.
- [ ] File ops from the tree (create / rename / delete / new folder).
- [ ] Multi-worktree external-change watching (the watcher follows the active
      worktree only).
- [ ] Tab/region reorder + drag for the mixed `terminal|file|diff` tabs.

**Theming**
- [ ] Import font *files* (.ttf/.otf/.woff2) via `@font-face` (today: installed
      family name only).
- [ ] Live ligature toggle (currently applies on the next terminal).
- [ ] Drop the legacy `theme` field (superseded by `active_theme_id`; kept for
      back-compat).

**Polish / quality**
- [ ] Sidebar project-tree virtualization (worktree lists already virtualized).
- [ ] Stronghold/keyring for any secret (never plaintext JSON) — needed with Phase 6.
- [ ] E2E tests (Playwright / WebdriverIO + tauri-driver) **and** Svelte
      **component** tests (Vitest + jsdom). The Vitest harness + **unit** tests
      for pure logic now exist (`src/lib/*.test.ts`); component/E2E are still TODO.

## Platform validation

- [ ] **macOS** is unvalidated end-to-end (no macOS CI; developed on Windows).
- [ ] **keep-awake** is implemented for macOS/Linux but **untested** there
      (`power.rs`); Windows works.

## CI/CD — release

- ✅ **Verify** — `.github/workflows/ci-desktop.yml` runs svelte-check + `npm test`
  (Vitest) + vite build + cargo fmt/clippy/test on `{ubuntu, windows}` (macOS
  deferred with Apple). 100 Rust + 25 Vitest tests.
- ✅ **`release-desktop.yml`** — exists: `tauri-action` bundles on a `desktop-v*` tag
  → draft GitHub Release, **and signs the updater artifacts** when the signing
  secrets are set. **Windows ships without OS code-signing for now; macOS deferred.**
- ✅ **Auto-updater** — `tauri-plugin-updater` wired end-to-end in the app
  (`src-tauri/src/updater.rs` + Settings → Updates + banner; stable/nightly
  channels via GitHub's pre-release flag; background download + idle-guarded
  install). The rolling per-channel `latest.json` is published by
  `release-desktop-manifest.yml`. **Functional once
  the human supplies the signing keypair** (`FOR-HUMAN.md`) and publishes a signed
  release — until then `check()` finds nothing and the app runs normally. See
  [`docs/updates.md`](docs/updates.md).
- [ ] **Code-signing (OS)** — Windows Authenticode + macOS Developer ID +
      notarization (human-provided **paid** certs — see `FOR-HUMAN.md`).
      Independent of the (free) updater signature above; the build runs unsigned
      without them (OS "unknown publisher" warnings).

## Cross-cutting / standing rules

- [ ] Tests for every public function (AGENTS.md, ALPHA) — Rust done; pure-logic
      frontend modules covered by Vitest; **still add Svelte component tests**.
- [ ] Lint/format gate before "done": `cargo clippy` + `cargo fmt` + `npm run check`
      + `npm test`.
- [ ] Tauri capabilities: expose only the commands a window needs; no arbitrary
      FS/network from the frontend (spec §4.2). **Not yet audited.**
