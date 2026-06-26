# Desktop — testing & verification

The quality gates to run before considering a change done (AGENTS.md requires
compile + tests + lint/format clean, and a real UI flow for UI changes).

## Backend (Rust)

```bash
cd uxnandesktop/src-tauri
cargo test                     # unit + integration tests
cargo clippy --all-targets     # lints — must be warning-free
cargo fmt --check              # formatting — must be clean (run `cargo fmt` to fix)
```

Unit tests live in-file under `#[cfg(test)]` (e.g. `model.rs`, `persistence.rs`,
`git.rs`, `gitfast.rs`, `pty.rs`, `hooks.rs`, `agent_hooks.rs`, `procscan.rs`,
`which.rs`); integration tests go in `src-tauri/tests/`. ~85 backend tests cover
the Serde model shape, persistence round-trip / atomicity / migration / backups,
git + worktree ops, the git2 fast path, the PTY lifecycle, the agent hook server,
and process detection. **There are no frontend (Vitest) tests yet** — see
[`../FOR-DEV.md`](../FOR-DEV.md).

## Frontend (Svelte / TypeScript)

```bash
cd uxnandesktop
npm run check                  # svelte-check — must report 0 errors / 0 warnings
npm run build                  # production SPA build must succeed
```

Component tests (Vitest) and E2E tests (Playwright/WebdriverIO) are introduced in
later phases — see [`../FOR-DEV.md`](../FOR-DEV.md) (Phase 5).

## UI / behavior verification

Type-checks and unit tests verify *code* correctness, not *feature* correctness.
For anything user-visible, also run the app and exercise the flow:

```bash
npm run tauri dev              # full app (backend + webview, hot reload, devtools)
```

Per the repo's UI workflow (AGENTS.md), UI changes are reviewed visually by the
maintainer on-device and are **not committed unilaterally** — propose → review →
adjust → approve → commit.

## One-shot pre-commit check (copy/paste)

```bash
cd uxnandesktop \
  && npm run check \
  && npm run build \
  && ( cd src-tauri && cargo test && cargo clippy --all-targets && cargo fmt --check )
```
