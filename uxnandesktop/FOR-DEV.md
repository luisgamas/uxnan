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
| **3** | Git status & diffs | ✅ **DONE** — right-panel review (status/diff/stage/discard/commit), live status watcher (3 s, focus-paused), push/pull, CodeMirror 6 diff viewer; `git2` migration + side-by-side/hunk staging → Phase 5 |
| **4** | Agent monitoring | ✅ **DONE** — activity inference + **Layer 1 HTTP hook server** (precise working/blocked/waiting/done, persistent cache) + Layer 2 terminal-title inference + colored status dots + unread/done badges + custom agent logos + per-worktree agent override. Ready-made per-agent hook configs + orchestration = follow-ups |
| **5** | Polish & UX | ✅ **DONE** — hunk-level staging, full-size center diff panel + side-by-side, rotating backups + sequential migrations, opt-in keep-awake (Windows), worktree palette (Ctrl/Cmd+P), TabGroup split buttons, virtualized lists. Follow-ups (non-blocking): keep-awake macOS/Linux, async-debounce persistence, sidebar-tree virtualization, E2E tests; secrets → Phase 6 |
| **6** | Bridge integration (mobile pairing) | ☐ **NOT STARTED** — embed the Node bridge as a Tauri sidecar + QR pairing. Optional for standalone use; required to act as the mobile bridge |
| **S** | Settings, design system & i18n (cross-cutting) | ✅ **DONE** — Settings (theme + terminal profiles w/ OS templates), **design tokens**, **full i18n (EN/ES + Language picker)**, **agents registry + manual launch**, **auto-launch on worktree create**, and Phase-4 **status monitoring**. (Custom / import-export themes = optional follow-up) |

Estimate (spec §2): 11–17 weeks for Phases 0–5 solo; +2–3 wk for Phase 6.

> **MVP status (2026-06-16): Phases 0–5 + cross-cutting (S) are complete.** The
> desktop ADE is **functional for an ALPHA release as a standalone app** (manage
> repos/worktrees, multiplexed terminals, launch + monitor agents, full git
> review with hunk staging & diffs, settings/i18n/theming). The only remaining
> roadmap phase is **6 (embedded bridge / mobile pairing)**, which is *optional
> for standalone use*. Pre-release gaps before distributing builds: branded icons
> + signing/updater keys (`FOR-HUMAN.md`) and a CI/CD pipeline (see
> "CI/CD — release builds" below).

### Where we are (2026-06-16)

**Phases 0–5 + the cross-cutting track (S) are complete** — the ADE is
alpha-functional as a standalone app:
- **0** infra · **1** terminals (splits, copy/paste, file-drop, persisted layout)
  · **2** git worktrees (hierarchical Projects tree, create/list/safe-remove,
  status badges, in-app picker, per-worktree terminal workspaces).
- **3** git status & diffs — right-panel review (Staged/Changes, per-file
  stage/unstage/discard, commit), **live status watcher** (3 s, focus-paused) +
  **push/pull**, and a **CodeMirror 6** diff viewer.
- **Cross-cutting (S):** Settings, design tokens, full **i18n (EN/ES)**, and the
  **agents track** — registry + install-detection **catalog** with brand logos,
  **run-inside-chosen-shell** launch, and **auto-launch a default agent on
  worktree create**.

- **4** agent monitoring — activity inference + native notifications, **Layer 1
  HTTP hook server** (precise `working`/`blocked`/`waiting`/`done`, persistent
  cache), **Layer 2** terminal-title inference, colored status dots, unread/done
  badges, custom agent logos, and per-worktree agent override.

- **5** polish — hunk-level staging, full-size center diff panel + side-by-side,
  rotating backups + sequential migrations, opt-in keep-awake (Windows), worktree
  palette (Ctrl/Cmd+P), TabGroup split buttons, virtualized lists.

**Next up — Phase 6 (bridge integration / mobile pairing):** the only remaining
roadmap phase, and *optional for standalone use* — embed the Node bridge as a
Tauri sidecar + QR pairing. Before distributing builds: a CI/CD pipeline (see
"CI/CD — release builds") + branded icons/signing (`FOR-HUMAN.md`).

