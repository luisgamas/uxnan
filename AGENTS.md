# Uxnan — Agent Guidelines

> This document is the single source of truth for any AI agent working on this project.
> It applies to every component in the monorepo: `uxnanmobile/`, `uxnandesktop/`, `bridge/`, `relay/`, `shared/`.

## Project status

**ALPHA — MVP in progress.** Architecture documentation is complete and the mobile MVP runs end-to-end with a real agent. State by component (details in each `CHANGELOG.md`; pending work in each `FOR-DEV.md`):
- `shared/` — **implemented**: JSON-RPC + E2EE contracts and validators.
- `relay/` — **implemented**: E2EE envelope relay by `sessionId`, rate limiting, peer-close, push endpoints (gated on Firebase/APNs creds).
- `bridge/` — **implemented**: E2EE transport (relay + LAN), **OpenCode, Claude Code, Codex, pi and Gemini wired as real agents** (each spawns its official local CLI over stdio — no provider API/SDK/keys), per-thread agent/model/project selection **plus per-project agent/model pins** (`projectAgents` from config), **full thread lifecycle** (`thread/rename|archive|unarchive|delete`), **account-aware structured model discovery** (`AgentModel[]`: Codex via `codex app-server` `model/list`, Claude aliases "(latest)" + config-pinned versions incl. Fable 5 + resolved-version `model_resolved` event), **per-turn token usage** on `turn/completed`, **per-model run-option knobs** (reasoning effort discovered per model — Codex via `model/list` `supportedReasoningEfforts`, Claude via its `--effort` set — advertised on `agent/models` and applied to each CLI), **directory browsing** (`workspace/browseDirs`), Git + workspace + **checkpoints with true worktree restore + retention pruning**, conversation engine, **sanitized per-agent `auth/status`** (never tokens), trusted-device management (`bridge/removeTrustedDevice`) and a real `bridge/status.relayConnected`, push (gated, **persisted across restarts + multi-device**), resilient relay reconnection. The remaining agent (Aider) follows the recipe in `bridge/FOR-DEV.md`; remaining MVP follow-ups (e.g. packaging, fast-mode/context knobs if a CLI exposes them) are tracked there.
- `uxnanmobile/` — **MVP wired**: pairing/E2EE, auto-reconnect, **live streaming conversations that survive navigation** (per-thread in-memory buffers + `turn/list` re-sync) with a per-thread activity indicator, **structured model picker** (readable names, default badge, alias resolved-version), **always-visible context-usage indicator** (% when the model window is known, token count otherwise; 0 baseline for usage-reporting agents), **data-driven per-model run-option knobs** (reasoning effort, rendered from `agent/models`), **per-agent sign-in status** (`auth/status`: conversation banner + threads-list red dot + new-conversation "Check sign-in", auto-refreshed on resume), per-thread actions (rename/delete/copy id, auto-title from id), **Remove device** (unpair), capability-aware controls, **folder browser** for new conversations, **relay-vs-direct transport indicator**, notification deep-link, Git, per-PC threads with **truthful, connection-targeted multi-PC status** (all live actions target the PC we actually hold a channel to), FCM push registration (gated).
- `uxnandesktop/` — **ALPHA-functional (standalone)**: Tauri 2 + Rust + Svelte 5 ADE. **Phases 0–5 + cross-cutting (S) complete.** Three-panel resizable shell with atomic JSON persistence (now with 5 rotating backups + sequential schema migrations), PTY terminals (`portable-pty`, xterm WebGL + DOM fallback) with tabs, nested splits + visible split buttons that never remount on split, **drag-to-reorder + move tabs across regions, `Ctrl+Tab` MRU cycling, a backend output ring buffer (snapshot/restore for recreated panes) and the Kitty/CSI-u keyboard protocol**, git worktrees with per-worktree terminal workspaces + in-app directory picker + a Ctrl/Cmd+P worktree palette, git status/diff/stage/commit/push/pull with a full-size center diff panel (unified + side-by-side, **hunk-level staging**, **visual image diffs**) and a 3s Tokio status watcher, **squash-merged branch cleanup on worktree removal**, **WSL repos routed through `wsl.exe`**, and **opt-in AI commit-message generation** (pick an installed agent — Claude Code / Codex / Gemini / OpenCode / Pi — and a model; the local CLI drafts the message from the staged diff). **Agent monitoring (Phase 4)** — activity inference + native idle notifications + per-agent sidebar rows + process-tree detection, the **Layer 1 local HTTP hook server** (`axum`: precise `working/blocked/waiting/done`, token-guarded, env-injected `UXNAN_HOOK_URL`/`_TOKEN`/`_AGENT_ID`, persistent cache TTL 7d), **Layer 2** terminal-title (OSC) inference, colored status dots, unread/done badges, custom agent logos, per-worktree agent override, and **multi-agent orchestration** (a console routing messages to all agents / one type (fan-out) / a coordinator's workers, with backpressure + an in-memory coordinator→workers task graph; spec `02d` §3). **Phase 5 polish** — hunk staging, side-by-side diffs, virtualized lists (`@tanstack/svelte-virtual`), opt-in keep-awake (Windows). Cross-cutting: full EN/ES i18n, design tokens, agent registry/catalog, shell-aware manual + auto agent launch with **per-agent env vars** and a **configurable launch shell** (cmd by default on Windows), plus a first **Vitest** frontend test harness (pure logic). **Remaining (tracked in `uxnandesktop/FOR-DEV.md`):** Phase 6 (embedded bridge / mobile pairing — *optional for standalone*); a CI/CD release pipeline + branded icons/signing before distributing builds; non-blocking follow-ups (keep-awake macOS/Linux, async-debounce persistence, E2E + component tests, per-agent hook configs, orchestration lineage in the main sidebar + agent-driven worker creation).

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

#### Svelte / desktop skills — `uxnandesktop/` only

These three skills encode the Svelte 5 + shadcn-svelte style used by the desktop
ADE frontend. Use them when building or refactoring `uxnandesktop/` UI.

| Skill | Purpose |
|---|---|
| `shadcn-svelte` | Add/update/compose shadcn-svelte components and design-system presets |
| `svelte-code-writer` | Svelte 5 docs lookup + code analysis when writing/editing `.svelte` / `.svelte.ts` |
| `svelte-core-bestpractices` | Modern Svelte 5 reactivity, events, styling, library integration |

**Installation:** If any skill is missing, install it globally with the exact
commands below. `shadcn-svelte` comes from the huntabyte registry; the two
`svelte-*` skills both ship from the official `sveltejs/ai-tools` bundle:

```bash
npx skills add https://github.com/huntabyte/shadcn-svelte --skill shadcn-svelte
npx skills add https://github.com/sveltejs/ai-tools
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
2. **Update `VERSIONS.md` and validate the deploy** — in the same change set, add or
   refresh the component's row in the history table, **and confirm the release
   actually shipped**: the `release-*.yml` run is green and the artifact landed (npm
   published under the `alpha` dist-tag / the Play **internal** build uploaded / the
   desktop GitHub **Release** draft exists). A red or half-finished release run is
   **not** a release — fix it before recording the row.
3. **Mobile — `pubspec.yaml` MUST match the tag (NON-NEGOTIABLE).** Before tagging
   `mobile-v<name>+<build>`, bump `uxnanmobile/pubspec.yaml` `version:` to the same
   `<name>+<build>`, then **commit AND push it** so the **tagged commit** carries the
   matching version — the Flutter source never lags behind a released tag.
   `release-mobile.yml` enforces this and **fails the release on a mismatch**.
4. **Mobile — user-facing release notes.** `.github/whatsnew/whatsnew-en-US` and
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
