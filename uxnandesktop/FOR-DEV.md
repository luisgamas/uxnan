# FOR-DEV — uxnandesktop

Deferred developer work for the desktop ADE. Each deferred code item has, or will
have, a greppable `FOR-DEV:` marker at its site. (Distinct from `FOR-HUMAN.md`,
which tracks assets only a human can provide.)

> The implemented surface is documented in [`README.md`](README.md) +
> [`docs/`](docs/) and the phase plan in
> [`architecture/04-technical-reference.md`](architecture/04-technical-reference.md).
> **`## Status` below is this component's canonical implementation status** (the
> root `AGENTS.md` points here instead of keeping its own inventory); everything
> after it tracks what's left.

## Status

**Phases 0–5 + cross-cutting (S) are DONE — the ADE is alpha-functional as a
standalone app** (three-panel shell, PTY terminals + splits, git worktrees, git
status/diff/stage/commit/history, agent monitoring with the axum hook server +
OSC/process layers, settings/themes/i18n, multi-agent orchestration,
**in-app auto-updater**, **browser-control MCP for agents**, **orchestration run
engine**, **user quick commands**, **GitHub integration (`gh`-backed, its read
side validated against captured real GitHub data — `docs/github-validation.md`)**,
**"Open with" external editors/IDEs**, **automations**, **pets**, **a reproducible
resource benchmark**, **an in-app resource monitor**, **a resource mode with
explicit efficiency presets — Efficient / Balanced / Performance — governing the
background consumers**, `docs/resource-mode.md`), **post-mortem diagnostics**
(`docs/diagnostics.md`), **generated conversation names on the agent card and
the tab strip** (`convtitle.rs`, the agent's own CLI on its cheapest model,
named from the session's **terminal transcript** — the only material every agent
has, since only Claude reports a prompt through the hook; a hand-renamed tab
always wins). 529 Rust tests (501 unit + 28
integration; +7 ignored supervised live GitHub tests + 1 ignored real-scheduler
probe) + 891 frontend Vitest tests across two
projects — pure logic and **Svelte
component tests** — plus a **real E2E suite** (WebdriverIO + tauri-driver: 8
journeys, 24 tests, green on Windows, plus an opt-in GitHub journey pending its
first run). macOS now ships an
**experimental, unsigned** build (Intel + Apple Silicon; CI verifies `{ubuntu,
windows, macOS}`, release gate stays `{ubuntu, windows}`) but is **not yet validated
on real hardware**. **Every platform claim now lives in the platform support
matrix** (`tests/platform-support.json` + `docs/platform-support.md`, checked by
the suite and gating releases): Windows announces `smoke`, macOS (both arches)
and Linux announce `builds`. **Phase 6 (embedded bridge / mobile pairing) is NOT
started.**

**Built (DONE), in detail:**

- **Three-panel resizable shell** with atomic JSON persistence (5 rotating
  backups + sequential schema migrations).
- **PTY terminals** (`portable-pty 0.9`, xterm WebGL + DOM fallback) — tabs +
  nested splits that never remount on split, drag-to-reorder / move tabs across
  regions (each terminal's xterm instance stays alive and is **re-parented** on a
  move — registry in `src/lib/terminal/instances.ts`; nothing is replayed),
  `Ctrl+Tab` MRU cycling, and the Kitty/CSI-u keyboard protocol. Tabs can be
  **renamed** (free-form label for terminals/diffs, persisted; on-disk rename for
  file tabs via `fs_rename`, with an extension-change warning) and **closed all at
  once** per active workspace. Scrollback is **user-configurable** (Settings →
  Terminal, default 20,000 lines; `src/lib/terminal/scrollback.ts`). On Windows, a
  command blocked by **Redirection Guard** on a junction/OneDrive path is detected
  and the user is guided to a fix (`src/lib/terminal/windowsJunctionGuard.ts`;
  `docs/windows-junctions.md`).
- **Git worktrees** — per-worktree terminal workspaces, hierarchical Projects
  tree, in-app directory picker, worktree palette (Ctrl/Cmd+P), WSL repos routed
  through `wsl.exe`. **Creation** offers two modes — a **new branch** from a base
  (with a friendly auto-name generator) or **checking out any existing local /
  remote branch** into an isolated worktree — plus an **optional custom location**
  (editable path + an in-app folder browser). **Removal is worktree-only by
  default**: the branch is kept unless the user opts into **deleting the local
  branch** (safe `-d`, with a force for unmerged work and the squash-merge
  safety net preserved) and/or the **remote branch** on `origin`. The **in-app
  folder browser** (shared by "Add project" and the worktree-location picker) has
  a **manual refresh** and a **live filesystem watch** (`browse_set_watch` →
  `browse:changed`) so newly created folders appear without navigating away.
  Projects carry a
  **⋯ actions menu + per-project settings** (rename the card label without
  touching the folder) and a **custom icon**; branches carry a **per-branch icon**
  (both from a built-in glyph set, a file, a URL, or a git-host account avatar —
  rasterized to an inline PNG via `image_fetch_data_url` / `repo_remote_owner` and
  persisted in `RepoData.icon` / `branchIcons`).
- **Full git review** — status / diff / stage / commit / push / pull with a 3 s
  focus-paused Tokio watcher, CodeMirror 6 diff viewer, hunk-level staging,
  side-by-side toggle, visual image diffs, and optional AI commit-message
  generation via a local CLI agent. The Changes header also offers **Check remote**
  (`git_fetch` → refreshed ahead/behind, read-only), so the *behind* count and the
  **Pull** button stop waiting on some other fetch.
- **Unified multimodal file viewer** — one file tab owns Edit / Preview / Changes;
  README-grade Markdown includes safe presentational HTML and badges, relative
  links/images, anchors and highlighted fences; images include editable SVG; PDFs
  use the native webview renderer through a validated, bounded data URL. Details:
  [`docs/file-viewer.md`](docs/file-viewer.md).
- **File tree with content search** — lazy gitignore-aware tree plus three search
  surfaces sharing one walker: file **names** (`fs_search_files`), file
  **contents** (`fs_search_content` — literal / whole word / regex, matching lines
  that open the file at their line) and **include/exclude globs** narrowing both.
  Binary, oversized (> 2 MiB) and unreadable files are skipped; per-file and total
  match caps are reported as truncation. The tree marks and reveals whatever the
  center area is showing, independently of the click selection. Details:
  [`docs/file-tree.md`](docs/file-tree.md).
- **Agent monitoring (Phase 4)** — Layer 1 local HTTP hook server (`axum`, precise
  `working/blocked/waiting/done` + persistent cache) + Layer 2 terminal-title
  (OSC, path/word-boundary-hardened) + Layer 3 process-tree detection; colored
  status dots, unread/done badges, custom agent logos, per-worktree agent override.
- **Precise per-agent reporters (auto-installed, multi-shell)** — Claude Code +
  Gemini CLI use a Node relay (`node` guaranteed; Claude in exec-form so no shell
  is involved); Codex uses a `curl` hook + a reproduced `trusted_hash` in
  `~/.codex/config.toml` (golden-vector-tested `codex_trust.rs`); OpenCode a
  plugin, Pi an in-process extension. **Grok** owns a file in `~/.grok/hooks/`
  (Claude's event vocabulary, so it reaches every state incl. a real `blocked`
  from `StopFailure`) and **Antigravity** one named entry in
  `~/.gemini/config/hooks.json` (loop events only — it has no prompt/permission
  hook, so it never reports `waiting`); both drive `uxnan-event-hook.{sh,cmd}`,
  and both CLIs parse a hook command as an unquoted literal path, handled by a
  dot-relative command (Antigravity) and an 8.3 short-path fallback (Grok).
  Gemini CLI is no longer auto-installed (discontinued upstream) but its card
  still appears while its reporter is present, so it can be removed.
  **Fifteen more agents are wired declaratively** — OpenClaude, Qwen Code,
  Droid, Devin, Command Code, Auggie, Cursor, GitHub Copilot, Kiro, Kimi Code,
  Goose, MiMo Code, Kilo Code, Amp and OMP — as rows in `agent_hooks::TABLE_AGENTS`
  (config path, detection command, entry shape, events) driving the shared
  `uxnan-event-hook`, or — for the last three — an in-process plugin the CLI
  auto-discovers (MiMo and Kilo run OpenCode's reporter with the agent kind and,
  for Kilo, the export shape rewritten at install; Amp has its own source); adding one is a row plus
  a `normalize_event` arm with the same id, which a test enforces. Startup only
  installs the agents the machine actually has (`PATH` or an existing config).
  Per-event merge preserves user hooks and is tag-scoped, so two of our own
  reporters can share one config file; shell
  reporters pass id/kind/state in headers (no JSON building) and answer `{}` on
  stdout (Cursor gates tool use on the hook's reply); an endpoint file
  (`UXNAN_ENDPOINT_FILE`) survives app restarts; `WSLENV` carries the vars into
  WSL (WSL2 host-loopback is a documented gap). Settings → Agents → Hooks is a
  master–detail list (agents on this machine first) + a master install switch,
  rendered from the backend registry, over four generic Tauri commands.
  **More than one uxnan window works.** Each window has its own port + token and
  injects them per terminal; the shared `endpoint.*` file is now only the rescue
  when the environment's server stops answering (it is one path, so the last
  window to start owns it — preferring it sent the first window's agents to the
  second). Every reporter uxnan ships follows that order and both paths are
  verified. The browser MCP entry still belongs to the last window to start (a
  config file has no per-window environment to read a URL from), but a window
  closing no longer deletes the live window's entry.

  **Live-verified this cycle:** Codex (its `SessionStart {"source":"startup"}`
  before any prompt — the bug that made it read as working forever — and the
  `last_assistant_message` its `Stop` carries), Grok (still reporting through the
  reporter that now answers `{}`), and Cursor's install (merged into a real
  `~/.cursor/hooks.json` beside another tool's hooks, then removed cleanly).
  Cursor's own `-p` print mode runs no hooks at all in 2026.08.04, so its
  reporting was confirmed at the install layer, not end to end.