**Phase 4 follow-ups (not blocking):** ready-made per-agent hook configs (Claude
Code + generic wrapper) so precise states work out-of-the-box **+ a precise
status dot in the terminal tab strip** (both shipped). Multi-agent
orchestration (`02d` §3) remains.

Smaller non-blockers (tracked below): backend debounced persistence + rotating
backups, `git2` migration, WSL paths, tab reorder/MRU, branded icons
(`FOR-HUMAN.md`).

**In-app toast/notification system** (`svelte-sonner`) — replace the inline,
dismissible error banners (left sidebar `projects.error`, right panel
`git.error`) with non-blocking, auto-expiring toasts for errors and successes
(e.g. "worktree removed", "pushed"). Distinct from the **OS-level** notifications
in Phase 4, which are for agent-completion events. **FOR-DEV.**

**Windows shells out-of-the-box + npm-shim execution.**
- [x] **Detect installed shells** — Settings → Terminal greys out uninstalled
      template shells and offers "Add detected shells" (reuses `agents_detect`);
      the fresh-install seed is now PowerShell + CMD (Windows) / login shell +
      bash (Unix), and an untouched empty-starter is upgraded on load.
- [x] **`-ExecutionPolicy Bypass`** on the seeded + template PowerShell profiles
      so npm `.ps1` shims run under the default Restricted policy.
- [ ] Still open: optionally **prefer CMD for agent launch** on Windows (the
      `.cmd` shim runs regardless of policy) as an alternative to Bypass; decide
      per-agent vs global. **FOR-DEV.**

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
- [x] **Agents registry + catalog with install detection** — **Settings → Agents**
      shows a catalog of known agents (Claude Code, Codex, Gemini CLI, OpenCode,
      Pi, Antigravity, Goose, Grok, Kilo Code, Kimi, Qwen Code) with brand logos;
      the backend (`agents_detect` → `which.rs`, PATH+PATHEXT) detects which are
      installed and only those are addable (one-click / "Add all installed").
      Plus "Add custom agent". Persisted in `AppSettings.agentProfiles` (Rust
      `AgentProfile` {command, args, `terminalProfileId`, `icon`} + `types.ts`,
      `#[serde(default)]`). `agentCatalog.ts`, `AgentLogo.svelte`,
      `static/agents/*.svg`, `Settings.svelte`, `AgentProfileEditor.svelte`.
- [x] **Manual agent launch (shell-aware)** — a Bot menu (`LaunchAgentMenu.svelte`)
      on every project header and worktree row launches the chosen agent into that
      worktree's terminal workspace. The agent runs **inside its chosen terminal
      profile** (per-agent shell, default = default profile): the ADE opens that
      shell and types the command (`runCommand`, transient), so PATH/PATHEXT shims
      (`.cmd`/`.ps1`) resolve — fixes agents not starting under Windows PowerShell.
      Deep-links to Settings → Agents when none are configured;
      `app.openSettings(section)`.

**Done — agents (cont.):**
- [x] **Auto-launch a default agent on worktree create** — `AppSettings.
      defaultAgentId` (Settings → Agents → "Default agent", `None`/off by default);
      `projects.createWorktree` launches it via `app.launchAgent` (run-inside-shell)
      in the new worktree after creating + selecting it. Opt-in. Closes Tier-2
      **T2.2** (spec `02b §5.1`).

**Done — agents (cont.):**
- [x] **Per-worktree agent override** at creation — the new-worktree dialog's
      "Launch agent" picker (None + configured agents) overrides the global
      default; `projects.createWorktree` takes an `agentId` (Phase 4).
- [x] **Custom agent logos** — pick any image per agent (Settings → Agents),
      stored inline as a `data:` URL on `AgentProfile.icon` (`logo.ts`).

