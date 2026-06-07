# Uxnan — Agent Guidelines

> This document is the single source of truth for any AI agent working on this project.
> It applies to every component in the monorepo: `uxnanmobile/`, `uxnandesktop/`, `bridge/`, `relay/`, `shared/`.

## Project status

**ALPHA** — Architecture documentation is complete. Implementation has begun: the `uxnanmobile/` Flutter app has a foundation (project scaffold, `core/` layer, Material 3 theme, domain enums, routing, i18n) and a local persistence module (drift) on the `uxnanmobile` branch. Other components (`uxnandesktop/`, `bridge/`, `relay/`, `shared/`) have not started. All code is new — no legacy, no users, no production data.

This means:
- There is no backwards-compatibility to maintain (yet).
- Architecture decisions can change if justified.
- All implementation must strictly follow the documented specification.
- The quality of the initial code defines the foundation for everything that follows. Rushed code is not acceptable.

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
├── AGENTS.md                      # This file
├── CLAUDE.md                      # Points to AGENTS.md
└── README.md
```

---

## Before implementing anything

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
- Aggregate every open item in a `FOR-HUMAN.md` checklist at the component root (e.g. `uxnanmobile/FOR-HUMAN.md`).
- Also place an inline comment with the `FOR-HUMAN:` token at the exact code/config location that needs the asset (e.g. a `# FOR-HUMAN:` comment in `pubspec.yaml`).
- The whole project must always compile and run without these assets (use graceful fallbacks); a missing `FOR-HUMAN` asset may degrade a feature but must never break startup or the build.
- **Never** commit real secrets, credentials, or keys — only the annotation describing what is needed and where.

### Pending developer work (`FOR-DEV:`)

When you intentionally defer implementation work that a developer/agent must do later — a deferred feature, a stub, a happy-path-only implementation, a `TODO` that is justified by sequencing — leave a greppable annotation with the literal token `FOR-DEV:` followed by:

1. **What** is missing or stubbed.
2. **Where** the real implementation should go (path / symbol).
3. **Why** it was deferred and what unblocks it (e.g. "needs the relay", "UI increment", "needs the conversation module).

Rules:
- This is distinct from `FOR-HUMAN:` (which is for assets/secrets only a human can provide). `FOR-DEV:` is for code work the team will do.
- Aggregate open items in a `FOR-DEV.md` checklist at the component root (e.g. `uxnanmobile/FOR-DEV.md`), and place an inline `// FOR-DEV:` comment at the exact deferral site.
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

### 2. Update documentation

Every change that modifies behavior, API, structure, or configuration must be reflected in documentation:

- **CHANGELOG.md** of the affected component — always, without exception. Format: [Keep a Changelog](https://keepachangelog.com/). Under the `[Unreleased]` section.
- **Architecture documentation** — if the change contradicts or extends what's documented in `architecture/` or `uxnandesktop/architecture/`, update the corresponding document.
- **Component README** — if the change affects how the component is installed, configured, or used.

### 3. Do not commit or push

**NEVER** run `git commit` or `git push` on your own. These actions require explicit user confirmation.

When you finish a change:
- Show a summary of what changed.
- List the modified files.
- Wait for the user to decide whether to commit, what message to use, and whether to push.

This applies always, regardless of the change's size. A typo fix requires the same confirmation as a 50-file refactor.

---

## Conflict resolution

If the documentation says one thing but the existing code does another:
1. Documentation takes priority (the project is in ALPHA, code adapts to the spec).
2. If you believe the documentation is wrong, flag it explicitly before implementing.
3. Do not silently "fix" discrepancies — communicate them.

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
