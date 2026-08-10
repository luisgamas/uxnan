# Uxnan — Agent Guidelines

> This document is the single source of truth for any AI agent working on this project.
> It applies to every component in the monorepo: `uxnanmobile/`, `uxnandesktop/`, `bridge/`, `relay/`, `shared/`.

## Project status

**ALPHA — MVP in progress.** Architecture documentation is complete and the
mobile MVP runs end-to-end with a real agent.

| Component | State | What's working today | What's left |
|---|---|---|---|
| `shared/` | implemented | JSON-RPC + E2EE contracts and validators — [`shared/README.md`](shared/README.md) | — |
| `relay/` | implemented | [`relay/FOR-DEV.md`](relay/FOR-DEV.md) → `## Status` | same file, below `## Status` |
| `bridge/` | implemented | [`bridge/FOR-DEV.md`](bridge/FOR-DEV.md) → `## Status` | same file, below `## Status` |
| `uxnanmobile/` | MVP wired | [`uxnanmobile/FOR-DEV.md`](uxnanmobile/FOR-DEV.md) → `## Status` | same file, below `## Status` |
| `uxnandesktop/` | ALPHA-functional (standalone) | [`uxnandesktop/FOR-DEV.md`](uxnandesktop/FOR-DEV.md) → `## Status` | same file, below `## Status` |
| `web/` | published | [`web/FOR-DEV.md`](web/FOR-DEV.md) → `## Status` | same file, below `## Status` |

**This table is the only status kept here, and it stays this short on purpose.**
The per-component detail lives in each `FOR-DEV.md` `## Status` (what works today
/ what's partial / what's left), what shipped lives in each `CHANGELOG.md`, and
how a subsystem works lives in that component's `docs/` — the same split §2
*Where status lives* requires of every change. Do not grow a feature inventory
back into this file: a reader who needs one component's state opens that
component's `FOR-DEV.md`, and one that is out of date is a bug in **that** file.

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
├── GEMINI.md                      # Antigravity compatibility entry point — imports `AGENTS.md`
└── README.md
```

---

## Before implementing anything

### 0. Verify required skills

The repo depends on skills installed **globally** (`-g` installs them and
symlinks every agent on the machine, so they work from OpenCode, Claude Code,
Codex, Pi or any other). They encode this repo's exact architectural and UI
style, and they are **scoped**: Flutter skills are for `uxnanmobile/` **only**,
the Svelte skill for `uxnandesktop/` **only**. Never invoke one on the other app.

Canonical source for all of them: `https://github.com/luisgamas/skills`.

| Skill | Component | Purpose |
|---|---|---|
| `flutter-init-project` | `uxnanmobile/` | Bootstrap/reset a Flutter project baseline |
| `flutter-clean-architect` | `uxnanmobile/` | Module/layer structure (domain, infrastructure, presentation) |
| `flutter-riverpod-expert` | `uxnanmobile/` | Providers, notifiers, auth/router wiring |
| `flutter-m3-uiux` | `uxnanmobile/` | Theme, design tokens, responsive UI. **One deliberate divergence:** the skill assumes Material icons; this app draws Hugeicons through its own `UxIcon` primitive and `UxIcons` catalogue (see [`uxnanmobile/docs/conventions.md`](uxnanmobile/docs/conventions.md) → *Icons come from the catalogue*) |
| `svelte-clean-desktop-ui` | `uxnandesktop/` | Token-driven Svelte 5 + shadcn-svelte / Bits UI / Tailwind v4 system — shell layouts, sidebars, panes, settings, cards, menus, tabs, forms, dialogs, compact density, neutral surface layering, DM Sans typography, polished motion — without changing the UI libraries. **One deliberate divergence:** the skill assumes lucide icons; this app draws Hugeicons through its own `Icon` primitive (see [`uxnandesktop/docs/design-tokens.md`](uxnandesktop/docs/design-tokens.md) → *The icon set*) |

**Check before working in a component:** a skill counts as installed if
`<name>/SKILL.md` exists under **any** of `~/.agents/skills/`,
`~/.config/opencode/skills/` or `~/.claude/skills/`.