**Pending — agents:**
- [ ] **Env vars per agent**, if a launch flow needs them.
- [ ] **Arg quoting** in the injected command is best-effort (quote-if-spaces);
      revisit if an agent needs shell-specific escaping. **FOR-DEV.**

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
- [x] **Rotating backups** — 5 numbered backups rotated before each atomic write
      (`persistence.rs`, Phase 5). The **250 ms Tokio debounce** for `save` is
      still a follow-up; deferred since the frontend already debounces the
      high-frequency layout writes. **FOR-DEV.**
- [x] **Migration arms** — `persistence::migrate` now applies sequential
      `v→v+1` steps via `migrate_step` (add an arm per future schema bump).
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
- **Modern keyboard protocol** (CSI-u / "fixterms" / kitty) — for full key
  fidelity with agent TUIs. Done so far: `Ctrl+←/→` word-nav (xterm default),
  and **Shift/Alt+Enter → newline** (best-effort `\n`; agents using readline may
  still treat it as submit). Not yet: a distinct, agent-detectable Shift+Enter
  and richer modifier combos (e.g. `Ctrl+Shift+←/→` selection) — these need the
  CSI-u protocol negotiated with the agent. Fits the terminal engine; doesn't
  change direction. **FOR-DEV.**
- **Alt-screen scrolling** — agent TUIs (full-screen, `?1049h`) disable scrollback
  by design (standard, like `vim`/`htop`); the redundant-resize SIGWINCH that made
  them repaint/jump is fixed (`fitToPane` only resizes on a real size change +
  debounced). Capturing alt-screen output to a scrollable log is a possible future
  nicety. **FOR-DEV.**

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

## Phase 3 — Git status & diffs ✅

**Goal:** see and act on file changes in real time.

**Done (increment 1 — review loop, git CLI):**
- [x] Ops via git CLI (`git.rs`): `git_status` (porcelain v1 `-z`, rename-aware →
      `FileChange`), `git_diff` (tracked + untracked via `--no-index`),
      `git_stage`/`git_unstage`/`git_stage_all`/`git_unstage_all`/`git_discard`/
      `git_commit`. `api.ts` wrappers + `git` store keyed by the active worktree.
- [x] Right panel (`RightPanel.svelte`): **Staged** / **Changes** sections (a file
      can appear in both), per-file stage/unstage/discard (discard confirms),
      stage-all/unstage-all, commit composer. Reloads on worktree switch / after
      each action / manual refresh.
- [x] Diff viewer (`DiffView.svelte`): colorized unified diff in a dialog (since
      rebuilt on CodeMirror 6 — see increment 3).

**Done (increment 2 — live status + push/pull):**
- [x] **Real-time status**: a Tokio-interval watcher (3 s) polls the watched
      worktree and emits `git:status-changed { path, files, ahead, behind }` only
      when it changes; **pauses while the window is unfocused** (Tauri
      `WindowEvent::Focused`). `git_set_watch` selects the worktree; the store
      applies events for the shown worktree (skipping mid-action). Uses the git
      CLI (the `git2` migration below is still open).
- [x] **Push / pull**: `git_push`, `git_pull --ff-only`, with an ahead/behind bar
      in the commit composer (Pull/Push buttons enabled per ahead/behind).

**Done (increment 3 — CodeMirror diff viewer):**
- [x] **CodeMirror 6 diff viewer** (`@codemirror/state` + `@codemirror/view`):
      read-only, virtual-scrolls large diffs, text selection, add/remove/hunk
      line decorations (replaces the hand-rolled renderer). Diff fetch aborts
      after **30 s** so the UI can't hang.

**Deferred → Phase 5 (polish) or tracked below:**
- [ ] **`git2` migration** for high-frequency status/diff (Phase 3 uses the CLI,
      consistent with Phase 2; `git2` avoids per-poll subprocess overhead).
      **FOR-DEV.**
- [ ] **Side-by-side diff**, **hunk/line-level staging**, virtual-scroll polish for
      huge changesets → **Phase 5**.
- [ ] **AI commit message** (needs an agent/bridge), **image diffs** → later.
- [ ] The commit composer uses a plain styled `<textarea>`; could adopt the
      shadcn `Textarea`/`Field` components. **FOR-DEV.**