- **Multi-agent orchestration** (spec `02d` §3) — a two-tab console (status bar,
  shown with ≥2 live agents or any saved run): **Broadcast** (**explicit recipient
  selection** — tick individuals / whole types / all; coordinator retired — with
  robust paste+submit delivery and a busy-agent hold cap) + a **run engine**
  (**Runs**): a DAG of steps with context passing (`{{steps.s1.output}}`),
  parallel/fan-in dependencies, **headless** steps (print-mode, verified by exit
  code), **HITL gates**, per-step **retry**, durable persistence + re-attach, and
  orchestration **MCP tools** for structured agent reports (auto-nudged into
  chaining interactive steps when the agent has the tool). The builder has a
  **contextual variable picker** (per-field descriptions + live previews, insert at
  cursor), **type cards** (headless the default for chaining), **searchable**
  agent/model/worktree pickers, and an **Examples** menu of ready-made runs.
- **Automations — engine only, no UI yet** (spec `02f`) — unattended, **recurring**
  tasks that run in **their own working folder** (repo or not; never bound to the
  selected project) driving a **multi-agent graph**: parallel + fan-in from
  `dependsOn`, context passing (`{{steps.s1.output}}`, plus `{{prev.s1.output}}` from
  the previous run), completion **verified by exit code**, skip propagation down a
  failed branch, per-step retry, shell **precondition**, optional **worktree per
  run**, overlap policy with a stale-run guard, and history **retention**. The binary
  doubles as a **headless runner** (`--automation-run <id>`, branched in `main.rs`
  before Tauri builds a window) so a run fires **with the app closed**; one execution
  path serves both the OS scheduler and "Run now". Persistence uses a **single writer
  per file** (`<app-data>/automations/`). **Registration with the OS scheduler is
  done** — Task Scheduler XML / LaunchAgent / systemd user timer, per user and
  without elevation, with the overlap policy and missed-run catch-up delegated to the
  OS and **honest degradation** when registration fails — plus the Tauri command
  surface that keeps the stored definition and the OS task in lockstep.
  **Validated live** with the app closed: OpenCode ∥ Codex in parallel with Claude
  consuming both outputs, and a real Windows task firing the runner end to end.
  The **screen** is built too (spec `02f` §6): a full-screen view like Settings,
  opened from the sidebar profile menu or `Mod+Shift+A`, with a section rail
  (Overview / Automations / Runs / Templates / Settings), a list groupable by lead
  agent / task type / frequency / folder / status, an **inline** editor with a
  next-runs preview, run history showing the **prompt as actually sent**, and the
  honest scheduling badge. Two things make it usable by someone who has not read
  the docs: **four example automations are seeded on a first visit** (all paused,
  all multi-agent, restorable from Templates under their own ids) so no section is
  an empty page, and under every prompt field the editor **lists the values that
  prompt can carry** — an earlier step's answer, what a step answered in the
  previous run, the working folder — each explained in plain language and inserted
  at the cursor, with an earlier step's answer also making the step wait for it.
  `src-tauri/src/automations/`, `src/lib/automations/`,
  `src/lib/components/automations/`, [`docs/automations.md`](docs/automations.md).
- **Cross-cutting (S)** — Settings (theme + terminal profiles w/ OS templates),
  design tokens, full EN/ES i18n + Language picker, agents registry + install
  detection + manual + auto-launch, per-agent env vars, a configurable agent
  launch shell (Command Prompt by default on Windows), virtualized lists
  (`@tanstack/svelte-virtual`), opt-in keep-awake (Windows). The left sidebar's
  quick actions are just **Search**: Settings moved into a configurable **profile
  card pinned to the sidebar footer** (`SidebarProfile.svelte` — avatar via the
  shared `IconPicker`/`EntityIcon`, name, description; persisted in
  `AppSettings.profile`, edited from `SidebarProfileDialog.svelte`).