**If one is missing,** install it and stop:

```bash
npx skills add https://github.com/luisgamas/skills/tree/main/<skill-name> -g -y
```

Then **tell the user to restart their agent** so the skill is detected, and do
not start work in that component until it is available. If `npx skills` is not
on the machine, stop and ask the human to install them manually.

### 1. Analyze the architecture

Before writing code in any component, you MUST read the corresponding architecture documentation:

| If you're working on... | Read first... |
|---|---|
| `uxnanmobile/` | `architecture/00-index.md` and the documents it references for the affected module |
| `uxnandesktop/` | `uxnandesktop/architecture/00-index.md` and the relevant documents |
| `bridge/` | `architecture/02a-system-architecture.md` (section 5.8) + `uxnandesktop/architecture/02e-bridge-integration.md` |
| `bridge/src/adapters/` (**any** wired-agent work) | **`bridge/docs/agents.md` → _Drive surface_ first** — it records which headless surface each CLI is actually driven on, and every CLI has more than one that behave differently |
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
  theme and stay sharp. They are held to the shipped UI: when the desktop shell or
  a mobile screen changes shape, `web/src/components/mockups/` is part of that
  change set. Phone screens are drawn once at a canonical size and scaled by the
  frame — never re-size their contents to fit (`web/docs/design.md`).
