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
OSC/process layers, settings/themes/i18n). 85 Rust backend tests; **no frontend
tests yet**. macOS is **unvalidated** (developed on Windows; CI is `{ubuntu,
windows}`). **Phase 6 (embedded bridge / mobile pairing) is NOT started.**

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

**Git & worktrees**
- [ ] Image diffs in the diff viewer (visual before/after for image files).

**Agents**
- [ ] Env vars per agent; better arg quoting/escaping for the injected command.
- [ ] Prefer CMD over PowerShell for agent launch on Windows.
- [ ] Agent auto-launch on worktree create (per-worktree agent default).
- [ ] **Multi-agent orchestration** (task graph, @type routing, fan-out; spec
      `02d` §3).

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
- [ ] E2E tests (Playwright / WebdriverIO + tauri-driver) **and** frontend (Vitest)
      component tests — there are none yet.

## Platform validation

- [ ] **macOS** is unvalidated end-to-end (no macOS CI; developed on Windows).
- [ ] **keep-awake** is implemented for macOS/Linux but **untested** there
      (`power.rs`); Windows works.

## CI/CD — release

- ✅ **Verify** — `.github/workflows/ci-desktop.yml` runs svelte-check + vite build +
  cargo fmt/clippy/test on `{ubuntu, windows}` (macOS deferred with Apple). 85 tests.
- ✅ **`release-desktop.yml`** — exists: `tauri-action` bundles on a `desktop-v*` tag
  → draft GitHub Release. **Windows ships unsigned for now; macOS deferred.**
- [ ] **Code-signing** — Windows Authenticode + macOS Developer ID + notarization
      (human-provided certs — see `FOR-HUMAN.md`). The build runs unsigned without
      them (OS "unknown publisher" warnings).
- [ ] **Auto-updater (real)** — DEFERRED by decision; `tauri-plugin-updater` + an
      `updater` block + a signing keypair (`TAURI_SIGNING_PRIVATE_KEY`) + a hosted
      `latest.json`. Until then installers are downloaded manually.
- [ ] **In-app version checker** — DEFERRED. Notify on a newer GitHub Release and let
      the user decide (no silent install).

## Cross-cutting / standing rules

- [ ] Tests for every public function (AGENTS.md, ALPHA) — Rust done; **add Svelte
      Vitest component tests**.
- [ ] Lint/format gate before "done": `cargo clippy` + `cargo fmt` + `npm run check`.
- [ ] Tauri capabilities: expose only the commands a window needs; no arbitrary
      FS/network from the frontend (spec §4.2). **Not yet audited.**
