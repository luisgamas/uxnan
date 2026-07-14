# Changelog — uxnan-desktop

All notable changes to the Uxnan Desktop ADE are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/). Versioning: [SemVer](https://semver.org/).

## [Unreleased]

### Added — richer provider usage (reset time, Codex resets, account type, $)

- **Absolute reset time.** Every quota window and credit line now shows *when* a
  limit resets (a localized clock/date — "resets in 2h · 3:00 PM"), not just a
  relative countdown, in the Settings card and (opt-in) the status-bar popover.
- **Codex "reset credits" (reinicios).** Settings → Providers now reads Codex's
  redeemable rate-limit resets (dedicated endpoint) and shows how many are available
  and **when each one expires** (per‑credit) — and lets you **redeem one directly
  from uxnan** (`usage_codex_redeem_reset` → the provider's `consume` endpoint)
  **behind a confirmation** (uxnan's shared `ConfirmDialog`) that spells out which
  reset is used, how many remain, and their expiries, then refreshes so the count
  and windows update.
- **Real $ balance for Grok.** The Grok reader now surfaces the on-demand spend vs
  cap (and any prepaid balance) the billing API exposes, as a $ credit line.
- **Account type.** The "Authenticated as …" line now carries an account-type badge
  (Subscription / Pay-as-you-go / Free / Team / Enterprise), derived per provider,
  so the kind of account is clear beyond the plan name.
- **Status-bar toggles.** New per-provider popover toggles to show/hide the reset
  time and Codex's reset credits, alongside the existing plan/credit/window picks.
- Contract additions (`shared/…/usage.ts`, `architecture/02b`): `account.accountType`,
  `ProviderUsage.resetCredits`, `CreditBalance.available` — all additive.

### Added — Orchestration run engine (chaining, headless, HITL gates, MCP)

- The multi-agent orchestration console gains a second surface. It is now two tabs:
  **Broadcast** (the fan-out router — **pick recipients explicitly** and route a
  message to them, backpressured) and **Runs** (a new deterministic **run engine**).
- **Runs** are a graph (DAG) of **steps**. Build a run in the console (New run → Add
  step), then Start / Pause / Resume / Cancel / Re-run it. Each step targets an agent,
  carries a prompt, and declares which steps it **runs after** — so steps chain,
  fan out in parallel, and fan in.
- **Context passing (A → B → C).** A step's prompt can plant a prior step's captured
  output with `{{steps.s1.output}}` / `.summary` / `.title` (insert-chips in the
  editor auto-add the dependency). Headless output is the full stdout; interactive
  output is the agent's hook summary or — when the step feeds a later one and the
  agent is MCP-capable — a structured report the ADE nudges it to send.
- **Three step types.** *Interactive* types the prompt into a live agent's terminal
  (completes on the hook/idle signal). *Headless* runs an installed CLI in print-mode
  in a chosen worktree — the ADE **owns the process**, so it captures the full stdout
  and **verifies completion by exit code** (new `agent_run_headless` backend command,
  reusing `agentcli`). *Human gate* pauses the run for an Approve/Reject decision
  (with a note that feeds later steps + a native notification).
- **Auto-repair.** Per-step *On failure* policy: **Stop the run** or **Retry** (up to
  a configurable Max attempts; an interactive retry may re-bind to another live agent
  of the same type, a headless retry re-spawns).
- **Durable + re-attachable.** The run graph, step states and captured outputs persist
  across restarts (opaque `orchestrationRuns` blob via the new `set_orchestration_runs`
  command, mirroring `terminal_layout`); the engine re-attaches on load, keeping
  completed outputs and returning a mid-flight step to *ready*.
- **Cooperative agent→ADE channel.** New orchestration MCP tools
  (`orchestration_report_result` / `orchestration_report_progress`) on the injected
  MCP server let an interactive agent report its **structured result** (attributed by
  `UXNAN_AGENT_ID`), captured verbatim as the step output — better than the coarse
  hook summary.
- The status-bar entry point now also appears when any run exists (not only with ≥2
  live agents), so a saved run stays reachable. Pure engine logic
  (`src/lib/orchestration/run.ts`) is unit-tested (23 Vitest cases); the headless
  runner (`src-tauri/src/agentrun.rs`) and the persistence field are unit-tested too.
  Full EN/ES i18n. Spec: `architecture/02d-agent-monitoring.md` §3.

### Changed — Broadcast: explicit recipient selection (coordinator retired)

- The Broadcast tab now picks recipients **explicitly**: a checkbox per running
  agent (grouped by type, with a per-type "all") plus **All / None** presets and a
  live "N of M selected" count. The **coordinator / workers** concept (the crown) is
  **removed** — you choose exactly who receives, so "everyone" no longer implicitly
  bundled a designated coordinator.

### Fixed — reliable prompt delivery to agent terminals

- Prompts are typed into an agent's PTY as a **paste** and submitted with a
  **separate** Enter (new `pty_paste_submit` command). Fixes agents that left the
  message sitting in their composer (so a second send concatenated into
  "message1message2"), and keeps multi-line prompts from submitting at the first
  newline (multi-line goes via bracketed paste; single-line verbatim, so
  paste-guarding agents still submit).
- Backpressure no longer wedges on an agent that reads **busy** forever (no hooks /
  a stuck status): a queued message — or a blocked interactive step — is
  **force-delivered** after a 12 s hold cap, and the Broadcast list shows a
  "waiting for the agent to be free…" hint meanwhile.
- A **multi-line** paste now waits longer (150 ms vs 50 ms) before its Enter, so
  Claude Code-family agents that briefly *guard* the post-paste Enter still submit.

### Changed — Run builder: clearer authoring + ready-made examples

- **Contextual variable picker.** The step editor's cryptic "insert output" chips
  are replaced by an **Insert from context** picker that lists the prior steps and,
  per field (`output` / `summary` / `title`), shows a description **and a live
  preview** of the captured value once the step has run. **Insert** drops the token
  **at the cursor** and auto-adds the dependency — no more guessing `{{steps.s1.…}}`.
- **Step type as cards, headless first.** The type is chosen from three cards
  (Headless / Interactive / Human gate); a new step defaults to **headless** (full
  output, verified — best for chaining). A visible hint + the context picker state
  that an **interactive** step's output is a thin summary — real content only if the
  agent reports via MCP (Claude / Codex / Gemini / OpenCode) — so use headless for
  full chaining.
- **Searchable pickers.** Agent / model / worktree now use the shared **Combobox**
  (and **AiModelPicker** for models: searchable, `provider/model` split, a **loading
  state** for CLIs queried live) instead of a plain Select that could overflow.
- **Roomier console.** The modal is wider and uses the full height, so the builder
  isn't cramped.
- **Examples.** A new **Examples** menu adds ready-made runs — *Read & summarize*
  (A→B), *Parallel review → merge* (fan-in), *Draft → approve → polish* (gate) — as
  editable drafts with **headless** steps preset to an installed agent (paid like
  Claude/Codex, else free like OpenCode/Pi). Pure builder unit-tested
  (`orchestration/examples.test.ts`).
- **Status-bar attention.** The orchestration entry point highlights subtly when it
  (re)appears, clearing when you open the console.

### Added — Grok provider usage

- Added Grok to Settings → Providers, using the Grok CLI's own
  `~/.grok/auth.json` credential and official billing endpoint to show the
  current credit-usage window, reset time, plan and account without storing or
  logging the credential.
- Added native parsing and detection tests; expired credentials degrade to a
  sign-in-required state without affecting other providers.

### Changed — Desktop stable and nightly releases now have separate, enforced tags

- **Stable:** `desktop-stable-v0.0.PATCH` produces a normal GitHub Release and
  updates only the stable updater manifest.
- **Nightly:** `desktop-nightly-v0.0.PATCH-nightly.YYYYMMDD.N` produces a GitHub
  pre-release and updates only the nightly updater manifest.
- A shared tag parser validates both forms in CI; the release workflow derives
  the draft's pre-release flag from it, and the manifest workflow rejects a
  manually altered flag. This removes the former ambiguous `desktop-v…-alpha…`
  convention and prevents stable/nightly cross-publication.

## [0.0.9-alpha.20260711] - 2026-07-11

### Added — group the sidebar by agent attention

- A new **View** control in the Projects sort menu switches the sidebar between the
  **Tree** (project → worktree) and **By status** — every worktree flattened into
  **collapsible lanes by agent attention**: **Needs you** (blocked/waiting) ·
  **Done** (unreviewed) · **Working** · **Idle**. Empty lanes are omitted and each
  row is labeled by its project (rows leave their tree) with a short project-
  relative path tooltip. The mode **and each lane's collapse state** persist
  (`sidebarGroupBy` / `sidebarCollapsedLanes`); pinned worktrees float to the top
  of their lane. Pure, unit-tested `buildStatusGroups`; a plain collapsible lane
  list (no board view).

### Added — sidebar sort modes, manual drag-reorder + agent-attention smart sort

- The **Projects** header sort menu now drives **two independent axes** — the
  project cards and the worktree rows — each offering **Manual · Name (A–Z / Z–A) ·
  Recent · Agent activity**. The chosen mode is persisted per axis (`projectSort` /
  `worktreeSort`).
- **Manual order is now real drag-and-drop** (it was a no-op before): press-and-drag
  a project card or a worktree row to reorder it, with a floating label and an
  insertion marker. It uses pointer events (Tauri suppresses HTML5 dnd in the
  webview — the same approach as the terminal tab-strip), promotes to a drag only
  past a small threshold so taps still select, and swallows the trailing click.
  A drag switches that axis to "manual". Project order persists via the new
  `repo_reorder` command (reorders the `Vec<RepoData>`; repos absent from the list
  keep their place *after* the listed ones, so a stale list never drops one); a
  project's worktree order persists in the new `RepoData.worktree_order` (paths) via
  `repo_set_worktree_order`. Both self-heal — removed items drop out, newly-seen
  ones fall to the end.
- **"Agent activity" (smart) sort** surfaces the workspaces that need you: agents
  that are **blocked/waiting** first, then **done** (unreviewed), then **working**,
  then **idle** — tie-broken by the freshest signal and recency. It reuses the hook
  server's precise states (`resolveAgentDisplay`); a project aggregates the
  most-urgent state across its worktrees. **Recent** sort is fed by a per-workspace
  last-opened timestamp (`workspaceLastActive`, stamped on open, debounced persist).
- **Anti-jump layer** (`createStableOrder`): the time-varying modes freeze their
  rendered order and only reshuffle after a short settle delay (or immediately on a
  structural add/remove), so rows don't jump while you read; static modes
  (manual/name) apply instantly.
- Pure, unit-tested ordering logic in `sidebar-sort.ts`; reusable
  `createDragReorder` / `createStableOrder` helpers; `reorder_by_ids` covered by
  Rust tests.

### Added — pin (favorite) projects and worktrees

- **Pin** a project (its ⋯ menu) or a worktree (its right-click menu; child
  worktrees only — the primary always leads) to float it to the **top** of the
  list, on top of whatever sort is active; pinned rows carry a pin glyph. Persisted
  in `pinnedProjects` / `pinnedWorktrees` (self-healing). Pure `partitionPinned`,
  unit-tested.

### Added — unified file viewer: image/Markdown preview + one tab per file (diff folded in)

- **The center file tab is now multimodal, with view modes.** Opening a file gives a
  single tab with an **Edit / Preview / Changes** switch (only the views a file
  supports appear): the CodeMirror editor, a rendered **Markdown preview** or **image
  viewer**, and the file's **working diff** (unified/side-by-side + hunk staging + a
  staged/unstaged toggle). New `FileTabView.svelte` owns the one header; each visited
  view stays mounted, so switching never remounts the editor (losing unsaved edits)
  or re-reads git. `FileEditor`/`DiffPane` are now header-less bodies of this shell.
- **Images render instead of the "binary" dead-end.** New backend `fs_read_data_url`
  (`fs.rs`, registered in `commands.rs`/`lib.rs`) reads a local image into an inline
  `data:` URL (extension MIME via `git::image_mime` + a shared magic-byte sniff, 25 MiB
  cap); `FilePreview.svelte` shows it on a checkerboard with fit / zoom / actual-size
  and a dimensions·size readout. SVG previews as an image *and* stays editable as
  source. Rust unit tests cover the image / non-image / oversized paths.
- **Markdown preview, in-house, with zero new dependencies.** `markdown.ts` parses
  GitHub-flavored Markdown with the already-installed Lezer parser (`@lezer/markdown`)
  into a typed AST that `MarkdownView.svelte` renders with plain Svelte markup —
  **never `{@html}`**, so a document from any repo can't script the webview; raw HTML
  blocks are shown as escaped text. Covers headings, lists + task lists, tables,
  blockquotes, fenced code, links (opened externally) and images (local ones resolved
  via `fs_read_data_url`). `.md` opens source-first with a one-click Preview toggle.
  13 unit tests.
- **One tab per file — the diff is no longer a second tab.** Clicking a changed file
  in the Changes panel now **focuses that file's tab and flips it to the Changes view**
  (with the staged/unstaged toggle) instead of opening a separate diff tab — so a
  single file no longer sprawls across an editor tab plus a staged and an unstaged
  diff tab, and it is read from git once, not twice. The standalone `diff` tab kind is
  removed; the working diff is now a lazily-built sub-state of the file tab (keyed by
  the tab id, so it's freed when the tab closes). Renames/moves re-point it, and
  emptying the diff (staging/discarding the last hunk) falls back to the editor
  instead of closing a possibly-dirty tab. Commit (History) tabs stay separate.
- **i18n:** EN/ES strings for the view switch, the preview/image controls, the
  staged/unstaged toggle and the empty states.

### Fixed — agent misidentification + black terminals on launch

- **Wrapper agents no longer show the wrong name/icon.** Process detection matched
  a running process to the *first* configured command by list order and by loose
  substring, so `openclaude` (which contains `claude`) resolved to Claude Code, and
  a Zero run intermittently resolved to Antigravity. `procscan` now scores matches
  by specificity (exact ▸ `cmd-`/`cmd_` variant ▸ substring, longer wins) and walks
  **breadth-first**, so the process nearest the shell — the agent you launched —
  wins deterministically. And a uxnan-launched tab already knows its identity, so
  process detection **no longer overrides** it (it only names hand-started agents).
- **Surface PTY spawn failures instead of a silent black pane.** A failed
  `pty_create` was swallowed (`.catch(() => true)`), leaving an empty terminal; a
  real backend spawn failure (missing shell / bad profile) is now written into the
  pane (new `terminal.spawnFailed` string) and the agent command isn't typed into a
  dead PTY. Separately, on Windows with no shell profile configured, agent launch
  now spawns **cmd.exe** explicitly (matching the cmd-style quoting + the documented
  default) instead of falling through to the backend's PowerShell default, whose
  execution policy trips npm `.ps1` shims.
- **Defensive arch check for OpenCode's binary.** The AI-commit resolver
  (`agentcli.rs`) now verifies an `opencode.exe` candidate's PE machine type against
  the host before using it, so a wrong-architecture binary npm may have installed
  (the "not compatible with the version of Windows" error) is skipped in favor of a
  runnable install. *(The interactive-launch form of that error is an external
  opencode packaging issue — reinstall opencode for your architecture.)*

### Added — left-panel "agent view" (conversation title + collapsed logo strip) + Zero

- Each agent under a worktree is now a **two-line row**: status dot + logo +
  **conversation title** + relative time, with a muted **preview** line (the current
  tool while working, else the latest reply, else the status). The title/preview come
  from data the hook server **already captures** into `agentStatus` (`prompt` = the
  user's latest prompt, `tool`, `summary`) — previously only used for notifications.
  New `resolveAgentView` (`state/agentDisplay.ts`) composes it, falling back to the
  agent's name + a status label when no prompt is known. New `AgentRow.svelte`; a
  30 s-ticking `clock` + pure `relTime` (`time.svelte.ts` / `relTime.ts`).
- **Collapsed**, the agent list shows a **compact strip** of each agent's logo ringed
  by its status color (`AgentAvatar.svelte`) + the count; clicking an avatar reveals
  that agent. (A distinct treatment, not a copy of any reference.)
- **Zero** is now a first-class agent in the view: it reports no hook and sets no
  terminal-title, so a native reader (`src-tauri/src/zero.rs`, `zero_session`) reads
  its on-disk session (`~/.local/share/zero/sessions/<id>/metadata.json`) matched by
  the worktree cwd and surfaces the **real conversation title** + a coarse status.
  Polled by `state/zeroSessions.svelte.ts` while a Zero agent is open.

### Added — drag a file-tree entry onto a terminal to insert its path

- A file/folder row in the **Files** tab can be **dragged onto any terminal**; its
  path (double-quoted when it contains spaces, space-separated for a future
  multi-drop) is written to that terminal's PTY at the cursor — **not executed**
  (no trailing newline) — and **focus moves to that terminal** so the user keeps
  typing there. A short drag threshold keeps normal clicks (open/expand) working,
  and a floating label follows the pointer while dragging.
- Implemented with **pointer events**, not HTML5 drag-and-drop: Tauri's native
  OS file-drop suppresses HTML5 dnd inside the webview (the same reason tab
  reordering is pointer-based). The drop resolves the target terminal by
  hit-testing `data-pty-id` under the pointer. Shared `terminalDrop.ts` helper
  (`quoteDropPath` / `dropPayload` / `dropPathsIntoTerminal`); the native OS
  file-drop path now reuses it too.

### Changed — Files tab search is project-wide; toolbar reorganized

- The Files-tab search now scans the **whole project recursively** (backend
  `fs_search_files`, via ripgrep's `ignore` walker — respects `.gitignore` and
  skips `.git`). Matches are shown **as a tree** (folders + files, same design as
  the browser — matched files nested under collapsible ancestor folders), not a
  flat list. Previously it only filtered folders that had already been expanded, so
  a file in a never-opened folder could never be found. Debounced, capped (with a
  "narrow your search" hint past the cap), and **"Find in Folder"** now roots the
  same search at one subtree.
- **Toolbar reorganized**: primary actions stay as icon buttons (search ·
  collapse · refresh) and a new **"…" overflow menu** holds secondary actions —
  **Reveal in file manager** and a **"Show hidden files"** toggle (dotfiles, which
  filters both the tree and the search). The tree row was extracted to
  `FileTreeRow.svelte` (shared by the tree + the search-results tree).

### Added — file-tree context menu with full file operations

- Every entry in the right panel's **Files** tab now has a **right-click context
  menu** (reusing `ui/context-menu`, styled like the worktree row menu). Actions,
  shown by entry kind: **New File**, **New Folder**, **Copy Path**, **Copy
  Relative Path**, **Duplicate** (files), **Add as Project…** (folders not already
  registered), **Open in Terminal** (folders — opens in the worktree workspace at
  that folder), **View File** (files), **Collapse Folder** (expanded folders),
  **Find in Folder** (scopes the search to one subtree, with a clearable chip in
  the search bar), **Reveal in File Explorer**, **Rename**, and **Delete**.
- **Delete moves to the OS trash** (Recycle Bin / Trash / freedesktop — recoverable)
  behind the shared destructive `ConfirmDialog`; never a permanent unlink. New
  `trash` crate; a `check_deletable` guard refuses a filesystem root.
- New backend fs ops (`src-tauri/src/fs.rs` + commands): `fs_create_file`,
  `fs_create_dir`, `fs_delete`, `fs_duplicate` — all reusing the bare-name /
  no-clobber guards of `fs_rename` (extracted `validate_bare_name`), with unit
  tests. Duplicate picks a unique "… copy" name.
- Create / rename go through a shared `FileNamePromptDialog` (validation +
  extension-change warning on rename); the tree reloads the affected folder and
  **open editor tabs follow a rename or close on a delete** (new
  `terminals.repathTabs` / `closeTabsUnder`). New EN/ES strings under `fileTree.*`.

### Changed — region tab strip scrolls via edge chevrons + wheel (no native scrollbar)

- The center-pane region tab strip no longer shows a native scrollbar. When tabs
  overflow, **edge chevrons (`<` / `>`)** appear at the strip's borders and the
  strip scrolls with the **mouse wheel** (vertical delta → horizontal scroll).
  The native bar was removed because grabbing it also started a window drag
  (the strip's empty areas are a Tauri drag region), so it was unusable. The
  drag region is kept — empty strip areas still move the window, while tabs and
  the chevrons/`+` stay clickable (no-drag islands). Overflow state is tracked
  **per region** and re-measured on scroll, wheel, resize and tab changes; the
  active tab is auto-revealed when it scrolls out of view. Chevrons use the
  standard `iconButton.action` footprint + `text-muted-foreground` hover/focus
  tokens and the app's focus ring. Added `tab.scrollLeft` / `tab.scrollRight`
  i18n strings (EN/ES). New `.uxnan-scrollbar-none` utility in `app.css`.

### Fixed — reporters must be silent on the agent's side (no warnings / prompts)

- **Claude Code no longer warns on startup.** The pre-relay installer wrote a
  `hooks.__uxnan_managed_hooks__` marker that current Claude Code flags as an
  "Unknown hook event". Install/uninstall now sweep that legacy marker (and the
  legacy dedicated `uxnan-claude-hook.cjs` entries) so the config is clean and
  self-heals on the next launch.
- **OpenCode no longer rejects its config.** The installer wrote an invalid
  `plugins` key into `opencode.json` ("Unrecognized key: plugins"). OpenCode
  auto-discovers plugins from its `plugins/` directory, so we now **only** drop
  the plugin file there and **never touch `opencode.json`** — and repair a bad
  `plugins` key an earlier build may have written. The plugin exports a single
  named factory (loaded once).
- **Codex trust hardened.** The managed `hooks.json` entry now omits `timeout`
  (Codex applies its 600 s default), and the reproduced `trusted_hash` is folded
  at that default — the exact identity our golden vectors verify — to maximize
  the chance Codex auto-trusts the hook instead of prompting. (Unlike a
  tool that launches agents itself with a managed `CODEX_HOME`, the ADE writes
  trust into the user's real `~/.codex`; if a Codex version still prompts, accept
  once — Codex then records its own trust.)
- Legacy sweep: Codex install now also removes a prior node-relay Codex entry so
  the old and new reporters don't double-report.

### Changed — precise per-agent status hooks (Claude Code, Codex, Gemini CLI, OpenCode, Pi)

- **Reworked the Layer-1 reporters for shell-robust, out-of-the-box precise
  states** across every common shell (cmd, PowerShell, PowerShell 7, Git Bash,
  WSL, bash, zsh, fish). Each agent now uses the reporter that best sidesteps
  "which shell runs the hook":
  - **Claude Code** — a dependency-free Node relay invoked in **exec form**
    (`command:"node", args:[…]`), which bypasses the shell entirely (Claude *is*
    Node, so `node` is guaranteed). Merged **per-event** into
    `~/.claude/settings.json`, **preserving the user's existing hooks** (the old
    install replaced the whole `hooks` block). `done` now enriches its
    notification from the session transcript **server-side** (no dedicated Node
    hook script needed).
  - **Gemini CLI** — the same relay via `node "<relay>"`; correct turn events
    (`BeforeAgent`/`AfterAgent`/`BeforeTool`/`AfterTool`, previously wrong) and a
    **milliseconds** timeout. Emits `{}` on stdout (Gemini parses hook stdout).
  - **Codex** — a `curl` hook (`.sh`/`.cmd`; Codex is a Rust binary with no Node
    guarantee) **plus a reproduced `trusted_hash`** written to
    `~/.codex/config.toml` (`codex_trust.rs`). Codex 0.129+ gates hooks on this
    trust, so the previous `source_paths` approach never fired; the hash is
    pinned to known-good golden vectors.
  - **OpenCode** — the status plugin rewritten to OpenCode's real event API
    (async factory returning an `event` hook; re-labels the native bus).
  - **Pi / OMP** — a **new** in-process status extension installed into
    `~/.pi/agent/extensions/` (Pi has no JSON hook surface). Reports
    `working`/`done`.
- **Endpoint file for restart survival.** The hook server writes
  `endpoint.env` / `endpoint.cmd` (live url + token) on start and injects
  `UXNAN_ENDPOINT_FILE`; every reporter prefers it, so a terminal that outlived
  an app restart still reaches the live server instead of a dead port.
- **Shell reporters no longer build JSON.** The agent id / kind / state ride in
  HTTP headers (`X-Uxnan-Agent-Id` / `-Type` / `-Status`) and the raw event is
  forwarded as the body — removing a class of cross-shell quoting bugs. The hook
  server (`hooks.rs`) accepts three report shapes (JSON envelope, raw-body +
  headers, header-only direct status), caps the body at 1 MiB, and normalizes +
  reads the Claude transcript itself.
- **WSL (basic).** `WSLENV` now carries the `UXNAN_*` vars (with `/p`
  path-translation for the endpoint file) into WSL. Note: WSL2's `127.0.0.1`
  still targets the WSL VM, not the Windows host — a documented limitation.
- **Hardened terminal-title inference (Layer 2 fallback).** Word-boundary
  lookarounds stop a status keyword inside a path (`~/codex/ready`) or a longer
  word (`already` ⊃ `ready`) from minting a false state.
- **Fixed** the generic launcher wrapper dropping the `done` report (it `exec`'d
  the agent, so the exit report never ran) and clobbering across shells.
- **Settings → Agents → Hooks** now has a card per agent including **Pi**, with
  honest install/uninstall status per agent.
### Added — AI-provider usage statistics (Settings → Providers)

- **New Settings section "Providers"** to surface AI-provider usage: quota/rate
  windows (percent **consumed** + reset countdown), plan/account, and credit
  balance, for **only the providers the user activates** (nothing is polled
  otherwise, to save resources). Mirrors the Agents catalog pattern.
- **Native Rust reader** (`src-tauri/src/usage.rs`, commands `usage_read` /
  `usage_detect`) — reads each CLI's own stored token and calls the provider's
  **official usage API**. Wired providers: **Codex** (`~/.codex/auth.json` →
  chatgpt backend; monthly/weekly windows + credits + email), **Claude**
  (`~/.claude/.credentials.json` → `api.anthropic.com/api/oauth/usage`; parses
  the `limits[]` array — session/weekly + model-scoped windows — with ISO-8601
  reset parsing), **Copilot** (token from `gh auth token` → `api.github.com`;
  quota snapshots + GitHub login via `/user`), **Gemini** (`~/.gemini/oauth_creds.json`
  → cloudcode-pa; best-effort, no client-secret harvesting). Each provider
  degrades to a `status` (`ok`/`authRequired`/`notInstalled`/`error`) with a
  message, so a slow/broken provider never sinks the others. **Posture:** never
  browser cookies, never pasted API keys.
- **UI:** a coherent container with an "add provider" combobox (detects which
  CLIs are present) and a **tab per activated provider**; each tab shows its live
  windows (each bar labeled "% used" with a caption clarifying it's the consumed
  percent), credit, and **account identity** ("Authenticated as …" with a
  **click-to-reveal blur** on the email/login). Per-provider refresh interval and
  **status-bar visibility** options (which windows / plan / credit to surface)
  live inside each tab.
- **Status-bar indicator** — a gauge button + popover (next to the backend
  indicator) showing the chosen providers/windows; the primary %-bar is opted-in
  by default; tinted amber/red as usage nears the limit. Global refresh interval
  and a master on/off toggle in the section header.
- **Config:** `AppSettings.usageProviders` / `usageRefreshMinutes` /
  `usageStatusBarEnabled` (persisted). **Contract-first:** the wire shape mirrors
  the new `shared` `agent/usageStats` method so the bridge can serve the same
  payload to the phone later (Phase 6). Full EN/ES i18n. Tests: 7 Rust unit tests
  (`usage::tests`) + `usageFormat` frontend tests.
### Changed — agent catalog
- Removed **OpenClaw** and **Hermes** from the Settings → Agents catalog (narrow,
  special-purpose agents better launched by hand). **OpenClaude** now resolves its
  favicon (`openclaude.gitlawb.com`).

### Changed — Settings UI consistency (Agents & Terminal)
- Agents and Terminal panes now follow the standard section pattern used across
  Settings: a large section title + description once at the top, then each
  sub-container carries a small `text.section` label over a `px-7 py-6`
  (`panel.settingsBody`) card — consistent spacing and sizing with the rest of the
  app. Collapsible agent/terminal profile cards get more vertical breathing room.

### Changed — Settings → Appearance redesign (theme picker)
- The app-theme and terminal-theme pickers are now a **scrollable name list + a
  live preview**, replacing the swatch-card grids. **Interface**: clicking a theme
  previews its palette in a themed card that lists every color role (background,
  foreground, primary, …); **Use** applies it. **Terminal**: the preview is a
  **non-interactive mini terminal** that recolors to the selected theme (prompt,
  path, git, error, selection, code) so real color usage is visible — the
  surrounding UI stays on the app theme. With "separate light/dark schemes" on,
  the terminal shows two lists (dark / light), each with its own preview. Fonts and
  the "Themes" action row are plain section items (label + description + controls);
  containers use the standard `panel.settingsBody`. See [`docs/theming.md`](docs/theming.md).

### Fixed
- **Destructive confirmation dialogs unified and overflow fixed.** Close-all-tabs,
  remove-project and remove-worktree confirmations now share one canonical
  `ConfirmDialog` (identical layout, danger hero icon, design tokens), so they no
  longer drift apart in style. The remove-worktree dialog had its body and buttons
  render *outside* the backdrop: `Dialog.Content` is a CSS grid, and a long worktree
  path (or project name) grew the grid track past `max-width`, pushing content past
  the padding. The content is now a flex column with `min-w-0` so `break-words`
  wraps long paths inside the box. `ConfirmDialog` also gained an optional inline
  error band and an `onconfirm` that can return `false` to keep the dialog open
  (the remove-worktree force-remove flow reuses this).
- **Center panel: terminal rendering, scrollbar and resize seams reworked.**
  A cluster of center-pane bugs (an ungrabbable / hidden terminal scrollbar, the
  terminal reading as if it sat "under" the right panel, excess empty space at the
  right edge, and a stuck ghost frame after resizing a panel) are resolved
  together:
  - **Column resize handle no longer covers the center pane.** The divider
    between the center workspace and the right panel (and the other sidebars) was
    an `absolute` strip straddling the boundary with its half over the center's
    right edge capturing pointer events — which blocked the xterm scrollbar and
    made the right panel read as overlapping the center. The grab strip now sits
    entirely on the *adjacent panel* side of the seam (off the center's
    scrollbar-bearing edge), a bit wider so it's easy to grab; the seam hairline
    is a separate `pointer-events-none` element that only shows on hover.
  - **Less wasted space at the right edge.** The terminal host now insets with an
    asymmetric margin (`4px` top + left, **flush right + bottom**: `calc(100% -
    4px)` with matching `margin-top`/`margin-left`) instead of a symmetric `m-1`
    inset, so the xterm viewport and its scrollbar sit hard against the right seam
    with no reserved right margin. The scrollbar is a solid **10px** rounded thumb
    (down from 12px, and without the old `2px transparent border` +
    `background-clip: padding-box` that had shrunk the painted thumb to ~4px), so
    it's grabbable without over-reserving the FitAddon's scrollbar gutter.
  - **Settled-grid fit (no scrollbar wobble, correct agent sizing).** The
    `ResizeObserver` re-fit waits until `FitAddon.proposeDimensions()` reports the
    same grid across two animation frames (capped at 8) before fitting and
    resizing the PTY, so a divider drag or window resize no longer spams the PTY
    with intermediate `SIGWINCH`es (which wobbled the scrollbar and could leave a
    full-screen agent TUI sized to a stale grid). A minimum pane-size floor keeps
    a transient near-zero measurement from pinning the PTY to a 2-column grid.
  - **No stuck frame after resize (Canvas renderer).** The terminal previously
    rendered via the WebGL addon, whose canvas could leave a stale sliver of the
    previous frame at the right edge when shrunk on WebView2 (Windows). It now
    renders via the Canvas renderer, which repaints cleanly on resize and is
    plenty fast for agent TUIs (DOM stays the fallback; ligatures still force
    DOM). A guarded repaint (clear the glyph atlas + refresh every row) also
    covers a pane revealed from `display:none`, where a canvas can otherwise keep
    compositing its pre-hide pixels. Does not touch layout.

### Changed
- **Terminal renderer switched from WebGL to Canvas.** `@xterm/addon-canvas`
  (0.7.0) replaces `@xterm/addon-webgl` as the accelerated renderer for the
  center-pane terminals — see the *No stuck frame* fix above for the rationale.
  a `FOR-HUMAN` asset.

## [0.0.8-alpha.20260705] - 2026-07-05

### Added
- **`TooltipSimple` â€” reusable Bits UI tooltip wrapper.** Replaces native HTML
  `title={...}` attributes across the entire desktop UI with styled Bits UI
  tooltips (`bg-foreground text-background`, `text-[11px] font-medium`,
  `rounded-md px-2 py-1`, `shadow-sm`, animation). Covers 30+ components
  (status bar, sidebar, worktree/project cards, terminal tabs, file tree,
  settings, window controls, agent panels, and more). To add a tooltip, use:
  ```svelte
  <TooltipSimple title="â€¦">
    {#snippet children(tp)}
      <element {...tp}>â€¦</element>
    {/snippet}
  </TooltipSimple>
  ```
- **`TooltipProvider` wrapper in `+layout.svelte`** â€” required by Bits UI v2
  tooltip primitives for context.

### Added â€” project/branch icons, project settings & tab rename

- **Project card â‹¯ menu.** Each project header gains a three-dots overflow menu
  (replacing the header right-click menu) with the project-level actions only â€”
  *Project settings*, *Change icon*, *Reveal in file manager*, *Copy path*,
  *Configure* (agents/terminals) and *Remove*. Launching terminals/agents stays on
  the header's `+`. Right-clicking a **worktree row** still opens its full context
  menu (cross-platform).
- **Per-project settings dialog.** Rename a project (card label only â€” the folder
  on disk keeps its real name) and change its icon, alongside read-only info
  (location, git/folder type, remote owner, worktree count). Reachable from the â‹¯
  menu.
- **Custom project & branch icons.** Pick from a curated built-in glyph set (with
  an accent color), a local image file, an image URL, or â€” for a git project â€” the
  `origin` host account avatar (GitHub/GitLab). Every image source is downloaded
  (URLs/avatars are fetched in the Rust backend, sidestepping CORS) and rasterized
  to a small square PNG stored **inline** in the app state, so icons persist and
  work offline. Branch icons are set from the worktree row's right-click menu and
  keyed per branch.
- **Rename center-panel tabs.** A tab's context menu (all kinds) gains *Rename*:
  terminals/diffs/commits get a free-form label; a **file tab renames the real
  file on disk** (same folder) with a confirmation that states the file is being
  renamed and warns when the extension changes or is dropped, re-pointing the open
  editor without losing content. Terminal labels persist across restarts.
- **Close all tabs.** A tab's context menu (and the terminal pane menu) gains
  *Close all tabs*, which closes every tab in the **active** workspace (with a
  single aggregated save/discard prompt for any unsaved files).

New backend commands: `repo_update`, `repo_set_branch_icon`, `repo_remote_owner`,
`fs_rename`, `image_fetch_data_url` (adds a `reqwest`/rustls dependency, already in
the tree via the updater). `RepoData` gains `icon` + `branchIcons`; the persisted
terminal tab gains an optional `customTitle`.

### Added â€” batch theme import (multiple files + lists of themes)
- **Theme import (Settings â†’ Appearance, both Interface and Terminal) now imports
  in batches.** The file picker accepts **multiple `.json` files at once**
  (`multiple: true`), and â€” for both the file and the **Paste JSON** flows â€” each
  document may hold a **single theme, a JSON array of themes, or a wrapper object**
  (`{ "themes": [...] }` for interface, `{ "terminalThemes": [...] }` for
  terminal). Previously only one theme from one file/paste could be imported.
- New pure helpers `normalizeImportedThemes` / `normalizeImportedTerminalThemes`
  in `src/lib/theme.ts` normalize one-or-many entries, each getting a fresh `id`
  with missing colors backfilled from the built-in base. Malformed entries are
  **skipped and reported** without aborting the rest of the batch; the last valid
  entry becomes active, and a summary line ("Imported N themes", plus any skipped
  count) is shown. Covered by 12 new Vitest cases in `src/lib/theme.test.ts`
  (45 frontend tests total).
- Docs: `docs/theming.md` gains an *Importing many themes at once* section; i18n
  (EN/ES) gains `appearance.importedOne/Many`, `appearance.skippedOne/Many`, and
  an updated `appearance.pasteDesc`.

### Added â€” add several projects at once (parent vs. sub-folders) + reliable picker keyboard nav
- **New two-step "Add project" flow.** The directory picker's primary
  **"Add this folder"** now opens a second dialog (`AddProjectDialog.svelte`)
  where you choose to add **this folder as one project** or **tick sub-folders to
  add each as its own project** â€” repos are pre-checked, a select-all toggles the
  lot, and only the ticked folders (repos **and** non-repos alike) are added.
  When the browsed folder has no sub-folders, the primary action still adds it
  directly (no empty dialog). Backed by a new `projects.addProjectPaths()` that
  adds in order, skips failures, and toasts a summary (`toast.projectsAdded` /
  `toast.projectsAddedSome`).
- **The picker keeps its per-folder Add and gains an informational note.** Each
  listed folder still has its own hover **Add** for one-off registration; when git
  repos are detected among the children, a quiet banner notes it (no action of its
  own â€” the choice lives in the new dialog).
- **Keyboard navigation in the picker is fixed.** Arrow-key navigation is now
  handled at the dialog level (not only the path field), so **â†‘/â†“ keep working
  regardless of which control has focus** â€” and the highlighted row now scrolls
  into view, so selection no longer runs off-screen and appears to stall. Added
  **`Ctrl/âŒ˜+Enter`** to trigger the primary "Add this folder" action from the
  keyboard.
- **New `Checkbox` UI primitive** (`components/ui/checkbox`, bits-ui + lucide),
  matching the existing shadcn-svelte components.
- **Files:** `AddProjectDialog.svelte` (new), `components/ui/checkbox/*` (new),
  `DirectoryPicker.svelte` (note banner, second-dialog trigger, dialog-level key
  handling, scroll-into-view, `autocomplete="off"`), `state/projects.svelte.ts`
  (`addProjectPaths`), EN/ES i18n (`picker.bulkHint`, `picker.hintAdd`,
  `addProject.*`, `toast.projectsAdded*`).

### Changed â€” "New worktree" is gated to git repos, not just the Global space
- **"New worktree" affordances are now disabled for non-git project folders.**
  Worktrees need a git repo, so for a registered folder that isn't one:
  - the center empty-state **"New worktree"** button renders disabled (with a
    tooltip explaining the folder isn't a git repo);
  - the center tab-strip **"+"** launcher menu omits its **New worktree** option
    (terminals / agents / browser stay available);
  - the `newWorktree` keyboard shortcut and its empty-state hint are inert.
  Backed by a new `projects.activeGitRepo` getter (the active repo only when
  `isGit !== false`); `requestNewWorktree()` now checks it. The project card's
  launcher dialog already hid the option for non-git folders.
- **Files:** `state/projects.svelte.ts` (`activeGitRepo`, gated
  `requestNewWorktree`), `TerminalArea.svelte` (git-gated empty-state button +
  tab-strip menu + hint), EN/ES i18n (`terminal.worktreeNeedsGitRepo`).

### Removed â€” redundant Cancel button in the project launcher dialog
- **Removed the redundant Cancel button from the project launcher dialog**
  (`LauncherDialog`) â€” the top-right âœ• and Esc already dismiss it, matching the
  add-project dialogs.
- **Files:** `LauncherDialog.svelte`.

## [0.0.7-alpha.20260705] - 2026-07-05

### Changed
- **Update toast redesigned as elevated card** (`UpdateToast.svelte`): solid
  `bg-[var(--ux-elevated)]` background with `border-border/70` border, replacing
  the previous transparent/default card style. Added a **release notes link**
  pointing to the version's GitHub Releases page. Per-thread activity indicator
  preserved.
- **i18n**: added `updates.releaseNotes` and `updates.releaseNotesTitle` keys (en
  and es) for the new release notes link.
- **FOR-HUMAN.md**: removed the "Updater minisign keypair" entry â€” the keypair is
  already generated, configured in `tauri.conf.json`, and set as GitHub secrets.

## [0.0.6-alpha.20260704] - 2026-07-04

### Added â€” agents discover & drive the integrated browser via an MCP server
- **The integrated developer browser is now exposed to agents as Model Context
  Protocol tools, so they discover it automatically â€” no docs, no prompt.** Before,
  an agent could only open a URL in the in-app browser if it *knew* to POST to the
  `/browser` hook route (it had to read `docs/browser.md` first). Now the ADE runs a
  small **browser-control MCP server** and registers it in each launched agent's own
  MCP config, so `browser_*` tools show up in the agent's tool list like any native
  capability.
- **MCP server** (`src-tauri/src/mcp.rs`) â€” a minimal, spec-correct Streamable-HTTP
  MCP endpoint mounted at **`/mcp`** on the existing local hook server (same
  ephemeral `127.0.0.1` port), authorized with the same per-launch token
  (`Authorization: Bearer <token>`, or the legacy `x-uxnan-token`). Control-only tool
  surface: **`browser_open`**, **`browser_navigate`**, **`browser_reload`**,
  **`browser_back`**, **`browser_forward`**, **`browser_status`**. `open`/`navigate`
  reuse the existing link-policy path (`browser::route_url` â†’ the frontend panel);
  `status` reports the live open/URL/policy via a new `AppState.browser_url` tracker.
- **Config injection** (`src-tauri/src/mcpinject.rs`) â€” writes each CLI's native MCP
  config so it finds the server on startup, for **Claude Code, Codex, Gemini CLI and
  OpenCode**. The **token is never written to a file**: every config references
  the `UXNAN_MCP_TOKEN` env var (injected into the agent's PTY), so the secret stays
  in the process env *and* the injected config is inert outside a uxnan-launched
  terminal (an agent run elsewhere can't authenticate â€” it won't hijack the browser).
  Merges into existing config files without clobbering (JSON via `serde_json`, Codex
  TOML via the new `toml_edit` dep); files it creates are hidden from Git (added to
  the repo's `info/exclude`, worktree-aware via `git2`) and removed on exit.
- **Injection modes** (`BrowserSettings.mcpInjection`) â€” **`workspace`** (default:
  a project-scoped config in the terminal's cwd, covering hand-typed and app-launched
  agents there, cleaned on exit), **`global`** (each CLI's global user config), or
  **`off`** (wire it by hand from the Settings copy-paste snippet). Per-agent opt-out
  via `mcpDisabledAgents`; master switch `mcpEnabled` (default on). New `mcp_info`
  command surfaces the endpoint + token + supported-agent catalog to Settings.
- **Extensible** â€” a new agent (e.g. `agy`/Antigravity, Cursor, Grok, amp, Pi) is one
  row in `mcpinject::AGENTS` plus a match arm in `config_path`/`write_entry`; recipe
  in `docs/browser.md`.

## [0.0.5-alpha.20260703] - 2026-07-03

### Fixed â€” blank white screen on startup (0.0.4 regression)
- **0.0.4 crashed to a blank white screen right after the splash.** The pinned
  update-toast driver added in 0.0.4 (`initUpdateToast`) uses the `$effect` rune,
  but it lived in a plain **`updateToast.ts`** â€” and Svelte 5 runes are only
  compiled in `.svelte` / `.svelte.ts` files. In a plain `.ts` the `$effect` call
  is left untransformed, so at runtime it's an undefined identifier: calling
  `initUpdateToast()` during `+page.svelte` mount threw a `ReferenceError`, which
  took the whole page down (blank screen). CI didn't catch it because
  `svelte-check` types `$effect` as an ambient global and Vitest only exercises
  pure logic â€” neither mounts the real app.
- **Fix:** renamed `updateToast.ts` â†’ **`updateToast.svelte.ts`** (so the Svelte
  compiler processes the rune; matches the repo convention for rune-using
  non-component modules, e.g. `state/*.svelte.ts`) and updated the import in
  `routes/+page.svelte` to `$lib/updateToast.svelte`. Verified via the dev-server
  browser flow: the module now compiles `$effect` to `$.user_effect` and the app
  mounts; `svelte-check` + Vitest green.
- **Prevention:** added a CI/`npm run check` guard (`scripts/check-runes.mjs`,
  new `check:runes` script) that **fails** if a Svelte rune appears in a plain
  `.ts` file â€” the exact gap that let this ship green. Documented the rule in
  `docs/development.md`.

## [0.0.4-alpha.20260703] - 2026-07-03

### Changed â€” update prompt is a pinned sonner toast; download/install from Settings
- **The fixed top-of-page update banner is gone.** The "update available /
  downloading / ready to install" prompt is now a **persistent sonner toast**
  (`UpdateToast.svelte`, driven by `updateToast.ts` with a stable id +
  `duration: Infinity`, so it never auto-dismisses and re-appears on reload when a
  staged download is restored). Same phases, copy and actions as the old banner
  (Download / Install now / Install when idle / Dismiss); dismissal goes through
  `updater.dismiss()`. `UpdateBanner.svelte` removed.
- **Settings â†’ Updates now exposes the download/install actions inline.** When a
  version is available you can **Download** it, and when it's downloaded you can
  **Install now** (or **Install when idle** while an agent is busy) â€” consistent
  with the selected install policy â€” without leaving Settings for the toast.
- Native OS notifications (agent-idle) are unchanged. No backend/Rust changes;
  the existing `updater` store already exposed everything. Vitest + `svelte-check`
  green. Spec: `architecture/00-index.md`, `architecture/04-technical-reference.md`
  (updater UI), `docs/updates.md`.

## [0.0.3-alpha.20260702] - 2026-07-02

### Build
- **Production app icons regenerated from a 1024Â² master.** The icon set is now
  derived from the final 1024Ã—1024 brand PNG, kept in-repo as
  `src-tauri/app-icon.png` for reproducible regeneration
  (`npm run tauri icon src-tauri/app-icon.png`): crisper `icon.icns` / `icon.ico`
  and every PNG size (including the macOS 512@2x slot). The mobile
  `icons/android` & `icons/ios` output was dropped (desktop-only app);
  `tauri.conf.json â†’ bundle.icon` wiring is unchanged. Closes the last app-icon
  `FOR-HUMAN` item (final artwork provided + signed off).

### Added
- **History: expand a commit to per-file diffs + a details hover-card.** Clicking a
  commit in the History tab now **expands it inline to its changed-file list**
  (status letter + path) instead of opening one giant diff; clicking a file opens
  **just that file's slice** of the commit diff as a center tab (much more
  readable). The commit diff is fetched once (`git_show`) and split per file
  **client-side** (new `diffParse` util, unit-tested â€” no new backend). Under the
  branch graph, an expanded commit keeps the graph continuous by drawing straight
  lane continuations through its file rows. Hovering a commit shows a new reusable
  **`ui/hover-card`** (bits-ui `LinkPreview`, app-styled) with the full subject,
  body message, short+full hash, author (name Â· email), absolute date and refs.
  `VirtualList` gained exact **per-index row heights** (`estimateSize` may now be a
  `(index) => number`) so the mixed commit/file rows virtualize without runtime
  measurement.
- **Reusable `ContextMenu` primitive + shared actions menu.** Added a
  `ui/context-menu` wrapper (bits-ui `ContextMenu`, styled to match our
  `dropdown-menu`: same popover surface, ring, animation, submenus, with
  scroll-capped content/sub-content, at the skill's menu density â€”
  `min-h-7 gap-2 px-2 py-1.5`). A single reusable `RowActionsMenu` renders the
  body â€” new terminal (default) + a *by-profile* submenu, **Launch agent** and
  **Active agents** submenus (both scroll when long), reveal in file manager,
  copy path, a Configure submenu (agents / terminals), and a destructive remove â€”
  and is shared by **both** the worktree/branch rows **and** the project-card
  header via **right-click**. The always-visible **â‹¯ overflow buttons were
  removed** from every worktree row **and** the project header (the right-click
  menu replaces them; the header keeps only expand + the launcher **+**).
- **Reusable searchable selectors (`Combobox`, `MultiSelect`).** Extracted the
  searchable-select pattern that had lived inside `FontPicker` (Popover + Command:
  a search box, grouped options, comfortable padding, a check on the current
  value) into two generic components sharing a `ComboItem` / `ComboGroup` shape:
  `Combobox.svelte` (single value, `{ groups, value, onChange }`) and
  `MultiSelect.svelte` (a token-input multi-select â€” chosen values are compact
  removable chips, an "Add" trigger opens the searchable grouped list, so the
  field stays the same small size for 3 or 300 options). Both take optional
  `itemPrefix` / `triggerContent` snippets (logos, badges, custom triggers). Used
  by the launcher window; the building blocks for future selectors.
- **Project launcher window (`LauncherDialog`).** The project card's **+** now
  opens a dialog instead of a floating menu. The flow reads as a sentence â€” pick
  **where** (an existing worktree via the searchable `Combobox`, or **New
  worktreeâ€¦** which reveals the branch name + base + folder preview) and **what**
  to open there (a searchable `MultiSelect` over terminals / every profile / every
  agent / the browser â€” one *or several* at once), then **Open** / **Create &
  open**. Selecting a target switches and links the workspace, and creating a
  worktree no longer force-launches the default agent (the "what to open"
  selection is the single source of truth). Replaces the previous per-worktree
  floating menu on the project header, which repeated every option once per branch
  and overflowed the screen on projects with several worktrees.

### Changed â€” clean desktop UI redesign
- **Appearance settings rebuilt on the shared settings language.** The pane
  dropped its ad-hoc soft-boxed blocks for the same rhythm as the other panes:
  each of **Interface** and **Terminal** now has a real `SettingsSection` header
  (title + description over a divider) and, within it, **Fonts first, then
  Themes**. Font/typography options are `SettingsRow`s (label + a helper line +
  right-aligned control) inside a soft band â€” including the terminal font family,
  size, line-height, letter-spacing and ligatures (the redundant **font-weight**
  control was removed; typefaces carry their own weight). Theme selection moved to
  the app's neutral selection language (`surface.active`), and the theme/terminal
  preview grids are now **scroll-capped** (`max-h` + `uxnan-scroll`) so a large
  collection stays a bounded, scrollable region instead of a runaway grid. New
  per-row description i18n keys (EN/ES).
- **Empty center panel gained a quiet name footnote.** Pinned to the bottom of the
  empty canvas (both the Global scratch space and an empty project/worktree): a
  two-line, muted footer â€” `Uxnan Â· /uÊƒ.nan/` over the subtitle *"a name with no
  relation to, or derivation from, any existing product."* (localized EN/ES). New
  `terminal.nameNote` / `terminal.nameSub` i18n keys.
- **Terminal & workspace keyboard shortcuts + empty-state hints.** New configurable
  shortcuts (Settings â†’ Keyboard shortcuts): **New terminal** (`Mod+T`) opens in the
  **active workspace's folder**; **New global terminal** (`Mod+Shift+T`) opens in the
  Global scratch space (home); **New worktree** (`Mod+Shift+N`) creates a worktree in
  the active repo (a no-op outside one). The empty center panel now lists these plus
  **Add project** (`Mod+O`) as informative text + keycap hints below its buttons. The
  **project-card context menu** shows the *New terminal* keycap. The new-worktree
  dialog moved to the shell (shared `projects.activeRepo` / `newWorktreeOpen`) so the
  shortcut and the empty-state button drive the same dialog. All keycaps render via
  `KeyChord` (âŒ˜ on macOS via `Mod`).
- **Terminal split moved to the context menu + keyboard.** Removed the two
  split-vertical / split-horizontal buttons from the center tab strip; splitting
  now lives only in each terminal's right-click menu (pane or tab). That menu was
  restyled to match the app's other menus (soft popover ring, rounded rows) and
  now shows a trailing **keycap hint** for every action that has a shortcut. Added
  three configurable shortcuts (Settings â†’ Keyboard shortcuts): **New terminal**
  (`Mod+Shift+T`), **Split right** (`Mod+Shift+â†’`) and **Split down**
  (`Mod+Shift+â†“`) â€” picked to avoid clobbering shell signals (Ctrl+C/D/\, â€¦) and to
  sit in the same directional family as focus-split (`Mod+Alt+â†’/â†�`). All three stay
  bound to the **active workspace**: new terminal opens in its focused region
  (bootstrapping the first one when the workspace is empty, same as the empty-state
  button), and split acts on the focused region â€” a **no-op when there's nothing to
  split**, so a shortcut never spawns an out-of-context pane and no chooser is shown.
  New `app.splitActiveTerminal`; the shortcuts are handled both globally (`+page`)
  and while a terminal is focused (`Terminal.svelte`). Also gave the copy/paste/close
  menu items their keycap hints (`Ctrl+C` / `Ctrl+V` / the `closeCenter` chord).
- **History graph button reads as a toggle.** The show/hide-graph button in the
  History header now shows a clear pressed state (soft primary fill + `text-primary`,
  `aria-pressed`) when the graph is on, instead of only tinting the icon â€” so its
  on/off state is obvious while it stays a ghost icon button like its neighbors.
- **New-worktree dialog redesigned + unified on `Combobox`.** The branch field
  gained a leading branch glyph; the **base ref** and **agent** pickers moved from
  the raw `Select` to the shared searchable `Combobox` (agent logos via its
  `itemPrefix`), matching every other single-select in the app; the destination
  preview is a softer bordered band with a folder glyph.
- **Add-project folder browser redesigned.** Rebuilt on the **same shell as the
  quick-switch palette** â€” `Dialog.Content` is `overflow-hidden p-0` so the rounded
  card clips every section (the scroll list and its scrollbar included) and nothing
  bleeds past the frame; each stacked section (header Â· address bar Â· folder list Â·
  footer) owns its `px-4` and a hairline divider. The path row is a file-manager
  address bar (parent-up + an editable path field with a leading folder glyph,
  `min-w-0` so a long path can't overflow). Repos are flagged by a git-folder icon
  and a quiet primary tag (replacing the tiny outline badge), with a hover "Add"
  (filled `secondary` for repos); loading/empty states are centered with an icon. The three sections were
  rebuilt rather than merely spaced out: the **search** row is roomier with the
  input as the focal point (15px) and a live result count on the right; **results**
  are now two-line rows (branch over its folder path) with a soft leading branch
  glyph chip and the repo as a trailing tag, at a comfortable 52px; the **empty
  state** is a centered icon + message; and the **hint bar** got more breathing
  room. New `palette.countOne/Other` i18n (EN/ES).
- **Keyboard shortcuts render as individual keycaps.** New reusable `KeyChord`
  splits a chord into one `Kbd` per key with a faint "+" between (Mac keeps the
  tight `âŒ˜`-cluster, no "+"), so `Ctrl+,` reads as `Ctrl` `+` `,` instead of one
  crammed cap. Backed by a new `formatChordParts` in `keybindings.ts`; wired into
  the left sidebar's quick actions (search Â· settings Â· add project).
- **Left sidebar nav buttons** (search Â· settings) now match the Settings section
  nav height (`h-8`) instead of the slightly shorter `h-7`.
- **Project card header** no longer paints a hover background; the three header
  actions still reveal on hover and the active-project highlight is unchanged.
- **Clicking a worktree/branch row now opens a terminal.** Left-click (or
  Enter/Space) selects and links the worktree and opens a **default-profile
  terminal** when that workspace has none yet â€” so a click lands you in a working
  terminal instead of an empty pane. Repeated clicks don't stack duplicates (it
  only opens one when the workspace is empty).
- **Center tab strip.** Tabs now sit flush (removed the inter-tab gap and the
  always-reserved insertion markers, which collapse to zero width until they are
  the active drop target) and the **whole tab chip is the click target** (a tap
  anywhere on the colored chip selects it â€” previously only the label text did,
  a tiny hit area for short names like "pi"). Drag-to-reorder/move is unchanged.
- **Project / worktree cards rebuilt.** Dropped the heavy bordered card (we now
  reserve borders for the few places that need them): a project is a **borderless
  group** â€” an identity header (icon Â· name) whose three actions reveal on hover
  (collapse/expand Â· a unified launcher **+** Â· an overflow **â‹¯** with copy-path /
  remove-project). Expanding lists the worktrees as rows: the primary (main) first,
  then the children â€” identified by its "main" branch name (no badge). Each row
  shows an aggregate **agent-status dot** (or the branch icon when idle), the branch
  name, a second line with the worktree folder, git status, and a hover **â‹¯**
  (copy-path / remove-worktree, or remove-project for main); selection keeps the
  quiet sidebar-accent highlight. The project header's **+** opens the
  `LauncherDialog` window (see *Added*); the `LauncherMenu` dropdown (grouped by
  type â€” terminals Â· agents Â· browser Â· worktree) remains on the **center tab
  strip's +** for the single active worktree (replaces the separate terminal
  button + `LaunchAgentMenu`, now removed). `openTerminalAt` gained an optional
  `profileId`.
- **Compact agent space under each worktree.** The per-worktree agent block
  (`AgentSpace`) now reads as part of the worktree: the "Agents Â· n" toggle
  shrank to a quiet 10px header, and the agents nest under a **subtle vertical
  guide line** that ties them to their worktree/branch. The agent currently
  shown in the center gets a **firm accent bar** over that line, so you can tell
  which agent you're on at a glance. Rows keep our own status dot + agent logo.
A token-driven visual refresh (via the `svelte-clean-desktop-ui` system) toward a
calm, **comfortable**, tool-like desktop feel â€” readable type and breathable rows,
not a cramped grid â€” with no UI-library changes and no behavior or accessibility
regressions.
- **Title-bar-less layout.** Removed the top window title bar; the three panels
  now run to the very top of the window. The brand (logo Â· "Uxnan Desktop" Â·
  Alpha) moved to a header atop the **left sidebar**, and the min/max/close window
  controls to a header atop the **right panel** â€” rendered as a fixed top-right
  overlay so they stay reachable even when that panel is hidden (the OS chrome is
  disabled). The left sidebar's search + settings became borderless,
  settings-style nav buttons (tighter, a quiet accent when active), and the center
  pane's "+ Terminal" launcher (default shell + profiles) moved into the
  **Projects** header as a compact "+" menu, next to smaller add/refresh/sort
  icons. Vertical panel separation stays borderless (resize handles are invisible
  until hover), while a subtle horizontal divider marks the **top band** of each
  panel â€” the brand header, the center tab strip and the right-panel
  window-controls header â€” plus one under the right-panel tabs; those top sections
  share a height (h-9) and the center tab strip is tinted like the side panels, so
  the top band reads as one continuous strip. The window stays draggable via the
  top sections, and each shell region carries a `Region:` comment for reference.
- **Token-driven, equal header icons.** The compact action icons in the projects
  header and the right-panel toolbars (Files / Changes / History) now use the
  shared `icon.action` (14px) + `iconButton.xs` tokens instead of hardcoded sizes,
  so the left and right panels match exactly. Added `icon.action` to `design.ts`
  and `docs/design-tokens.md`.
- **Reusable divider token + status-bar divider.** Factored the top-band hairline
  into a `divider` token (`design.ts`: `divider.bottom` / `divider.top`, one
  `--border` hairline) and applied it at every divider site, and added
  `divider.top` to the bottom status bar so it's separated like the other sections.
- **Flush panels (zero-gap resize).** The column resize handles no longer occupy
  any layout width, so the left/right/browser panels sit flush against the center
  with no visible seam (it was most noticeable behind split terminals). Drag-to-resize
  still works via a wider invisible hit strip, with a hairline that appears only on
  hover. Factored into one reusable `resizeHandle` snippet.
- **Active tabs restyled; worktree bar removed.** Tabs no longer read as a floating
  badge â€” an active tab reads like a selected worktree, via a shared `tab` token
  (`design.ts`): the **center** terminal tabs use a quiet sidebar-accent fill + a
  firm foreground underline, while the **right-panel** view tabs use just the
  underline (no fill â€” cleaner on those small tabs). The shared `tabs-trigger`
  primitive (the right panel is its only consumer) was simplified to a neutral base
  so the token fully drives the active look. Removed the small vertical primary bar
  on the selected worktree (the surface fill already marks selection), and the
  status-bar panel toggles moved off the retired `surface.tab` to a plain neutral
  active fill. `docs/design-tokens.md` updated.
- **Center top band aligned + flush.** Dropped the 1px frame + rounding each
  terminal region drew around itself â€” it inset the top region's tab strip by 1px,
  so the center's top divider sat slightly below and inset from the left/right
  panel dividers, with a faint seam. The center now sits flush and its divider
  lines up with the others; the active-pane focus indicator is a non-insetting
  inset ring that only appears when the workspace is actually split.
- **Comfortable scale + bundled UI font.** **Geist** â€” a humanist, low-contrast
  variable sans â€” is the single UI face for **both body and titles** (the
  title/body hierarchy comes from size + weight, not a second face); it renders
  soft and light at 12â€“13px chrome, the opposite of a rigid geometric face. Both
  Geist and DM Sans are bundled as variable woff2 (`@fontsource-variable/geist` +
  `@fontsource-variable/dm-sans`, imported in `app.css`) so the leading family
  always resolves regardless of the OS â€” DM Sans is now only a fallback. A small
  global `letter-spacing` (0.01em) and grayscale antialiasing keep text even. The
  whole type/control scale moved up one
  notch toward a roomier desktop density: body text 12â†’13px, item titles 13â†’14px,
  metadata 11â†’12px, indicators 10â†’11px, section headings 14â†’15px; control icons
  14â†’16px; the default button, inputs and select triggers 32â†’36px tall; and the
  `row` recipes grew to ~32â€“36px with more horizontal rhythm. Because these are
  `design.ts` tokens + shared primitives, the new proportions propagate across the
  whole app. The left panel (sidebar search/settings/header, project & worktree
  rows, agent rows) and the Settings sections also got roomier inline padding,
  gaps and row heights so the breathing room is felt, not just the type size.
- **Foundations (`app.css` + `theme.ts`).** Added a layer of theme-aware semantic
  surface tokens â€” `--ux-shell`, `--ux-sidebar-accent`, `--ux-panel`,
  `--ux-panel-muted`, `--ux-editor-surface`, `--ux-elevated`, plus hover/subtle-border
  tints â€” derived from the base palette via `color-mix` (one formula darkens light
  themes and lightens dark ones), so every built-in and custom theme gains coherent
  shell/sidebar/panel depth automatically. Exposed them to Tailwind via `@theme inline`
  (`bg-ux-panel`, â€¦). Added a `can-hover:` variant so hover-reveal controls never
  stick on touch, sleek theme-aware scrollbars (`.scrollbar-sleek`,
  `.worktree-sidebar-scrollbar`), and a `prefers-reduced-motion` guard. **Geist**
  is the UI face for both `--ux-font-body` and `--ux-font-title` (DM Sans only a
  fallback), kept in sync between `app.css` and `DEFAULT_FONTS`.
- **Font overrides now carry a fallback (fixes "custom font doesn't apply").**
  A user-picked UI or terminal font was written to the CSS variable / xterm
  option **bare** (`"Some Font"` with no fallback), so the moment that one name
  couldn't resolve the text dropped to the browser's proportional serif â€” which
  read as "the app fell back to a basic system font". A new `composeFontStack()`
  composes any single picked family in front of the role's bundled stack
  (Geist / DM Sans / OS UI for sans, the full mono stack for terminals), applied
  in `applyTheme` and `resolveTerminal`, so a missing or misspelled family now
  degrades gracefully to the bundled face instead of serif.
- **Terminal typography defaults.** The default terminal font is now a richer
  cross-platform mono stack (`"SF Mono", â€¦ "Cascadia Mono", "JetBrains Mono", â€¦
  Nerd Font fallbacks, monospace`) at a lighter default weight (300) and 14px,
  for a cleaner, softer terminal face (still fully overridable per the terminal
  typography settings).
- **Font picker â€” choose from the installed system fonts.** Replaced the
  free-text font fields (a tiny hardcoded `datalist`) with a reusable
  **`FontPicker`** combobox (Popover + Command) that lists the machine's real
  installed fonts, each previewed in its own face, with the app's bundled faces
  (Geist / DM Sans) surfaced on top and a "use a custom family" escape hatch for
  names that only exist on another machine / SSH host. A new Rust
  `list_system_fonts` command enumerates families per-OS (PowerShell
  `InstalledFontCollection` on Windows, `fc-list` on Linux, `system_profiler` on
  macOS) through the windowless spawn helper, with a curated fallback so the list
  is never empty; the result is fetched once and shared across pickers. The same
  picker now drives the global UI/terminal font overrides **and** the per-theme /
  per-terminal-theme font fields, so all four font controls behave identically.
- **Unified launcher on the center tabs "+".** The center tab strip's "+" no
  longer opens a bare terminal â€” it now opens the same floating launcher as the
  project card, reusing `LauncherMenu` in a new single-worktree mode that groups
  the actions by **type section** (Terminals Â· Agents Â· Browser Â· Worktree) for
  the active worktree, in the current clean menu style. (The Global terminal
  space, which has no worktree to launch into, keeps the plain new-terminal "+".)
  `surface.active` / `activeNested` / `tab` tokens switched from primary-tinted
  fills to quiet sidebar-accent / foreground-mixed surfaces (propagating to the
  project & worktree cards, nested agent rows and panel tabs that consume them).
  Extended the module with layered `surface.{shell,sidebar,panel,panelMuted,elevated}`,
  dense `row` recipes, `field` (input + field-like search), `panel`
  (settings body / section header / cards) and a shared `focus` ring, plus
  `icon.nav`, `iconButton.{xs,sm,toolbar}` and `text.{pageTitle,subheading,bodyStrong}`.
  `docs/design-tokens.md` updated to match.
- **UI primitives.** Audited the shadcn-svelte primitives against the clean-desktop
  bar â€” button, input, badge, card, select, tabs, dropdown-menu and popover are
  already polished (compact density, foreground-mixed `ring-1` elevation, proper
  focus/disabled/invalid states) and were left intact. Fixed the one real gap:
  **`Dialog.Content` had no drop shadow** (only a hairline ring), so a modal read
  flatter than a dropdown â€” added a proper elevation shadow (light + dark) so the
  modal sits clearly above the overlay.
- **Left sidebar, project & worktree rows.** The project list now uses the sleek,
  hover-revealed sidebar scrollbar with a stable gutter (no more chunky track, no
  row shift). Project cards gained a soft `sidebar-border/60` border + a faint
  `sidebar-foreground` surface and a roomier header; project and worktree row hover
  switched from an accent tint to a quiet foreground-mixed fill. Selection stays the
  neutral sidebar-accent; the worktree active-indicator bar is the one deliberate
  primary accent (a focus marker).
- **Shell, agent space, right panel & terminal chrome.** Quieted the structural
  chrome so it recedes behind the content: the window resize handles and the
  terminal split dividers are now soft (`border/50`â€“`/60`) until hover
  (`ring/70`), and the status-bar, right-panel tab strip and terminal tab strips
  use softened `border/60` dividers. The nested agent rows hover with the same
  neutral foreground-mixed fill as the other rows, and the status-bar panel
  toggles now read as neutral lifted segments (stale "primary tint" comment
  corrected). Panel separation is still carried by the sidebar/canvas surface
  delta, so softer borders don't lose structure.
- **Completed the hairline softening.** Moved the shared `divider` token to
  `border-border/60` and dropped every remaining full-strength `border-border`
  seam to `/60` across the panel chrome â€” the Files/Changes/History toolbars and
  footers (`border-sidebar-border`), the commit / diff / file-editor headers, the
  browser toolbar, and the diff / theme-editor toggle dividers â€” so no structural
  hairline renders as a hard, crisp line (the earlier passes had only reached the
  top-band and tab-strip dividers).
- **Settings shell.** Widened the content column to `max-w-3xl` with the sleek
  scrollbar and roomier `px-8 py-7` padding; polished the section nav (steady
  `h-8` rows, 13px tracking-tight labels, foreground hover) and softened the
  header/nav dividers to `border/60`. The top band (back button + window
  controls) now carries a subtle horizontal divider so it separates from the
  content, and the section nav is **organized into titled groups** (General Â·
  Agents Â· Workspace Â· Application) using the shared `text.section` heading â€” the
  same section-header treatment as the home left sidebar â€” so the long flat list
  reads as areas. The deeper per-section "header over a soft body band"
  restructure is in progress (see below; tracked in `FOR-DEV.md`).
- **Settings sections â†’ clean-desktop pattern (in progress).** New reusable
  **`SettingsSection`** (strong title + description over a soft `panel.settingsBody`
  band) and **`SettingsRow`** (label + helper text, control right-aligned on wide
  screens, quiet `divide-y` between rows â€” no per-row card) replace the flat
  ad-hoc group stacks. Each setting now uses the **right control for its shape**:
  on/off settings are **`Switch`es**, not on/off comboboxes. Migrated to the
  section/row pattern: **Language, Browser, Updates, AI commit**; and **every
  on/off setting across Settings is now a Switch** (Browser Ã—4, AI commit Ã—3,
  Updates Ã—2, plus agent notifications + keep-awake) â€” multi-option settings
  (link policy, release channel, install policy, language, agent/model) stay
  Selects. **All nine sections** now use the section shell: settings-style ones
  (Language, Browser, Updates, AI commit, the agents settings) use the soft band
  of rows; list/editor-heavy ones (the agents catalog, hooks, shortcuts, terminal
  profiles) use a `bare` `SettingsSection` (consistent header, no band â€” avoids
  card-in-card) with softened `/60` borders. The top band also dropped from h-12
  to h-9 to match the home top band. **Appearance** (Interface + Terminal) was
  brought into the same shell. **Shortcuts** moved from per-group bordered boxes
  to one band with divider-separated rows. **Hooks** dropped its duplicate inner
  header. The **agents** and **terminal-profiles** lists are now single
  divider-separated containers where each item is a **collapsible row** that
  expands to its config (agent: command/args/shell/env; profile: command/args);
  for agents, configured ones sit first and the remaining known agents follow as
  add-rows, greyed when not found on PATH.
- **One combobox for every single-select field.** All the settings dropdowns
  (Language, default agent, agent shell, AI-commit agent + language, update
  channel + install policy, browser link policy, terminal default profile)
  switched from the plain `Select` to the shared searchable **`Combobox`**
  (Popover + Command) â€” the same field the font pickers, the AI model picker and
  the launcher window use. The **agent** selectors now show each agent's **logo**
  on the trigger and rows (consistent with the AI-commit list) via the combobox
  `itemPrefix`. Removed the now-dead per-field label derivations.
- **Bigger agent catalog + favicon logo fallback.** The known-agent catalog
  (`agentCatalog.ts`) grew from 11 to 33 CLI agents (Cursor `cursor-agent`,
  Aider, Amp, Cline, Droid, GitHub Copilot, Continue `cn`, Kiro `kiro-cli`,
  Auggie, Crush, Codebuff, Command Code, MiMo Code, Devin, Hermes, Mistral Vibe
  `vibe`, Rovo Dev, Autohand, OpenClaude, OpenClaw, OMP, Ante), so more agents
  are detected on PATH and one-click addable in Settings â†’ Agents. Every agent
  now shows a real logo via a fallback chain in `AgentLogo` â€” a user's custom
  logo â†’ a bundled `static/agents/<logo>.svg` â†’ the product's **favicon**
  (`favicon` field per catalog entry, via Google's favicon service; new
  `agentIconSources`/`faviconUrl`) â†’ the generic Bot glyph â€” each candidate
  advancing on `onerror`. This applies everywhere logos render: the Agents list,
  every agent combobox, and the left-panel project/worktree cards. So the 22 new
  agents get logos without shipping SVGs; a bundled SVG (still optional, now
  tracked as a *crispness* upgrade in `FOR-HUMAN.md`) simply takes priority.

### Fixed
- **Terminal copy/paste respect the platform modifier.** Copy/paste in a terminal now
  use the primary modifier â€” **âŒ˜ on macOS**, Ctrl elsewhere â€” instead of Ctrl on every
  platform. On macOS `âŒ˜+C`/`âŒ˜+V` copy/paste and `Ctrl+C` stays the shell's SIGINT; the
  right-click menu shows `âŒ˜C`/`âŒ˜V`. Windows/Linux behavior is unchanged.
- **New terminals open in the active project's folder, not the PC home.** A terminal
  created for a worktree â€” the empty-state button, the tab-strip `+`, the *New
  terminal* shortcut, or a split â€” now defaults its working directory to that
  workspace's folder. Before, it spawned in the home directory unless the caller
  passed an explicit `cwd` (only the card context menu did), so the shortcut/`+`
  terminals all landed in home even inside a project. Centralized in
  `terminals.create`/`split` via a `cwdFor` helper; the Global scratch space (which
  has no folder) still opens in home.
- **Integrated browser: re-docks when the app window moves/resizes.** The browser
  is a separate owned webview positioned in absolute screen coords over the panel
  slot; its bounds were only re-pushed when the slot's *window-relative* rect
  changed, so moving the whole app window (whose relative rect is unchanged) left
  the browser stranded at the old screen position with an empty panel. `BrowserPanel`
  now listens to the main window's `onMoved`/`onResized` and re-places the docked
  window from the new origin.
- **Integrated browser: window controls no longer cover its toolbar.** When the
  browser panel is open it's the right-most panel, so the min/max/close overlay
  (fixed top-right) landed on top of the browser's back/forward/reload + address
  bar. The panel now leads with the same `h-9` drag strip the right panel uses, so
  those controls float over an empty strip and the toolbar sits clear below it.
- **History: overlapping stale rows after expand/collapse (+ graph polish).**
  Expanding then collapsing a commit could leave its file rows painted on top of
  the following commits with the branch graph looking cut. Root cause was in the
  shared `VirtualList`: it pushed the virtualizer's `count`/sizes in a *post-render*
  `$effect`, so the render that reads the derived rows saw the previous options for
  one frame â€” enough to strand the absolutely-positioned rows. It now syncs options
  in `$effect.pre` (before the render reads them), so the row set is always current.
  Also, in the History tab: the commit row no longer paints an accent background
  (it sat *behind* the graph gutter and clashed with the node's background-punch),
  and an expanded commit's file rows no longer draw graph lanes through them â€” the
  graph stays put instead of stretching down the file list (rows keep their gutter
  indent via a plain spacer). Removed the now-unused `contGutter`/`continuingLanes`.
- **Kilo Code detection command.** The catalog listed Kilo Code under `kilocode`;
  its real PATH executable is `kilo`, so it now detects correctly.
- **Install-policy field readability.** Settings â†’ Updates â†’ Installation kept its
  compact `w-56` combobox but with short option labels (Ask me / Automatically /
  Manually) and a trimmed one-line description; a small `?` beside it opens a
  hover-card explaining all three policies (`SettingsRow` gained an optional
  `help` snippet for this).
- **Git status not reflected in the UI (file-tree coloring + Changes tab empty).**
  The active worktree's git status was loaded only inside `RightPanel` â€” which
  mounts only while the right panel is open â€” so the file-tree change coloring,
  the project-card dirty badges and the Changes tab could all show nothing despite
  real changes. The load now lives in the always-mounted shell (`+page.svelte`),
  next to the filesystem watcher and keyed off the active worktree, so the status
  follows the worktree regardless of which panel/tab is open. The live
  `git:status-changed` subscription moved with it.
- **Window drag lost in the center panel.** With the top title bar removed, the
  center had no drag handle. Its top band â€” the tab strip (its empty area + the
  flex spacer) and the empty-state canvas (logo + copy) â€” is now a
  `data-tauri-drag-region`, so the window drags again from the center while tabs
  and buttons stay clickable (Tauri matches the exact target).
- **Invisible scrollbars on light themes.** The dense-panel scrollbar
  (`.uxnan-scroll`, used by the file tree, changes/commit panels, diff breadcrumb,
  directory picker, theme editors and virtualized lists) used a fixed white thumb,
  so it disappeared on light themes. It's now a theme-aware `muted-foreground` tint
  (via `color-mix`), visible on both light and dark. The xterm terminal viewport
  keeps its own light thumb (it renders on its own dark surface).

### Changed â€” docs
- **Desktop UI skill consolidated.** The monorepo `AGENTS.md` now scopes a single
  canonical Svelte/desktop skill, `svelte-clean-desktop-ui` (from
  `https://github.com/luisgamas/skills`), to `uxnandesktop/` â€” replacing the prior
  trio (`shadcn-svelte`, `svelte-code-writer`, `svelte-core-bestpractices`). It is
  the token-driven clean desktop UI/UX system to use for all `uxnandesktop/` UI work.

## [0.0.2-alpha.20260628] - 2026-06-28

### Added â€” integrated developer browser
- **A complete in-app developer browser** to preview/debug the systems agents build
  and open the links agents produce â€” **not** a general-purpose browser. It lives in
  a new **right-side "4th panel"**: toggle it from the status bar (globe), or let a
  link route into it. Chrome: back / forward / reload / address bar /
  open-in-system-browser / DevTools.
- **Rendered with a real `WebviewWindow`** (`src-tauri/src/browser.rs` +
  `BrowserPanel.svelte`): the page is a frameless system webview (Chromium/WebView2
  on Windows) **owned by** and **docked to** the main window â€” it loads **any** site
  (Google included, no embedding restrictions) and exposes **real DevTools**, while
  staying light (it reuses the OS webview the ADE already runs). The toolbar lives in
  the panel's DOM; the page window is glued over the panel's content area and
  follows the app's move/resize, so it reads as a 4th panel. It's created lazily on
  open and destroyed on close, and never persists across restarts. The page **fills
  the panel and resizes with it** (the window is non-resizable on its own â€” only the
  panel's handle changes its size); the panel width is persisted (`browserPanelWidth`).
  *(Note: this supersedes an earlier `<iframe>` attempt â€” too limited, blocked by
  `X-Frame-Options` â€” and a native child-webview attempt that froze the app on
  Windows; the owned `WebviewWindow` is the stable, complete approach.)*
- **One link-routing decision point** (`open_url` â†’ `browser::route_url`): every
  link the ADE opens funnels through the user's policy â€” the in-app browser, the OS
  browser, or a per-link prompt â€” with the OS browser always available as a fallback
  (`open_external`).
- **`BrowserSettings` / `BrowserLinkPolicy`** in the persisted `AppSettings`
  (`enabled` Â· `linkPolicy` internal/external/ask Â· `allowAgents` Â· `terminalLinks`
  Â· `homepage`; all `#[serde(default)]` so older state loads unchanged) with a new
  **Settings â†’ Browser** pane (EN/ES).
- **Agents open links in-app automatically.** When the browser is enabled and
  *allow agents* is on, each agent terminal gets `UXNAN_BROWSER_URL` +
  `UXNAN_BROWSER_TOKEN` and a `$BROWSER` shim (`static/hooks/uxnan-browser.{sh,cmd}`,
  written alongside the hook scripts). A URL the agent opens is POSTed to the hook
  server's new **`/browser`** route, which applies the same link policy. Agents can
  also open one explicitly: `curl -X POST "$UXNAN_BROWSER_URL" -H "X-Uxnan-Token:
  $UXNAN_BROWSER_TOKEN" -d '{"url":"â€¦"}'`.
- **Clickable terminal links** (`@xterm/addon-web-links`): **Ctrl/Cmd-click** a URL
  printed in the terminal to open it through the link policy (a plain click is just
  text, like VS Code). Toggle in Settings â†’ Browser.

### Fixed â€” no more console windows flashing open on Windows
- **The packaged Windows app no longer flashes a cascade of console windows on
  launch (and during use).** A release build runs under the Windows `windows`
  subsystem (no console of its own), so every child process the app spawned â€”
  `git` (including the 3s status watcher and the initial repo load), `wsl.exe`
  for WSL repos, and the agent CLIs probed for model discovery / AI commit
  messages â€” got a brand-new console **window** allocated by Windows. They
  appeared as terminal windows blinking open and shut, one after another. The bug
  was invisible in `cargo tauri dev` because a debug build keeps a console the
  children inherit.
- **Fix:** a new `src-tauri/src/winproc.rs` helper (`winproc::command`) creates
  every spawned `tokio::process::Command` with the `CREATE_NO_WINDOW` creation
  flag on Windows (no-op elsewhere). `git.rs` (`git_command`, covering `git` +
  `wsl.exe`) and `aicommit.rs` (agent generation + Codex/Claude/Gemini model
  discovery) now route through it. PTY-hosted shells were never affected â€” they
  run under ConPTY, which is already windowless.

## [0.0.1-alpha.20260627] - 2026-06-27

### Added â€” in-app auto-updater (Settings â†’ Updates)
- **The ADE now checks GitHub Releases for a newer version, downloads it in the
  background and installs it on your terms** â€” built on `tauri-plugin-updater`.
  A slim, dismissible banner under the title bar announces an available version,
  shows download progress, and offers the install choices.
- **Download and install are separate, deliberate steps.** Downloading is
  non-disruptive and runs in the background; *installing restarts the app, which
  stops every running agent* (each agent is a PTY child of the app â€” a restart
  can't keep it alive). So the install is guarded: when an agent is working the
  banner offers **Install when idle** (auto-installs the moment all agents go
  quiet), **Install now** (with a clear "an agent is running" warning), or
  dismiss for later. Before installing, the backend closes terminals cleanly
  (same path as app exit) so nothing is killed mid-write.
- **Update channels: stable Â· nightly** (default *stable*), mapped to GitHub's
  **`prerelease` flag** â€” a normal Release feeds *stable*, a Release marked
  pre-release feeds *nightly* â€” **not** the tag. So a `â€¦-alpha.YYYYMMDD` tag still
  ships to stable as long as the Release isn't flagged pre-release. The updater
  polls a rolling per-channel manifest
  (`â€¦/releases/download/desktop-updater-<channel>/latest.json`). Version
  *comparison* uses the numeric base (`0.0.5`) the MSI bundles, so bump that base
  per release; the pre-release suffix is display-only.
- **Settings â†’ Updates** pane: current version (the **full** release name via the
  new `app_version` command, e.g. `0.0.5-alpha.20260628`, not just the MSI base) +
  manual "Check now", release channel, check-automatically and
  download-automatically toggles (both on by default), and an install policy
  (*Ask me* / *Automatically when agents are idle* / *Only when I trigger it*;
  default *Ask me*). Full EN/ES i18n.
- **Backend** (`src-tauri/src/updater.rs`): `updater_check`, `updater_download`
  (stages the signed installer in memory, emits `updater:download-progress` +
  `updater:downloaded`), `updater_staged`, `updater_install` and `app_version`
  (full display version) commands; a per-channel `endpoint_for`; `UpdaterSettings`
  / `UpdateChannel` (stable/nightly) / `InstallPolicy` added to the persisted
  `AppSettings` (all defaulted, so older state loads unchanged). Signature
  verification uses a free minisign `pubkey` in `tauri.conf.json` (unrelated to OS
  code-signing).
- **Release CI**: `release-desktop.yml` now signs the updater artifacts when the
  `TAURI_SIGNING_PRIVATE_KEY` (+ password) secrets are present and injects the
  full release name as the `UXNAN_VERSION` build env (for `app_version`); a new
  `release-desktop-manifest.yml` reads the published release's `prerelease` flag
  and copies its `latest.json` onto the rolling stable/nightly release the updater
  polls. Both degrade cleanly until the signing key + a published, signed release
  exist (see [`docs/updates.md`](docs/updates.md) and `FOR-HUMAN.md`).
- **Tests**: +2 Rust (`updater.rs` per-channel endpoints) and +6 Vitest
  (`updaterLogic.test.ts` â€” progress fraction + install-policy decision), for
  **100 Rust + 25 Vitest**.

### Fixed â€” history log CLI fallback order
- The `git log` CLI fallback now uses `--date-order` (was `--topo-order`) so it
  matches the primary git2 path (`Sort::TOPOLOGICAL | TIME`). The fast path was
  already correct, so this only affects repos `git2` can't open. `src-tauri/src/git.rs`.

### Changed â€” history branch graph: VS Code swimlane curves
- **The History graph now uses the VS Code swimlane model + true arc
  connectors.** Lanes *compact* â€” when a branch merges, the extra lanes waiting
  for the commit collapse into the node and the lanes to their right shift one
  column left â€” so the graph narrows with flowing curves instead of leaving
  parallel gaps. Connectors are real circular arcs: a quarter-circle (radius â‰ˆ
  one lane) into/out of a node, and a gentle S when a passing lane shifts
  column â€” replacing the previous stable-lane layout and tiny rounded-step
  "L" connectors. Node dots are unchanged (solid dot, with a separate outer
  ring on merges). `src/lib/gitGraph.ts` (swimlane layout â†’ per-row `GraphEdge`
  list) + `src/lib/components/HistoryPanel.svelte` (arc path geometry).

### Changed â€” file tree: dim git-ignored entries
- **The Files tab now dims git-ignored entries (muted + italic),** so files and
  folders git ignores (`node_modules`, `build`, `.env`, â€¦) read as clearly apart
  from tracked/untracked ones â€” matching the convention an IDE file tree uses and
  the mobile app's file browser. The git *change* colours (untracked green,
  deleted red, modified/staged amber) are unchanged; "ignored" is a distinct
  concept layered on top, and it wins over a change colour (an ignored entry
  never has a git change anyway).
- **Backend (`fs.rs` + `gitfast.rs`).** `FsEntry` gained an `ignored: bool`;
  `list_dir` fills it per-listing via the new `gitfast::ignored_flags` (git2
  `is_path_ignored`, run on the blocking pool, best-effort so a non-repo
  directory just leaves every entry un-flagged). Mirrors `git check-ignore`:
  tracked files matching a rule are not flagged. Because the check is per-listing,
  an ignored directory's children are each flagged when it's expanded â€” no
  frontend ancestor-propagation needed. `git status` / the Changes panel are
  untouched (ignored entries never appear there).
- **Frontend** (`FileTreePanel.svelte`, `types.ts` `FsEntry.ignored`): ignored
  rows render muted + italic. Tests: +2 Rust (`gitfast`: `ignored_flags` matches a
  `.gitignore` for files + dirs; all-false outside a repo) â†’ **98** backend tests.

### Added â€” git: visual image diffs
- **Image files now diff visually (before/after) instead of as binary text.**
  Opening the diff of a `.png`/`.jpg`/`.jpeg`/`.gif`/`.webp`/`.bmp`/`.ico`/
  `.svg`/`.avif`/`.tif(f)` change shows the two versions side by side on a
  checkerboard backing, with an "Added (new file)" / "Removed" placeholder for a
  one-sided change. New backend `git::image_diff` + `git_image_diff` command
  (base64-encoded blobs via the new `base64` dep; `HEAD`â†’index for the staged
  view, indexâ†’working-tree otherwise; routes through `wsl.exe` for WSL repos) and
  `image_mime`. Frontend: `isImagePath` (`src/lib/diff.ts`), `DiffViewerState`
  loads the image versions, and the new `ImageDiffView.svelte` renders them
  (DiffPane picks it for image files). 3 new backend tests + EN/ES strings.

### Added â€” git: optional AI commit-message generation
- **Draft commit messages from the staged diff with a local agent (opt-in).** A
  new **Settings â†’ AI commit** section turns it on and keeps it
  non-technical: pick an **agent** (only the installed ones of Claude Code,
  Codex, Gemini, OpenCode, Pi are selectable) and a **model** from a
  **searchable shadcn-svelte Combobox** (`AiModelPicker.svelte`, Popover +
  Command â€” added the `command` + `input-group` ui primitives) with a fixed-width
  trigger, so the hundreds of models OpenCode/Pi can report stay filterable
  instead of overflowing: "Default" plus a live `opencode models` /
  `pi --list-models` / `codex app-server` `model/list`
  query, or Claude's exact concrete versions (`claude-opus-4-8`, â€¦, maintained in
  `agentcli.rs::CLAUDE_MODELS` with a how-to-update guide) / Gemini's curated
  set, the message **language** (Automatic / English / Spanish), **Conventional
  Commits** subject on/off, **extended body** on/off, and free-form **extra
  instructions** â€” no command/flags to configure. When enabled, a **Generate**
  button appears in the commit composer; it runs the agent non-interactively (a
  one-shot subprocess â€” *not* a PTY â€” with stdin closed, a 120 s timeout and
  `kill_on_drop`; no provider API/SDK/keys, just the local CLI), feeds it the
  staged diff (capped at 24 KB) and fills the summary + body. New backend
  `src-tauri/src/agentcli.rs` (resolves each CLI the way the bridge does â€”
  `node <entry.js>` for npm installs, native binary otherwise, so the
  non-interactive run works on Windows) + `src-tauri/src/aicommit.rs` +
  `git_generate_commit_message` / `ai_commit_agents` / `ai_commit_models`
  commands + `git::staged_diff`; `which::resolve`; new `AiCommitSettings`
  (agent + model) on `AppSettings` (off by default, back-compat defaulted);
  `AppError::Agent` variant. Frontend: the settings section (agent + model
  pickers), the composer button (`git.generateMessage`), `aiCommitPresets.ts`
  (supported-agents list), and EN/ES strings. 14 new backend tests (CLI
  resolution / arg building / model-list parsing + prompt building / diff
  truncation / output sanitizing + settings round-trip).

### Added â€” git: WSL repos run through `wsl.exe`
- **Repos opened from a WSL distro now use the distro's own git.** When a repo
  path is a WSL UNC path (`\\wsl.localhost\<distro>\â€¦` or the legacy `\\wsl$\â€¦`,
  in either slash form), the git layer routes every command through
  `wsl.exe -d <distro> git -C <linux-path> â€¦` instead of running the Windows
  `git.exe` against the slow 9P share (which can also disagree with Linux git on
  line endings / file modes / hooks). The new `src-tauri/src/wsl.rs` parses the
  UNC path, `git::git_command` builds the routed invocation (translating any
  WSL-path argument, e.g. a worktree path, to its Linux form), `worktree_list`
  translates the Linux paths git reports back to the registered UNC form so
  per-worktree workspace keys line up, and the `git2` fast path is skipped for
  WSL repos (libgit2 can't see them the way the in-distro git does). Windows-only
  routing; a no-op elsewhere. 8 new unit tests (`wsl` parse/round-trip +
  `worktree_path_for` under a WSL prefix).

### Added â€” git: squash-merged branch cleanup on worktree removal
- **Removing a worktree now cleans up a squash-merged branch.** After the safe
  `git branch -d` (which only deletes truly merged work), the backend now detects
  **patch-equivalence** for a squash merge â€” it synthesizes a dangling commit
  with the branch's tree on top of `merge-base(base, branch)` and asks
  `git cherry` whether the base already contains an equivalent patch â€” and, when
  confirmed, force-deletes the branch (`-D`); otherwise the branch is **kept** so
  no work is ever lost (`src-tauri/src/git.rs` `is_squash_merged` +
  `RemoveOutcome`; 2 new integration tests). `worktree_remove` now returns a
  `RemoveOutcome` (`branchDeleted` / `branchPreserved` / `squashMerged`), and the
  removal toast reflects what happened to the branch
  (`src/lib/state/projects.svelte.ts`, new `toast.worktreeRemoved*` strings).

### Changed â€” git & worktrees follow-ups
- **Commit composer fields use shadcn components.** The commit **summary** and
  **extended description** are now `shadcn-svelte` `Textarea`s, and each
  co-author row is a `shadcn-svelte` `Input`, replacing the hand-rolled
  `<textarea>`/`<input>` markup so the composer inherits the design-system
  focus ring, sizing and dark-mode tokens like the rest of the UI
  (`src/lib/components/ChangesPanel.svelte`).

### Added â€” agents: multi-agent orchestration, per-agent env vars, configurable launch shell
- **Multi-agent orchestration console (spec `02d` Â§3).** A new modal â€” opened
  from the status bar once **â‰¥2 agents** are running â€” lists every live agent
  grouped by type and routes a message to them: to **all** agents, to **one type
  (fan-out)** (e.g. every `claude`), or to the **coordinator's workers**. Mark
  any agent as the **coordinator** (the in-memory task-graph root) to unlock the
  workers target. Delivery is **backpressured** â€” each agent receives its next
  queued message only once it reports free again (precise hook state when
  available, else coarse output activity), so a slow worker is never flooded.
  Per-agent queue depth, status dots and a "go to terminal" jump are shown
  inline. Pure routing/queue logic in `src/lib/orchestration.ts` (unit-tested);
  reactive store (live agents, backpressure timers, PTY delivery) in
  `src/lib/state/orchestration.svelte.ts`; UI in `OrchestrationConsole.svelte`.
- **Per-agent environment variables.** Each agent profile can now carry `env`
  vars (e.g. `ANTHROPIC_MODEL=â€¦`, a proxy/host override), edited as key/value
  rows in **Settings â†’ Agents**. They're set on the agent's shell at launch
  (inherited by the agent process); the ADE's own `UXNAN_*` hook vars always win
  on a key clash. New `EnvVar` model + `env` field on `AgentProfile` (Rust + TS),
  threaded through `launchAgent` â†’ `pty_create` (new `env` param).
- **Configurable agent launch shell â€” Command Prompt by default on Windows.**
  Agents that don't pin their own shell now launch in a configurable default
  (**Settings â†’ Agents â†’ "Agent launch shell"**). The smart default is
  **`cmd.exe` on Windows** (agent CLIs start faster and quote more predictably
  than under PowerShell), else the default terminal profile. New
  `agentShellProfileId` setting + `app.agentShellProfile()` resolver.
- **Shell-aware argument quoting.** The agent launch command line is now quoted
  for the syntax of the shell it lands in (PowerShell / cmd / POSIX), so agent
  args with spaces or special characters (paths, `-p "a prompt"`) survive instead
  of breaking. New pure `src/lib/shell.ts` (`shellKind`, `quoteArg`,
  `buildRunCommand`), unit-tested, replacing the previous whitespace-only quoter.
- **Verified: agent auto-launch on worktree create.** The create-worktree flow
  already auto-launches the chosen agent (global default pre-selected, override
  or "None" per worktree); it now also benefits from the configurable launch
  shell. Removed from `FOR-DEV.md`.
- **End-user docs.** New [`docs/orchestration.md`](docs/orchestration.md) (what
  it is, where to find it, how to activate it, routing, the coordinator/worker
  graph, backpressure, caveats) and
  [`docs/agent-launch.md`](docs/agent-launch.md) (registering agents, per-agent
  env vars, the launch shell, auto-launch, quoting), both linked from the README
  Docs list and cross-linked with `docs/agent-hooks.md`.

### Added â€” frontend unit tests (Vitest)
- First **frontend test harness**: Vitest (`npm test`) with unit tests for the
  pure agent-launch and orchestration logic (`shell.test.ts`,
  `orchestration.test.ts` â€” 19 tests). Minimal `vitest.config.ts` (node env,
  `$lib` alias); no component tests yet.

### Added â€” terminal: tab reorder/MRU, backend ring buffer, CSI-u keyboard protocol
- **Tab reorder + drag between regions.** Tab chips can be dragged: drop one
  elsewhere in its strip to reorder it, or onto another region's strip to move
  it there (an insertion marker shows where it'll land, a label follows the
  pointer, and a region emptied by a move collapses). Implemented with **pointer
  events** (`pointerdown`/`move`/`up` + `elementFromPoint` hit-testing, like the
  split dividers) â€” **not** HTML5 drag-and-drop, which Tauri's native OS
  drag-drop (the file-drop-into-terminal feature) suppresses inside the WebView,
  so dragging didn't work at all. New `terminals.moveTab()` + the handlers in
  `TerminalArea.svelte`. Reordering within a region never remounts xterm;
  crossing regions remounts the pane, which transparently restores from the new
  backend snapshot (below). `src/lib/state/terminals.svelte.ts`.
- **MRU tab cycling + split focus, as configurable shortcuts.** `Ctrl+Tab` /
  `Ctrl+Shift+Tab` cycle the active region's tabs in most-recently-used order (a
  frozen order while you keep pressing; the landed tab becomes most-recent once
  the cycle settles), and `Ctrl+Alt+â†’` / `Ctrl+Alt+â†�` move focus between split
  regions. Both are **rebindable in Settings â†’ Keyboard shortcuts** (new
  "Terminal tabs & splits" group: `cycleTabNext/Prev`, `focusSplitNext/Prev`),
  dispatched by the global handler and, while a terminal is focused, by
  `Terminal.svelte` via `matchAction` so they never reach the PTY.
  `terminals.cycleTab()` / `focusSplit()` + the per-tab MRU list in the store.
- **`Close tab` (Ctrl/âŒ˜+W) now closes any tab â€” including a terminal â€”** with
  the usual save/discard/cancel prompt for an unsaved file (it previously only
  closed file/diff tabs and left Ctrl+W to the shell). Rebindable like the rest;
  rebinding it away restores the shell's `Ctrl+W` (delete-word).
- **Backend hidden-tab ring buffer.** Each PTY now keeps a bounded (256 KiB)
  ring of its most recent output in Rust (`OutputBuffer` in `pty.rs`), marked
  *stale* once it overflows. New `pty_snapshot` command returns it, and
  `pty_create` now reports whether the session was freshly spawned (`created`).
  A pane whose xterm is recreated (e.g. a tab dragged to another region) replays
  the snapshot so its scrollback isn't lost (`Terminal.svelte`). Supersedes the
  client-only `scrollback: 5000` reliance for the remount case.
- **Modern keyboard protocol (Kitty / CSI-u).** New `keyboardProtocol.ts`
  implements the terminal half of the progressive keyboard-enhancement protocol
  (flag stack, query/push/pop/set negotiation via `registerCsiHandler`, and a
  validated `CSI <code> ; <mods> [: <event>] u` encoder). It is **dormant until
  an app enables it**, so existing key handling is unchanged; when active it
  disambiguates `Ctrl+I`/Tab, `Esc`, modified specials and `Ctrl`/`Alt`+letter
  combos, and supports report-event-types / report-all-keys. Functional/nav keys
  fall through to xterm's legacy encoding (see `FOR-DEV.md`).
- **Alt-screen wheel scrolling** is provided by xterm.js (wheel â†’ arrow keys in
  the alternate buffer); verified, no override added that would defeat it.
- **Tests:** +4 Rust unit tests for the ring buffer (now **69** backend tests);
  the CSI-u encoder was validated against known Kitty values during development.
- **Spec/docs:** `architecture/02b-terminal-engine.md` (PTY buffer Â§2, tab/MRU,
  keyboard protocol), `README.md` (test count), `FOR-DEV.md` (items removed),
  `keybindings.ts` + en/es shortcut strings (new "Terminal tabs & splits" group).

### Changed â€” history branch graph looks like VS Code
- **Branch-stable lane colors.** The history graph colored lanes by *column
  index*, so two unrelated branches that happened to share a column looked like
  the same branch. Each lane now carries a color id assigned when it's born and
  kept for its whole life (a reused lane gets a fresh one), so a branch keeps
  its color even as it shifts columns â€” matching VS Code. `src/lib/gitGraph.ts`.
- **Rounded-step connectors + ringed merge nodes.** Branch/merge edges are now
  drawn as VS Code-style rounded steps (vertical â†’ quarter-arc â†’ horizontal)
  instead of straight diagonals, and merge commits render as a solid dot with a
  separate outer ring. `src/lib/components/HistoryPanel.svelte`.
- The log itself was already correct (git2 `Sort::TOPOLOGICAL | TIME` / CLI
  `--topo-order`, offset paging, no merge-shortstat parsing) â€” only the graph's
  visuals changed. Docs: `architecture/02c-git-worktrees.md` Â§6.4.

### Changed â€” agent notifications: precise, hook-driven, enriched
- **No more "agent is idle" notifications.** The coarse output-activity inference
  no longer raises any notification or unread badge â€” it only drives the visual
  "working" dot (`agentMonitor.svelte.ts`). It used to fire ~12 s after an agent
  fell quiet, even when no task had run (just leaving an agent at its prompt).
- **Notifications now come from the precise hook layer** (`agentStatus.svelte.ts`)
  on meaningful transitions â€” `done` / `waiting` / `blocked` (never `working`):
  app in background â†’ native OS notification; app focused â†’ in-app toast; already
  looking at that terminal â†’ nothing. Each non-`working` result also flags the
  worktree unread.
- **Enriched completion notifications.** The Claude Stop hook now reads the
  session transcript and sends the task (last user prompt) + a short **response
  preview** (`summary`, new field threaded through the hook payload â†’ report â†’
  cache â†’ `agent:status-changed` event). The `done` notification reads
  "{agent} finished the task" with the preview (or the task) as the body.
- **Spec/docs:** `architecture/02d-agent-monitoring.md` Â§1/Â§2.1 (payload `summary`,
  notification behavior), `docs/agent-hooks.md` (payload table).

### Changed â€” window chrome relocation: status bar + sidebar
- **Settings entry moved to the projects sidebar** (a full-width outline button
  with a Kbd shortcut hint, under the search button) and removed from the title
  bar. Closing still uses the Settings view's own back button.
- **Status bar reorganized.** The active-workspace **breadcrumb** (repo / branch)
  moved out of the center terminal strip to the **left** of the status bar
  (shared `projects.activeContext`). The **show/hide panel toggles** (left & right)
  now live at the **right** of the status bar and are selectable â€” the primary
  tint (`surface.tab`) shows when a panel is visible, mirroring the right-panel
  tabs. The left toggle left the title bar and the right toggle left the terminal
  strip.
- **Backend indicator is now an icon + popover** (`BackendStatus.svelte`, new
  shadcn `popover`). The color tracks the connection (green/amber/red) and the
  popover surfaces live detail (state, error, project count). The flat
  "N repositories" status-bar text was removed (the count lives in the popover).

### Changed â€” sidebar search palette, shortcuts & command-dialog polish
- **Sidebar search is now a full-width button** (`LeftSidebar.svelte`) that opens
  the command palette, with a `Kbd` shortcut hint (Ctrl/âŒ˜+P). Removed the
  separate quick-switch (Zap) button â€” the search button is the single entry
  point. New reusable `Kbd.svelte` keycap for surfacing shortcuts on big actions.
- **Add-project keyboard shortcut** (`addProject`, default Ctrl/âŒ˜+O, rebindable
  in Settings â†’ Keyboard shortcuts). The directory picker is now mounted at the
  page root and opened via shared `projects.pickerOpen`, so the shortcut works
  even when the sidebar is collapsed.
- **Coherent command dialogs.** The quick-switch palette and the add-project
  picker share a navigation hint bar (`DialogHints.svelte`: â†‘â†“ navigate Â· â†µ
  select Â· Esc exit). The palette gained an accessible `Dialog.Title`/
  `Description` (was missing), and the picker now supports â†‘/â†“ + Enter keyboard
  navigation over its folder list.
- **Spanish (MX) copy fixes.** Replaced "Saltar a un worktree" with "Buscar un
  proyecto o worktree"; reworded the palette/shortcut strings accordingly.
- **Settings â†’ Keyboard shortcuts is grouped into sections** (General Â· Projects
  & navigation Â· Panels Â· Editor) instead of one flat unordered list, so a
  shortcut is easy to locate (`KeyAction.category` + `SHORTCUT_GROUPS`).

### Changed â€” left/right panel polish + any-folder projects + window state
- **Right-panel tabs (Files | Changes | History)** now show a clear, primary-
  tinted **active indicator** matching the left panel's selected card (shared
  `surface` design token in `design.ts`), instead of the easy-to-miss underline.
- **Selection language unified.** Project/worktree cards and the active tab use
  `surface.active` (`bg-primary/15` + primary ring); the selected **agent row**
  uses the lighter `surface.activeNested` (`bg-primary/10`) so it always reads as
  subordinate to its parent card (`ProjectCard`/`WorktreeRow`/`AgentSpace`).
- **Hooks indicator moved.** Removed the per-terminal-tab "install hooks" hint
  (`TerminalArea.svelte`). A single indicator now lives in the **status bar,
  bottom-right** (next to the repo count) and only appears when hooks actually
  need attention â€” not installed, unreadable, or the OS refused them. Backed by
  new `app` hook-health state (`hookInstall`/`claudeHooks`/`hooksNeedAttention`,
  refreshed on startup and after a Settings â†’ Hooks toggle). Claude + generic
  hook scripts still auto-install on startup (`auto_install_hooks` default on).
- **Any folder is now a project.** `repo_add` accepts any directory (git or not)
  instead of rejecting non-git folders; `RepoData.is_git` records which. Non-git
  folders synthesize a single main worktree (`git::list_worktrees`), and
  `git_status`/`worktree_status` return empty/default for them (no error toast).
  The picker can add any folder; non-git project cards hide the worktree
  affordances and use a plain folder icon (`DirectoryPicker`/`ProjectCard`).
- **Window size remembered.** Added `tauri-plugin-window-state` so the window
  reopens at the last size/position/maximized state; bumped the first-run default
  to 1480Ã—920 (`tauri.conf.json`).

### Added â€” filesystem watcher: file tree auto-refresh
- **Backend watcher** (`src-tauri/src/fswatch.rs`, `notify` +
  `notify-debouncer-full`): watches the active worktree root recursively
  (debounced ~300 ms, `.git` filtered) and emits a `fs:changed` event. New
  `fs_set_watch(path?)` command + `FsWatcher` in `AppState`; the watch is aimed
  at the active worktree centrally in `+page.svelte`.
- **File tree** reloads only the affected (already-loaded) directories on
  `fs:changed`, preserving expansion â€” files created/deleted on disk (e.g. by an
  agent) now appear without a manual refresh (`fileTree.svelte.ts`). Unit tests
  for the `.git` path filter. Closes the FOR-DEV "External-change watcher" item.

### Added â€” unified center tabs (terminal | file | diff) + mixed splits
- The center area's `GroupTab` is now a discriminated union
  (`terminal | file | diff`, `terminals.svelte.ts`); files and diffs are real
  tabs in the same region tree instead of full-size singleton overlays, enabling
  any mix of agents/files/diffs across tabs and **mixed splits** (e.g. terminal
  left, editor right). Realizes the already-documented mixed-content tab design
  (`architecture/02b-terminal-engine.md` Â§3.1/Â§3.3).
- Per-tab editor/diff live state lives in an id-keyed registry
  (`FileEditorState` in `files.svelte.ts`, self-contained `DiffViewerState` in
  `git.svelte.ts`) kept out of the serialized tree, so CodeMirror/xterm never
  remount on split/reorder and typing doesn't churn the persisted layout. File
  tabs are restored on startup (by path); diff tabs are transient.
- `DiffPanel.svelte` removed (overlay) â†’ new `DiffPane.svelte`; `+page.svelte`
  no longer overlays the editor/diff; `Ctrl/Cmd+W` closes the active center tab.

### Added â€” unsaved-edit guard + external-change handling
- Closing a dirty file tab prompts **Save / Discard / Cancel**
  (`SaveDiscardDialog.svelte` + `confirm.svelte.ts` service); closing a region
  with several dirty files asks once. Every close path runs the guard and
  disposes per-tab state. Closes the FOR-DEV "Unsaved-edit guard" item.
- When an open file changes on disk while dirty, the editor offers **Reload /
  Keep my changes** (clean files reload silently; diffs reload). New EN/ES i18n
  keys.
- **Spec sync:** `architecture/02c-git-worktrees.md` Â§6 (file-tree watcher,
  editor-as-tab, unsaved-edit guard, external-change, `fs_set_watch`) and
  `architecture/02b-terminal-engine.md` Â§3.3 (editor/diff tabs implemented).

### Added â€” right-panel commit composer options + "History" tab with branch graph
- **Commit composer â€” optional fields (collapsed by default).** `ChangesPanel.svelte`
  now exposes an "Options" `Collapsible` under the summary box with: an **extended
  description** (commit body), one or more **`Co-authored-by:`** entries, an
  **amend last commit** toggle, and a **sign-off** (`Signed-off-by:`) toggle. The
  message is composed in the frontend (`git.svelte.ts â†’ buildCommitMessage`):
  `subject` + blank line + body + blank line + `Co-authored-by:` trailers;
  sign-off is applied by git itself (`-s`) so it uses the configured identity.
- **New "History" tab** (`HistoryPanel.svelte`, third tab in `RightPanel.svelte`).
  Shows the active worktree's commit log (newest first), virtualized
  (`VirtualList`) and paginated ("Load more"), with per-commit ref badges
  (`HEAD`/branches/`tag:`), author and localized relative time. Filterable;
  empty/`not a repo`/`no commits` states handled. Clicking a commit opens its
  full diff as a center **tab** (`CommitPane.svelte`, read-only `DiffView`),
  backed by a self-contained `CommitViewerState` registered in the terminals
  store â€” consistent with how file/diff tabs now open.
- **Integrated branch graph.** A toggle in the History header draws a colored
  lane gutter (branches, merges, splits) left of each commit, computed purely on
  the frontend from each commit's parents (`gitGraph.ts â†’ computeGraph`). The
  graph is shown only over the unfiltered log (a filter would break parent chains).
- **Backend (additive).** `git.rs`/`gitfast.rs`: new `CommitInfo`, `log(limit,
  skip)` (git2 revwalk + CLI fallback, topological order, unborn-HEAD tolerant)
  and `show(hash)` (first-parent diff; hex-validated). `commit()` gained `amend`
  and `sign_off` flags. New Tauri commands `git_log` / `git_show` and the extended
  `git_commit(amend, sign_off)`, registered in `lib.rs`. Unit tests cover
  `parse_log`/`parse_refs` and a real-repo `log`/`show`/pagination round-trip.
- **Spec + i18n updated.** `architecture/02c-git-worktrees.md` Â§3.5 (history/show
  commands) and Â§6 (the right panel is now three tabs + Â§6.4 History/graph). EN/ES
  strings added under `rightPanel.*` (composer) and a new `history.*` namespace.

### Changed â€” Tauri bundle id renamed `com.uxnan.desktop` â†’ `dev.luisgamas.uxnandesktop`
- **`src-tauri/tauri.conf.json` `identifier` rewritten.** The Tauri 2 runtime
  derives its app-data directory from the bundle identifier, so the on-disk
  paths used by `app.path().app_data_dir()` change everywhere:
  - Windows: `%APPDATA%/dev.luisgamas.uxnandesktop/`
    (was `%APPDATA%/com.uxnan.desktop/`)
  - macOS: `~/Library/Application Support/dev.luisgamas.uxnandesktop/`
    (was `~/Library/Application Support/com.uxnan.desktop/`)
  - Linux: `~/.local/share/dev.luisgamas.uxnandesktop/`
    (was `~/.local/share/com.uxnan.desktop/`)
- **Spec updated.** `uxnandesktop/architecture/03-implementation-guide.md`
  Â§"Directorio de Datos de la Aplicacion", `uxnandesktop/docs/build.md` bundle
  identity note, and `uxnandesktop/docs/agent-hooks.md` per-OS hook-installer
  paths all reflect the new id. The Rust code paths are unaffected
  (`app.path().app_data_dir()` is the only thing the app uses, and it follows
  the new identifier automatically).
- **Visible product name unchanged.** `tauri.conf.json` `productName` stays
  `Uxnan Desktop` and the window title stays `Uxnan Desktop`.
- **No user data migration is included.** A pre-existing `com.uxnan.desktop`
  data directory (state JSON + backups + installed Claude hook scripts) is
  not migrated; the next launch starts fresh under the new directory. The
  `FOR-DEV.md` row that mentioned `com.uxnan.desktop` was kept untouched as
  a historical snapshot.

### Changed â€” brand icon, theme variants & startup splash
- **Refreshed brand mark + new dark variant.** `static/logo.svg` (black
  mark on a white, rounded surface) and `static/logo_nb.svg` (black
  stroke, light surfaces) were updated, and `static/logo_wnb.svg` (white
  stroke, dark surfaces) added. `static/favicon.png` and the whole
  `src-tauri/icons/*` set were regenerated from `logo.svg` (rounded,
  transparent corners â€” the Windows/menu icon keeps the PNG alpha).
- **In-app marks swap by theme instead of inverting.** `TitleBar.svelte`
  and the empty-terminal placeholder in `TerminalArea.svelte` now render
  `logo_nb` on light themes and `logo_wnb` on dark themes (toggled by the
  `.dark` class) rather than applying a `dark:invert` filter to a single
  black mark.
- **Startup splash.** A brand splash is painted by `app.html` the instant
  the webview loads â€” before SvelteKit hydrates â€” so the previously blank
  startup window now shows the animated mark (70% â†’ 100% scale while
  untwisting a half-turn). It is theme-aware via `prefers-color-scheme`
  and dismissed on first paint by `+layout.svelte`
  (`window.__uxnanSplashDone`), with a 4 s fallback.

### Added â€” brand mark across every desktop surface
- **Brand assets**: `static/logo.svg` (with white bg, splash fallback) +
  `static/logo_nb.svg` (no bg, the brand mark used in-app and in the
  Tauri icon set); `static/favicon.png` regenerated from the SVG
  (256Ã—256). `src-tauri/icons/*` regenerated from the same source:
  `32x32 / 128x128 / 128x128@2x / Square* / StoreLogo / icon.png /
  icon.ico (16/24/32/48/64/128/256) / icon.icns (16/32/64/128/256/512)`.
- **Title bar brand mark** (`TitleBar.svelte`): the brand mark now
  sits to the left of the "Uxnan Desktop" label, inside the existing
  drag region (so it doesn't break window-dragging). Theme-aware via
  Tailwind's `dark:invert` filter â€” no second SVG variant. The ALPHA
  pill is unchanged.
- **Empty terminal state** (`TerminalArea.svelte`): when an active
  workspace has no terminals, the centered placeholder is now the
  brand mark (`size-24`, `dark:invert`) and the single "+ New
  terminal" button becomes **two actions**:
  - **New terminal** â€” always available (unchanged).
  - **New worktree here** â€” enabled when the active workspace is
    inside a registered repo's context (resolved from
    `terminals.activeWorkspace`); opens `NewWorktreeDialog` pre-pointed
    at that repo. In the Global workspace the button is disabled with
    a tooltip ("Pick a project or worktree in the left panel to enable
    this.").

### Added â€” agent state toasts + auto-installed hooks
- **Agent state toasts**: when an agent's hook reports a meaningful transition,
  a toast fires â€” **done** (success), **blocked** (warning), **waiting** (info),
  named by the agent. `working` is skipped (too noisy). Gated by the existing
  **Settings â†’ Agents â†’ Idle notifications** toggle. (`agentStatus.svelte.ts`.)
- **Auto-installed Claude Code hooks**: the ADE-managed `hooks` block is merged
  into `~/.claude/settings.json` on startup by default (idempotent; self-heals a
  moved script path), so precise states work out of the box. **Settings â†’ Agents
  â†’ Hooks** now has an **Install agent hooks** switch: turning it off removes the
  block and stops re-installing it next launch (`AppSettings.autoInstallHooks`,
  honored in `lib.rs` setup). Docs: `docs/agent-hooks.md`.

### Fixed â€” agent launch command re-typed after visiting Settings
- Opening Settings used to unmount the whole three-panel body, so returning
  remounted every terminal â€” re-running each agent tab's launch command (e.g.
  `opencode` typed again into the already-running agent) and blanking xterm.
  Settings now **overlays** the still-mounted body (`+page.svelte`), and the
  launch command is guarded to be sent **once per terminal id** (`Terminal.svelte`).

### Added â€” in-app toasts (svelte-sonner)
- A `<Toaster/>` (shadcn-svelte `sonner`, themed from the active app theme) mounted
  in `+page.svelte`, with a `$lib/toast.ts` wrapper (`toast`, `toastError`).
- The inline dismissible **error banners** (left sidebar `projects.error`, right
  panel `git.error`) are replaced by non-blocking error toasts, plus **success
  toasts** for commit / push / pull / worktree-removed / project-removed.
  Dialog-scoped inline errors (new-/remove-worktree, directory picker) stay inline.

### Changed â€” git2 fast path for status/diff
- **`gitfast.rs`** (git2 / vendored libgit2): `status_files`, `worktree_status`,
  `diff_file`, `diff_head` and `numstat` now run through libgit2 (off the async
  runtime via `spawn_blocking`), avoiding a `git` subprocess on every 3 s status
  poll and per diff. Each keeps a **CLI fallback** in `git.rs` (spec `02c` Â§3.1:
  git2 + CLI fallback); worktree management, branch listing, staging, commit,
  push/pull and patch-apply stay on the git CLI. 2 git2 integration tests.

### Changed â€” pointer cursor on interactive elements
- Buttons and other clickable controls (roles: button / menuitem / tab / option /
  switch / â€¦, links, `summary`, associated labels) now show the hand cursor;
  disabled controls show `not-allowed`. A global base rule in `app.css` (native
  buttons otherwise default to the arrow cursor).

### Added â€” separate terminal theme per light/dark app theme
- A **switch** in the Terminal themes section: off (default) keeps the single
  grid (Inherit + presets, click to select). On splits the presets into two
  subsections â€” **for the dark app theme** (top) and **for the light app theme**
  (bottom) â€” and you pick one terminal theme in each; it applies by the resolved
  app-theme base. (`AppSettings.terminalThemeMode` + `terminalThemeLightId` /
  `terminalThemeDarkId`; `resolveActiveTerminalTheme` chooses by base.)
- Terminal themes carry a **`base`** tag (light/dark, set in the editor; default
  dark) used only to group them into those subsections â€” additive, it doesn't
  change any existing behavior.

### Changed â€” appearance layout + global terminal fonts + settings hierarchy
- **Settings â†’ Appearance** is now one scrolling page (no tabs): an **Interface**
  heading then a **Terminal** heading, each starting with its **Fonts** section
  then its **Themes** grid.
- **Global terminal typography override** (`AppSettings.terminalFonts`,
  `mergeTerminalTypography`): font family/size/line-height/letter-spacing/weight/
  ligatures applied on top of every terminal theme (wins over each preset's font).
- **Visual hierarchy** via new design tokens (`text.heading`, `text.subheading`):
  every Settings pane now leads with a consistent larger/bolder section heading
  (Appearance, Language, Keyboard shortcuts, Agents, Hooks, Terminal) for coherence.

### Added â€” custom themes + terminal appearance (personalization)
- **Theming engine** (`src/lib/theme.ts`): a `Theme` is a single palette with a
  declared `base` (light/dark) covering every shadcn token, the corner radius,
  and the title/body/mono fonts. `applyTheme` writes the values as CSS variables
  on `<html>` (instant, no rebuild) and toggles `.dark` from the base. Built-ins:
  System, Light, Dark, Midnight, Latte.
- **Settings â†’ Appearance** (`ThemeSettings.svelte`), two sub-tabs (shadcn Tabs):
  - **Interface**: theme grid (applies live), **New theme** / **Edit** open an
    editable **draft** previewed live and **saved only on Save** (Cancel/closing
    discards); **Duplicate**, **Delete**, **import/export** as JSON via file
    (native dialog) or clipboard (partial imports fill from the base); and a
    **global font override** (title/body/mono) that wins over each theme's fonts.
  - **Terminal**: terminal themes are saved **presets** that override the app
    theme *in the terminal only* â€” Inherit + presets, draft Save/Cancel,
    import/export, and per-field **overrides** dots (with the inherited value as
    placeholder). Covers font family/size/line-height/letter-spacing/weight,
    **ligatures** (`@xterm/addon-ligatures`, DOM renderer), cursor style + blink,
    and the full color set (background, text, cursor, selection + 16 ANSI).
- **Themeable fonts**: `--ux-font-body` (UI), `--ux-font-title` (titles, via the
  `font-title` design token) and `--ux-font-mono` (editor + diffs) routed through
  Tailwind's font utilities. Fonts are referenced by installed family name
  (importing font *files* is a tracked follow-up â€” `FOR-DEV.md`).
- **Editors** (`ThemeEditor.svelte`, `TerminalThemeEditor.svelte`) built from
  shadcn-svelte components (Input, Textarea, Switch, Label, Select, Tabs, Dialog).
- **Model**: `AppSettings.activeThemeId` + `customThemes` + `fonts` +
  `terminalThemes` + `activeTerminalThemeId` (frontend-owned shapes, persisted
  opaquely in Rust like `terminalLayout`).
- **Docs**: `docs/theming.md` (app + terminal theme JSON templates).

### Changed â€” agent-hooks docs enriched
- **`docs/agent-hooks.md` rewritten as a guided installer.** Now opens with a
  TL;DR, a state-table ("what do I get"), the ready-made scripts and the
  env-injection contract, then step-by-step install for **Claude Code** (one
  click) and **any other agent** via the generic wrapper, with a
  per-platform breakdown:
  - **Windows â€” PowerShell** (`uxnan-hook-wrapper.ps1`): the
    `-Type / -Command / -Args` argument shape and the quoting caveats.
  - **Windows â€” cmd / batch** (`uxnan-hook-wrapper.cmd`): when to fall back
    from PowerShell and the `%2`â€“`%9` arg-list limit.
  - **macOS / Linux â€” Bash** (`uxnan-hook-wrapper.sh`): exact app-data
    paths for both platforms.
  - **WSL** and **Git Bash on Windows**: which wrapper applies in each
    shell context.
  - **Verify** checklist for all platforms + a **Troubleshooting** section
    covering stale tokens, dimmed (`stale`) reports, "401" from the
    wrapper, and "dot never changes from `working`".
- Adds **app-data path table** per OS (Windows / macOS / Linux) and a
  **reference** section with the full request contract + env vars moved
  here for one-stop lookup.

### Added â€” precise agent states in the terminal tab bar + hooks-discovery hint
- **Tab bar now uses the precise `AgentStatusDot`** (`TerminalArea.svelte`):
  every terminal tab in a region shows the four-state dot (working green /
  blocked amber / waiting orange / done blue / idle gray; stale dimmed) driven
  by `resolveAgentDisplay`, with the same priority as the sidebar
  (hook â€º title â€º output-activity). The coarse pulsing dot from
  `tab.working` is gone â€” a plain terminal with no agent and no activity now
  shows no dot at all.
- **Install-hooks hint** on agent tabs that aren't being driven by the hook
  server: a subtle `Webhook` icon button next to the status dot, only when
  `display.source !== "hook"` and the tab is an *agent* terminal (so plain
  shells and already-hook-driven agents don't see it). Clicking opens
  **Settings â†’ Hooks** so users discover the ready-made per-agent hook
  configs and can wire them up. EN/ES (`monitor.installHooksHint`).

### Added â€” configurable keyboard shortcuts
- **Settings â†’ Keyboard shortcuts**: rebind the app's shortcuts (click a chord to
  record a new one, reset to default, or disable). Persisted in
  `AppSettings.keybindings` (Rust + `types.ts`). Actions: close file/diff
  (`Ctrl/Cmd+W`), save file (`Ctrl/Cmd+S`), quick-switch worktree (`Ctrl/Cmd+P`),
  open settings (`Ctrl/Cmd+,`), toggle left / right sidebar (`Ctrl/Cmd+B` / `J`).
- **`keybindings.ts`**: platform-agnostic chords (`Mod` = Ctrl/âŒ˜), an eventâ†’chord
  matcher, and a CodeMirror-key converter (for the editor's save key). The global
  handler in `+page.svelte` routes shortcuts (skipping terminal focus + the
  settings view); `Ctrl/Cmd+W` only closes the center overlay when one is open.

### Changed â€” right-panel + settings polish (review feedback)
- **Tabs** now carry icons (file tree / git compare), sized from the design tokens.
- **Changes tab header reworked**: dropped the "Changes Â· worktree" label for a
  **changed-file count**, plus a **search/filter** and refresh. **Stage all** /
  **Unstage all** stay in their section headers as secondary (outline) buttons.
  Each file row now shows its **`+added âˆ’deleted`** line counts (`git_numstat` â†’
  `git diff --numstat HEAD`, live with the status watcher).
- **File-tree "expand all"** now loads + expands the tree level by level (capped
  at 1500 folders so it can't freeze on a giant tree).
- **File-tree tab**: dropped the redundant "Files" label (worktree name only) and
  added a toolbar â€” **search/filter**, **collapse all**, **expand all**, **reveal
  in the OS file manager** (`reveal_path` command, via the opener plugin), and
  refresh. The active worktree (left panel) and the open file/diff now use a
  clearer selected style (primary tint + ring).
- **Changes tab**: removed the "view diff" eye button â€” **clicking a file row**
  opens its diff (matching the file tree); the stage/unstage/discard actions stay
  on hover.
- **Settings (full-screen)**: section content is centered in a column (text stays
  left-aligned), **Hooks moved to its own nav item** (fixes the agents-pane scroll
  and declutters it), and a **Keyboard shortcuts** item was added.

### Added â€” right-panel file tree + center file editor
- **Tabbed right panel** (`RightPanel.svelte`, shadcn-svelte Tabs): the existing
  version-control view is now the **Changes** tab (`ChangesPanel.svelte`,
  extracted verbatim), and a new **Files** tab is first, left-to-right. The
  active worktree's git status is loaded by the always-mounted parent so the
  Files tab is colored even while the Changes tab is unmounted.
- **File-tree tab** (`FileTreePanel.svelte` + `fileTree.svelte.ts` store): the
  whole working tree of the selected project/worktree, **lazily expanded one
  folder at a time** (`node_modules`/`target` never load until opened); folders
  first then files, `.git` hidden. Files with a git-tracked change are colored
  (untracked green / deleted red / modified amber) and the **parent folders that
  contain changes** are colored too, reusing the right-panel git status. Tree
  expansion survives tab switches; clicking a file opens it in the center editor.
- **File editor** (`FileEditor.svelte`, overlays the center panel like the diff
  viewer): editable **CodeMirror 6** with **syntax highlighting** per file
  extension (`editorLang.ts`: JS/TS/JSON/CSS/HTML/Markdown/Rust/Python/YAML/XML/
  C++/Java/PHP/SQL/Go), line numbers and undo/redo. A **git change gutter** shows
  added lines (vs `HEAD`) with a light highlight and a small left-edge marker
  that **peeks only the removed lines** on demand â€” never the full diff. **Save**
  with the button or **Ctrl/Cmd+S** writes the file and refreshes the gutter +
  git status. Binary / too-large (> 2 MiB) files show a notice instead of loading.
- **Backend** (`src-tauri/src/fs.rs` + `git::diff_head`): new commands
  `fs_list_dir`, `fs_read_file` (binary / too-large guards), `fs_write_file`
  (atomic temp-write + rename), and `git_diff_head` (working-tree-vs-`HEAD` diff
  for the editor gutter). 3 new unit tests cover the listing order / `.git`
  hiding, the binary / too-large flags, and the atomic overwrite.
- **i18n**: EN/ES strings for the tabs, the file tree, and the editor.
- **Dependencies**: `@codemirror/language`, `@codemirror/commands`,
  `@lezer/highlight`, and the per-language `@codemirror/lang-*` packages for
  syntax highlighting; the `tabs` shadcn-svelte component.
- **Spec**: `architecture/02c-git-worktrees.md` Â§6 (file-tree tab + editor + the
  new filesystem Tauri commands).

### Added â€” ready-made per-agent hook configs (Phase 4 follow-up)
- **Bundled hook scripts** (`static/hooks/`, embedded in the binary at compile
  time and written to `<app-data>/hooks/` on every startup, idempotent):
  - `uxnan-claude-hook.cjs` â€” Node CJS, no deps, cross-platform. Maps Claude
    Code's `UserPromptSubmit` / `PreToolUse` / `PreCompact` / `Notification`
    / `PermissionRequest` / `Stop` / `SessionEnd` events to the ADE's
    `working` / `waiting` / `done` / `blocked` states, POSTing each to
    `UXNAN_HOOK_URL` with `X-Uxnan-Token` + `UXNAN_AGENT_ID`.
  - `uxnan-hook-wrapper.sh` / `.ps1` / `.cmd` â€” generic wrapper for any CLI
    agent. Posts `working` before exec and `done` on exit (with
    `interrupted: true` if the agent crashed). Bash for Unix + Git Bash +
    WSL, PowerShell for Windows, cmd / batch as the no-PowerShell fallback.
- **Settings â†’ Agents â†’ Hooks** (`AgentHooksPanel.svelte`): a one-click
  **Install** for Claude Code that merges an ADE-managed `hooks` block into
  `~/.claude/settings.json` (preserves every other key, marks the block with
  `__uxnan_managed_hooks__: true` so Uninstall only touches ours), plus
  the platform wrappers and their absolute paths so users can wire any
  other agent as the launch command. Honest "Installed" / "Not installed" /
  "Unavailable" badge, "Show JSON config" disclosure with copy-to-clipboard,
  and EN/ES translations.
- **Backend** (`src-tauri/src/agent_hooks.rs`): idempotent install of the
  four scripts to `<app-data>/hooks/`, atomic read/modify/write of
  `~/.claude/settings.json` (sibling-temp + rename), and the
  `__uxnan_managed_hooks__` marker that scopes Install / Uninstall to the
  ADE's own block (user-installed `hooks` survive). New commands:
  `get_hook_install`, `get_claude_hooks_status`, `install_claude_hooks`,
  `uninstall_claude_hooks`, `get_hook_scripts`. 6 new unit tests cover the
  marker detection, the `{{HOOK_SCRIPT}}` substitution, the install
  idempotency, and the camelCase serialization of the Tauri surface.

### Added â€” keep-awake on macOS/Linux + untested-platform notice
- **Keep-awake now covers all three platforms** (`power.rs`): Windows
  (`SetThreadExecutionState`), macOS (`caffeinate -i`), Linux (`systemd-inhibit`),
  each held by the keep-awake worker and released on exit. **macOS/Linux are
  implemented but UNTESTED** (developed on Windows).
- **Untested-platform notice**: when running on macOS/Linux, the status bar shows
  an amber "Untested on <os>" badge (`platform.ts`), and the prevent-sleep setting
  notes the same. The app is only validated on Windows so far (alpha).

### Added â€” Phase 5 (UI batch B): palette, split buttons, virtual lists, sleep toggle
- **Quick worktree switcher** (`WorktreeSearch`): a command-palette opened with
  **Ctrl/Cmd+P** or the sidebar âš¡ button â€” type to filter every worktree across
  projects (branch / path / project), â†‘/â†“ to move, Enter to jump (activates it).
- **TabGroup split buttons**: each terminal region's tab bar now has visible
  split-right (columns) and split-down (rows) buttons, not just the right-click
  menu.
- **Virtualized lists** (`VirtualList`, `@tanstack/svelte-virtual`): the worktree
  palette and the right-panel changed-files list render only visible rows, so a
  huge changeset (e.g. an agent that touched hundreds of files) stays smooth.
  The right panel is now a single virtualized scroll (Staged + Changes sections
  with headers). The diff is already virtualized via CodeMirror; the hierarchical
  project tree is intentionally left non-virtualized (FOR-DEV).
- **Prevent-sleep toggle** (Settings â†’ Agents): exposes `AppSettings.preventSleep`
  (the keep-awake feature added earlier); default off.

### Added â€” Phase 5: full-size diff panel + side-by-side + hunk staging (UI)
- **Diff opens full-size in the center panel** (`DiffPanel`), overlaying the
  terminals (which stay mounted underneath â€” no PTY/xterm torn down). Replaces
  the cramped, fixed-size modal. Header shows the file + Staged/Working badge +
  close; closing returns to the terminals.
- **Right-panel file list**: rows are no longer click-anywhere â€” only the
  buttons act. Each file has an **eye** button to open its diff, a **revert**
  (â†º) button to discard (clearer than a trash can), and stage/unstage (+/âˆ’). The
  changed file's **name is colored** by status (modified/added/deleted/renamed)
  and the open file's row is highlighted.
- **Unified + side-by-side toggle** (`DiffView`): unified is one column;
  side-by-side is two synced CodeMirror views (old left / new right). Both stay
  mounted; CodeMirror is remeasured on reveal/resize so neither renders blank.
- **Per-hunk staging**: a bar above the diff lists each hunk (`#1, #2â€¦`,
  click to scroll to it) with stage / unstage / discard actions, built on the
  `git_apply` backend below. Kept outside the CodeMirror render so it can't
  blank the editor.

### Added â€” Phase 5: hunk-level staging (backend)
- **`git_apply` command** (`git::apply_patch`): applies a unified-diff patch fed
  on stdin, with `cached` (index) and `reverse` flags â€” the backend half of
  hunk-level staging (stage / unstage / discard a single hunk).

### Added â€” Phase 5: keep system awake while an agent works (opt-in)
- **Prevent sleep** (`power.rs`, `AppSettings.preventSleep`, default off): while
  enabled and an agent is working, the ADE asks the OS not to sleep, and releases
  it when no agent is working. A long-lived worker thread owns the request
  (Windows `SetThreadExecutionState` is thread-affine) and **auto-releases after
  2 h** as a safety cap. Windows implemented; macOS/Linux are a no-op for now
  (FOR-DEV). Command `set_prevent_sleep`; the frontend drives it from
  `preventSleep && anyAgentWorking()`. The Settings toggle ships with the UI batch.

### Added â€” Phase 5: rotating backups + schema-migration hardening
- **5 rotating backups** (`persistence.rs`): before each atomic write, the live
  `state.json` is rotated into a numbered ring (`state.bak.1` â€¦ `state.bak.5`,
  oldest dropped), so a bad write or migration can be recovered. Rotation is
  best-effort â€” a backup error never blocks the save. Closes a Phase 0 follow-up.
- **Sequential schema migrations**: `migrate` now applies one `v â†’ v+1` step at a
  time up to `SCHEMA_VERSION` (each future bump is an independent, testable
  transform) and rejects a future version. A missing `version` is still treated
  as current. (Debounced async writes remain a follow-up; the frontend already
  debounces the high-frequency layout writes.)

### Added â€” Phase 4 (Layer 1): local agent hook server + precise states
- **HTTP hook server (`axum`).** The backend binds a small server to an
  ephemeral `127.0.0.1` port at startup (`hooks.rs`). An agent's hook `POST`s a
  JSON state report to `/hook` â€” `{ agentId, status, agentType?, prompt?, tool?,
  interrupted? }`, `status âˆˆ working|blocked|waiting|done` â€” and the ADE
  normalizes it, caches it, and broadcasts `agent:status-changed` to the
  frontend. Unlike the coarse output-activity inference, this distinguishes the
  four precise states. Requests must present the per-launch token in the
  `X-Uxnan-Token` header (rejects stray local processes).
- **Env injection.** Every terminal is spawned with `UXNAN_HOOK_URL`,
  `UXNAN_HOOK_TOKEN` and `UXNAN_AGENT_ID` (the PTY id), inherited by any agent
  run inside it, so a hook knows where to report and which terminal it is
  (`PtySpec.env`, applied in `pty_create`).
- **Persistent cache (TTL 7 d / stale 30 min, spec Â§1.5).** Reports upsert into
  `AppData.agent_cache` (now keyed by `agentId`, carrying status/type/prompt/
  tool/interrupted + first-seen/last-update), persisted atomically and
  TTL-pruned on load (`prune_agent_cache`). New commands `get_hook_info` and
  `agent_states`; the frontend hydrates from the cache and stays live via the
  event (`agentStatus` store; `isStale` after 30 min).
- Wiring a specific agent to call the hook is per-agent configuration â€” see
  [`docs/agent-hooks.md`](docs/agent-hooks.md). Consuming the precise state in
  the sidebar/tab indicators lands in a follow-up increment.

### Added â€” Phase 4 (Layer 2): terminal-title state inference
- **OSC title â†’ state (fallback).** Agents that update the terminal title
  (OSC 0/2, surfaced by xterm's `onTitleChange`) get their state inferred from
  it â€” "thinkingâ€¦/runningâ€¦" â†’ working, "waiting/approval/review" â†’ waiting,
  "error/failed" â†’ blocked, "done/finished/âœ“" â†’ done (`agentTitle.ts`,
  `agentMonitor.noteTitle`). Unknown titles (a plain cwd or `user@host`) are
  ignored. Needs no hook setup; complements Layer 1 for agents that don't report.
- **Unified status resolver** (`agentDisplay.ts`, `resolveAgentDisplay`): merges
  the layers with a clear priority â€” hook (precise) â€º title â€º output-activity â€”
  so the sidebar/tab indicators have one effective state to render.

### Added â€” Phase 4: precise status dots + unread/done badges
- **Colored status dots** (`AgentStatusDot.svelte`) on each agent sidebar row,
  driven by `resolveAgentDisplay`: working = green (pulsing), blocked = amber,
  waiting = orange (pulsing), done = blue, idle = gray; a stale report
  (no update >30 min) is dimmed, with the state + "stale" in the tooltip.
  Replaces the single green working spinner with the four precise states.
- **Unread / done badge** (`unread` store, spec Â§2): when an agent finishes
  (`done`, or settles idle while you're not looking at it), its worktree is
  flagged â€” a red dot on the worktree row and on the project header (so a
  collapsed project still surfaces a child worktree's result). The flag clears
  when you open that worktree or refocus the window; the dock/taskbar shows the
  count via `setBadgeCount` (best-effort per OS). The hook server owns this when
  it's driving a tab, so the coarse inference doesn't double-fire.

### Added â€” Phase 4: custom agent logos
- **Custom logo per agent** (Settings â†’ Agents): the logo is now a button â€”
  pick any image and it's stored inline as a 64Ã—64 PNG `data:` URL on
  `AgentProfile.icon` (`logo.ts`), so it persists with no filesystem path to
  resolve; a small âœ• resets to the catalog logo. Custom logos render everywhere
  catalog logos do (`agentLogoSrc` now passes `data:`/`http`/absolute through).

### Changed â€” agents: per-worktree agent override
- **Choose the agent when creating a worktree** (New worktree dialog): a "Launch
  agent" picker (None + your configured agents, with logos) preselects the global
  default and overrides what launches into that worktree
  (`projects.createWorktree` gains an `agentId`: a specific id, `null` for none,
  or omit for the global default).

### Changed â€” agents: detect in any terminal + close-on-exit
- **Process detection (any terminal).** A background scan (every 2 s, `procscan`
  + `sysinfo`) walks each terminal's process tree and reports the agent running
  in it â€” matching the catalog + your configured agents by exe name or
  command-line token (incl. `cmd-cli` package folders like `gemini-cli`), so it
  covers real exes (`claude.exe`) *and* node-shim CLIs (`codex`/`gemini`/â€¦). A
  terminal that starts an agent â€” even one you typed by hand â€” gets its agent
  sidebar row + tab name; when the agent exits, the row disappears and the tab
  reverts to the shell name. The tab title follows the current agent
  (`agentName ?? base title`), so re-running a different agent renames it. The
  frontend syncs the commands to look for via `set_agent_commands`.
- **Accurate terminal close.** Shell exit is now detected by waiting on the
  shell process (`try_wait`) instead of the PTY's read-EOF, which on Windows
  ConPTY was unreliable â€” it could fire during a full-screen agent's teardown
  (closing the tab when the shell was still alive) or *not* fire when the shell
  exited (leaving an unwritable pane). Now running `exit` closes the tab
  completely, while an agent quitting just drops you back to the shell. Added a
  close shortcut: **Cmd+W** (mac) / **Ctrl+Shift+W** (plain Ctrl+W stays the
  shell's delete-word).

### Changed â€” sidebar: per-agent rows + collapsible agent spaces
- **Cards declutter into agent rows.** The generic activity dot and the
  open-terminal count are gone from project/worktree card headers (only the git
  diff badge stays). Each project and worktree now shows a **collapsible list of
  its agent terminals** (`AgentSpace`): one clickable row per *agent* terminal
  (plain terminals get no row), with the agent's logo, a spinner while it's
  working, and click-to-jump to that terminal. Collapsed, it shows a count + a
  working spinner.
- **Space-aware notifications.** An agent-idle notification now fires when you're
  not looking at that terminal (a different workspace/tab is showing, or the
  window is unfocused) â€” not just on window blur. New **Settings â†’ Agents â†’ Idle
  notifications** toggle (`AppSettings.agentNotifications`, default on).
- Agent terminals are tagged at launch (`tab.agentName` + `tab.agentIcon`) so the
  rows and monitoring know which terminals are agents.

### Added â€” Phase 4 (increment 1): agent activity monitoring
- **Activity inference** (universal, no agent setup): a terminal producing output
  is "working", quiet for 3 s is idle, exited is done. A pulsing dot shows on the
  worktree row/card and the terminal tab while it's working (`agentMonitor` +
  `tab.working`).
- **Native notification** (`tauri-plugin-notification`) when an *agent* terminal
  settles idle (â‰¥ 12 s) while the app is **unfocused** â€” i.e. an agent likely
  finished/paused while you were away. One per idle period, re-armed on new
  output; permission is requested lazily on first use.
- Precise per-state monitoring (working/blocked/waiting/done) is deferred to a
  hook-based approach â€” see FOR-DEV.

### Fixed â€” terminal: fewer resize jumps + multi-line key
- **No redundant PTY resizes.** `fitToPane` resizes the PTY only when cols/rows
  actually change, and the `ResizeObserver` is debounced â€” so a spurious SIGWINCH
  no longer makes a full-screen agent TUI repaint and the viewport jump (e.g.
  while dragging a split divider). Scrolling *inside* a live full-screen agent is
  still disabled by the agent's alternate screen buffer (standard, like vim/htop).
- **Shift+Enter / Alt+Enter insert a newline** (xterm otherwise collapses them to
  a plain Enter) for multi-line agent prompts. `Ctrl+â†�/â†’` word-nav already passes
  through to the shell/agent.

### Added â€” terminal shell detection + working default profiles
- **Seeded profiles** on a fresh install are now the platform's guaranteed shells
  (Windows: **Windows PowerShell** with `-ExecutionPolicy Bypass` + **Command
  Prompt**; Unix: login shell + bash) instead of one empty placeholder. An
  untouched empty-starter install is upgraded to this seed on load.
- **PowerShell launches with `-ExecutionPolicy Bypass`** (process-scoped) so
  npm-installed agent shims (`.ps1`) run under Windows' default Restricted policy
  â€” fixes agents that wouldn't start in Windows PowerShell.
- **Shell detection in Settings â†’ Terminal**: the Add-profile template picker
  greys out shells that aren't installed and offers **"Add detected shells"** to
  seed every installed one in one click (PowerShell 7, Git Bash, WSL surface only
  when present). Reuses the command-detection backend.

### Fixed â€” worktrees, status sync & error banners
- **Robust worktree removal.** The worktree's terminals/agents are now killed
  *before* removal â€” on Windows a shell whose CWD was inside the worktree held
  the folder open and blocked deletion, leaving half-removed worktrees ("not a
  working tree" / "not a git repository", empty leftover folders, and a sibling
  vanishing when prune then swept it up). Backend removal is best-effort now:
  graceful â†’ forced â†’ prune â†’ delete any leftover directory (with retry), and it
  tolerates an already-broken worktree instead of erroring.
- **Canonical worktree paths** (forward slashes, matching `git worktree list`).
  A freshly-created worktree's per-worktree terminal-workspace key now lines up
  with its sidebar row â€” fixing the auto-launched **default agent** opening in an
  invisible workspace (it looked like it didn't launch).
- **Live project-card status.** The git review panel pushes the worktree's
  dirty/ahead/behind to the project card, so the badge clears right after a
  commit â€” no manual "Refresh worktrees & status".
- **Dismissible error banners** (left sidebar + right panel) with an Ã—, so a git
  error no longer sticks until the next refresh.

### Added â€” auto-launch a default agent on worktree create
- **Default agent** setting (Settings â†’ Agents â†’ "Default agent", `None` by
  default): when set, creating a worktree auto-launches that agent in the new
  worktree's terminal workspace. Opt-in â€” `None` never starts an agent unasked.
  New `AppSettings.defaultAgentId`; `projects.createWorktree` calls
  `app.launchAgent` after the worktree is created and selected.

### Changed â€” Phase 3 closed: diff viewer on CodeMirror 6
- **Diff viewer rebuilt on CodeMirror 6** (`@codemirror/state` + `@codemirror/
  view`): read-only, **virtual-scrolls large diffs**, supports text selection,
  and colorizes add/remove/hunk lines via line decorations (replacing the
  hand-rolled renderer). Diff fetches now abort after **30 s** so the UI can't
  hang on a pathological diff.
- This closes Phase 3 (status + diffs + live watcher + push/pull + diff viewer).
  Side-by-side view, hunk/line staging and virtual-scroll polish move to Phase 5;
  the `git2` migration and AI commit messages remain tracked in FOR-DEV.

### Added â€” Phase 3 (increment 2): live status + push / pull
- **Real-time status.** A background watcher (Tokio interval, 3 s) polls the
  worktree the right panel is reviewing and emits `git:status-changed` only when
  it changes; the panel updates live as an agent edits files. The watcher
  **pauses while the window is unfocused** (Tauri `WindowEvent::Focused`). The
  frontend sets the watched worktree via `git_set_watch` and applies events for
  the worktree it's showing (skipping mid-action to avoid flicker).
- **Push / pull.** `git_push` and `git_pull --ff-only` with an ahead/behind bar
  in the commit composer (counts + Pull/Push buttons, enabled per ahead/behind).
  Push is never retried; pull is fast-forward-only so it can't start a surprise
  merge.

### Added â€” Phase 3 (first increment): git status & diffs in the right panel
- **Right-panel review** (`RightPanel`): the active worktree's changed files split
  into **Staged** and **Changes** (untracked included), each row showing its
  status code; click a file to see its diff.
- **Diff viewer** (`DiffView`): a colorized unified diff in a dialog (added/removed/
  hunk lines). CodeMirror 6 is a follow-up.
- **Staging & commit**: per-file stage / unstage / discard (discard confirms
  first), stage-all / unstage-all, and a commit composer (message + Commit).
- **Backend** (git CLI, `git.rs`): `git_status` (porcelain v1 `-z`, rename-aware),
  `git_diff` (tracked + untracked via `--no-index`), `git_stage`/`git_unstage`/
  `git_stage_all`/`git_unstage_all`/`git_discard`/`git_commit`. New `FileChange`
  type (`types.ts`), `api.ts` wrappers, and a `git` store keyed by the active
  worktree (reloads on switch / after each action / manual refresh).
- Deferred (FOR-DEV): real-time 3 s status polling + Tauri events, CodeMirror,
  hunk/line-level staging, AI commit message, image diffs, push/pull/sync, the
  `git2` migration.

### Changed â€” agents: shell-aware launch, install detection, brand logos
- **Agents now launch inside a shell.** Instead of spawning the bare command â€”
  which only worked for real `.exe` agents (`claude`, `agy`) and failed for npm
  `.ps1`/`.cmd` shims (`codex`, `gemini`, `opencode`, `pi`) â€” the ADE opens the
  agent's terminal profile and types the command into it, so PATH/PATHEXT shims
  resolve. Fixes agents not starting under Windows PowerShell.
- **Per-agent terminal.** Each agent picks which terminal profile (shell) to
  launch in â€” any built-in or user-added profile â€” defaulting to the default
  terminal profile. New `AgentProfile.terminalProfileId`. The command is typed
  into the freshly-started shell (transient, never persisted/re-run on restore).
- **Install detection + catalog.** Settings â†’ Agents shows a catalog of known
  agents (Claude Code, Codex, Gemini CLI, OpenCode, Pi, Antigravity, Goose,
  Grok, Kilo Code, Kimi, Qwen Code); the backend (`agents_detect`, PATH+PATHEXT)
  reports which are installed and only those are addable â€” one-click, or "Add all
  installed". Replaces the old static template list. "Add custom agent" remains.
- **Brand logos** (`static/agents/*.svg`, `AgentLogo`) in the catalog, the agent
  editor and the launch menu. New `AgentProfile.icon` stores the logo key; logos
  also resolve by command (`agentLogoKey`), so agents added before icons existed
  still show their brand mark.

### Fixed
- **Project sort menu**: relabel the default ordering "Default" (was the awkward
  "Added order"), and widen the menu (`min-w-44`) to match the other dropdowns.

### Added â€” agents track (registry + launch)
- **Agents registry** in **Settings â†’ Agents**: register CLI coding agents
  (name + command + args) from built-in templates (Claude Code, Codex, Gemini,
  Aider, opencode) or a blank entry. Persisted in `AppSettings.agentProfiles`
  (Rust `AgentProfile` + `types.ts`), round-tripped through `update_settings`
  with a `#[serde(default)]` so older state still loads.
- **Launch an agent into a worktree**: a Bot menu on every project header and
  worktree row (`LaunchAgentMenu`) lists the configured agents and runs the
  chosen one in a terminal inside that worktree's checkout (its workspace), or
  deep-links to **Settings â†’ Agents** when none are configured yet.
- Settings panes are now deep-linkable (`app.openSettings(section)`).
- Fully internationalized (EN/ES) and built on the design tokens.
- Out of scope here (Phase 4): agent **status** monitoring, hooks server,
  notifications, and auto-launch on worktree create.

### Changed â€” full i18n coverage + icon-only panel toggles
- **i18n now covers the whole UI**: the right "Changes" panel, the status bar
  (backend state + repository count), the terminal-profile editor, the Settings
  terminal section, the "exited" tab badge, the "Alpha" tooltip, and the shadcn
  dialog close labels are translated. From here on every new string goes through
  `i18n.t`.
- **Panel toggles use Lucide icons** (`PanelLeft` / `PanelRight`) instead of the
  hardcoded `â˜°` / `â‡†` glyphs, matching the other toolbar buttons.

### Added â€” internationalization (i18n)
- **Multilingual UI** (English default + Spanish): a dependency-free i18n layer
  (`src/lib/i18n/`) with one dictionary file per locale (`en.ts` is the
  source-of-truth `MessageKey` type; other locales are
  `Record<MessageKey, string>`, so a missing key fails to compile). `i18n.t(key,
  params)` interpolates `{placeholders}` and is reactive to the language setting;
  `i18n.plural(n, â€¦)` handles counts.
- **Language follows the device** (`navigator.language`) by default and can be
  set manually in **Settings â†’ Language** (System / English / EspaÃ±ol). Persisted
  in `AppSettings.language` (backend `model.rs` + `types.ts`).
- Translated the main surfaces: left panel (sidebar/project/worktree cards +
  menus + dialogs), terminal area (top bar, breadcrumb, context menu, empty
  state), the new-worktree and directory-picker dialogs, the title bar and
  Settings. Adding a language is one file + one line â€” see `docs/i18n.md`.

### Added â€” design tokens (sizing & emphasis)
- **Reusable sizing/emphasis scale** in `src/lib/design.ts` (icon sizes, ghost
  icon-button footprint, text roles) documented in `docs/design-tokens.md`.
  Informational text/icons are intentionally smaller and muted; control icons
  and titles get their own role. Applied across the left panel
  (`LeftSidebar`, `ProjectCard`, `WorktreeRow`), the terminal top bar
  (`TerminalArea`) and the directory picker to fix the uneven density (oversized
  header/card icons, too-large floating-menu text, over-bold informational text).

### Changed â€” left panel redesign: projects with nested worktrees
- **Single hierarchical Projects tree** (`LeftSidebar.svelte`, `ProjectCard.svelte`,
  new `WorktreeRow.svelte`; `WorktreeCard.svelte` removed) replaces the two flat
  Projects/Worktrees lists that were confusing (duplicate "main"s, unclear
  parent/child). Each **project header is its own "main" context** (selectable)
  and **expands to show its non-main worktrees as nested sub-rows**. Selecting a
  project or worktree makes it the active terminal context (its terminals show);
  the row is highlighted. Search filters projects and their worktrees and
  auto-expands matches.
- **Per-row status + "running terminals" indicators**: each project/worktree
  shows its dirty/ahead/behind badges and, when it has live terminals, a
  terminal-count indicator â€” so you always see where your shells are.
- **Terminal context is read-only in the top bar** (`TerminalArea.svelte`): the
  confusing workspace-selector dropdown is replaced by a `repo / branch`
  breadcrumb; the **left panel is the single place to switch context**. Creating
  a worktree selects it.

### Added â€” Phase 2: per-worktree terminal workspaces (completes Phase 2)
- **Terminals are now grouped into workspaces** (`terminals.svelte.ts`): one per
  worktree (keyed by its path) plus a **Global** space (`""`) for unassigned
  terminals. Selecting a worktree shows its terminal set and hides the others,
  while every workspace (and every region/tab) stays mounted so background
  worktrees keep streaming and their PTYs keep running. The store gained a
  workspace layer (proxying the existing region/split logic to the active
  workspace via getters), `setWorkspace`/`dropWorkspace`, all-workspace
  serialize/restore, and cross-workspace `markExited`.
- **Workspace switcher** in the terminal top strip (`TerminalArea.svelte`): a
  dropdown listing Global + each worktree that has terminals, showing the active
  one. Clicking a worktree card (`projects.setActiveWorktree`) or its "open
  terminal" / a project's "open terminal" switches to that workspace; removing a
  worktree drops its workspace (killing its PTYs).
- **Persistence** now stores every workspace's layout + the active key
  (`SavedTerminalLayout`); restored on startup.

### Changed â€” directory picker: manual path entry
- The in-app directory picker's current-path display is now an editable input:
  type or paste any path and press Enter to jump there (git repos in the listing
  are still flagged). Complements click-to-navigate.

### Added â€” Phase 2: in-app directory picker
- **In-app project picker** (`DirectoryPicker.svelte`) replaces the OS-native
  folder dialog: a shadcn `Dialog` that browses sub-folders (up/down), flags git
  repositories, and adds the current or any listed repo. Backed by a new
  `browse_dirs` command + `browse` module (lists dirs, marks `.git`, hidden
  folders excluded, sorted; +1 test, 25 passing). The projects store gains
  `addProjectPath`; the unused `pickDirectory`/`@tauri-apps/plugin-dialog`
  frontend wrapper is removed.

### Added â€” Phase 2: worktree status badges
- **Status badges on worktree cards** (`WorktreeCard.svelte`): each worktree
  shows its uncommitted-change count and ahead/behind-upstream counts. Backed by
  a new `worktree_status` command + `git::worktree_status` (parses
  `git status --porcelain=v1 --branch`); the projects store keeps a
  `statusByPath` map refreshed on load and after create/remove. +2 tests
  (`parse_status_porcelain`), 24 passing.

### Added â€” Settings screen & terminal profiles
- **Settings screen** (`Settings.svelte`, opened from a gear in the title bar):
  a dialog with a section nav â€” **General** (theme: System/Light/Dark, applied
  live and persisted) and **Terminal**. New `app.settingsOpen` state.
- **Configurable terminal profiles** (`TerminalProfile { command, args }` in
  `AppSettings`): each new terminal is spawned from a profile, so PowerShell,
  Command Prompt and WSL (Windows) â€” or any shell â€” are first-class. The backend
  seeds a single **empty starter profile** (placeholders teach configuration) and
  replaces an untouched legacy auto-seed; a blank command falls back to the
  platform default shell. `pty_create` now accepts `args` (`PtySpec.args`).
- **OS-grouped profile templates** (`terminalTemplates.ts`): Settings â†’ Terminal
  â†’ **"Add profile â–¾"** offers presets grouped by Windows / macOS / Linux (plus a
  blank profile); a per-profile editor (name, command, args) and a default-profile
  picker.
- **Profile-aware new terminals**: the title-strip **+ Terminal** opens the
  default profile and its â–¾ caret picks any profile; region "+", splits, the
  context menu and project/worktree "open terminal" all use the default profile.
  The chosen shell/args **persist in the saved layout**.

### Changed
- **Terminal follows the app theme**: xterm colors and the terminal-area
  background switch with light/dark (`app.terminalPalette()`) and re-theme live â€”
  fixing unreadable text on a forced-dark surface in light mode.
- **Terminal content padding**: panes get inner padding (the FitAddon accounts
  for it) so output no longer touches the edges.

### Added â€” Phase 2 (git & worktrees) â€” left-panel UX rework
- **shadcn-svelte component library**: real components from the official registry
  under `src/lib/components/ui/` (button, input, dialog, dropdown-menu,
  collapsible, separator, badge, card, tooltip, select), plus the canonical
  `WithElementRef` / `WithoutChild*` type helpers in `utils.ts`. `tailwind-merge`
  bumped to v3 (correct for Tailwind v4); `bits-ui`, `tailwind-variants` and
  `@lucide/svelte` added. The monorepo `AGENTS.md` now scopes the Svelte/desktop
  skills (shadcn-svelte, svelte-code-writer, svelte-core-bestpractices) to
  `uxnandesktop/` and the Flutter skills to `uxnanmobile/`.
- **Redesigned left panel** (`LeftSidebar.svelte`): the Projects/Worktrees tabs
  are gone. One panel with a top **search** box (filters projects *and* worktrees
  together) over two **collapsible** sections â€” Projects and Worktrees (collapsed
  by default). Either section expands to fill the remaining height while the
  other is collapsed, or they share it 50/50.
- **Project cards** (`ProjectCard.svelte`): name, path and a worktree-count badge,
  with top-right actions â€” open a terminal in the repo, **New worktreeâ€¦**, and a
  â‹¯ menu (copy path, remove project with confirmation).
- **New-worktree dialog** (`NewWorktreeDialog.svelte`): branch name + a
  **base-branch picker** (shadcn `Select`, preloaded with the resolved default)
  + a live preview of the worktree folder path.
- **Worktree cards** (`WorktreeCard.svelte`): branch (+ `main` badge), owning
  repo and path; click to mark active; actions to open a terminal there and a â‹¯
  menu (copy path, remove). Removal **escalates to a forced remove** when the
  worktree has uncommitted changes.
- **Worktree backend** (`git.rs`, `commands.rs`): `branch_list` (local branches +
  resolved default base `origin/HEAD` â†’ `main` â†’ `master` â†’ `HEAD`);
  `worktree_create` now takes a `base` and uses `--no-track` (avoids a false
  "behind upstream" before first push); `worktree_remove` with a dirty-changes
  preflight, `prune`, and a safe branch delete. +1 test (17 â†’ 18 passing).

### Changed
- **The app starts with no terminal open** (`terminals.svelte.ts`,
  `TerminalArea.svelte`): the center area begins empty with a "New terminal"
  empty-state and a global **+ Terminal** button in the top strip; terminals are
  opened from a project/worktree or that button. A persisted layout from a
  previous session is still restored, and closing the last terminal now leaves
  the area empty instead of respawning a shell.
- **Webview default context menu suppressed** (`+page.svelte`): the browser/dev
  right-click menu no longer appears (kept on text fields for paste); the
  terminal's own tab/pane menus are unaffected.

### Added â€” Phase 1 completion (persistence & lifecycle)
- **Terminal layout persistence**: the region/tab layout is serialized
  (structure only â€” splits, ratios, per-tab title/cwd, active tab) and saved
  (debounced, atomic) via a new `set_terminal_layout` command into
  `AppData.terminal_layout`; restored on startup in `app.init` (`serializeArea`
  / `restore` in the store). Fresh shells spawn on restore; the UI waits for the
  store to hydrate before mounting terminals so none is spawned then discarded.
- **Kill all PTYs on app exit** (`PtyManager::close_all` wired to
  `RunEvent::ExitRequested` in `lib.rs`) so no shell/agent is left running after
  the window closes.
- **Bounded terminal scrollback** (`scrollback: 5000`) caps per-terminal memory
  â€” the effective limit for hidden terminals (which stay mounted).
- With this, **Phase 1 (terminal core) is complete**; remaining terminal items
  (tab reorder / drag-between-regions / MRU, the backend ring buffer, and
  per-worktree terminal association) are Tier 2 / Phase 2 and tracked in
  `FOR-DEV.md`.

### Added â€” Phase 1 (terminal splits & interaction)
- **TabGroup region layout** (`src/lib/state/terminals.svelte.ts`,
  `TerminalArea.svelte`): the center area is now a tree of regions
  (`AreaNode = TabGroup | AreaSplit`). Each region has its own tab strip (each
  tab = one PTY) and "+ New" button; **Split right/down** divides a region into
  two with a draggable ratio (nestable). Terminals render in a flat,
  PTY-id-keyed layer positioned from `computeAreaLayout`, so splitting/closing
  **never remounts xterm or restarts a process** â€” fixing the earlier bug where
  the first pane reprinted its shell startup and running processes were killed
  on split/close.
- **Terminal copy/paste**: `Ctrl+C` (copies when there's a selection, else
  SIGINT) / `Ctrl+V`, plus a right-click context menu (Copy Â· Paste Â· Split
  right/down Â· New terminal Â· Close terminal) on both the terminal and the tab.
  Clipboard via `tauri-plugin-clipboard-manager` (`src/lib/clipboard.ts`, with a
  `navigator.clipboard` fallback for the web preview).
- **File drag-and-drop**: dropping files onto a terminal inserts their quoted
  paths into the terminal under the cursor (Tauri `onDragDropEvent`).

### Fixed
- **`pty_create` is idempotent** (`src-tauri/src/pty.rs`): re-creating an
  existing PTY id is a no-op instead of spawning a replacement, so a stray
  double-create can never restart a live shell/agent. +1 test (16 â†’ 17 passing).

### Changed â€” UI
- **Right-panel toggle relocated** out of the title bar (next to min/max/close)
  into a slim strip at the top-right of the center panel, so it stays visible
  when the right panel is hidden.
- **Slim themed scrollbars** for the terminal viewport and sidebars
  (`.xterm-viewport` / `.uxnan-scroll` in `app.css`) instead of the chunky OS
  default.

### Added â€” Phase 2 (git & worktrees, in progress)
- **Git backend** (`src-tauri/src/git.rs`): repo/worktree ops via the git CLI
  (`tokio::process::Command`, `shell:false`) â€” `is_git_repo`, `repo_name`,
  `worktree_path_for`, `add_worktree` (`git worktree add -b`), and
  `list_worktrees` with a `--porcelain` parser that surfaces **worktrees created
  by CLI agents**, not just ADE-created ones. Commands: `repo_add` /
  `repo_remove` / `repo_list` (repos persisted in `AppData`), `worktree_create`,
  `worktree_list`. New `AppError::Git` / `AppError::Invalid`; Tokio `process`
  feature enabled; `tauri-plugin-dialog` added for the native folder picker.
- **Tabbed left sidebar** (`LeftSidebar.svelte`): **Projects** tab (add a repo
  via the native folder picker â†’ `repo_add`, list, remove) and **Worktrees** tab
  (create on a new branch via a minimal form â†’ `worktree_create`, list per repo,
  and an "Open terminal here" action that spawns a shell in the worktree's cwd).
  Terminals now accept an optional `cwd` (`terminals.create({ cwd })`).
- âš ï¸� The add-project / create-worktree **UX is intentionally superficial** for
  this review pass and must be reworked (proper dialog, validation, feedback,
  base-branch picker, richer cards). Tracked as the top Phase 2 item in
  `FOR-DEV.md`.

### Changed â€” UI
- **Custom title bar** (`TitleBar.svelte`): the OS window chrome is disabled
  (`decorations: false`) and replaced with an in-app bar matching the app's
  surfaces â€” drag region, sidebar toggles, an **ALPHA** badge (neutral, readable
  in light and dark), and minimize / maximize / close controls
  (`@tauri-apps/api/window`; capability permissions added). Degrades gracefully
  in a plain browser.
- **Layout fix**: the center terminal area and its tab stack are now
  `overflow-hidden`, so the xterm canvas can no longer paint over the right
  panel when the left sidebar is toggled (was visible in the web build).

### Added â€” Phase 1 (terminal core, in progress)
- **PTY backend** (`src-tauri/src/pty.rs`): `PtyManager` over `portable-pty` 0.9
  (ConPTY on Windows). `create(PtySpec, on_output, on_exit)` spawns a shell in a
  pseudoterminal and streams stdout/stderr from a dedicated reader thread via
  caller-supplied sinks (so it's unit-testable without an `AppHandle`); plus
  `write`, `resize`, and idempotent `close` (kills the child). Default shell =
  PowerShell on Windows / `$SHELL` elsewhere; default cwd = home.
- **PTY commands** (`commands.rs`, registered in `lib.rs`): `pty_create`,
  `pty_write`, `pty_resize`, `pty_close`. The frontend picks the `id` and
  subscribes to `pty:output:{id}` before spawning, so no early output is lost;
  `pty:exit:{id}` fires when the process ends. `AppState` now owns the
  `PtyManager`. New `AppError::Pty` / `AppError::NotFound` variants.
- **Terminal UI**: `Terminal.svelte` (xterm.js + fit + WebGL-with-DOM-fallback,
  bidirectional PTY wiring, refit on resize/activate) and `TerminalArea.svelte`
  (tab bar: create / close / switch; hidden tabs stay mounted so their PTYs keep
  streaming). Wired into the center panel; tab state in
  `src/lib/state/terminals.svelte.ts`. Deps: `@xterm/xterm`,
  `@xterm/addon-fit`, `@xterm/addon-webgl`.
- Tests: 4 PTY unit tests (lifecycle incl. real shell writeâ†’echoâ†’readâ†’close with
  a ConPTY `ESC[6n` responder, unknown-id `NotFound`, idempotent close, default
  shell). Backend `cargo test` 12 passing, clippy + fmt clean; frontend
  `npm run check` 0/0, `npm run build` OK.
- Deferred to later Phase 1 increments (see `FOR-DEV.md`): pane splits
  (recursive binary tree), tab reorder/MRU, tab/split layout persistence,
  backend hidden-tab ring buffer, kill-all-on-exit.

### Fixed â€” docs
- **Stale internal cross-links in the architecture spec** corrected so every
  reference resolves to an existing file (`architecture/00-index.md`,
  `01-product-vision.md`, `02d-agent-monitoring.md`). The broken targets came
  from the pre-reorganization numbering; mapped by topic to
  `02b-terminal-engine.md`, `02c-git-worktrees.md`, `02d-agent-monitoring.md`,
  and the old `02e-implementation-guide.md` â†’ `03-implementation-guide.md` (the
  "GuÃ­a de ImplementaciÃ³n" nav) / `04-technical-reference.md` (the "fases, MVP,
  estimaciones" reference). `01`'s "Ver tambiÃ©n" header now lists every sibling
  doc.

### Added â€” docs
- **`docs/` directory**: `development.md` (prerequisites, running in debug, UI
  iteration, the npm-not-pnpm gotcha), `build.md` (release builds, bundle
  targets, signing pointers), `testing.md` (verification gates), and
  `architecture.md` (orientation + monorepo context). Linked from a `## Docs`
  section in the README. The monorepo `AGENTS.md` now requires a `docs/` per
  component (development / build / testing / component-specific).

### Added â€” Phase 0 (base infrastructure)
- **Project scaffold**: Tauri 2 + SvelteKit (SPA via `adapter-static`,
  `ssr=false`) + Svelte 5, branded as `uxnan-desktop` / `com.uxnan.desktop`.
  Window `1280Ã—800` (min `880Ã—560`). Uses **npm** (the host's home
  `pnpm-workspace.yaml` hijacks `pnpm install` in this directory).
- **Styling foundation**: Tailwind CSS v4 via `@tailwindcss/vite` +
  shadcn-svelte design tokens (`src/app.css`, neutral/oklch, `.dark` variant),
  `cn()` helper (`src/lib/utils.ts`), and `components.json` so
  `shadcn-svelte add` works later. No components generated yet (kept minimal).
- **Rust data model** (`src-tauri/src/model.rs`): `AppData` â†’ `RepoData` â†’
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
- Verified: `npm run check` (0 errors/0 warnings), `npm run build` (SPA â†’
  `build/`), `cargo test` (8 passing), `cargo clippy` + `cargo fmt` clean.

### Notes
- The full engineering roadmap (Phases 1â€“6) and deferred items are tracked in
  [`FOR-DEV.md`](FOR-DEV.md); human-provided assets in [`FOR-HUMAN.md`](FOR-HUMAN.md).
- Default Tauri placeholder icons are in `src-tauri/icons/` â€” branded icons are
  a `FOR-HUMAN` asset.