---

## Phase 4 — Agent monitoring ✅

**Goal (met):** know what each agent is doing in each worktree.

**Done (increment 1 — activity inference, universal):**
- [x] **Infer status from terminal output** (no agent cooperation): a tab
      producing output is "working"; quiet for 3 s → idle; exited → done.
      `agentMonitor` (frontend) drives `tab.working`; the worktree row/card and
      the tab bar show a pulsing dot — universal (any terminal, even a manual CLI).
- [x] **Native notification** (`tauri-plugin-notification`) when an *agent* tab
      (one launched via the agent flow, so it's tagged) settles idle (≥ 12 s)
      while you're **not looking at its terminal** (different workspace/tab, or
      the window is unfocused) — one per idle period, re-armed on new output.
      Opt-out via **Settings → Agents → Idle notifications**
      (`AppSettings.agentNotifications`). Permission primed on agent launch.
- [x] **Per-agent sidebar rows** (`AgentSpace`): each project + worktree shows a
      collapsible list of its **agent terminals** (`tab.agentName` /
      `tab.agentIcon`) — logo + name + working spinner (or a green "detected" dot
      when idle), click jumps to the terminal; collapsed shows count + aggregate
      spinner. Plain terminals get no row. Replaced the generic
      activity-dot/terminal-count on card headers.
- [x] **Process detection (Layer 3)** — a 2 s backend scan (`procscan` +
      `sysinfo`) walks each terminal's process tree and emits `agent:detected`
      with the agent command running in it (matched by exe name or command-line
      token, so node-shim CLIs resolve), driving the sidebar row + tab name for
      **any** terminal, including agents the user runs by hand; clears when the
      agent exits. Commands to look for are synced via `set_agent_commands`.

> **NOTE — precise states now implemented (increment 2–3).** The coarse activity
> inference (active vs idle) is complemented by the **HTTP hook server** (Layer 1,
> `02d`): agents that support hooks POST `working/blocked/waiting/done` to a
> localhost endpoint and the UI shows the exact state. Wiring a *specific* agent
> to call it is still per-agent setup — see `docs/agent-hooks.md` and the
> ready-made-config follow-up below.

**Done (increment 2 — Layer 1 hook server):**
- [x] **Local HTTP hook server (`axum`)** + normalized states + persistent cache
      (`AppData.agent_cache`, keyed by `agentId`, TTL 7 d / 30 min stale) +
      `agent:status-changed`. Binds an ephemeral `127.0.0.1` port (`hooks.rs`),
      injects `UXNAN_HOOK_URL`/`UXNAN_HOOK_TOKEN`/`UXNAN_AGENT_ID` into every
      terminal (`PtySpec.env`), token-guarded (`X-Uxnan-Token`). Commands
      `get_hook_info`/`agent_states`; frontend `agentStatus` store hydrates +
      stays live. Contract: [`docs/agent-hooks.md`](docs/agent-hooks.md).

**Done (increment 3 — precise states in the UI + badges + logos + override):**
- [x] **Consume precise states in the UI** — colored dots (`AgentStatusDot`,
      `resolveAgentDisplay`) on agent rows: working green / blocked amber /
      waiting orange / done blue / idle gray, stale (>30 min) dimmed; hook state
      preferred over title over activity.
- [x] **"Unread / done" badge** on worktrees + project headers (`unread` store):
      flagged when an agent finishes/settles idle while unobserved, cleared on
      open or window focus; dock/taskbar count via `setBadgeCount`.
- [x] **Custom agent logos** — pick any image (Settings → Agents), stored inline
      as a 64×64 PNG `data:` URL on `AgentProfile.icon` (`logo.ts`); ✕ resets to
      the catalog logo; rendered everywhere (`agentLogoSrc` passes data URLs).
- [x] **Per-worktree agent override** — "Launch agent" picker in the new-worktree
      dialog overrides the global default (`projects.createWorktree` `agentId`).
