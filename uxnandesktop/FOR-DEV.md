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
**in-app auto-updater**, **browser-control MCP for agents**, **orchestration run
engine**, **user quick commands**, **GitHub integration (`gh`-backed)**). 217 Rust backend tests + 192 frontend Vitest unit tests (pure logic); **no Svelte component or E2E tests yet**. macOS is **unvalidated**
(developed on Windows; CI is `{ubuntu, windows}`). **Phase 6 (embedded bridge /
mobile pairing) is NOT started.**

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
  once** per active workspace.
- **Git worktrees** — per-worktree terminal workspaces, hierarchical Projects
  tree, in-app directory picker, worktree palette (Ctrl/Cmd+P), squash-merged
  branch cleanup on removal, WSL repos routed through `wsl.exe`. Projects carry a
  **⋯ actions menu + per-project settings** (rename the card label without
  touching the folder) and a **custom icon**; branches carry a **per-branch icon**
  (both from a built-in glyph set, a file, a URL, or a git-host account avatar —
  rasterized to an inline PNG via `image_fetch_data_url` / `repo_remote_owner` and
  persisted in `RepoData.icon` / `branchIcons`).
- **Full git review** — status / diff / stage / commit / push / pull with a 3 s
  focus-paused Tokio watcher, CodeMirror 6 diff viewer, hunk-level staging,
  side-by-side toggle, visual image diffs, and optional AI commit-message
  generation via a local CLI agent.
- **Agent monitoring (Phase 4)** — Layer 1 local HTTP hook server (`axum`, precise
  `working/blocked/waiting/done` + persistent cache) + Layer 2 terminal-title
  (OSC, path/word-boundary-hardened) + Layer 3 process-tree detection; colored
  status dots, unread/done badges, custom agent logos, per-worktree agent override.
- **Precise per-agent reporters (auto-installed, multi-shell)** — Claude Code +
  Gemini CLI use a Node relay (`node` guaranteed; Claude in exec-form so no shell
  is involved); Codex uses a `curl` hook + a reproduced `trusted_hash` in
  `~/.codex/config.toml` (golden-vector-tested `codex_trust.rs`); OpenCode a
  plugin, Pi an in-process extension. Per-event merge preserves user hooks; shell
  reporters pass id/kind/state in headers (no JSON building); an endpoint file
  (`UXNAN_ENDPOINT_FILE`) survives app restarts; `WSLENV` carries the vars into
  WSL (WSL2 host-loopback is a documented gap). Settings → Agents → Hooks shows a
  card per agent (incl. Pi) + a master install switch.
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
- **AI-provider usage statistics (Settings → Providers)** — native Rust reader
  (`src-tauri/src/usage.rs`, `usage_read`/`usage_detect`) for **Codex, Claude,
  Copilot, Gemini, Grok**, reading each CLI's own stored token → the provider's official
  usage API (never cookies / pasted keys). Tabbed UI with per-provider quota
  windows ("% used"), plan/account ("Authenticated as …" with click-to-reveal
  blur), credit, per-provider refresh interval + status-bar visibility, and a
  status-bar gauge popover. Contract-first (`shared` `agent/usageStats`); the
  bridge/mobile side is Phase 6 (see below).
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
- **GitHub integration (`gh`-backed)** — a full-screen **GitHub section** (Overview /
  Pull Requests / Issues / Actions / Account / Settings), a configurable **right-panel
  GitHub tab** (per-worktree PR + checks + CI runs), **sidebar-card PR badges**, a
  **status-bar button** (rate-limit gauge + optional notifications), and a post-push
  **"Create PR"** toast. PR **review** (approve/request-changes/comment) + **merge** +
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

## GitHub integration — follow-ups ☐