- **Icons are Hugeicons, the same set `uxnandesktop/` draws**, imported one glyph
  per subpath. The site uses upstream's `@hugeicons/react`; the desktop needs its
  own primitive because the *Svelte* component is broken for its call sites — do
  not "align" one onto the other. Where a mockup recreates a screen, take the
  glyph the app takes (the agent-state icons are `AgentStatusIndicator.svelte`'s),
  and keep `@hugeicons/core-free-icons` pinned exactly in **both** `package.json`
  files so the art cannot drift between app and site (`web/docs/design.md` §7).
- **Agent marks live once, in `assets/agents/`** — the root READMEs render those
  files directly and the site syncs them into `web/public/agents/` before dev and
  build (`web/scripts/sync-agent-marks.mjs`; the synced copy is git-ignored).
  **Only four agents keep a drawn mark** (Claude Code, Codex, OpenClaude, Zero);
  every other one uses its **favicon, vendored as a PNG** by
  `web/scripts/fetch-agent-favicons.mjs` — the desktop app shows the same
  favicons, so the app, the site and the READMEs agree, and no visitor's browser
  calls a third party to draw a logo. So a new agent means running that script
  (or adding one SVG if it deserves a drawn mark), plus its entry in
  `web/src/lib/site.ts` — in `AGENTS_PRECISE` or `AGENTS_BASIC`, whichever is
  true — and the agent cell in `README.md` **and** `README.es.md`. A **drawn**
  mark that is black needs adding to `INVERT_ON_DARK` (and a `-on-dark.svg`
  sibling for the READMEs, which GitHub also renders on a dark page); a favicon
  never does — inverting one wrecks its colours.
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

A stale doc is a bug, and lagging documentation is the single biggest source of
drift in this repo. **Every change that touches behavior, API, contracts,
structure, configuration, build or status MUST update the affected documentation
in the SAME change set** — never "later", never "in a follow-up". That includes a
feature, a fix, a refactor, a completed deferred item, and even a spec-only
decision with no code at all.

Match the change to the docs it touches (one change often hits several rows):

| What you changed | Update… |
|---|---|
| Behavior / API / a feature in one component | that component's **`CHANGELOG.md`** (`[Unreleased]`, [Keep a Changelog](https://keepachangelog.com/)) — **always, without exception** — plus its **`README.md`** and **`docs/`** if how it's installed / configured / used / run / tested / connected changed |
| A cross-component contract (a `shared/` JSON-RPC method, E2EE message, notification, or model field) | the **`shared/`** types + validators, **`architecture/02a`/`02b`**, and the **`CHANGELOG.md` of every consumer** you touched this cycle (see *Cross-monorepo* below) |
| Direction / an architecture decision (even spec-only, no code) | the affected **`architecture/`** page(s) **and** the executive summary at the top of that doc — see **§4 Spec drift control** |
| Implementation state in a component (a feature / phase flips planned → done, or done → reworked) | that component's **`FOR-DEV.md` `## Status`** (see *Where status lives*). Also refresh the matching **`architecture/00-index.md`** / **`04-technical-reference.md`** status table when a spec-level phase flips |
| Finished a deferred item (100% + validated) | **remove** it from `FOR-DEV.md` / `FOR-HUMAN.md` (see *completion lifecycle*) and fold the shipped capability into that `FOR-DEV.md`'s `## Status` |
| Deferred new work / left a stub / found a missing human asset | **add** a `FOR-DEV.md` / `FOR-HUMAN.md` entry **and** the inline `FOR-DEV:` / `FOR-HUMAN:` marker at its site |

Verify docs like you verify code: re-read what you wrote against the real current
state (counts, file names, flags, agent lists, paths).

#### Where status lives

Three audiences, three homes — keep them separate so none of them rots:

- **`README.md`** (per component **and** the root `README.md`/`README.es.md`) —
  user-facing front door: what the thing *is and does*, plus a **brief** status
  snapshot. Never a feature-by-feature inventory; update it only when the
  one-line summary became wrong.
- **`FOR-DEV.md` `## Status`** — developer-facing home for the **detailed**
  implementation status (working / partial / left), sitting directly above the
  pending list it contextualizes. Every component's `FOR-DEV.md` opens with one.
- **`architecture/` status tables** — the spec-level record of which phases and
  subsystems are built (§4). They track the *spec*; lived status is `FOR-DEV.md`.

#### Counts, enumerations & links (easy to miss)

- **A cited number must change when the thing it counts changes.** Add or remove
  a **test**, **JSON-RPC method**, **streaming notification**, **agent** or
  **module** → grep **every** doc for that number/list and update **all** of them
  in the same change set. Re-derive it from the code (`grep -c` the registry /
  `test(`); never trust the old number. These have bitten us: a new method bumps
  the `N methods` count in `shared/README.md`, `bridge/README.md` **and**
  `architecture/02b` (the `METHOD_NAMES` count *and* the method list — the root
  README is a conversion page and cites no count); new tests bump the
  `N passing` counts in that component's `FOR-DEV.md` `## Status` and any
  `README.md` / `docs/` page quoting one.
- **Never reference a git-ignored / local-only file from a tracked file.**
  Anything in `.git/info/exclude` (local `*_MVP.md` snapshots, scratch notes) is
  the maintainer's own context and won't exist on a fresh clone.
- **NEVER validate an adapter against a surface the bridge does not drive.**
  Every wired CLI exposes several headless surfaces — an ACP/JSON-RPC server, a
  one-shot `-p`/`exec` run, an on-disk session store — and they **do not behave
  alike**: the same CLI can report token usage on one and nothing at all on
  another. This has shipped two wrong "fixes": usage read from `zero exec`'s
  session store and from the transcript `grok -p` writes, neither of which the
  driven surface ever produces (one of them left the phone showing a meter
  pinned at zero, worse than hiding it). Before claiming an adapter behaves a
  certain way, **run that adapter** and read what it emits — not what the CLI
  writes somewhere else. The per-agent surface, transport and what each one
  reports live in [`bridge/docs/agents.md`](bridge/docs/agents.md) →
  *Drive surface*; keep it current in the same change set.

- **Hand-kept model tables come in PAIRS — a new model goes in BOTH.** Agent CLIs
  are discovered live except **Claude Code**, whose curated table exists once per
  app:

  | Agent | Bridge (feeds the phone) | Desktop (feeds AI commit / PR body) |
  |---|---|---|
  | Claude Code | `bridge/src/daemon-config.ts` → `DEFAULT_DAEMON_CONFIG.agents['claude-code'].models` | `uxnandesktop/src-tauri/src/agentcli.rs` → `CLAUDE_MODELS` |

  Edit **both halves in the same change set** (one alone leaves the other app a
  version behind), same ids, labels and order — newest/most capable first.
  Canonical ids only: no date suffixes, no routing variants (`…[1m]`, `…-fast`),
  no invitation-only models, and no bare `fable`/`opus`/`sonnet`/`haiku` alias
  inside a table (the bridge advertises aliases separately from
  `claude-adapter.ts`, hand-kept too and verified against `claude --help`). A
  model in an existing tier needs no context-window edit —
  `claudeContextWindow()` maps by tier. Full rules:
  [`bridge/docs/agents.md`](bridge/docs/agents.md) and
  [`uxnandesktop/docs/agent-launch.md`](uxnandesktop/docs/agent-launch.md).

- **The standalone Gemini CLI is intentionally unsupported: do not reintroduce
  it.** Its adapter, contract id, catalogs, hooks, quota reader and UI surfaces
  were removed in August 2026. Google's supported integration is Antigravity
  (`agy`), which discovers its own models. This prohibition does **not** apply to
  Gemini-family model ids exposed by Antigravity, OpenCode, Pi or another active
  CLI, nor to Antigravity's own files under `~/.gemini/`. Upgrade-only cleanup
  may recognize the retired exact ids (`gemini-cli` on the bridge, `gemini` on
  desktop) solely to remove Uxnan-managed stale configuration; it must never make
  the CLI runnable again.

#### The docs track the code — re-verify them when the code moves

`README.md` and the `docs/` guides hard-code concrete facts pulled from the
source, and each one is a small contract that breaks silently when the code
moves. Whenever you touch code a doc describes, **re-derive the affected facts
from the source in the same change set** — don't trust what the doc says. What
has bitten us, and where it lives:

- **CLI commands, flags & npm scripts** — the `bin`/`scripts` of each
  `package.json`, the Tauri/Flutter commands.
- **Config keys, enum values & identifiers** — fields and defaults in the config
  type (e.g. `daemon-config.ts`), and canonical id unions like `AgentId`
  (`antigravity-cli`/`pi-agent`, *not* `agy`/`pi`), matched exactly.
- **Env vars, file names & paths** — `UXNAN_HOOK_URL`, `UXNAN_AGENT_ID`,
  `~/.uxnan/daemon-config.json`, `~/.uxnan/checkpoints.json`. Copy them from
  the code, never from memory.
- **Default values & ports** — `DEFAULT_LAN_PORT`, `checkpointMaxPerProject`:
  quote the constant's real value.
- **"Which agents / which features" claims** — when a capability lands, the prose
  enumerating it (`docs/agents.md`, `docs/testing.md`, …) is part of the change.
- **Behavior described in a doc-comment** — a `/** … */` explaining a fallback or
  a scope must match the code (these drift fastest: nothing compiles them).

#### Cross-monorepo functionality (read this twice)

Many features span monorepos — a bridge method the phone renders, an E2EE step
both sides implement, push in the bridge with a relay fallback. When you change
one side of a shared feature:

- update **`shared/`** (the contract source of truth) **and** the cross-component
  spec (`architecture/02a`, `02b`, `02e`), so wire and prose never disagree;
- update the **`CHANGELOG.md` + `README.md`/`docs/` of *every* component the
  change reaches** in the same cycle — leave **none** of them stale;
- if only one side can land now, record the owed work as a **`FOR-DEV.md`** item
  on the component that still needs it and link the two.

Unsure which monorepos a feature touches? Trace it through `shared/`: whatever
consumes the contract you changed may have docs to update.

#### FOR-DEV / FOR-HUMAN completion lifecycle (non-negotiable)

These two files track **only open work** — never a growing list of `[x] DONE`
items. The moment an item is **100% implemented AND validated** (for
`FOR-HUMAN`: the asset is provided and the feature works with it):

1. land the code + all its doc updates (per the table above), then
2. in the **same commit**, delete the item from `FOR-DEV.md` / `FOR-HUMAN.md`
   and remove its inline `FOR-DEV:` / `FOR-HUMAN:` marker at the code site.

The commit history (CHANGELOG entry + deletion diff) is the permanent record —
that is intentional and sufficient, so don't keep items "for posterity". Before
deleting, re-confirm each *remaining* item is genuinely open: a partial,
happy-path-only or not-yet-device-verified item **stays**, with an honest status.
(Division of labor: `architecture/` + `CHANGELOG.md` record *what shipped*;
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

The `architecture/` folders are the **source of truth** for cross-component
concerns (E2EE protocol, JSON-RPC contracts, the bridge spec §5.8, the relay spec
§5.10, the desktop three-panel ADE, the Flutter Clean Architecture). Each
`CHANGELOG.md` records what shipped; `FOR-DEV.md` / `FOR-HUMAN.md` track only
what's left. Spec and code MUST stay in sync.

**Rule:** every time a `FOR-DEV.md` item is **completed** (and therefore removed
per §2's completion lifecycle), the same change set MUST reflect it in the
relevant `architecture/` document — **a CHANGELOG entry is not a substitute for
the spec.** What "reflected" means:

- **New/changed cross-component contract** (JSON-RPC method, E2EE message,
  notification, model field) → the applicable section of
  `architecture/02a-system-architecture.md` (or `02b-contracts-and-requirements.md`
  for contract detail), plus the matching model in `shared/`.
- **Changed direction** (e.g. the relay going from required to optional, push
  moving from relay to bridge) → rewrite the affected section of `02a` and the
  affected spec page (`02a` §5.10, `02e-bridge-integration.md`, …) **and** that
  doc's executive summary.
- **Implementation state change** (a phase flips planned → done) → the matching
  `architecture/04-technical-reference.md` / `00-index.md` status table.
- **Spec-only decision (no code)** → still lands in `architecture/`.

**Workflow:** land the change → update the affected `architecture/` sections (+
the component README if behavior changed) in the **same change set** → list every
spec file and section you touched in the commit body, so the sync is reviewable.
If a change is too large to sync in one set (rare — a full subsystem rewrite),
open a follow-up in the matching `FOR-DEV.md` and link the two.

**Exception (acceptable drift, with a marker):** when the spec is clearly stale,
a contradicting code change MAY land first with a `// FOR-DRIFT:` comment at the
conflict site **and** a `FOR-DRIFT` entry in the matching `FOR-DEV.md` describing
the spec change owed. Resolve it in the next spec pass — never let a `FOR-DRIFT`
entry survive a release.

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
that component's `release-*.yml` workflow. The version convention, which files
carry a version, the release matrix and the full step-by-step are in
**[`docs/releases.md`](docs/releases.md)**; the contributor-facing summary is in
[`CONTRIBUTING.md`](CONTRIBUTING.md) → *Releases*.

> **Do not cut a release by hand.** `npm run release:status` says what genuinely
> needs one; the **Release — cut versions** workflow (`release.yml`) does the cut —
> it computes the version, writes every version-bearing file, proves they agree,
> commits, tags, and pushes **in the required order**, waiting for npm between
> `shared` and its consumers. The desktop nightly cuts itself at 06:20 UTC when
> there is something to ship. How it all fits together, and what is deliberately
> left to a human, is in **[`docs/releases.md`](docs/releases.md)**. The rules
> below are what that automation enforces — they still bind anyone doing it
> manually, which should be nobody.

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
   Full per-file list + commands in **`docs/releases.md`** → *Which files carry a
   version*, whose machine-readable copy is `scripts/release/components.mjs`.
3. **Validate the deploy** — confirm the release actually shipped: the
   `release-*.yml` run is green and the artifact landed (npm published to the
   `latest` dist-tag / the Play **open-testing** (beta) build uploaded / the
   desktop GitHub **Release** draft exists). A red or half-finished release run is
   **not** a release. The bump pull request the run opened **merges itself** once
   its `verify` checks pass — the release app is a bypass actor on
   `main-protection` in pull-request mode. If it is still open, its checks went
   red: fix that rather than merging past it, because an unmerged tag is not an
   ancestor of `main`, which is the state that cut desktop 0.0.34 for nothing.
   (npm's `latest` dist-tag always tracks the newest
   release; `alpha`/`beta` channels are opt-in, added manually per build — see
   `docs/releases.md`.) There is no history file to update: `VERSIONS.md` was
   removed on 2026-08-10, because git tags and GitHub releases already are that
   record.
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