- [x] **Foreground-process detection** (Layer 3) — catches agents run manually.
- [x] **Terminal-title (OSC) parsing (Layer 2)** — `onTitleChange` →
      `agentMonitor.noteTitle` → `statusFromTitle` (`agentTitle.ts`); merged with
      Layers 1/3 by `resolveAgentDisplay` (`agentDisplay.ts`).

**Deferred (follow-ups / orchestration):**
- [x] **Ready-made per-agent hook configs** — the ADE now ships a Claude Code
      `hooks` config + a Node CJS script (no deps, cross-platform) and a
      generic wrapper (Bash / PowerShell / cmd) that POST to `UXNAN_HOOK_URL`.
      On every startup the ADE writes them to `<app-data>/hooks/`. **Settings
      → Agents → Hooks** surfaces a one-click **Install** for Claude Code
      (merges the ADE-managed `hooks` block into `~/.claude/settings.json`,
      preserving every other key; **Uninstall** is its reverse), and the
      generic wrapper script + its absolute path so users can wire it as
      the launch command of any other agent (`uxnan-hook-wrapper.sh` on
      Unix, `.ps1` on Windows PowerShell, `.cmd` as the no-PowerShell
      fallback). Out-of-the-box precise states (`working` / `waiting` /
      `done` / `blocked`) — no manual JSON editing. The pane also shows the
      exact rendered JSON and a Copy button for users who prefer to paste
      by hand. (`src-tauri/src/agent_hooks.rs`,
      `src/lib/components/AgentHooksPanel.svelte`, `static/hooks/*`.)
- [ ] **Multi-agent orchestration** (task graph, @type routing, fan-out,
      backpressure, sidebar lineage) per `02d` §3. **FOR-DEV.**
- [x] **Tab-bar status indicator** — the terminal tab strip now uses the same
      precise `AgentStatusDot` as the sidebar (working / blocked / waiting /
      done / idle, stale dimmed), driven by `resolveAgentDisplay` with the
      same hook › title › activity priority. The coarse pulsing dot from
      `tab.working` is gone. Agent tabs whose state isn't coming from the
      hook server get a subtle `Webhook` icon next to the dot that opens
      **Settings → Hooks**, so users see they can wire up the ready-made
      configs for precise states.

---

## Phase 5 — Polish & UX ☐

- [x] **Hunk-level (partial) staging** — done via `git apply --cached`/`--reverse`
      on a single-hunk sub-patch built in the frontend (`git_apply` /
      `git::apply_patch`, `diff.ts`, `DiffView` hunk bar). (Untracked-file partial
      stage is a known edge case — whole-file stage works.)
- [x] **Rotating backups + schema-migration hardening** (`persistence.rs`): 5
      numbered backups rotated before each atomic write; `migrate` applies
      sequential `v→v+1` steps and rejects future versions. Debounced async
      writer still a follow-up (frontend already debounces layout). Closes the
      Phase 0 follow-up.
- [x] **System-suspension prevention** while an agent is `working` — opt-in
      (`AppSettings.preventSleep`), 2 h auto-release safety cap (`power.rs`,
      `set_prevent_sleep`, driven by `anyAgentWorking()`). **All three platforms:**
      Windows (`SetThreadExecutionState`), macOS (`caffeinate -i`), Linux
      (`systemd-inhibit`). **macOS/Linux implemented but UNTESTED** (developed on
      Windows). Released on exit; Settings toggle in Settings → Agents.
- [x] **Side-by-side diffs** — two synced CodeMirror views (old left / new right)
      with a unified/side toggle in the full-size center `DiffPanel` (`DiffView`,
      `toSideRows`).
- [x] **Quick worktree search** — command palette (`WorktreeSearch`, Ctrl/Cmd+P
      or sidebar ⚡): filter all worktrees, ↑/↓ + Enter to jump.
- [x] **TabGroup-level splits** — visible split-right/down buttons on each
      region's tab bar (`TerminalArea`).
- [x] **TanStack Virtual** — `VirtualList` (`@tanstack/svelte-virtual`) on the
      worktree palette + the right-panel changed-files list (single virtualized
      scroll). Diff already virtual via CodeMirror.