**Validation status — read this first.** The surface above is **implemented and
type/unit-tested, but the write side is essentially unexercised against real GitHub
data.** What *has* been verified: the pure logic (rulesets → allowed methods, branch/
Markdown/model parsers) by unit tests, and the **read** calls (`gh repo view`,
`gh api …/rules/branches`, `gh pr view --json mergeStateStatus`, `gh label list`,
assignees) probed live against `luisgamas/uxnan`. What has **not** been run even once:
**creating a PR, merging one, an admin bypass, arming/disarming auto-merge,
update-branch, mark-ready, editing a PR/issue, requesting a reviewer, filing a labeled
issue, and the PR/issue → worktree dialog end-to-end.** This repo has no open PRs, no
issues and no collaborators, so those paths get exercised as real work appears — expect
first-run bugs there, and treat each as unproven until it's actually been done once.
The gaps below are known and deliberate, not discoveries waiting to happen.

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
      master-detail inside the GitHub section (full-screen). Making them **center tabs**
      that coexist with terminals needs a new tab kind across the terminals tab system
      (`terminals.svelte.ts` + `TerminalArea.svelte` rendering + serialization) — a
      larger, riskier change deferred as a UX refinement.
- [ ] **WSL repos.** A Windows `gh` can't see a `\\wsl.localhost\…` checkout, so GitHub
      features degrade to "not a GitHub repo" there (same class of gap as the WSL2
      hook-loopback limitation). Would need routing `gh` through `wsl.exe`.
- [ ] **"Clone from GitHub" UI entry.** The backend command + api wrapper exist
      (`github_clone` / `githubClone`, `gh repo clone`), but no UI surface calls them
      yet. Wire a small entry (a repo field + destination dir → clone → `repo_add`),
      e.g. from the Add-project dialog or the GitHub section.
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
- [ ] Keyboard protocol — extend the Kitty/CSI-u surface beyond the current
      encoder: functional/navigation keys as CSI-u (arrows, F-keys, Home/End,
      keypad — they fall through to xterm's legacy encoding today), the
      alternate-keys (4) and associated-text (16) flags, and super/hyper/meta
      modifiers. Needs validation against a real Kitty-protocol TUI. The base
      protocol (negotiation + disambiguate / event-types / all-keys) is
      implemented in `src/lib/terminal/keyboardProtocol.ts`.
- [ ] **Workspace lifecycle — active indicator + sleep/hibernate.** Surface which
      projects/worktrees have a *live* space (open terminals) vs an empty one — an
      indicator on the project/worktree cards, so it's obvious where terminals are
      running and which space is completely empty. Add a **"Sleep workspace"**
      action (+ shortcut) that closes every tab of a workspace and frees its
      resources (kill the PTYs + drop the xterm instances) to reclaim memory on a
      machine with many active projects. Complements the built-in per-pane trims
      (hidden panes already release their WebGL/GPU context, and each terminal's
      scrollback is capped at 5 000 lines; this drops a whole workspace at once).
      Wire into the card context menu (`RowActionsMenu`) and the keyboard-shortcut
      set; the workspace store already keys terminals per worktree path, so "which
      workspaces have tabs" is derivable from `terminals.workspaces`. (Note: the
      old idea of unmounting hidden xterms and replaying a backend ring buffer on
      show is off the table — raw-byte replay of a TUI stream proved unsound and
      the ring buffer was removed; terminals keep one live xterm per tab.)

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

**File tree / mixed tabs**
- [ ] Tree virtualization (TanStack Virtual) for very large folders.
- [x] File ops from the tree (create / rename / delete / new folder) — **done**: a
      per-entry right-click context menu (`FileTreeContextMenu` + `FileNamePromptDialog`,
      `fs_create_file`/`_dir`/`_delete`/`_duplicate`; delete → OS trash via the
      `trash` crate). Open tabs follow a rename / close on a delete. See `CHANGELOG.md`.
- [ ] Multi-worktree external-change watching (the watcher follows the active
      worktree only).
