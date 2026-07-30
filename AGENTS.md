# Uxnan — Agent Guidelines

> This document is the single source of truth for any AI agent working on this project.
> It applies to every component in the monorepo: `uxnanmobile/`, `uxnandesktop/`, `bridge/`, `relay/`, `shared/`.

## Project status

**ALPHA — MVP in progress.** Architecture documentation is complete and the mobile MVP runs end-to-end with a real agent. State by component (details in each `CHANGELOG.md`; pending work in each `FOR-DEV.md`):
- `shared/` — **implemented**: JSON-RPC + E2EE contracts and validators.
- `relay/` — **implemented**: E2EE envelope relay by `sessionId`, rate limiting, peer-close, push endpoints (gated on Firebase/APNs creds).
- `bridge/` — **implemented**: E2EE transport (relay + LAN), **OpenCode, Claude Code, Codex, pi, Gemini, Antigravity, Zero and Grok wired as real agents** (each drives its official local CLI — over stdio, or a long-lived loopback `opencode serve` HTTP/SSE process for OpenCode, a `codex app-server` for Codex, and `zero acp` / `grok agent stdio` (Agent Client Protocol, JSON-RPC over stdio) for Zero and Grok with **real interactive approvals** via ACP `session/request_permission` — no provider API/SDK/keys; **OpenCode now has real per-action approvals** via `permission.asked`; **Antigravity** drives Google's `agy` — the successor to the deprecated Gemini CLI, its models the Gemini family — one-shot per turn with a client-owned `--conversation` UUID (create + resume) and `--add-dir <cwd>`, autonomous `--dangerously-skip-permissions` / read-only `--mode plan` postures, models via `agy models`), per-thread agent/model/project selection **plus per-project agent/model pins** (`projectAgents` from config), **full thread lifecycle** (`thread/rename|archive|unarchive|delete`), **account-aware structured model discovery** (`AgentModel[]`: Codex via `codex app-server` `model/list`, Claude aliases "(latest)" + config-pinned versions incl. Fable 5 + resolved-version `model_resolved` event), **per-turn token usage** on `turn/completed`, **image attachments on `turn/send`** (materialized into the agent's own working directory and referenced by relative path, since every CLI can open a file but none takes inline base64 headlessly — with native delivery for an adapter whose protocol carries images, i.e. Zero's ACP image block), a **per-thread message queue** (a `turn/send` arriving with a turn in flight is stored as a `queued` turn and drains on completion instead of clobbering the running one — which is also what enforces the one-turn-per-thread the one-shot CLIs require; run options frozen at queue time, the queue held after a stop/failure until `queue/resume`/`queue/clear`, `turn/cancel` on a queued turn marking it `cancelled`, capped at 10, orphans closed at startup; mid-turn *steering* stays a per-agent follow-up since the one-shot CLIs have no input channel while they run), **per-model run-option knobs** (reasoning effort discovered per model — Codex via `model/list` `supportedReasoningEfforts`, Claude via its `--effort` set — advertised on `agent/models` and applied to each CLI), **directory browsing** (`workspace/browseDirs`), Git + workspace + **checkpoints with true worktree restore + retention pruning**, conversation engine, **sanitized per-agent `auth/status`** (never tokens), trusted-device management (`bridge/removeTrustedDevice`) and a real `bridge/status.relayConnected`, push (gated, **persisted across restarts + multi-device**), resilient relay reconnection. No further agent is planned right now; remaining MVP follow-ups (e.g. packaging, fast-mode/context knobs if a CLI exposes them) are tracked in `bridge/FOR-DEV.md`.
- `uxnanmobile/` — **MVP wired**: pairing/E2EE, auto-reconnect, **live streaming conversations that survive navigation** (per-thread in-memory buffers + `turn/list` re-sync) with a per-thread activity indicator, **image attachments** (picked from the camera/gallery, riding inside the composer pill before sending and above the bubble once sent, tap to open full size), a **message queue** for follow-ups sent while the agent works (a floating "Queue message" action that shares one slot with jump-to-latest and the turn-context shelf — one at a time, and the pill's own Send/Stop and Enter-inserts-a-newline are untouched; queued messages are ghost bubbles with a corner cancel and their place in line, settling into the normal bubble when the queue reaches them, a cancelled one keeping its bubble with a warning-toned note, plus a *Send them / Discard* banner when the bridge holds the queue), **structured model picker** (readable names, default badge, alias resolved-version), **always-visible context-usage indicator** (% when the model window is known, token count otherwise; 0 baseline for usage-reporting agents), **data-driven per-model run-option knobs** (reasoning effort, rendered from `agent/models`), **per-agent sign-in status** (`auth/status`: conversation banner + threads-list red dot + new-conversation "Check sign-in", auto-refreshed on resume), per-thread actions (rename/delete/copy id, auto-title from id), **Remove device** (unpair), capability-aware controls (the **Antigravity** agent is offered; the deprecated **Gemini CLI** is hidden from the picker via a one-line client-side filter, its wiring kept for easy re-enable), **folder browser** for new conversations, **relay-vs-direct transport indicator**, notification deep-link, Git, per-PC threads with **truthful, connection-targeted multi-PC status** (all live actions target the PC we actually hold a channel to), FCM push registration (gated).
- `uxnandesktop/` — **ALPHA-functional (standalone)**: Tauri 2 + Rust + Svelte 5 ADE. **Phases 0–5 + cross-cutting (S) complete.** Three-panel resizable shell with atomic JSON persistence (now with 5 rotating backups + sequential schema migrations), PTY terminals (`portable-pty`, xterm WebGL renderer + DOM fallback, ligatures via the WebGL character joiner) with tabs, nested splits + visible split buttons that never remount on split, **drag-to-reorder + move tabs across regions (live xterm instances are re-parented on a move — never recreated or replayed), `Ctrl+Tab` MRU cycling, and the Kitty/CSI-u keyboard protocol**, git worktrees with per-worktree terminal workspaces + **worktree creation from a new branch (with an auto-name generator) or any existing local/remote branch, plus an optional custom location** + an in-app directory picker (now **live-refreshing** — a manual refresh button + a `browse:changed` filesystem watch, shared with the worktree-location browser) + a Ctrl/Cmd+P worktree palette + **sidebar ordering** (independent sort for the project cards and the worktree rows — manual **drag-to-reorder** / name / recent / **agent-attention** — with **pinned** projects/worktrees floated to the top; a debounce "settle" keeps the drifting modes from jumping) + an optional **group-by-status** view (every worktree flattened into collapsible **agent-attention lanes** — needs-you / done / working / idle) + a configurable **profile card pinned to the sidebar footer** (avatar/name/description — now the entry point to Settings, replacing the old sidebar nav buttons), git status/diff/stage/commit/push/pull **plus a read-only "check remote" fetch** surfaced through a **unified multimodal file viewer** (one center tab per file with **Edit / Preview / Changes** modes — CodeMirror editor + change gutter, **image & Markdown preview**, and the working diff: unified + side-by-side, **hunk-level staging**, **visual image diffs** — so opening a file and reviewing its diff share one tab and are read from git once) and a 3s Tokio status watcher on the active worktree **plus a 15s all-worktree status sweep** (so a card reflects an agent that is working from another folder — forced immediately by an agent state change, the window regaining focus, or our own git actions, with PR badges following at up to 2 non-active worktrees per GitHub poll), **worktree-only removal by default with opt-in local/remote branch deletion (the squash-merge safety net preserved)**, **WSL repos routed through `wsl.exe`**, and **opt-in AI commit-message generation** (pick one of the agents wired for it — a **curated subset** of the headless set, since an agent also has to answer a model list: **Claude Code, Codex, OpenCode, Grok and Antigravity**, the discontinued Gemini CLI having been dropped from the picker — plus a model; the local CLI drafts the message from the staged diff). **Agent monitoring (Phase 4)** — activity inference + native idle notifications + per-agent sidebar rows + process-tree detection, the **Layer 1 local HTTP hook server** (`axum`: precise `working/blocked/waiting/done`, token-guarded, env-injected `UXNAN_HOOK_URL`/`_TOKEN`/`_AGENT_ID`/`_ENDPOINT_FILE`, persistent cache TTL 7d) with **auto-installed, shell-robust reporters for the five main agents — Claude Code, Codex, Gemini CLI, OpenCode and Pi** (exec-form Node relay for Claude/Gemini, `curl` hook + reproduced `trusted_hash` for Codex, in-process plugin/extension for OpenCode/Pi; an endpoint file survives app restarts; per-event merges preserve user hooks), **Layer 2** terminal-title (OSC, path/word-boundary-hardened) inference, colored status dots, unread/done badges, custom agent logos, per-worktree agent override, a **left-panel "agent view"** (each agent a two-line row with its **conversation title** + preview + status, surfaced from the hook `prompt`/`tool`/`summary`; collapsed = a status-ringed logo strip; **Zero** covered via a native reader of its on-disk session `metadata.json`), and **multi-agent orchestration** (a two-tab console: **Broadcast** — explicit recipient selection (tick individuals / whole types / all), backpressured with robust paste+submit delivery and a busy-agent hold cap — and a **run engine** (**Runs**): a durable DAG of steps with context passing (`{{steps.s1.output}}`), parallel/fan-in dependencies, **headless** steps (print-mode, completion verified by exit code), **HITL approval gates**, per-step **retry**, restart-surviving persistence + re-attach, orchestration **MCP tools** for structured agent reports, a **contextual variable picker** (per-field previews, insert at cursor), **searchable** agent/model/worktree pickers, and an **Examples** menu of ready-made runs; spec `02d` §3). **Phase 5 polish** — hunk staging, side-by-side diffs, virtualized lists (`@tanstack/svelte-virtual`), opt-in keep-awake (Windows), and a **full file-tree context menu** (per-entry create / rename / duplicate / new folder, copy path + relative path, open-in-terminal, add-as-project, find-in-folder, reveal; **delete → OS trash** via the `trash` crate behind the shared destructive confirm; open editor tabs follow a rename / close on a delete), **project-wide file-tree search** (recursive backend `fs_search_files` via ripgrep's `ignore` walker, gitignore-aware, matches shown **as a tree**, with a "…" overflow menu holding reveal-in-file-manager + a show-hidden-files toggle) and **drag a file-tree row onto a terminal to insert its path** (pointer-based since Tauri suppresses HTML5 dnd in the webview; focus follows to the terminal). **Workspace session lifecycle** — the restored session **re-binds to its project at boot** (the last-active workspace selects its worktree through the same path as a sidebar click, so git/watchers/GitHub/agent targeting follow with zero clicks; stale workspace keys for deleted worktrees are purged, path spellings canonicalized via a shared `pathid` helper; only the active workspace spawns at boot), workspaces **sleep/wake** (row menu + `Mod+Shift+Z`: processes stopped and xterm memory freed while tabs/splits/titles stay; parsed-screen snapshots — `@xterm/addon-serialize`, never raw bytes — persist in an atomic `terminal-buffers.json` sidecar so **scrollback survives restarts**; wake-on-activation replays them; a working agent requires an explicit confirm; live-space terminal-count indicators with a moon variant on cards/rows), and **agent CLI sessions auto-resume**: the hook server captures each provider's session id (sanitized as hostile input, TTL-cached, persisted on the owning tab) and uxnan also **names the session itself at launch** for the CLIs that accept a caller-chosen id (`claude`/`grok`/`pi --session-id`, `agy --conversation`; opt-out `pinAgentSessions`), so a tab is resumable before any hook fires — a conversation you opened and never used comes back too, under a freshly minted id, since claiming the same one twice is exactly what those CLIs reject (`--session-id` and `--resume` are complements). On restart/wake a session whose TUI was alive at close **relaunches itself** (`claude --resume` / `codex resume` / `opencode --session` / `grok --resume` / `agy --conversation` / `pi --session`; an exited agent's command is only pre-typed, and liveness is lowered only by an *observed* exit so the first post-restore detection tick can't bury the tabs it just brought back; reporters from older builds are swept from the hooks dir and every agent config, and the `"agent"` placeholder one of them reported — which silently disabled Codex resume — is rejected at the door; the self-healing pointer-lock guard + the packaged-build CSP style-src exemption shipped alongside). **In-app auto-updater** (`tauri-plugin-updater`) — Settings → Updates with **stable/nightly channels** (default stable; mapped to GitHub's pre-release flag, not the tag), background download + **agent-idle-guarded install** (a restart stops agents, so the install waits for the safe window or explicit consent), a dismissible banner, full version-name display, and a per-channel rolling `latest.json` published by CI (`release-desktop-manifest.yml`); functional once the human supplies the free minisign signing key (`FOR-HUMAN.md`). **AI-provider usage stats (Settings → Providers)** — a native Rust reader (`usage_read`) for **Codex, Claude, Copilot and Grok** that reads each CLI's own stored token → the provider's official usage API (never cookies/pasted keys; only the providers the user activates are polled) — the discontinued **Gemini CLI** is still read for anyone who activated it but is hidden from the "Add a provider" picker (`deprecated` in `usageCatalog.ts`, one flag to re-enable), and **Antigravity** is researched but deferred (`agy` keeps its OAuth token in the OS keyring instead of on disk, and its `/usage` command is interactive-only, so there is nothing to read under this posture; findings in `FOR-DEV.md`) — a tabbed UI with per-provider quota windows ("% used"), plan/account ("Authenticated as …" with click-to-reveal blur), credit, per-provider refresh + status-bar visibility, and a status-bar gauge popover; contract-first via the shared `agent/usageStats` method (bridge/mobile side is Phase 6). **User quick commands** — a top-bar **⚡** launcher (fixed slot left of the window controls; shortcut `Mod+Shift+P`) + a Settings → Quick commands editor for shell commands persisted flat in `AppData.quickCommands` (`quick_commands_set`, `#[serde(default)]`), each scoped **global/project/worktree** (pruned with its project/worktree), with substitution variables (`{worktree}`/`{branch}`/`{repo}`/`{repoName}`/`{path}`), a run target (new tab or the focused terminal via `pty_write`), run-immediately-vs-type-only (`runCommandExecute`), cwd, shell and an optional confirm — reusing the terminal `runCommand` launch path (`projects.runQuickCommand`). **GitHub integration (`gh`-backed)** — a **per-project inline GitHub view** (Pull Requests / Issues / Actions, opened from each project card's **⋯ menu** or any **worktree row's right-click menu** — which acts on the owning project and is the only way in while the sidebar is grouped by status, both through the shared `github.openSection`; it replaces the center + right panels while the left sidebar and the browser panel stay put, and closes as soon as any worktree is activated) with real PR **review** (approve/request-changes/comment) + **merge** + the unified **diff**, **issue** triage/create, **Actions** logs + re-run/cancel; the **Account / Session** panel and every GitHub preference live in **Settings → GitHub**; plus a configurable **right-panel GitHub tab** (the branch's PR + checks roll-up, plus the repo's 5 latest PRs / CI runs / issues — every row opens that item's detail inside the app through `github.openSection`'s pending-detail, and each issue offers the worktree dialog), **sidebar-card PR badges**, a passive **readout inside the status bar's backend popover** (rate limit + optional unread count, an unread dot on the backend icon and a row into Settings → GitHub; it has no status-bar button of its own and never navigates on its own), and a post-push **"Create PR"** toast. PR detail is split into **Conversation / Files-changed tabs** with the review/merge/checkout tools in a bottom bar available from both, and bodies/comments render the GitHub-flavored Markdown bot comments are built from (**alerts**, **`<details>`**, hidden HTML comments). Creating a PR **picks its `base ← head`** — either side can be any branch (local ∪ `origin`) — and **merging is protection-aware**: the offered methods are the repo's settings ∩ the base branch's **rulesets** (`gh api …/rules/branches/{base}`; the classic protection endpoint 404s on a ruleset-protected branch), a blocked PR **explains why**, and the escape hatches are **auto-merge** (`--auto`) then **admin bypass** (`--admin`, offered on any blocked PR behind a danger confirm), with `--match-head-commit` on every merge. **Worktree-native** flows (`gh pr checkout` → new worktree, `gh issue develop` → new worktree) go through a **settings + confirmation dialog** (branch name, launch agent, folder preview) and land like any hand-made worktree. Optional **AI PR-body drafting** (the `aicommit` one-shot local-CLI runner) is configured in its own settings section, built like Settings → AI commit (enable switch, agent picker with logos + install state, model picker, language, instructions). Everything routes through the local **`gh` CLI** (incl. `gh api` for rate-limit/notifications/rulesets) — **no token is stored or read by the app** (`gh` owns it; only sanitized login/scopes/host are read), so every agent action has an identical manual path (`src-tauri/src/github.rs`, `AppSettings.github`; `docs/github.md`; GitLab + native device-flow/keyring sign-in are follow-ups in `FOR-DEV.md`). **Automations** (spec `02f`): unattended, **recurring** tasks that run in **their own working folder** (repo or not, never bound to the selected project) driving a **multi-agent graph** — parallel + fan-in from `dependsOn`, context passing (`{{steps.s1.output}}` plus `{{prev.s1.output}}` from the previous run), completion **verified by exit code**, shell precondition, optional worktree per run, overlap policy and retention. The binary doubles as a **headless runner** (`--automation-run <id>`, branched in `main.rs` before Tauri builds a window), so a run fires **with the app closed** — the reason this engine lives in Rust instead of reusing the webview-side orchestration engine, which it coexists with. Persistence uses a **single writer per file** under `<app-data>/automations/`. Saving one **registers a task with the OS's own scheduler** (Task Scheduler XML / LaunchAgent / systemd user timer, per user and without elevation), which delegates the overlap policy and missed-run catch-up to the OS and **degrades honestly** when registration fails. Verified end to end on Windows with the app closed. The **screen** is built as well: a full-screen view like Settings (profile menu + `Mod+Shift+A`) with a groupable list, an inline editor with a next-runs preview, run history showing the prompt as actually sent, and an honest scheduling badge that shows the OS's own message when registration failed. **Four example automations are seeded on a first visit** (paused, multi-agent, restorable from Templates) so no section is an empty page, and under every prompt field the editor **lists the values that prompt can carry** in plain language — an earlier step's answer, what a step answered in the previous run, the working folder — inserted at the cursor, with an earlier step's answer also making the step wait for it. **Still missing:** validating the macOS/Linux registration on real hardware, and an on-device review of the new screen. **Pets** — an opt-in animated companion (off by default) that mirrors the precise hook state (`working`→`running`, `waiting`→`waiting`, `done`→`review`, `blocked`→`failed`, an **interrupted** `done` (Esc/Ctrl-C) →`failed` too — only the pet re-reads it, and it is what makes `blocked` reachable at all since only OpenCode raises a real error state — else `idle`; stale reports ignored), as **one pet** (most urgent wins: needs-you → blocked → ready → working, and among the agents in that state the **freshest report** — not map order, and deliberately not filtered to the selected worktree); clicking it reveals that agent's terminal. It renders **by default in its own borderless, transparent, always-on-top desktop window** (`pets.overlay`, switchable back to a layer inside the uxnan window; visible over other apps and with uxnan minimized; OS-native window drag, position persisted + validated against live monitors, its own per-window capability, loaded by query per mode — `/?window=pet` in dev, `index.html?window=pet` packaged — a thin stateless renderer fed by the main window over events, destroyed with the main window; **raising uxnan on a pet click is its own switch, off by default**). The pet is **mouse-interactive**: while resting it watches the cursor (a v2 sheet's rows 9–10 are 16 clockwise look poses, 22.5° steps, 0° = up, front = the pointer deadzone — poses held one at a time, never played in sequence), a click pokes it (jump reaction), and dragging **carries it running** — the travelling run of rows 1–2 in the direction of travel (looping its own row at its own quicker, perfectly even `CARRY_PACE` — a run is a loop, not a gesture), falling back to the looking-down carry pose the moment the hand stops; in the desktop window, where the OS owns the drag and swallows pointer events, the window's own movement both feeds **and arms** the carry, so a paused hand can't end it for good. It also layers an **idle personality** over the state's base animation — occasional one-shots (look around, wave for attention, take a breather) so the whole sheet is used and a real state change always cancels the flavour. A one-shot is always a **different** row than the state's own, because ending one restarts the base animation and so replays the state's row anyway: that free replay is what re-shows a state the pet had settled out of, and using the state's own row stacks the two (a `done` pet then celebrates for the whole 30 minutes). Cadence is set against how long a state lasts — needs-you nags (6–13 s), resting stirs (14–34 s), the long-lived states are calmest (25–50 s). States **expire** rather than being mirrored (busy 3 min, anything waiting on the user 30 min, measured from when the agent entered the state) — **unless the agent is still reporting** (a hook within 90 s), in which case the state starts its clock over instead of leaving the pet resting on top of live work and pointing nowhere, and the conventional row map + timings follow the reference implementation — `running` is the in-place row 7 (not the travelling run on row 1), each state animation is its row **three times followed by the idle frames** (looping from idle, so the pet reacts then settles), and frames carry **individual durations** rather than a frame rate (idle breathes once every 6.6 s; the state rows play the reference's raw times × `STATE_PACE` 1.3 = 182–195 ms a frame — one ambient pace for every gesture, stretched because the raw 120–150 ms reads as a twitch beside that idle, but capped around a fifth of a second a frame, past which a held pose reads as a pause and the gesture turns mechanical). The on-disk format is **the Codex CLI's own** (`pet.json`/`avatar.json` + one spritesheet of 192×208 cells, `fallback` chains), so community packs load unmodified — and a generated pack (what `/hatch` and the community galleries produce) declares neither `frame` nor `animations`, so both are recovered from the image — the grid from its dimensions (v2 is 8x11, older 8x9) and the animations from the conventional row order with its declared per-row frame counts (a row is often partly used — a generated wave is 4 frames of 8 — and playing the blank remainder makes the pet flicker out); importing from `~/.codex/pets` or any folder is a **validating copy** (manifest + referenced sheet only, traversal-checked ids, bare-filename sheet path, ≤24 MiB, image sniff, bounded grid). uxnan bundles **only its own pet** (`Uxni`, a normal pack in `static/pets/uxni/` — an 8x11 sheet with one animation per row — swapped by replacing its files, not generated) and says so in the library + import dialog, recording each imported pet's origin. The renderer wakes only on frame boundaries, parks while hidden, draws one still frame under `prefers-reduced-motion`, and loads nothing until enabled. Toggle in the sidebar profile menu + **Settings → Pets** (General group); `src-tauri/src/pets.rs`, `AppSettings.pets`, `src/lib/pets/`, `docs/pets.md`; AI "hatch" generation is a `FOR-DEV.md` follow-up. Cross-cutting: full EN/ES i18n, design tokens, agent registry/catalog, shell-aware manual + auto agent launch with **per-agent env vars** and a **configurable launch shell** (cmd by default on Windows), plus a first **Vitest** frontend test harness (pure logic). **Remaining (tracked in `uxnandesktop/FOR-DEV.md`):** Phase 6 (embedded bridge / mobile pairing — *optional for standalone*); **paid OS code-signing** before distributing builds; non-blocking follow-ups (keep-awake macOS/Linux, async-debounce persistence, E2E + component tests, orchestration lineage in the main sidebar + agent-driven worker creation).

All code is new — no legacy, no users, no production data. Push notifications are code-complete but **gated** behind human-provided Firebase/APNs credentials (see the relevant `FOR-HUMAN.md`).

This means:
- There is no backwards-compatibility to maintain (yet).
- Architecture decisions can change if justified.
- All implementation must strictly follow the documented specification.
- The quality of the initial code defines the foundation for everything that follows. Rushed code is not acceptable.

---

## Language

- Everything written into the repository or any project platform (code, docs, commits, branches, PRs, issues) is in **English**, to keep the project ready to go global.
- The assistant communicates with the maintenance manager in the same language or in the language explicitly specified by the maintenance manager (this is solely an internal conversation and is never included in any confirmed or published version).

---

## Monorepo structure

```
uxnan/
├── architecture/                  # PRD+SRS for the Flutter mobile app
├── architecture.old/              # Original whitepapers (historical reference)
├── uxnanmobile/                   # Flutter project (Android + iOS)
├── uxnandesktop/                  # Desktop ADE app (Tauri 2 + Rust + Svelte 5)
│   └── architecture/              # PRD+SRS for the desktop app
├── bridge/                        # Node.js daemon for PC
├── relay/                         # Node.js relay server
├── shared/                        # Shared contracts (types, JSON-RPC schemas)
├── web/                           # Marketing website (Next.js 15, static export)
├── AGENTS.md                      # This file — the single source of truth
├── CLAUDE.md                      # Claude Code entry point — imports this file via `@AGENTS.md`
├── GEMINI.md                      # Gemini CLI entry point — imports this file via `@AGENTS.md`
└── README.md
```

---

## Before implementing anything

### 0. Verify required skills

This project relies on skills installed **globally** on the machine. They encode
the exact architectural and UI style of each app and must be available regardless
of which agent is working (OpenCode, Claude Code, Codex, Pi, or any other). The
skills are **scoped per monorepo** — use each set **only** in its target
component:

- **Flutter skills → use exclusively with `uxnanmobile/`.**
- **Svelte/desktop skills → use exclusively with `uxnandesktop/`.**

Do not invoke a Flutter skill while working on the desktop app, or a Svelte skill
while working on the mobile app.

#### Flutter skills — `uxnanmobile/` only

The four Flutter skills encode the exact architectural style used by
`uxnanmobile/`. **Canonical source: `https://github.com/luisgamas/skills`.**

| Skill | Purpose |
|---|---|
| `flutter-init-project` | Bootstrap/reset a Flutter project baseline |
| `flutter-clean-architect` | Module/layer structure (domain, infrastructure, presentation) |
| `flutter-riverpod-expert` | Providers, notifiers, auth/router wiring |
| `flutter-m3-uiux` | Theme, design tokens, responsive UI |

**Installation:** If any skill is missing, install it globally with the exact
commands from the canonical source. The `-g` flag installs globally and the CLI
automatically creates symlinks for every agent detected on the machine — no
manual symlink steps are needed:

```bash
npx skills add https://github.com/luisgamas/skills/tree/main/flutter-init-project -g -y
npx skills add https://github.com/luisgamas/skills/tree/main/flutter-clean-architect -g -y
npx skills add https://github.com/luisgamas/skills/tree/main/flutter-riverpod-expert -g -y
npx skills add https://github.com/luisgamas/skills/tree/main/flutter-m3-uiux -g -y
```

#### Svelte / desktop skill — `uxnandesktop/` only

The desktop UI skill encodes the clean, token-driven Svelte 5 + shadcn-svelte
visual system used by the `uxnandesktop/` ADE frontend. Use it whenever you
build, restyle, or refactor `uxnandesktop/` UI. **Canonical source:
`https://github.com/luisgamas/skills`.**

| Skill | Purpose |
|---|---|
| `svelte-clean-desktop-ui` | Token-driven clean desktop UI/UX system for Svelte 5 with shadcn-svelte / Bits UI / Tailwind v4 / lucide — shell layouts, sidebars, panes, settings, cards, menus, tabs, forms, dialogs, compact density, neutral surface layering, DM Sans typography and polished motion, without changing the underlying UI libraries |

**Installation:** If the skill is missing, install it globally with the exact
command below. The `-g` flag installs globally and the CLI automatically creates
symlinks for every agent detected on the machine — no manual symlink steps are
needed:

```bash
npx skills add https://github.com/luisgamas/skills/tree/main/svelte-clean-desktop-ui -g -y
```

#### Verification (both sets)

Before doing any work in a component, check that its skills are present. Look for
a `SKILL.md` file inside any of these global skill directories:

- `~/.agents/skills/<name>/SKILL.md`
- `~/.config/opencode/skills/<name>/SKILL.md`
- `~/.claude/skills/<name>/SKILL.md`

If the skill exists in **any** of these locations, it is considered installed.

After installation, **inform the user they must restart their agent** for the new
skills to be detected. Do not proceed with work in a component until its skills
are available. If `npx skills` is not available on the machine, stop and instruct
the human to install the skills manually using the commands above, then restart
their agent.

### 1. Analyze the architecture

Before writing code in any component, you MUST read the corresponding architecture documentation:

| If you're working on... | Read first... |
|---|---|
| `uxnanmobile/` | `architecture/00-index.md` and the documents it references for the affected module |
| `uxnandesktop/` | `uxnandesktop/architecture/00-index.md` and the relevant documents |
| `bridge/` | `architecture/02a-system-architecture.md` (section 5.8) + `uxnandesktop/architecture/02e-bridge-integration.md` |
| `relay/` | `architecture/02a-system-architecture.md` (section 5.10) |
| `shared/` | `architecture/02b-contracts-and-requirements.md` (JSON-RPC contracts) |
| `web/` | `web/README.md` + `web/docs/content.md` — the site has no `architecture/` page of its own; the products it describes are the source of truth, and `web/src/lib/site.ts` is where every claim it makes is centralized |

Do not implement based on assumptions. If something is unclear in the documentation, ask before assuming.

### 2. Check if the component has its own documentation

Each project may have its own internal documentation (README, CHANGELOG, docs/). Before making changes, check if it exists and respect it:

```
uxnanmobile/CHANGELOG.md
uxnanmobile/README.md
uxnandesktop/CHANGELOG.md
uxnandesktop/README.md
bridge/CHANGELOG.md
bridge/README.md
relay/CHANGELOG.md
relay/README.md
shared/CHANGELOG.md
shared/README.md
web/CHANGELOG.md
web/README.md
```

#### `docs/` per component (required)

Every component maintains a `docs/` directory with task-focused topic files,
linked from a `## Docs` section in its `README.md` (see `bridge/docs/` and
`uxnandesktop/docs/` for the pattern). At minimum, each component's `docs/`
covers:

- **How to run it in development / debug** (and how to iterate on UI for
  GUI apps — e.g. the desktop's frontend-only browser flow).
- **How to build it for release / production** (and packaging targets, if any).
- **How to test and verify it** (the lint/format/test gates from "After
  implementing").
- Anything component-specific a contributor needs (configuration, connectivity,
  installation, how agents are driven, etc.).

Keep these docs current as part of the same change that alters behavior, build,
or configuration (same rule as CHANGELOG/README below).

### 3. Understand the scope of the change

- Does this change affect a single component or multiple?
- Does it modify a shared contract (JSON-RPC, types, schemas)?
- Does it require coordinated changes across mobile/desktop/bridge/relay?

If it affects contracts in `shared/`, all consuming components must be updated in the same cycle.

---

## During implementation

### Conventions by component

**Flutter (uxnanmobile/):**
- Clean Architecture: `core/`, `domain/`, `application/`, `infrastructure/`, `presentation/`
- Riverpod 3.x manual — no `riverpod_generator`, no `riverpod_annotation`. Use the modern `Notifier` / `NotifierProvider` / `AsyncNotifierProvider` API (the spec's older `StateNotifierProvider` examples are adapted accordingly).
- Material Design 3 with semantic `ColorScheme`
- **UI design language: Neural Expressive (M3 Expressive)** — documented in `uxnanmobile/docs/neural-expressive-design.md`. Follow it for new and redesigned screens (transparent app bars + scroll veil, Icon Surfaces, floating pill input + unified "+" turn-tools sheet, dynamic-corner card lists, spring-motion tokens). Shared building blocks live in `lib/presentation/theme/motion.dart` and `lib/presentation/widgets/`.
- drift (SQLite) for local persistence
- Detailed conventions: `architecture/03-technical-reference.md`
- **Always use the installed Flutter skills** when working on this app — they encode this repo's exact style: `flutter-init-project` (bootstrap/reset a baseline), `flutter-clean-architect` (module/layer structure), `flutter-riverpod-expert` (providers, notifiers, auth/router wiring), `flutter-m3-uiux` (theme, design tokens, responsive UI). Invoke the relevant skill before scaffolding or restructuring. The architecture docs remain the source of truth: where a skill's generic default conflicts with the spec (e.g. `lib/config/` vs the spec's `lib/core/`, or a minimal-dependency default), follow the spec.

**Desktop (uxnandesktop/):**
- Backend: Rust with Tauri 2 + Tokio async
- Frontend: Svelte 5 with Runes ($state, $derived) + shadcn-svelte + Tailwind CSS
- Persistence: Serde JSON with atomic writes
- Git: git2 crate + CLI fallback
- Detailed conventions: `uxnandesktop/architecture/03-implementation-guide.md`

**Bridge / Relay (bridge/, relay/):**
- Node.js
- JSON-RPC 2.0 over WebSocket
- Contracts defined in `shared/`

**Web (web/):**
- Next.js 15 (App Router) with `output: "export"` — a fully static site, no server
  runtime. React 19 + TypeScript + Tailwind CSS v4.
- Standalone npm package: **not** part of the root `workspaces`. Install and run
  everything from inside `web/`.
- **Every factual claim the page makes lives in `src/lib/site.ts`** (agent counts,
  RAM figures, method counts, commands, links). When one of those facts changes in
  another component, update that file in the same change set — see
  `web/docs/content.md` for the claim-to-source table.
- Interface visuals are DOM recreations, never screenshots, so they follow the
  theme and stay sharp. Scroll animation is CSS driven by a single custom property
  written by a scroll handler; React does not re-render per frame.
- The site is **not tag-versioned** — it has no release artifact. A push to `main`
  runs `deploy-web.yml`, which builds it on GitHub's runners and uploads the static
  export to Cloudflare Pages (Direct Upload). See `web/docs/deploy.md`.

**Contracts (shared/):**
- TypeScript for type definitions
- JSON Schema for runtime validation
- Any change here requires verifying compatibility across all consumers

### Security

These rules are non-negotiable:

- **Never** store tokens, API keys, or secrets in plaintext. Use the system's encrypted storage (Keychain on iOS, Keystore on Android, stronghold/keyring on desktop).
- **Never** expose secrets in logs, error messages, or API responses.
- **Never** include secrets in source code, test fixtures, or committed configuration files.
- **Never** disable TLS certificate verification, not even in development.
- **Never** use `eval()`, `Function()`, or equivalent constructs with external input.
- User data never passes through intermediary servers in cleartext. The relay only sees opaque E2EE envelopes.
- Validate all input at system boundaries: user input, API responses, WebSocket payloads, bridge data.
- Sanitize bridge payloads before sending to mobile (see `architecture/02a-system-architecture.md` section 5.8.9).
- Follow the documented E2EE protocol without modifications: X25519 + Ed25519 + AES-256-GCM + HKDF-SHA256. Do not invent cryptographic variants.
- `.env` files, `credentials.json`, private keys, and any files containing secrets must be in `.gitignore`.

### Code quality

- Do not leave `TODO`, `FIXME`, or commented-out code without an explicit justification and a referenced issue.
- Do not introduce dependencies without verifying: compatible license, active maintenance, package size.
- Prefer pure dependencies (pure Dart, pure Rust) over dependencies with native code when possible.
- Every public function must have tests. No exceptions in ALPHA phase — early tests prevent technical debt.
- Lint/format before considering any change as done:
  - Flutter: `dart analyze` + `dart format`
  - Rust: `cargo clippy` + `cargo fmt`
  - Node.js: project-configured linter
  - Svelte: `svelte-check` + project-configured linter

### Human-required assets (`FOR-HUMAN:`)

Some files cannot be produced by an agent: font binaries (`.ttf`/`.otf`), icon and image assets, Firebase/APNs credentials (`google-services.json`, `GoogleService-Info.plist`), signing keys, `.env` secrets, and store metadata.

Whenever the implementation references such a file that the **human** must provide, you MUST leave a greppable annotation containing the literal token `FOR-HUMAN:` followed by:

1. **What** the file/asset is (and where to obtain it, if relevant).
2. **Where** it must go — the exact path in the project.
3. **Config** — any wiring needed for it to work (e.g. uncomment a `pubspec.yaml` section then run `flutter pub get`, apply a gradle plugin, add an Xcode capability), or state "none".

Rules:
- Aggregate every **open** item in a `FOR-HUMAN.md` checklist at the component root (e.g. `uxnanmobile/FOR-HUMAN.md`).
- Also place an inline comment with the `FOR-HUMAN:` token at the exact code/config location that needs the asset (e.g. a `# FOR-HUMAN:` comment in `pubspec.yaml`).
- **Remove on completion:** once the asset is provided AND the feature works with it, delete the item from `FOR-HUMAN.md` and its inline marker in the same commit (see §2 → *completion lifecycle*). The file lists only what's still missing.
- The whole project must always compile and run without these assets (use graceful fallbacks); a missing `FOR-HUMAN` asset may degrade a feature but must never break startup or the build.
- **Never** commit real secrets, credentials, or keys — only the annotation describing what is needed and where.

### Pending developer work (`FOR-DEV:`)

When you intentionally defer implementation work that a developer/agent must do later — a deferred feature, a stub, a happy-path-only implementation, a `TODO` that is justified by sequencing — leave a greppable annotation with the literal token `FOR-DEV:` followed by:

1. **What** is missing or stubbed.
2. **Where** the real implementation should go (path / symbol).
3. **Why** it was deferred and what unblocks it (e.g. "needs the relay", "UI increment", "needs the conversation module).

Rules:
- This is distinct from `FOR-HUMAN:` (which is for assets/secrets only a human can provide). `FOR-DEV:` is for code work the team will do.
- Aggregate **open** items in a `FOR-DEV.md` checklist at the component root (e.g. `uxnanmobile/FOR-DEV.md`), and place an inline `// FOR-DEV:` comment at the exact deferral site.
- **Remove on completion:** the moment an item is 100% implemented AND validated, delete it from `FOR-DEV.md` and remove its inline `// FOR-DEV:` marker in the same commit (see §2 → *completion lifecycle*). Don't accumulate `[x] DONE` items — the commit history is the record. Keep only what's genuinely still pending; a partial / unvalidated item stays with an honest status.
- A `FOR-DEV:` marker is the only acceptable form of a deferred-work `TODO`/`FIXME` (see "Code quality"); plain `TODO`/`FIXME` without it are still not allowed.
- Deferring must not break the build or tests: stubs either throw a clear `UnimplementedError`/`StateError` or are simply not wired yet.

### UI changes (propose and iterate)

UI work — screens, layouts, visual design, theming — is reviewed visually by the user and must not be committed unilaterally. When you build or change UI:

1. Implement the proposal with the design system and verify it once (analyze / tests / build).
2. **Present it for the user's review and wait for their adjustments. Do not commit UI changes until the user approves them.**
3. Iterate on their feedback (sizes, spacing, colors, positions, copy, motion) in the same loop; only re-run build/analyze when a change could actually affect compilation or behavior — not for pure visual tweaks the user asked for after an already-green verification.

This mirrors the agreed workflow: propose → user reviews on-device → adjust → approve → commit.

---

## After implementing

### 1. Verify it works

Do not report a change as done without verifying:

- Does it compile without errors or warnings?
- Do the tests pass?
- Is lint/format clean?
- If it's UI: did you test the full flow in a browser/emulator/device? Type checking and tests verify code correctness, not feature correctness.
- If it's a contract change (`shared/`): do all consumers still compile?

### 2. Update documentation (in the same change set)

Documentation lagging the code is the single biggest source of drift in this repo —
treat a stale doc as a bug. **Every change that touches behavior, API, contracts,
structure, configuration, build, status, or anything else that depends on the
project MUST update the affected documentation in the SAME change set that lands
the change** — never "later", never "in a follow-up someday". This applies to every
kind of work: a feature, a fix, a refactor, a deferred-item completion, even a
spec-only decision with no code.

Match the change to the docs it touches (a single change often hits several rows):

| What you changed | Update… |
|---|---|
| Behavior / API / a feature in one component | that component's **`CHANGELOG.md`** (`[Unreleased]`, [Keep a Changelog](https://keepachangelog.com/)) — **always, without exception** — plus its **`README.md`** and **`docs/`** if how it's installed / configured / used / run / tested / connected changed |
| A cross-component contract (a `shared/` JSON-RPC method, E2EE message, notification, or model field) | the **`shared/`** types + validators, **`architecture/02a`/`02b`**, and the **`CHANGELOG.md` of every consumer** you touched this cycle (see *Cross-monorepo* below) |
| Direction / an architecture decision (even spec-only, no code) | the affected **`architecture/`** page(s) **and** the executive summary at the top of that doc — see **§4 Spec drift control** |
| Implementation state in a component (a feature / phase flips planned → done, or done → reworked) | that component's **`FOR-DEV.md` `## Status`** — the home for per-component "what's working today / what's left" (see *Where status lives* below). Also refresh the matching **`architecture/00-index.md`** / **`04-technical-reference.md`** status table when a spec-level phase flips |
| Finished a deferred item (100% + validated) | **remove** it from `FOR-DEV.md` / `FOR-HUMAN.md` — see *completion lifecycle* below — and fold the now-shipped capability into that `FOR-DEV.md`'s `## Status` |
| Deferred new work / left a stub / found a missing human asset | **add** a `FOR-DEV.md` / `FOR-HUMAN.md` entry **and** the inline `FOR-DEV:` / `FOR-HUMAN:` marker at its site |

Verify the docs the same way you verify code: re-read what you wrote against the
real current state (counts, file names, flags, agent lists, paths). A doc that
cites a number, a file, or a flag that no longer matches the code is drift.

#### Where status lives (README vs FOR-DEV)

Keep the two audiences separate so neither doc rots:

- **`README.md` (per component **and** the root `README.md`/`README.es.md`) is the
  user-facing front door.** It explains *what the thing is and does* and carries
  only a **brief, current snapshot** of status — never the exhaustive
  feature-by-feature inventory. When state changes, update the snapshot only if the
  one-line summary is now wrong.
- **`FOR-DEV.md` `## Status` is the developer-facing home for detailed
  implementation status** — what's working today, what's partial, what's left. This
  is where the granular "DONE / pending" detail belongs, sitting directly above the
  pending-work list it contextualizes. Every component's `FOR-DEV.md` opens with a
  `## Status` section; keep it current as features land (and as items are removed
  per the *completion lifecycle*).
- **`architecture/` status tables** stay the spec-level record of which phases /
  subsystems are built (see §4 Spec drift control). They track the *spec*, not the
  prose; the per-component lived status is `FOR-DEV.md`.

#### Counts, enumerations & links (easy to miss)

- **Cited numbers MUST be updated when the thing they count changes.** Whenever you
  add or remove something the docs count or enumerate — a **test**, a **JSON-RPC
  method**, a **streaming notification**, an **agent**, a **module/file** — grep
  **every** doc for the affected number/list and update **all** occurrences in the
  same change set. Examples (these have bitten us): a new method bumps the
  `N methods` count in `shared/README.md`, `bridge/README.md`, the root
  `README.md` / `README.es.md`, **and** `architecture/02b` (the `METHOD_NAMES`
  count *and* the method list); new tests bump the `N passing` / `N bridge + …`
  counts wherever they're cited — the affected component's `FOR-DEV.md` `## Status`
  and any `README.md` / `docs/` page that still quotes a count. Re-derive the number
  from the code (`grep -c` the registry / `test(`), don't trust the old one.
- **Never reference a git-ignored / local-only file from a tracked file.** Anything
  in `.git/info/exclude` (e.g. the local `*_MVP.md` snapshots, scratch/runbook
  notes) is the maintainer's local context and won't exist on a fresh clone —
  tracked docs, workflows and config must stand on their own without pointing at it.
- **Hand-kept model tables come in PAIRS — a new model must be added to BOTH.**
  Most agent CLIs enumerate their own models and are discovered live; **Claude Code
  cannot**, so the repo ships a curated table maintained by hand — and it exists
  twice, once per app:

  | Agent | Bridge (feeds the phone) | Desktop (feeds AI commit / PR body) |
  |---|---|---|
  | Claude Code | `bridge/src/daemon-config.ts` → `DEFAULT_DAEMON_CONFIG.agents['claude-code'].models` | `uxnandesktop/src-tauri/src/agentcli.rs` → `CLAUDE_MODELS` |
  | ~~Gemini CLI~~ | *frozen* — `bridge/src/adapters/gemini-adapter.ts` → `GEMINI_MODELS` | *frozen* — `uxnandesktop/src-tauri/src/agentcli.rs` → `GEMINI_MODELS` |

  **Gemini CLI is deprecated: do not spend work on it.** It is discontinued
  upstream (its successor is Antigravity, `agy`, which uxnan drives as a real
  agent and which discovers its own models). Both apps already hide it — the
  desktop drops it from the AI-commit/PR-body pickers and no longer auto-installs
  its reporter, the mobile picker filters it out — and its tables are **frozen**:
  don't add models to them, don't chase upstream changes, and don't build new
  features against it. What stays is only enough for someone who already had it
  configured to keep working and turn it off. It will be removed from the project
  entirely in a later pass; until then, treat every Gemini path as read-only
  legacy. Same for anything else it touches (adapter, hook reporter, catalog
  entry): leave it working, don't extend it.

  When a model ships or is retired, edit **both halves of the pair in the same
  change set** (updating one silently leaves the other app a version behind), with
  the **same ids, labels and order** — newest/most capable first. Use canonical ids
  only: no date suffixes, no routing variants (`…[1m]`, `…-fast`), no
  invitation-only models, and no bare `fable`/`opus`/`sonnet`/`haiku` alias inside
  a table (the bridge advertises those aliases separately, from
  `claude-adapter.ts` — that set is hand-kept too, verified against
  `claude --help`). A model in an existing tier needs no context-window edit —
  `claudeContextWindow()` maps by tier. Full rules:
  [`bridge/docs/agents.md`](bridge/docs/agents.md) and
  [`uxnandesktop/docs/agent-launch.md`](uxnandesktop/docs/agent-launch.md).

#### The docs track the code — re-verify them when the code moves (easy to miss)

`README.md` and especially the `docs/` guides are **not** prose that ages
gracefully on its own: they hard-code concrete facts pulled straight from the
source, and each of those facts is a small contract that silently breaks the
moment the code it mirrors changes. Whenever you touch code that any doc or README
describes, **re-derive the affected facts from the source in the same change set**
— don't trust what the doc already says. The facts that have bitten us, with where
they live:

- **CLI commands, flags & npm scripts** — the `bin`/`scripts` in each
  `package.json`, the Tauri/Flutter commands. If you rename a script or change a
  flag, grep the component's `README.md` + `docs/` for it.
- **Config keys, enum values & identifiers** — field names and defaults in the
  config type (e.g. `daemon-config.ts`), and **canonical id unions** like
  `AgentId` (`gemini-cli`/`pi-agent`, *not* `gemini`/`pi`). A doc that lists ids
  or config fields must match the union/interface exactly.
- **Env var names, file names & paths** — e.g. `UXNAN_HOOK_URL` / `UXNAN_AGENT_ID`,
  `~/.uxnan/daemon-config.json`, `~/.uxnan/checkpoints.json`. Copy them from the
  code, never from memory.
- **Default values & ports** — e.g. `DEFAULT_LAN_PORT`, `checkpointMaxPerProject`.
  Quote the constant's real value.
- **"Which agents / which features" claims** — e.g. "3 adapters wired" or "next
  agent is X". When an agent or capability lands, the prose that enumerates them
  (in `docs/agents.md`, `docs/testing.md`, etc.) is part of the same change.
- **Behavior described in a doc-comment** — a `/** … */` that explains a fallback,
  a posture, or a scope must match what the code actually does (these drift the
  fastest, because nothing compiles them against reality).

Same rule as the rest of §2: this verification lands in the **same change set** as
the code, and a doc/comment that cites a command, key, id, path, value, or
behavior that no longer matches the source is drift — treat it as a bug.

#### Cross-monorepo functionality (read this twice)

Many features span monorepos — a bridge method the mobile app renders, an E2EE step
both sides implement, push that lives in the bridge with a relay fallback, a desktop
feature that will drive the embedded bridge. When you change one side of a shared
feature:

- update **`shared/`** (the contract source of truth) **and** the cross-component
  spec (`architecture/02a` system architecture, `02b` contracts, `02e` bridge
  integration), so the wire contract and the prose never disagree;
- update the **`CHANGELOG.md` + `README.md`/`docs/` of *every* component the change
  reaches** in the same cycle — a `shared/` change that bridge, relay, mobile and
  desktop all consume must leave **none** of them stale;
- if you can only land one side now, record the owed other-side work as a
  **`FOR-DEV.md`** item on the component that still needs it, and link the two so the
  next agent can close the loop.

When in doubt about which monorepos a feature touches, trace it through `shared/`:
whatever consumes the contract you changed has docs that may need updating too.

#### FOR-DEV / FOR-HUMAN completion lifecycle (non-negotiable)

`FOR-DEV.md` and `FOR-HUMAN.md` track **only open work**. They are not a changelog
and must not accumulate a growing list of `[x] DONE` items.

The moment an item is **100% implemented AND validated** (for `FOR-HUMAN`: the asset
is provided and the feature works with it):

1. land the code + all its doc updates (CHANGELOG / README / docs / architecture per
   the table above), then
2. in the **same commit**, **delete the item from `FOR-DEV.md` / `FOR-HUMAN.md`** and
   remove the inline `FOR-DEV:` / `FOR-HUMAN:` marker at its code site.

The commit history (the CHANGELOG entry + the deletion diff) is the permanent record
that the item was completed and removed — that is intentional and sufficient; do not
keep it listed "for posterity". A reader of `FOR-DEV.md` / `FOR-HUMAN.md` must see
**only what is genuinely still pending**.

Before deleting, re-confirm each *remaining* item is truly still open: a partial,
happy-path-only, or not-yet-device-verified item **stays**, with an honest status —
don't delete work that only looks done. Conversely, don't leave a fully-done item
sitting in the file because removing it feels like losing information; the history
holds it. (Division of labor: `architecture/` + `CHANGELOG.md` record *what shipped*;
`FOR-DEV.md` / `FOR-HUMAN.md` record only *what's left*.)

### 3. Do not commit or push

**NEVER** run `git commit` or `git push` on your own. These actions require explicit user confirmation.

When you finish a change:
- Show a summary of what changed.
- List the modified files.
- Wait for the user to decide whether to commit, what message to use, and whether to push.

This applies always, regardless of the change's size. A typo fix requires the same confirmation as a 50-file refactor.

---

### 4. Spec drift control (non-negotiable)

The architecture/ folders are the **source of truth** for cross-component
concerns (E2EE protocol, JSON-RPC contracts, the bridge spec §5.8, the relay
spec §5.10, the desktop three-panel ADE, the Flutter Clean Architecture, etc.).
The `CHANGELOG.md` of each monorepo records what shipped; `FOR-DEV.md` /
`FOR-HUMAN.md` track only what's left (see §2 → *completion lifecycle*). The spec
and the code MUST stay in sync.

**Rule (non-negotiable):** every time a `FOR-DEV.md` item is **completed** (and
therefore removed per §2's completion lifecycle — "landed", "wired", "implemented",
"done & validated"), the same change MUST be reflected in the relevant
`architecture/` document in the same change set — **not only in the CHANGELOG**.
The CHANGELOG entry is not a substitute for the spec.

What "reflected" means in practice:
- **New or changed cross-component contract** (a new JSON-RPC method, a new
  E2EE message, a new notification, a new model field) → update the
  applicable section of `architecture/02a-system-architecture.md` (or
  `02b-contracts-and-requirements.md` for contract-level details), and
  bump the matching shared model in `shared/`.
- **Changed direction** (e.g. the relay going from required to optional;
  push moving from relay to bridge; pairing-by-code moving from relay to
  bridge) → rewrite the affected section of `02a-system-architecture.md` and
  the affected spec page (e.g. `02a` §5.10, `02e-bridge-integration.md`).
  Update the executive summary at the top of the same doc.
- **Implementation state change** (a phase flipping from planned to done) →
  update the matching `architecture/04-technical-reference.md` / `00-index.md`
  status table for that component.
- **Spec-only decision (no code change)** → also reflected in
  `architecture/`, since the spec is the source of truth.

**Workflow for the dev/agent:**
1. Land the code change (commit, PR merge, or local-only — whichever the user
   asked for).
2. In the **same change set** (same commit if small, or an immediate
   follow-up commit on the same branch), update the affected
   `architecture/` sections + the matching component README if behavior
   changed.
3. In the commit body, list every spec file that was updated and the section
   that changed (one-liner per section), so the reviewer can verify the
   sync.
4. If the change is too large to update the spec in the same set (rare;
   usually only for a full subsystem rewrite), open a follow-up task in the
   matching `FOR-DEV.md` and link the two.

**Exception (acceptable drift, with a marker):** a code change that contradicts
the spec MAY land first when the spec is clearly stale, with a `// FOR-DRIFT:`
inline comment at the conflict site, AND a `FOR-DRIFT` entry added to the
matching `FOR-DEV.md` describing what spec change is owed. The drift must
be resolved in the next spec-update pass — never let a `FOR-DRIFT` entry
survive a release.

---

## Conflict resolution

If the documentation says one thing but the existing code does another:
1. Documentation takes priority (the project is in ALPHA, code adapts to the spec).
2. If you believe the documentation is wrong, flag it explicitly before implementing.
3. Do not silently "fix" discrepancies — communicate them.

**Ongoing drift control** (spec must not lag the code): see
*"Spec drift control (non-negotiable)"* below — every completed-and-removed
`FOR-DEV.md` item MUST be reflected in `architecture/` in the same change set.

---

## Commits (when authorized)

- Conventional Commits: `type(scope): message`
- Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `ci`, `build`
- Scopes by component:
  - Mobile: `flutter`, `domain`, `infra`, `ui`, `riverpod`, `drift`, `transport`, `e2ee`
  - Desktop: `rust`, `svelte`, `terminal`, `git`, `agent`, `tauri`, `bridge-embed`
  - Bridge: `bridge`, `adapter`, `handler`
  - Relay: `relay`, `push`, `ws`
  - Shared: `contracts`, `schemas`
  - Web: `web`
  - Docs: `docs`
- Messages in English, imperative mood, lowercase first letter.
- One commit per logical change. Do not mix features, fixes, or refactors in a single commit.

---

## Releases & versioning

Components version **independently** via per-component git tags (`shared-v*`,
`bridge-v*`, `relay-v*`, `desktop-v*`, `mobile-v*`). Pushing a component tag runs
that component's `release-*.yml` workflow. The version convention, the release
matrix, and the full step-by-step are in **[`VERSIONS.md`](VERSIONS.md)**; the
contributor-facing summary is in [`CONTRIBUTING.md`](CONTRIBUTING.md) → *Releases*.

**Non-negotiable rules when cutting a release:**

1. **The release version comes from the tag** (e.g.
   `mobile-v0.0.1-alpha.20260621+5`). Tag a commit that is already green on CI.
2. **Bump EVERY version file AND its lockfile in the same commit (NO drift).**
   Before tagging, set the release version in **all** of the component's
   version-bearing files **and re-sync the lockfile** — the release workflows
   re-apply the version at build time (`--allow-same-version`), which **masks** an
   un-bumped committed lock (that's how `uxnandesktop/package-lock.json` drifted to
   `0.0.2`). npm: `npm version -w <ws>` (updates `package.json` + root
   `package-lock.json`); **desktop:** `tauri.conf.json` + `Cargo.toml` +
   `Cargo.lock` + `package.json` + `package-lock.json` (numeric base); mobile:
   `pubspec.yaml`. Verify each manifest version **equals** its lockfile counterpart.
   Full per-file list + commands in **`VERSIONS.md`** → *Convention*.
3. **Update `VERSIONS.md` and validate the deploy** — in the same change set, add or
   refresh the component's row in the history table, **and confirm the release
   actually shipped**: the `release-*.yml` run is green and the artifact landed (npm
   published to the `latest` dist-tag / the Play **open-testing** (beta) build uploaded / the
   desktop GitHub **Release** draft exists). A red or half-finished release run is
   **not** a release — fix it before recording the row. (npm's `latest` dist-tag
   always tracks the newest release; `alpha`/`beta` channels are opt-in, added
   manually per build — see `VERSIONS.md`.)
4. **Mobile — `pubspec.yaml` MUST match the tag (NON-NEGOTIABLE).** Before tagging
   `mobile-v<name>+<build>`, bump `uxnanmobile/pubspec.yaml` `version:` to the same
   `<name>+<build>`, then **commit AND push it** so the **tagged commit** carries the
   matching version — the Flutter source never lags behind a released tag.
   `release-mobile.yml` enforces this and **fails the release on a mismatch**.
5. **Mobile — user-facing release notes.** `.github/whatsnew/whatsnew-en-US` and
   `whatsnew-es-ES` must hold a short, **non-technical**, user-facing summary of the
   new version's `CHANGELOG.md` (what changed, in plain language for end users),
   **≤ 500 characters each** (Google Play's limit). `release-mobile.yml` validates
   this and fails if a file is missing, empty, a leftover placeholder, or over the
   limit. Update both before tagging.

---

## Quick reference

| I need to understand... | Document |
|---|---|
| What Uxnan is and how it works | `README.md` |
| Mobile app architecture | `architecture/00-index.md` |
| Mobile modules and code | `architecture/02a-system-architecture.md` |
| JSON-RPC contracts | `architecture/02b-contracts-and-requirements.md` |
| Flutter implementation (Riverpod, M3, tests) | `architecture/02c-implementation-guide.md` |
| Mobile code conventions | `architecture/03-technical-reference.md` |
| Desktop app architecture | `uxnandesktop/architecture/00-index.md` |
| Terminals and PTY | `uxnandesktop/architecture/02b-terminal-engine.md` |
| Git and worktrees in desktop | `uxnandesktop/architecture/02c-git-worktrees.md` |
| Agent monitoring | `uxnandesktop/architecture/02d-agent-monitoring.md` |
| Embedded vs standalone bridge | `uxnandesktop/architecture/02e-bridge-integration.md` |
| Desktop stack and patterns | `uxnandesktop/architecture/03-implementation-guide.md` |
| MVP and implementation phases | `uxnandesktop/architecture/04-technical-reference.md` |
| Full E2EE protocol | `architecture/02a-system-architecture.md` (section 5.9) |
| Security and cryptography | `architecture/02b-contracts-and-requirements.md` (section 5) |
| Spec drift control (sync FOR-DEV → architecture/) | `AGENTS.md` → "Spec drift control (non-negotiable)" |