- [x] **Settings toggle for prevent-sleep** — Settings → Agents
      (`AppSettings.preventSleep`).
- [x] **Keep-awake on macOS/Linux** — implemented (macOS `caffeinate -i`, Linux
      `systemd-inhibit`, both as a child held for the duration; `power.rs`).
      **Done WITHOUT real validation — UNTESTED on macOS/Linux** (no hardware to
      verify; CI will at least confirm it compiles per-OS). A status-bar notice
      flags the untested platform in the UI.
- [ ] **TanStack Virtual** for the project tree (sidebar) — done for the worktree
      palette + the right-panel changed-files list; the hierarchical tree is left
      (variable-height/expand-collapse, low payoff). **FOR-DEV.**
- [ ] Stronghold/keyring for any secret (never plaintext JSON) — **deferred to
      Phase 6** (no secrets are persisted yet; the hook token is ephemeral).
- [ ] E2E tests (Playwright/WebdriverIO) for the main flows — **deferred** (heavy
      harness: tauri-driver + packaged app); do after the rest of Phase 5.

---

## File tree tab + center file editor ✅

A second right-panel view alongside git review, plus an editable center editor.

**Done:**
- [x] **Tabbed right panel** (`RightPanel.svelte`, shadcn-svelte Tabs): **Files**
      (first) + **Changes** (the prior review UI, extracted to
      `ChangesPanel.svelte`). Git status is loaded in the always-mounted parent so
      the Files tab is colored even while Changes is unmounted.
- [x] **File-tree tab** (`FileTreePanel.svelte` + `fileTree.svelte.ts`): lazy
      per-folder listing (`fs_list_dir`), `.git` hidden, folders-first sort.
      Changed files colored (untracked/deleted/modified) + parent folders colored
      when they contain changes (reuses the right-panel git status). Tree state in
      a store so it survives tab switches.
- [x] **File editor** (`FileEditor.svelte`): editable CodeMirror 6 + syntax
      highlighting per extension (`editorLang.ts`), line numbers, undo/redo. Git
      change gutter — added lines (vs `HEAD`) highlighted + a left-edge marker
      that peeks **only** the removed lines (`git_diff_head`, `parseHeadDiff`).
      Save via button or **Ctrl/Cmd+S** (`fs_write_file`, atomic). Binary /
      too-large guards (`fs_read_file`).
- [x] Backend `fs.rs` (`fs_list_dir`/`fs_read_file`/`fs_write_file`) +
      `git::diff_head`; 3 unit tests. Spec: `architecture/02c-git-worktrees.md` §6.
- [x] **File-tree toolbar**: search/filter, collapse-all, expand-all, **reveal in
      the OS file manager** (`reveal_path` via the opener plugin), refresh.
- [x] **Changes tab**: row click opens the diff (eye button removed).
- [x] **Configurable keyboard shortcuts** — `keybindings.ts` +
      `AppSettings.keybindings` + **Settings → Keyboard shortcuts** (rebind / reset
      / disable). `Ctrl/Cmd+W` closes the center overlay; save key flows into the
      editor's CodeMirror keymap.
- [x] **Settings full-screen polish** — centered section column, **Hooks** in its
      own nav item, clearer active/selected styles in the left panel + file tree.

**Deferred (non-blocking) — FOR-DEV:**
- [ ] **Tree virtualization** (TanStack Virtual) for very large folders — the tree
      renders a flat list; fine for typical folders, revisit if a single directory
      has thousands of entries. **FOR-DEV.**
- [ ] **Unsaved-edit guard** — re-opening a file (or switching files) discards
      unsaved edits silently; add a confirm/keep-dirty prompt. **FOR-DEV.**
- [ ] **File ops from the tree** — create / rename / delete / new folder context
      menu. **FOR-DEV.**
- [ ] **External-change watcher** — the editor doesn't auto-reload when the file
      changes on disk (e.g. an agent edits it); refresh is manual via re-open.
      **FOR-DEV.**

