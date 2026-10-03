# Contributing to Uxnan

Thanks for your interest in contributing! Uxnan is in **alpha**, so things move
fast and the bar for quality is high — the early code defines the foundation.

This guide is the practical "how to contribute". The **single source of truth
for conventions, architecture, and rules** is [`AGENTS.md`](AGENTS.md) — please
read it before sending non-trivial changes.

By contributing, you agree that your contributions are licensed under the
project's [MPL-2.0](LICENSE) license, and you agree to follow our
[Code of Conduct](CODE_OF_CONDUCT.md).

## Monorepo layout

Uxnan is a single repo with five projects. Tell us (and the tooling) which one
you're touching:

| Project | What it is | Stack |
| ------- | ---------- | ----- |
| `shared` | Contracts: JSON-RPC + E2EE types and validators | TypeScript |
| `bridge` | PC daemon (`uxnan-bridge`) that drives the agent CLIs | Node.js |
| `relay` | The user's own relay: a Worker the bridge deploys into the user's Cloudflare account; forwards opaque E2EE frames | TypeScript (Cloudflare Workers + Durable Objects) |
| `uxnandesktop` | Desktop ADE | Tauri 2 + Rust + Svelte 5 |
| `uxnanmobile` | Mobile client | Flutter (Android / iOS) |

A change to a `shared` contract **must** update every consumer (bridge, relay,
mobile) in the same change.

## Getting set up

- **Node projects** (`shared`, `bridge`, `relay`): Node ≥ 20, then `npm ci` at
  the repo root (npm workspaces).
- **Desktop** (`uxnandesktop`): Node ≥ 20 + the Rust toolchain (pinned in
  `uxnandesktop/src-tauri/rust-toolchain.toml`) + your OS's Tauri/WebKitGTK deps.
- **Mobile** (`uxnanmobile`): Flutter `3.44.0` (stable).

Each project has its own `README.md`, `CHANGELOG.md`, `docs/`, and a `FOR-DEV.md`
(pending work) / `FOR-HUMAN.md` (assets only a human can provide). Read them for
component-specific details.

## Quality gates (run before opening a PR)

Match the CI checks for the project you touched:

| Project | Lint / format | Type check | Tests |
| ------- | ------------- | ---------- | ----- |
| `shared`/`bridge`/`relay` | `npm run format:check` (prettier) | `npm run typecheck` | `npm test` |
| `uxnandesktop` | `cargo fmt --check` + `npm run check` (svelte-check) | — | `cargo clippy -- -D warnings`, `cargo test`, `npm test` (Vitest) |
| `uxnanmobile` | `dart format` + `flutter analyze` | — | `flutter test` (run `flutter gen-l10n` first) |

CI runs these same gates on every PR (and on push to `main`, except the merge of
a release bump pull request, which its PR and the release already verified — see
[`docs/releases.md`](docs/releases.md)). If a check fails on
a PR, a bot posts a sticky comment with the failing run link and how to reproduce
it locally.

## Commits & PRs

- **One logical change per PR/commit.** Don't mix a feature, a fix, and a
  refactor.
- **Conventional Commits**: `type(scope): message` — types `feat`, `fix`,
  `refactor`, `docs`, `test`, `chore`, `ci`, `build`. Imperative, lowercase.
  Scopes by component are listed in `AGENTS.md`.
- **Update `CHANGELOG.md`** of every affected component (technical detail), and
  update `architecture/` / docs if behavior or a contract changed (spec-drift
  control — see `AGENTS.md`).
- Fill in the **PR template** (affected component(s), change type, how it was
  tested, checklist).
- **UI changes** are reviewed visually and are not merged unilaterally — propose,
  iterate on feedback, then merge once approved.

## Releases (maintainers)

Releases are triggered by **per-component tags** you push; the release workflow
first re-runs the verification and only builds/publishes if it's green.

| Tag | Result |
| --- | ------ |
| `shared-v*` / `bridge-v*` | publish to **npm** (publish `shared` first) |
| `desktop-stable-v0.0.PATCH` | stable installers → **GitHub Release** (draft) |
| `desktop-nightly-v0.0.PATCH-nightly.YYYYMMDD.N` | nightly installers → **GitHub pre-release** (draft) |
| `mobile-v*[+build]` | signed AAB → **Google Play** (open testing / beta) |

Versions follow `0.0.PATCH-alpha.YYYYMMDD` for the npm/mobile alpha line. Desktop
uses explicit stable/nightly tag forms so its updater channels cannot be mixed;
see [`docs/releases.md`](docs/releases.md).

The relay has **no release of its own**: `uxnan-relay` is a private workspace (a
Cloudflare Worker) whose bundle ships inside `uxnan-bridge`, so a change under
`relay/` is released by cutting the bridge. That cut also moves the Worker's own
version in `relay/package.json` — only when the Worker changed. Old `relay-v*`
tags stay in git but trigger nothing. See *The relay Worker ships inside the
bridge* in [`docs/releases.md`](docs/releases.md#the-relay-worker-ships-inside-the-bridge).

### Non-negotiable rule — mobile release notes

**Every `uxnanmobile` release MUST ship user-facing "What's new" notes** in
`/.github/whatsnew/whatsnew-en-US` and `whatsnew-es-ES`:

- **For end users — keep them non-technical.** The technical detail belongs in
  `CHANGELOG.md`.
- **≤ 500 characters each** (Google Play's limit).
- The release workflow **validates this and fails** if a file is missing, empty,
  a leftover placeholder, or over the limit. Update both files before tagging.

## Reporting bugs & requesting features

Open an issue and pick the right form (Bug report / Feature request). Be
specific: which component(s), exact steps, error output, OS, and version. Blank
issues are disabled on purpose.

- **Questions / ideas** → use GitHub Discussions, not an issue.
- **Security vulnerabilities** → do **not** open a public issue; follow
  [`SECURITY.md`](SECURITY.md).

Thanks again for helping build Uxnan!