- **In-app auto-updater** (`tauri-plugin-updater`) — Settings → Updates with
  stable/nightly channels (mapped to GitHub's pre-release flag), background
  download + agent-idle-guarded install (a restart stops agents, so the install
  waits for the safe window or explicit consent), banner UI, EN/ES i18n. Endpoint
  per channel + signing/CI in [`docs/updates.md`](docs/updates.md); signing key is
  a `FOR-HUMAN.md` item.
- **AI-provider usage statistics (Settings → Providers)** — native Rust reader
  (`src-tauri/src/usage.rs`, `usage_read`/`usage_detect`) for **Codex, Claude,
  Copilot, Grok**, reading each CLI's own stored token → the provider's official
  usage API (never cookies / pasted keys). Tabbed UI with per-provider quota
  windows ("% used"), plan/account ("Authenticated as …" with click-to-reveal
  blur), credit, per-provider refresh interval + status-bar visibility, and a
  status-bar gauge popover. Polling starts at boot, catches up on focus, honors
  each provider's interval, and preserves Codex percentage-point semantics around
  resets. Contract-first (`shared` `agent/usageStats`); the
  bridge/mobile side is Phase 6 (see below). **Gemini CLI** is still read but
  **hidden from the picker** (discontinued upstream — `deprecated` in
  `src/lib/usageCatalog.ts`); **Antigravity** is researched but not wired (its
  token lives in the OS keyring, not on disk — see *Providers* below).
- **User quick commands** — a top-bar ⚡ launcher (in the fixed window-controls
  slot, left of min/max/close, so a hidden panel never covers it) + a Settings →
  Quick commands editor. Commands are persisted flat in `AppData.quickCommands`
  (`quick_commands_set`), each scoped **global / project / worktree** and pruned
  when its project/worktree is removed (frontend-side, where live worktree paths
  are known). Runtime (`projects.runQuickCommand`) reuses the terminal
  `runCommand` launch path: substitutes `{worktree}`/`{branch}`/`{repo}`/
  `{repoName}`/`{path}` tokens, resolves the shell (a terminal profile) + cwd, and
  dispatches to a **new tab** or the **focused terminal** (`pty_write`), running
  immediately or only pre-typing (`runCommandExecute`). Opens with **`Mod+Shift+P`**.
- **GitHub integration (`gh`-backed)** — a **per-project inline GitHub view**
  (Pull Requests / Issues / Actions, opened from each project card's **⋯ menu →
  GitHub** *or* any **worktree row's right-click menu → GitHub** — which acts on the
  owning project and is the only way in while the sidebar is grouped by status, both
  routed through the shared `github.openSection`; it replaces the center + right
  panels, leaving the left sidebar and the browser panel in place, and closes when
  any worktree is activated — `app.githubInline`), with the **Account / Session** panel and every GitHub
  preference in **Settings → GitHub** (`GithubSettings.svelte`); a configurable
  **right-panel GitHub tab** (the branch's PR + checks, plus the repo's 5 latest
  PRs / CI runs / issues — every row opening that item's detail inside the app via
  `github.openSection`'s pending-detail, and each issue offering the worktree
  dialog), **sidebar-card PR
  badges**, a passive **readout inside the status bar's backend popover**
  (rate limit + optional unread count, an unread dot on the backend icon and a row
  into Settings → GitHub; it has no status-bar button of its own and never
  navigates on its own), and a post-push **"Create PR"** toast. PR **review** (approve/request-changes/comment) + **merge** +
  **close/reopen** + the unified **diff** (**split per file**, collapsed by default +
  expand/collapse-all); a **GitHub-style timeline** (a chronological vertical rail
  interleaving description + comments + review verdicts + commits + events —
  labeled/assigned/closed/merged/…, via the Timeline Events API; bodies/comments/reviews
  rendered as **Markdown** incl. inline images; a **Verified** badge on signed commits)
  with **comment fields** on both PRs and issues; **reviewers**, colored **state/status
  icons**, **search bars**, legible localized **relative dates** (`Intl.RelativeTimeFormat`),
  an **expandable CI checks section** + a **CI popover** on the head commit and each
  PR-list row, and the review/merge/close **tools in a bottom action bar**, with
  merge/approve/request-changes **gated to open PRs**; **issue** triage/create +
  **close/reopen** (+ **labels/assignees** from the repo's real sets when filing);
  PR/issue **title+description editing** in place (`gh pr/issue edit`) and **reviewer
  requests** (`--add-reviewer`);
  **Actions** logs + re-run/cancel; **worktree-native** `gh pr checkout`
  / `gh issue develop` — both behind a **settings + confirmation dialog** (editable branch
  name pre-filled with the generic default, GitHub-slug suggestion for issues, launch-agent
  picker, folder preview, existing-worktree warning) that adopts the result through the
  same path as a hand-made worktree, so it gets its agent like any other; optional
  **AI PR-body drafting** (the `aicommit` one-shot runner) configured in a full
  **AI-PR-authoring settings section** built like Settings → AI commit (enable switch,
  agent picker with logos + install state, shared `AiModelPicker`, language,
  instructions).
  PR detail is split into **Conversation / Files-changed tabs** with the action bar
  available from both. Creating a PR **picks its `base ← head`** — **either side can be
  any branch** (local ∪
  `origin`, marked *local only* where relevant), defaulting to the repo's default branch
  / the checked-out one (head pinned in the right-panel tab); it refuses base == head,
  warns on an unpushed branch, and drafts the AI body against the **chosen** base. **Merging is protection-aware**: methods are the
  repo's settings ∩ the base branch's **rulesets** (`gh api …/rules/branches/{base}` —
  the classic protection endpoint 404s on ruleset-protected branches), defaults follow
  `viewerDefaultMergeMethod`/`deleteBranchOnMerge`, a blocked PR **says why**, and the
  escape hatches are **auto-merge** (`--auto`, gated on `allow_auto_merge`) then
  **admin bypass** (`--admin`, offered on **any** blocked PR rather than gated on
  `viewerCanAdminister` — that flag misses ruleset `bypass_actors` and fails on GHES;
  behind a danger confirm that says when the right is unconfirmed);
  every merge passes `--match-head-commit`. Every state the panel reports carries the
  action that answers it: `BEHIND` → **Update branch** (`gh pr update-branch`, + rebase
  variant), armed auto-merge → **Turn off** (`--disable-auto`), draft → **Mark ready**
  (`gh pr ready`, reversible). All via the local **`gh` CLI** (incl.
  `gh api` for rate-limit/notifications/timeline/rulesets) — **no token stored/read by
  the app**; every agent action has a manual twin. Backend `src-tauri/src/github.rs`
  (38 commands) + `AppSettings.github`. See [`docs/github.md`](docs/github.md).
  **Caveat: the write side is implemented but not yet exercised against real GitHub
  data** (this repo has no PRs/issues/collaborators) — see *Validation status* under
  "GitHub integration — follow-ups" before trusting any of it in anger.
- **Resource benchmark** (`scripts/resources/`) — twelve canonical scenarios, a
  versioned result schema, structural own/managed/external process attribution,
  deterministic offline fixtures (generated git repo, stand-in agent, loopback
  page), per-platform budgets in warn mode, a baseline comparator, a redaction
  gate that refuses to write anything personal, and a nightly/on-demand CI
  workflow. Scenarios reach their state by seeding a disposable app profile
  (`UXNAN_DATA_DIR`, `src-tauri/src/datadir.rs`), never by driving the UI.
  See [`docs/resource-benchmarks.md`](docs/resource-benchmarks.md).
  **Caveats: only Windows has been run on real hardware; R07/R08 still need an
  operator; the gate is warn-only.** See "Resource benchmarks — follow-ups".

## Diagnostics — follow-ups ☐

**Recording and surfacing are both complete** (rolling log, panic hook,
uncaught-frontend-error capture, unclean-shutdown marker, the startup notice and
Settings → App → Diagnostics; `docs/diagnostics.md`).

- [ ] **Decide whether an agent's terminal death deserves its own log line.**
      An agent CLI running inside a uxnan terminal cannot tell an app crash from
      a force-close from a dead PTY host, which is exactly what made the
      2026-08-02 cut sessions unfalsifiable. Recording PTY child exits (pid,
      exit status, whether uxnan asked for it) would separate those three, but
      it needs a rate limit — a busy session spawns and reaps constantly — so it
      is deliberately not part of the first pass.

## Resource benchmarks — follow-ups ☐

**The harness is complete and runs.** What is left is coverage and confidence,
not missing machinery.

- [ ] **Re-measure the published figure on a modest machine.** The ~250 MB now
      quoted everywhere comes from a 16 GB box, and WebView2 is more generous with
      memory when there is memory to spare — so the number a low-RAM user actually
      sees is probably lower, and is currently unknown. That is the machine the
      claim is aimed at, so it is the machine it should be measured on.
- [ ] **Leave the gate in warn mode for two weeks of real runs, then flip
      `"mode": "enforce"`** in `budgets/windows.json`. The limits are derived
      from the 2026-07-30 baseline with explicit margins (the rule is written
      into the file), but flipping before the noise floor is known on a second
      machine is how a gate earns a reputation for false positives and gets
      switched off.
- [ ] **Capture R07 and R08 — preferably by automating them, not by an
      operator.** R10 ran its first real two-hour soak on 2026-08-01 (own-RSS
      slope 1.62 MB/h, zero orphans; budget entry recorded), so long-run growth
      now has evidence. R07/R08 remain the only unmeasured scenarios: rather
      than scheduling a person to click, convert them from `assisted` to `auto`
      over the E2E driver that now exists (see the automation item below).
- [ ] **Run the Unix collector on real macOS and Linux hardware.** It is
      implemented and shares the schema, but has never executed anywhere: until
      it has, `budgets/{macos,linux}.json` stay empty and no figure for those
      platforms may be published. macOS additionally needs its own definition of
      the `own` bucket — WebKit's content process lives outside the app's tree,
      so the Windows framing does not transfer.
- [ ] **Automate R07 (browser) and R08 (GitHub) over the E2E driver.** The
      driver exists now (WebdriverIO + tauri-driver, plan-of-record since the
      test pyramid landed), so the remaining work is design + wiring, not
      waiting: the open question is how the harness drives its *measured* app
      instance (the bench launches the binary itself, the driver launches via
      `tauri-driver` — either the bench adopts a driver session for the
      interaction phase, or the interaction is seeded state the app replays).
      The metric names will not change when they flip to `auto`; R08 stays out
      of CI regardless, because it needs a real `gh` login. Same for R04's
      *wake* half — the asleep cost is automatic, the wake latency and
      scrollback fidelity are still on the checklist.
- [ ] **Per-run WebView2 profile, if a way appears.** Tauri forces the webview
      user-data folder to `LocalData/<identifier>` when a window config does not
      set one, which is why two instances share a browser process and why the
      harness has to refuse to run alongside another uxnan. Isolating it per run
      would remove that precondition; it needs either a config-level
      `dataDirectory` uxnan controls per launch or an upstream hook.

## Resource monitor — follow-ups ☐

**The in-app resource monitor is built and tested** (`src-tauri/src/resources.rs`,
`docs/resource-monitoring.md`): demand-driven sampling, pid+start-time
attribution with explicit confidence, orphan detection, the popover + Settings
surfaces, and the consent-first sanitized export. What is left is measurement
and platform confidence, not machinery.

- [ ] **An L4 journey for the popover round trip.** No E2E spec opens the
      backend popover against the real binary yet — the suite could not run
      beside the live instance this feature was built next to, and an
      unverifiable spec is worse than an honest gap. The journey is viable with
      the existing WebdriverIO pattern (click the status-bar trigger, assert
      the Resources section renders and the lease releases on close); until
      then the round trip is covered at L2 (component) + L3 (monitor against
      real processes), per `tests/quality-matrix.json` →
      `resource-observability`.
- [ ] **Validate the metrics on real macOS/Linux hardware.** The collector is
      portable `sysinfo` and compiles everywhere, but only Windows figures have
      been checked against reality — `capabilities.validated` is `false` off
      Windows and the UI says "best effort" on purpose. Validating means: start
      times round-trip (the identity scheme), CPU normalization looks sane, and
      macOS's out-of-tree WebKit content process is measured for what the
      `desktop` group misses there. Until then no non-Windows figure may be
      published.
- [ ] *(optional)* **A first Rust-side consumer for the internal event
      stream.** The `budget` lease kind now has its consumer — the
      orchestration engine's headroom check holds it while a run is active
      under a resource profile with extended concurrency
      (`docs/resource-mode.md`) — but `ResourceMonitor::subscribe_events`
      (the Rust broadcast of every ingested frame) still has no backend
      subscriber. It stays in the contract as the hook for a future
      backend-side consumer (e.g. a Tokio-driven limits engine), so that
      engine will not need a second sampler.

## Resource mode — follow-ups ☐

**The resource mode is built and tested** (`src/lib/resources/policy.ts`,
`docs/resource-mode.md`): three presets with Balanced pinned to the pre-mode
behavior, residue-free overrides, governed consumers (git sweeps,
GitHub/provider polling, orchestration concurrency with headroom-gated
extension, monitor history, pet flavour), freshness hints with manual refresh,
and flag-gated workspace auto-sleep. The per-preset efficiency matrix was
measured on 2026-08-01 and met its acceptance bar (`docs/resource-mode.md` →
*Efficiency matrix*); what is left is soak and a few declared gaps — not
machinery or measurement.

- [ ] **Do NOT retire the auto-sleep feature flag until it has soaked on all
      three platforms.** The flag (off by default) is the rollback lever; the
      `auto` level additionally needs live-process verification (a real dev
      server / watcher in a background workspace) on Windows, macOS and Linux
      before the flag can even be discussed. Windows-only today. (The new
      Settings section + freshness hints passed the maintainer's on-device
      review on 2026-07-31.)
- [ ] **An E2E journey for a hot preset switch.** No spec drives Settings →
      Resource mode against the real binary (same live-instance constraint as
      the popover journey above); the switch is covered at L1 (policy) + L2
      (component) instead, per `tests/quality-matrix.json` → `resource-mode`.
- [ ] **Ungoverned recurring work, declared:** the 1 s agent-detection tick and
      the OSC title layer are deliberately outside the policy in v1 — pacing
      them risks stale "needs you" states, which the mode must never cause
      (see the inventory in `docs/resource-mode.md`). Revisit only with a
      design that keeps attention states honest.

## Automations — follow-ups ☐

**The feature is complete and works.** The engine, the headless runner, the
OS-scheduler registration and the screen are all done and verified end to end on
Windows (see `## Status`). Nothing below is a hole in it — the list mixes three
different kinds of item, so it is grouped by kind rather than left as one pile.
Spec: `02f`.

### Unverified, not unbuilt

Built and unit-tested, but never exercised on real hardware or a real account.
Someone has to go and look.

- ☐ **The scheduler on macOS and Linux** — the LaunchAgent plist and the systemd
  units are produced by pure functions that are tested on every platform, but neither
  has ever been registered on a real machine. Windows has a `#[ignore]`d round-trip
  test against the real Task Scheduler (`cargo test -- --ignored windows_round_trip`);
  the other two need the equivalent run by hand.
- ☐ **A successful Zero run** — the recipe (`zero exec`, `--auto high`, prompt via
  `-f`) is wired, and its resolution, exit code and error capture are all confirmed
  against the real CLI. But this machine's Zero account has no credits, so a Zero step
  has never been seen to *complete*. Every other supported agent has.

### Deferred work, marked in the code

Real gaps, small and scoped. Each has a `FOR-DEV:` marker at its site.

- ☐ **A native notification from the runner** (`automations/runner.rs`) — a failed
  unattended run should raise an OS notification. The runner has no Tauri app handle,
  so it needs its own per-OS path (`notify.rs` is webview-side). Until then a failure
  is visible in the app but nowhere else.
- ☐ **Garbage-collect per-run worktrees** (`automations/runner.rs`) —
  `worktree_per_run` leaves each run's worktree in place on purpose, because you want
  to inspect what an unattended run did. Nothing removes them yet, so they accumulate;
  pruning a run record should offer to remove its worktree, and the UI should show how
  much disk they hold.

### Optional enhancements — nothing is missing without them

Ideas that would make automations *better*, not complete. Both are deliberately
undone rather than half-done, because the cheap version of each is worse than
leaving it alone.

- ☐ **A typed hand-off between steps.** Today one agent's answer reaches the next as
  prose, and the next agent reads it — which works, and is what every example does.
  Grok accepts `--json-schema` and Codex an `--output-schema` file, so a step *could*
  return JSON matching a shape the next step relies on. The trap: just asking for a
  "JSON output format" without a schema returns the whole transcript as JSON instead of
  the answer, which would make `{{steps.sN.output}}` **worse**. Doing it properly needs
  a per-step schema field, UI to author it, and an honest answer for the agents that
  support neither.
- ☐ **Tokens and cost per run.** Runs already record duration, exit codes and full
  output; this would add what each one *spent*. `usage.rs` reads each provider's own
  usage API, but tying a specific run to specific tokens means matching it to a
  provider session by time window — an inference that quietly produces wrong numbers
  when two things overlap. Worth doing only with a visible "couldn't attribute this"
  state instead of a confident guess.

- **Pets** — an opt-in animated companion that mirrors agent state, driven off the
  precise hook layer (`working`→`running`, `waiting`→`waiting`, `done`→`review`,
  `blocked`→`failed`, else `idle`; reports older than 30 min are stale and ignored).
  **One pet**, showing the most urgent agent state (needs-you → blocked → ready →
  working). Clicking it reveals that agent's
  terminal; the pet drags anywhere. By default it renders in its **own
  borderless, transparent, always-on-top desktop window** (`pets.overlay`,
  switchable back to a layer inside the uxnan window; visible over other apps
  and with uxnan minimized; native window drag, position persisted + validated
  against live monitors, its own `capabilities/pet.json`, loaded by query per
  mode — `/?window=pet` in dev, `index.html?window=pet` packaged — a thin
  stateless renderer fed by the main window over events; raising uxnan on a pet
  click is its own switch, off by default). The pet is
  **interactive**: while resting it watches the cursor (the v2 sheet's rows 9-10
  are 16 clockwise look poses, 0° = up, front = deadzone), a click pokes it (jump
  reaction), and dragging **carries it running** — the travelling run of rows 1-2 in
  the direction of travel (looping its own row), settling back into the looking-down
  carry pose when the hand stops. On top of the state's base
  animation it plays occasional one-shots (look around while resting, wave while
  waiting on you, take a breather while working) so the whole sheet is used and the
  pet doesn't read as a spinner. A one-shot is always a **different** row than the
  state's own: ending one restarts the base animation, which replays the state's row
  for free (that is what re-shows a settled state), so the state's own row would
  stack the two and the pet performs twice per cycle. Cadence tracks how long a
  state lasts — needs-you 6-13 s, resting 14-34 s, the long-lived ones 25-50 s —
  `pets/personality.ts`, pure and tested. The on-disk
  format is **Codex-compatible** (`pet.json`/`avatar.json` + one spritesheet, 8 × 9
  frames of 192 × 208 by default, `fallback` chains), so community packs load
  unmodified; import from `~/.codex/pets` or any folder is a **validating copy**
  (manifest + referenced sheet only, traversal-checked ids, bare-filename sheet path,
  ≤ 24 MiB, image sniff, bounded grid). uxnan bundles **only its own pet** and says
  so in the library + import dialog; each imported pet records its origin. Renderer
  wakes only on frame boundaries, parks while hidden, one still frame under
  `prefers-reduced-motion`, and loads nothing until enabled. Backend
  `src-tauri/src/pets.rs` + `AppSettings.pets`; frontend `src/lib/pets/` +
  `state/pets.svelte.ts` + `PetSprite`/`PetLayer`/`PetsSettings`. See
  [`docs/pets.md`](docs/pets.md). The bundled pet is a normal pack in
  `static/pets/uxni/` (8 x 11 sheet, one animation per row) — swapped by replacing
  the files, not regenerated. A generated pack declares neither `frame` nor
  `animations`, so both are recovered from the image — grid from its dimensions,
  animations from the conventional row order with its declared per-row frame counts (the
  reference map: `running` is the in-place row 7, not the travelling run on rows 1-2,
  which is what a *carried* pet plays;
  each state animation is its row three times followed by the idle frames, looping from idle
  (a travelling run is the exception on both counts: it repeats its own row for as long
  as the carry lasts, evenly and at the quicker CARRY_PACE — a run is a loop, not a gesture); frames carry individual durations — idle breathing once every 6.6 s, state rows at the reference times x STATE_PACE 1.3 = 182-195 ms a frame, one ambient pace for every gesture, capped so no frame is held long enough to read as a pause between stills). States **expire** rather
  than mirror — busy 3 min, anything waiting on the user 30 min, from when the
  agent entered the state — **unless the agent is still reporting** (a hook within
  90 s), which starts the clock over rather than resting the pet on top of live work
  with no terminal to point at. Among agents sharing the shown state, the pet is
  about the **freshest report** (`pickDriver`), not map order.

## Pets — follow-ups ☐

- [ ] **Pin the desktop pet across virtual desktops (Windows)** — the overlay
      window stays on the virtual desktop it was created on; switching desktops
      leaves it behind, while the Codex desktop pet follows. Tauri's
      `visible_on_all_workspaces` covers only macOS/Linux; on Windows this needs
      the `IVirtualDesktopManager` COM pinning dance (as PowerToys does).
      **Where:** `pet_window_show` in `src-tauri/src/commands.rs`, after the
      window is built.

- [ ] **AI pet generation ("hatch")** — create a pet from a text description instead
      of importing one. The blocker is image generation: a usable pack needs ~72
      *consistent* frames on a single 1536 × 1872 sheet, which the one-shot local-CLI
      runner (`aicommit.rs`) can't produce on its own — it needs a CLI with real
      image-generation output, and a prompt/pipeline that keeps the character stable
      across frames. Deferred deliberately: import (from `~/.codex/pets` or a folder)
      already covers "have several pets" end-to-end, so this is additive.
      **Where:** a new `pets_generate` command beside `pets_import` in
      `src-tauri/src/pets.rs`, driven from the Settings → Pets library header.
- [ ] **Per-project / per-worktree pet binding** — today the active pet is global.
      Binding a pet to a project or worktree (like `projectAgents` does for agents)
      would let each workspace have its own companion. **Where:** extend
      `PetSettings` with a bindings map + resolve in `state/pets.svelte.ts`
      (`get active()`), which is already the single resolution point.
- [ ] **React to non-agent events** — the pet currently only reflects agent state.
      It could also react to CI/PR outcomes already tracked by the GitHub layer
      (checks failed → `failed`, PR approved → `review`). **Where:**
      `state/pets.svelte.ts` `instance`, folding `state/github.svelte.ts` into the
      same priority collapse.
- [ ] **End the desktop pet's carry on a real signal, not a stall** — the overlay
      window's drag belongs to the OS, which swallows every pointer event, so
      "carried" is armed by window movement and released after `CARRY_HOLD_MS`
      (900 ms) of stillness. It behaves correctly (a paused hand keeps carrying,
      releasing settles a beat later), but it is a heuristic: Windows knows
      exactly when the drag ends (`WM_EXITSIZEMOVE`), and Tauri does not surface
      it. **Where:** `PetWindow.svelte`'s `onMoved` effect, plus a window event
      the Rust side would have to raise from a message hook.


## GitHub integration — follow-ups ☐

**Validation status — read this first.** The full per-area picture is
[`docs/github-validation.md`](docs/github-validation.md); the short version:

- **Read side: validated against real data.** Every parser runs against
  **captured real `gh` responses** from `luisgamas/uxnan`, sanitized and frozen
  in `tests/fixtures/github/` (`src-tauri/src/github/fixture_tests.rs` +
  frontend contract tests; capture tool `scripts/github/capture-fixtures.mjs`).
  A machine-checked **command inventory**
  (`tests/github-command-inventory.json`) maps every gh invocation to its
  parser, confirmation, UI consumer and evidence.
- **Runner + failure modes: validated offline through real processes.**
  `src-tauri/tests/github_cli.rs` drives the production layer against a
  scripted `gh` (shapes + provenance in
  `tests/fixtures/github/mutation-outcomes.json`): merge refusals, signed-out /
  offline / rate-limited / truncated-JSON / old-gh degradation, the Windows
  `.cmd` resolution fix, env hygiene.
- **Write side: validated live (2026-08-01).** The first supervised sandbox run
  executed the full runbook against `luisgamas/uxnan-gh-sandbox` — 7/7 live
  tests green (issue lifecycle, PR create/comment/merge with `--match-head-commit`,
  stale-head and draft refusals, ruleset block → `--admin` bypass, Actions
  dispatch/cancel/log), every mutation verified by a remote re-read, cleanup
  verified, refusal texts re-captured as `source-exact` bytes, and the opt-in
  E2E journey (`github-fake.e2e.mjs`) passed its first run the same session.
  Findings and the run record: `docs/github-validation.md` → *Supervised runs*
  (notably: two modeled refusal texts were wrong and are now the live bytes,
  and a ruleset only honors `--admin` when it grants a bypass actor — the
  harness now mirrors production's admin bypass grant).
- [ ] **Single-account limits** (cause: no second GitHub account / cross-fork):
      review **approve/request-changes** on someone else's PR, **reviewer
      requests**, and cross-fork PRs can't be executed — the self-approval
      *refusals* are covered offline and asserted live.
- [ ] **Still unexercised even by the live suite** (runbook extensions for a
      later supervised pass): `pr_update_branch` (needs a deliberately-behind
      branch), `pr_reopen`, PR-side `pr_edit`, `issue_develop` + the PR/issue →
      worktree dialog end-to-end (on-device), auto-merge arm/disarm,
      `run_rerun`. Driving the GitHub *views* by clicking (PR detail, merge
      dialog) stays a known E2E gap.

The `gh`-backed integration above is otherwise complete for the standalone desktop app.
Deferred:
- [ ] **Cross-fork PRs.** The head picker offers this repo's branches (local ∪ `origin`)
      only; GitHub's `owner:branch` form — a PR from someone's fork — isn't expressible.
      `gh pr create --head owner:branch` supports it; the picker and `PrBranches` would
      need to carry the fork's remotes.
- [ ] **Pagination.** Lists are capped (50 PRs / 50 issues / 30 runs) with no "load
      more", so a busy repo silently shows a window of its work. `gh` paginates with
      `--limit`; the UI needs an explicit control rather than a bigger constant.
- [ ] **Resolve review threads.** A blocked PR can say "every review thread must be
      resolved" and offers no way to resolve one — `gh pr` has no verb for it, so this
      needs the GraphQL `resolveReviewThread` mutation via `gh api graphql`. Pairs with
      the inline-diff-comments item below.
- [ ] **Cache the merge policy per repo.** Opening a PR fires ~6 `gh` calls
      (view + diff + timeline + `merge_info`'s repo-view + REST repo + rules). The
      repo-level and ruleset answers are near-static per repo/base, so a session cache
      would cut half of them. Fine for one developer against a 5000/h limit; worth doing
      before the notifications/poll surface grows. Pairs with the ETag item below.
- [ ] **`gh pr` verbs still unwired:** `revert`, `lock`/`unlock` (and their `gh issue`
      twins: `delete`, `pin`/`unpin`, `transfer`). None are review-flow blockers; add on
      demand.
- [ ] **Native (no-`gh`) sign-in.** An OAuth **device-flow** login (public `client_id`,
      no secret) + **OS-keychain** token storage (the `keyring` crate), so GitHub works
      without `gh` installed. Closes the T2.4 / keyring item below. Needs a registered
      GitHub OAuth App `client_id` (a `FOR-HUMAN.md` item).
- [ ] **GitLab / other hosts.** The `gh`-centric approach is GitHub-only. GitLab would
      need `glab` or a native API layer. Out of scope for now (the remote parser already
      recognizes GitLab hosts).
- [ ] **PR review as a dockable center tab.** Today review/diff/issue/log open as a
      master-detail inside the inline GitHub view (which itself replaces the center +
      right panels while it is open). Making them **center tabs**
      that coexist with terminals needs a new tab kind across the terminals tab system
      (`terminals.svelte.ts` + `TerminalArea.svelte` rendering + serialization) — a
      larger, riskier change deferred as a UX refinement.
- [ ] **WSL repos.** A Windows `gh` can't see a `\\wsl.localhost\…` checkout, so GitHub
      features degrade to "not a GitHub repo" there (same class of gap as the WSL2
      hook-loopback limitation). Would need routing `gh` through `wsl.exe`.
- [ ] **"Clone from GitHub" UI entry.** The backend command + api wrapper exist
      (`github_clone` / `githubClone`, `gh repo clone`), but no UI surface calls them
      yet. Wire a small entry (a repo field + destination dir → clone → `repo_add`),
      e.g. from the Add-project dialog or the GitHub view.
- [ ] **Eager per-worktree PR badges.** Sidebar PR badges are shown for *visited*
      worktrees (context cache), not eagerly for every worktree (that would poll a PR
      per worktree). A batched/GraphQL "my PRs for these branches" query could fill it.
- [ ] **Inline diff comments.** CI ships as an expandable section + a popover on the head
      commit (PR detail) and a per-row icon+popover in the PR list; **line-level review
      comments** on the per-file diff are still deferred.
- [ ] **List hovercards + label editing.** The issue/PR rows show a status icon, labels
      and counts, but not GitHub's **hover preview card** for a linked/cross-referenced
      item (would fetch the referenced issue/PR on hover). Also deferred: **editing labels**
      (add/remove) from the detail — needs a label list + `gh … edit --add/remove-label`.
- [ ] **P2/P3 niceties:** mark-files-as-viewed during review, `#`/`@` autocomplete +
      hover cards, a unified **notifications inbox**, **releases** (list/create), a
      write-only **Actions secrets/variables** setter, and native **conditional-request
      (ETag/304) polling** to make the status layer quota-cheaper (today it re-calls `gh`).
- [ ] **Cross-component (mobile):** surface PR/CI/issue status on the paired phone via
      new `shared` `github/*` JSON-RPC methods served by the embedded bridge (Phase 6).
- [ ] **Svelte component tests** for the GitHub UI (part of the standing component-test
      TODO below); the pure backend logic is unit-tested in `github.rs` (20 tests).

## Integrated developer browser ☐

**Goal:** a complete in-app developer browser to preview/debug the systems agents
build and open the links agents produce — **not** a general-purpose browser. Lives
as a right-side "4th panel" (`architecture/02a` §4.2b). Agent link interception
**on by default**; one central link-policy decision point with an always-working OS
fallback.

**Engine decision:** a frameless `WebviewWindow` **owned by + docked to** the main
window (stable Tauri API), holding the page; the toolbar lives in the panel's DOM
and the window is glued over the panel's content rect. Chosen after two rejected
attempts: a native child webview (Tauri `unstable` multiwebview) **froze the app**
on Windows (`add_child` blocked the main thread), and a plain `<iframe>` was too
limited (blocked by `X-Frame-Options`, no DevTools). The owned window loads any
site + has real DevTools while staying light.

**Done (code-complete, validated by clippy/fmt/tests + svelte-check + vite build):**
`BrowserSettings`/`BrowserLinkPolicy` + `browserPanelWidth` model + Settings →
Browser pane; the `browser_window_*` backend (`browser.rs`) + `BrowserPanel.svelte`
(toolbar + glued window: back/forward/reload/address/open-external/DevTools) + the
right-side panel + status-bar toggle; `open_url`/`open_external` routing (shared
`browser::route_url`) + the `browser:open-url` listener; **agent auto-interception**
(`UXNAN_BROWSER_*` env + `$BROWSER` shim `static/hooks/uxnan-browser.{sh,cmd}` + the
hook-server `/browser` route, gated on `enabled && allow_agents`); **Ctrl/Cmd-
clickable terminal links** (`@xterm/addon-web-links`).

**Done — browser-control MCP (backend, spec `02d` §1.6):** the browser is now
**discoverable** to agents as MCP tools, not just via the `/browser` curl. `mcp.rs`
serves a minimal Streamable-HTTP MCP endpoint at `/mcp` (control tools
`browser_open/navigate/reload/back/forward/status`, same hook-server token);
`mcpinject.rs` writes each launched CLI's native MCP config (Claude/Codex/Gemini/
OpenCode) into its **user-global** config only (never the project dir) referencing
the `UXNAN_MCP_TOKEN` env (token never in a file), merging without clobbering and
cleaning up on exit; Gemini's entry carries `trust: true`. `BrowserSettings.mcp*`
(enabled / injection mode `off|managed|global` / `friction_free` / disabled-agents)
+ `mcp_info` command. **Frictionless** (managed + `friction_free`): app-launched
agents skip the CLI folder-trust prompt — Gemini via `GEMINI_CLI_TRUST_WORKSPACE`
(`commands.rs`), Codex via `codex_trust::ensure_project_trust` seeding
`[projects."<cwd>"].trust_level`. The legacy project-scoped `workspace` mode was
removed. See `docs/browser.md` → *Agent browser MCP*.

Spec synced: `architecture/02a` §4.2b documents the integrated browser, `02d` §1.6
the browser MCP; user guide in `docs/browser.md`.

### Still pending
- [ ] **Browser MCP — add more agents.** The injector is a registry: to support a new
      CLI (e.g. `agy`/Antigravity, Cursor's `cursor-agent`, Grok, amp, Pi), add a row to
      `mcpinject::AGENTS` + a match arm in `config_path` (its config file path) and
      `write_entry`/`json_entry` (its MCP-server shape). Recipe + the per-agent table
      in `docs/browser.md` → *Adding another agent*.
- [ ] **Browser MCP — interaction tools (control-only for now).** The tool surface is
      navigation-only. Page inspection/interaction (`browser_snapshot`,
      `browser_evaluate`, `browser_click`, `browser_type`) needs a JS return-channel
      from the docked `WebviewWindow` (`.eval()` is fire-and-forget) — an injected
      init-script that posts results back, mindful of page CSP. Deferred as a second
      pass (`FOR-DEV:` marker in `mcp.rs`).

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
- [ ] **Embedded-bridge update check.** The standalone bridge already runs a
      background npm update check and reports it (CLI notice + `bridge/status`
      `latestVersion`/`updateAvailable`; see `bridge/src/update-check.ts` and
      `shared` `isNewerVersion`). When embedding the bridge here, make sure the
      **embedded** bridge's `bridge/status` still carries those fields so the
      paired phone keeps showing its "bridge update available" hint, and surface
      the same "bridge is outdated" state in the desktop UI (Settings → Mobile
      connection / About). The desktop app's own installer auto-updates via
      `tauri-plugin-updater`, but that updates the **desktop app**, not the
      pinned Node bridge version it ships — so the bridge's own check still
      matters. Unblocks with the sidecar above.

- [ ] **Provider usage over the bridge (`agent/usageStats`).** The desktop already
      reads AI-provider usage natively (`src-tauri/src/usage.rs`) and the `shared`
      contract (`agent/usageStats` + `ProviderUsage`) exists. For the paired phone,
      the embedded bridge must implement the same reader in TS and serve it — the
      phone can't see the PC's disk directly (dual-reader, same contract; see
      `architecture/02a` §5.8.10). Owed on the bridge (`bridge/FOR-DEV.md`) and the
      mobile UI (`uxnanmobile/FOR-DEV.md`).

### Frontend (Svelte)
- [ ] Settings → Mobile connection: QR pairing dialog, connected-phone indicator,
      trusted-device management (reuses the bridge's `bridge/removeTrustedDevice`).

## Deferred follow-ups (non-blocking) — by area

**Terminal**
- [ ] **OPTIONAL — persistent PTY host, so a session never has to be resumed at
      all. Needs the maintainer's go-ahead before any code is written: it changes
      what uxnan does while it is closed.**

      *The idea.* Today the PTYs die with the app and a restored tab relaunches
      the agent's CLI with its resume flag — the conversation comes back, but the
      process was gone and the TUI has to redraw itself. If instead the PTYs lived
      in a small **host process that outlives the window**, reopening uxnan would
      just re-attach: the agent never stopped, nothing is typed into the shell,
      and it works for a conversation that never happened *and* for whatever else
      was running in a tab (a dev server, a watcher) — none of which the resume
      path can bring back.

      *Why it is a maintainer call, not a technical one.* It trades uxnan's
      current posture — close it and nothing of ours is left running — for
      continuity. The agent CLIs stay resident (idle, but resident) after quit.
      Decide first: is that acceptable at all; on by default or opt-in; and what
      ends the host's life (last session closed / an idle timeout / a "stop
      everything on quit" switch). Everything below is wasted work until that is
      answered.

      *The route, if it is approved.* The groundwork is already in place, which is
      why this is worth writing down rather than forgetting: `PtyManager::create`
      (`src-tauri/src/pty.rs`) is **already create-or-attach** — a second create
      for a live id keeps the running session — and every terminal tab already
      persists a **stable `sid`** across restarts (`terminals.svelte.ts`, today
      used to key its scrollback snapshot). Those are the two hard parts of the
      idea already solved. What is missing:
      - a host process. Reuse the pattern that already exists: the binary
        branches on a flag in `main.rs` before Tauri builds a window (see
        `--automation-run`), so `--pty-host` needs no second executable;
      - a local transport with a token — named pipe on Windows, unix socket
        elsewhere — plus a pid/health file, a **protocol version**, and
        stale-host detection so a host left behind by a previous *version* is
        retired instead of talked to;
      - **output history in the host.** `pty.rs` deliberately keeps none today
        (the frontend's xterm is the single source of scrollback — see the module
        header, which explains why replaying raw PTY bytes was unsound). A host
        must hold a bounded per-session ring and hand it over on attach, with an
        aggregate memory cap and a documented drop policy;
      - `pty_create` keyed on the tab's `sid` instead of its per-run tab id, so
        "create or attach" survives a restart rather than only a webview reload;
      - orphan handling: sessions whose tab no longer exists, and a host with no
        client for a long time.

      *What must NOT change.* The frontend contract — the same Tauri commands and
      the same `pty:output:<id>` / `pty:exit:<id>` events — so the host stays
      behind `pty.rs` and the UI needs no rewrite. And the current resume path
      stays exactly as it is: it is the fallback for every case where the host
      isn't there (machine rebooted, app updated, host crashed), so it is never
      dead code.
- [ ] Keyboard protocol — extend the Kitty/CSI-u surface beyond the current
      encoder: functional/navigation keys as CSI-u (arrows, F-keys, Home/End,
      keypad — they fall through to xterm's legacy encoding today), the
      alternate-keys (4) and associated-text (16) flags, and super/hyper/meta
      modifiers. Needs validation against a real Kitty-protocol TUI. The base
      protocol (negotiation + disambiguate / event-types / all-keys) is
      implemented in `src/lib/terminal/keyboardProtocol.ts`.
- [ ] **Workspace lifecycle — implemented, pending on-device validation.** The
      live-space indicator (terminal count on cards/rows, moon variant when
      asleep), **Sleep workspace** (row menu + `Mod+Shift+Z`; keeps every
      tab/split, kills PTYs, disposes xterms, snapshots each parsed screen via
      `@xterm/addon-serialize` into the `terminal-buffers.json` sidecar),
      wake-on-activation with scrollback replay, and the boot re-bind/reconcile
      pass (restored workspace selects its worktree; dead workspace keys
      dropped; canonical re-keying via `src/lib/pathid.ts`) are all
      code-complete with green gates. Semantics deliberately changed from the
      original idea: sleep must NOT close tabs — the space survives; only its
      processes stop. (Raw-byte ring replay remains off the table; the replay
      is the PARSED screen from SerializeAddon, which is sound.) **Still owed:**
      the maintainer's on-device QA pass (sleep/wake round-trip, boot re-bind,
      indicator/i18n review — UI changes need visual approval before commit);
      remove this item when validated. Follow-ups (non-blocking): a setting to
      opt OUT of the TUI auto-relaunch (today a live-at-close agent session
      always auto-resumes; an exited one is pre-typed only), a sleep action in
      the worktree palette, and a card-level sleep for a whole project.
- [ ] **Agent session resume — on-device validation + parity.** Session capture
      (hook session id/file → `agent_cache.session` + the tab's persisted
      `agentSession`), the resume registry (claude / codex / opencode / grok /
      antigravity / pi; `src/lib/agentResume.ts`) and ids **named at launch** for
      the CLIs that accept one (`src/lib/agentSessionId.ts`) are code-complete
      with green gates, and the three faults that made restore unreliable are
      fixed (legacy reporter mislabelling every Codex session as `"agent"`,
      Antigravity's `conversationId` spelling dropped, and a `live` flag that
      neither persisted nor survived the first post-restore detection tick).
      **Still owed:** an end-to-end on-device pass per agent (run → quit app →
      relaunch → the conversation reopens; same via sleep→wake), explicitly
      including **two tabs of the same agent at once** — the case that used to
      restore only the focused one — and a tab opened but never written to (it
      should come back under a fresh pinned id). Bridge/mobile parity rides
      Phase 6 (the backend capture half is reusable as-is). **Not follow-ups:**
      Gemini CLI (deprecated — see `AGENTS.md`) and Zero both stay unresumable by
      design, not for want of checking — Zero resumes only in its headless
      one-shot mode (`zero exec --resume [id]`), and the interactive TUI a
      terminal tab runs rejects the flag.
- [ ] **Resume fallback that reads the CLI's own session store (Codex,
      OpenCode).** Neither CLI accepts a caller-chosen session id, so a tab whose
      hook never fired (reporter off, or the agent started outside uxnan) still
      has nothing to restore. Both keep their sessions on disk / behind their own
      command — `~/.codex/sessions/**/rollout-*.jsonl` and `opencode session
      list` — so the most recent session for that tab's working directory can be
      found and offered when no id was captured. Deferred: everything a reported
      bug depends on is fixed without it, and it wants a Rust reader plus its own
      hostile-input handling (same posture as the Zero session reader).
- [ ] **Windows junction / Redirection-Guard — structural fix (alternative to the
      shipped detection).** A command that traverses an "untrusted" reparse point
      (npm-workspace junctions in `node_modules`, OneDrive Files On-Demand
      placeholders) can fail *inside* a terminal with `os error 448` / `errno -4094`
      while it works in a standalone shell, because the app's child processes
      inherit Windows' redirection-trust enforcement. The **shipped** fix DETECTS
      this and GUIDES the user to move the repo to a local path
      (`src/lib/terminal/windowsJunctionGuard.ts` + `docs/windows-junctions.md`),
      preserving Uxnan's posture — the shell is never sandboxed and the OS
      mitigation is never relaxed. The **structural alternative** — spawn PTYs from
      a **separate process off the WebView2 host** so terminal children don't
      inherit the enforcement — would let junction traversal work without moving the
      repo, but it's a large, cross-platform change (Windows/macOS/Linux) needing
      validation on OSes not available here, so it stays a documented alternative.
      A `2C` diagnostic (read `GetProcessMitigationPolicy` for the host + a child
      shell, confirm the enforcement source is inherited-and-clearable) should gate
      any attempt. Marker: `src-tauri/src/pty.rs`.

**Agents** — env vars per agent, shell-aware quoting, the configurable Windows
launch shell (cmd by default), auto-launch on worktree create, and multi-agent
orchestration — **Broadcast** (fan-out + backpressure) and the **run engine** (DAG
of steps, context passing, headless with verified completion, HITL gates, retry,
durable persistence, orchestration MCP tools) — are **done** (see `CHANGELOG.md` +
`architecture/02d` §3). Remaining orchestration follow-ups:
- [ ] **Headless large context via stdin.** The headless prompt is passed as a CLI
      argument and capped (~28 KB) to stay under the OS argv limit
      (`agentrun.rs::MAX_PROMPT_BYTES`); a chained, context-heavy prompt is clipped.
      Add a per-agent stdin variant for large prompts (pattern in
      `aicommit::codex_models_inner`).
- [ ] **Headless in-distro WSL routing.** A headless step in a `\\wsl$` worktree runs
      the Windows-side CLI against the 9P share (functional but slow); route it
      through `wsl.exe -d <distro>` with the Linux-side CLI (see `wsl.rs` +
      `git.rs`'s WSL path). `FOR-DEV:` marker in `agentrun.rs`.
- [ ] **Per-agent PTY submit strategy.** `pty_paste_submit` (bracketed paste + a
      delayed Enter, 150 ms for multi-line) covers standard TUIs, but a Claude
      Code-family agent with a *long* post-paste Enter guard may still leave a
      multi-line prompt unsent when driven interactively. Add a per-agent submit
      override (delay / key) if one is found. `FOR-DEV:` marker in `commands.rs`
      (`pty_paste_submit`). Headless avoids typing entirely, so it's the workaround.
- [ ] **Remediation + evaluator-optimizer.** `onFailure: "remediate:<stepId>"` (run a
      fix step, then retry) and a `kind: "eval"` step (generate → evaluate → loop) —
      the DAG/model supports them; the scheduler + UI don't yet.
- [ ] **`orchestration_raise_gate` MCP tool / agent-created steps.** Let a coordinator
      agent request a human gate or spawn worker steps over the injected MCP channel
      (the report tools exist; step-creation from an agent doesn't).
- [ ] **Background (Tokio) run engine.** The engine advances while the app is open;
      runs are durable and re-attach on load, but a closed app doesn't progress a
      run. A backend driver would let runs advance headless. (LangGraph-style:
      durable data, re-attachable driver — the data half is done.)
- [ ] **Orchestration lineage in the *main* sidebar.** The coordinator→workers
      relation and a run's step graph are surfaced in the console today (spec `02d`
      §3.8 / §3.1). Moving the nested lineage into the left project tree is a larger
      sidebar-tree refactor, deferred.
- [ ] Persist the per-worktree launch agent onto `WorktreeData.agentId` (today
      the choice drives the one-shot launch but isn't recorded on the worktree).

**Integrated developer browser**
- [ ] **Antigravity (`agy`) as a browser-MCP agent — blocked on both sides.** Its
      remote MCP transport is **SSE with only a `serverUrl`** (no `headers` field,
      per its own bundled `agy-customizations` guide), so there is nowhere to put
      the bearer token that every other injected config carries; and uxnan's
      endpoint is **Streamable HTTP**, whose `GET /mcp` deliberately answers 405
      (`mcp.rs`). Either `agy` grows header support (then it is one row in
      `mcpinject::AGENTS` + a `config_path`/`write_entry` arm, writing
      `~/.gemini/config/mcp_config.json`), or we publish a small **stdio** MCP
      proxy it can launch with `command` + `env` — which keeps the token out of the
      file but adds a binary to build, sign and ship for one agent. Do **not**
      "solve" it by putting the token in the `serverUrl`: that breaks the module's
      documented posture and still leaves the transport mismatch.

**Providers (usage statistics)**
- [ ] **Antigravity (`agy`) as a usage provider — deferred on the token, not on the
      data.** Researched against a real install; nothing implemented. The data and
      the API are within reach: `agy` talks to Google's Code Assist backend (its own
      logs under `~/.gemini/antigravity-cli/log/` show
      `daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist` /
      `:fetchAvailableModels` plus a `quota_manager.go` refresh loop), and the Gemini
      reader in `usage.rs` already calls the sibling `…/v1internal:retrieveUserQuota`
      and parses its `buckets[]` — that half is reusable as-is. Upstream documents
      `/usage`, `/quota` and `/credits`, but they are **interactive-only** slash
      commands (`agy --help` exposes no usage subcommand), so shelling out is not an
      option. **The blocker is the credential:** unlike every wired provider, `agy`
      keeps its OAuth token in the **OS keyring** (Windows Credential Manager, the
      macOS Keychain item "Antigravity Safe Storage", Linux Secret Service) — the
      log line `keyring.go: keyringAuth: loaded token, expiry=…` with neither
      `~/.gemini/antigravity-cli/credentials.enc` nor `…/antigravity-oauth-token`
      on disk. The plain-file token
      (`{auth_method, token:{access_token, refresh_token, expiry}}`) is written
      **only** when `agy` detects a container/headless environment, so a file-only
      reader would report `authRequired` on virtually every desktop. **What unblocks
      it:** a decision to read the OS keyring — a new `keyring` crate plus an
      undocumented, `agy`-version-fragile entry name (macOS may prompt), stretching
      the documented "only the token the CLI already left on disk" posture. **Do not**
      fall back to `~/.gemini/oauth_creds.json` (the Gemini CLI's token): Antigravity
      bills a **separate** quota pool + AI credits, so those numbers would be Gemini's
      wearing Antigravity's name. Sites when picked up: `src-tauri/src/usage.rs`
      (`UsageProvider`, `read_one`, `is_present`), `src/lib/usageCatalog.ts`,
      `shared/src/models/usage.ts` (contract → bridge + mobile), `docs/providers.md`.
- [ ] **Retire the Gemini CLI reader once nobody is on it.** Gemini CLI is
      discontinued upstream, so it is hidden from the "Add a provider" picker
      (`deprecated: true` in `src/lib/usageCatalog.ts`) while its reader stays wired
      for anyone who already activated it. When it is time to drop it for good, the
      removal spans `usage.rs`, the `UsageProvider` union in `shared/`, the bridge
      reader and the mobile side — a contract change, not a catalog edit.

**File tree / mixed tabs**
- [ ] Tree virtualization (TanStack Virtual) for very large folders.
- [ ] Multi-worktree external-change watching (the watcher follows the active
      worktree only).
- [ ] Tab/region reorder + drag for the mixed `terminal|file|commit` tabs.

**Theming**
- [ ] Import font *files* (.ttf/.otf/.woff2) via `@font-face` (today: installed
      family name only).
- [ ] Live ligature toggle (currently applies on the next terminal).
- [ ] Drop the legacy `theme` field (superseded by `active_theme_id`; kept for
      back-compat).

**Polish / quality**
- [ ] **Agent sign-in status as the list's second line.** In Settings → Agents,
      the unified list shows each agent's `command` as the second (muted) line.
      Replace it (where available) with the agent's real session/sign-in status —
      e.g. "Signed in as <user> · <plan>" / "Not signed in" — like the providers
      list in the reference UI. Needs the sanitized per-agent `auth/status` (it
      lives on the bridge side today) surfaced to the desktop settings; never show
      tokens. Where status is unknown, fall back to the command.
- [ ] **Settings list-body polish (optional follow-up).** The section-shell
      refactor is done — all nine sections use `SettingsSection` (consistent
      header), settings-style sections use the `panel.settingsBody` band of
      `SettingsRow`s, every on/off is a `Switch`, and list/editor-heavy sections
      use the `bare` header with softened borders. Optional next polish: tighten
      the inner list sub-content (agents catalog cards, terminal profile editors,
      shortcut keycaps) further into the row/density recipes. Visual, review on
      device.
- [ ] Sidebar project-tree virtualization (worktree lists already virtualized).
- [ ] Stronghold/keyring for any secret (never plaintext JSON) — needed with Phase 6.
- [ ] **Grow the component and E2E layers.** Both harnesses exist and work; what
      they cover is still thin — see *Test pyramid — follow-ups* below.

## Test pyramid — follow-ups ☐

**The harness is built and all five layers have real tests.** What is left is
coverage and confidence, not machinery. `tests/quality-matrix.json` is the
authoritative list of gaps — it is checked against the repo, so it cannot quietly
go stale; these are the ones worth calling out.

- [ ] **Component tests for the flows that carry the most risk**: `TerminalArea`
      (splits, moving a tab without remounting its xterm), Settings (persistence
      + migration through the UI), the GitHub panels, and the orchestration
      builder. Three components have tests today; the matrix lists the rest as
      `planned` with the reason.
- [ ] **E2E for the actions a user takes, not just the states they arrive in.**
      The eight journeys seed a state and assert it end to end; what none of them
      does is *drive* the UI — create a worktree from the dialog, close a
      terminal, wake a sleeping workspace, change a setting. Those need stable
      handles on the controls, which is the next piece of work.
- [ ] **Wake fidelity.** A sleeping workspace is proven to spawn no shells; that
      the replayed scrollback matches what was captured is still only checked by
      hand.
- [ ] **The fixture agent's own reporter does not reach the hook server.** The
      journey covers the chain by posting a report itself, which is what a
      reporter does and what uxnan owns. Why the fixture's own POST never lands is
      unresolved and worth knowing, since it is the same path a real CLI takes.
- [ ] **Feed the legacy profiles to a booting app.** `tests/fixtures/appdata.mjs`
      has the old shapes (missing `isGit`, no terminal profiles, tabs without a
      `kind`, a truncated file) and nothing consumes them yet — so the migration
      path is covered in Rust but never end to end.
- [ ] **E2E on a hosted runner: measured, unresolved, and no longer on a
      schedule.** `e2e-desktop.yml` never passed on `windows-latest` — four
      nightlies plus three diagnostic dispatches (2026-08-01 … 08-04), all 9
      specs dying in `session not created: DevToolsActivePort file doesn't exist`
      before any assertion, while the same suite is green locally. The cron is
      **removed** (dispatch-only): a permanently red nightly teaches people to
      ignore CI mail. **E2E is a local layer today**, and the required gate stays
      out of reach until a runner can attach at all.

      **The cause, measured** (`npm run test:e2e:diagnose`, both sides, same
      release binary): on the runner the browser process comes up with **no
      `--remote-debugging-port`** and none of msedgedriver's other switches, so
      nothing was ever listening. `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` is
      dropped there and honoured here. The env-var channel itself is fine — the
      webview does pick up msedgedriver's `--user-data-dir`
      (`C:\Windows\SystemTemp\scoped_dir…`) — so it is the additional
      *arguments* specifically.

      | | local (green) | runner (red) |
      |---|---|---|
      | remote-debugging endpoint | **611 ms** | never, at 90 s |
      | session, capabilities as sent | **956 ms** | refused at 60 s |
      | session + `webviewOptions.userDataFolder` | 748 ms | refused at 60 s |
      | webview processes under automation | — | **6** (browser, gpu, renderer, …) |
      | of those carrying `--remote-debugging-port` | — | **0** |

      Ruled out, with the evidence, so none of it is re-investigated:

      - **The driver pairing.** `setup-driver.mjs` fetches the matching driver on
        the runner as it does locally, and a mismatch says so explicitly.
      - **The app, and the graphics environment.** `resource-benchmarks.yml` is
        green on the same image, and the diagnosis sees the webview come up
        under automation too — 6 processes, renderer and GPU included.
      - **The runtime version.** With the `edgeupdate` service started (it ships
        `Stopped`, which is why the first attempt was a silent no-op) the
        bootstrapper does work: the runner ran 151.0.4129.59, byte for byte what
        the green machine runs, and failed identically.
      - **`webviewOptions.userDataFolder`.** No difference — and locally
        `DevToolsActivePort` is absent from that folder on a *passing* run, so it
        was never the mechanism.

      One lead left, if CI E2E is ever worth another attempt: **a machine policy
      stripping the switch.** `HKLM\SOFTWARE\Policies\Microsoft\{Edge,EdgeWebView,
      EdgeUpdate}` and `…\Windows\WebView2` are **empty** on the machine where the
      suite passes; the workflow now dumps all four, so one dispatch answers it.
      That attempt costs a push-per-dispatch CI cycle (~35 min, dominated by the
      release build).

      **DECIDED, 2026-08-04 — the app will NOT carry the switch itself.** Passing
      `--remote-debugging-port` from inside the app (wry's
      `additional_browser_args` / Tauri's `additionalBrowserArgs`, gated on
      `TAURI_WEBVIEW_AUTOMATION`) would make the runner work, and it is rejected:
      it puts test-only behaviour in the binary users install, and a shipped app
      that can be told to open a debugging port is a different product than the
      one that cannot. Do not re-propose it — losing CI E2E is the accepted cost.
- [ ] **Multi-window journeys are unproven** with this driver — the pet overlay
      and the browser panel are both separate windows. Find out before promising
      coverage for either.
- [ ] **macOS and Linux E2E.** `tauri-driver` supports Linux (WebKitWebDriver)
      and does **not** support macOS. Neither has been run here, and the harness
      does not claim a platform nobody has executed.
- [ ] **Accessibility assertions.** The component layer queries by role and label,
      which nudges in the right direction, but nothing yet asserts an accessible
      name exists where one is required.

## Platform validation

**The record is the platform support matrix** — `tests/platform-support.json`
(machine-readable: level + date + sha + hardware + tester per platform×feature,
verified by `tests/platform-support.test.mjs` in the required suite) rendered in
`docs/platform-support.md`, with per-platform release checklists generated from
it (`node scripts/platform-support.mjs checklist`) and a release gate
(`… gate`, wired into `release-desktop.yml`) that refuses to build installers
when an announced state exceeds the evidence. Announced today: **Windows
`smoke`** (several features `validated`), **macOS aarch64/x64 and Linux
`builds`**. Everything below advances a cell in that matrix; record the run
(date, sha, hardware, tester) when it happens.

- [ ] **macOS** — an **experimental, unsigned** build now ships (two ad-hoc-signed
      DMGs, Intel + Apple Silicon; `docs/install-macos.md`), CI compiles + tests it on
      an Apple Silicon runner, and the Finder/Dock `PATH` gap is fixed (`path_env.rs`).
      Still **not validated on real hardware** by the maintainer — needs a smoke test
      of launch, agent/`gh`/editor detection, notifications, keep-awake and a
      self-update on both architectures (the x86_64 binary has never executed
      anywhere). Full checklist: `matrix → checklists.macos-aarch64 / macos-x64`.
- [ ] **Linux** — full suites green on `ubuntu-latest` and installers ship, but
      no human has installed/launched any of them; the systemd user timer, keep-awake,
      the pet overlay under a compositor, and the first-ever Linux E2E run
      (`tauri-driver` supports it) are all unexecuted. Full checklist:
      `matrix → checklists.linux-x64`.
- [ ] **Windows to `validated`** — what blocks the announced level from rising:
      two recorded install→upgrade→uninstall cycles (config preserved, no
      leftovers — cannot run on the dev machine while its live instance is the
      thing being tested), the wake-fidelity check, R07/R08/R10, and one recorded
      hostile-update run against a staging channel. Full checklist:
      `matrix → checklists.windows-x64`.
- [ ] **keep-awake** is implemented for macOS/Linux and its state machine +
      spawn/kill path are now unit-tested (each CI runner toggles its own real
      inhibitor once), but **whether the machine actually stays awake** is
      untested there (`power.rs`); Windows works.
- [ ] **Update UI (pinned sonner toast + in-Settings download/install) — visual +
      functional validation pending.** The former top banner is now a pinned
      sonner toast (`UpdateToast.svelte` + `updateToast.svelte.ts`) and the
      download/install actions were surfaced inline in **Settings → Updates**.
      `svelte-check` + Vitest pass, but the toast's on-screen appearance and the
      end-to-end download → install flow haven't been exercised in a running build
      yet. The repo is now **public** and updates flow (the maintainer has verified
      stable + nightly on each release), so this is no longer blocked — validate the
      toast look/feel and the Settings actions in the next update.

## CI/CD — release

- ✅ **Verify** — `.github/workflows/ci-desktop.yml` runs svelte-check + `npm test`
  (Vitest) + vite build + cargo fmt/clippy/test. CI covers `{ubuntu, windows,
  macos-14}` (via `verify-desktop.yml`'s `os-list` input; one Apple Silicon leg —
  Intel runners are being retired and the code is arch-identical); the release gate
  keeps the default `{ubuntu, windows}`. 514 Rust + 882 Vitest tests (both
  projects: pure logic and components). E2E has its own **dispatch-only** Windows
  workflow (`e2e-desktop.yml`), outside the required gate — and it does not pass
  on a hosted runner at all: E2E is a local layer, for the measured reason in the
  open item above.
- ✅ **`release-desktop.yml`** — `tauri-action` bundles on a `desktop-*-v*` tag →
  draft GitHub Release, **and signs the updater artifacts** when the signing secrets
  are set. The build now also depends on the **platform-support gate**
  (`node scripts/platform-support.mjs gate`): a release whose announced platform
  state exceeds the matrix's evidence fails before any installer is built. Builds Windows + Linux + **experimental unsigned macOS** (two ad-hoc-signed
  DMGs, both built on Apple Silicon `macos-14` with the Intel `x86_64` DMG
  **cross-compiled**, `fail-fast: false`). Windows and macOS ship without OS
  code-signing (SmartScreen / Gatekeeper warnings).
- ✅ **Auto-updater** — `tauri-plugin-updater` wired end-to-end in the app
  (`src-tauri/src/updater.rs` + Settings → Updates with inline download/install +
  a pinned sonner toast `UpdateToast.svelte`; stable/nightly channels via GitHub's
  pre-release flag; background download + idle-guarded install). The rolling per-channel `latest.json` is published by
  `release-desktop-manifest.yml`. The signing keypair is configured and
  `desktop-v0.0.1-alpha.20260627` shipped signed installers + a `latest.json`
  on the `desktop-updater-stable` channel. See [`docs/updates.md`](docs/updates.md).
- [ ] **Manifest workflow needs `contents: write` for first-time channel creation** —
      `release-desktop-manifest.yml`'s `gh release create` of a channel's rolling
      release 403'd because the repo's `default_workflow_permissions` is `read`
      (the workflow's `permissions: contents: write` was not honored for the
      create). Worked around by publishing `desktop-updater-stable` manually;
      subsequent uploads to an existing channel succeed. To fully automate, set
      Settings → Actions → Workflow permissions to **Read and write**
      (`gh api -X PUT repos/luisgamas/uxnan/actions/permissions/workflow -f default_workflow_permissions=write`).
- [ ] **Code-signing (OS)** — Windows Authenticode + macOS Developer ID +
      notarization (human-provided **paid** certs — see `FOR-HUMAN.md`). Independent
      of the (free) updater signature above; without them Windows ships unsigned
      (SmartScreen) and macOS ships the **experimental ad-hoc** build (Gatekeeper
      "unidentified developer", cleared per `docs/install-macos.md`). Apple Developer
      ID + notarization is the optional path to a warning-free macOS install.

## Cross-cutting / standing rules

- [ ] Tests for every public function (AGENTS.md, ALPHA) — Rust done; pure-logic
      and **component** layers both covered by Vitest. What is thin is *which*
      components; see the quality matrix.
- [ ] Lint/format gate before "done": `cargo clippy` + `cargo fmt` + `npm run check`
      + `npm test`.
- [ ] Tauri capabilities: expose only the commands a window needs; no arbitrary
      FS/network from the frontend (spec §4.2). **Not yet audited.**