## Personalization — custom themes + terminal appearance ✅

- [x] **Theming engine** (`src/lib/theme.ts`): single-palette themes (base
      light/dark) over every shadcn token + radius + fonts; `applyTheme` writes
      CSS vars on `<html>`. Built-ins (System/Light/Dark/Midnight/Latte).
- [x] **Settings → Appearance** (`ThemeSettings`/`ThemeEditor`): pick / new /
      edit (visual + JSON) / duplicate / delete; import/export via file + clipboard.
- [x] **Themeable fonts** (`--ux-font-body|title|mono`) + **terminal appearance**
      overrides (`TerminalAppearance`, `resolveTerminal`): font/size/line-height/
      spacing/weight, ligatures (`@xterm/addon-ligatures`), cursor, full ANSI set.
- [x] Model: `AppSettings.activeThemeId` / `customThemes` / `terminalTheme`
      (frontend-owned, persisted opaquely). Docs: `docs/theming.md`.

**Deferred (non-blocking) — FOR-DEV:**
- [ ] **Import font *files*** (.ttf/.otf/.woff2) — embed via `@font-face` /
      data URLs so a theme is portable across machines without the family being
      installed. Today only installed font families (by name) are supported.
      Marker in `src/lib/theme.ts` module doc. **FOR-DEV.**
- [ ] **Live ligature toggle** — toggling ligatures currently applies on the next
      opened terminal (the renderer addon can't swap on a live xterm). Recreate
      the terminal in place to apply immediately. **FOR-DEV.**
- [ ] **Drop the legacy `theme` field** — superseded by `activeThemeId`; kept for
      now to avoid a migration. Remove in a future schema bump. **FOR-DEV.**

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

## CI/CD — release builds (GitHub Actions) — TODO (alpha-ready)

> **FOR-DEV.** Phases 0–5 are complete and the ADE is alpha-functional as a
> standalone app, so the next infra step is a pipeline that **verifies, then
> builds** for every target OS. Two workflows:

**1. `ci.yml` — verify on every push / PR** (gate; no packaging):
- Matrix: `windows-latest`, `macos-latest`, `ubuntu-latest`.
- Steps: checkout → setup Node (20+) + Rust (stable, with `rustfmt`/`clippy`) →
  cache cargo + node → Linux only: install Tauri system deps
  (`libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `librsvg2-dev`, `libayatana-appindicator3-dev`,
  `patchelf`, `build-essential`).
- **Verification gates (must all pass before any build):**
  - `npm ci`
  - `npm run check` (svelte-check, 0 errors)
  - `npm run build` (SPA → `build/`, needed by `generate_context!`)
  - `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`
  - `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
  - `cargo test --manifest-path src-tauri/Cargo.toml`
  - (when E2E lands) the WebdriverIO/tauri-driver suite.

**2. `release.yml` — build installers on a version tag** (`v*`):
- Same matrix; reuse the verify gates (or `needs: ci`), then build with
  **`tauri-apps/tauri-action`** (runs `npm run build` + `cargo build --release`
  + bundles). Targets: Windows `.msi`/NSIS, macOS `.dmg`/`.app` (ideally a
  universal `aarch64`+`x86_64` build), Linux `.deb`/`.AppImage`.
- Upload artifacts / attach to a GitHub Release (draft).

**Blocking before a *signed/distributable* release (FOR-HUMAN):**
- Branded app icons + bundle identity (replace default Tauri icons).
- Code-signing: Windows Authenticode cert, macOS Developer ID + notarization
  (Apple ID / team id / app-specific password as repo secrets).
- Tauri updater public key (if auto-update is enabled) + signing key as a secret.
- These are in `FOR-HUMAN.md`; the build itself runs unsigned without them
  (degraded: OS "unknown publisher" warnings), so CI can produce artifacts now.

**Notes:** the machine's home `pnpm-workspace.yaml` hijacks `pnpm install` here —
CI uses `npm ci`. `cargo test` needs the SPA built first (the Tauri
`generate_context!` reads `frontendDist = ../build`).

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