- [ ] Tab/region reorder + drag for the mixed `terminal|file|commit` tabs.
- [ ] **Markdown preview polish (non-blocking).** The in-house renderer
      (`markdown.ts` / `MarkdownView.svelte`) covers the common GFM surface; two
      deferred niceties: (1) syntax-highlight fenced code per language — today code
      blocks are plain monospace, though the Lezer language parsers are already
      installed; (2) resolve in-document / relative *links* (heading anchors, and
      links to sibling files → open that file's tab). Today only external links
      open (via the OS) and only local *images* are resolved (`fs_read_data_url`).

**Workspace / context menu**
- [ ] **"Open with" external editors/IDEs + customization.** The worktree row's
      right-click menu (a reusable `ui/context-menu`) covers terminals · agents ·
      reveal-in-file-manager · configure · remove. The requested *Open with →
      text editors / IDEs* submenu (launch the worktree folder in VS Code / an
      IDE) plus a user-customizable editor list needs a new **external-editor
      registry**: a catalog + per-editor launch command, a Settings pane to
      add/edit them, and a backend "open path in app" command. Only "Reveal in
      file manager" (`reveal_path`) ships today. Inline `FOR-DEV:` marker at the
      reveal item in `src/lib/components/WorktreeRow.svelte`.

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
- [ ] E2E tests (Playwright / WebdriverIO + tauri-driver) **and** Svelte
      **component** tests (Vitest + jsdom). The Vitest harness + **unit** tests
      for pure logic now exist (`src/lib/*.test.ts`); component/E2E are still TODO.

## Platform validation

- [ ] **macOS** is unvalidated end-to-end (no macOS CI; developed on Windows).
- [ ] **keep-awake** is implemented for macOS/Linux but **untested** there
      (`power.rs`); Windows works.
- [ ] **Update UI (pinned sonner toast + in-Settings download/install) — visual +
      functional validation pending.** The former top banner is now a pinned
      sonner toast (`UpdateToast.svelte` + `updateToast.svelte.ts`) and the
      download/install actions were surfaced inline in **Settings → Updates**.
      `svelte-check` + Vitest pass, but the toast's on-screen appearance and the
      end-to-end download → install flow haven't been exercised in a running build
      yet (blocked on a real update to appear — see the private-repo 404 item under
      *CI/CD — release*). Validate the toast look/feel and the Settings actions in
      the next update.

## CI/CD — release

- ✅ **Verify** — `.github/workflows/ci-desktop.yml` runs svelte-check + `npm test`
  (Vitest) + vite build + cargo fmt/clippy/test on `{ubuntu, windows}` (macOS
  deferred with Apple). 217 Rust + 192 Vitest tests.
- ✅ **`release-desktop.yml`** — exists: `tauri-action` bundles on a `desktop-v*` tag
  → draft GitHub Release, **and signs the updater artifacts** when the signing
  secrets are set. **Windows ships without OS code-signing for now; macOS deferred.**
- ✅ **Auto-updater** — `tauri-plugin-updater` wired end-to-end in the app
  (`src-tauri/src/updater.rs` + Settings → Updates with inline download/install +
  a pinned sonner toast `UpdateToast.svelte`; stable/nightly channels via GitHub's
  pre-release flag; background download + idle-guarded install). The rolling per-channel `latest.json` is published by
  `release-desktop-manifest.yml`. The signing keypair is configured and
  `desktop-v0.0.1-alpha.20260627` shipped signed installers + a `latest.json`
  on the `desktop-updater-stable` channel. See [`docs/updates.md`](docs/updates.md).
- [ ] **Public distribution while the repo is PRIVATE (blocker for end users)** —
      the GitHub-Releases download URLs and the updater endpoint
      (`…/releases/download/desktop-updater-<channel>/latest.json`) return **404**
      to anonymous clients while `luisgamas/uxnan` is private, so the in-app
      updater and public installer downloads only work for authenticated
      collaborators. Decision (2026-06-27): **keep the repo private for now.**
      Revisit when going public, or move desktop binaries to a dedicated **public**
      releases repo (then update `tauri.conf.json → plugins.updater.endpoints` +
      `release-desktop*.yml`). npm and Play distribution are unaffected.
- [ ] **Manifest workflow needs `contents: write` for first-time channel creation** —
      `release-desktop-manifest.yml`'s `gh release create` of a channel's rolling
      release 403'd because the repo's `default_workflow_permissions` is `read`
      (the workflow's `permissions: contents: write` was not honored for the
      create). Worked around by publishing `desktop-updater-stable` manually;
      subsequent uploads to an existing channel succeed. To fully automate, set
      Settings → Actions → Workflow permissions to **Read and write**
      (`gh api -X PUT repos/luisgamas/uxnan/actions/permissions/workflow -f default_workflow_permissions=write`).
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
